import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, lazy, Suspense } from 'react'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'
import { EditorPane } from './components/EditorPane/EditorPane'
import { SplitEditorPane } from './components/EditorPane/SplitEditorPane'
import { SettingsTab } from './components/SettingsTab/SettingsTab'
import { ShortcutsTab } from './components/ShortcutsTab/ShortcutsTab'
import { WhatsNewTab } from './components/WhatsNewTab/WhatsNewTab'
import { PluginManagerTab } from './components/PluginManagerTab/PluginManagerTab'
import { PluginDetailTab } from './components/PluginDetailTab/PluginDetailTab'
import { CsvViewerOverlay } from './components/CsvViewer/CsvViewerOverlay'
import { WelcomeScreen } from './components/WelcomeScreen/WelcomeScreen'
import { TabBar } from './components/TabBar/TabBar'
import { MenuBar } from './components/editor/MenuBar'
import { QuickStrip } from './components/editor/QuickStrip'
import { Toolbar } from './components/editor/Toolbar'
import { StatusBar } from './components/StatusBar/StatusBar'
import { BottomPanelContainer } from './components/Panels/BottomPanelContainer'
import { FindReplaceDialog } from './components/Dialogs/FindReplace/FindReplaceDialog'
import { AboutDialog } from './components/Dialogs/AboutDialog/AboutDialog'
import { QuickOpenPalette } from './components/QuickOpen/QuickOpenPalette'
import { ToolsPanel } from './components/Tools/ToolsPanel'
import { openHashGenerator, hashFromFiles, hashSelectionToClipboard, type HashAlgo } from './lib/tools/hashActions'
import { Sidebar } from './components/Sidebar/Sidebar'
// Lazy-loaded preview panes — each pulls heavy deps that stay out of the
// main bundle until the user actually opens the preview.
const MarkdownPreviewPane = lazy(() =>
  import('./components/MarkdownPreview/MarkdownPreviewPane').then((m) => ({ default: m.MarkdownPreviewPane }))
)
const SqlPlanPreviewPane = lazy(() =>
  import('./components/SqlPlanPreview/SqlPlanPreviewPane').then((m) => ({ default: m.SqlPlanPreviewPane }))
)
const TableLensPreviewPane = lazy(() =>
  import('./components/CsvViewer/TableLensPreviewPane').then((m) => ({ default: m.TableLensPreviewPane }))
)
const JsonPreviewPane = lazy(() =>
  import('./components/JsonPreview/JsonPreviewPane').then((m) => ({ default: m.JsonPreviewPane }))
)
const CompareOverlay = lazy(() =>
  import('./components/Compare/CompareOverlay').then((m) => ({ default: m.CompareOverlay }))
)
const TransformOverlay = lazy(() =>
  import('./components/Transform/TransformOverlay').then((m) => ({ default: m.TransformOverlay }))
)
// Chat panel is lazy for the same reason as the previews: users who never turn
// the assistant on shouldn't pay for react-markdown + the diff editor wiring.
const AiChatPanel = lazy(() => import('./components/AiAssistant/AiChatPanel'))

import { detectPreviewKind } from './utils/previewKind'
import { applyTheme } from './utils/themes'
import { Toaster, toast } from './components/ui/sonner'
import { useEditorStore } from './store/editorStore'
import { useUIStore } from './store/uiStore'
import { usePluginStore } from './store/pluginStore'
import { useConfigStore } from './store/configStore'
import { useAiStore } from './store/aiStore'
import { AiBadge } from './components/AiAssistant/AiBadge'
import { useFileOps, SessionData } from './hooks/useFileOps'
import { useFileDrop } from './hooks/useFileDrop'
import { useNavigationShortcuts } from './hooks/useNavigation'
import { useUpdateEvents } from './hooks/useUpdateEvents'
import { useBackupSnapshot } from './hooks/useBackupSnapshot'
import { mintBackupFilename } from './utils/backupNaming'
import { backupApi } from './utils/backupApi'
import { editorRegistry } from './utils/editorRegistry'

export default function App() {
  const { activeId, buffers } = useEditorStore()
  const activeBuffer = buffers.find((b) => b.id === activeId)
  const activeKind = activeBuffer?.kind ?? 'file'
  const { theme, showToolbar, showStatusBar, showBottomPanel, showSidebar, openFind, csvViewerOpen, csvViewerText, csvViewerFileName, showPreview, previewFullscreen, previewLayout, compareOpen, transformOpen, splitView } = useUIStore()
  // Auto-close the preview pane when the user switches tabs. Without this,
  // toggling preview on (say) a .md tab would leave it open across every
  // tab whose buffer type also happens to be previewable, which surprises
  // users. Using useLayoutEffect (not useEffect) so the close lands before
  // the browser paints — no flash of the wrong preview during the switch.
  const prevActiveIdRef = useRef<string | null>(activeId)
  useLayoutEffect(() => {
    if (prevActiveIdRef.current !== activeId) {
      if (useUIStore.getState().showPreview) {
        useUIStore.getState().setShowPreview(false)
      }
      prevActiveIdRef.current = activeId
    }
  }, [activeId])

  // Quick Open (Ctrl/Cmd+Shift+P) — handle in the capture phase on documentElement
  // so it fires app-wide regardless of focus, beating Monaco's internal keybindings
  // (the native menu accelerator alone gets swallowed when the editor is focused).
  // Plain Ctrl/Cmd+P is intentionally left to fall through to Preview.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = window.api.platform === 'darwin' ? e.metaKey : e.ctrlKey
      if (mod && e.shiftKey && !e.altKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault()
        e.stopPropagation()
        useUIStore.getState().setQuickOpenVisible(true)
      }
    }
    document.documentElement.addEventListener('keydown', onKeyDown, { capture: true })
    return () => document.documentElement.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  // AI assistant streaming. Subscribed once here rather than in the panel so
  // chunks keep landing in the transcript even if the user closes the panel
  // mid-answer. Every payload carries the requestId; aiStore drops anything that
  // doesn't match the turn it's currently expecting.
  useEffect(() => {
    const ai = useAiStore.getState()
    const offChunk = window.api.on('ai:stream-chunk', (...args) => {
      const p = args[0] as { requestId: string; text: string }
      ai.onChunk(p.requestId, p.text)
    })
    const offDone = window.api.on('ai:stream-done', (...args) => {
      const p = args[0] as { requestId: string; canceled?: boolean; truncated?: boolean }
      ai.onDone(p.requestId, { canceled: p.canceled, truncated: p.truncated })
    })
    const offError = window.api.on('ai:stream-error', (...args) => {
      const p = args[0] as { requestId: string; error: string }
      ai.onError(p.requestId, p.error)
    })
    return () => {
      offChunk()
      offDone()
      offError()
    }
  }, [])

  // Toggle the assistant from the keyboard. Handled in the capture phase for the
  // same reason as Quick Open: a native menu accelerator alone gets swallowed
  // while Monaco has focus. Mod+Shift+A rather than Mod+Shift+I, which Electron
  // reserves for DevTools.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = window.api.platform === 'darwin' ? e.metaKey : e.ctrlKey
      if (mod && e.shiftKey && !e.altKey && (e.key === 'a' || e.key === 'A')) {
        if (!useConfigStore.getState().aiEnabled) return
        e.preventDefault()
        e.stopPropagation()
        useAiStore.getState().togglePanel()
      }
    }
    document.documentElement.addEventListener('keydown', onKeyDown, { capture: true })
    return () => document.documentElement.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])
  // The right-side preview pane renders when the user toggled showPreview AND
  // the active buffer's type is one we know how to preview. The pane
  // component is decided per-buffer so switching tabs swaps the preview.
  const previewKind = (showPreview && activeKind === 'file' && activeBuffer)
    ? detectPreviewKind(activeBuffer.language, activeBuffer.filePath, activeBuffer.content ?? null)
    : null
  // Side-by-side panel renders only for the 'side' layout, not fullscreen —
  // in fullscreen the preview pane positions itself as a top-level overlay
  // covering the whole window, so reserving split-panel space would be wasted.
  const previewVisible = previewKind !== null && !previewFullscreen && previewLayout === 'side'
  // Inline layout: preview replaces the editor within the current tab area
  // (an overlay over EditorPane), keeping the tab bar / toolbar / status bar.
  const previewInlineVisible = previewKind !== null && !previewFullscreen && previewLayout === 'inline'
  const previewFullscreenVisible = previewKind !== null && previewFullscreen
  // Split View: a second editor mirroring the active file buffer. Suppressed
  // for virtual tabs (settings/plugins) and while a preview is fullscreen.
  const splitVisible = splitView && activeKind === 'file' && !!activeId && !previewFullscreen
  // AI assistant. The badge and the docked panel both require the feature to be
  // enabled and a real file tab to be active — there is nothing to ask about on
  // a Settings or Plugin Manager tab.
  const aiEnabled = useConfigStore((s) => s.aiEnabled)
  const aiShowBadge = useConfigStore((s) => s.aiShowBadge)
  const aiPanelOpen = useAiStore((s) => s.panelOpen)
  const aiAvailable = aiEnabled && activeKind === 'file' && !!activeId
  const aiPanelVisible = aiAvailable && aiPanelOpen && !previewFullscreen
  const aiBadgeVisible = aiAvailable && aiShowBadge && !previewFullscreen && !previewInlineVisible
  // Distribute the editor row across however many panes are showing so the
  // defaultSizes sum to 100 (react-resizable-panels normalizes anyway, but
  // matching keeps the initial layout stable).
  const editorPaneCount = 1 + (splitVisible ? 1 : 0) + (previewVisible ? 1 : 0) + (aiPanelVisible ? 1 : 0)
  const editorContentSize = editorPaneCount === 1 ? 100 : editorPaneCount === 2 ? 55 : editorPaneCount === 3 ? 40 : 34
  const sidePaneSize = Math.round((100 - editorContentSize) / Math.max(1, editorPaneCount - 1))
  const { openFiles, openRemoteFile, openInlineContent, newFile, saveBuffer, saveActiveAs, closeBuffer, reloadBuffer, loadBuffer, restoreSession } = useFileOps()
  // Close every tab one at a time. closeBuffer raises a modal confirm per dirty
  // buffer, so closing them in parallel would stack N native dialogs at once.
  const closeAllBuffers = useCallback(async () => {
    for (const b of useEditorStore.getState().buffers) await closeBuffer(b.id)
  }, [closeBuffer])
  // Save every dirty tab one at a time. saveBuffer raises a native Save As
  // dialog for each untitled buffer, so saving them in parallel would stack N
  // dialogs at once — same reason closeAllBuffers is sequential.
  const saveAllBuffers = useCallback(async () => {
    for (const b of useEditorStore.getState().buffers) {
      if (b.isDirty) await saveBuffer(b.id)
    }
  }, [saveBuffer])
  // Mount window-level keyboard (Alt+Left/Right or Ctrl+-) and mouse
  // back/forward button listeners that drive navigation history.
  useNavigationShortcuts()
  // Subscribe to auto-update events from the main process and drive toasts.
  useUpdateEvents()
  // Notepad++-style periodic backup of dirty buffers (gated by config).
  useBackupSnapshot()
  // VSCode-style drop: drag a file or folder from Finder/Explorer onto the
  // window to open it (or set workspace).
  const { dragActive } = useFileDrop(openFiles)
  const editorRef = useRef<{ focus: () => void } | null>(null)

  const handleOpenFile = useCallback(async () => {
    const filePaths = await window.api.file.openDialog()
    if (filePaths) openFiles(filePaths)
  }, [openFiles])

  // Apply the theme to <html>: toggles the .dark base class and sets any
  // theme-specific CSS-variable overrides (see utils/themes.ts).
  useEffect(() => {
    applyTheme(theme)
  }, [theme])


  // Load config on startup and apply persisted theme to UI
  useEffect(() => {
    void (async () => {
      await useConfigStore.getState().load()
      const t = useConfigStore.getState().theme
      useUIStore.getState().setTheme(t)
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // What's New auto-open: after config is loaded AND any session restore
  // has settled, compare the current app version to the persisted
  // lastSeenVersion. On mismatch (including the null/fresh-install case),
  // open the WhatsNew tab in the BACKGROUND (no focus steal) and write the
  // current version back immediately. Silent on failure.
  const configLoaded = useConfigStore((s) => s.loaded)
  const [readyForAutoOpen, setReadyForAutoOpen] = useState(false)
  const autoOpenFiredRef = useRef(false)

  // Fallback: if no session:restore IPC arrives (e.g., main process skipped
  // restore in E2E mode, or there is no session.json on a fresh install
  // outside test mode), still let the auto-open fire after a short window.
  useEffect(() => {
    const t = setTimeout(() => setReadyForAutoOpen(true), 200)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!configLoaded || !readyForAutoOpen || autoOpenFiredRef.current) return
    autoOpenFiredRef.current = true
    void (async () => {
      try {
        const currentVersion = await window.api.app.getVersion()
        const lastSeenVersion = useConfigStore.getState().lastSeenVersion
        if (lastSeenVersion !== currentVersion) {
          // Activate What's New when the workspace is otherwise empty (nothing to
          // interrupt) so the user actually sees it instead of the Welcome screen;
          // when a session with files was restored, open it in the background so
          // it doesn't steal focus from the restored document (BR-004).
          const hasFiles = useEditorStore.getState().buffers.some((b) => b.kind === 'file')
          useEditorStore.getState().openVirtualTab('whatsNew', { activate: !hasFiles })
          // Write-on-fire (BR-004): persist immediately so a crash before tab
          // close still counts as "seen" and won't re-fire on next launch.
          useConfigStore.getState().setProp('lastSeenVersion', currentVersion)
        }
      } catch (err) {
        console.warn('whats-new auto-open: version check failed', err)
      }
    })()
  }, [configLoaded, readyForAutoOpen])

  // Apply the persisted whole-window zoom once config has loaded.
  const zoomAppliedRef = useRef(false)
  useEffect(() => {
    if (!configLoaded || zoomAppliedRef.current) return
    zoomAppliedRef.current = true
    window.api.zoom.set(useConfigStore.getState().windowZoomLevel ?? 0)
  }, [configLoaded])

  // Whole-window zoom (UI + editor) handled here so it works regardless of the
  // active tab — including the Welcome screen and virtual tabs where no Monaco
  // editor is mounted. Fires for both native-menu IPC and custom MenuBar/Toolbar
  // CustomEvents on the shared 'editor:command' channel.
  useEffect(() => {
    const applyZoom = (cmd: string): void => {
      let level: number
      if (cmd === 'zoomIn') level = window.api.zoom.in()
      else if (cmd === 'zoomOut') level = window.api.zoom.out()
      else if (cmd === 'zoomReset') level = window.api.zoom.reset()
      else return
      useConfigStore.getState().setProp('windowZoomLevel', level)
    }
    const ipcHandler = (...args: unknown[]) => applyZoom(args[0] as string)
    const customHandler = (e: Event) => applyZoom((e as CustomEvent<string>).detail)
    const unsub = window.api.on('editor:command', ipcHandler)
    window.addEventListener('editor:command', customHandler)
    return () => {
      unsub()
      window.removeEventListener('editor:command', customHandler)
    }
  }, [])

  // Wire up menu IPC events
  useEffect(() => {
    window.api.on('menu:file-new', () => newFile())
    window.api.on('menu:file-open', (...args) => openFiles(args[0] as string[]))
    window.api.on('deeplink:open', (...args) => {
      const p = args[0] as { fileName: string; content: string; sourceUrl: string; line?: number; col?: number; preview?: boolean }
      const id = openRemoteFile(p)
      let host = ''
      try { host = new URL(p.sourceUrl).host } catch { /* display-only */ }
      useUIStore.getState().addToast(`Opened read-only from ${host || 'deeplink'}`, 'info')
      // Run after the editor has bound the new buffer's model. The preview
      // toggle must also wait: switching to the new tab fires App's auto-close
      // layout effect, which would immediately close a preview enabled too early.
      if (p.line || p.preview) {
        setTimeout(() => {
          const editor = editorRegistry.get()
          if (p.line && editor) {
            editor.setPosition({ lineNumber: p.line, column: p.col ?? 1 })
            editor.revealLineInCenter(p.line)
          }
          if (p.preview) {
            const buf = useEditorStore.getState().getBuffer(id)
            const kind = buf ? detectPreviewKind(buf.language, buf.filePath, buf.content ?? null) : null
            if (kind) {
              useUIStore.getState().setPreviewLayout('side')
              useUIStore.getState().setShowPreview(true)
            } else {
              useUIStore.getState().addToast('No preview available for this file type — opened in the editor.', 'warn')
            }
          }
        }, 150)
      }
    })
    window.api.on('deeplink:new', (...args) => {
      const p = args[0] as { title: string; content: string; language: string | null }
      openInlineContent(p)
      useUIStore.getState().addToast(`Created "${p.title}" from a link`, 'info')
    })
    window.api.on('menu:file-save', () => {
      const id = useEditorStore.getState().activeId
      if (id) saveBuffer(id)
    })
    window.api.on('menu:file-save-as', () => saveActiveAs())
    window.api.on('menu:file-save-all', () => {
      void saveAllBuffers()
    })
    window.api.on('menu:file-close', () => {
      const id = useEditorStore.getState().activeId
      if (id) void closeBuffer(id)
    })
    window.api.on('menu:file-close-all', () => {
      void closeAllBuffers()
    })
    window.api.on('menu:file-reload', () => {
      const id = useEditorStore.getState().activeId
      if (id) reloadBuffer(id)
    })
    const getEditorSelection = () => {
      const editor = editorRegistry.get()
      if (!editor) return ''
      const sel = editor.getSelection()
      if (!sel) return ''
      const text = editor.getModel()?.getValueInRange(sel) ?? ''
      return text.includes('\n') ? '' : text.trim()
    }
    window.api.on('menu:find', () => useUIStore.getState().openFind('find', getEditorSelection()))
    window.api.on('menu:replace', () => useUIStore.getState().openFind('replace', getEditorSelection()))
    window.api.on('menu:find-in-files', () => useUIStore.getState().openFind('findInFiles', getEditorSelection()))
    window.api.on('menu:mark', () => useUIStore.getState().openFind('mark', getEditorSelection()))
    window.api.on('menu:folder-open', (...args) => {
      const folder = args[0] as string
      // Opening a fresh folder: drop any expanded paths from the previous root.
      useUIStore.getState().setExpandedFolders([])
      useUIStore.getState().setWorkspaceFolder(folder)
      useUIStore.getState().setShowSidebar(true)
      useUIStore.getState().setSidebarPanel('files')
    })
    window.api.on('menu:goto-file', () => useUIStore.getState().setQuickOpenVisible(true))
    window.api.on('ui:toggle-theme', () => {
      useUIStore.getState().toggleTheme()
      useConfigStore.getState().setProp('theme', useUIStore.getState().theme)
    })
    window.api.on('ui:toggle-toolbar', (...args) => useUIStore.getState().setShowToolbar(args[0] as boolean, true))
    window.api.on('ui:toggle-statusbar', (...args) => useUIStore.getState().setShowStatusBar(args[0] as boolean, true))
    window.api.on('ui:toggle-sidebar', (...args) => useUIStore.getState().setShowSidebar(args[0] as boolean, true))
    window.api.on('ui:toggle-split-view', (...args) => useUIStore.getState().setSplitView(args[0] as boolean, true))
    window.api.on('ui:show-toast', (...args) => {
      useUIStore.getState().addToast(args[0] as string, (args[1] as 'info' | 'warn' | 'error') ?? 'info')
    })
    window.api.on('menu:plugin-manager', () => useEditorStore.getState().openPluginManagerTab())
    window.api.on('plugin:open-csv-viewer', (...args) => {
      const { csvText, fileName } = args[0] as { csvText: string; fileName: string }
      useUIStore.getState().openCsvViewer(csvText, fileName)
    })
    window.api.on('menu:about',              () => useUIStore.getState().setShowAbout(true))
    window.api.on('menu:settings-open',      () => useEditorStore.getState().openVirtualTab('settings'))
    window.api.on('menu:shortcuts-open',     () => {
      useUIStore.getState().setPendingSettingsCategory('shortcuts')
      useEditorStore.getState().openVirtualTab('settings')
    })
    window.api.on('menu:whats-new-open',     () => useEditorStore.getState().openVirtualTab('whatsNew'))
    window.api.on('menu:tools-open',         (...args) => useUIStore.getState().openTool(args[0] as string))
    window.api.on('menu:tools-hash',         (...args) => {
      const { algo, verb } = args[0] as { algo: HashAlgo; verb: 'generate' | 'files' | 'selection' }
      if (verb === 'files') void hashFromFiles(algo)
      else if (verb === 'selection') void hashSelectionToClipboard(algo)
      else openHashGenerator(algo)
    })
    window.api.on('menu:ai-assistant',       () => {
      // Nudge the user to Settings instead of silently doing nothing when the
      // feature is still off.
      if (!useConfigStore.getState().aiEnabled) {
        useUIStore.getState().setPendingSettingsCategory('ai')
        useEditorStore.getState().openVirtualTab('settings')
        return
      }
      useAiStore.getState().togglePanel()
    })
    window.api.on('menu:check-for-updates',  () => { void window.api.update.check() })
    window.api.on('plugin:state-changed', () => {
      usePluginStore.getState().fetchPlugins()
    })
    window.api.on('plugin:add-menu-item', (...args) => {
      const [pluginName, label] = args as [string, string]
      usePluginStore.getState().addDynamicMenuItem({ pluginName, label })
    })
    window.api.on('tab:next', () => {
      const s = useEditorStore.getState()
      const idx = s.buffers.findIndex((b) => b.id === s.activeId)
      const next = s.buffers[(idx + 1) % s.buffers.length]
      if (next) s.setActive(next.id)
    })
    window.api.on('tab:prev', () => {
      const s = useEditorStore.getState()
      const idx = s.buffers.findIndex((b) => b.id === s.activeId)
      const prev = s.buffers[(idx - 1 + s.buffers.length) % s.buffers.length]
      if (prev) s.setActive(prev.id)
    })

    // Custom MenuBar events (Window menu)
    const handleTabNext = () => {
      const s = useEditorStore.getState()
      const idx = s.buffers.findIndex((b) => b.id === s.activeId)
      const next = s.buffers[(idx + 1) % s.buffers.length]
      if (next) s.setActive(next.id)
    }
    const handleTabPrev = () => {
      const s = useEditorStore.getState()
      const idx = s.buffers.findIndex((b) => b.id === s.activeId)
      const prev = s.buffers[(idx - 1 + s.buffers.length) % s.buffers.length]
      if (prev) s.setActive(prev.id)
    }
    window.addEventListener('tab:next-local', handleTabNext)
    window.addEventListener('tab:prev-local', handleTabPrev)

    // Window menu (Minimize / Zoom). The native menu's minimize/zoom roles only
    // act on macOS; on Windows/Linux the native menu is hidden, so the custom
    // MenuBar dispatches these events and we forward them to the main process.
    const handleWindowMinimize = () => window.api.send('window:minimize')
    const handleWindowZoom = () => window.api.send('window:toggle-maximize')
    window.addEventListener('window:minimize', handleWindowMinimize)
    window.addEventListener('window:zoom', handleWindowZoom)

    // External file change notifications
    window.api.on('file:externally-changed', (...args) => {
      const fp = args[0] as string
      const buf = useEditorStore.getState().buffers.find((b) => b.filePath === fp)
      if (!buf) return
      if (buf.isDirty) {
        useUIStore.getState().addToast(`"${buf.title}" changed on disk. Use Reload to update.`, 'warn')
      } else {
        reloadBuffer(buf.id)
        useUIStore.getState().addToast(`"${buf.title}" reloaded (external change)`, 'info')
      }
    })
    window.api.on('file:externally-deleted', (...args) => {
      const fp = args[0] as string
      const buf = useEditorStore.getState().buffers.find((b) => b.filePath === fp)
      if (buf) useUIStore.getState().addToast(`"${buf.title}" was deleted from disk.`, 'warn')
    })

    // Restore session (lazy 2-phase: ghost buffers first, then load active tab)
    window.api.on('session:restore', (...args) => {
      const session = args[0] as SessionData
      // Restore if EITHER files OR virtualTabs are present (a session that
      // contains only a "What's New" virtual tab and no files still needs
      // restoreSession to walk session.virtualTabs).
      if (session?.files?.length || session?.virtualTabs?.length) {
        restoreSession(session)
      }
      // Restore sidebar/file-browser state. Set expandedFolders BEFORE the
      // workspaceFolder so FileBrowserPanel's load effect can rebuild the tree
      // with the previously-expanded folders.
      if (Array.isArray(session?.expandedFolders)) {
        useUIStore.getState().setExpandedFolders(session.expandedFolders)
      }
      if (session?.workspaceFolder) {
        useUIStore.getState().setWorkspaceFolder(session.workspaceFolder)
      }
      if (session?.sidebarPanel) {
        useUIStore.getState().setSidebarPanel(session.sidebarPanel)
      }
      if (typeof session?.sidebarVisible === 'boolean') {
        useUIStore.getState().setShowSidebar(session.sidebarVisible)
      }
      // Mark the auto-open trigger ready: any restored buffers are now in
      // place, so the auto-open will append AFTER them (BR-002 + Test 6).
      setReadyForAutoOpen(true)
    })

    // Before close: check for unsaved buffers, flush config, then save session.
    // When `rememberUnsavedOnExit` is on, the prompt is suppressed and dirty
    // buffers are flushed to backup files instead — they'll be restored on
    // next launch.
    window.api.on('app:before-close', async () => {
      const remember = useConfigStore.getState().rememberUnsavedOnExit
      const dirty = useEditorStore.getState().buffers.filter((b) => b.isDirty)
      if (dirty.length > 0 && !remember) {
        const names = dirty.map((b) => b.title).join(', ')
        const ok = await window.api.dialog.confirm(
          'Close without saving?',
          `Unsaved changes in: ${names}`,
          'Close without saving'
        )
        if (!ok) {
          window.api.send('app:close-cancelled')
          return
        }
      }
      await useConfigStore.getState().save()

      // Final flush: write the latest contents of every dirty file-buffer to
      // its backup before we serialize the session. Skipping this would risk
      // session.json referencing a stale backup if the user typed in the gap
      // since the last snapshot tick.
      if (remember) {
        for (const buf of useEditorStore.getState().buffers) {
          if (buf.kind !== 'file' || !buf.isDirty) continue
          const content = buf.model?.getValue() ?? buf.content
          let filename = buf.backupPath
          if (!filename) {
            filename = mintBackupFilename(buf.title)
            useEditorStore.getState().updateBuffer(buf.id, { backupPath: filename })
          }
          try {
            await backupApi().write(filename, content)
          } catch {
            // best-effort — if disk is full the next launch just won't restore
          }
        }
      }

      // Capture current editor's viewState before building session payload
      const editor = editorRegistry.get()
      const state = useEditorStore.getState()
      if (editor && state.activeId) {
        const vs = editor.saveViewState()
        if (vs) state.updateBuffer(state.activeId, { viewState: vs })
      }

      const freshState = useEditorStore.getState()
      const uiState = useUIStore.getState()

      // Session v3: virtualTabs first, then files. activeIndex is a flat index into virtualTabs++files.
      // When `rememberUnsavedOnExit` is on, untitled buffers (no filePath) are kept too as long as
      // they have a backupPath that the snapshot timer has been writing to.
      const virtualBuffers = freshState.buffers.filter((b) => b.kind !== 'file')
      const fileBuffers = freshState.buffers.filter((b) => {
        if (b.kind !== 'file') return false
        if (b.filePath) return true
        return remember && !!b.backupPath
      })

      let activeIndex = 0
      const active = freshState.buffers.find((b) => b.id === freshState.activeId)
      if (active) {
        if (active.kind === 'file') {
          const i = fileBuffers.findIndex((b) => b.id === active.id)
          activeIndex = i >= 0 ? virtualBuffers.length + i : 0
        } else {
          const i = virtualBuffers.findIndex((b) => b.id === active.id)
          activeIndex = i >= 0 ? i : 0
        }
      }

      window.api.send('session:save', {
        version: 4,
        files: fileBuffers.map((b) => ({
          filePath: b.filePath,
          // For untitled buffers, persist the title so restore can re-open with the same name.
          title: b.filePath ? null : b.title,
          language: b.language,
          encoding: b.encoding,
          hasBom: b.hasBom,
          eol: b.eol,
          // Use live viewState if available, fall back to savedViewState for ghost tabs
          viewState: b.viewState ? JSON.parse(JSON.stringify(b.viewState)) : b.savedViewState,
          backupPath: remember ? b.backupPath : null,
          originalMtime: b.mtime || 0,
          isDirty: b.isDirty
        })),
        virtualTabs: virtualBuffers.map((b) => ({
          kind: b.kind,
          ...(b.kind === 'pluginDetail' && b.pluginId ? { pluginId: b.pluginId } : {})
        })),
        activeIndex,
        workspaceFolder: uiState.workspaceFolder,
        sidebarVisible: uiState.showSidebar,
        sidebarPanel: uiState.sidebarPanel,
        expandedFolders: uiState.expandedFolders
      })
      window.api.send('app:close-confirmed')
    })

    // Signal the main process that our IPC listeners are attached. This drains
    // pendingOpenItems (files passed via Explorer "Open with NovaPad" on cold
    // launch). did-finish-load is too early — it fires before this useEffect
    // runs, so IPCs sent then would land on a not-yet-registered listener and
    // be lost.
    window.api.send('app:renderer-ready')

    return () => {
      window.api.off('menu:file-new')
      window.api.off('menu:file-open')
      window.api.off('deeplink:open')
      window.api.off('deeplink:new')
      window.api.off('menu:file-save')
      window.api.off('menu:file-save-as')
      window.api.off('menu:file-save-all')
      window.api.off('menu:file-close')
      window.api.off('menu:file-close-all')
      window.api.off('menu:file-reload')
      window.api.off('menu:find')
      window.api.off('menu:replace')
      window.api.off('menu:find-in-files')
      window.api.off('menu:mark')
      window.api.off('ui:toggle-theme')
      window.api.off('ui:toggle-toolbar')
      window.api.off('ui:toggle-statusbar')
      window.api.off('ui:toggle-sidebar')
      window.api.off('ui:toggle-split-view')
      window.api.off('ui:show-toast')
      window.api.off('tab:next')
      window.api.off('tab:prev')
      window.api.off('session:restore')
      window.api.off('app:before-close')
      window.api.off('menu:folder-open')
      window.api.off('menu:goto-file')
      window.api.off('file:externally-changed')
      window.api.off('file:externally-deleted')
      window.api.off('menu:plugin-manager')
      window.api.off('plugin:open-csv-viewer')
      window.api.off('menu:about')
      window.api.off('menu:settings-open')
      window.api.off('menu:shortcuts-open')
      window.api.off('menu:whats-new-open')
      window.api.off('menu:tools-open')
      window.api.off('menu:tools-hash')
      window.api.off('menu:check-for-updates')
      window.api.off('plugin:add-menu-item')
      window.api.off('plugin:state-changed')
      window.removeEventListener('window:minimize', handleWindowMinimize)
      window.removeEventListener('window:zoom', handleWindowZoom)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // On startup: fetch plugin list (welcome screen shown when no buffers)
  useEffect(() => {
    usePluginStore.getState().fetchPlugins()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // AutoSave: save dirty buffers on interval when enabled
  const { autoSaveEnabled, autoSaveIntervalMs } = useConfigStore()
  useEffect(() => {
    if (!autoSaveEnabled) return
    const timer = setInterval(() => {
      useEditorStore.getState().buffers
        .filter((b) => b.isDirty && b.filePath)
        .forEach((b) => saveBuffer(b.id))
    }, autoSaveIntervalMs)
    return () => clearInterval(timer)
  }, [autoSaveEnabled, autoSaveIntervalMs, saveBuffer])

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background text-foreground" data-testid="app">
      {/* Menu Bar — Win/Linux only (returns null on macOS) */}
      <MenuBar
        onNew={newFile}
        onOpen={handleOpenFile}
        onOpenFolder={async () => {
          const dir = await window.api.file.openDirDialog()
          if (dir) {
            useUIStore.getState().setWorkspaceFolder(dir)
            useUIStore.getState().setShowSidebar(true)
            useUIStore.getState().setSidebarPanel('files')
          }
        }}
        onSave={() => { const id = useEditorStore.getState().activeId; if (id) saveBuffer(id) }}
        onSaveAs={() => saveActiveAs()}
        onSaveAll={() => void saveAllBuffers()}
        onClose={() => { const id = useEditorStore.getState().activeId; if (id) void closeBuffer(id) }}
        onCloseAll={() => void closeAllBuffers()}
        onFind={() => openFind('find')}
        onReplace={() => openFind('replace')}
        onFindInFiles={() => openFind('findInFiles')}
        onReload={() => { const id = useEditorStore.getState().activeId; if (id) reloadBuffer(id) }}
        onOpenRecent={openFiles}
      />

      {/* QuickStrip — macOS only (separate row with app icon + quick actions) */}
      {window.api.platform === 'darwin' && (
        <QuickStrip
          onToggleSidebar={() => useUIStore.getState().setShowSidebar(!useUIStore.getState().showSidebar)}
        />
      )}

      {/* Toolbar — conditional on showToolbar */}
      {showToolbar && (
        <Toolbar
          onNew={newFile}
          onOpen={handleOpenFile}
          onSave={() => { const id = useEditorStore.getState().activeId; if (id) saveBuffer(id) }}
          onSaveAll={() => void saveAllBuffers()}
          onFind={() => openFind('find')}
          onReplace={() => openFind('replace')}
          onClose={() => { const id = useEditorStore.getState().activeId; if (id) void closeBuffer(id) }}
        />
      )}

      <div className="flex flex-row flex-1 overflow-hidden">
        <PanelGroup direction="vertical" id="main-vertical" className="flex-1 overflow-hidden">
          {/* Editor area */}
          <Panel id="editor-stack" order={1} minSize={15}>
            <PanelGroup direction="horizontal" id="sidebar-editor-split">
              {showSidebar && (
                <>
                  <Panel
                    id="sidebar"
                    order={1}
                    defaultSize={18}
                    minSize={12}
                    maxSize={40}
                    className="overflow-hidden"
                  >
                    <Sidebar />
                  </Panel>
                  <PanelResizeHandle
                    id="sidebar-resize"
                    className="w-1 bg-border cursor-col-resize shrink-0 transition-colors hover:bg-primary data-[resize-handle-active]:bg-primary"
                  />
                </>
              )}
              <Panel id="editor-main" order={2} defaultSize={showSidebar ? 82 : 100} minSize={20}>
                <PanelGroup direction="horizontal" id="editor-preview-split" className="h-full">
                  <Panel id="editor-content" order={1} defaultSize={editorContentSize} minSize={20}>
                    <div className="flex flex-col h-full overflow-hidden">
                      <TabBar onClose={closeBuffer} onNewFile={newFile} />
                      <div className="flex flex-1 overflow-hidden relative">
                        {!activeId ? (
                          // No active tab: show WelcomeScreen even if inactive virtual
                          // tabs exist (e.g., a background-opened "What's New" tab on
                          // fresh install). Otherwise we'd render an empty EditorPane.
                          <WelcomeScreen
                            onNewFile={newFile}
                            onOpenFile={handleOpenFile}
                            onOpenRecent={openFiles}
                          />
                        ) : (
                          <>
                            {/* Monaco stays mounted so switching to a virtual tab preserves file view state */}
                            <EditorPane activeId={activeId} />
                            {activeKind === 'settings' && (
                              <div className="absolute inset-0 bg-background z-10"><SettingsTab /></div>
                            )}
                            {activeKind === 'shortcuts' && (
                              <div className="absolute inset-0 bg-background z-10"><ShortcutsTab /></div>
                            )}
                            {activeKind === 'whatsNew' && (
                              <div className="absolute inset-0 bg-background z-10"><WhatsNewTab /></div>
                            )}
                            {activeKind === 'pluginManager' && (
                              <div className="absolute inset-0 bg-background z-10"><PluginManagerTab /></div>
                            )}
                            {activeKind === 'pluginDetail' && activeBuffer?.pluginId && (
                              <div className="absolute inset-0 bg-background z-10">
                                <PluginDetailTab pluginId={activeBuffer.pluginId} />
                              </div>
                            )}
                            {previewInlineVisible && (
                              <div className="absolute inset-0 bg-background z-10" data-testid="preview-inline">
                                <Suspense fallback={
                                  <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                                    Loading preview…
                                  </div>
                                }>
                                  {previewKind === 'markdown' && <MarkdownPreviewPane />}
                                  {previewKind === 'sqlplan' && <SqlPlanPreviewPane />}
                                  {previewKind === 'csv' && <TableLensPreviewPane />}
                                  {previewKind === 'json' && <JsonPreviewPane />}
                                </Suspense>
                              </div>
                            )}
                            {/* Floating provider badge — inside the editor's
                                relative wrapper so it tracks the pane as the
                                sidebar/preview/split resize it. */}
                            {aiBadgeVisible && <AiBadge />}
                          </>
                        )}
                      </div>
                    </div>
                  </Panel>
                  {splitVisible && (
                    <>
                      <PanelResizeHandle
                        id="split-editor-resize"
                        className="w-1 bg-border cursor-col-resize shrink-0 transition-colors hover:bg-primary data-[resize-handle-active]:bg-primary"
                      />
                      <Panel id="split-editor-pane" order={2} defaultSize={sidePaneSize} minSize={15}>
                        <SplitEditorPane />
                      </Panel>
                    </>
                  )}
                  {previewVisible && (
                    <>
                      <PanelResizeHandle
                        id="md-preview-resize"
                        className="w-1 bg-border cursor-col-resize shrink-0 transition-colors hover:bg-primary data-[resize-handle-active]:bg-primary"
                      />
                      <Panel id="preview-pane" order={3} defaultSize={sidePaneSize} minSize={20}>
                        <Suspense fallback={
                          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                            Loading preview…
                          </div>
                        }>
                          {previewKind === 'markdown' && <MarkdownPreviewPane />}
                          {previewKind === 'sqlplan' && <SqlPlanPreviewPane />}
                          {previewKind === 'csv' && <TableLensPreviewPane />}
                          {previewKind === 'json' && <JsonPreviewPane />}
                        </Suspense>
                      </Panel>
                    </>
                  )}
                  {aiPanelVisible && (
                    <>
                      <PanelResizeHandle
                        id="ai-chat-resize"
                        className="w-1 bg-border cursor-col-resize shrink-0 transition-colors hover:bg-primary data-[resize-handle-active]:bg-primary"
                      />
                      <Panel id="ai-chat-pane" order={4} defaultSize={sidePaneSize} minSize={18}>
                        <Suspense fallback={
                          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                            Loading assistant…
                          </div>
                        }>
                          <AiChatPanel />
                        </Suspense>
                      </Panel>
                    </>
                  )}
                </PanelGroup>
              </Panel>
            </PanelGroup>
          </Panel>

          {/* Bottom panel (resizable) */}
          {showBottomPanel && (
            <>
              <PanelResizeHandle
                id="bottom-panel-resize"
                className="h-1 bg-border cursor-row-resize shrink-0 transition-colors hover:bg-primary data-[resize-handle-active]:bg-primary"
              />
              <Panel id="bottom-panel" order={2} defaultSize={25} minSize={8} maxSize={70}>
                <BottomPanelContainer />
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>

      {showStatusBar && !!activeId && activeKind === 'file' && <StatusBar />}

      <FindReplaceDialog />
      <AboutDialog />
      <QuickOpenPalette />
      <ToolsPanel />
      {csvViewerOpen && <CsvViewerOverlay csvText={csvViewerText} fileName={csvViewerFileName} />}
      {compareOpen && (
        <Suspense fallback={
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background text-xs text-muted-foreground">
            Loading compare…
          </div>
        }>
          <CompareOverlay />
        </Suspense>
      )}
      {transformOpen && (
        <Suspense fallback={
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background text-xs text-muted-foreground">
            Loading diagram…
          </div>
        }>
          <TransformOverlay />
        </Suspense>
      )}
      {previewFullscreenVisible && (
        <Suspense fallback={
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background text-xs text-muted-foreground">
            Loading preview…
          </div>
        }>
          {previewKind === 'markdown' && <MarkdownPreviewPane />}
          {previewKind === 'sqlplan' && <SqlPlanPreviewPane />}
          {previewKind === 'csv' && <TableLensPreviewPane />}
          {previewKind === 'json' && <JsonPreviewPane />}
        </Suspense>
      )}
      {dragActive && <DropOverlay />}
      <Toaster position="bottom-right" richColors closeButton />
      <SonnerBridge />
    </div>
  )
}

/** Full-window overlay shown while a file/folder is being dragged over the app. */
function DropOverlay(): React.ReactElement {
  return (
    <div
      data-testid="drop-overlay"
      className="pointer-events-none fixed inset-0 z-[1000] flex items-center justify-center bg-primary/10 backdrop-blur-sm border-4 border-dashed border-primary/60"
    >
      <div className="rounded-lg bg-background/90 px-6 py-4 text-base font-medium shadow-lg">
        Drop files or folder to open
      </div>
    </div>
  )
}

/** Bridge uiStore.addToast() calls to Sonner */
function SonnerBridge() {
  const seenRef = useRef(new Set<string>())
  useEffect(() => {
    const unsub = useUIStore.subscribe((state) => {
      for (const t of state.toasts) {
        if (!seenRef.current.has(t.id)) {
          seenRef.current.add(t.id)
          if (t.level === 'error') toast.error(t.message)
          else if (t.level === 'warn') toast.warning(t.message)
          else toast.info(t.message)
          // Auto-remove from uiStore since Sonner manages display lifecycle
          setTimeout(() => useUIStore.getState().removeToast(t.id), 100)
        }
      }
    })
    return unsub
  }, [])
  return null
}
