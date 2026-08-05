import { useState, useRef, useEffect } from 'react'
import {
  FilePlus, FolderOpen, Save, X,
  Undo2, Redo2, Scissors, Copy, Clipboard, SquareDashedMousePointer,
  Search, Replace, FolderSearch,
  PanelLeftClose, PanelLeft,
  RotateCcw, ChevronRight, Clock,
  Settings as SettingsIcon, Sun, Moon, Keyboard,
  Printer, FileDown,
  Terminal as TerminalIcon,
} from 'lucide-react'
import { useUIStore } from '../../store/uiStore'
import { useEditorStore } from '../../store/editorStore'
import { usePluginStore } from '../../store/pluginStore'
import { isMacOS, isWindows, shortcutMod, shortcutAlt } from '../../utils/platform'
import { MnemonicLabel, parseMnemonic } from '../../utils/mnemonic'
import { useAltHeld } from '../../hooks/useAltHeld'
import { useAltMnemonics } from '../../hooks/useAltMnemonics'
import { SettingsMenu } from './SettingsMenu'
import { NavButtons } from './NavButtons'
import { HASH_ALGOS, openHashGenerator, hashFromFiles, hashSelectionToClipboard } from '../../lib/tools/hashActions'
import { ENCODINGS, EOLS } from '../../constants/registries'
import { runCommand } from '../../commands/registry'

interface MenuBarProps {
  onNew: () => void
  onOpen: () => void
  onOpenFolder: () => void
  onSave: () => void
  onSaveAs: () => void
  onSaveAll: () => void
  onClose: () => void
  onCloseAll: () => void
  onFind: () => void
  onReplace: () => void
  onFindInFiles: () => void
  onReload: () => void
  onOpenRecent: (paths: string[]) => void
}

interface MenuItem {
  label: string
  title?: string
  icon?: React.ReactNode
  shortcut?: string
  action?: () => void
  separator?: boolean
  disabled?: boolean
  checked?: boolean
  submenu?: MenuItem[]
}

const editorCmd = (cmd: string) => () =>
  window.dispatchEvent(new CustomEvent('editor:command', { detail: cmd }))

/** Invoke a registry command, so this menu shares one implementation with the
 *  palette, the keyboard and the native menu. */
const cmd = (id: string) => () => runCommand(id)

export function MenuBar({
  onNew, onOpen, onOpenFolder, onSave, onSaveAs, onSaveAll,
  onClose, onCloseAll, onFind, onReplace, onFindInFiles, onReload, onOpenRecent,
}: MenuBarProps) {
  // macOS uses native menu — hide custom MenuBar
  if (isMacOS()) return null

  const mod = shortcutMod()
  const alt = shortcutAlt()

  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const [hoveredSubmenu, setHoveredSubmenu] = useState<string | null>(null)
  const [recentFiles, setRecentFiles] = useState<string[]>([])
  const menuRef = useRef<HTMLDivElement>(null)
  const {
    showToolbar, showStatusBar, showSidebar,
    wordWrap, renderWhitespace, showEOL, showNonPrinting, showControlChars,
    indentationGuides, columnSelectMode, splitView, theme,
    setShowSidebar,
    setRenderWhitespace, setShowEOL, setShowNonPrinting, setShowControlChars,
    setIndentationGuides, setColumnSelectMode,
  } = useUIStore()
  const dynamicMenuItems = usePluginStore((s) => s.dynamicMenuItems)
  // Reactive active-buffer encoding/EOL so the Encoding menu shows a checkmark
  // on the current selection (mirrors the status-bar pickers).
  const activeEncoding = useEditorStore((s) => s.buffers.find((b) => b.id === s.activeId)?.encoding ?? null)
  const activeEol = useEditorStore((s) => s.buffers.find((b) => b.id === s.activeId)?.eol ?? null)

  // Group dynamic menu items by plugin name into submenus so the custom menu
  // mirrors the native Plugins submenu (plugin name → its items).
  const dynamicPluginMenu: MenuItem[] = (() => {
    const byPlugin = new Map<string, MenuItem[]>()
    for (const { pluginName, label } of dynamicMenuItems) {
      if (!byPlugin.has(pluginName)) byPlugin.set(pluginName, [])
      byPlugin.get(pluginName)!.push({
        label,
        action: () => window.api.send('plugin:invoke-menu-click', pluginName, label),
      })
    }
    return Array.from(byPlugin.entries()).map(([pluginName, items]) => ({
      label: pluginName,
      submenu: items,
    }))
  })()

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenu(null)
        setHoveredSubmenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Refresh recents whenever the File menu opens so newly opened files appear.
  useEffect(() => {
    if (activeMenu === 'File') {
      window.api.file.getRecents().then(setRecentFiles)
    }
  }, [activeMenu])

  const recentFilesSubmenu: MenuItem[] = recentFiles.length > 0
    ? recentFiles.map((fp) => {
        const name = fp.replace(/\\/g, '/').split('/').pop() ?? fp
        return { label: name, title: fp, action: () => onOpenRecent([fp]) }
      })
    : [{ label: 'No recent files', disabled: true }]

  const menuItems: Record<string, MenuItem[]> = {
    File: [
      { label: '&New File', icon: <FilePlus size={18} />, shortcut: `${mod}+N`, action: onNew },
      { label: '&Open File...', icon: <FolderOpen size={18} />, shortcut: `${mod}+O`, action: onOpen },
      { label: 'Open &Folder...', shortcut: `${mod}+Shift+O`, action: onOpenFolder },
      { label: '&Save', icon: <Save size={18} />, shortcut: `${mod}+S`, action: onSave },
      { label: 'Save &As...', shortcut: `${mod}+Shift+S`, action: onSaveAs },
      { label: 'Sa&ve All', shortcut: `${mod}+${alt}+S`, action: onSaveAll },
      { separator: true, label: '' },
      { label: '&Reload from Disk', icon: <RotateCcw size={18} />, shortcut: `${mod}+R`, action: onReload },
      { label: 'Rec&ent Files', icon: <Clock size={18} />, submenu: recentFilesSubmenu },
      { separator: true, label: '' },
      { label: '&Print...', icon: <Printer size={18} />, shortcut: `${mod}+${alt}+P`, action: cmd('file.print') },
      { label: 'Export to P&DF...', icon: <FileDown size={18} />, action: cmd('file.exportPdf') },
      { separator: true, label: '' },
      { label: '&Close File', icon: <X size={18} />, shortcut: `${mod}+W`, action: onClose },
      { label: 'Close All Fi&les', action: onCloseAll },
    ],
    Edit: [
      { label: '&Undo', icon: <Undo2 size={18} />, shortcut: `${mod}+Z`, action: editorCmd('undo') },
      { label: '&Redo', icon: <Redo2 size={18} />, shortcut: `${mod}+Y`, action: editorCmd('redo') },
      { separator: true, label: '' },
      { label: 'Cu&t', icon: <Scissors size={18} />, shortcut: `${mod}+X`, action: () => document.execCommand('cut') },
      { label: '&Copy', icon: <Copy size={18} />, shortcut: `${mod}+C`, action: () => document.execCommand('copy') },
      { label: '&Paste', icon: <Clipboard size={18} />, shortcut: `${mod}+V`, action: () => document.execCommand('paste') },
      { separator: true, label: '' },
      { label: 'Select &All', icon: <SquareDashedMousePointer size={18} />, shortcut: `${mod}+A`, action: () => document.execCommand('selectAll') },
      {
        label: '&Begin/End Select', submenu: [
          { label: '&Select', shortcut: `${mod}+Shift+B`, action: cmd('edit.beginEndSelect') },
          { label: 'Co&lumn Mode', shortcut: `${mod}+Shift+${alt}+B`, action: cmd('edit.beginEndSelectColumn') },
        ],
      },
      { separator: true, label: '' },
      {
        label: 'Line &Operations', submenu: [
          { label: '&Duplicate Line', shortcut: `${mod}+D`, action: cmd('edit.duplicateLine') },
          { label: 'De&lete Line', shortcut: `${mod}+Shift+K`, action: cmd('edit.deleteLine') },
          { label: 'Move Line &Up', shortcut: `${alt}+Up`, action: cmd('edit.moveLineUp') },
          { label: 'Move Line Dow&n', shortcut: `${alt}+Down`, action: cmd('edit.moveLineDown') },
          { separator: true, label: '' },
          { label: 'Sort Lines &Ascending', action: cmd('edit.sortLinesAsc') },
          { label: 'Sort Lines Descendin&g', action: cmd('edit.sortLinesDesc') },
        ],
      },
      {
        label: 'Convert Cas&e (UPPER/lower)', submenu: [
          { label: '&UPPERCASE', shortcut: `${mod}+Shift+U`, action: cmd('edit.toUpperCase') },
          { label: '&lowercase', shortcut: `${mod}+Shift+L`, action: cmd('edit.toLowerCase') },
          { label: '&Title Case', action: cmd('edit.toTitleCase') },
        ],
      },
      { separator: true, label: '' },
      {
        label: 'Cop&y to Clipboard', submenu: [
          { label: 'Current Full File &Path', action: cmd('edit.copyFullPath') },
          { label: 'Current File &Name', action: cmd('edit.copyFileName') },
          { label: 'Current &Directory Path', action: cmd('edit.copyDirPath') },
        ],
      },
      {
        label: 'In&sert', submenu: [
          { label: 'Date && Time — &Short', action: cmd('edit.insertDateTimeShort') },
          { label: 'Date && Time — &Long', action: cmd('edit.insertDateTimeLong') },
        ],
      },
      { separator: true, label: '' },
      { label: 'Toggle Co&mment', shortcut: `${mod}+/`, action: cmd('edit.toggleComment') },
      { label: 'Toggle Bloc&k Comment', shortcut: `${mod}+Shift+/`, action: cmd('edit.toggleBlockComment') },
      { separator: true, label: '' },
      { label: 'Tri&m Trailing Whitespace', action: cmd('edit.trimTrailingWhitespace') },
      { label: 'Beauti&fy', shortcut: `${mod}+${alt}+Shift+M`, action: cmd('edit.beautify') },
      { label: 'Trans&form', shortcut: `${mod}+${alt}+Shift+K`, action: cmd('edit.transformSchema') },
      { label: 'Dedu&plicate', shortcut: `${mod}+${alt}+Shift+C`, action: cmd('edit.removeDuplicates') },
      { label: '&Indent Selection', shortcut: 'Tab', action: cmd('edit.indent') },
      { label: 'Out&dent Selection', shortcut: 'Shift+Tab', action: cmd('edit.outdent') },
    ],
    Search: [
      { label: '&Find...', icon: <Search size={18} />, shortcut: `${mod}+F`, action: onFind },
      { label: '&Replace...', icon: <Replace size={18} />, shortcut: `${mod}+H`, action: onReplace },
      { label: 'Find in F&iles...', icon: <FolderSearch size={18} />, shortcut: `${mod}+Shift+F`, action: onFindInFiles },
      { separator: true, label: '' },
      { label: 'Command Pa&lette...', icon: <TerminalIcon size={18} />, shortcut: `${mod}+Shift+P`, action: cmd('search.commandPalette') },
      { label: 'Go to Fil&e...', shortcut: `${mod}+E`, action: cmd('search.goToFile') },
      { separator: true, label: '' },
      { label: '&Go to Line...', shortcut: `${mod}+G`, action: cmd('search.goToLine') },
      { separator: true, label: '' },
      { label: '&Toggle Bookmark', shortcut: `${mod}+F2`, action: cmd('search.toggleBookmark') },
      { label: '&Next Bookmark', shortcut: 'F2', action: cmd('search.nextBookmark') },
      { label: '&Previous Bookmark', shortcut: 'Shift+F2', action: cmd('search.prevBookmark') },
      { label: '&Clear All Bookmarks', action: cmd('search.clearBookmarks') },
    ],
    View: [
      { label: showToolbar ? 'Hide &Toolbar' : 'Show &Toolbar', action: cmd('view.toggleToolbar') },
      { label: showStatusBar ? 'Hide &Status Bar' : 'Show &Status Bar', action: cmd('view.toggleStatusBar') },
      { label: showSidebar ? 'Hide Side&bar' : 'Show Side&bar', icon: showSidebar ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />, shortcut: `${mod}+B`, action: cmd('view.toggleSidebar') },
      { label: 'Pre&view', shortcut: `${mod}+P`, action: cmd('view.preview') },
      { separator: true, label: '' },
      { label: '&Word Wrap', shortcut: `${alt}+Z`, checked: wordWrap, action: cmd('view.wordWrap') },
      (() => {
        const setSpaceTab = (v: boolean) => {
          setRenderWhitespace(v)
          window.dispatchEvent(new CustomEvent('editor:set-option-local', { detail: { renderWhitespace: v ? 'all' : 'none' } }))
        }
        const setEOL = (v: boolean) => {
          setShowEOL(v)
          window.dispatchEvent(new CustomEvent('editor:set-eol-marker', { detail: v }))
        }
        const setNonPrinting = (v: boolean) => {
          setShowNonPrinting(v)
          window.dispatchEvent(new CustomEvent('editor:set-option-local', { detail: { renderControlCharacters: v } }))
        }
        const setControlChars = (v: boolean) => {
          setShowControlChars(v)
          window.dispatchEvent(new CustomEvent('editor:set-option-local', {
            detail: { unicodeHighlight: { invisibleCharacters: v, ambiguousCharacters: v } },
          }))
        }
        const allOn = renderWhitespace && showEOL && showNonPrinting && showControlChars
        return {
          label: 'Show &Symbol',
          submenu: [
            { label: 'Show Space and &Tab', checked: renderWhitespace, action: () => setSpaceTab(!renderWhitespace) },
            { label: 'Show &End of Line', checked: showEOL, action: () => setEOL(!showEOL) },
            { label: 'Show &Non-Printing Characters', checked: showNonPrinting, action: () => setNonPrinting(!showNonPrinting) },
            { label: 'Show &Control Characters && Unicode EOL', checked: showControlChars, action: () => setControlChars(!showControlChars) },
            { separator: true, label: '' },
            {
              label: 'Show &All Characters', checked: allOn,
              action: () => {
                const v = !allOn
                setSpaceTab(v); setEOL(v); setNonPrinting(v); setControlChars(v)
              },
            },
          ],
        }
      })(),
      {
        label: 'Show I&ndentation Guides', checked: indentationGuides,
        action: () => {
          const v = !indentationGuides
          setIndentationGuides(v)
          window.dispatchEvent(new CustomEvent('editor:set-option-local', { detail: { guides: { indentation: v } } }))
        },
      },
      {
        label: '&Column Select Mode', checked: columnSelectMode,
        action: () => {
          const v = !columnSelectMode
          setColumnSelectMode(v)
          window.dispatchEvent(new CustomEvent('editor:set-option-local', { detail: { columnSelection: v } }))
        },
      },
      { separator: true, label: '' },
      { label: 'Zoom &In', shortcut: `${mod}+=`, action: cmd('view.zoomIn') },
      { label: 'Zoom &Out', shortcut: `${mod}+-`, action: cmd('view.zoomOut') },
      { label: '&Reset Zoom', shortcut: `${mod}+0`, action: cmd('view.zoomReset') },
      { separator: true, label: '' },
      {
        label: '&Folding', submenu: [
          { label: 'Fold &All', action: cmd('view.foldAll') },
          { label: '&Unfold All', action: cmd('view.unfoldAll') },
          { separator: true, label: '' },
          {
            label: 'Collapse &Level', submenu: [1, 2, 3, 4, 5, 6, 7].map((n) => ({
              label: `Level ${n}`, action: editorCmd(`foldLevel${n}`),
            })),
          },
        ],
      },
      { separator: true, label: '' },
      { label: 'S&plit View', shortcut: `${mod}+\\`, checked: splitView, action: cmd('view.splitView') },
    ],
    Encoding: (() => {
      // Mirror the status-bar pickers: dispatching these CustomEvents is what
      // EditorPane listens for, so menu and status bar drive the same path.
      const setEncoding = (value: string) =>
        window.dispatchEvent(new CustomEvent('editor:set-encoding', { detail: value }))
      const setEol = (value: string) =>
        window.dispatchEvent(new CustomEvent('editor:set-eol', { detail: value }))
      return [
        ...ENCODINGS.map((e) => ({
          label: `Encode in ${e.label}`,
          checked: activeEncoding === e.value,
          action: () => setEncoding(e.value),
        })),
        { separator: true, label: '' },
        {
          label: 'EOL &Conversion',
          submenu: EOLS.map((eo) => ({
            label: eo.label,
            checked: activeEol === eo.value,
            action: () => setEol(eo.value),
          })),
        },
      ]
    })(),
    Tools: (() => {
      const openTool = (id: string) => runCommand(`tools.open.${id}`)
      const hashMenu = (algo: (typeof HASH_ALGOS)[number]['id']): MenuItem[] => [
        { label: '&Generate...', action: () => openHashGenerator(algo) },
        { label: 'Generate from &files...', action: () => { void hashFromFiles(algo) } },
        { label: 'Generate from &selection into clipboard', action: () => { void hashSelectionToClipboard(algo) } },
      ]
      return [
        ...HASH_ALGOS.map((a) => ({ label: a.label, submenu: hashMenu(a.id) })),
        { separator: true, label: '' },
        {
          label: '&Encoding && Web', submenu: [
            { label: '&URL Encoder', action: () => openTool('url') },
            { label: '&JWT Decoder', action: () => openTool('jwt') },
            { label: '&CSP Tools', action: () => openTool('csp') },
          ],
        },
        {
          label: '&Converters', submenu: [
            { label: '&Epoch Converter', action: () => openTool('epoch') },
            { label: 'C&olor Converter', action: () => openTool('color') },
            { label: 'Cro&n Builder', action: () => openTool('cron') },
          ],
        },
        {
          label: '&Generators', submenu: [
            { label: 'UUID &Generator', action: () => openTool('uuid') },
            { label: '&Lorem Ipsum', action: () => openTool('lorem') },
          ],
        },
        { separator: true, label: '' } as MenuItem,
        {
          label: '&Notes',
          shortcut: `${shortcutMod()}+Shift+N`,
          action: cmd('view.notes'),
        },
        {
          // The registry handler is the one that knows to send the user to
          // Settings rather than toggle a panel they haven't enabled yet.
          label: '&AI Assistant',
          shortcut: `${shortcutMod()}+Shift+A`,
          action: cmd('view.aiAssistant'),
        },
      ]
    })(),
    Plugins: [
      {
        label: '&Plugin Manager...',
        action: cmd('plugins.manager')
      },
      ...(dynamicPluginMenu.length > 0
        ? [{ separator: true, label: '' } as MenuItem, ...dynamicPluginMenu]
        : []),
    ],
    Settings: (() => {
      const themeLabel = theme === 'dark' ? 'Toggle &Light Mode' : 'Toggle &Dark Mode'
      const ThemeIcon = theme === 'dark' ? Sun : Moon
      return [
        { label: '&Settings...', icon: <SettingsIcon size={18} />, shortcut: `${mod}+,`, action: cmd('prefs.settings') },
        { separator: true, label: '' },
        { label: '&General', action: cmd('settings.open.general') },
        { label: '&Editor', action: cmd('settings.open.editor') },
        { label: '&Appearance', action: cmd('settings.open.appearance') },
        { label: '&New Document', action: cmd('settings.open.newDoc') },
        { label: '&Backup', action: cmd('settings.open.backup') },
        { label: 'Auto-Co&mpletion', action: cmd('settings.open.completion') },
        { label: '&Keyboard Shortcuts', icon: <Keyboard size={18} />, action: cmd('settings.open.shortcuts') },
        { separator: true, label: '' },
        { label: themeLabel, icon: <ThemeIcon size={18} />, action: cmd('prefs.toggleTheme') },
      ]
    })(),
    Window: [
      { label: '&Minimize', action: () => window.dispatchEvent(new CustomEvent('window:minimize')) },
      { label: '&Zoom', action: () => window.dispatchEvent(new CustomEvent('window:zoom')) },
      { separator: true, label: '' },
      { label: '&Next Tab', shortcut: `${mod}+Tab`, action: cmd('window.nextTab') },
      { label: '&Previous Tab', shortcut: `${mod}+Shift+Tab`, action: cmd('window.prevTab') },
    ],
    Help: [
      { label: "&What's New", action: cmd('help.whatsNew') },
      { label: '&About NovaPad', action: cmd('help.about') },
      { separator: true, label: '' },
      { label: '&Check for Updates...', action: cmd('help.checkForUpdates') },
      { separator: true, label: '' },
      { label: 'Open Dev&Tools', shortcut: 'F12', action: () => window.api.send('dev:toggle-devtools') },
    ],
  }

  const topMenus: { key: string; label: string }[] = [
    { key: 'File', label: '&File' },
    { key: 'Edit', label: '&Edit' },
    { key: 'Search', label: '&Search' },
    { key: 'View', label: '&View' },
    { key: 'Encoding', label: 'E&ncoding' },
    { key: 'Tools', label: '&Tools' },
    { key: 'Plugins', label: '&Plugins' },
    { key: 'Settings', label: 'Se&ttings' },
    { key: 'Window', label: '&Window' },
    { key: 'Help', label: '&Help' },
  ]

  const altHeld = useAltHeld()

  const topLevelHandlers: Record<string, () => void> = {}
  for (const { key, label } of topMenus) {
    const { letter } = parseMnemonic(label)
    if (letter) topLevelHandlers[letter] = () => {
      setActiveMenu((prev) => prev === key ? null : key)
      setHoveredSubmenu(null)
    }
  }
  useAltMnemonics(isWindows(), topLevelHandlers, { allowInsideInputs: true })

  const menuItemsRef = useRef(menuItems)
  menuItemsRef.current = menuItems

  useEffect(() => {
    if (!isWindows() || !activeMenu) return
    const items = menuItemsRef.current[activeMenu]
    if (!items) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveMenu(null)
        setHoveredSubmenu(null)
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (!e.key || e.key.length !== 1) return
      const upper = e.key.toUpperCase()
      for (const item of items) {
        if (item.separator || item.disabled) continue
        const { letter } = parseMnemonic(item.label)
        if (letter === upper) {
          e.preventDefault()
          e.stopPropagation()
          if (item.submenu) {
            setHoveredSubmenu(`${activeMenu}-${item.label}`)
          } else {
            item.action?.()
            setActiveMenu(null)
            setHoveredSubmenu(null)
          }
          return
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [activeMenu])

  useEffect(() => {
    const onBlur = () => { setActiveMenu(null); setHoveredSubmenu(null) }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [])

  const renderMenuItems = (items: MenuItem[], parentLabel: string) => (
    items.map((item, i) => {
      if (item.separator) {
        return <div key={`${parentLabel}-sep-${i}`} className="h-px bg-border mx-2 my-1" />
      }
      if (item.submenu) {
        const subKey = `${parentLabel}-${item.label}`
        // Open while this exact submenu is hovered OR while any descendant is
        // (its key is prefixed by subKey + '-'). A single hoveredSubmenu string
        // can hold only the deepest level, so without the prefix check, hovering
        // a 3rd-level entry would unmount its 2nd-level parent — and the flyout
        // with it. No onMouseLeave here: moving onto a sibling re-targets
        // hoveredSubmenu instead, which avoids collapsing the whole chain when
        // the cursor crosses between nested panels.
        const open = hoveredSubmenu === subKey || !!hoveredSubmenu?.startsWith(`${subKey}-`)
        return (
          <div
            key={item.label}
            className="relative"
            onMouseEnter={() => setHoveredSubmenu(subKey)}
          >
            <div className="w-full flex items-center gap-2.5 px-3 py-2 text-base text-popover-foreground hover:bg-secondary transition-colors cursor-default">
              <span className="w-5 flex justify-center shrink-0">{item.icon}</span>
              <span className="flex-1 text-left"><MnemonicLabel label={item.label} show={altHeld} /></span>
              <ChevronRight size={18} className="text-muted-foreground shrink-0" />
            </div>
            {open && (
              <div className="absolute left-full top-0 ml-0.5 min-w-[220px] bg-popover border border-border rounded-md shadow-lg py-1 z-50">
                {renderMenuItems(item.submenu, subKey)}
              </div>
            )}
          </div>
        )
      }
      return (
        <button
          key={item.label}
          title={item.title}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-base text-popover-foreground transition-colors ${
            item.disabled ? 'opacity-40 pointer-events-none' : 'hover:bg-secondary'
          }`}
          disabled={item.disabled}
          // Hovering a leaf collapses any sibling flyout by re-targeting
          // hoveredSubmenu to this item's parent (the top-level menu key for
          // level-1 items, or the enclosing submenu key when nested).
          onMouseEnter={() => setHoveredSubmenu(parentLabel)}
          onClick={() => {
            if (!item.disabled) {
              item.action?.()
              setActiveMenu(null)
              setHoveredSubmenu(null)
            }
          }}
        >
          <span className="w-5 flex justify-center shrink-0">
            {item.checked !== undefined ? (
              <span className="text-base">{item.checked ? '✓' : ''}</span>
            ) : (
              item.icon
            )}
          </span>
          <span className="flex-1 text-left"><MnemonicLabel label={item.label} show={altHeld} /></span>
          {item.shortcut && (
            <span className="text-base text-muted-foreground ml-4 font-mono tabular-nums shrink-0">{item.shortcut}</span>
          )}
        </button>
      )
    })
  )

  return (
    <div
      ref={menuRef}
      className="h-9 bg-toolbar border-b border-toolbar-border flex items-center px-1 select-none shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      data-testid="menubar"
    >
      {/* Menu items */}
      <div className="flex items-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {topMenus.map(({ key, label }) => (
          <div key={key} className="relative">
            <button
              className={`px-3 py-1.5 text-base text-toolbar-foreground hover:bg-secondary rounded-sm transition-colors ${
                activeMenu === key ? 'bg-secondary' : ''
              }`}
              onMouseEnter={() => activeMenu && setActiveMenu(key)}
              onClick={() => {
                setActiveMenu(activeMenu === key ? null : key)
                setHoveredSubmenu(null)
              }}
            >
              <MnemonicLabel label={label} show={altHeld} />
            </button>

            {/* Dropdown */}
            {activeMenu === key && menuItems[key] && (
              <div className="absolute top-full left-0 mt-0.5 min-w-[260px] bg-popover border border-border rounded-md shadow-lg py-1 z-50">
                {renderMenuItems(menuItems[key], key)}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex-1" />

      {/* Right-side quick icons */}
      <div className="flex items-center gap-0.5 mr-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <NavButtons />
        <button
          onClick={() => setShowSidebar(!showSidebar)}
          className="p-2 text-toolbar-foreground hover:bg-secondary rounded-sm transition-colors"
          title={showSidebar ? 'Hide Explorer' : 'Show Explorer'}
        >
          {showSidebar ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
        </button>
        <SettingsMenu />
      </div>
    </div>
  )
}
