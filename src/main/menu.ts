import { Menu, MenuItem, BrowserWindow, app, dialog } from 'electron'

interface PluginMenuEntry {
  pluginName: string
  items: Array<{ label: string; accelerator?: string; callback: () => void }>
}

const pluginMenuRegistry: Map<string, PluginMenuEntry> = new Map()
let currentWin: BrowserWindow | null = null
let currentRecentFiles: string[] = []

/**
 * An accelerator the menu *displays* but does not register with the OS.
 *
 * Every command the renderer's registry owns is built this way: the user still
 * discovers the key by browsing the menu, but exactly one code path responds to
 * the keypress (`commands/useCommandKeys`) — which is what makes rebinding in
 * Settings take effect and stops toggles firing twice (BR-002).
 *
 * Electron `role:` items (Undo/Redo/Cut/Copy/Paste/Select All/Minimize/Zoom/Quit)
 * and F12 keep their native accelerators and stay out of the registry (BR-003).
 */
const displayKey = (accelerator: string): { accelerator: string; registerAccelerator: false } => ({
  accelerator,
  registerAccelerator: false
})

export function buildMenu(win: BrowserWindow, recentFiles: string[] = []): void {
  currentWin = win
  currentRecentFiles = recentFiles
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { label: 'About NovaPad', click: () => win.webContents.send('menu:about') },
              {
                label: 'Check for Updates…',
                click: () => win.webContents.send('menu:check-for-updates')
              },
              { type: 'separator' as const },
              {
                label: 'Settings…',
                ...displayKey('CmdOrCtrl+,'),
                click: () => win.webContents.send('menu:settings-open')
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),

    // File
    {
      label: '&File',
      submenu: [
        {
          label: 'New',
          ...displayKey('CmdOrCtrl+N'),
          click: () => win.webContents.send('menu:file-new')
        },
        { type: 'separator' },
        {
          label: 'Open...',
          ...displayKey('CmdOrCtrl+O'),
          click: async () => {
            // Single "All Files" filter only — Windows persists the user's
            // last-used filter selection across dialog opens (an OS behavior
            // Electron can't override), so listing extra filters causes the
            // dialog to remember e.g. "Text Files" and reopen with it.
            // Keeping a single filter forces the dialog to always show every
            // file type by default.
            const result = await dialog.showOpenDialog(win, {
              properties: ['openFile', 'multiSelections'],
              filters: [{ name: 'All Files', extensions: ['*'] }]
            })
            if (!result.canceled) {
              win.webContents.send('menu:file-open', result.filePaths)
            }
          }
        },
        {
          label: 'Open Folder...',
          ...displayKey('CmdOrCtrl+Shift+O'),
          click: async () => {
            const result = await dialog.showOpenDialog(win, {
              properties: ['openDirectory']
            })
            if (!result.canceled) {
              win.webContents.send('menu:folder-open', result.filePaths[0])
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Save',
          ...displayKey('CmdOrCtrl+S'),
          click: () => win.webContents.send('menu:file-save')
        },
        {
          label: 'Save As...',
          ...displayKey('CmdOrCtrl+Shift+S'),
          click: () => win.webContents.send('menu:file-save-as')
        },
        {
          label: 'Save All',
          ...displayKey('CmdOrCtrl+Alt+S'),
          click: () => win.webContents.send('menu:file-save-all')
        },
        { type: 'separator' },
        {
          label: 'Reload from Disk',
          ...displayKey('CmdOrCtrl+R'),
          click: () => win.webContents.send('menu:file-reload')
        },
        { type: 'separator' },
        {
          label: 'Print…',
          ...displayKey('CmdOrCtrl+Alt+P'),
          click: () => win.webContents.send('editor:command', 'printDocument')
        },
        {
          label: 'Export to PDF…',
          click: () => win.webContents.send('editor:command', 'exportPdf')
        },
        { type: 'separator' },
        {
          label: 'Close',
          ...displayKey('CmdOrCtrl+W'),
          click: () => win.webContents.send('menu:file-close')
        },
        {
          label: 'Close All',
          click: () => win.webContents.send('menu:file-close-all')
        },
        { type: 'separator' },
        {
          label: 'Recent Files',
          submenu: recentFiles.length
            ? recentFiles.map((f) => ({ label: f, click: () => win.webContents.send('menu:file-open', [f]) }))
            : [{ label: 'No recent files', enabled: false }],
          id: 'recent-files'
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const }
      ]
    },

    // Edit
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' as const, accelerator: 'CmdOrCtrl+Z' },
        { role: 'redo' as const, accelerator: 'CmdOrCtrl+Y' },
        { type: 'separator' },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
        {
          label: 'Begin/End Select',
          submenu: [
            {
              label: 'Select',
              accelerator: 'CmdOrCtrl+Shift+B',
              registerAccelerator: false,
              click: () => win.webContents.send('editor:command', 'beginEndSelect')
            },
            {
              label: 'Column Mode',
              accelerator: 'CmdOrCtrl+Shift+Alt+B',
              registerAccelerator: false,
              click: () => win.webContents.send('editor:command', 'beginEndSelectColumn')
            }
          ]
        },
        { type: 'separator' },
        {
          label: 'Line Operations',
          submenu: [
            { label: 'Duplicate Line', ...displayKey('CmdOrCtrl+D'), click: () => win.webContents.send('editor:command', 'duplicateLine') },
            { label: 'Delete Line', ...displayKey('CmdOrCtrl+Shift+K'), click: () => win.webContents.send('editor:command', 'deleteLine') },
            { label: 'Move Line Up', ...displayKey('Alt+Up'), click: () => win.webContents.send('editor:command', 'moveLineUp') },
            { label: 'Move Line Down', ...displayKey('Alt+Down'), click: () => win.webContents.send('editor:command', 'moveLineDown') },
            { type: 'separator' },
            { label: 'Sort Lines Ascending', click: () => win.webContents.send('editor:command', 'sortLinesAsc') },
            { label: 'Sort Lines Descending', click: () => win.webContents.send('editor:command', 'sortLinesDesc') }
          ]
        },
        {
          label: 'Convert Case (UPPER/lower)',
          submenu: [
            { label: 'UPPERCASE', ...displayKey('CmdOrCtrl+Shift+U'), click: () => win.webContents.send('editor:command', 'toUpperCase') },
            { label: 'lowercase', ...displayKey('CmdOrCtrl+Shift+L'), click: () => win.webContents.send('editor:command', 'toLowerCase') },
            { label: 'Title Case', click: () => win.webContents.send('editor:command', 'toTitleCase') }
          ]
        },
        { type: 'separator' },
        {
          label: 'Copy to Clipboard',
          submenu: [
            { label: 'Current Full File Path', click: () => win.webContents.send('editor:command', 'copyFullPath') },
            { label: 'Current File Name', click: () => win.webContents.send('editor:command', 'copyFileName') },
            { label: 'Current Directory Path', click: () => win.webContents.send('editor:command', 'copyDirPath') }
          ]
        },
        {
          label: 'Insert',
          submenu: [
            { label: 'Date && Time — Short', click: () => win.webContents.send('editor:command', 'insertDateTimeShort') },
            { label: 'Date && Time — Long', click: () => win.webContents.send('editor:command', 'insertDateTimeLong') }
          ]
        },
        { type: 'separator' },
        {
          label: 'Toggle Comment',
          ...displayKey('CmdOrCtrl+/'),
          click: () => win.webContents.send('editor:command', 'toggleComment')
        },
        {
          label: 'Toggle Block Comment',
          ...displayKey('CmdOrCtrl+Shift+/'),
          click: () => win.webContents.send('editor:command', 'toggleBlockComment')
        },
        { type: 'separator' },
        {
          label: 'Trim Trailing Whitespace',
          click: () => win.webContents.send('editor:command', 'trimTrailingWhitespace')
        },
        {
          label: 'Beautify',
          ...displayKey('CmdOrCtrl+Alt+Shift+M'),
          click: () => win.webContents.send('editor:command', 'beautify')
        },
        {
          label: 'Transform',
          ...displayKey('CmdOrCtrl+Alt+Shift+K'),
          click: () => win.webContents.send('editor:command', 'transformToDiagram')
        },
        {
          label: 'Deduplicate',
          ...displayKey('CmdOrCtrl+Alt+Shift+C'),
          click: () => win.webContents.send('editor:command', 'removeDuplicates')
        },
        {
          // Tab / Shift+Tab are displayed but never registered — Monaco already
          // indents a selection natively, and an OS-level Tab accelerator would
          // swallow the key for ordinary typing.
          label: 'Indent Selection',
          ...displayKey('Tab'),
          click: () => win.webContents.send('editor:command', 'indentSelection')
        },
        {
          label: 'Outdent Selection',
          ...displayKey('Shift+Tab'),
          click: () => win.webContents.send('editor:command', 'outdentSelection')
        }
      ]
    },

    // Search
    {
      label: '&Search',
      submenu: [
        {
          label: 'Find...',
          ...displayKey('CmdOrCtrl+F'),
          click: () => win.webContents.send('menu:find')
        },
        {
          label: 'Replace...',
          ...displayKey('CmdOrCtrl+H'),
          click: () => win.webContents.send('menu:replace')
        },
        {
          label: 'Find in Files...',
          ...displayKey('CmdOrCtrl+Shift+F'),
          click: () => win.webContents.send('menu:find-in-files')
        },
        { type: 'separator' },
        {
          label: 'Command Palette...',
          ...displayKey('CmdOrCtrl+Shift+P'),
          click: () => win.webContents.send('menu:command-palette')
        },
        {
          // Moved off CmdOrCtrl+Shift+P, which the Command Palette now owns;
          // CmdOrCtrl+E is VS Code's own alias for the file finder.
          label: 'Go to File...',
          ...displayKey('CmdOrCtrl+E'),
          click: () => win.webContents.send('menu:goto-file')
        },
        {
          label: 'Mark...',
          // No accelerator on macOS — ⌘+M is the standard minimize-window shortcut.
          ...(isMac ? {} : { accelerator: 'Ctrl+M' }),
          click: () => win.webContents.send('menu:mark')
        },
        { type: 'separator' },
        {
          label: 'Go to Line...',
          ...displayKey('CmdOrCtrl+G'),
          click: () => win.webContents.send('editor:command', 'goToLine')
        },
        { type: 'separator' },
        {
          label: 'Toggle Bookmark',
          ...displayKey('CmdOrCtrl+F2'),
          click: () => win.webContents.send('editor:command', 'toggleBookmark')
        },
        {
          label: 'Next Bookmark',
          ...displayKey('F2'),
          click: () => win.webContents.send('editor:command', 'nextBookmark')
        },
        {
          label: 'Previous Bookmark',
          ...displayKey('Shift+F2'),
          click: () => win.webContents.send('editor:command', 'prevBookmark')
        },
        { label: 'Clear All Bookmarks', click: () => win.webContents.send('editor:command', 'clearBookmarks') }
      ]
    },

    // View
    {
      label: '&View',
      submenu: [
        {
          id: 'toggle-toolbar',
          label: 'Toggle Toolbar',
          type: 'checkbox',
          checked: true,
          click: (item) => win.webContents.send('ui:toggle-toolbar', item.checked)
        },
        {
          id: 'toggle-statusbar',
          label: 'Toggle Status Bar',
          type: 'checkbox',
          checked: true,
          click: (item) => win.webContents.send('ui:toggle-statusbar', item.checked)
        },
        {
          id: 'toggle-sidebar',
          label: 'Toggle Sidebar',
          ...displayKey('CmdOrCtrl+B'),
          type: 'checkbox',
          checked: true,
          click: (item) => win.webContents.send('ui:toggle-sidebar', item.checked)
        },
        {
          label: 'Preview',
          ...displayKey('CmdOrCtrl+P'),
          click: () => win.webContents.send('editor:command', 'togglePreview')
        },
        { type: 'separator' },
        {
          id: 'toggle-word-wrap',
          label: 'Word Wrap',
          ...displayKey('Alt+Z'),
          type: 'checkbox',
          checked: false,
          click: (item) => win.webContents.send('editor:set-option', { wordWrap: item.checked ? 'on' : 'off' })
        },
        {
          label: 'Show Symbol',
          submenu: [
            {
              id: 'toggle-whitespace',
              label: 'Show Space and Tab',
              type: 'checkbox',
              checked: false,
              click: (item) => win.webContents.send('editor:set-option', { renderWhitespace: item.checked ? 'all' : 'none' })
            },
            {
              id: 'toggle-show-eol',
              label: 'Show End of Line',
              type: 'checkbox',
              checked: false,
              click: (item) => win.webContents.send('editor:set-eol-marker', item.checked)
            },
            {
              id: 'toggle-show-non-printing',
              label: 'Show Non-Printing Characters',
              type: 'checkbox',
              checked: false,
              click: (item) => win.webContents.send('editor:set-option', { renderControlCharacters: item.checked })
            },
            {
              id: 'toggle-show-control-chars',
              label: 'Show Control Characters & Unicode EOL',
              type: 'checkbox',
              checked: false,
              click: (item) => win.webContents.send('editor:set-option', {
                unicodeHighlight: { invisibleCharacters: item.checked, ambiguousCharacters: item.checked }
              })
            },
            { type: 'separator' },
            {
              id: 'toggle-show-all-chars',
              label: 'Show All Characters',
              type: 'checkbox',
              checked: false,
              click: (item) => {
                const v = item.checked
                win.webContents.send('editor:set-option', { renderWhitespace: v ? 'all' : 'none' })
                win.webContents.send('editor:set-eol-marker', v)
                win.webContents.send('editor:set-option', { renderControlCharacters: v })
                win.webContents.send('editor:set-option', {
                  unicodeHighlight: { invisibleCharacters: v, ambiguousCharacters: v }
                })
              }
            },
          ]
        },
        {
          id: 'toggle-indent-guides',
          label: 'Show Indentation Guides',
          type: 'checkbox',
          checked: true,
          click: (item) => win.webContents.send('editor:set-option', { guides: { indentation: item.checked } })
        },
        {
          label: 'Column Select Mode',
          id: 'column-select',
          type: 'checkbox',
          checked: false,
          click: () => win.webContents.send('editor:command', 'toggleColumnSelect')
        },
        { type: 'separator' },
        {
          label: 'Zoom In',
          ...displayKey('CmdOrCtrl+='),
          click: () => win.webContents.send('editor:command', 'zoomIn')
        },
        {
          label: 'Zoom Out',
          ...displayKey('CmdOrCtrl+-'),
          click: () => win.webContents.send('editor:command', 'zoomOut')
        },
        {
          label: 'Reset Zoom',
          ...displayKey('CmdOrCtrl+0'),
          click: () => win.webContents.send('editor:command', 'zoomReset')
        },
        { type: 'separator' },
        {
          label: 'Folding',
          submenu: [
            { label: 'Fold All', click: () => win.webContents.send('editor:command', 'foldAll') },
            { label: 'Unfold All', click: () => win.webContents.send('editor:command', 'unfoldAll') },
            { type: 'separator' as const },
            {
              label: 'Collapse Level',
              submenu: [1, 2, 3, 4, 5, 6, 7].map((n) => ({
                label: `Level ${n}`,
                click: () => win.webContents.send('editor:command', `foldLevel${n}`)
              }))
            }
          ]
        },
        { type: 'separator' },
        {
          id: 'toggle-split-view',
          label: 'Split View',
          ...displayKey('CmdOrCtrl+\\'),
          type: 'checkbox',
          checked: false,
          click: (item) => win.webContents.send('ui:toggle-split-view', item.checked)
        }
      ]
    },

    // Encoding — sets the encoding / line ending the active buffer is saved
    // with. The renderer (EditorPane) applies the choice to the active buffer
    // and marks it dirty; it takes effect on the next save. Values mirror the
    // ENCODINGS / EOLS registries that drive the status-bar pickers, so the
    // menu and the clickable status bar stay in sync.
    {
      label: '&Encoding',
      submenu: [
        { label: 'Encode in UTF-8', click: () => win.webContents.send('editor:set-encoding', 'UTF-8') },
        { label: 'Encode in UTF-8 with BOM', click: () => win.webContents.send('editor:set-encoding', 'UTF-8 BOM') },
        { label: 'Encode in UTF-16 LE', click: () => win.webContents.send('editor:set-encoding', 'UTF-16 LE') },
        { label: 'Encode in UTF-16 BE', click: () => win.webContents.send('editor:set-encoding', 'UTF-16 BE') },
        { label: 'Encode in Windows-1252 (Latin)', click: () => win.webContents.send('editor:set-encoding', 'windows-1252') },
        { label: 'Encode in ISO-8859-1 (Latin-1)', click: () => win.webContents.send('editor:set-encoding', 'ISO-8859-1') },
        { type: 'separator' as const },
        {
          label: 'EOL Conversion',
          submenu: [
            { label: 'Windows (CR LF)', click: () => win.webContents.send('editor:set-eol', 'CRLF') },
            { label: 'Unix (LF)', click: () => win.webContents.send('editor:set-eol', 'LF') },
            { label: 'Macintosh (CR)', click: () => win.webContents.send('editor:set-eol', 'CR') }
          ]
        }
      ]
    },

    // Tools — developer utilities. Hashing verbs match the per-algorithm
    // submenu in the custom React MenuBar; the other tools open the unified
    // Tools panel deep-linked to a specific tool.
    {
      label: '&Tools',
      submenu: [
        ...(['md5', 'sha1', 'sha256', 'sha512'] as const).map((algo) => ({
          label: algo === 'sha1' ? 'SHA-1' : algo === 'sha256' ? 'SHA-256' : algo === 'sha512' ? 'SHA-512' : 'MD5',
          submenu: [
            { label: 'Generate…', click: () => win.webContents.send('menu:tools-hash', { algo, verb: 'generate' }) },
            { label: 'Generate from files…', click: () => win.webContents.send('menu:tools-hash', { algo, verb: 'files' }) },
            {
              label: 'Generate from selection into clipboard',
              click: () => win.webContents.send('menu:tools-hash', { algo, verb: 'selection' })
            }
          ]
        })),
        { type: 'separator' as const },
        {
          label: 'Encoding & Web',
          submenu: [
            { label: 'URL Encoder', click: () => win.webContents.send('menu:tools-open', 'url') },
            { label: 'JWT Decoder', click: () => win.webContents.send('menu:tools-open', 'jwt') },
            { label: 'CSP Tools', click: () => win.webContents.send('menu:tools-open', 'csp') }
          ]
        },
        {
          label: 'Converters',
          submenu: [
            { label: 'Epoch Converter', click: () => win.webContents.send('menu:tools-open', 'epoch') },
            { label: 'Color Converter', click: () => win.webContents.send('menu:tools-open', 'color') },
            { label: 'Cron Builder', click: () => win.webContents.send('menu:tools-open', 'cron') }
          ]
        },
        {
          label: 'Generators',
          submenu: [
            { label: 'UUID Generator', click: () => win.webContents.send('menu:tools-open', 'uuid') },
            { label: 'Lorem Ipsum', click: () => win.webContents.send('menu:tools-open', 'lorem') }
          ]
        },
        { type: 'separator' as const },
        {
          label: 'Notes',
          ...displayKey('CmdOrCtrl+Shift+N'),
          click: () => win.webContents.send('ui:toggle-notes')
        },
        {
          // Ctrl/Cmd+Shift+A, not +I — Electron reserves +I for DevTools.
          label: 'AI Assistant',
          ...displayKey('CmdOrCtrl+Shift+A'),
          click: () => win.webContents.send('menu:ai-assistant')
        }
      ]
    },

    // Plugins
    {
      label: '&Plugins',
      id: 'plugins-menu',
      submenu: [
        {
          label: 'Plugin Manager...',
          enabled: true,
          click: () => win.webContents.send('menu:plugin-manager')
        },
        { type: 'separator' as const },
        ...Array.from(pluginMenuRegistry.values()).map((entry) => ({
          label: entry.pluginName,
          submenu: entry.items.map((item) => ({
            label: item.label,
            ...(item.accelerator ? { accelerator: item.accelerator } : {}),
            click: item.callback
          }))
        }))
      ]
    },

    // Window
    {
      label: '&Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        { type: 'separator' },
        {
          label: 'Next Tab',
          ...displayKey('CmdOrCtrl+Tab'),
          click: () => win.webContents.send('tab:next')
        },
        {
          label: 'Previous Tab',
          ...displayKey('CmdOrCtrl+Shift+Tab'),
          click: () => win.webContents.send('tab:prev')
        },
        ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : [])
      ]
    },

    // Help
    {
      label: '&Help',
      submenu: [
        {
          label: "What's New",
          click: () => win.webContents.send('menu:whats-new-open')
        },
        ...(isMac ? [] : [{
          label: 'About NovaPad',
          click: () => win.webContents.send('menu:about')
        }]),
        { type: 'separator' },
        {
          label: 'Check for Updates...',
          click: () => win.webContents.send('menu:check-for-updates')
        },
        { type: 'separator' },
        {
          // Not a registry command — F12 stays a real OS accelerator.
          label: 'Toggle Developer Tools',
          accelerator: 'F12',
          click: () => win.webContents.toggleDevTools()
        }
        // The Windows-only hidden Ctrl+, item is gone: `prefs.settings` owns that
        // binding in the renderer now, so a display-only duplicate would do nothing.
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)

  // Windows-only: setApplicationMenu re-attaches the menu to all windows and
  // re-shows the native bar even after an earlier setMenuBarVisibility(false).
  // Re-hide after every rebuild (initial, recents update, plugin reload) and
  // turn OFF auto-hide-on-Alt — with autoHideMenuBar:true, pressing Alt still
  // toggles the bar back into view; we want the bar gone permanently and the
  // custom React MenuBar to be the only menu on Windows. Accelerators
  // (Ctrl+N etc.) keep firing because the Menu object still exists, only its
  // visibility is suppressed.
  if (process.platform === 'win32') {
    win.setAutoHideMenuBar(false)
    win.setMenuBarVisibility(false)
  }
}

export function updateRecentFiles(win: BrowserWindow, files: string[]): void {
  // Menus are immutable after creation — rebuild the whole menu with updated recents
  buildMenu(win, files)
}

export function addPluginMenuItem(
  win: BrowserWindow,
  pluginName: string,
  items: Array<{ label: string; accelerator?: string; callback: () => void }>
): void {
  pluginMenuRegistry.set(pluginName, { pluginName, items })
  // Only rebuild if the menu has already been built once; during initial plugin load,
  // buildMenu is called once at the end and will pick up registered items.
  if (currentWin) buildMenu(win, currentRecentFiles)
}

export function removePluginMenuItem(win: BrowserWindow, pluginName: string): void {
  if (pluginMenuRegistry.delete(pluginName) && currentWin) {
    buildMenu(win, currentRecentFiles)
  }
}
