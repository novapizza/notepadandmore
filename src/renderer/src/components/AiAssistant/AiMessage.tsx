import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AlertTriangle, Info, User } from 'lucide-react'
import { cn } from '../../lib/utils'
import { GeminiMark } from './GeminiMark'
import { AiDiffCard } from './AiDiffCard'
import type { ChatMessage } from '../../store/aiStore'

/**
 * One transcript bubble.
 *
 * Assistant replies render through react-markdown **without `rehype-raw`**, so
 * HTML in model output is escaped rather than executed. The document being
 * discussed is untrusted input to the model, which makes its output untrusted
 * too — never route it through `dangerouslySetInnerHTML`.
 */
export function AiMessage({ message }: { message: ChatMessage }): React.ReactElement {
  const isUser = message.role === 'user'

  return (
    <div className="flex flex-col gap-1" data-testid={`ai-message-${message.role}`}>
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          {isUser ? (
            <User size={14} className="text-muted-foreground" />
          ) : (
            <GeminiMark size={14} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          {isUser ? (
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">{message.text}</p>
          ) : (
            <div className="ai-markdown min-w-0 text-sm text-foreground">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
              {message.streaming && (
                <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-primary align-middle" />
              )}
            </div>
          )}

          {/* What was actually sent, recorded at send time. */}
          {isUser && message.contextLabel && (
            <p className="mt-1 font-mono text-xs text-muted-foreground">sent: {message.contextLabel}</p>
          )}
        </div>
      </div>

      {message.notice && (
        <div className="ml-6 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info size={12} className="mt-0.5 shrink-0" />
          <span>{message.notice}</span>
        </div>
      )}

      {message.error && (
        <div
          className={cn(
            'ml-6 flex items-start gap-1.5 rounded border border-destructive/30 bg-destructive/10',
            'px-2 py-1.5 text-xs text-destructive'
          )}
          data-testid="ai-message-error"
        >
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span className="break-words">{message.error}</span>
        </div>
      )}

      {message.editId && <AiDiffCard editId={message.editId} />}
    </div>
  )
}
