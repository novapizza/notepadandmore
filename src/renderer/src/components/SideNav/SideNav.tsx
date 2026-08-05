import React from 'react'
import { Files, Search, Settings, Puzzle, ListTree, Map as MapIcon, StickyNote } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { useUIStore } from '../../store/uiStore'
import { useEditorStore } from '../../store/editorStore'
import { useConfigStore } from '../../store/configStore'
import { shortcutMod } from '../../utils/platform'
import { bindingDisplay } from '../../utils/shortcutCatalog'
import { cn } from '../../lib/utils'

// NOTE: this component is not currently mounted anywhere — the rendered icon
// list lives in components/editor/Toolbar.tsx. Kept in sync so it still behaves
// correctly if it is ever re-introduced.
//
// Must match UIState['sidebarPanel'] in store/uiStore.ts and the union in
// Sidebar.tsx. 'notes' is not a sidebarPanel — it has its own showNotes flag —
// so it is a nav id only.
type SidebarPanelId = 'files' | 'search' | 'plugins' | 'functions' | 'docmap'
type NavId = SidebarPanelId | 'notes'

// Ids handled by handleNav's panel branch. A panel missing from this set gets a
// dead SideNav button — the click falls through and does nothing.
const PANEL_IDS = new Set<string>(['files', 'project', 'docmap', 'functions'])

export function SideNav() {
  const mod = shortcutMod()
  const shortcuts = useConfigStore((s) => s.shortcuts)
  const NAV_ITEMS: { id: NavId; icon: React.ReactNode; label: string; tip: string }[] = [
    { id: 'files',     icon: <Files size={18} />,            label: 'Files',    tip: 'File Browser' },
    { id: 'search',    icon: <Search size={18} />,           label: 'Search',   tip: `Find & Replace (${mod}+F)` },
    { id: 'functions', icon: <ListTree size={18} />,         label: 'Symbols',  tip: 'Function / Symbol List' },
    { id: 'docmap',    icon: <MapIcon size={18} />,          label: 'Map',      tip: 'Document Map' },
    { id: 'plugins',   icon: <Puzzle size={18} />,           label: 'Plugins',  tip: 'Plugin Manager' },
    { id: 'notes',     icon: <StickyNote size={18} />,       label: 'Notes',    tip: `Notes (${bindingDisplay('view.notes', shortcuts)})` },
  ]
  const {
    sidebarPanel,
    showSidebar,
    showNotes,
    setSidebarPanel,
    setShowSidebar,
    toggleNotesPanel,
    openFind,
  } = useUIStore()

  const handleNav = (id: string) => {
    if (id === 'search') {
      openFind('find')
      return
    }
    if (id === 'notes') {
      // Notes stacks below the active panel instead of replacing it.
      toggleNotesPanel()
      return
    }
    if (id === 'preferences') {
      useEditorStore.getState().openVirtualTab('settings')
      return
    }
    if (id === 'plugins') {
      useEditorStore.getState().openPluginManagerTab()
      return
    }
    if (PANEL_IDS.has(id)) {
      const panelId = id as SidebarPanelId
      if (showSidebar && sidebarPanel === panelId) {
        setShowSidebar(false)
      } else {
        setSidebarPanel(panelId)
        setShowSidebar(true)
      }
    }
  }

  const isActive = (id: string) => {
    if (id === 'notes') return showSidebar && showNotes
    if (!PANEL_IDS.has(id)) return false
    return showSidebar && sidebarPanel === id
  }

  return (
    <nav className="flex flex-col w-12 h-full bg-sidebar border-r border-sidebar-border shrink-0 select-none overflow-hidden" data-testid="sidenav">
      <div className="flex flex-col flex-1 gap-0.5 py-1 min-h-0">
        <TooltipProvider delayDuration={300}>
          {NAV_ITEMS.map((item) => (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'flex flex-col items-center justify-center w-full min-h-[44px] py-2',
                    'border-l-2 border-transparent',
                    'text-muted-foreground transition-colors',
                    'hover:text-foreground hover:bg-sidebar-accent',
                    isActive(item.id) && 'text-primary bg-sidebar-accent border-l-primary'
                  )}
                  onClick={() => handleNav(item.id)}
                >
                  {item.icon}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{item.tip}</TooltipContent>
            </Tooltip>
          ))}
        </TooltipProvider>
      </div>

      <div className="shrink-0 flex flex-col mt-auto pb-2 gap-0.5">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="flex flex-col items-center justify-center w-full min-h-[44px] py-2 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
                onClick={() => handleNav('preferences')}
              >
                <Settings size={18} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Preferences</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </nav>
  )
}
