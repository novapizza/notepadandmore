import type * as monaco from 'monaco-editor'
import type { useFileOps } from '../hooks/useFileOps'

/**
 * Command sections. A superset of the old `ShortcutSection` union, which is now
 * an alias of this type — so Settings ▸ Keyboard Shortcuts simply gains the new
 * groups rather than needing its own list.
 */
export type CommandSection =
  | 'File'
  | 'Edit'
  | 'Search'
  | 'View'
  | 'Encoding'
  | 'Tools'
  | 'Preferences'
  | 'Plugins'
  | 'Window'
  | 'Help'

/** The handle `useFileOps()` returns, bridged out of React via fileOpsRegistry. */
export type FileOpsHandle = ReturnType<typeof useFileOps>

export interface CommandContext {
  /** Monaco instance, or null when no editor is mounted. */
  editor: monaco.editor.IStandaloneCodeEditor | null
  /** File operations bridged out of App.tsx. Null before App mounts. */
  fileOps: FileOpsHandle | null
}

export interface CommandDef {
  /**
   * Stable, dot-namespaced id, e.g. `edit.duplicateLine`. **Never change one
   * once shipped** — it is the key under which a user's `config.shortcuts`
   * override is persisted, so a rename silently discards their rebind.
   */
  id: string
  label: string
  section: CommandSection
  /** Canonical binding using `Mod` (Ctrl on Windows/Linux, Cmd on macOS).
   *  Absent = palette-only, unbindable. */
  defaultKey?: string
  /** Extra search terms, space-separated. Searchable but never displayed. */
  keywords?: string
  /**
   * The keystroke belongs to the OS (an Electron `role:`) or to Monaco itself,
   * so the renderer must not claim it: the dispatcher skips these, and the
   * Shortcuts editor shows the binding read-only. `defaultKey` is still set so
   * the key is documented where users look for it.
   */
  nativeKey?: boolean
  /** Never list in the command palette (OS roles, which the palette can't own). */
  paletteHidden?: boolean
  /** Availability. Absent = always available. Gates palette visibility only. */
  when?: (ctx: CommandContext) => boolean
  run: (ctx: CommandContext) => void | Promise<void>
}
