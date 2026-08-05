import React from 'react'
import { X } from 'lucide-react'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { useUIStore } from '../../store/uiStore'
import { FileBrowserPanel } from '../FileBrowser/FileBrowserPanel'
import { FunctionListPanel } from '../FunctionList/FunctionListPanel'
import { DocumentMapPanel } from '../DocumentMap/DocumentMapPanel'
import { NotesPanel } from '../Notes/NotesPanel'

// Must match UIState['sidebarPanel'] in store/uiStore.ts.
// 'search' and 'plugins' are reachable from SideNav but those handlers open
// the Find dialog / Plugin Manager tab instead of switching the sidebar, so
// in practice the sidebar renders the 'files', 'functions' and 'docmap'
// panels. 'search'/'plugins' are kept here as defensive fallbacks.
//
// Notes is NOT one of these. It is a second, independently-toggled view stacked
// below whichever panel is active (see uiStore.showNotes), so opening Notes
// doesn't take the File Explorer away.
type SidebarPanelId = 'files' | 'search' | 'plugins' | 'functions' | 'docmap'

const PANEL_TITLES: Record<SidebarPanelId, string> = {
  files:     'File Browser',
  search:    'Search',
  plugins:   'Plugins',
  functions: 'Function List',
  docmap:    'Document Map',
}

/** Shared header row for a sidebar view: title plus a dismiss button. */
function ViewHeader({ title, tip, onDismiss }: { title: string; tip: string; onDismiss: () => void }) {
  return (
    <div className="flex items-center h-9 px-3 border-b border-border shrink-0">
      <span className="flex-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </span>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              onClick={onDismiss}
            >
              <X size={18} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{tip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}

export function Sidebar() {
  const { sidebarPanel, setShowSidebar, showNotes, hideNotes } = useUIStore()

  const panels: Record<SidebarPanelId, React.ReactNode> = {
    files:     <FileBrowserPanel />,
    search:    <FileBrowserPanel />,
    plugins:   <FileBrowserPanel />,
    functions: <FunctionListPanel />,
    docmap:    <DocumentMapPanel />,
  }

  const primaryView = (
    <>
      <ViewHeader
        title={PANEL_TITLES[sidebarPanel]}
        tip="Close Sidebar"
        onDismiss={() => setShowSidebar(false)}
      />
      <div className="flex-1 overflow-hidden flex flex-col">
        {panels[sidebarPanel]}
      </div>
    </>
  )

  return (
    <div className="flex flex-col h-full bg-explorer overflow-hidden" data-testid="sidebar">
      {showNotes ? (
        // Two stacked views with a draggable divider, like VS Code's Explorer
        // over Outline. Notes gets its own ✕ that collapses only itself.
        <PanelGroup direction="vertical" id="sidebar-views" className="flex-1 min-h-0">
          <Panel id="sidebar-primary-view" order={1} defaultSize={55} minSize={15} className="flex flex-col overflow-hidden">
            {primaryView}
          </Panel>
          <PanelResizeHandle
            id="sidebar-notes-resize"
            className="h-1 bg-border cursor-row-resize shrink-0 transition-colors hover:bg-primary data-[resize-handle-active]:bg-primary"
          />
          <Panel id="sidebar-notes-view" order={2} defaultSize={45} minSize={15} className="flex flex-col overflow-hidden">
            <ViewHeader title="Notes" tip="Hide Notes" onDismiss={hideNotes} />
            <div className="flex-1 overflow-hidden flex flex-col">
              <NotesPanel />
            </div>
          </Panel>
        </PanelGroup>
      ) : (
        primaryView
      )}
    </div>
  )
}
