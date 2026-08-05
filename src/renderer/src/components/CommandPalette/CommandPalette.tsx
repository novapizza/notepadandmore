import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Search, Terminal } from 'lucide-react'
import { useUIStore } from '../../store/uiStore'
import { useConfigStore } from '../../store/configStore'
import { useFileOps } from '../../hooks/useFileOps'
import { fuzzyFilter } from '../../utils/fuzzyFilter'
import { bindingDisplay } from '../../utils/shortcutCatalog'
import { availableCommands, recentCommandIds, runCommand } from '../../commands/registry'
import type { CommandDef } from '../../commands/types'

/**
 * One overlay, two modes. A leading `>` searches commands; anything else
 * searches files in the open workspace — the behaviour the old
 * `QuickOpenPalette` provided, carried over unchanged (BR-011).
 *
 * `Mod+Shift+P` opens command mode, `Mod+E` file mode, and editing the `>`
 * switches between them live without closing the overlay.
 */

interface FileEntry {
  path: string
  name: string
}

const MAX_RESULTS = 50
const COMMAND_PREFIX = '>'

const norm = (p: string): string => p.replace(/\\/g, '/')

/** `fuzzyFilter` scores `{ name, path }`; commands adapt rather than widening it. */
interface CommandSearchItem {
  name: string
  path: string
  cmd: CommandDef
}

const toSearchItem = (c: CommandDef): CommandSearchItem => ({
  name: c.label,
  // Section and keywords ride along in `path`, which scores below a name hit —
  // so a label match outranks a section/keyword match for free.
  path: `${c.section} ${c.label} ${c.keywords ?? ''}`,
  cmd: c
})

/** Render text with the fuzzy-matched character indices highlighted. */
function Highlighted({ text, ranges }: { text: string; ranges: number[] }): React.ReactElement {
  if (!ranges.length) return <>{text}</>
  const hit = new Set(ranges)
  return (
    <>
      {Array.from(text).map((ch, i) =>
        hit.has(i) ? (
          <span key={i} className="text-primary font-semibold">
            {ch}
          </span>
        ) : (
          <React.Fragment key={i}>{ch}</React.Fragment>
        )
      )}
    </>
  )
}

export function CommandPalette(): React.ReactElement | null {
  const mode0 = useUIStore((s) => s.commandPaletteMode)
  const setCommandPalette = useUIStore((s) => s.setCommandPalette)
  const workspaceFolder = useUIStore((s) => s.workspaceFolder)
  const overrides = useConfigStore((s) => s.shortcuts)
  const { openFiles } = useFileOps()

  const [allFiles, setAllFiles] = useState<FileEntry[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [loading, setLoading] = useState(false)
  const [truncated, setTruncated] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const open = mode0 !== null
  const mode = query.startsWith(COMMAND_PREFIX) ? 'commands' : 'files'
  const term = mode === 'commands' ? query.slice(COMMAND_PREFIX.length) : query

  // Seed the query from the mode it was opened in, so `Mod+Shift+P` lands in
  // command mode and `Mod+E` in file mode.
  useEffect(() => {
    if (!mode0) return
    setQuery(mode0 === 'commands' ? COMMAND_PREFIX : '')
    setSelected(0)
  }, [mode0])

  // Snapshot the available commands when the palette opens, not per keystroke:
  // `when` predicates read stores, and the modal overlay holds focus, so the
  // underlying state can't change while it's up.
  const commandItems = useMemo(
    () => (open ? availableCommands().map(toSearchItem) : []),
    [open]
  )

  // Load the file list each time the palette opens (the folder may have changed).
  useEffect(() => {
    if (!open) return
    setTruncated(false)
    if (!workspaceFolder) {
      setAllFiles([])
      return
    }
    let cancelled = false
    setLoading(true)
    window.api.file
      .listFilesRecursive(workspaceFolder)
      .then((res) => {
        if (cancelled) return
        setAllFiles(res.files)
        setTruncated(res.truncated)
      })
      .catch(() => {
        if (!cancelled) setAllFiles([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, workspaceFolder])

  // Focus the input when opened.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const commandResults = useMemo(() => {
    if (mode !== 'commands') return []
    if (!term.trim()) {
      // Empty query only: most-recently-run first, then everything else in
      // declaration order. A typed query ranks purely by fuzzy score (US-015).
      const recent = recentCommandIds()
      const recentSet = new Set(recent)
      const mru = recent
        .map((id) => commandItems.find((i) => i.cmd.id === id))
        .filter((i): i is CommandSearchItem => !!i)
      const rest = commandItems.filter((i) => !recentSet.has(i.cmd.id))
      return [...mru, ...rest]
        .slice(0, MAX_RESULTS)
        .map((item) => ({ item, score: 0, matchRanges: [] as number[] }))
    }
    return fuzzyFilter(term, commandItems, MAX_RESULTS)
  }, [mode, term, commandItems])

  const fileResults = useMemo(
    () => (mode === 'files' ? fuzzyFilter(term, allFiles, MAX_RESULTS) : []),
    [mode, term, allFiles]
  )

  const resultCount = mode === 'commands' ? commandResults.length : fileResults.length

  // Keep the selection in range as results change.
  useEffect(() => {
    setSelected((s) => (resultCount === 0 ? 0 : Math.min(s, resultCount - 1)))
  }, [resultCount])

  // Reset the selection when the user switches modes.
  useEffect(() => {
    setSelected(0)
  }, [mode])

  // Scroll the selected row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selected}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const close = (): void => setCommandPalette(null)

  const invokeAt = (idx: number): void => {
    if (mode === 'commands') {
      const match = commandResults[idx]
      if (!match) return
      // Close BEFORE running (BR-006): many commands open an overlay of their
      // own, and the palette's teardown spreads CLOSE_TOP_OVERLAYS — running
      // first would have the palette immediately close what it just opened.
      close()
      runCommand(match.item.cmd.id)
      return
    }
    const match = fileResults[idx]
    if (!match) return
    close()
    void openFiles([match.item.path])
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => (resultCount === 0 ? 0 : (s + 1) % resultCount))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => (resultCount === 0 ? 0 : (s - 1 + resultCount) % resultCount))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      invokeAt(selected)
    }
  }

  if (!open) return null

  const rootPrefix = workspaceFolder ? norm(workspaceFolder) + '/' : ''
  const relDir = (full: string): string => {
    const n = norm(full)
    const rel = n.startsWith(rootPrefix) ? n.slice(rootPrefix.length) : n
    const slash = rel.lastIndexOf('/')
    return slash >= 0 ? rel.slice(0, slash) : ''
  }

  const placeholder =
    mode === 'commands'
      ? "Type a command name…  (delete '>' to search files)"
      : workspaceFolder
        ? "Search files by name…  (type '>' for commands)"
        : "Open a folder to search files  (type '>' for commands)"

  const rowCls = (idx: number): string =>
    'flex items-center gap-2 px-3 py-1.5 cursor-pointer text-base ' +
    (idx === selected ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-explorer-hover')

  return (
    <div
      data-testid="command-palette"
      data-mode={mode}
      className="fixed inset-0 z-[9000] flex items-start justify-center bg-black/40 pt-[12vh]"
      onClick={close}
    >
      <div
        className="fixed z-[9001] w-[600px] max-w-[90vw] bg-popover border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          {mode === 'commands' ? (
            <Terminal size={16} className="shrink-0 text-muted-foreground" />
          ) : (
            <Search size={16} className="shrink-0 text-muted-foreground" />
          )}
          <input
            ref={inputRef}
            data-testid="command-palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="flex-1 bg-transparent border-none outline-none text-base text-foreground placeholder:text-muted-foreground"
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        <div
          ref={listRef}
          data-testid="command-palette-list"
          className="max-h-[50vh] overflow-y-auto py-1"
        >
          {mode === 'commands' ? (
            commandResults.length === 0 ? (
              <div className="px-3 py-6 text-center text-base text-muted-foreground">
                No matching commands
              </div>
            ) : (
              commandResults.map((m, idx) => {
                const cmd = m.item.cmd
                const binding = bindingDisplay(cmd.id, overrides)
                return (
                  <div
                    key={cmd.id}
                    data-idx={idx}
                    data-testid="command-palette-command"
                    onClick={() => invokeAt(idx)}
                    onMouseMove={() => setSelected(idx)}
                    className={rowCls(idx)}
                    title={cmd.id}
                  >
                    <Terminal size={16} className="shrink-0 text-tab-muted" />
                    <span className="shrink-0 text-sm text-muted-foreground">{cmd.section}:</span>
                    <span className="truncate">
                      <Highlighted text={cmd.label} ranges={m.matchRanges} />
                    </span>
                    <span className="flex-1" />
                    {binding && (
                      <span className="shrink-0 text-sm text-muted-foreground font-mono tabular-nums">
                        {binding}
                      </span>
                    )}
                  </div>
                )
              })
            )
          ) : !workspaceFolder ? (
            <div className="px-3 py-6 text-center text-base text-muted-foreground">
              No folder is open. Use <span className="font-mono text-sm">File → Open Folder…</span> first.
            </div>
          ) : loading ? (
            <div className="px-3 py-6 text-center text-base text-muted-foreground">Indexing files…</div>
          ) : fileResults.length === 0 ? (
            <div className="px-3 py-6 text-center text-base text-muted-foreground">No matching files</div>
          ) : (
            fileResults.map((m, idx) => {
              const dir = relDir(m.item.path)
              return (
                <div
                  key={m.item.path}
                  data-idx={idx}
                  data-testid="command-palette-file"
                  onClick={() => invokeAt(idx)}
                  onMouseMove={() => setSelected(idx)}
                  className={rowCls(idx)}
                  title={m.item.path}
                >
                  <FileText size={16} className="shrink-0 text-tab-muted" />
                  <span className="truncate">
                    <Highlighted text={m.item.name} ranges={m.matchRanges} />
                  </span>
                  {dir && <span className="truncate text-sm text-muted-foreground">{dir}</span>}
                </div>
              )
            })
          )}
        </div>

        {mode === 'files' && truncated && (
          <div className="px-3 py-1.5 border-t border-border text-sm text-muted-foreground">
            Showing the first {allFiles.length.toLocaleString()} files — narrow your search to find more.
          </div>
        )}
      </div>
    </div>
  )
}
