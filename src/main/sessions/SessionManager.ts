import { app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { BackupManager } from './BackupManager'

interface SessionFile {
  /** Absolute path on disk; null for untitled buffers (only valid when backupPath is set). */
  filePath: string | null
  /** Display name for untitled buffers ("new 1"); null otherwise — title is derived from filePath. */
  title: string | null
  language: string
  encoding: string
  eol: string
  viewState: object | null
  /** Backup filename in userData/backup/ holding the dirty contents, if any. */
  backupPath: string | null
  /** mtime of the on-disk file when this buffer was last loaded — for external-change detection. */
  originalMtime: number
  /** Whether the buffer was dirty at session-save time. */
  isDirty: boolean
}

export type SessionVirtualKind = 'settings' | 'shortcuts' | 'whatsNew' | 'pluginManager' | 'pluginDetail'

interface SessionVirtualTab {
  kind: SessionVirtualKind
  pluginId?: string           // set only for 'pluginDetail'
}

/** Must stay in sync with UIState['sidebarPanel'] in store/uiStore.ts. When these
 *  drifted, 'functions' and 'docmap' silently failed to restore — the validator
 *  below rejected them and the value fell back to 'files'. */
type SidebarPanel = 'files' | 'search' | 'plugins' | 'functions' | 'docmap'

interface Session {
  version: number
  files: SessionFile[]
  virtualTabs: SessionVirtualTab[]
  activeIndex: number
  workspaceFolder?: string
  /** Whether the sidebar was visible at save time. */
  sidebarVisible?: boolean
  /** Which sidebar panel was active at save time. */
  sidebarPanel?: SidebarPanel
  /** Whether the Notes view was expanded at the bottom of the sidebar. */
  notesVisible?: boolean
  /** Paths of folders expanded in the File Browser tree. */
  expandedFolders?: string[]
}

const KNOWN_SIDEBAR_PANELS: ReadonlySet<SidebarPanel> =
  new Set(['files', 'search', 'plugins', 'functions', 'docmap'])

const KNOWN_VIRTUAL_KINDS: ReadonlySet<SessionVirtualKind> = new Set(['settings', 'shortcuts', 'whatsNew', 'pluginManager', 'pluginDetail'])

export class SessionManager {
  private static instance: SessionManager
  private sessionPath: string

  constructor() {
    this.sessionPath = ''
  }

  private getSessionPath(): string {
    if (!this.sessionPath) {
      this.sessionPath = path.join(app.getPath('userData'), 'config', 'session.json')
    }
    return this.sessionPath
  }

  static getInstance(): SessionManager {
    if (!SessionManager.instance) SessionManager.instance = new SessionManager()
    return SessionManager.instance
  }

  save(session: Session): void {
    try {
      const sp = this.getSessionPath()
      const dir = path.dirname(sp)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      // Backup existing session before overwriting
      if (fs.existsSync(sp)) {
        try { fs.copyFileSync(sp, sp + '.bak') } catch { /* ignore backup failure */ }
      }
      fs.writeFileSync(sp, JSON.stringify(session, null, 2), 'utf8')
    } catch (err) {
      console.error('[SessionManager] Failed to save session:', err)
    }
  }

  load(): Session | null {
    const sp = this.getSessionPath()
    // Try main file first, then backup
    for (const file of [sp, sp + '.bak']) {
      try {
        if (!fs.existsSync(file)) continue
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
        const session = this.normalize(raw)
        if (session) return session
      } catch { /* try next */ }
    }
    return null
  }

  /** Normalize any legacy version (v1..v3) to the current v4 format */
  private normalize(raw: unknown): Session | null {
    if (!raw || typeof raw !== 'object') return null
    const obj = raw as Record<string, unknown>
    const files = obj.files as unknown[]
    if (!Array.isArray(files)) return null
    const version = typeof obj.version === 'number' ? obj.version : 1

    const normalizedFiles: SessionFile[] = files
      .filter((f): f is Record<string, unknown> => {
        if (!f || typeof f !== 'object') return false
        const r = f as Record<string, unknown>
        // Pre-v4 entries always had a string filePath. v4+ allows null filePath
        // when a backupPath is present (untitled buffer with snapshotted content).
        if (typeof r.filePath === 'string') return true
        return version >= 4 && r.filePath === null && typeof r.backupPath === 'string'
      })
      .map((f) => ({
        filePath: typeof f.filePath === 'string' ? (f.filePath as string) : null,
        title: typeof f.title === 'string' ? (f.title as string) : null,
        language: (f.language as string) || '',
        encoding: (f.encoding as string) || 'UTF-8',
        eol: (f.eol as string) || 'LF',
        viewState: version >= 2 ? ((f.viewState as object | null) ?? null) : null,
        backupPath: typeof f.backupPath === 'string' ? (f.backupPath as string) : null,
        originalMtime: typeof f.originalMtime === 'number' ? (f.originalMtime as number) : 0,
        isDirty: typeof f.isDirty === 'boolean' ? (f.isDirty as boolean) : false
      }))

    const activeIndex = typeof obj.activeIndex === 'number' ? obj.activeIndex : 0
    const workspaceFolder = typeof obj.workspaceFolder === 'string' ? obj.workspaceFolder : undefined
    const sidebarVisible = typeof obj.sidebarVisible === 'boolean' ? obj.sidebarVisible : undefined
    const notesVisible = typeof obj.notesVisible === 'boolean' ? obj.notesVisible : undefined
    const sidebarPanel = typeof obj.sidebarPanel === 'string' && KNOWN_SIDEBAR_PANELS.has(obj.sidebarPanel as SidebarPanel)
      ? (obj.sidebarPanel as SidebarPanel)
      : undefined
    const expandedFolders = Array.isArray(obj.expandedFolders)
      ? (obj.expandedFolders as unknown[]).filter((p): p is string => typeof p === 'string')
      : undefined

    // virtualTabs is v3+. Skip unknown kinds; tolerate malformed (non-array) values.
    const rawVirtual = obj.virtualTabs
    let virtualTabs: SessionVirtualTab[] = []
    if (version >= 3) {
      if (Array.isArray(rawVirtual)) {
        virtualTabs = rawVirtual
          .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
          .filter((v) => typeof v.kind === 'string' && KNOWN_VIRTUAL_KINDS.has(v.kind as SessionVirtualKind))
          .map((v) => {
            const kind = v.kind as SessionVirtualKind
            if (kind === 'pluginDetail' && typeof v.pluginId === 'string') {
              return { kind, pluginId: v.pluginId }
            }
            return { kind }
          })
        if (virtualTabs.length !== (rawVirtual as unknown[]).length) {
          console.warn('[SessionManager] Skipped', (rawVirtual as unknown[]).length - virtualTabs.length, 'invalid virtualTabs entries')
        }
      } else if (rawVirtual != null) {
        console.warn('[SessionManager] virtualTabs is not an array — ignoring')
      }
    }

    return {
      version: 4,
      files: normalizedFiles,
      virtualTabs,
      activeIndex,
      workspaceFolder,
      sidebarVisible,
      sidebarPanel,
      notesVisible,
      expandedFolders
    }
  }

  restore(win: BrowserWindow): void {
    const session = this.load()

    // Orphan-backup cleanup: any backup file in userData/backup/ that the
    // current session.json doesn't reference is leftover from a previous run
    // that already restored (or chose not to restore) those buffers. Delete
    // them so the folder doesn't grow unbounded over time.
    const referenced = new Set<string>(
      (session?.files ?? [])
        .map((f) => f.backupPath)
        .filter((p): p is string => !!p)
    )
    try {
      BackupManager.getInstance().cleanupExcept(referenced)
    } catch (err) {
      console.warn('[SessionManager] backup cleanup failed:', err)
    }

    if (session) {
      win.webContents.once('did-finish-load', () => {
        win.webContents.send('session:restore', session)
      })
    }
  }
}
