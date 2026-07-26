import React from 'react'
import { useAiStore } from '../../store/aiStore'
import { cn } from '../../lib/utils'
import { GeminiMark } from './GeminiMark'

/**
 * Floating provider badge at the bottom-right of the editor area — the primary
 * way in and out of the chat panel.
 *
 * Rendered inside the editor's `relative` wrapper in App.tsx rather than fixed to
 * the viewport, so it tracks the editor pane when the sidebar, preview, or split
 * view resize it. Offset far enough from the right edge to clear Monaco's
 * vertical scrollbar.
 *
 * Visibility is the caller's job (App.tsx checks `aiEnabled`, `aiShowBadge`, and
 * that a real file tab is active) so this component stays presentational.
 */
export function AiBadge(): React.ReactElement {
  const panelOpen = useAiStore((s) => s.panelOpen)
  const togglePanel = useAiStore((s) => s.togglePanel)
  const streaming = useAiStore((s) => s.active !== null)

  return (
    <button
      onClick={togglePanel}
      title={panelOpen ? 'Hide AI assistant' : 'Ask Gemini about this document'}
      aria-label="AI assistant"
      aria-pressed={panelOpen}
      data-testid="ai-badge"
      className={cn(
        'absolute bottom-3 right-5 z-20 flex h-9 w-9 items-center justify-center rounded-full',
        'border border-border bg-popover shadow-lg transition-all',
        'cursor-pointer hover:scale-105 hover:border-primary/60',
        panelOpen && 'border-primary/60 ring-1 ring-primary/30',
        streaming && 'animate-pulse'
      )}
    >
      <GeminiMark size={19} />
    </button>
  )
}
