import React, { useEffect, useRef, useState } from 'react'
import { useUIStore } from '../../../store/uiStore'
import { useSearchStore, SearchMode } from '../../../store/searchStore'
import { useSearchEngine } from '../../../hooks/useSearchEngine'
import { useAltHeld } from '../../../hooks/useAltHeld'
import { useAltMnemonics, MnemonicHandlers } from '../../../hooks/useAltMnemonics'
import { MnemonicLabel } from '../../../utils/mnemonic'
import { isWindows } from '../../../utils/platform'
import { editorRegistry } from '../../../utils/editorRegistry'
import { cn } from '../../../lib/utils'

type DialogTab = 'find' | 'replace' | 'findInFiles' | 'mark'

const MARK_COLORS_CSS = ['#FF8000', '#00C864', '#0080FF', '#DC00DC', '#FFDC00']

/** Status messages quote the search pattern; a pasted multi-hundred-character
 *  pattern would otherwise blow the dialog layout apart. */
const shortPattern = (p: string): string => (p.length > 60 ? `${p.slice(0, 60)}…` : p)

// ─── History dropdown ────────────────────────────────────────────────────────
interface HistoryDropdownProps {
  items: string[]
  onSelect: (v: string) => void
  onClose: () => void
}
function HistoryDropdown({ items, onSelect, onClose }: HistoryDropdownProps) {
  if (items.length === 0) return null
  return (
    <div className="absolute top-full left-0 right-0 mt-0.5 bg-popover border border-border rounded shadow-lg z-50 max-h-40 overflow-y-auto editor-scrollbar">
      {items.map((item, i) => (
        <div
          key={i}
          className="px-2 py-1 text-sm text-foreground hover:bg-secondary cursor-pointer truncate"
          onMouseDown={(e) => { e.preventDefault(); onSelect(item); onClose() }}
          title={item}
        >
          {item}
        </div>
      ))}
    </div>
  )
}

// ─── Search input with history ───────────────────────────────────────────────
interface SearchInputProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  history: string[]
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  autoFocus?: boolean
  inputRef?: React.RefObject<HTMLInputElement>
}
function SearchInput({ value, onChange, placeholder, history, onKeyDown, autoFocus, inputRef }: SearchInputProps) {
  const [showHistory, setShowHistory] = useState(false)

  return (
    <div className="relative flex-1">
      <input
        ref={inputRef}
        className="w-full bg-input border border-border rounded px-2 py-1 text-sm text-foreground outline-none focus:border-ring pr-6"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        onFocus={() => history.length > 0 && setShowHistory(false)}
        spellCheck={false}
      />
      <button
        className="absolute right-1 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-muted-foreground text-sm hover:text-foreground"
        tabIndex={-1}
        onMouseDown={(e) => { e.preventDefault(); setShowHistory((v) => !v) }}
        title="Recent searches"
      >
        ▾
      </button>
      {showHistory && (
        <HistoryDropdown
          items={history}
          onSelect={onChange}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  )
}

// ─── Shared options panel ─────────────────────────────────────────────────────
interface SearchOptionsProps {
  showInSelection?: boolean
  altHeld: boolean
}
function SearchOptionsPanel({ showInSelection, altHeld }: SearchOptionsProps) {
  const { options, setOptions } = useSearchStore()
  const modeLabel = (m: SearchMode) =>
    m === 'normal' ? '&Normal' : m === 'extended' ? 'E&xtended (\\n \\t …)' : 'Re&gex'
  return (
    <>
      <div className="flex items-center gap-3 mt-1.5">
        <span className="text-base text-muted-foreground mr-1">Mode:</span>
        {(['normal', 'extended', 'regex'] as SearchMode[]).map((m) => (
          <label key={m} className="flex items-center gap-1 text-base text-foreground cursor-pointer">
            <input
              type="radio"
              name="searchMode"
              value={m}
              checked={options.searchMode === m}
              onChange={() => setOptions({ searchMode: m })}
              className="accent-primary"
            />
            <MnemonicLabel label={modeLabel(m)} show={altHeld} />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-1">
        <label className="flex items-center gap-1 text-base text-foreground cursor-pointer">
          <input type="checkbox" checked={options.isCaseSensitive} onChange={(e) => setOptions({ isCaseSensitive: e.target.checked })} className="accent-primary" />
          <MnemonicLabel label="Match &case" show={altHeld} />
        </label>
        <label className="flex items-center gap-1 text-base text-foreground cursor-pointer">
          <input type="checkbox" checked={options.isWholeWord} onChange={(e) => setOptions({ isWholeWord: e.target.checked })} className="accent-primary" />
          <MnemonicLabel label="&Whole word" show={altHeld} />
        </label>
        <label className="flex items-center gap-1 text-base text-foreground cursor-pointer">
          <input type="checkbox" checked={options.isWrapAround} onChange={(e) => setOptions({ isWrapAround: e.target.checked })} className="accent-primary" />
          <MnemonicLabel label="Wrap a&round" show={altHeld} />
        </label>
        {options.searchMode === 'regex' && (
          <label className="flex items-center gap-1 text-base text-foreground cursor-pointer">
            <input type="checkbox" checked={options.dotMatchesNewline} onChange={(e) => setOptions({ dotMatchesNewline: e.target.checked })} className="accent-primary" />
            . matches newline
          </label>
        )}
        {showInSelection && (
          <label className="flex items-center gap-1 text-base text-foreground cursor-pointer">
            <input type="checkbox" checked={options.inSelection} onChange={(e) => setOptions({ inSelection: e.target.checked })} className="accent-primary" />
            In selection
          </label>
        )}
      </div>
    </>
  )
}

// ─── Main dialog ──────────────────────────────────────────────────────────────
export function FindReplaceDialog() {
  const { showFindReplace, findReplaceMode, closeFind, findInitialTerm, findOpenNonce } = useUIStore()
  const { options, setOptions, patternHistory, replaceHistory, markStyleIndex, setMarkStyleIndex, isSearching, searchProgress, currentSearchId } =
    useSearchStore()
  const engine = useSearchEngine()

  const [activeTab, setActiveTab] = useState<DialogTab>('find')
  // findOpenNonce bumps on every openFind() call, so a shortcut re-asserts its
  // tab even when the user manually switched tabs since the last open.
  useEffect(() => {
    if (showFindReplace) setActiveTab(findReplaceMode as DialogTab)
  }, [showFindReplace, findReplaceMode, findOpenNonce])

  useEffect(() => {
    if (!showFindReplace) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeFind() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showFindReplace, closeFind])

  const [status, setStatus] = useState<{ msg: string; type: 'ok' | 'warn' | 'none' }>({ msg: '', type: 'none' })
  const [fifDir, setFifDir] = useState('')
  const [fifFilter, setFifFilter] = useState('*.*')
  const [fifRecursive, setFifRecursive] = useState(true)
  const findInputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; dialogX: number; dialogY: number } | null>(null)

  // Reset position to centered each time the dialog opens.
  useEffect(() => { if (showFindReplace) setPosition(null) }, [showFindReplace])

  const handleTitleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Allow the close button (and any other interactive control in the title bar) to keep working.
    if ((e.target as HTMLElement).closest('button')) return
    if (e.button !== 0) return
    const rect = dialogRef.current?.getBoundingClientRect()
    if (!rect) return
    e.preventDefault()
    dragStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, dialogX: rect.left, dialogY: rect.top }
    const onMove = (ev: MouseEvent) => {
      const s = dragStartRef.current
      if (!s) return
      const w = dialogRef.current?.offsetWidth ?? 0
      const h = dialogRef.current?.offsetHeight ?? 0
      const x = Math.max(0, Math.min(s.dialogX + (ev.clientX - s.mouseX), window.innerWidth - w))
      const y = Math.max(0, Math.min(s.dialogY + (ev.clientY - s.mouseY), window.innerHeight - h))
      setPosition({ x, y })
    }
    const onUp = () => {
      dragStartRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Prefill from the editor selection and focus the find input on every
  // openFind() call — including shortcuts pressed while the dialog is already
  // open (mode switch with a new selection), hence the findOpenNonce dep.
  useEffect(() => {
    if (!showFindReplace) return
    if (findInitialTerm) setOptions({ pattern: findInitialTerm })
    setTimeout(() => { findInputRef.current?.focus(); findInputRef.current?.select() }, 50)
  }, [showFindReplace, findOpenNonce]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear the vivid current-match decoration when the dialog closes so
  // the editor returns to its normal appearance, and return keyboard focus
  // to the editor. This dialog is hand-rolled (not a Radix dialog), so
  // nothing restores focus automatically: on close the focused control (the
  // ✕ button or an input) unmounts and the browser drops focus to
  // <body>, leaving the editor unable to receive typing or shortcuts until
  // the user clicks it. Refocus in the cleanup — it runs after the dialog's
  // DOM is removed, so the editor keeps focus rather than being overwritten.
  useEffect(() => {
    if (showFindReplace) {
      return () => {
        engine.clearCurrentMatchHighlight()
        editorRegistry.get()?.focus()
      }
    }
  }, [showFindReplace]) // eslint-disable-line react-hooks/exhaustive-deps

  // When the user starts a new search or clears the keyword, the previous
  // "Match X of Y" count is stale — clear it. If the keyword becomes empty,
  // also clear the in-editor highlight so the document looks pristine.
  useEffect(() => {
    setStatus({ msg: '', type: 'none' })
    if (!options.pattern) engine.clearCurrentMatchHighlight()
  }, [options.pattern]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──
  const handleFindNext = () => {
    const { match, current, total } = engine.findNext()
    setStatus(match
      ? { msg: `Match ${current} of ${total}`, type: 'ok' }
      : { msg: `"${shortPattern(options.pattern)}" not found.`, type: 'warn' })
  }
  const handleFindPrev = () => {
    const { match, current, total } = engine.findPrev()
    setStatus(match
      ? { msg: `Match ${current} of ${total}`, type: 'ok' }
      : { msg: `"${shortPattern(options.pattern)}" not found.`, type: 'warn' })
  }
  const handleCount = () => { const n = engine.countAll(); setStatus({ msg: `${n} match${n !== 1 ? 'es' : ''} found.`, type: n > 0 ? 'ok' : 'warn' }) }
  const handleFindAll = () => { engine.findAll(); setStatus({ msg: 'Results shown in Find Results panel.', type: 'ok' }) }
  const handleFindAllOpenDocs = () => { engine.findAllInOpenDocs(); setStatus({ msg: 'Results shown in Find Results panel.', type: 'ok' }) }
  const handleReplaceOne = () => { engine.replaceOne() }
  const handleReplaceAll = () => { const n = engine.replaceAll(); setStatus({ msg: n > 0 ? `Replaced ${n} match${n !== 1 ? 'es' : ''}.` : `"${shortPattern(options.pattern)}" not found.`, type: n > 0 ? 'ok' : 'warn' }) }
  const handleMarkAll = () => { engine.markAll(markStyleIndex) }
  const handleClearMarks = () => { engine.clearMarks(markStyleIndex); setStatus({ msg: 'Marks cleared.', type: 'none' }) }
  const handleClearAllMarks = () => { engine.clearMarks(); setStatus({ msg: 'All marks cleared.', type: 'none' }) }
  const handleBookmark = () => { engine.bookmarkLines() }
  const handleFindInFiles = () => {
    if (!fifDir) { setStatus({ msg: 'Please select a directory.', type: 'warn' }); return }
    engine.findInFilesStreaming(fifDir, fifFilter, fifRecursive)
    setStatus({ msg: 'Searching… results appear in real-time.', type: 'ok' })
  }
  const handleCancelSearch = () => { engine.cancelFindInFiles(); setStatus({ msg: '', type: 'none' }) }
  const handleBrowseDir = async () => { const result = await (window.api as any).file.openDirDialog?.(); if (result) setFifDir(result) }

  // preventDefault is essential: handleFindNext/handleReplaceOne may move
  // focus to Monaco via editor.focus(). Without preventing the default
  // action, Chromium dispatches the Enter keydown's default ("insert
  // newline") against whatever element holds focus when the action fires —
  // which is now Monaco's textarea — and the document gets a stray newline.
  const findInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? handleFindPrev() : handleFindNext() }
  }
  const replaceInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); handleReplaceOne() }
  }

  const altHeld = useAltHeld()

  const tabNames: { id: DialogTab; label: string }[] = [
    { id: 'find', label: '&Find' }, { id: 'replace', label: 'Re&place' },
    { id: 'findInFiles', label: 'Find in F&iles' }, { id: 'mark', label: '&Mark' },
  ]

  const mnemonicHandlers: MnemonicHandlers = (() => {
    const h: MnemonicHandlers = {
      F: () => setActiveTab('find'),
      P: () => setActiveTab('replace'),
      I: () => setActiveTab('findInFiles'),
      M: () => setActiveTab('mark'),
    }
    if (activeTab !== 'findInFiles') {
      h.N = () => setOptions({ searchMode: 'normal' })
      h.X = () => setOptions({ searchMode: 'extended' })
      h.G = () => setOptions({ searchMode: 'regex' })
      h.C = () => setOptions({ isCaseSensitive: !options.isCaseSensitive })
      h.W = () => setOptions({ isWholeWord: !options.isWholeWord })
      h.R = () => setOptions({ isWrapAround: !options.isWrapAround })
    }
    if (activeTab === 'find') {
      h.V = handleFindPrev
      h.U = handleCount
      h.D = handleFindAll
      h.O = handleFindAllOpenDocs
    } else if (activeTab === 'replace') {
      h.E = handleReplaceOne
      h.A = handleReplaceAll
      h.U = handleCount
    } else if (activeTab === 'findInFiles') {
      h.C = () => setOptions({ isCaseSensitive: !options.isCaseSensitive })
      h.W = () => setOptions({ isWholeWord: !options.isWholeWord })
      h.R = () => setFifRecursive(!fifRecursive)
      h.A = handleFindInFiles
      h.B = handleBrowseDir
      h.N = handleCancelSearch
    } else if (activeTab === 'mark') {
      h.K = handleMarkAll
      h.Y = handleClearMarks
      h.A = handleClearAllMarks
    }
    return h
  })()

  useAltMnemonics(
    showFindReplace && isWindows(),
    mnemonicHandlers,
    { allowInsideInputs: true, priority: true },
  )

  if (!showFindReplace) return null

  const btn = "px-3 py-1 text-base border border-border rounded bg-secondary text-foreground cursor-pointer hover:bg-muted transition-colors"
  const btnPrimary = "px-3 py-1 text-base border-none rounded bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90 transition-colors"

  return (
    <div className="fixed inset-0 z-[9000] pointer-events-none">
      <div
        ref={dialogRef}
        className={cn(
          'fixed z-[9001] bg-popover border border-border rounded-lg shadow-2xl min-w-[480px] max-w-[640px] flex flex-col pointer-events-auto',
          position === null && 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
        )}
        style={position ? { left: position.x, top: position.y } : undefined}
      >
        {/* Title bar (drag handle) */}
        <div
          className="flex items-center justify-between px-3 py-2 border-b border-border cursor-move select-none"
          onMouseDown={handleTitleMouseDown}
        >
          <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Find &amp; Replace</span>
          <button className="bg-transparent border-none cursor-pointer text-muted-foreground text-sm w-6 h-6 flex items-center justify-center rounded hover:bg-secondary hover:text-foreground" onClick={closeFind} tabIndex={-1} title="Close (Esc)">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          {tabNames.map((tab) => (
            <button
              key={tab.id}
              className={cn(
                'px-3 py-1.5 text-base font-medium cursor-pointer border-none bg-transparent text-muted-foreground border-b-2 border-transparent -mb-px transition-colors hover:text-foreground hover:bg-secondary',
                activeTab === tab.id && 'text-primary border-b-primary'
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              <MnemonicLabel label={tab.label} show={altHeld} />
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="px-3 py-2.5 flex flex-col gap-1.5">
          {/* ── Find Tab ── */}
          {activeTab === 'find' && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-base text-muted-foreground w-14 shrink-0">Find:</span>
                <SearchInput value={options.pattern} onChange={(v) => setOptions({ pattern: v })} placeholder="Search pattern…" history={patternHistory} onKeyDown={findInputKeyDown} autoFocus inputRef={findInputRef} />
              </div>
              <SearchOptionsPanel showInSelection altHeld={altHeld} />
              <hr className="border-border my-1" />
              <div className="flex gap-1.5 flex-wrap">
                <button className={btnPrimary} onClick={handleFindNext}>Find Next ↓</button>
                <button className={btn} onClick={handleFindPrev}><MnemonicLabel label="Find Pre&v ↑" show={altHeld} /></button>
                <button className={btn} onClick={handleCount}><MnemonicLabel label="Co&unt" show={altHeld} /></button>
                <button className={btn} onClick={handleFindAll}><MnemonicLabel label="Find All (this &doc)" show={altHeld} /></button>
                <button className={btn} onClick={handleFindAllOpenDocs}><MnemonicLabel label="Find All (&open docs)" show={altHeld} /></button>
              </div>
            </>
          )}

          {/* ── Replace Tab ── */}
          {activeTab === 'replace' && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-base text-muted-foreground w-14 shrink-0">Find:</span>
                <SearchInput value={options.pattern} onChange={(v) => setOptions({ pattern: v })} placeholder="Search pattern…" history={patternHistory} onKeyDown={findInputKeyDown} autoFocus inputRef={findInputRef} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-base text-muted-foreground w-14 shrink-0">Replace:</span>
                <SearchInput value={options.replaceText} onChange={(v) => setOptions({ replaceText: v })} placeholder="Replacement text…" history={replaceHistory} onKeyDown={replaceInputKeyDown} />
              </div>
              <SearchOptionsPanel showInSelection altHeld={altHeld} />
              <hr className="border-border my-1" />
              <div className="flex gap-1.5 flex-wrap">
                <button className={btnPrimary} onClick={handleFindNext}>Find Next</button>
                <button className={btn} onClick={handleReplaceOne}><MnemonicLabel label="R&eplace" show={altHeld} /></button>
                <button className={btn} onClick={handleReplaceAll}><MnemonicLabel label="Replace &All" show={altHeld} /></button>
                <button className={btn} onClick={handleCount}><MnemonicLabel label="Co&unt" show={altHeld} /></button>
              </div>
            </>
          )}

          {/* ── Find in Files Tab ── */}
          {activeTab === 'findInFiles' && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-base text-muted-foreground w-14 shrink-0">Find:</span>
                <SearchInput value={options.pattern} onChange={(v) => setOptions({ pattern: v })} placeholder="Search pattern…" history={patternHistory} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleFindInFiles() } }} autoFocus inputRef={findInputRef} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-base text-muted-foreground w-14 shrink-0">Directory:</span>
                <div className="flex flex-1 gap-1.5">
                  <input className="flex-1 bg-input border border-border rounded px-2 py-1 text-sm text-foreground outline-none focus:border-ring" value={fifDir} onChange={(e) => setFifDir(e.target.value)} placeholder="/path/to/search…" spellCheck={false} />
                  <button className={btn} onClick={handleBrowseDir}><MnemonicLabel label="&Browse…" show={altHeld} /></button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-base text-muted-foreground w-14 shrink-0">Filter:</span>
                <input className="flex-1 bg-input border border-border rounded px-2 py-1 text-sm text-foreground outline-none focus:border-ring" value={fifFilter} onChange={(e) => setFifFilter(e.target.value)} placeholder="*.ts *.js (space-separated)" spellCheck={false} />
              </div>
              <div className="flex items-center gap-3 mt-1">
                {(['normal', 'extended', 'regex'] as SearchMode[]).map((m) => (
                  <label key={m} className="flex items-center gap-1 text-base text-foreground cursor-pointer">
                    <input type="radio" name="searchMode" value={m} checked={options.searchMode === m} onChange={() => setOptions({ searchMode: m })} className="accent-primary" />
                    {m === 'normal' ? 'Normal' : m === 'extended' ? 'Extended' : 'Regex'}
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-3 mt-1">
                <label className="flex items-center gap-1 text-base text-foreground cursor-pointer">
                  <input type="checkbox" checked={options.isCaseSensitive} onChange={(e) => setOptions({ isCaseSensitive: e.target.checked })} className="accent-primary" /><MnemonicLabel label="Match &case" show={altHeld} />
                </label>
                <label className="flex items-center gap-1 text-base text-foreground cursor-pointer">
                  <input type="checkbox" checked={options.isWholeWord} onChange={(e) => setOptions({ isWholeWord: e.target.checked })} className="accent-primary" /><MnemonicLabel label="&Whole word" show={altHeld} />
                </label>
                <label className="flex items-center gap-1 text-base text-foreground cursor-pointer">
                  <input type="checkbox" checked={fifRecursive} onChange={(e) => setFifRecursive(e.target.checked)} className="accent-primary" /><MnemonicLabel label="&Recursive" show={altHeld} />
                </label>
              </div>
              <hr className="border-border my-1" />
              <div className="flex gap-1.5 items-center">
                <button className={btnPrimary} onClick={handleFindInFiles} disabled={isSearching}>
                  {isSearching ? <span className="inline-block animate-spin mr-1">⟳</span> : null}
                  {isSearching ? 'Searching…' : <MnemonicLabel label="Find &All" show={altHeld} />}
                </button>
                {isSearching && currentSearchId && <button className={btn} onClick={handleCancelSearch}><MnemonicLabel label="Ca&ncel" show={altHeld} /></button>}
              </div>
              {isSearching && searchProgress && searchProgress.scanned > 0 && (
                <div className="text-base text-primary mt-1">Scanning {searchProgress.scanned} files…</div>
              )}
            </>
          )}

          {/* ── Mark Tab ── */}
          {activeTab === 'mark' && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-base text-muted-foreground w-14 shrink-0">Find:</span>
                <SearchInput value={options.pattern} onChange={(v) => setOptions({ pattern: v })} placeholder="Pattern to mark…" history={patternHistory} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleMarkAll() } }} autoFocus inputRef={findInputRef} />
              </div>
              <SearchOptionsPanel altHeld={altHeld} />
              <div className="flex items-center gap-2 mt-1">
                <span className="text-base text-muted-foreground w-14 shrink-0">Style:</span>
                <div className="flex items-center gap-1.5">
                  {MARK_COLORS_CSS.map((color, i) => (
                    <button
                      key={i}
                      className={cn('w-5 h-5 rounded border-2 cursor-pointer transition-colors', markStyleIndex === i ? 'border-foreground scale-110' : 'border-transparent')}
                      style={{ backgroundColor: color }}
                      onClick={() => setMarkStyleIndex(i)}
                      title={`Mark style ${i + 1}`}
                    />
                  ))}
                  <span className="text-base text-muted-foreground ml-1">Style {markStyleIndex + 1}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <label className="flex items-center gap-1 text-base text-foreground cursor-pointer">
                  <input type="checkbox" onChange={(e) => { if (e.target.checked) handleBookmark() }} className="accent-primary" />
                  Also bookmark matched lines
                </label>
              </div>
              <hr className="border-border my-1" />
              <div className="flex gap-1.5 flex-wrap">
                <button className={btnPrimary} onClick={handleMarkAll}><MnemonicLabel label="Mar&k All" show={altHeld} /></button>
                <button className={btn} onClick={handleClearMarks}><MnemonicLabel label={`Clear St&yle ${markStyleIndex + 1}`} show={altHeld} /></button>
                <button className={btn} onClick={handleClearAllMarks}><MnemonicLabel label="Clear &All Marks" show={altHeld} /></button>
              </div>
            </>
          )}
        </div>

        {/* Status bar */}
        <div className="px-3 py-1.5 border-t border-border min-h-[24px] text-base">
          {status.msg && (
            <span className={cn('break-all', status.type === 'ok' && 'text-green-500', status.type === 'warn' && 'text-yellow-500')}>
              {status.msg}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
