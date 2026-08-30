import React, { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { ChevronDown, ChevronUp, Eye, Search, X, FileCode, FileDown } from 'lucide-react'
import {
  DiagramRenderer,
  bootstrapDiagramRenderers,
  watchDarkMode,
  type RendererHandle,
} from 'merslim'
import { editorRegistry } from '../../utils/editorRegistry'
import { useUIStore } from '../../store/uiStore'
import { useEditorStore } from '../../store/editorStore'
import { usePreviewFullscreen } from '../preview/previewFullscreen'
import { downloadText, buildStandaloneHtml } from '../../utils/exportDoc'
import { cn } from '../../lib/utils'

// Highlight.js stylesheet — dynamically swapped between light/dark via the
// effect below so code blocks match the rest of the editor theme.
import 'highlight.js/styles/github.css'

// ── Mermaid block: ported from exifmaster-pro's MarkdownPreview, trimmed to
//    the essentials (no zoom modal / export toolbar for v1). merslim's
//    <DiagramRenderer/> handles parsing + rendering; we just remount it when
//    dark mode flips so the palette updates.
const MermaidBlock = React.memo(function MermaidBlock({ code }: { code: string }) {
  const [error, setError] = useState('')
  const [themeNonce, setThemeNonce] = useState(0)
  const handleRef = useRef<RendererHandle | null>(null)
  useEffect(() => watchDarkMode(() => setThemeNonce((n) => n + 1)), [])

  if (error) {
    return (
      <div className="my-3 p-2 bg-destructive/10 border border-destructive/30 rounded text-destructive text-xs font-mono">
        Diagram error: {error}
      </div>
    )
  }
  return (
    <div className="my-3 flex justify-center overflow-x-auto rounded p-2">
      <React.Fragment key={themeNonce}>
        <DiagramRenderer source={code} handleRef={handleRef} onError={(msg) => setError(msg)} />
      </React.Fragment>
    </div>
  )
})

// Stable components prop — referential equality matters here to avoid
// remounting every MermaidBlock on each keystroke.
const MARKDOWN_COMPONENTS = {
  code({ className, children }: { className?: string; children?: React.ReactNode }) {
    const lang = /language-(\w+)/.exec(className || '')?.[1]
    const code = String(children).replace(/\n$/, '')
    if (lang === 'mermaid') return <MermaidBlock code={code} />
    return <code className={className}>{children}</code>
  },
}
const REMARK_PLUGINS = [remarkGfm]

// ── In-preview search ────────────────────────────────────────────────────────
// Highlighting uses the CSS Custom Highlight API (Chromium 105+, so always
// present in our Electron): matches are painted from Range objects without
// touching the DOM ReactMarkdown owns, which would otherwise be clobbered on
// the next keystroke re-render.
const SEARCH_HL = 'md-preview-search'
const SEARCH_HL_ACTIVE = 'md-preview-search-active'

type HighlightRegistryLike = { set: (k: string, v: unknown) => void; delete: (k: string) => void }
const highlightRegistry = (): HighlightRegistryLike | null =>
  typeof CSS !== 'undefined' && 'highlights' in CSS
    ? ((CSS as unknown as { highlights: HighlightRegistryLike }).highlights)
    : null
const HighlightCtor = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight

/** Case-insensitive plain-text matches across the preview's text nodes. */
function collectMatchRanges(root: HTMLElement, needle: string): Range[] {
  const ranges: Range[] = []
  const lower = needle.toLowerCase()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const hay = (node.textContent ?? '').toLowerCase()
    let idx = hay.indexOf(lower)
    while (idx !== -1) {
      const r = new Range()
      r.setStart(node, idx)
      r.setEnd(node, idx + needle.length)
      ranges.push(r)
      idx = hay.indexOf(lower, idx + needle.length)
    }
  }
  return ranges
}
const REHYPE_PLUGINS: [typeof rehypeHighlight, { detect: boolean; ignoreMissing: boolean }][] = [
  [rehypeHighlight, { detect: true, ignoreMissing: true }],
]

/**
 * Live Markdown preview pane. Subscribes to Monaco's active model so the
 * preview tracks every keystroke; re-binds when the user switches tabs.
 */
export const MarkdownPreviewPane: React.FC = () => {
  const [content, setContent] = useState('')
  const setMarkdownPreview = useUIStore((s) => s.setMarkdownPreview)
  const { sectionClass, Toggle: FullscreenToggle } = usePreviewFullscreen()
  const bodyRef = useRef<HTMLDivElement>(null)
  const title = useEditorStore((s) => {
    const buf = s.buffers.find((b) => b.id === s.activeId)
    return buf?.title ?? 'document.md'
  })

  useEffect(() => {
    bootstrapDiagramRenderers()
  }, [])

  // ── Search state ──
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [activeIdx, setActiveIdx] = useState(0)
  const rangesRef = useRef<Range[]>([])
  const searchInputRef = useRef<HTMLInputElement>(null)

  const openSearch = () => {
    setSearchOpen(true)
    // Already open → just refocus (Ctrl+F pressed again).
    setTimeout(() => searchInputRef.current?.select(), 0)
  }
  const closeSearch = () => {
    setSearchOpen(false)
    setQuery('')
  }

  // Ctrl+F is routed here by the `search.find` command when the preview owns
  // focus (or is fullscreen) — see commands/definitions.ts.
  useEffect(() => {
    const onFind = (): void => openSearch()
    window.addEventListener('md-preview:find', onFind)
    return () => window.removeEventListener('md-preview:find', onFind)
  }, [])

  // Recompute matches whenever the query or the rendered document changes.
  // Runs post-commit, so bodyRef holds the DOM for the current `content`.
  useEffect(() => {
    const registry = highlightRegistry()
    const clear = (): void => {
      registry?.delete(SEARCH_HL)
      registry?.delete(SEARCH_HL_ACTIVE)
    }
    if (!searchOpen || !query || !bodyRef.current) {
      rangesRef.current = []
      setMatchCount(0)
      clear()
      return
    }
    const ranges = collectMatchRanges(bodyRef.current, query)
    rangesRef.current = ranges
    setMatchCount(ranges.length)
    setActiveIdx((i) => Math.min(i, Math.max(0, ranges.length - 1)))
    if (registry && HighlightCtor && ranges.length > 0) {
      registry.set(SEARCH_HL, new HighlightCtor(...ranges))
    } else {
      registry?.delete(SEARCH_HL)
    }
    return clear
  }, [searchOpen, query, content])

  // Paint + reveal the active match.
  useEffect(() => {
    const registry = highlightRegistry()
    const range = rangesRef.current[activeIdx]
    if (!range) {
      registry?.delete(SEARCH_HL_ACTIVE)
      return
    }
    if (registry && HighlightCtor) registry.set(SEARCH_HL_ACTIVE, new HighlightCtor(range))
    range.startContainer.parentElement?.scrollIntoView({ block: 'center' })
  }, [activeIdx, matchCount, query, searchOpen])

  const gotoMatch = (dir: 1 | -1): void => {
    const n = rangesRef.current.length
    if (n === 0) return
    setActiveIdx((i) => (i + dir + n) % n)
  }

  const searchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      gotoMatch(e.shiftKey ? -1 : 1)
    } else if (e.key === 'Escape') {
      // Don't let Escape fall through to the fullscreen-exit listener.
      e.preventDefault()
      e.stopPropagation()
      closeSearch()
    }
  }

  // Export the rendered preview. innerHTML is markup produced by our own
  // ReactMarkdown render, wrapped in a self-contained, styled document.
  const baseName = title.replace(/\.[^.]+$/, '') || 'document'
  const renderedHtml = () => buildStandaloneHtml(title, bodyRef.current?.innerHTML ?? '')
  const exportHtml = () =>
    downloadText(`${baseName}.html`, renderedHtml(), 'text/html;charset=utf-8')
  const exportPdf = async () => {
    const res = await window.api.print.toPdf(renderedHtml(), `${baseName}.pdf`)
    if (res?.error) useUIStore.getState().addToast(`PDF export failed: ${res.error}`, 'error')
    else if (!res?.canceled) useUIStore.getState().addToast('Saved PDF.', 'info')
  }

  // Read the editor's current model + watch content changes. Re-runs when the
  // editor instance changes (rare) or when the active model changes (every
  // tab switch). monaco emits onDidChangeModelContent on the model, not the
  // editor, so we also have to re-subscribe whenever the model changes.
  useEffect(() => {
    const editor = editorRegistry.get()
    if (!editor) return

    let modelDisposer: monaco.IDisposable | null = null
    const attach = (model: monaco.editor.ITextModel | null) => {
      modelDisposer?.dispose()
      modelDisposer = null
      if (!model) { setContent(''); return }
      setContent(model.getValue())
      modelDisposer = model.onDidChangeContent(() => setContent(model.getValue()))
    }

    attach(editor.getModel())
    const modelChange = editor.onDidChangeModel(() => attach(editor.getModel()))

    return () => {
      modelChange.dispose()
      modelDisposer?.dispose()
    }
  }, [])

  return (
    <section className={sectionClass} data-md-preview>
      <header className="px-3 py-2 border-b border-border flex items-center gap-2 bg-secondary/30">
        <Eye size={14} className="text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Markdown Preview
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => (searchOpen ? closeSearch() : openSearch())}
            aria-label="Search in preview"
            aria-pressed={searchOpen}
            title="Search in preview (Ctrl+F while the preview is focused)"
            className={cn(
              'p-1 rounded hover:bg-secondary transition-colors',
              searchOpen ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Search size={14} />
          </button>
          <button
            onClick={exportHtml}
            aria-label="Export as HTML"
            title="Export as HTML"
            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          >
            <FileCode size={14} />
          </button>
          <button
            onClick={exportPdf}
            aria-label="Export as PDF"
            title="Export as PDF"
            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          >
            <FileDown size={14} />
          </button>
          {FullscreenToggle}
          <button
            onClick={() => setMarkdownPreview(false)}
            aria-label="Close preview"
            title="Close preview (Ctrl+Alt+Shift+M)"
            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </header>
      {searchOpen && (
        <div className="px-3 py-1.5 border-b border-border flex items-center gap-2 bg-secondary/20">
          <Search size={13} className="text-muted-foreground shrink-0" />
          <input
            ref={searchInputRef}
            className="flex-1 min-w-0 bg-input border border-border rounded px-2 py-0.5 text-sm text-foreground outline-none focus:border-ring"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIdx(0)
            }}
            onKeyDown={searchKeyDown}
            placeholder="Search in preview…"
            autoFocus
            spellCheck={false}
            data-testid="md-preview-search-input"
          />
          <span className="text-xs text-muted-foreground tabular-nums shrink-0" data-testid="md-preview-search-count">
            {matchCount > 0 ? `${activeIdx + 1}/${matchCount}` : query ? 'No results' : ''}
          </span>
          <button
            onClick={() => gotoMatch(-1)}
            disabled={matchCount === 0}
            aria-label="Previous match"
            title="Previous match (Shift+Enter)"
            className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
          >
            <ChevronUp size={14} />
          </button>
          <button
            onClick={() => gotoMatch(1)}
            disabled={matchCount === 0}
            aria-label="Next match"
            title="Next match (Enter)"
            className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
          >
            <ChevronDown size={14} />
          </button>
          <button
            onClick={closeSearch}
            aria-label="Close search"
            title="Close search (Esc)"
            className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {/* tabIndex — clicking the body must focus it so Ctrl+F routes here. */}
      <div ref={bodyRef} tabIndex={-1} className="flex-1 overflow-auto p-4 markdown-body outline-none">
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          components={MARKDOWN_COMPONENTS}
        >
          {content}
        </ReactMarkdown>
      </div>
    </section>
  )
}
