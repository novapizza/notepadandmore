import * as monaco from 'monaco-editor'
import { editorRegistry } from './editorRegistry'
import { useEditorStore } from '../store/editorStore'
import { useConfigStore } from '../store/configStore'

/**
 * Assembles the document context that accompanies an AI prompt.
 *
 * Two rules drive the design:
 *  1. Always read from the live Monaco model, never `Buffer.content` — that field
 *     holds the value at load time and goes stale after the first keystroke (the
 *     same reason useFileOps.ts:404 reads `model.getValue()`).
 *  2. The user must be able to see exactly what leaves the machine before they
 *     press Send, hence `label` / `lineCount` / `charCount` on the result. This
 *     text is going to a third-party API.
 */

export type ContextMode = 'auto' | 'selection' | 'document' | 'none'

export interface DocContext {
  /** The text to send. Empty string when mode resolves to 'none'. */
  text: string
  /** The exact model range `text` came from — the apply target for edit mode. */
  range: monaco.IRange | null
  /** What was actually resolved, after 'auto' and large-file rules. */
  resolved: 'selection' | 'document' | 'none'
  /** Human-readable summary for the context chip, e.g. "selection · 412 lines · 18 KB". */
  label: string
  lineCount: number
  charCount: number
  /** True when the text was cut at the configured character cap. */
  truncated: boolean
  /** Set when the requested mode could not be honoured; surfaced in the panel. */
  notice: string | null
  /** Basename + language, sent as metadata. The absolute path is never sent. */
  fileName: string
  language: string
}

const EMPTY: DocContext = {
  text: '',
  range: null,
  resolved: 'none',
  label: 'no document context',
  lineCount: 0,
  charCount: 0,
  truncated: false,
  notice: null,
  fileName: '',
  language: ''
}

function formatBytes(chars: number): string {
  if (chars < 1024) return `${chars} chars`
  if (chars < 1024 * 1024) return `${Math.round(chars / 1024)} KB`
  return `${(chars / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Build the context for the active buffer.
 *
 * @param mode Override for the configured default (`aiDefaultContext`).
 */
export function buildDocContext(mode?: ContextMode): DocContext {
  const cfg = useConfigStore.getState()
  const requested: ContextMode = mode ?? cfg.aiDefaultContext
  if (requested === 'none') return EMPTY

  const buffer = useEditorStore.getState().getActive()
  const editor = editorRegistry.get()
  const model = editor?.getModel()
  if (!buffer || buffer.kind !== 'file' || !editor || !model) return EMPTY

  const fileName = buffer.title
  const language = buffer.language || 'plaintext'
  const selection = editor.getSelection()
  const hasSelection = !!selection && !selection.isEmpty()

  let notice: string | null = null
  let resolved: 'selection' | 'document'

  // Large-file mode disables expensive features; sending 10 MB+ to an API is
  // both slow and costly, so restrict those buffers to explicit selections.
  if (buffer.isLargeFile && requested !== 'selection' && !hasSelection) {
    return {
      ...EMPTY,
      fileName,
      language,
      notice:
        'This file is too large to send in full. Select the part you want the assistant to look at.'
    }
  }
  if (buffer.isLargeFile && requested === 'document') {
    if (!hasSelection) {
      return {
        ...EMPTY,
        fileName,
        language,
        notice:
          'This file is too large to send in full. Select the part you want the assistant to look at.'
      }
    }
    resolved = 'selection'
    notice = 'Large file — sending the selection only.'
  } else if (requested === 'selection') {
    if (!hasSelection) {
      return { ...EMPTY, fileName, language, notice: 'Nothing is selected.' }
    }
    resolved = 'selection'
  } else if (requested === 'document') {
    resolved = 'document'
  } else {
    // 'auto' — mirrors the selection-else-whole-buffer idiom used by the
    // built-in transforms (EditorPane.tsx:265-268).
    resolved = hasSelection ? 'selection' : 'document'
  }

  const range: monaco.IRange =
    resolved === 'selection' && selection ? selection : model.getFullModelRange()

  let text = model.getValueInRange(range)
  const fullLength = text.length
  const cap = Math.max(1000, cfg.aiMaxContextChars)
  let truncated = false
  if (text.length > cap) {
    text = text.slice(0, cap)
    truncated = true
    notice =
      `Only the first ${formatBytes(cap)} of ${formatBytes(fullLength)} was sent ` +
      `(limit set in Settings → AI Assistant).`
  }

  const lineCount = range.endLineNumber - range.startLineNumber + 1
  const label = [
    resolved === 'selection' ? 'selection' : 'whole document',
    `${lineCount.toLocaleString()} line${lineCount === 1 ? '' : 's'}`,
    formatBytes(text.length)
  ].join(' · ')

  return {
    text,
    range,
    resolved,
    label: truncated ? `${label} (truncated)` : label,
    lineCount,
    charCount: text.length,
    truncated,
    notice,
    fileName,
    language
  }
}

/** Descriptive header handed to the model alongside the context block. */
export function contextHeader(ctx: DocContext): string {
  if (ctx.resolved === 'none') return 'document'
  const parts = [ctx.fileName || 'untitled', ctx.language, ctx.resolved]
  if (ctx.truncated) parts.push('truncated')
  return parts.filter(Boolean).join(' · ')
}
