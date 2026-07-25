import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as chardet from 'chardet'
import * as iconv from 'iconv-lite'
import { addRecent, loadRecents } from '../recentFiles'
import { updateRecentFiles } from '../menu'
import { markSelfSaved, markSelfRemoved } from './watchHandlers'
import { collectFilesAsync } from './findInFilesLogic'

/** Hard cap on files returned by file:list-files-recursive (Quick Open). */
const QUICK_OPEN_MAX_FILES = 20000

export function registerFileHandlers(): void {
  // Read file with encoding detection. Returns the raw byte sample so the renderer
  // can run Magika with the WebGL-accelerated TF.js backend (much faster than main's
  // pure-JS CPU backend).
  ipcMain.handle('file:read', async (_event, filePath: string) => {
    try {
      const raw = await fs.promises.readFile(filePath)
      const sample = raw.subarray(0, Math.min(raw.length, 65536))
      const encoding = chardet.detect(sample) || 'UTF-8'
      const content = iconv.decode(raw, encoding)
      const stats = await fs.promises.stat(filePath)
      const eol = content.includes('\r\n') ? 'CRLF' : content.includes('\r') ? 'CR' : 'LF'
      // BOM detection: a faithful save needs to re-emit the BOM if the original
      // file had one. Without this, .sqlplan (UTF-16 LE w/ BOM) and similar
      // files become unreadable after the first save -- chardet can't reliably
      // detect UTF-16 without the BOM signal, so reopen produces gibberish.
      const hasBom =
        raw.length >= 2 && (
          (raw[0] === 0xFF && raw[1] === 0xFE) ||                                   // UTF-16 LE
          (raw[0] === 0xFE && raw[1] === 0xFF) ||                                   // UTF-16 BE
          (raw.length >= 3 && raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) // UTF-8
        )
      // Send the Magika sample as plain bytes (up to 16KB is enough for detection).
      const magikaSample = new Uint8Array(raw.buffer, raw.byteOffset, Math.min(raw.length, 16384))
      return { content, encoding, eol, mtime: stats.mtimeMs, hasBom, magikaSample, error: null }
    } catch (err: any) {
      return { content: '', encoding: 'UTF-8', eol: 'LF', mtime: 0, hasBom: false, magikaSample: new Uint8Array(0), error: err.message }
    }
  })

  // Write file and return the written bytes sample so the renderer can
  // re-run Magika to update syntax highlighting if the content now matches
  // a different format (e.g. untitled.txt saved with JSON content).
  ipcMain.handle('file:write', async (_event, filePath: string, content: string, encoding = 'UTF-8', eol = 'LF', hasBom = false) => {
    try {
      let normalized = content
      normalized = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      if (eol === 'CRLF') normalized = normalized.replace(/\n/g, '\r\n')
      else if (eol === 'CR') normalized = normalized.replace(/\n/g, '\r')

      // Preserve the original BOM if the file had one. iconv-lite supports
      // addBOM for utf-8 / utf-16le / utf-16be variants.
      const buf = iconv.encode(normalized, encoding, hasBom ? { addBOM: true } : {})
      // Tell the file watcher to ignore the change event our own write will trigger
      markSelfSaved(filePath)
      fs.writeFileSync(filePath, buf)
      const magikaSample = new Uint8Array(buf.buffer, buf.byteOffset, Math.min(buf.length, 16384))
      return { error: null, magikaSample }
    } catch (err: any) {
      return { error: err.message, magikaSample: new Uint8Array(0) }
    }
  })

  // Save dialog. When a suggestedExt is provided (e.g. "json" because the
  // active buffer was detected as JSON), we put a matching filter first so the
  // OS dialog defaults to that file type, AND we append the extension to the
  // defaultPath if it doesn't already have one. This drives the "Save dialog
  // pre-fills the right extension based on autodetect" UX.
  ipcMain.handle('file:save-dialog', async (_event, defaultPath?: string, suggestedExt?: string | null) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return { canceled: true, filePath: null }

    let resolvedDefault = defaultPath
    if (suggestedExt && resolvedDefault) {
      const base = path.basename(resolvedDefault)
      // Append the suggested extension only when the file has no extension yet
      // (e.g. "new 1"). Don't rename existing extensions in Save As — that
      // would surprise the user.
      if (!base.includes('.')) {
        resolvedDefault = resolvedDefault + '.' + suggestedExt
      }
    }

    const filters: Electron.FileFilter[] = []
    if (suggestedExt) {
      const display = suggestedExt.toUpperCase()
      filters.push({ name: `${display} Files`, extensions: [suggestedExt] })
    }
    filters.push({ name: 'All Files', extensions: ['*'] })
    filters.push({ name: 'Text Files', extensions: ['txt'] })

    const result = await dialog.showSaveDialog(win, {
      defaultPath: resolvedDefault,
      filters
    })
    return result
  })

  // Modal confirm / alert, run from the MAIN process.
  //
  // Never use the renderer's window.confirm()/alert() for these. Those spin a
  // nested message loop inside the renderer, which wedges Monaco's
  // animation-frame render scheduler: after the dialog closes the editor stops
  // painting and stops accepting keystrokes for the rest of the session, even
  // though React keeps re-rendering around it (the tab bar still responds).
  // dialog.showMessageBox runs in main and leaves the renderer's loop alive.
  ipcMain.handle(
    'dialog:confirm',
    async (event, message: string, detail?: string, confirmLabel?: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.MessageBoxOptions = {
        type: 'warning',
        buttons: [confirmLabel || 'OK', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        message,
        ...(detail ? { detail } : {})
      }
      const { response } = win
        ? await dialog.showMessageBox(win, options)
        : await dialog.showMessageBox(options)
      return response === 0
    }
  )

  ipcMain.handle('dialog:alert', async (event, message: string, detail?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.MessageBoxOptions = {
      type: 'error',
      buttons: ['OK'],
      noLink: true,
      message,
      ...(detail ? { detail } : {})
    }
    if (win) await dialog.showMessageBox(win, options)
    else await dialog.showMessageBox(options)
  })

  // Check if file was modified externally
  ipcMain.handle('file:check-mtime', async (_event, filePath: string, knownMtime: number) => {
    try {
      const stats = fs.statSync(filePath)
      return { changed: stats.mtimeMs > knownMtime, mtime: stats.mtimeMs }
    } catch {
      return { changed: false, mtime: knownMtime }
    }
  })

  // Batch stat check (used for session restore — check all files in one IPC call)
  ipcMain.handle('file:stat-batch', async (_event, filePaths: string[]) => {
    return filePaths.map((fp) => {
      try {
        const stats = fs.statSync(fp)
        return { filePath: fp, exists: true, mtime: stats.mtimeMs }
      } catch {
        return { filePath: fp, exists: false, mtime: 0 }
      }
    })
  })

  // Get file stats
  ipcMain.handle('file:stat', async (_event, filePath: string) => {
    try {
      const stats = fs.statSync(filePath)
      return { exists: true, size: stats.size, mtime: stats.mtimeMs, isDir: stats.isDirectory() }
    } catch {
      return { exists: false, size: 0, mtime: 0, isDir: false }
    }
  })

  // List directory
  ipcMain.handle('file:list-dir', async (_event, dirPath: string) => {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      return entries.map((e) => ({
        name: e.name,
        path: path.join(dirPath, e.name),
        isDir: e.isDirectory()
      }))
    } catch (err: any) {
      return []
    }
  })

  // Recursively list every file under a directory, for the Quick Open (Ctrl+P)
  // fuzzy file finder. Reuses the Find-in-Files walker, which already skips
  // dotfiles + node_modules and yields to the event loop so it won't block.
  ipcMain.handle('file:list-files-recursive', async (_event, dirPath: string, max = QUICK_OPEN_MAX_FILES) => {
    const cap = Math.min(typeof max === 'number' && max > 0 ? max : QUICK_OPEN_MAX_FILES, QUICK_OPEN_MAX_FILES)
    const files: { path: string; name: string }[] = []
    let truncated = false
    try {
      for await (const fp of collectFilesAsync(dirPath, /.*/, true)) {
        if (files.length >= cap) { truncated = true; break }
        files.push({ path: fp, name: path.basename(fp) })
      }
    } catch {
      // Best-effort — return whatever was collected before the error.
    }
    return { files, truncated }
  })

  // Create file
  ipcMain.handle('file:create', async (_event, filePath: string) => {
    try {
      fs.writeFileSync(filePath, '')
      return { error: null }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Delete file or directory
  ipcMain.handle('file:delete', async (_event, filePath: string) => {
    try {
      // Our own deletion — suppress the watcher's 'unlink' for this path and any
      // open file underneath it (folder delete) so it isn't reported as external.
      markSelfRemoved(filePath)
      const stat = fs.statSync(filePath)
      if (stat.isDirectory()) {
        fs.rmSync(filePath, { recursive: true })
      } else {
        fs.unlinkSync(filePath)
      }
      return { error: null }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Create directory
  ipcMain.handle('file:mkdir', async (_event, dirPath: string) => {
    try {
      fs.mkdirSync(dirPath, { recursive: true })
      return { error: null }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Get recent files
  ipcMain.handle('file:get-recents', () => {
    return loadRecents()
  })

  // Rename/move file
  ipcMain.handle('file:rename', async (_event, oldPath: string, newPath: string) => {
    try {
      // Our own move — suppress the watcher's 'unlink' on the old path so it
      // isn't reported as an external deletion.
      markSelfRemoved(oldPath)
      fs.renameSync(oldPath, newPath)
      return { error: null }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // Reveal in file explorer
  ipcMain.handle('file:reveal', async (_event, filePath: string) => {
    const { shell } = await import('electron')
    shell.showItemInFolder(filePath)
  })

  // Add to recent documents
  ipcMain.on('file:add-recent', (_event, filePath: string) => {
    app.addRecentDocument(filePath)
    const updated = addRecent(filePath)
    const win = BrowserWindow.getFocusedWindow()
    if (win) updateRecentFiles(win, updated)
  })

  ipcMain.handle('file:open-dialog', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    // Single "All Files" filter only — Windows persists the user's last-used
    // filter selection across dialog opens (an OS behavior Electron can't
    // override), so listing extra filters causes the dialog to remember
    // e.g. "Text Files" and reopen with it. Keeping a single filter forces
    // the dialog to always show every file type by default.
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'All Files', extensions: ['*'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths
  })

  ipcMain.handle('file:open-dir-dialog', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
