import { isMacOS } from './platform'

export type ShortcutSection = 'File' | 'Edit' | 'Search' | 'View' | 'Window'

export interface ShortcutDef {
  id: string
  label: string
  section: ShortcutSection
  /** Canonical binding using `Mod` for the platform-primary modifier (Ctrl on Win/Linux, Cmd on macOS).
   *  Examples: `Mod+S`, `Mod+Shift+F`, `Alt+Up`, `F2`, `Tab`. Use `+` to separate. */
  defaultKey: string
}

/** Single source of truth for menu/editor shortcuts. Order here drives the
 *  Settings > Shortcuts rendering (sections + within-section order). */
export const SHORTCUT_CATALOG: ShortcutDef[] = [
  // File
  { id: 'file.new',         label: 'New File',          section: 'File',   defaultKey: 'Mod+N' },
  { id: 'file.open',        label: 'Open File…',        section: 'File',   defaultKey: 'Mod+O' },
  { id: 'file.openFolder',  label: 'Open Folder…',      section: 'File',   defaultKey: 'Mod+Shift+O' },
  { id: 'file.save',        label: 'Save',              section: 'File',   defaultKey: 'Mod+S' },
  { id: 'file.saveAs',      label: 'Save As…',          section: 'File',   defaultKey: 'Mod+Shift+S' },
  { id: 'file.saveAll',     label: 'Save All',          section: 'File',   defaultKey: 'Mod+Alt+S' },
  { id: 'file.reload',      label: 'Reload from Disk',  section: 'File',   defaultKey: 'Mod+R' },
  { id: 'file.close',       label: 'Close File',        section: 'File',   defaultKey: 'Mod+W' },

  // Edit
  { id: 'edit.undo',                  label: 'Undo',                            section: 'Edit', defaultKey: 'Mod+Z' },
  { id: 'edit.redo',                  label: 'Redo',                            section: 'Edit', defaultKey: 'Mod+Y' },
  { id: 'edit.cut',                   label: 'Cut',                             section: 'Edit', defaultKey: 'Mod+X' },
  { id: 'edit.copy',                  label: 'Copy',                            section: 'Edit', defaultKey: 'Mod+C' },
  { id: 'edit.paste',                 label: 'Paste',                           section: 'Edit', defaultKey: 'Mod+V' },
  { id: 'edit.selectAll',             label: 'Select All',                      section: 'Edit', defaultKey: 'Mod+A' },
  { id: 'edit.beginEndSelect',        label: 'Begin/End Select',                section: 'Edit', defaultKey: 'Mod+Shift+B' },
  { id: 'edit.beginEndSelectColumn',  label: 'Begin/End Select (Column Mode)',  section: 'Edit', defaultKey: 'Mod+Shift+Alt+B' },
  { id: 'edit.duplicateLine',         label: 'Duplicate Line',                  section: 'Edit', defaultKey: 'Mod+D' },
  { id: 'edit.deleteLine',            label: 'Delete Line',                     section: 'Edit', defaultKey: 'Mod+Shift+K' },
  { id: 'edit.moveLineUp',            label: 'Move Line Up',                    section: 'Edit', defaultKey: 'Alt+Up' },
  { id: 'edit.moveLineDown',          label: 'Move Line Down',                  section: 'Edit', defaultKey: 'Alt+Down' },
  { id: 'edit.toUpperCase',           label: 'UPPERCASE',                       section: 'Edit', defaultKey: 'Mod+Shift+U' },
  { id: 'edit.toLowerCase',           label: 'lowercase',                       section: 'Edit', defaultKey: 'Mod+Shift+L' },
  { id: 'edit.toggleComment',         label: 'Toggle Comment',                  section: 'Edit', defaultKey: 'Mod+/' },
  { id: 'edit.toggleBlockComment',    label: 'Toggle Block Comment',            section: 'Edit', defaultKey: 'Mod+Shift+/' },
  { id: 'edit.beautify',              label: 'Beautify',                        section: 'Edit', defaultKey: 'Mod+Alt+Shift+M' },
  { id: 'edit.transformSchema',       label: 'Transform schema',                section: 'Edit', defaultKey: 'Mod+Alt+Shift+K' },
  { id: 'edit.removeDuplicates',      label: 'Remove Duplicates',               section: 'Edit', defaultKey: 'Mod+Alt+Shift+C' },
  { id: 'edit.indent',                label: 'Indent Selection',                section: 'Edit', defaultKey: 'Tab' },
  { id: 'edit.outdent',               label: 'Outdent Selection',               section: 'Edit', defaultKey: 'Shift+Tab' },

  // Search
  { id: 'search.find',          label: 'Find…',            section: 'Search', defaultKey: 'Mod+F' },
  { id: 'search.replace',       label: 'Replace…',         section: 'Search', defaultKey: 'Mod+H' },
  { id: 'search.findInFiles',   label: 'Find in Files…',   section: 'Search', defaultKey: 'Mod+Shift+F' },
  { id: 'search.goToLine',      label: 'Go to Line…',      section: 'Search', defaultKey: 'Mod+G' },
  { id: 'search.toggleBookmark',label: 'Toggle Bookmark',  section: 'Search', defaultKey: 'Mod+F2' },
  { id: 'search.nextBookmark',  label: 'Next Bookmark',    section: 'Search', defaultKey: 'F2' },
  { id: 'search.prevBookmark',  label: 'Previous Bookmark',section: 'Search', defaultKey: 'Shift+F2' },

  // View
  { id: 'view.toggleSidebar', label: 'Toggle Sidebar', section: 'View', defaultKey: 'Mod+B' },
  { id: 'view.preview',       label: 'Preview',        section: 'View', defaultKey: 'Mod+P' },
  { id: 'view.wordWrap',      label: 'Word Wrap',      section: 'View', defaultKey: 'Alt+Z' },
  { id: 'view.zoomIn',        label: 'Zoom In',        section: 'View', defaultKey: 'Mod+=' },
  { id: 'view.zoomOut',       label: 'Zoom Out',       section: 'View', defaultKey: 'Mod+-' },
  { id: 'view.zoomReset',     label: 'Reset Zoom',     section: 'View', defaultKey: 'Mod+0' },
  // Mod+Shift+A, not Mod+Shift+I — Electron reserves Ctrl/Cmd+Shift+I for DevTools.
  { id: 'view.aiAssistant',   label: 'AI Assistant',   section: 'View', defaultKey: 'Mod+Shift+A' },

  // Window
  { id: 'window.nextTab',  label: 'Next Tab',     section: 'Window', defaultKey: 'Mod+Tab' },
  { id: 'window.prevTab',  label: 'Previous Tab', section: 'Window', defaultKey: 'Mod+Shift+Tab' },
]

export const SHORTCUT_SECTIONS: ShortcutSection[] = ['File', 'Edit', 'Search', 'View', 'Window']

const CATALOG_BY_ID: Record<string, ShortcutDef> = Object.fromEntries(
  SHORTCUT_CATALOG.map((s) => [s.id, s])
)

export function getShortcutDef(id: string): ShortcutDef | undefined {
  return CATALOG_BY_ID[id]
}

/** Resolve a binding's effective canonical string ("Mod+S") given the config overrides. */
export function resolveBinding(id: string, overrides: Record<string, string> | undefined): string {
  const def = CATALOG_BY_ID[id]
  if (!def) return ''
  const ov = overrides?.[id]
  return ov ?? def.defaultKey
}

/** Format a canonical binding for display, swapping `Mod` for the platform modifier. */
export function formatBinding(combo: string): string {
  if (!combo) return ''
  const mac = isMacOS()
  return combo
    .split('+')
    .map((part) => {
      if (part === 'Mod') return mac ? '⌘' : 'Ctrl'
      if (part === 'Alt') return mac ? '⌥' : 'Alt'
      if (part === 'Shift') return mac ? '⇧' : 'Shift'
      if (part === 'Ctrl') return mac ? '⌃' : 'Ctrl'
      return part
    })
    .join(mac ? '' : '+')
}

/** Helper combining resolve + format for menu rendering. */
export function bindingDisplay(id: string, overrides: Record<string, string> | undefined): string {
  return formatBinding(resolveBinding(id, overrides))
}

/** Capture a KeyboardEvent into the canonical form. Returns null if only modifiers are pressed. */
export function captureBinding(e: KeyboardEvent): string | null {
  const key = e.key
  // Skip pure-modifier presses
  if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return null

  const parts: string[] = []
  // Primary modifier: macOS uses Cmd (Meta); others use Ctrl. Either way maps to "Mod".
  const mac = isMacOS()
  const primary = mac ? e.metaKey : e.ctrlKey
  if (primary) parts.push('Mod')
  // Secondary Ctrl on macOS only (rarely used; emit as "Ctrl" for distinctness).
  if (mac && e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  let k = key
  // Normalize letter case
  if (k.length === 1 && /[a-zA-Z]/.test(k)) k = k.toUpperCase()
  // Friendlier names for special keys
  const NAME_MAP: Record<string, string> = {
    ' ': 'Space',
    'ArrowUp': 'Up',
    'ArrowDown': 'Down',
    'ArrowLeft': 'Left',
    'ArrowRight': 'Right',
    'Escape': 'Esc',
  }
  k = NAME_MAP[k] ?? k

  parts.push(k)
  return parts.join('+')
}
