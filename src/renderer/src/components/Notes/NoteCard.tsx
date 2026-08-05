import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MoreHorizontal, Pin, PinOff, Trash2, TextCursorInput, ExternalLink, Check } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import { cn } from '../../lib/utils'
import { editorRegistry } from '../../utils/editorRegistry'
import { useEditorStore } from '../../store/editorStore'
import { useConfigStore } from '../../store/configStore'
import { displayTitle, useNotesStore, type Note } from '../../store/notesStore'
import { NOTE_BG, NOTE_SWATCHES } from './noteColors'

/** Expanded textarea grows with its content up to this share of the viewport,
 *  then scrolls internally rather than pushing the list off-screen. */
const MAX_TEXTAREA_VH = 40

/** Body text past the first non-empty line — what the collapsed card previews
 *  under the derived title. Empty when the note is a single line. */
function bodyAfterFirstLine(body: string): string {
  const lines = body.split('\n')
  const firstContent = lines.findIndex((l) => l.trim().length > 0)
  if (firstContent === -1) return ''
  return lines.slice(firstContent + 1).join('\n').trim()
}

interface NoteCardProps {
  note: Note
  expanded: boolean
  onExpand: () => void
  onCollapse: () => void
  /** Called on blur when the note is still completely untouched (BR-010). */
  onDiscardIfEmpty: () => void
}

export function NoteCard({ note, expanded, onExpand, onCollapse, onDiscardIfEmpty }: NoteCardProps) {
  const { updateNote, deleteNote, togglePin } = useNotesStore()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  // While the overflow menu is open, a click anywhere on the card is the user
  // dismissing the menu — not a request to expand the note.
  const [menuOpen, setMenuOpen] = useState(false)

  // Insert at Cursor needs a real, writable file buffer behind the editor.
  const activeId = useEditorStore((s) => s.activeId)
  const buffers = useEditorStore((s) => s.buffers)
  const activeBuffer = buffers.find((b) => b.id === activeId)
  const canInsert = !!activeBuffer && activeBuffer.kind === 'file' && !activeBuffer.isReadOnly

  const title = displayTitle(note)

  // Grow to fit, capped. Runs before paint so there's no visible jump.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!expanded || !el) return
    el.style.height = 'auto'
    const cap = window.innerHeight * (MAX_TEXTAREA_VH / 100)
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`
  }, [expanded, note.body])

  // Focus the body as soon as the card expands, so `+ New` and
  // "Send Selection to Note" both land the caret in the text (US-006).
  useEffect(() => {
    if (!expanded) return
    const el = textareaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [expanded])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        // stopPropagation so Esc collapses the note only — it must not reach the
        // app-level handlers that close Find & Replace / Quick Open / overlays.
        e.preventDefault()
        e.stopPropagation()
        onCollapse()
        return
      }
      if (e.key === 'Tab') {
        // A note body is plain text; a literal tab is more useful here than
        // moving focus out of the textarea (US-007).
        e.preventDefault()
        const el = e.currentTarget
        const start = el.selectionStart
        const end = el.selectionEnd
        const next = `${el.value.slice(0, start)}\t${el.value.slice(end)}`
        updateNote(note.id, { body: next })
        // Restore the caret after React re-renders the controlled value.
        requestAnimationFrame(() => {
          if (textareaRef.current) textareaRef.current.setSelectionRange(start + 1, start + 1)
        })
      }
    },
    [note.id, onCollapse, updateNote]
  )

  const handleDelete = useCallback(async () => {
    // Native dialog only — window.confirm() freezes the renderer's message loop
    // and leaves Monaco permanently unresponsive (BR-006).
    const ok = await window.api.dialog.confirm('Delete this note?', title, 'Delete')
    if (ok) deleteNote(note.id)
  }, [deleteNote, note.id, title])

  /** Insert the body over the current selection — an empty selection is a
   *  zero-width range, so "insert at cursor" and "replace selection" are one
   *  code path. A single executeEdits call is a single undo step (US-010).
   *
   *  pushUndoStop() first: without it Monaco appends the insert to whatever
   *  undo element is still open, so one Ctrl+Z would revert the insert AND the
   *  text the user had just been typing. */
  const handleInsertAtCursor = useCallback(() => {
    const editor = editorRegistry.get()
    if (!editor) return
    const sel = editor.getSelection()
    if (!sel) return
    editor.pushUndoStop()
    editor.executeEdits('notes-insert', [{ range: sel, text: note.body, forceMoveMarkers: true }])
    editor.pushUndoStop()
    editor.focus()
  }, [note.body])

  /** Graduate the note into an ordinary untitled buffer. The note is retained —
   *  the tab is a snapshot and the two diverge from here by design. */
  const handleOpenAsTab = useCallback(() => {
    const id = useEditorStore.getState().addBuffer({
      filePath: null,
      title,
      content: note.body,
      isDirty: true,
      encoding: 'UTF-8',
      hasBom: false,
      eol: useConfigStore.getState().defaultEol,
      language: note.language,
      mtime: 0,
      viewState: null,
      savedViewState: null,
      bookmarks: [],
      loaded: true,
      missing: false,
      isLargeFile: false
    })
    useEditorStore.getState().setActive(id)
  }, [note.body, note.language, title])

  const overflowMenu = (
    // onOpenChange feeds the menuOpen guard on the collapsed card's onClick.
    // Without it, the click that dismisses this menu falls through to the card
    // and re-expands the note every time the user picks Pin, a colour, or
    // cancels a Delete — stopPropagation on the trigger doesn't cover it,
    // because the fall-through click's target is the card itself.
    <DropdownMenu onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Note actions"
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[170px]">
        <DropdownMenuItem onSelect={() => togglePin(note.id)}>
          {note.pinned ? <PinOff size={14} className="mr-2" /> : <Pin size={14} className="mr-2" />}
          {note.pinned ? 'Unpin' : 'Pin to top'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Colour</DropdownMenuLabel>
        {NOTE_SWATCHES.map((s) => (
          <DropdownMenuItem key={s.color} onSelect={() => updateNote(note.id, { color: s.color })}>
            <span className={cn('mr-2 w-3.5 h-3.5 rounded-sm border border-border shrink-0', s.swatchClass)} />
            <span className="flex-1">{s.label}</span>
            {note.color === s.color && <Check size={14} className="ml-2 shrink-0" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void handleDelete()} className="text-destructive focus:text-destructive">
          <Trash2 size={14} className="mr-2" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  if (!expanded) {
    // The title already shows the first non-empty body line, so the preview is
    // everything after it — repeating the title line would just be noise, and a
    // one-line note gets no preview at all.
    const preview = bodyAfterFirstLine(note.body)
    return (
      <div
        data-testid="note-card"
        className={cn(
          'group rounded border border-border px-2 py-1.5 cursor-pointer transition-colors',
          'hover:border-primary/60',
          NOTE_BG[note.color]
        )}
        onClick={() => { if (!menuOpen) onExpand() }}
      >
        <div className="flex items-center gap-1">
          {note.pinned && <Pin size={12} className="shrink-0 text-muted-foreground" />}
          <span className="flex-1 truncate text-base font-medium text-foreground">{title}</span>
          {overflowMenu}
        </div>
        {preview && (
          <div className="mt-0.5 text-sm text-muted-foreground line-clamp-2 whitespace-pre-wrap break-words">
            {preview}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      data-testid="note-card"
      className={cn('rounded border border-primary/70 px-2 py-1.5', NOTE_BG[note.color])}
    >
      <div className="flex items-center gap-1">
        {note.pinned && <Pin size={12} className="shrink-0 text-muted-foreground" />}
        <span className="flex-1 truncate text-base font-medium text-foreground">{title}</span>
        {overflowMenu}
      </div>

      <textarea
        ref={textareaRef}
        data-testid="note-body"
        value={note.body}
        spellCheck={false}
        placeholder="Type a note…"
        // The store debounces the write; the controlled value itself is never
        // debounced or typing would feel laggy.
        onChange={(e) => updateNote(note.id, { body: e.target.value })}
        onKeyDown={handleKeyDown}
        onBlur={onDiscardIfEmpty}
        className="mt-1 w-full resize-none bg-transparent text-base leading-relaxed text-foreground outline-none editor-scrollbar font-mono"
      />

      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          disabled={!canInsert}
          onClick={handleInsertAtCursor}
          title={canInsert ? 'Insert this note at the cursor' : 'No editable file is open'}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:pointer-events-none transition-colors"
        >
          <TextCursorInput size={14} />
          Insert at Cursor
        </button>
        <button
          type="button"
          onClick={handleOpenAsTab}
          title="Open this note as a new untitled tab"
          className="flex items-center gap-1 rounded px-1.5 py-1 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
        >
          <ExternalLink size={14} />
          Open as Tab
        </button>
        <button
          type="button"
          onClick={onCollapse}
          className="ml-auto rounded px-1.5 py-1 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  )
}
