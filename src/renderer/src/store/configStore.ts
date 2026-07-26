import { create } from 'zustand'

export interface AppConfig {
  // General
  language: string
  maxRecentFiles: number

  /** Persisted app chrome + Monaco theme (theme id from utils/themes.ts). */
  theme: string

  // Editor
  fontSize: number
  fontFamily: string
  tabSize: number
  insertSpaces: boolean
  wordWrap: boolean
  /** Auto-enable wordWrap when beautifying/pasting content with over-long lines. */
  autoWrapLongLines: boolean
  showLineNumbers: boolean
  renderWhitespace: 'none' | 'boundary' | 'all'
  renderIndentGuides: boolean
  highlightCurrentLine: boolean
  bracketPairColorization: boolean
  showMinimap: boolean

  // Auto-Completion
  autoCompleteEnabled: boolean
  autoCloseBrackets: boolean
  autoCloseQuotes: boolean
  wordBasedSuggestions: boolean

  // New Document defaults
  defaultEol: 'CRLF' | 'LF' | 'CR'
  defaultEncoding: string
  defaultLanguage: string

  // Backup / AutoSave
  autoSaveEnabled: boolean
  autoSaveIntervalMs: number
  backupEnabled: boolean
  backupDir: string
  /** Notepad++-style snapshot: keep dirty/untitled buffers across restarts via backup files. */
  rememberUnsavedOnExit: boolean
  /** Snapshot timer interval for the remember-unsaved feature. Min 1000ms. */
  snapshotIntervalMs: number

  // What's New
  /** App version string the user was last shown the auto-open for; null = never seen. */
  lastSeenVersion: string | null

  /** Whole-window zoom level (Electron webFrame zoom level; 0 = 100%). Applied on launch. */
  windowZoomLevel: number

  /** Keyboard-shortcut overrides keyed by command id (see shortcutCatalog).
   *  Absent entries fall back to the catalog default. */
  shortcuts: Record<string, string>

  // AI Assistant
  // NOTE: the API key is NOT here. It lives encrypted via Electron safeStorage in
  // userData/config/ai-credentials.enc and is only ever handled in the main
  // process — see src/main/ai/credentials.ts. Never add a key field to this file:
  // config.json is plaintext and gets copied around in bug reports.
  /** Master switch. Off by default — nothing is sent anywhere until the user opts in. */
  aiEnabled: boolean
  /** Provider id from src/main/ai/gemini.ts PROVIDERS. */
  aiProvider: string
  aiModel: string
  /** Show the floating provider badge at the bottom-right of the editor. */
  aiShowBadge: boolean
  /** What document context accompanies a prompt by default.
   *  'auto' = selection when one exists, otherwise the whole document. */
  aiDefaultContext: 'auto' | 'selection' | 'document' | 'none'
  /** Upper bound on characters of document text sent per request. */
  aiMaxContextChars: number
}

export const CONFIG_DEFAULTS: AppConfig = {
  language: 'en',
  maxRecentFiles: 10,
  theme: 'dark',
  fontSize: 14,
  fontFamily: "'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
  tabSize: 4,
  insertSpaces: true,
  wordWrap: false,
  autoWrapLongLines: true,
  showLineNumbers: true,
  renderWhitespace: 'none',
  renderIndentGuides: true,
  highlightCurrentLine: true,
  bracketPairColorization: true,
  showMinimap: false,
  autoCompleteEnabled: true,
  autoCloseBrackets: true,
  autoCloseQuotes: true,
  wordBasedSuggestions: true,
  defaultEol: 'LF',
  defaultEncoding: 'UTF-8',
  defaultLanguage: 'plaintext',
  autoSaveEnabled: true,
  autoSaveIntervalMs: 60000,
  backupEnabled: true,
  backupDir: '',
  rememberUnsavedOnExit: true,
  snapshotIntervalMs: 7000,
  lastSeenVersion: null,
  windowZoomLevel: 0,
  shortcuts: {},
  aiEnabled: false,
  aiProvider: 'gemini',
  aiModel: 'gemini-3.5-flash',
  aiShowBadge: true,
  aiDefaultContext: 'auto',
  aiMaxContextChars: 200000
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

interface ConfigState extends AppConfig {
  loaded: boolean
  load: () => Promise<void>
  save: () => Promise<void>
  setProp: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  ...CONFIG_DEFAULTS,
  loaded: false,

  load: async () => {
    try {
      const raw = await window.api.config.readRaw('config.json')
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AppConfig>
        set({ ...CONFIG_DEFAULTS, ...parsed, loaded: true })
      } else {
        set({ loaded: true })
      }
    } catch {
      set({ loaded: true })
    }
  },

  save: async () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    const state = get()
    const cfg: AppConfig = {} as AppConfig
    for (const k of Object.keys(CONFIG_DEFAULTS) as (keyof AppConfig)[]) {
      ;(cfg as Record<string, unknown>)[k] = state[k]
    }
    try {
      await window.api.config.writeRaw('config.json', JSON.stringify(cfg, null, 2))
    } catch (e) {
      console.error('config save failed', e)
    }
  },

  setProp: (key, value) => {
    set({ [key]: value } as Partial<ConfigState>)
    // Debounced save
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => get().save(), 500)
  }
}))
