import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Eraser, Settings2, Square, X } from 'lucide-react'
import { useAiStore } from '../../store/aiStore'
import { useEditorStore } from '../../store/editorStore'
import { useConfigStore } from '../../store/configStore'
import { useUIStore } from '../../store/uiStore'
import { buildDocContext, ContextMode } from '../../utils/aiContext'
import { editorRegistry } from '../../utils/editorRegistry'
import { cn } from '../../lib/utils'
import { GeminiMark } from './GeminiMark'
import { AiMessage } from './AiMessage'
import { QUICK_ACTIONS } from './quickActions'
import type { ChatMessage } from '../../store/aiStore'

/**
 * Docked chat panel, rendered as a `Panel` in App.tsx's `editor-preview-split`
 * group — the same treatment as the Markdown preview pane, and the same shape as
 * VS Code's assistant panel. Being a real panel rather than a `z-[9000]` overlay
 * is what lets the user keep reading and editing while they chat, so it is
 * deliberately *not* registered in `CLOSE_TOP_OVERLAYS`.
 */

/**
 * Stable empty-transcript reference. Zustand v5 selectors run on every store read
 * and React compares snapshots by identity, so returning a fresh `[]` from the
 * selector below makes the snapshot look changed on every render — an infinite
 * re-render loop that hangs the window. Must be a module-level constant.
 */
const NO_MESSAGES: ChatMessage[] = []

const CONTEXT_OPTIONS: { value: ContextMode; label: string }[] = [
  { value: 'auto', label: 'Auto (selection or file)' },
  { value: 'selection', label: 'Selection only' },
  { value: 'document', label: 'Whole file' },
  { value: 'none', label: 'No document context' }
]

export default function AiChatPanel(): React.ReactElement {
  const activeId = useEditorStore((s) => s.activeId)
  const messages = useAiStore((s) => (activeId ? s.conversations[activeId] ?? NO_MESSAGES : NO_MESSAGES))
  const active = useAiStore((s) => s.active)
  const contextOverride = useAiStore((s) => s.contextOverride)
  const setContextOverride = useAiStore((s) => s.setContextOverride)
  const send = useAiStore((s) => s.send)
  const cancel = useAiStore((s) => s.cancel)
  const closePanel = useAiStore((s) => s.closePanel)
  const clearConversation = useAiStore((s) => s.clearConversation)

  const aiModel = useConfigStore((s) => s.aiModel)
  const aiDefaultContext = useConfigStore((s) => s.aiDefaultContext)

  const [draft, setDraft] = useState('')
  const [keyReady, setKeyReady] = useState<boolean | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const busy = active !== null
  const effectiveMode = contextOverride ?? aiDefaultContext

  // Recompute the context chip whenever the cursor, selection, or document moves,
  // so what the chip claims is always what would actually be sent.
  const [ctxNonce, setCtxNonce] = useState(0)
  useEffect(() => {
    const editor = editorRegistry.get()
    if (!editor) return
    const bump = (): void => setCtxNonce((n) => n + 1)
    const d1 = editor.onDidChangeCursorSelection(bump)
    const d2 = editor.onDidChangeModelContent(bump)
    const d3 = editor.onDidChangeModel(bump)
    return () => {
      d1.dispose()
      d2.dispose()
      d3.dispose()
    }
  }, [])

  const ctx = useMemo(
    () => buildDocContext(effectiveMode),
    // ctxNonce and activeId are the invalidation signals; the builder reads live state.
    [effectiveMode, activeId, ctxNonce]
  )

  // A key may be added or removed in Settings while the panel is open.
  useEffect(() => {
    let alive = true
    const check = async (): Promise<void> => {
      const status = await window.api.ai.status(useConfigStore.getState().aiProvider)
      if (alive) setKeyReady(status.hasKey)
    }
    void check()
    return () => {
      alive = false
    }
  }, [activeId, messages.length])

  // Follow the stream as it grows, but don't fight a user who scrolled up.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = (): void => {
    const prompt = draft.trim()
    if (!prompt || busy) return
    setDraft('')
    void send(prompt, 'chat')
  }

  const runQuickAction = (id: string): void => {
    const action = QUICK_ACTIONS.find((a) => a.id === id)
    if (!action || busy) return
    void send(action.prompt, action.mode)
  }

  const openSettings = (): void => {
    useUIStore.getState().setPendingSettingsCategory('ai')
    useEditorStore.getState().openVirtualTab('settings')
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background" data-testid="ai-chat-panel">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <GeminiMark size={15} />
        <span className="text-xs font-medium text-foreground">Gemini</span>
        <span className="truncate font-mono text-xs text-muted-foreground">{aiModel}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton title="AI settings" onClick={openSettings}>
            <Settings2 size={14} />
          </IconButton>
          <IconButton
            title="Clear this conversation"
            onClick={() => activeId && clearConversation(activeId)}
            disabled={messages.length === 0}
          >
            <Eraser size={14} />
          </IconButton>
          <IconButton title="Close panel" onClick={closePanel} testId="ai-close">
            <X size={14} />
          </IconButton>
        </div>
      </div>

      {/* Transcript */}
      <div ref={scrollRef} className="editor-scrollbar flex-1 overflow-y-auto px-2 py-3">
        {keyReady === false ? (
          <EmptyState
            title="No API key yet"
            body="Add a Gemini API key to start. It is encrypted with your operating system's credential store and never leaves this machine except as the Authorization header on requests you trigger."
            action={{ label: 'Open AI settings', onClick: openSettings }}
          />
        ) : messages.length === 0 ? (
          <EmptyState
            title="Ask about this document"
            body="Summarize it, explain a format, transform it, or generate a regex. Anything that rewrites text shows you a diff before it changes your file."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((m) => (
              <AiMessage key={m.id} message={m} />
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-border p-2">
        {/* Quick actions */}
        <div className="mb-1.5 flex flex-wrap gap-1">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.id}
              title={a.hint}
              disabled={busy}
              onClick={() => runQuickAction(a.id)}
              className={cn(
                'flex items-center gap-1 rounded-full border border-border bg-transparent px-2 py-0.5',
                'text-xs text-muted-foreground transition-colors',
                busy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-secondary hover:text-foreground'
              )}
              data-testid={`ai-quick-${a.id}`}
            >
              <a.icon size={11} />
              {a.label}
            </button>
          ))}
        </div>

        {/* Context chip — states exactly what leaves the machine, before Send. */}
        <div className="mb-1.5 flex items-center gap-1.5 text-xs">
          <select
            value={effectiveMode}
            onChange={(e) => setContextOverride(e.target.value as ContextMode)}
            className="cursor-pointer rounded border border-border bg-input px-1 py-0.5 text-xs text-foreground outline-none focus:border-ring"
            title="What document text is sent with your prompt"
            data-testid="ai-context-mode"
          >
            {CONTEXT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span
            className={cn(
              'truncate font-mono',
              ctx.notice ? 'text-amber-500' : 'text-muted-foreground'
            )}
            title={ctx.notice ?? undefined}
            data-testid="ai-context-chip"
          >
            {ctx.resolved === 'none' ? 'nothing sent' : `sending: ${ctx.label}`}
          </span>
        </div>

        <div className="flex items-end gap-1.5">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a newline. Stop propagation so the
              // editor's global key handlers don't also see it.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
              e.stopPropagation()
            }}
            rows={2}
            placeholder="Ask about this document…"
            className={cn(
              'editor-scrollbar max-h-[160px] min-h-[46px] flex-1 resize-none rounded border border-border',
              'bg-input px-2 py-1.5 text-sm text-foreground outline-none focus:border-ring'
            )}
            data-testid="ai-input"
          />
          {busy ? (
            <button
              onClick={() => void cancel()}
              title="Stop generating"
              className="flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded border border-border bg-transparent text-foreground hover:bg-secondary"
              data-testid="ai-stop"
            >
              <Square size={13} />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!draft.trim()}
              title="Send (Enter)"
              className={cn(
                'flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded border-none bg-primary text-primary-foreground',
                draft.trim() ? 'cursor-pointer hover:opacity-90' : 'cursor-not-allowed opacity-40'
              )}
              data-testid="ai-send"
            >
              <ArrowUp size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function IconButton({
  children,
  title,
  onClick,
  disabled,
  testId
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  disabled?: boolean
  testId?: string
}): React.ReactElement {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        'rounded border-none bg-transparent p-1 text-muted-foreground transition-colors',
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-secondary hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}

function EmptyState({
  title,
  body,
  action
}: {
  title: string
  body: string
  action?: { label: string; onClick: () => void }
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <GeminiMark size={28} />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-[280px] text-xs leading-relaxed text-muted-foreground">{body}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-1 cursor-pointer rounded border border-border bg-transparent px-2 py-1 text-xs text-foreground hover:bg-secondary"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
