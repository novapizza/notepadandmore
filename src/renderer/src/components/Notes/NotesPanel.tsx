import { useCallback, useMemo, useRef } from 'react'
import { Plus, Search } from 'lucide-react'
import { toast } from '../ui/sonner'
import {
  displayTitle,
  sortNotes,
  useNotesStore,
  MAX_NOTE_CHARS,
  SOFT_MAX_NOTES,
  type Note
} from '../../store/notesStore'
import { NoteCard } from './NoteCard'

function matches(note: Note, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return displayTitle(note).toLowerCase().includes(q) || note.body.toLowerCase().includes(q)
}

/** A note the user created but never typed into (BR-010) — dropped on blur. */
function isUntouched(note: Note | undefined): boolean {
  return !!note && note.body.trim() === '' && note.title.trim() === ''
}

export function NotesPanel() {
  const notes = useNotesStore((s) => s.notes)
  const filter = useNotesStore((s) => s.filter)
  const editingId = useNotesStore((s) => s.editingId)
  const setFilter = useNotesStore((s) => s.setFilter)
  const setEditingId = useNotesStore((s) => s.setEditingId)

  // The panel is the only place that toasts — the store stays UI-free. The soft
  // caps fire once per session so a user past 500 notes isn't nagged every edit.
  const softCapWarnedRef = useRef(false)

  const visible = useMemo(
    () => sortNotes(notes).filter((n) => matches(n, filter)),
    [notes, filter]
  )

  const handleNew = useCallback(() => {
    const store = useNotesStore.getState()
    const id = store.createNote()
    if (!id) {
      toast.error(`A note cannot exceed ${MAX_NOTE_CHARS.toLocaleString()} characters.`)
      return
    }
    // Clear the filter, or the brand-new empty note would be filtered out of the
    // list the moment it's created and the user would type into nothing.
    if (store.filter) store.setFilter('')
    store.setEditingId(id)

    if (!softCapWarnedRef.current) {
      const cap = useNotesStore.getState().getCapWarning()
      if (cap.tooMany || cap.tooLarge) {
        softCapWarnedRef.current = true
        toast.warning(
          cap.tooMany
            ? `You have over ${SOFT_MAX_NOTES} notes. Notes still work, but the panel gets slow to scan.`
            : 'Your notes file is over 5 MB. Consider moving long notes into real files with Open as Tab.'
        )
      }
    }
  }, [])

  const discardIfEmpty = useCallback((id: string) => {
    const store = useNotesStore.getState()
    const note = store.notes.find((n) => n.id === id)
    if (isUntouched(note)) store.deleteNote(id)
  }, [])

  const handleCollapse = useCallback(
    (id: string) => {
      setEditingId(null)
      discardIfEmpty(id)
    },
    [discardIfEmpty, setEditingId]
  )

  return (
    <div className="flex flex-col h-full overflow-hidden text-foreground" data-testid="notes-panel">
      <div className="flex items-center gap-1.5 px-2 py-1.5 shrink-0 border-b border-border bg-explorer">
        <div className="relative flex-1 min-w-0">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter notes…"
            data-testid="notes-filter"
            className="w-full rounded border border-input bg-background pl-7 pr-2 py-1 text-base outline-none focus:border-primary"
          />
        </div>
        <button
          type="button"
          onClick={handleNew}
          data-testid="notes-new"
          title="New note"
          className="flex items-center gap-1 shrink-0 rounded border border-border px-1.5 py-1 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
        >
          <Plus size={14} />
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto editor-scrollbar p-2 flex flex-col gap-1.5">
        {notes.length === 0 ? (
          <div className="p-3 text-center text-sm text-muted-foreground">
            <div className="text-base text-foreground">No notes yet</div>
            <div className="mt-1.5">
              Notes are scratch text that never becomes a tab. They&apos;re saved as plain,
              unencrypted text in <span className="font-mono">notes.json</span> inside the app&apos;s
              config folder — don&apos;t put passwords or API keys here.
            </div>
          </div>
        ) : visible.length === 0 ? (
          <div className="p-3 text-center text-sm text-muted-foreground">No matching notes</div>
        ) : (
          visible.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              expanded={editingId === note.id}
              onExpand={() => setEditingId(note.id)}
              onCollapse={() => handleCollapse(note.id)}
              onDiscardIfEmpty={() => discardIfEmpty(note.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}
