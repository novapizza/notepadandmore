import React, { useRef, useState, useCallback, useEffect } from 'react'
import { X, Plus, ChevronLeft, ChevronRight, Settings as SettingsIcon, Keyboard, Puzzle, Lock, Eye, Columns2 } from 'lucide-react'
import logoUrl from '../../assets/logo-mark.svg'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '../ui/context-menu'
import { useEditorStore } from '../../store/editorStore'
import { useUIStore } from '../../store/uiStore'
import { detectPreviewKind } from '../../utils/previewKind'
import { cn } from '../../lib/utils'

interface TabBarProps {
  /** Async — dirty buffers show a modal confirm before closing. */
  onClose?: (id: string) => void | Promise<void>
  onNewFile?: () => void
  /** Re-read the buffer's file from disk (dirty buffers confirm first). */
  onReload?: (id: string) => void
}

export const TabBar: React.FC<TabBarProps> = ({ onClose, onNewFile, onReload }) => {
  const { buffers, activeId, setActive } = useEditorStore()

  // VS Code-style preview toggles, shown next to the "+" button when the active
  // buffer is previewable (markdown / json / csv / SQL plan). Depend on language
  // + path only — not content — so they don't re-render on every keystroke.
  const activeBuf = buffers.find((b) => b.id === activeId)
  const isPreviewable =
    !!activeBuf && activeBuf.kind === 'file' && detectPreviewKind(activeBuf.language, activeBuf.filePath, null) !== null
  const showPreview = useUIStore((s) => s.showPreview)
  const previewFullscreen = useUIStore((s) => s.previewFullscreen)
  const previewLayout = useUIStore((s) => s.previewLayout)
  const inlineActive = showPreview && !previewFullscreen && previewLayout === 'inline'
  const sideActive = showPreview && !previewFullscreen && previewLayout === 'side'
  // Icon 1 — preview replaces the source in the current tab (in place, not split).
  const toggleInlinePreview = useCallback(() => {
    const ui = useUIStore.getState()
    if (ui.showPreview && !ui.previewFullscreen && ui.previewLayout === 'inline') {
      ui.setShowPreview(false)
    } else {
      ui.setPreviewFullscreen(false)
      ui.setPreviewLayout('inline')
      ui.setShowPreview(true)
    }
  }, [])
  // Icon 2 — preview beside the source (same as the Ctrl/Cmd+P shortcut).
  const toggleSidePreview = useCallback(() => {
    const ui = useUIStore.getState()
    if (ui.showPreview && !ui.previewFullscreen && ui.previewLayout === 'side') {
      ui.setShowPreview(false)
    } else {
      ui.setPreviewFullscreen(false)
      ui.setPreviewLayout('side')
      ui.setShowPreview(true)
    }
  }, [])
  const dragRef = useRef<string | null>(null)
  const dragOverRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  // --- Scroll logic ---
  const checkScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1)
  }, [])

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', checkScroll)
    const ro = new ResizeObserver(checkScroll)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', checkScroll); ro.disconnect() }
  }, [buffers.length, checkScroll])

  // Scroll active tab into view
  useEffect(() => {
    if (!activeId || !scrollRef.current) return
    const tab = scrollRef.current.querySelector(`[data-tab-id="${activeId}"]`) as HTMLElement
    tab?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [activeId])

  const handleWheel = (e: React.WheelEvent) => {
    if (scrollRef.current) scrollRef.current.scrollLeft += e.deltaY
  }

  // --- Drag-reorder ---
  const handleDragStart = (id: string) => { dragRef.current = id }

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault()
    dragOverRef.current = id
  }

  const handleDrop = () => {
    const from = dragRef.current
    const to = dragOverRef.current
    if (!from || !to || from === to) return
    useEditorStore.setState((s) => {
      const bufs = [...s.buffers]
      const fromIdx = bufs.findIndex((b) => b.id === from)
      const toIdx = bufs.findIndex((b) => b.id === to)
      const [removed] = bufs.splice(fromIdx, 1)
      bufs.splice(toIdx, 0, removed)
      return { buffers: bufs }
    })
    dragRef.current = null
    dragOverRef.current = null
  }

  // --- Context menu actions ---
  // Close sequentially: each dirty buffer raises its own modal confirm, and
  // firing them all at once would stack N native dialogs on top of each other.
  const closeSequentially = async (ids: string[]) => {
    for (const id of ids) await onClose?.(id)
  }

  const closeOthers = (id: string) => {
    void closeSequentially(buffers.filter((b) => b.id !== id).map((b) => b.id))
  }

  const closeAll = () => {
    void closeSequentially(buffers.map((b) => b.id))
  }

  const copyPath = (id: string) => {
    const buf = buffers.find((b) => b.id === id)
    if (buf?.filePath) navigator.clipboard.writeText(buf.filePath)
  }

  const revealInExplorer = (id: string) => {
    const buf = buffers.find((b) => b.id === id)
    if (buf?.filePath) window.api.file.reveal(buf.filePath)
  }

  // "Compare with…" pulls live content out of each buffer's Monaco model so
  // unsaved edits show up in the diff (falling back to the persisted `content`
  // for ghost / not-yet-loaded buffers).
  const openCompare = useUIStore.getState().openCompare
  const compareWith = (leftId: string, rightId: string) => {
    const a = buffers.find((b) => b.id === leftId)
    const b = buffers.find((b) => b.id === rightId)
    if (!a || !b) return
    const aContent = a.model?.getValue() ?? a.content ?? ''
    const bContent = b.model?.getValue() ?? b.content ?? ''
    openCompare({ title: a.title, content: aContent }, { title: b.title, content: bContent })
  }

  if (buffers.length === 0) return null

  // Double-clicking the empty area of the tab bar (anywhere not on a tab)
  // creates a new document, mirroring common browser/IDE UX.
  const handleBarDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('[data-tab-id]')) return
    if (target.closest('button')) return
    onNewFile?.()
  }

  return (
    <div
      className="h-9 bg-tab-inactive border-b border-border flex items-stretch select-none shrink-0 relative"
      data-testid="tabbar"
      onDoubleClick={handleBarDoubleClick}
    >
      {/* Left scroll arrow */}
      {canScrollLeft && (
        <button
          className="absolute left-0 z-10 h-full px-1 bg-tab-inactive/90 backdrop-blur-sm border-r border-border text-tab-muted hover:text-tab-foreground transition-colors"
          onClick={() => scrollRef.current?.scrollBy({ left: -200, behavior: 'smooth' })}
        >
          <ChevronLeft size={18} />
        </button>
      )}

      {/* Scrollable tab container */}
      <div
        ref={scrollRef}
        className="flex-1 flex items-stretch overflow-x-hidden"
        onWheel={handleWheel}
      >
        {buffers.map((buf) => {
          const isVirtual = buf.kind !== 'file'
          return (
          <ContextMenu key={buf.id}>
            <ContextMenuTrigger asChild>
              <div
                data-tab-id={buf.id}
                data-tab-title={buf.title}
                data-tab-kind={buf.kind}
                data-tab-dirty={buf.isDirty ? 'true' : 'false'}
                data-testid={buf.id === activeId ? 'active-tab' : undefined}
                className={cn(
                  'group relative flex items-center gap-1.5 pl-3 pr-2 cursor-pointer text-base min-w-0 shrink-0 transition-colors border-r border-border',
                  buf.id === activeId
                    ? 'bg-tab-active text-tab-foreground font-semibold shadow-[inset_0_-1px_0_0_hsl(var(--tab-active))]'
                    : 'bg-tab-inactive text-tab-muted hover:bg-tab-hover',
                  !buf.loaded && 'opacity-55',
                )}
                onClick={() => setActive(buf.id)}
                onAuxClick={(e) => { if (e.button === 1) onClose?.(buf.id) }}
                draggable
                onDragStart={() => handleDragStart(buf.id)}
                onDragOver={(e) => handleDragOver(e, buf.id)}
                onDrop={handleDrop}
                title={isVirtual ? buf.title : (buf.sourceUrl ?? buf.filePath ?? buf.title)}
              >
                {/* Active indicator — blue top line */}
                {buf.id === activeId && (
                  <div className="absolute top-0 left-0 right-0 h-[3px] bg-primary" />
                )}

                {/* Kind icon for virtual tabs */}
                {buf.kind === 'settings' && <SettingsIcon size={18} className="shrink-0 opacity-80" />}
                {buf.kind === 'shortcuts' && <Keyboard size={18} className="shrink-0 opacity-80" />}
                {buf.kind === 'whatsNew' && <img src={logoUrl} alt="" className="w-[18px] h-[18px] shrink-0" draggable={false} />}
                {(buf.kind === 'pluginManager' || buf.kind === 'pluginDetail') && <Puzzle size={18} className="shrink-0 opacity-80" />}

                {/* Read-only (deeplink remote) indicator */}
                {buf.isReadOnly && <Lock size={13} className="shrink-0 opacity-70" data-testid="tab-readonly-icon" />}

                {/* Tab title — prefix dirty buffers with "*" (Notepad++ style) */}
                <span className={cn('truncate', buf.missing && 'line-through opacity-50')}>
                  {!isVirtual && buf.isDirty && (
                    <span className="text-destructive font-bold mr-0.5">*</span>
                  )}
                  {buf.title}
                </span>

                {/* Close button */}
                <span className="ml-1 w-[22px] h-[22px] flex items-center justify-center shrink-0">
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 hover:bg-secondary rounded-sm transition-opacity p-0.5 flex items-center justify-center"
                    onClick={(e) => { e.stopPropagation(); onClose?.(buf.id) }}
                  >
                    <X size={18} />
                  </button>
                </span>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-48">
              <ContextMenuItem onClick={() => onClose?.(buf.id)}>Close</ContextMenuItem>
              <ContextMenuItem onClick={() => closeOthers(buf.id)}>Close Others</ContextMenuItem>
              <ContextMenuItem onClick={() => closeAll()}>Close All</ContextMenuItem>
              {!isVirtual && (() => {
                // Only file buffers are eligible — virtual tabs (settings,
                // plugins, etc.) have no comparable content. Disable the
                // entry when there's nothing else open to diff against.
                const otherFileBuffers = buffers.filter(
                  (b) => b.id !== buf.id && b.kind === 'file'
                )
                return (
                  <>
                    <ContextMenuSeparator />
                    {otherFileBuffers.length === 0 ? (
                      <ContextMenuItem disabled>
                        Compare with… <span className="ml-auto text-[10px] opacity-60">open another file</span>
                      </ContextMenuItem>
                    ) : (
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>Compare with…</ContextMenuSubTrigger>
                        <ContextMenuSubContent className="w-56" data-testid="compare-with-submenu">
                          {otherFileBuffers.map((other) => (
                            <ContextMenuItem
                              key={other.id}
                              onClick={() => compareWith(buf.id, other.id)}
                              data-testid={`compare-with-${other.title}`}
                            >
                              <span className="truncate">{other.title}</span>
                            </ContextMenuItem>
                          ))}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    )}
                    <ContextMenuSeparator />
                    {/* Untitled buffers have no on-disk source to reload from. */}
                    <ContextMenuItem disabled={!buf.filePath} onClick={() => onReload?.(buf.id)}>
                      Reload from Disk
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => copyPath(buf.id)}>Copy File Path</ContextMenuItem>
                    <ContextMenuItem onClick={() => revealInExplorer(buf.id)}>Reveal in Explorer</ContextMenuItem>
                  </>
                )
              })()}
            </ContextMenuContent>
          </ContextMenu>
          )
        })}
        {/* Filler eats the rest of the row so double-click anywhere past the
            last tab still hits the bar's onDoubleClick handler — gives tests
            a stable selector and gives users a bigger dbl-click target. */}
        <div
          data-testid="tabbar-filler"
          className="flex-1 min-w-[24px]"
        />
      </div>

      {/* Right scroll arrow */}
      {canScrollRight && (
        <button
          className="absolute right-9 z-10 h-full px-1 bg-tab-inactive/90 backdrop-blur-sm border-l border-border text-tab-muted hover:text-tab-foreground transition-colors"
          onClick={() => scrollRef.current?.scrollBy({ left: 200, behavior: 'smooth' })}
        >
          <ChevronRight size={18} />
        </button>
      )}

      {/* Preview toggles — only for previewable buffers (markdown/json/csv/SQL plan) */}
      {isPreviewable && (
        <div className="flex items-center shrink-0 border-l border-border" data-testid="preview-actions">
          <button
            type="button"
            onClick={toggleInlinePreview}
            aria-label="Toggle preview"
            aria-pressed={inlineActive}
            title="Preview (replaces the editor in this tab)"
            data-testid="preview-toggle-inline"
            className={cn(
              'w-9 h-full flex items-center justify-center transition-colors hover:bg-tab-hover',
              inlineActive ? 'text-primary' : 'text-tab-muted hover:text-tab-foreground'
            )}
          >
            <Eye size={17} />
          </button>
          <button
            type="button"
            onClick={toggleSidePreview}
            aria-label="Open preview to the side"
            aria-pressed={sideActive}
            title="Open Preview to the Side (Ctrl/Cmd+P)"
            data-testid="preview-toggle-side"
            className={cn(
              'w-9 h-full flex items-center justify-center transition-colors hover:bg-tab-hover',
              sideActive ? 'text-primary' : 'text-tab-muted hover:text-tab-foreground'
            )}
          >
            <Columns2 size={17} />
          </button>
        </div>
      )}

      {/* New file button — outermost on the right */}
      <button
        className="w-9 flex items-center justify-center text-tab-muted hover:text-tab-foreground hover:bg-tab-hover transition-colors shrink-0 border-l border-border"
        onClick={() => onNewFile?.()}
        title="New file"
        data-testid="tabbar-new-btn"
      >
        <Plus size={18} />
      </button>
    </div>
  )
}
