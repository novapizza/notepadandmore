import { create } from 'zustand'
import type { SchemaModel } from '../utils/schemaParse/types'

type Theme = string
export type BottomPanelId = 'findResults' | 'console'

export type UIToggleKey =
  | 'showToolbar'
  | 'showStatusBar'
  | 'showSidebar'
  | 'wordWrap'
  | 'renderWhitespace'
  | 'showEOL'
  | 'showNonPrinting'
  | 'showControlChars'
  | 'indentationGuides'
  | 'columnSelectMode'
  | 'splitView'

interface UIState {
  theme: Theme
  showToolbar: boolean
  showStatusBar: boolean
  showSidebar: boolean
  wordWrap: boolean
  renderWhitespace: boolean
  showEOL: boolean
  showNonPrinting: boolean
  showControlChars: boolean
  indentationGuides: boolean
  columnSelectMode: boolean
  splitView: boolean
  /** Keep in sync with the local unions in SideNav.tsx / Sidebar.tsx and with
   *  SidebarPanel in main/sessions/SessionManager.ts.
   *  Notes is deliberately NOT a member: it stacks below the active panel as its
   *  own view (VS Code's Explorer/Outline layout) rather than replacing it. */
  sidebarPanel: 'files' | 'search' | 'plugins' | 'functions' | 'docmap'
  /** Whether the Notes view is expanded at the bottom of the sidebar. Independent
   *  of sidebarPanel, so opening Notes never closes the File Explorer. */
  showNotes: boolean
  /** Transient (not persisted): the Notes toggle is what opened the sidebar, so
   *  collapsing Notes should hide it again rather than leaving behind a panel the
   *  user never asked for. Cleared whenever the sidebar is hidden by other means. */
  notesOpenedSidebar: boolean
  workspaceFolder: string | null
  /** Paths of folders currently expanded in the File Browser tree (persisted across sessions). */
  expandedFolders: string[]
  showFindReplace: boolean
  findReplaceMode: 'find' | 'replace' | 'findInFiles' | 'mark'
  findInitialTerm: string
  /** Bumped on every openFind() call so the dialog re-applies the selection/focus even when already open. */
  findOpenNonce: number
  /**
   * Whether the right-side preview pane is open. The pane's content is
   * decided by the active buffer's type — Markdown gets the rendered HTML,
   * .sqlplan / ShowPlanXML gets the modern execution-plan tree, .csv gets
   * the Table Lens viewer. One flag drives all three so the user-visible
   * state is "preview is open / closed".
   */
  showPreview: boolean
  /**
   * Whether the preview pane is in fullscreen mode (overlays the whole window
   * instead of sharing the split with the editor). Always implies showPreview;
   * resetting showPreview also clears this flag.
   */
  previewFullscreen: boolean
  /**
   * How an open (non-fullscreen) preview is laid out:
   *  - 'side'   → preview panel beside the editor (Ctrl/Cmd+P default)
   *  - 'inline' → preview replaces the editor in the current tab area
   * Only meaningful while showPreview is true and previewFullscreen is false.
   */
  previewLayout: 'side' | 'inline'
  /** @deprecated kept temporarily for any callers that read it; mirrors showPreview. */
  showMarkdownPreview: boolean
  showAbout: boolean
  /** VSCode-style Quick Open (Ctrl+P) file-finder palette visibility. */
  quickOpenVisible: boolean
  showBottomPanel: boolean
  activeBottomPanel: BottomPanelId
  toasts: Array<{ id: string; message: string; level: 'info' | 'warn' | 'error' }>
  csvViewerOpen: boolean
  csvViewerText: string
  csvViewerFileName: string
  /**
   * Fullscreen "Compare with…" overlay state. Triggered from the tab
   * right-click submenu; renders a side-by-side / unified diff between two
   * arbitrary buffers. Kept in uiStore (not editorStore) because the source
   * tabs themselves don't change — this is a transient view.
   */
  compareOpen: boolean
  compareLeft: { title: string; content: string } | null
  compareRight: { title: string; content: string } | null
  /**
   * Fullscreen "Transform → ER Diagram" overlay state. Triggered explicitly
   * by Ctrl+Alt+Shift+K — NOT routed through Ctrl+P preview. Source format
   * (Prisma / DBML / DDL) is detected by content sniff at parse time.
   */
  transformOpen: boolean
  transformModel: SchemaModel | null
  transformKind: 'prisma' | 'dbml' | 'ddl' | null
  transformTitle: string | null
  /** Transient: when set, the Settings tab consumes it on mount/focus and switches
   *  to that category, then clears the value. Used to deep-link from the gear menu
   *  and the native "Keyboard Shortcuts" menu item. */
  pendingSettingsCategory: string | null
  /** Currently-selected Settings category. Kept in the store (not local component
   *  state) so it survives the SettingsTab unmounting when the user switches tabs. */
  settingsCategory: string
  /**
   * Developer Tools panel (UUID/epoch/color/cron/lorem/jwt/url/csp/hash). A
   * single modal hosts every tool; `activeToolId` selects which one is shown.
   * `toolArgs` carries an optional preset for the active tool (e.g. the hash
   * algorithm to pre-select, or file-hash results to display).
   */
  toolsPanelOpen: boolean
  activeToolId: string | null
  toolArgs: Record<string, unknown> | null

  setTheme: (t: Theme) => void
  toggleTheme: () => void
  setShowToolbar: (v: boolean, fromMain?: boolean) => void
  setShowStatusBar: (v: boolean, fromMain?: boolean) => void
  setShowSidebar: (v: boolean, fromMain?: boolean) => void
  setWordWrap: (v: boolean, fromMain?: boolean) => void
  setRenderWhitespace: (v: boolean, fromMain?: boolean) => void
  setShowEOL: (v: boolean, fromMain?: boolean) => void
  setShowNonPrinting: (v: boolean, fromMain?: boolean) => void
  setShowControlChars: (v: boolean, fromMain?: boolean) => void
  setIndentationGuides: (v: boolean, fromMain?: boolean) => void
  setColumnSelectMode: (v: boolean, fromMain?: boolean) => void
  setSplitView: (v: boolean, fromMain?: boolean) => void
  syncToggleToMain: (key: UIToggleKey, value: boolean) => void
  setSidebarPanel: (p: UIState['sidebarPanel']) => void
  /** Raw setter — session restore only. Callers reacting to a user action want
   *  revealNotes/hideNotes instead, so the sidebar bookkeeping stays correct. */
  setShowNotes: (v: boolean) => void
  /** Expand the Notes view, opening the sidebar if it was closed. */
  revealNotes: () => void
  /** Collapse the Notes view, restoring the sidebar to hidden if Notes is what
   *  opened it. Leaves the panel above Notes untouched otherwise. */
  hideNotes: () => void
  /** Expand the Notes view (opening the sidebar if needed), or collapse it if
   *  it's already showing — the panel above it is left alone either way. Lives
   *  here so the keyboard, both menus, and the toolbar share one implementation. */
  toggleNotesPanel: () => void
  setWorkspaceFolder: (path: string | null) => void
  setExpandedFolders: (paths: string[]) => void
  openFind: (mode?: 'find' | 'replace' | 'findInFiles' | 'mark', initialTerm?: string) => void
  closeFind: () => void
  togglePreview: () => void
  setShowPreview: (v: boolean) => void
  togglePreviewFullscreen: () => void
  setPreviewFullscreen: (v: boolean) => void
  setPreviewLayout: (v: 'side' | 'inline') => void
  /** @deprecated alias of togglePreview / setShowPreview. */
  toggleMarkdownPreview: () => void
  setMarkdownPreview: (v: boolean) => void
  setShowAbout: (v: boolean) => void
  setQuickOpenVisible: (v: boolean) => void
  setShowBottomPanel: (v: boolean) => void
  setActiveBottomPanel: (p: BottomPanelId) => void
  addToast: (message: string, level?: 'info' | 'warn' | 'error') => void
  removeToast: (id: string) => void
  openCsvViewer: (csvText: string, fileName: string) => void
  closeCsvViewer: () => void
  openCompare: (left: { title: string; content: string }, right: { title: string; content: string }) => void
  closeCompare: () => void
  openTransform: (model: SchemaModel, kind: 'prisma' | 'dbml' | 'ddl', title: string) => void
  closeTransform: () => void
  setPendingSettingsCategory: (cat: string | null) => void
  setSettingsCategory: (cat: string) => void
  openTool: (id: string, args?: Record<string, unknown>) => void
  closeTools: () => void
}

/**
 * The top-level overlays that all live on the same fixed z-[9000] layer in
 * App.tsx (Find & Replace, About, Quick Open, Tools). They each create their
 * own stacking context at the same z-index, so when two are open at once the
 * later one in the DOM wins — and the modal ones (About/QuickOpen/Tools) have a
 * full-screen pointer-events backdrop that then swallows clicks meant for
 * whatever is behind it. Find & Replace is non-modal and rendered first, so it
 * was the usual victim: it stayed visible but became unclickable when another
 * overlay was opened on top (e.g. via the OS menu or a shortcut, which fire
 * even while a modal is up). Spreading this into every open-action makes the
 * layer mutually exclusive: opening one overlay closes the others, so a
 * blocking backdrop can never sit over another dialog.
 */
const CLOSE_TOP_OVERLAYS = {
  showFindReplace: false,
  showAbout: false,
  quickOpenVisible: false,
  toolsPanelOpen: false,
} as const

export const useUIStore = create<UIState>((set, get) => ({
  theme: 'dark',
  showToolbar: true,
  showStatusBar: true,
  showSidebar: false,
  wordWrap: false,
  renderWhitespace: false,
  showEOL: false,
  showNonPrinting: false,
  showControlChars: false,
  indentationGuides: true,
  columnSelectMode: false,
  splitView: false,
  sidebarPanel: 'files',
  showNotes: false,
  notesOpenedSidebar: false,
  workspaceFolder: null,
  expandedFolders: [],
  showFindReplace: false,
  findReplaceMode: 'find',
  findInitialTerm: '',
  findOpenNonce: 0,
  showPreview: false,
  previewFullscreen: false,
  previewLayout: 'side',
  showMarkdownPreview: false,
  showAbout: false,
  quickOpenVisible: false,
  showBottomPanel: false,
  activeBottomPanel: 'findResults',
  toasts: [],
  csvViewerOpen: false,
  csvViewerText: '',
  csvViewerFileName: '',
  compareOpen: false,
  compareLeft: null,
  compareRight: null,
  transformOpen: false,
  transformModel: null,
  transformKind: null,
  transformTitle: null,
  pendingSettingsCategory: null,
  settingsCategory: 'general',
  toolsPanelOpen: false,
  activeToolId: null,
  toolArgs: null,

  setTheme: (t) => set({ theme: t }),
  toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
  syncToggleToMain: (key, value) => {
    window.api.send('ui:state-changed', { key, value })
  },
  setShowToolbar: (v, fromMain) => {
    set({ showToolbar: v })
    if (!fromMain) get().syncToggleToMain('showToolbar', v)
  },
  setShowStatusBar: (v, fromMain) => {
    set({ showStatusBar: v })
    if (!fromMain) get().syncToggleToMain('showStatusBar', v)
  },
  setShowSidebar: (v, fromMain) => {
    // Hiding the sidebar by any other route (Mod+B, the ✕, Show/Hide Explorer)
    // invalidates the "Notes opened me" bookkeeping.
    set(v ? { showSidebar: v } : { showSidebar: v, notesOpenedSidebar: false })
    if (!fromMain) get().syncToggleToMain('showSidebar', v)
  },
  setWordWrap: (v, fromMain) => {
    set({ wordWrap: v })
    if (!fromMain) get().syncToggleToMain('wordWrap', v)
  },
  setRenderWhitespace: (v, fromMain) => {
    set({ renderWhitespace: v })
    if (!fromMain) get().syncToggleToMain('renderWhitespace', v)
  },
  setShowEOL: (v, fromMain) => {
    set({ showEOL: v })
    if (!fromMain) get().syncToggleToMain('showEOL', v)
  },
  setShowNonPrinting: (v, fromMain) => {
    set({ showNonPrinting: v })
    if (!fromMain) get().syncToggleToMain('showNonPrinting', v)
  },
  setShowControlChars: (v, fromMain) => {
    set({ showControlChars: v })
    if (!fromMain) get().syncToggleToMain('showControlChars', v)
  },
  setIndentationGuides: (v, fromMain) => {
    set({ indentationGuides: v })
    if (!fromMain) get().syncToggleToMain('indentationGuides', v)
  },
  setColumnSelectMode: (v, fromMain) => {
    set({ columnSelectMode: v })
    if (!fromMain) get().syncToggleToMain('columnSelectMode', v)
  },
  setSplitView: (v, fromMain) => {
    set({ splitView: v })
    if (!fromMain) get().syncToggleToMain('splitView', v)
  },
  setSidebarPanel: (p) => set({ sidebarPanel: p }),
  setShowNotes: (v) => set({ showNotes: v }),
  revealNotes: () => {
    const s = get()
    // Remember if we are the reason the sidebar is opening, so dismissing Notes
    // is a true round-trip back to the previous layout. Don't clear an existing
    // claim when the sidebar is already open on our behalf.
    set({ showNotes: true, notesOpenedSidebar: s.notesOpenedSidebar || !s.showSidebar })
    s.setShowSidebar(true)
  },
  hideNotes: () => {
    const s = get()
    set({ showNotes: false, notesOpenedSidebar: false })
    if (s.notesOpenedSidebar) s.setShowSidebar(false)
  },
  toggleNotesPanel: () => {
    const s = get()
    // Collapse only the Notes view; whatever panel is above it stays put.
    if (s.showNotes && s.showSidebar) s.hideNotes()
    else s.revealNotes()
  },
  setWorkspaceFolder: (path) => set({ workspaceFolder: path }),
  setExpandedFolders: (paths) => set({ expandedFolders: paths }),
  openFind: (mode = 'find', initialTerm = '') =>
    set((s) => ({ ...CLOSE_TOP_OVERLAYS, showFindReplace: true, findReplaceMode: mode, findInitialTerm: initialTerm, findOpenNonce: s.findOpenNonce + 1 })),
  closeFind: () => set({ showFindReplace: false }),
  togglePreview: () =>
    set((s) => ({
      showPreview: !s.showPreview,
      showMarkdownPreview: !s.showPreview,
      previewFullscreen: s.showPreview ? false : s.previewFullscreen,
      // Ctrl/Cmd+P always opens the side layout; inline is button-only.
      previewLayout: s.showPreview ? s.previewLayout : 'side',
    })),
  setShowPreview: (v) =>
    set((s) => ({ showPreview: v, showMarkdownPreview: v, previewFullscreen: v ? s.previewFullscreen : false })),
  setPreviewLayout: (v) => set({ previewLayout: v }),
  togglePreviewFullscreen: () =>
    set((s) => ({
      previewFullscreen: !s.previewFullscreen,
      showPreview: s.previewFullscreen ? s.showPreview : true,
      showMarkdownPreview: s.previewFullscreen ? s.showMarkdownPreview : true,
    })),
  setPreviewFullscreen: (v) =>
    set((s) => ({
      previewFullscreen: v,
      showPreview: v ? true : s.showPreview,
      showMarkdownPreview: v ? true : s.showMarkdownPreview,
    })),
  toggleMarkdownPreview: () =>
    set((s) => ({
      showPreview: !s.showPreview,
      showMarkdownPreview: !s.showPreview,
      previewFullscreen: s.showPreview ? false : s.previewFullscreen,
    })),
  setMarkdownPreview: (v) =>
    set((s) => ({ showPreview: v, showMarkdownPreview: v, previewFullscreen: v ? s.previewFullscreen : false })),
  setShowAbout: (v) => set(v ? { ...CLOSE_TOP_OVERLAYS, showAbout: true } : { showAbout: false }),
  setQuickOpenVisible: (v) => set(v ? { ...CLOSE_TOP_OVERLAYS, quickOpenVisible: true } : { quickOpenVisible: false }),
  setShowBottomPanel: (v) => set({ showBottomPanel: v }),
  setActiveBottomPanel: (p) => set({ activeBottomPanel: p }),

  addToast: (message, level = 'info') => {
    const id = Date.now().toString()
    set((s) => ({ toasts: [...s.toasts, { id, message, level }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000)
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  openCsvViewer: (csvText, fileName) => set({ csvViewerOpen: true, csvViewerText: csvText, csvViewerFileName: fileName }),
  closeCsvViewer: () => set({ csvViewerOpen: false, csvViewerText: '', csvViewerFileName: '' }),
  openCompare: (left, right) => set({ compareOpen: true, compareLeft: left, compareRight: right }),
  closeCompare: () => set({ compareOpen: false, compareLeft: null, compareRight: null }),
  openTransform: (model, kind, title) =>
    set({ transformOpen: true, transformModel: model, transformKind: kind, transformTitle: title }),
  closeTransform: () =>
    set({ transformOpen: false, transformModel: null, transformKind: null, transformTitle: null }),
  setPendingSettingsCategory: (cat) => set({ pendingSettingsCategory: cat }),
  setSettingsCategory: (cat) => set({ settingsCategory: cat }),
  openTool: (id, args) => set({ ...CLOSE_TOP_OVERLAYS, toolsPanelOpen: true, activeToolId: id, toolArgs: args ?? null }),
  closeTools: () => set({ toolsPanelOpen: false, toolArgs: null })
}))
