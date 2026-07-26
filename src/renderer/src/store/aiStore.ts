import { create } from 'zustand'
import * as monaco from 'monaco-editor'
import { editorRegistry } from '../utils/editorRegistry'
import { useEditorStore } from './editorStore'
import { useConfigStore } from './configStore'
import { useUIStore } from './uiStore'
import { buildDocContext, contextHeader, ContextMode, DocContext } from '../utils/aiContext'

/**
 * AI assistant conversation state.
 *
 * Transcripts are held **in memory only**, keyed by buffer id, and are gone when
 * the app quits. They contain excerpts of the user's documents, so persisting
 * them would put plaintext file content in a second on-disk location that the
 * existing backup/cleanup logic knows nothing about.
 */

export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: ChatRole
  /** Rendered as Markdown for the assistant, plain text for the user. */
  text: string
  /** Non-fatal context notes (truncation, large-file fallbacks) shown under the bubble. */
  notice?: string | null
  /** Context chip text captured at send time, so the transcript stays honest. */
  contextLabel?: string | null
  error?: string | null
  /** True while tokens are still arriving for this message. */
  streaming?: boolean
  /** Present on assistant messages that produced a proposed edit. */
  editId?: string
}

/** A proposed document rewrite awaiting the user's approval. Never auto-applied. */
export interface PendingEdit {
  id: string
  bufferId: string
  range: monaco.IRange
  oldText: string
  newText: string
  explanation: string
  language: string
  /** Alt version id of the model when the edit was proposed, for staleness checks. */
  baseVersionId: number
}

export type SendMode = 'chat' | 'edit' | 'find'

/** Shared empty transcript — see the comment on messagesFor. */
const NO_MESSAGES: ChatMessage[] = []

interface AiState {
  panelOpen: boolean
  /** bufferId -> transcript */
  conversations: Record<string, ChatMessage[]>
  /** In-flight request, if any. Only one turn at a time per window. */
  active: { requestId: string; bufferId: string; messageId: string } | null
  /** editId -> proposal */
  pendingEdits: Record<string, PendingEdit>
  /** Context override chosen in the panel for the next send; null = use the config default. */
  contextOverride: ContextMode | null

  openPanel: () => void
  closePanel: () => void
  togglePanel: () => void
  setContextOverride: (m: ContextMode | null) => void
  messagesFor: (bufferId: string | null) => ChatMessage[]
  clearConversation: (bufferId: string) => void

  send: (prompt: string, mode: SendMode) => Promise<void>
  cancel: () => Promise<void>

  /** Stream event sinks, wired once in App.tsx. */
  onChunk: (requestId: string, text: string) => void
  onDone: (requestId: string, info: { canceled?: boolean; truncated?: boolean }) => void
  onError: (requestId: string, error: string) => void

  applyEdit: (editId: string) => void
  discardEdit: (editId: string) => void
  openEditInNewTab: (editId: string) => void
}

let seq = 0
const nextId = (): string => `ai-${Date.now().toString(36)}-${(seq++).toString(36)}`

/** Model output for structured modes arrives as one JSON blob. */
interface EditPayload {
  explanation?: string
  newText?: string
}
interface FindPayload {
  explanation?: string
  find?: string
  replace?: string
  isRegex?: boolean
}

export const useAiStore = create<AiState>((set, get) => ({
  panelOpen: false,
  conversations: {},
  active: null,
  pendingEdits: {},
  contextOverride: null,

  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setContextOverride: (m) => set({ contextOverride: m }),

  // Returns the shared NO_MESSAGES constant when empty, never a fresh []. Callers
  // may use this inside a selector, where a new reference every read would loop.
  messagesFor: (bufferId) => (bufferId ? get().conversations[bufferId] ?? NO_MESSAGES : NO_MESSAGES),

  clearConversation: (bufferId) =>
    set((s) => {
      const next = { ...s.conversations }
      delete next[bufferId]
      return { conversations: next }
    }),

  send: async (prompt, mode) => {
    const cfg = useConfigStore.getState()
    const bufferId = useEditorStore.getState().activeId
    if (!bufferId) return
    if (get().active) return // one turn at a time

    const ctx: DocContext = buildDocContext(get().contextOverride ?? undefined)

    // Edit mode needs a concrete range to write back into.
    if (mode === 'edit' && (!ctx.range || ctx.resolved === 'none')) {
      const failure: ChatMessage = {
        id: nextId(),
        role: 'assistant',
        text: '',
        error:
          ctx.notice ??
          'This action needs document text to work on, but no context is available. Check the context selector.'
      }
      set((s) => ({
        conversations: {
          ...s.conversations,
          [bufferId]: [...(s.conversations[bufferId] ?? []), failure]
        }
      }))
      return
    }

    const userMsg: ChatMessage = {
      id: nextId(),
      role: 'user',
      text: prompt,
      contextLabel: ctx.resolved === 'none' ? null : ctx.label,
      notice: ctx.notice
    }
    const assistantMsg: ChatMessage = {
      id: nextId(),
      role: 'assistant',
      text: '',
      streaming: true
    }

    // Prior turns for continuity. Errored/empty turns are dropped so we don't
    // teach the model that blank replies are acceptable.
    const history = (get().conversations[bufferId] ?? [])
      .filter((m) => !m.error && m.text.trim())
      .map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('model' as const), text: m.text }))

    set((s) => ({
      conversations: {
        ...s.conversations,
        [bufferId]: [...(s.conversations[bufferId] ?? []), userMsg, assistantMsg]
      }
    }))

    const res = await window.api.ai.send(cfg.aiProvider, {
      mode,
      model: cfg.aiModel,
      prompt,
      context: ctx.resolved === 'none' ? null : ctx.text,
      contextLabel: contextHeader(ctx),
      history
    })

    if (!res.requestId) {
      set((s) => ({
        conversations: {
          ...s.conversations,
          [bufferId]: (s.conversations[bufferId] ?? []).map((m) =>
            m.id === assistantMsg.id
              ? { ...m, streaming: false, error: res.error ?? 'The request could not be started.' }
              : m
          )
        }
      }))
      return
    }

    // Stash what the reply has to be interpreted against when it lands.
    pendingMeta.set(res.requestId, { mode, ctx, bufferId })
    set({ active: { requestId: res.requestId, bufferId, messageId: assistantMsg.id } })
  },

  cancel: async () => {
    const active = get().active
    if (!active) return
    await window.api.ai.cancel(active.requestId)
  },

  onChunk: (requestId, text) => {
    const active = get().active
    if (!active || active.requestId !== requestId) return
    set((s) => ({
      conversations: {
        ...s.conversations,
        [active.bufferId]: (s.conversations[active.bufferId] ?? []).map((m) =>
          m.id === active.messageId ? { ...m, text: m.text + text } : m
        )
      }
    }))
  },

  onDone: (requestId, info) => {
    const active = get().active
    if (!active || active.requestId !== requestId) return
    const meta = pendingMeta.get(requestId)
    pendingMeta.delete(requestId)

    const messages = get().conversations[active.bufferId] ?? []
    const msg = messages.find((m) => m.id === active.messageId)
    const raw = msg?.text ?? ''

    let patch: Partial<ChatMessage> = { streaming: false }

    if (info.canceled) {
      patch = { streaming: false, notice: raw ? 'Stopped.' : null, error: raw ? null : 'Stopped before any output.' }
    } else if (!raw.trim()) {
      patch = { streaming: false, error: 'The model returned an empty response.' }
    } else if (info.truncated && meta && meta.mode !== 'chat') {
      // A truncated structured reply is a half-written document. Refuse it
      // outright rather than offering a diff built from incomplete JSON.
      patch = {
        streaming: false,
        text: '',
        error:
          'The model hit its output limit before finishing, so the result is incomplete. ' +
          'Try a smaller selection or a narrower request.'
      }
    } else if (meta && meta.mode === 'edit') {
      patch = interpretEdit(raw, meta, set)
    } else if (meta && meta.mode === 'find') {
      patch = interpretFind(raw)
    } else if (info.truncated) {
      patch = { streaming: false, notice: 'Response was cut off at the model output limit.' }
    }

    set((s) => ({
      active: null,
      conversations: {
        ...s.conversations,
        [active.bufferId]: (s.conversations[active.bufferId] ?? []).map((m) =>
          m.id === active.messageId ? { ...m, ...patch } : m
        )
      }
    }))
  },

  onError: (requestId, error) => {
    const active = get().active
    if (!active || active.requestId !== requestId) return
    pendingMeta.delete(requestId)
    set((s) => ({
      active: null,
      conversations: {
        ...s.conversations,
        [active.bufferId]: (s.conversations[active.bufferId] ?? []).map((m) =>
          // Keep whatever streamed in before the failure; it is often the useful part.
          m.id === active.messageId ? { ...m, streaming: false, error } : m
        )
      }
    }))
  },

  applyEdit: (editId) => {
    const edit = get().pendingEdits[editId]
    if (!edit) return
    const editor = editorRegistry.get()
    const model = editor?.getModel()
    const activeId = useEditorStore.getState().activeId

    if (!editor || !model || activeId !== edit.bufferId) {
      useUIStore.getState().addToast('Switch back to that file before applying the change.', 'warn')
      return
    }
    // Refuse to clobber edits the user made while the request was in flight —
    // the proposed text was computed against a document that no longer exists.
    if (model.getAlternativeVersionId() !== edit.baseVersionId) {
      useUIStore
        .getState()
        .addToast('The document changed since this was generated. Re-run the request.', 'warn')
      get().discardEdit(editId)
      return
    }

    // Single executeEdits call => a single Ctrl+Z reverts it, and the
    // alt-version-id dirty tracking in EditorPane picks it up for free.
    editor.executeEdits('ai-edit', [
      { range: edit.range, text: edit.newText, forceMoveMarkers: true }
    ])
    editor.pushUndoStop()
    get().discardEdit(editId)
    useUIStore.getState().addToast('Change applied. Ctrl+Z undoes it.', 'info')
  },

  discardEdit: (editId) =>
    set((s) => {
      const next = { ...s.pendingEdits }
      delete next[editId]
      return { pendingEdits: next }
    }),

  openEditInNewTab: (editId) => {
    const edit = get().pendingEdits[editId]
    if (!edit) return
    const buffer = useEditorStore.getState().getBuffer(edit.bufferId)
    const base = buffer?.title ?? 'untitled'
    useEditorStore.getState().addBuffer({
      filePath: null,
      title: `AI · ${base}`,
      content: edit.newText,
      isDirty: true,
      encoding: buffer?.encoding ?? 'UTF-8',
      hasBom: false,
      eol: buffer?.eol ?? 'LF',
      language: edit.language,
      mtime: 0,
      viewState: null,
      savedViewState: null,
      bookmarks: [],
      loaded: true,
      missing: false,
      isLargeFile: false
    })
    get().discardEdit(editId)
  }
}))

/**
 * Per-request interpretation metadata. Kept outside the store because it is
 * transport bookkeeping, not UI state, and must not trigger re-renders.
 */
const pendingMeta = new Map<string, { mode: SendMode; ctx: DocContext; bufferId: string }>()

type SetState = (fn: (s: AiState) => Partial<AiState>) => void

/** Turn an edit-mode JSON reply into a pending proposal the user can review. */
function interpretEdit(
  raw: string,
  meta: { ctx: DocContext; bufferId: string },
  set: SetState
): Partial<ChatMessage> {
  let payload: EditPayload
  try {
    payload = JSON.parse(raw) as EditPayload
  } catch {
    return {
      streaming: false,
      error: 'The model did not return a usable result for this action. Try rephrasing.'
    }
  }
  if (typeof payload.newText !== 'string') {
    return { streaming: false, error: 'The model returned no replacement text.' }
  }

  const explanation = payload.explanation?.trim() || 'Proposed change.'

  if (payload.newText === meta.ctx.text) {
    return { streaming: false, text: explanation, notice: 'No change was needed.' }
  }

  // Capture the model's version now; applyEdit compares against it so a
  // document edited during the request is never silently overwritten.
  const model = editorRegistry.get()?.getModel()
  const editId = nextId()
  const edit: PendingEdit = {
    id: editId,
    bufferId: meta.bufferId,
    range: meta.ctx.range!,
    oldText: meta.ctx.text,
    newText: payload.newText,
    explanation,
    language: meta.ctx.language,
    baseVersionId: model?.getAlternativeVersionId() ?? -1
  }
  set((s) => ({ pendingEdits: { ...s.pendingEdits, [editId]: edit } }))

  return {
    streaming: false,
    text: explanation,
    editId,
    notice: meta.ctx.truncated
      ? 'Only the truncated portion was rewritten — review the diff carefully.'
      : null
  }
}

/** Turn a find-mode JSON reply into a Find & Replace hand-off. */
function interpretFind(raw: string): Partial<ChatMessage> {
  let payload: FindPayload
  try {
    payload = JSON.parse(raw) as FindPayload
  } catch {
    return { streaming: false, error: 'The model did not return a usable pattern.' }
  }
  if (!payload.find) return { streaming: false, error: 'The model returned no search pattern.' }

  const lines = [
    payload.explanation?.trim() || 'Generated pattern.',
    '',
    `**Find** ${payload.isRegex ? '(regex)' : '(literal)'}:`,
    '```',
    payload.find,
    '```'
  ]
  if (typeof payload.replace === 'string') {
    lines.push('**Replace with:**', '```', payload.replace, '```')
  }

  // Push it into the existing Find & Replace dialog rather than rewriting the
  // document — far cheaper than round-tripping a large file through the model.
  useUIStore.getState().openFind('replace', payload.find)

  return {
    streaming: false,
    text: lines.join('\n'),
    notice: 'Opened in Find & Replace.'
  }
}
