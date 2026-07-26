import { app, shell, BrowserWindow, ipcMain, Menu, session } from 'electron'
import { join, resolve } from 'path'
import * as fs from 'fs'
import { DEEPLINK_SCHEME, initDeeplink, handleDeeplinkUrl, extractDeeplinkArgs } from './deeplink'
import { buildMenu } from './menu'
import { registerFileHandlers } from './ipc/fileHandlers'
import { registerConfigHandlers } from './ipc/configHandlers'
import { registerPluginHandlers } from './ipc/pluginHandlers'
import { registerSearchHandlers } from './ipc/searchHandlers'
import { registerWatchHandlers } from './ipc/watchHandlers'
import { registerUpdateHandlers } from './ipc/updateHandlers'
import { registerBackupHandlers } from './ipc/backupHandlers'
import { registerToolsHandlers } from './ipc/toolsHandlers'
import { registerPrintHandlers } from './ipc/printHandlers'
import { registerAiHandlers } from './ipc/aiHandlers'
import { UpdateManager } from './update/UpdateManager'
import { PluginLoader } from './plugins/PluginLoader'
import { SessionManager } from './sessions/SessionManager'
import { installNavigationGuards } from './windows/navigationGuards'
import { loadRecents } from './recentFiles'

// Mirror of the <meta> CSP in src/renderer/index.html, plus frame-ancestors
// (which <meta> ignores). Keep the two in sync. style-src keeps 'unsafe-inline'
// because Monaco/Radix inject inline styles; script-src needs neither
// 'unsafe-inline' nor 'unsafe-eval' (verified: Monaco runs clean without them).
const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://google.github.io",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'"
].join('; ')

let mainWindow: BrowserWindow | null = null

/** True when quit was initiated (Cmd+Q / Quit); false for macOS red close button only. */
let isQuitting = false

// Last-resort net: keep the app alive instead of popping Electron's default
// "A JavaScript error occurred in the main process" dialog. Individual
// subsystems should still handle their own errors; this only catches things
// that slip through (e.g. a new event emitter without an 'error' listener).
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason)
})

type OpenItem = { kind: 'file' | 'folder'; path: string }

/**
 * Items queued to open as soon as the renderer is ready. Populated by:
 *  - process.argv on cold launch (Windows + Linux "Open with" routes args here)
 *  - app 'open-file' event before window exists (macOS Finder "Open With")
 *  - second-instance event (Windows: dropped file/folder onto running exe)
 * Drained on 'app:renderer-ready' from the renderer (sent after its IPC
 * listeners are attached). `did-finish-load` is too early — it fires after the
 * `load` event but before React's useEffect runs, so listeners aren't ready.
 */
const pendingOpenItems: OpenItem[] = []
let rendererReady = false

/**
 * Generic renderer-bound messages (deeplink payloads, their toasts) queued for
 * the same renderer-ready race as pendingOpenItems.
 */
const pendingRendererMessages: Array<{ channel: string; args: unknown[] }> = []

function sendToRendererWhenReady(channel: string, ...args: unknown[]): void {
  if (!mainWindow || !rendererReady) {
    pendingRendererMessages.push({ channel, args })
    return
  }
  mainWindow.webContents.send(channel, ...args)
}

// Register novapad:// with the OS. In dev (process.defaultApp) the protocol
// must point at the electron binary + the app path, otherwise the OS would try
// to launch the bare Electron shell without our main script.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEPLINK_SCHEME, process.execPath, [resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient(DEEPLINK_SCHEME)
}

initDeeplink({
  sendToRenderer: sendToRendererWhenReady,
  getWindow: () => mainWindow
})

/** Stat each arg; keep only real files and directories. CLI flags and bogus paths are dropped. */
function classifyPaths(paths: string[]): OpenItem[] {
  const out: OpenItem[] = []
  for (const p of paths) {
    if (!p || p.startsWith('-')) continue
    try {
      const s = fs.statSync(p)
      if (s.isFile()) out.push({ kind: 'file', path: p })
      else if (s.isDirectory()) out.push({ kind: 'folder', path: p })
    } catch {
      // Not a path on disk — skip silently.
    }
  }
  return out
}

/** Send queued items to the renderer (or queue them if it isn't ready yet). */
function dispatchOpenItems(items: OpenItem[]): void {
  if (items.length === 0) return
  if (!mainWindow || !rendererReady) {
    pendingOpenItems.push(...items)
    return
  }
  const files = items.filter((i) => i.kind === 'file').map((i) => i.path)
  const folders = items.filter((i) => i.kind === 'folder').map((i) => i.path)
  if (files.length) mainWindow.webContents.send('menu:file-open', files)
  if (folders.length) {
    // Single-folder workspace model — open the first, warn about extras.
    mainWindow.webContents.send('menu:folder-open', folders[0])
    if (folders.length > 1) {
      mainWindow.webContents.send(
        'ui:show-toast',
        'Only one folder can be opened at a time. Opened the first.',
        'warn'
      )
    }
  }
}

// Single-instance lock: when the user launches NovaPad a second time (e.g.
// double-clicks another .json after the app is already running), Windows
// spawns a new exe process. We want to forward those args to the existing
// instance instead of launching a separate window.
//
// Skip in E2E mode — Playwright launches one Electron instance per test
// sequentially, and OS lock release timing can race the next launch.
if (process.env['E2E_TEST'] !== '1') {
  const gotInstanceLock = app.requestSingleInstanceLock()
  if (!gotInstanceLock) {
    app.quit()
  } else {
    app.on('second-instance', (_event, argv) => {
      // Windows/Linux deliver novapad:// activations for a running instance
      // through argv of the second process.
      extractDeeplinkArgs(argv).forEach(handleDeeplinkUrl)
      // Unpackaged runs carry the bundle path at argv[1] — skip it so the
      // main script itself is never treated as a user-opened file.
      const items = classifyPaths(argv.slice(app.isPackaged ? 1 : 2))
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        if (!mainWindow.isVisible()) mainWindow.show()
        mainWindow.focus()
      }
      dispatchOpenItems(items)
    })
  }
}

// macOS routes "Open With → NovaPad" through this event instead of argv.
// It can fire BEFORE app.whenReady; dispatchOpenItems queues the path and the
// 'app:renderer-ready' handler drains it once the renderer's listeners exist.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (filePath) dispatchOpenItems(classifyPaths([filePath]))
})

// macOS delivers novapad:// activations here (both cold start and running app).
// handleDeeplinkUrl awaits app.whenReady internally, so early delivery is safe.
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeeplinkUrl(url)
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    show: false,
    // Linux: autohide so Alt reveals the native menu (legacy behavior preserved).
    // Windows: do NOT autohide — autoHideMenuBar:true causes Alt to toggle the
    // bar back into view, producing two menus stacked with the custom React
    // MenuBar. setMenuBarVisibility(false) below + a re-hide inside buildMenu
    // keep the native bar permanently invisible.
    autoHideMenuBar: process.platform === 'linux',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Electron defaults this to true, which loads a Hunspell dictionary
      // (~30-50 MB resident per BrowserWindow). We don't surface a spellcheck
      // UI anywhere, so opt out.
      spellcheck: false
    }
  })

  // Windows-only: also force the native menu bar fully hidden so Alt no
  // longer reveals it. The custom React <MenuBar> already covers every
  // action, and on some Windows configs autoHideMenuBar leaves the bar
  // visible after an Alt tap — which produced a "two menus stacked" look
  // (native bar + React bar). Linux keeps the autoHide-on-Alt behavior.
  if (process.platform === 'win32') {
    mainWindow.setMenuBarVisibility(false)
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow!.maximize()
    mainWindow!.show()
  })

  // Reset readiness on every navigation (e.g. dev reload). The renderer will
  // re-send 'app:renderer-ready' after its useEffect re-attaches IPC listeners.
  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  installNavigationGuards(mainWindow.webContents)

  mainWindow.on('close', (e) => {
    if (process.env['E2E_TEST'] === '1') return // allow Playwright teardown
    // Let renderer handle unsaved changes check before close
    e.preventDefault()
    mainWindow?.webContents.send('app:before-close')
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    // Must match electron-builder.yml's `appId`. Windows uses this for taskbar
    // grouping, jump lists, and toast notifications — when it differs from
    // the packaged appId, dev and packaged builds are treated as separate apps.
    app.setAppUserModelId('com.novapad.app')
  }

  // Cold-launch arg handling: when Windows/Linux "Open with NovaPad" (file or
  // folder) fires for the *first* instance, the path lands in process.argv.
  // Queue now; 'app:renderer-ready' drains it once renderer listeners attach.
  // Unpackaged runs (dev/E2E: `electron out/main/index.js …`) carry the bundle
  // path at argv[1] — skip it so it is never opened as a file.
  if (process.env['E2E_TEST'] !== '1') {
    const initialItems = classifyPaths(process.argv.slice(app.isPackaged ? 1 : 2))
    if (initialItems.length) pendingOpenItems.push(...initialItems)
    // Cold launch via a novapad:// link on Windows/Linux puts the URL in argv.
    extractDeeplinkArgs(process.argv).forEach(handleDeeplinkUrl)
  }

  // Content-Security-Policy as a response header (defense in depth alongside the
  // <meta> CSP in index.html). The header can express frame-ancestors, which <meta>
  // cannot. Note: webRequest may not fire for file:// in the packaged build, so the
  // <meta> tag remains the primary control there — this hardens dev + http subresources.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP_POLICY]
      }
    })
  })

  // Register IPC handlers (no window dependency)
  registerFileHandlers()
  registerConfigHandlers()
  registerPluginHandlers()
  registerBackupHandlers()
  registerToolsHandlers()
  registerPrintHandlers()
  registerAiHandlers()

  createWindow()

  // Register handlers that need mainWindow reference
  registerSearchHandlers(mainWindow!)
  registerWatchHandlers(mainWindow!)

  // Auto-update: write-access check, periodic checks, silent install on hide
  const updateManager = new UpdateManager(mainWindow!)
  registerUpdateHandlers(updateManager)
  void updateManager.init()

  // Load plugins BEFORE buildMenu so plugin menu items are included in the initial build.
  // Plugins register menu items via addPluginMenuItem which populates a registry; since
  // currentWin is still null at this point, no rebuild is triggered during loading.
  PluginLoader.getInstance().loadAll(mainWindow!)

  // Build native menu after plugins have registered their menu items
  buildMenu(mainWindow!, loadRecents())

  // Restore last session (skip in E2E mode for clean test state)
  if (process.env['E2E_TEST'] !== '1') {
    SessionManager.getInstance().restore(mainWindow!)
  }

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
    } else if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || process.env['E2E_TEST'] === '1') app.quit()
})

// Renderer signals it has attached its IPC listeners (in App.tsx useEffect).
// Until this fires, any 'menu:file-open' / 'menu:folder-open' we send would
// land on a channel with no listener and be silently dropped — see the
// pendingOpenItems comment for the full race. We drain the queue here.
ipcMain.on('app:renderer-ready', () => {
  rendererReady = true
  if (pendingOpenItems.length > 0) {
    const items = pendingOpenItems.splice(0, pendingOpenItems.length)
    dispatchOpenItems(items)
  }
  if (pendingRendererMessages.length > 0 && mainWindow) {
    const messages = pendingRendererMessages.splice(0, pendingRendererMessages.length)
    for (const m of messages) mainWindow.webContents.send(m.channel, ...m.args)
  }
})

ipcMain.on('app:close-cancelled', () => {
  isQuitting = false
})

ipcMain.on('session:save', (_event, session) => {
  SessionManager.getInstance().save(session)
})

// Expose the real app version (app.getVersion() reads from packaged metadata,
// unlike the env-var-based window.api.appVersion which is unreliable in prod).
ipcMain.handle('app:get-version', () => app.getVersion())

// Toggle DevTools from the custom in-app menu (native menu is hidden by autoHideMenuBar).
ipcMain.on('dev:toggle-devtools', () => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow
  win?.webContents.toggleDevTools()
})

// Window controls for the custom React MenuBar (Window menu). On macOS the
// native menu's minimize/zoom roles handle this; on Windows/Linux the native
// menu is hidden, so the renderer drives these via IPC.
ipcMain.on('window:minimize', () => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow
  win?.minimize()
})

// "Zoom" maps to maximize/restore toggle, matching the macOS zoom role.
ipcMain.on('window:toggle-maximize', () => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow
  if (!win) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})

// Bidirectional state sync: renderer → main (update native menu checkboxes)
const toggleKeyToMenuId: Record<string, string> = {
  showToolbar: 'toggle-toolbar',
  showStatusBar: 'toggle-statusbar',
  showSidebar: 'toggle-sidebar',
  wordWrap: 'toggle-word-wrap',
  renderWhitespace: 'toggle-whitespace',
  showEOL: 'toggle-show-eol',
  showNonPrinting: 'toggle-show-non-printing',
  showControlChars: 'toggle-show-control-chars',
  indentationGuides: 'toggle-indent-guides',
  columnSelectMode: 'column-select',
  splitView: 'toggle-split-view'
}

ipcMain.on('ui:state-changed', (_event, payload: { key: string; value: boolean }) => {
  const menuId = toggleKeyToMenuId[payload.key]
  if (!menuId) return
  const menu = Menu.getApplicationMenu()
  if (!menu) return
  const item = menu.getMenuItemById(menuId)
  if (item) item.checked = payload.value
})

ipcMain.on('app:close-confirmed', () => {
  // macOS: close window (red button) keeps app in Dock; Cmd+Q / Quit still exits.
  if (process.platform === 'darwin' && !isQuitting) {
    mainWindow?.hide()
    return
  }
  mainWindow?.destroy()
  app.quit()
})

export { mainWindow }
