// Mirror of the preload `api` shape exposed via contextBridge.
// Keep in sync with src/preload/index.ts — this file is a renderer-side
// type contract because tsconfig.web.json does not include the preload
// source directly.

interface ElectronAPI {
  platform: string
  appVersion: string

  file: {
    read: (filePath: string) => Promise<{
      content: string
      encoding: string
      eol: string
      mtime: number
      magikaSample: Uint8Array
      error: string | null
    }>
    write: (
      filePath: string,
      content: string,
      encoding?: string,
      eol?: string,
      hasBom?: boolean
    ) => Promise<{ error: string | null; magikaSample: Uint8Array }>
    saveDialog: (
      defaultPath?: string,
      suggestedExt?: string | null
    ) => Promise<{ canceled: boolean; filePath?: string }>
    openDialog: () => Promise<string[] | null>
    openDirDialog: () => Promise<string | null>
    checkMtime: (
      filePath: string,
      mtime: number
    ) => Promise<{ changed: boolean; mtime: number }>
    stat: (
      filePath: string
    ) => Promise<{ exists: boolean; size: number; mtime: number; isDir: boolean }>
    statBatch: (
      filePaths: string[]
    ) => Promise<Array<{ filePath: string; exists: boolean; mtime: number }>>
    listDir: (
      dirPath: string
    ) => Promise<Array<{ name: string; path: string; isDir: boolean }>>
    listFilesRecursive: (
      dirPath: string,
      max?: number
    ) => Promise<{ files: Array<{ path: string; name: string }>; truncated: boolean }>
    create: (filePath: string) => Promise<{ error: string | null }>
    delete: (filePath: string) => Promise<{ error: string | null }>
    rename: (oldPath: string, newPath: string) => Promise<{ error: string | null }>
    reveal: (filePath: string) => Promise<void>
    addRecent: (filePath: string) => void
    mkdir: (dirPath: string) => Promise<{ error: string | null }>
    getRecents: () => Promise<string[]>
    pathForFile: (file: File) => string
  }

  /**
   * Modal prompts served by the main process. Always use these instead of the
   * renderer's window.confirm()/alert(), which freeze Monaco permanently.
   */
  dialog: {
    confirm: (message: string, detail?: string, confirmLabel?: string) => Promise<boolean>
    alert: (message: string, detail?: string) => Promise<void>
  }

  config: {
    getDir: () => Promise<string>
    read: (name: string) => Promise<unknown>
    write: (name: string, data: object) => Promise<void>
    readRaw: (name: string) => Promise<string | null>
    writeRaw: (name: string, content: string) => Promise<void>
    listUDL: () => Promise<string[]>
    readUDL: (filename: string) => Promise<unknown>
    writeUDL: (filename: string, data: object) => Promise<void>
  }

  plugin: {
    list: () => Promise<unknown>
    detail: (name: string) => Promise<unknown>
    enable: (name: string) => Promise<unknown>
    disable: (name: string) => Promise<unknown>
    reloadOne: (name: string) => Promise<unknown>
    install: () => Promise<unknown>
    uninstall: (name: string) => Promise<unknown>
    settingsSchemas: () => Promise<unknown>
    reload: () => Promise<unknown>
  }

  search: {
    start: (opts: object) => Promise<unknown>
    cancel: (searchId: string) => Promise<unknown>
  }

  watch: {
    add: (filePath: string) => Promise<void>
    remove: (filePath: string) => Promise<void>
  }

  backup: {
    write: (filename: string, content: string) => Promise<unknown>
    read: (filename: string) => Promise<string | null>
    delete: (filename: string) => Promise<unknown>
    getDir: () => Promise<string>
    list: () => Promise<string[]>
    cleanup: (keep: string[]) => Promise<unknown>
  }

  tools: {
    hash: (algo: string, text: string) => Promise<{ hex: string | null; error: string | null }>
    hashFiles: (algo: string) => Promise<{
      canceled: boolean
      error: string | null
      files: Array<{ path: string; name: string; size: number; hex: string | null; error: string | null }>
    }>
  }

  print: {
    toPdf: (
      html: string,
      defaultPath?: string
    ) => Promise<{ canceled: boolean; filePath?: string; error?: string }>
    document: (html: string) => Promise<{ success: boolean; error?: string }>
  }

  /**
   * AI assistant. There is intentionally no `getKey` — the plaintext API key
   * never crosses the bridge. `status()` returns a last-4 hint only.
   */
  ai: {
    status: (provider: string) => Promise<{
      provider: string
      available: boolean
      hasKey: boolean
      hint: string | null
      defaultModels: string[]
      error: string | null
    }>
    setKey: (provider: string, key: string) => Promise<{ error: string | null }>
    clearKey: (provider: string) => Promise<{ error: string | null }>
    providers: () => Promise<Array<{ id: string; label: string; defaultModels: string[] }>>
    test: (provider: string) => Promise<{ ok: boolean; models: string[]; error: string | null }>
    send: (
      provider: string,
      request: object
    ) => Promise<{ requestId: string | null; error: string | null }>
    cancel: (requestId: string) => Promise<{ error: string | null }>
  }

  app: {
    getVersion: () => Promise<string>
  }

  zoom: {
    get: () => number
    set: (level: number) => number
    in: () => number
    out: () => number
    reset: () => number
  }

  update: {
    check: () => Promise<void>
    install: () => Promise<void>
    capable: () => Promise<boolean>
  }

  on: (channel: string, callback: (...args: unknown[]) => void) => () => void
  off: (channel: string) => void
  send: (channel: string, ...args: unknown[]) => void
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}

export {}
