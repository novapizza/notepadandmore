import { create } from 'zustand'

/**
 * Sticky Notes store.
 *
 * Notes are NOT documents: they have no dirty state, never occupy a tab, and
 * never reach BackupManager or SessionManager's buffer list. Their sole
 * persistence owner is `userData/config/notes.json`, written through the
 * generic `config:*-raw` IPC pair (which is atomic — see configHandlers.ts).
 *
 * The store is deliberately UI-free: it never toasts. Callers that hit a limit
 * get a `null`/false return and own the user-facing message.
 */

export type NoteColor = 'default' | 'yellow' | 'green' | 'blue' | 'pink' | 'purple'

const NOTE_COLORS: ReadonlySet<string> = new Set<NoteColor>([
  'default', 'yellow', 'green', 'blue', 'pink', 'purple'
])

export interface Note {
  /** crypto.randomUUID() — stable across restarts. */
  id: string
  /** Explicit title. Empty string means "derive from the first body line". */
  title: string
  body: string
  /** Monaco language id, used only when the note graduates to a tab. */
  language: string
  color: NoteColor
  pinned: boolean
  /** Epoch ms. */
  createdAt: number
  updatedAt: number
}

export interface NotesFile {
  /** Bump only on a breaking shape change; readers tolerate unknown future versions. */
  version: 1
  notes: Note[]
}

/** Hard cap on a single note body. Creation past it is refused; typing is clamped. */
export const MAX_NOTE_CHARS = 100_000
/** Soft cap on note count — warn once, never block. */
export const SOFT_MAX_NOTES = 500
/** Soft cap on the serialized file size — warn once, never block. */
export const SOFT_MAX_TOTAL_BYTES = 5 * 1024 * 1024
/** Display-only truncation of the derived title. */
export const TITLE_DISPLAY_CHARS = 60
/** Debounce before writing notes.json. */
export const SAVE_DEBOUNCE_MS = 500

const NOTES_FILE = 'notes.json'

/** Per-entry defensive guard. Invalid entries are dropped individually — one
 *  bad note must never lose the rest of the file. */
function isValidNote(v: unknown): v is Note {
  if (!v || typeof v !== 'object') return false
  const n = v as Record<string, unknown>
  if (typeof n.id !== 'string' || !n.id) return false
  if (typeof n.body !== 'string') return false
  if (typeof n.createdAt !== 'number' || !Number.isFinite(n.createdAt)) return false
  if (typeof n.updatedAt !== 'number' || !Number.isFinite(n.updatedAt)) return false
  return true
}

/** Coerce a validated entry into a fully-populated Note, repairing soft fields. */
function normalizeNote(n: Note & Record<string, unknown>): Note {
  return {
    id: n.id,
    title: typeof n.title === 'string' ? n.title : '',
    body: n.body.length > MAX_NOTE_CHARS ? n.body.slice(0, MAX_NOTE_CHARS) : n.body,
    language: typeof n.language === 'string' && n.language ? n.language : 'plaintext',
    color: typeof n.color === 'string' && NOTE_COLORS.has(n.color) ? (n.color as NoteColor) : 'default',
    pinned: typeof n.pinned === 'boolean' ? n.pinned : false,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt
  }
}

// ---------------------------------------------------------------------------
// Derived helpers — pure, and kept outside the store so NoteCard can call them
// without subscribing to it.
// ---------------------------------------------------------------------------

/** `title` when set, else the first non-empty body line, else 'Empty note'. */
export function displayTitle(note: Note): string {
  if (note.title.trim()) return note.title.trim().slice(0, TITLE_DISPLAY_CHARS)
  const line = note.body.split('\n').find((l) => l.trim().length > 0)
  if (!line) return 'Empty note'
  return line.trim().slice(0, TITLE_DISPLAY_CHARS)
}

/** Pinned first, then most-recently-updated. Returns a new array. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.updatedAt - a.updatedAt
  })
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | null = null
/**
 * Set when notes.json existed but failed to parse. The next save is skipped so
 * a transient read failure can't overwrite a recoverable file with an empty
 * list before the user has mutated anything. Any explicit mutation clears it.
 */
let skipNextWrite = false

export interface CapWarning {
  /** Note count is past SOFT_MAX_NOTES. */
  tooMany: boolean
  /** Serialized size is past SOFT_MAX_TOTAL_BYTES. */
  tooLarge: boolean
}

interface NotesState {
  notes: Note[]
  loaded: boolean
  /** Note currently expanded in the panel; null = list view. Not persisted. */
  editingId: string | null
  /** Panel filter text. Not persisted. */
  filter: string

  load: () => Promise<void>
  /** Debounced; called by every mutation. */
  save: () => void
  /** Cancel the debounce and write immediately. */
  flush: () => Promise<void>

  /** Returns the new note's id, or null when the body exceeds MAX_NOTE_CHARS. */
  createNote: (init?: Partial<Pick<Note, 'body' | 'language' | 'title' | 'color'>>) => string | null
  updateNote: (
    id: string,
    patch: Partial<Pick<Note, 'title' | 'body' | 'language' | 'color' | 'pinned'>>
  ) => void
  deleteNote: (id: string) => void
  togglePin: (id: string) => void

  setEditingId: (id: string | null) => void
  setFilter: (q: string) => void

  /** Soft-cap state for the panel to surface. The store never toasts itself. */
  getCapWarning: () => CapWarning
}

function serialize(notes: Note[]): string {
  const payload: NotesFile = { version: 1, notes }
  return JSON.stringify(payload, null, 2)
}

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],
  loaded: false,
  editingId: null,
  filter: '',

  load: async () => {
    let raw: string | null = null
    try {
      raw = await window.api.config.readRaw(NOTES_FILE)
    } catch {
      raw = null
    }
    if (raw == null) {
      // No file yet — a fresh install. Writing is safe.
      set({ notes: [], loaded: true })
      return
    }
    try {
      const parsed = JSON.parse(raw) as Partial<NotesFile>
      const entries = Array.isArray(parsed?.notes) ? parsed.notes : []
      const notes = entries
        .filter(isValidNote)
        .map((n) => normalizeNote(n as Note & Record<string, unknown>))
      set({ notes, loaded: true })
    } catch {
      // The file exists but is unreadable. Load empty so the app still starts,
      // but refuse to overwrite it until the user explicitly changes something.
      console.warn('[notesStore] notes.json did not parse — loading empty and preserving the file')
      skipNextWrite = true
      set({ notes: [], loaded: true })
    }
  },

  save: () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      if (skipNextWrite) {
        skipNextWrite = false
        return
      }
      void window.api.config
        .writeRaw(NOTES_FILE, serialize(get().notes))
        .catch((e: unknown) => console.error('[notesStore] save failed', e))
    }, SAVE_DEBOUNCE_MS)
  },

  flush: async () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (skipNextWrite) {
      skipNextWrite = false
      return
    }
    try {
      await window.api.config.writeRaw(NOTES_FILE, serialize(get().notes))
    } catch (e) {
      console.error('[notesStore] flush failed', e)
    }
  },

  createNote: (init) => {
    const body = init?.body ?? ''
    if (body.length > MAX_NOTE_CHARS) return null
    const now = Date.now()
    const note: Note = {
      id: crypto.randomUUID(),
      title: init?.title ?? '',
      body,
      language: init?.language || 'plaintext',
      color: init?.color ?? 'default',
      pinned: false,
      createdAt: now,
      updatedAt: now
    }
    skipNextWrite = false
    set((s) => ({ notes: [note, ...s.notes] }))
    get().save()
    return note.id
  },

  updateNote: (id, patch) => {
    skipNextWrite = false
    set((s) => ({
      notes: s.notes.map((n) => {
        if (n.id !== id) return n
        const next = { ...n, ...patch, updatedAt: Date.now() }
        // Typing past the hard cap is clamped rather than refused mid-edit.
        if (next.body.length > MAX_NOTE_CHARS) next.body = next.body.slice(0, MAX_NOTE_CHARS)
        return next
      })
    }))
    get().save()
  },

  deleteNote: (id) => {
    skipNextWrite = false
    set((s) => ({
      notes: s.notes.filter((n) => n.id !== id),
      editingId: s.editingId === id ? null : s.editingId
    }))
    get().save()
  },

  togglePin: (id) => {
    skipNextWrite = false
    set((s) => ({
      notes: s.notes.map((n) =>
        n.id === id ? { ...n, pinned: !n.pinned, updatedAt: Date.now() } : n
      )
    }))
    get().save()
  },

  // UI-only setters — deliberately do NOT persist.
  setEditingId: (id) => set({ editingId: id }),
  setFilter: (q) => set({ filter: q }),

  getCapWarning: () => {
    const { notes } = get()
    let bytes = 0
    for (const n of notes) bytes += n.body.length + n.title.length + 200
    return {
      tooMany: notes.length > SOFT_MAX_NOTES,
      tooLarge: bytes > SOFT_MAX_TOTAL_BYTES
    }
  }
}))
