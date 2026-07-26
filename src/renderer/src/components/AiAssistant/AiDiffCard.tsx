import React, { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import { Check, ExternalLink, X } from 'lucide-react'
import { useAiStore } from '../../store/aiStore'
import { cn } from '../../lib/utils'

/**
 * Review gate for a proposed document rewrite.
 *
 * Nothing the model produces reaches the buffer without passing through here.
 * A hallucinated rewrite of a 50k-line file is technically undoable, but seeing
 * it land first is a bad experience — so the diff comes first, always.
 */

/** Cheap line-level tally for the header, so users can gauge scale before reading. */
function countChanges(oldText: string, newText: string): { added: number; removed: number } {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const aCounts = new Map<string, number>()
  for (const line of a) aCounts.set(line, (aCounts.get(line) ?? 0) + 1)
  let added = 0
  for (const line of b) {
    const n = aCounts.get(line) ?? 0
    if (n > 0) aCounts.set(line, n - 1)
    else added++
  }
  let removed = 0
  for (const n of aCounts.values()) removed += n
  return { added, removed }
}

export function AiDiffCard({ editId }: { editId: string }): React.ReactElement | null {
  const edit = useAiStore((s) => s.pendingEdits[editId])
  const applyEdit = useAiStore((s) => s.applyEdit)
  const discardEdit = useAiStore((s) => s.discardEdit)
  const openEditInNewTab = useAiStore((s) => s.openEditInNewTab)

  const hostRef = useRef<HTMLDivElement | null>(null)
  const diffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!hostRef.current || !edit) return

    const original = monaco.editor.createModel(edit.oldText, edit.language)
    const modified = monaco.editor.createModel(edit.newText, edit.language)

    const diff = monaco.editor.createDiffEditor(hostRef.current, {
      readOnly: true,
      originalEditable: false,
      renderSideBySide: false, // inline: the panel is narrow
      automaticLayout: true,
      renderOverviewRuler: false,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      lineNumbers: 'on',
      fontSize: 12,
      folding: false,
      // The panel scrolls; let the diff own only its own vertical scrollbar.
      scrollbar: { alwaysConsumeMouseWheel: false }
    })
    diff.setModel({ original, modified })
    diffRef.current = diff

    return () => {
      diff.dispose()
      original.dispose()
      modified.dispose()
      diffRef.current = null
    }
    // Models are immutable per proposal, so this runs once per editId.
  }, [editId, edit?.language])

  // No theme wiring needed: Monaco themes are global, so this diff already uses
  // whatever applyTheme() set for the main editor. Calling setTheme() here would
  // clobber the app's custom theme.

  if (!edit) return null

  const { added, removed } = countChanges(edit.oldText, edit.newText)

  return (
    <div
      className="ml-6 mt-1 overflow-hidden rounded border border-border bg-secondary/30"
      data-testid="ai-diff-card"
    >
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <span className="text-xs font-medium text-foreground">Proposed change</span>
        <span className="font-mono text-xs text-muted-foreground">
          <span className="text-green-500">+{added}</span>{' '}
          <span className="text-red-500">−{removed}</span>
        </span>
        <button
          className="ml-auto cursor-pointer border-none bg-transparent text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Shrink' : 'Expand'}
        </button>
      </div>

      <div
        ref={hostRef}
        className={cn('w-full', expanded ? 'h-[420px]' : 'h-[180px]')}
        data-testid="ai-diff-editor"
      />

      <div className="flex items-center gap-1.5 border-t border-border px-2 py-1.5">
        <button
          className={cn(
            'flex cursor-pointer items-center gap-1 rounded border-none bg-primary px-2 py-1',
            'text-xs font-medium text-primary-foreground hover:opacity-90'
          )}
          onClick={() => applyEdit(editId)}
          data-testid="ai-apply"
        >
          <Check size={12} /> Apply
        </button>
        <button
          className={cn(
            'flex cursor-pointer items-center gap-1 rounded border border-border bg-transparent',
            'px-2 py-1 text-xs text-foreground hover:bg-secondary'
          )}
          onClick={() => discardEdit(editId)}
          data-testid="ai-discard"
        >
          <X size={12} /> Discard
        </button>
        <button
          className={cn(
            'flex cursor-pointer items-center gap-1 rounded border border-border bg-transparent',
            'px-2 py-1 text-xs text-foreground hover:bg-secondary'
          )}
          onClick={() => openEditInNewTab(editId)}
          title="Put the result in a new untitled tab and leave this file alone"
        >
          <ExternalLink size={12} /> New tab
        </button>
        <span className="ml-auto text-xs text-muted-foreground">Apply is one Ctrl+Z</span>
      </div>
    </div>
  )
}
