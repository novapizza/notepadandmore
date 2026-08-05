import { TOOLS } from '../components/Tools/tools'
import { THEMES, applyTheme } from '../utils/themes'
import { useUIStore } from '../store/uiStore'
import { useEditorStore } from '../store/editorStore'
import { useConfigStore } from '../store/configStore'
import { usePluginStore } from '../store/pluginStore'
import { slugify } from './definitions'
import type { CommandDef } from './types'

/**
 * Commands generated at call time from metadata that already exists elsewhere:
 * the tool catalog, the theme catalog, the Settings categories, and whatever
 * menu items plugins have contributed.
 *
 * None of these carry a `defaultKey` (BR-009), so they never reach
 * `SHORTCUT_CATALOG` and never appear in the Shortcuts editor. Adding a tool or
 * a theme therefore needs no edit here.
 */

const SETTINGS_CATEGORIES: Array<{ id: string; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'editor', label: 'Editor' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'newDoc', label: 'New Document' },
  { id: 'backup', label: 'Backup / AutoSave' },
  { id: 'completion', label: 'Auto-Completion' },
  { id: 'shortcuts', label: 'Keyboard Shortcuts' },
  { id: 'ai', label: 'AI Assistant' }
]

function toolCommands(): CommandDef[] {
  return TOOLS.map((t) => ({
    id: `tools.open.${t.id}`,
    label: t.label,
    section: 'Tools' as const,
    keywords: `${t.group} ${t.description}`,
    run: () => useUIStore.getState().openTool(t.id)
  }))
}

function themeCommands(): CommandDef[] {
  return THEMES.map((t) => ({
    id: `theme.set.${t.id}`,
    label: `Color Theme → ${t.name}`,
    section: 'Preferences' as const,
    keywords: `theme appearance colors ${t.sub} ${t.base}`,
    run: () => {
      useConfigStore.getState().setProp('theme', t.id)
      useUIStore.getState().setTheme(t.id)
      applyTheme(t.id)
    }
  }))
}

function settingsCommands(): CommandDef[] {
  return SETTINGS_CATEGORIES.map((c) => ({
    id: `settings.open.${c.id}`,
    label: `Open Settings → ${c.label}`,
    section: 'Preferences' as const,
    keywords: `settings preferences ${c.label}`,
    run: () => {
      useUIStore.getState().setPendingSettingsCategory(c.id)
      useEditorStore.getState().openVirtualTab('settings')
    }
  }))
}

/**
 * Read from the store on every call, so entries appear and disappear with the
 * plugin's state. Both halves of the id are slugified: a plugin name or label
 * carrying spaces or punctuation must not produce a malformed or colliding id.
 * The `run` payload keeps the original strings — main-side validation of
 * `plugin:invoke-menu-click` is what decides whether they resolve.
 */
function pluginCommands(): CommandDef[] {
  const seen = new Set<string>()
  const out: CommandDef[] = []
  for (const { pluginName, label } of usePluginStore.getState().dynamicMenuItems) {
    const id = `plugin.${slugify(pluginName)}.${slugify(label)}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      label: `${pluginName} → ${label}`,
      section: 'Plugins',
      keywords: `plugin ${pluginName}`,
      run: () => window.api.send('plugin:invoke-menu-click', pluginName, label)
    })
  }
  return out
}

export function contributedCommands(): CommandDef[] {
  return [...toolCommands(), ...themeCommands(), ...settingsCommands(), ...pluginCommands()]
}
