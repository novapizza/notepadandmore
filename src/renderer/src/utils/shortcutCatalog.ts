import { isMacOS } from './platform'
import { COMMANDS } from '../commands/definitions'
import type { CommandSection } from '../commands/types'

/** Alias — sections come from the command registry now. */
export type ShortcutSection = CommandSection

export interface ShortcutDef {
  id: string
  label: string
  section: ShortcutSection
  /** Canonical binding using `Mod` for the platform-primary modifier (Ctrl on Win/Linux, Cmd on macOS).
   *  Examples: `Mod+S`, `Mod+Shift+F`, `Alt+Up`, `F2`, `Tab`. Use `+` to separate. */
  defaultKey: string
  /** The OS or Monaco owns this keystroke — displayed, but not rebindable. */
  nativeKey?: boolean
}

/**
 * Derived from the command registry: every static command that declares a
 * default binding, in declaration order (which drives both the Settings ▸
 * Shortcuts grouping and conflict precedence). Runtime contributions carry no
 * `defaultKey`, and this reads `COMMANDS` rather than `allCommands()`, so they
 * can never leak in here (BR-009).
 */
export const SHORTCUT_CATALOG: ShortcutDef[] = COMMANDS.filter((c) => c.defaultKey).map((c) => ({
  id: c.id,
  label: c.label,
  section: c.section,
  defaultKey: c.defaultKey!,
  ...(c.nativeKey ? { nativeKey: true } : {})
}))

export const SHORTCUT_SECTIONS: ShortcutSection[] = [
  'File',
  'Edit',
  'Search',
  'View',
  'Encoding',
  'Tools',
  'Preferences',
  'Plugins',
  'Window',
  'Help'
]

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
