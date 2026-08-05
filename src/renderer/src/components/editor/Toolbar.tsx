import {
  FilePlus, FolderOpen, Save, SaveAll, FileX,
  Scissors, Copy, Clipboard,
  Undo2, Redo2,
  Search, Replace,
  ZoomIn, ZoomOut, RotateCcw,
  IndentIncrease, IndentDecrease, MessageSquare,
  ArrowUpDown, Eraser,
  Files, ListTree, Map as MapIcon, StickyNote,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { editorRegistry } from '../../utils/editorRegistry'
import { useUIStore } from '../../store/uiStore'
import { shortcutMod } from '../../utils/platform'

interface ToolbarProps {
  onNew: () => void
  onOpen: () => void
  onSave: () => void
  onSaveAll: () => void
  onFind: () => void
  onReplace: () => void
  onClose: () => void
}

interface ToolbarItem {
  icon: React.ReactNode
  title: string
  action?: () => void
  /** Per-icon accent color (Tailwind text class). Falls back to toolbar-foreground. */
  color?: string
}

/** Open the sidebar to a specific panel, or close it if that panel is already showing. */
function toggleSidebarPanel(panel: 'files' | 'functions' | 'docmap') {
  const ui = useUIStore.getState()
  if (ui.showSidebar && ui.sidebarPanel === panel) {
    ui.setShowSidebar(false)
  } else {
    ui.setSidebarPanel(panel)
    ui.setShowSidebar(true)
  }
}

function editorCommand(command: string) {
  // Whole-window zoom is handled globally in App.tsx and must work even with no
  // active editor — route it through the shared editor:command event and bail
  // before the editor guard below.
  if (command === 'zoomIn' || command === 'zoomOut' || command === 'zoomReset') {
    window.dispatchEvent(new CustomEvent('editor:command', { detail: command }))
    return
  }
  const editor = editorRegistry.get()
  if (!editor) return
  switch (command) {
    case 'indentLines': editor.trigger('keyboard', 'editor.action.indentLines', {}); break
    case 'outdentLines': editor.trigger('keyboard', 'editor.action.outdentLines', {}); break
    case 'toggleComment': editor.getAction('editor.action.commentLine')?.run(); break
    case 'sortLinesAsc': editor.getAction('editor.action.sortLinesAscending')?.run(); break
    case 'trimTrailingWhitespace': editor.getAction('editor.action.trimTrailingWhitespace')?.run(); break
  }
}

// Tailwind classes per accent (kept as full strings so Tailwind's JIT picks them up).
const C_BLUE = 'text-blue-600 dark:text-blue-400'
const C_GREEN = 'text-emerald-600 dark:text-emerald-400'
const C_RED = 'text-red-500 dark:text-red-400'
const C_PURPLE = 'text-violet-600 dark:text-violet-400'
const C_ORANGE = 'text-amber-600 dark:text-amber-400'
const C_GRAY = 'text-slate-500 dark:text-slate-400'

export function Toolbar({ onNew, onOpen, onSave, onSaveAll, onFind, onReplace, onClose }: ToolbarProps) {
  const mod = shortcutMod()
  const sz = 20
  const groups: ToolbarItem[][] = [
    // File
    [
      { icon: <FilePlus size={sz} />, title: `New (${mod}+N)`, action: onNew, color: C_BLUE },
      { icon: <FolderOpen size={sz} />, title: `Open (${mod}+O)`, action: onOpen, color: C_BLUE },
      { icon: <Save size={sz} />, title: `Save (${mod}+S)`, action: onSave, color: C_GREEN },
      { icon: <SaveAll size={sz} />, title: 'Save All', action: onSaveAll, color: C_GREEN },
      { icon: <FileX size={sz} />, title: `Close (${mod}+W)`, action: onClose, color: C_RED },
    ],
    // Edit
    [
      { icon: <Undo2 size={sz} />, title: `Undo (${mod}+Z)`, action: () => window.dispatchEvent(new CustomEvent('editor:undo')), color: C_PURPLE },
      { icon: <Redo2 size={sz} />, title: `Redo (${mod}+Y)`, action: () => window.dispatchEvent(new CustomEvent('editor:redo')), color: C_PURPLE },
    ],
    // Clipboard
    [
      { icon: <Scissors size={sz} />, title: `Cut (${mod}+X)`, action: () => document.execCommand('cut'), color: C_RED },
      { icon: <Copy size={sz} />, title: `Copy (${mod}+C)`, action: () => document.execCommand('copy'), color: C_RED },
      { icon: <Clipboard size={sz} />, title: `Paste (${mod}+V)`, action: () => document.execCommand('paste'), color: C_PURPLE },
    ],
    // Search
    [
      { icon: <Search size={sz} />, title: `Find (${mod}+F)`, action: onFind, color: C_BLUE },
      { icon: <Replace size={sz} />, title: `Replace (${mod}+H)`, action: onReplace, color: C_BLUE },
    ],
    // Zoom
    [
      { icon: <ZoomIn size={sz} />, title: 'Zoom In', action: () => editorCommand('zoomIn'), color: C_GREEN },
      { icon: <ZoomOut size={sz} />, title: 'Zoom Out', action: () => editorCommand('zoomOut'), color: C_GREEN },
      { icon: <RotateCcw size={sz} />, title: 'Reset Zoom', action: () => editorCommand('zoomReset'), color: C_BLUE },
    ],
    // Formatting
    [
      { icon: <IndentIncrease size={sz} />, title: 'Indent', action: () => editorCommand('indentLines'), color: C_ORANGE },
      { icon: <IndentDecrease size={sz} />, title: 'Outdent', action: () => editorCommand('outdentLines'), color: C_ORANGE },
      { icon: <MessageSquare size={sz} />, title: 'Toggle Comment', action: () => editorCommand('toggleComment'), color: C_ORANGE },
    ],
    // Actions
    [
      { icon: <ArrowUpDown size={sz} />, title: 'Sort Lines', action: () => editorCommand('sortLinesAsc'), color: C_RED },
      { icon: <Eraser size={sz} />, title: 'Trim Whitespace', action: () => editorCommand('trimTrailingWhitespace'), color: C_GRAY },
    ],
    // Panels — open the sidebar to a specific view
    [
      { icon: <Files size={sz} />, title: `Explorer (${mod}+B)`, action: () => toggleSidebarPanel('files'), color: C_BLUE },
      { icon: <ListTree size={sz} />, title: 'Function / Symbol List', action: () => toggleSidebarPanel('functions'), color: C_PURPLE },
      { icon: <MapIcon size={sz} />, title: 'Document Map', action: () => toggleSidebarPanel('docmap'), color: C_GREEN },
      // Notes stacks below the active panel rather than replacing it, so it goes
      // through toggleNotesPanel instead of toggleSidebarPanel.
      { icon: <StickyNote size={sz} />, title: `Notes (${mod}+Shift+N)`, action: () => useUIStore.getState().toggleNotesPanel(), color: C_ORANGE },
    ],
  ]

  return (
    <div className="h-11 bg-toolbar border-b border-toolbar-border flex items-center px-3 gap-1 select-none shrink-0 overflow-x-auto" data-testid="toolbar">
      <TooltipProvider delayDuration={300}>
        {groups.map((group, gi) => (
          <div key={gi} className="flex items-center gap-1">
            {gi > 0 && <div className="w-px h-6 bg-toolbar-border mx-2 shrink-0" />}
            {group.map((item, ii) => (
              <Tooltip key={ii}>
                <TooltipTrigger asChild>
                  <button
                    className={`w-9 h-9 flex items-center justify-center ${item.color ?? 'text-toolbar-foreground'} hover:bg-secondary active:bg-muted rounded-md transition-colors shrink-0`}
                    onClick={item.action}
                  >
                    {item.icon}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-base">
                  {item.title}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        ))}
      </TooltipProvider>
    </div>
  )
}
