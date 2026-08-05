import { useUIStore } from '../store/uiStore'
import { useEditorStore } from '../store/editorStore'
import { useConfigStore } from '../store/configStore'
import { useAiStore } from '../store/aiStore'
import { ENCODINGS, EOLS } from '../constants/registries'
import type { CommandContext, CommandDef } from './types'

/**
 * The static command registry: every hand-declared command in one list.
 *
 * Declaration order is significant — it drives both the grouping/order of
 * Settings ▸ Keyboard Shortcuts and conflict precedence (first match wins,
 * BR-004). Section order: File, Edit, Search, View, Encoding, Tools,
 * Preferences, Plugins, Window, Help.
 *
 * Ids are permanent. The 49 originally in `SHORTCUT_CATALOG` are preserved
 * verbatim because they key users' persisted `config.shortcuts` overrides.
 */

// ── Dispatch helpers ─────────────────────────────────────────────────────────

/** Re-front the existing `editor:command` bus — EditorPane's switch is untouched. */
const editorVerb = (verb: string) => (): void => {
  window.dispatchEvent(new CustomEvent('editor:command', { detail: verb }))
}

const ui = () => useUIStore.getState()
const editors = () => useEditorStore.getState()

const activeBuffer = () => {
  const s = useEditorStore.getState()
  return s.buffers.find((b) => b.id === s.activeId) ?? null
}

/** Selection text used to seed the Find dialog — mirrors App.tsx's getEditorSelection. */
const selectionSeed = (ctx: CommandContext): string => {
  const editor = ctx.editor
  if (!editor) return ''
  const sel = editor.getSelection()
  if (!sel) return ''
  const text = editor.getModel()?.getValueInRange(sel) ?? ''
  return text.includes('\n') ? '' : text.trim()
}

const openSettingsAt = (category: string | null): void => {
  if (category) ui().setPendingSettingsCategory(category)
  editors().openVirtualTab('settings')
}

/** Lowercase, non-alphanumerics collapsed to `-`. Keeps generated ids well-formed. */
export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

// ── `when` predicates ────────────────────────────────────────────────────────
// Each is defensive: a missing buffer or editor returns false rather than throwing.

const hasEditor = (ctx: CommandContext): boolean => ctx.editor !== null
/** Any tab at all is open (including virtual tabs like Settings). */
const hasBuffer = (): boolean => activeBuffer() !== null
/** The active tab is a real file/untitled buffer, not a virtual tab. */
const hasFileBuf = (): boolean => {
  const b = activeBuffer()
  return !!b && b.kind === 'file'
}
/** A file buffer that may be modified — excludes read-only deeplink tabs. */
const isWritable = (): boolean => {
  const b = activeBuffer()
  return !!b && b.kind === 'file' && !b.isReadOnly
}
const hasSelection = (ctx: CommandContext): boolean => {
  const sel = ctx.editor?.getSelection()
  return !!sel && !sel.isEmpty()
}
const hasWorkspace = (): boolean => !!ui().workspaceFolder

// ── Editor-verb commands ─────────────────────────────────────────────────────
// Thin declaration table for the ~35 commands whose whole implementation is
// "dispatch the verb EditorPane already handles".

interface VerbSpec {
  id: string
  label: string
  section: CommandDef['section']
  verb: string
  key?: string
  keywords?: string
  when?: CommandDef['when']
  nativeKey?: boolean
}

const VERB_COMMANDS: VerbSpec[] = [
  // File
  { id: 'file.print', label: 'Print…', section: 'File', verb: 'printDocument', key: 'Mod+Alt+P', when: hasFileBuf, keywords: 'printer' },
  { id: 'file.exportPdf', label: 'Export to PDF…', section: 'File', verb: 'exportPdf', when: hasFileBuf, keywords: 'pdf export save' },

  // Edit — selection anchors
  { id: 'edit.beginEndSelect', label: 'Begin/End Select', section: 'Edit', verb: 'beginEndSelect', key: 'Mod+Shift+B', when: hasFileBuf, keywords: 'anchor mark range' },
  { id: 'edit.beginEndSelectColumn', label: 'Begin/End Select (Column Mode)', section: 'Edit', verb: 'beginEndSelectColumn', key: 'Mod+Shift+Alt+B', when: hasFileBuf, keywords: 'anchor rectangular block' },

  // Edit — line operations
  { id: 'edit.duplicateLine', label: 'Duplicate Line', section: 'Edit', verb: 'duplicateLine', key: 'Mod+D', when: isWritable, keywords: 'copy line' },
  { id: 'edit.deleteLine', label: 'Delete Line', section: 'Edit', verb: 'deleteLine', key: 'Mod+Shift+K', when: isWritable, keywords: 'remove line' },
  { id: 'edit.moveLineUp', label: 'Move Line Up', section: 'Edit', verb: 'moveLineUp', key: 'Alt+Up', when: isWritable },
  { id: 'edit.moveLineDown', label: 'Move Line Down', section: 'Edit', verb: 'moveLineDown', key: 'Alt+Down', when: isWritable },
  { id: 'edit.sortLinesAsc', label: 'Sort Lines Ascending', section: 'Edit', verb: 'sortLinesAsc', when: isWritable, keywords: 'order alphabetical' },
  { id: 'edit.sortLinesDesc', label: 'Sort Lines Descending', section: 'Edit', verb: 'sortLinesDesc', when: isWritable, keywords: 'order reverse alphabetical' },

  // Edit — case conversion
  { id: 'edit.toUpperCase', label: 'UPPERCASE', section: 'Edit', verb: 'toUpperCase', key: 'Mod+Shift+U', when: isWritable, keywords: 'case upper capitals' },
  { id: 'edit.toLowerCase', label: 'lowercase', section: 'Edit', verb: 'toLowerCase', key: 'Mod+Shift+L', when: isWritable, keywords: 'case lower' },
  { id: 'edit.toTitleCase', label: 'Title Case', section: 'Edit', verb: 'toTitleCase', when: isWritable, keywords: 'case title capitalize' },

  // Edit — copy path
  { id: 'edit.copyFullPath', label: 'Copy Full File Path', section: 'Edit', verb: 'copyFullPath', when: hasFileBuf, keywords: 'clipboard path' },
  { id: 'edit.copyFileName', label: 'Copy File Name', section: 'Edit', verb: 'copyFileName', when: hasFileBuf, keywords: 'clipboard name' },
  { id: 'edit.copyDirPath', label: 'Copy Directory Path', section: 'Edit', verb: 'copyDirPath', when: hasFileBuf, keywords: 'clipboard folder directory' },

  // Edit — insert
  { id: 'edit.insertDateTimeShort', label: 'Insert Date && Time — Short', section: 'Edit', verb: 'insertDateTimeShort', when: isWritable, keywords: 'date time timestamp now' },
  { id: 'edit.insertDateTimeLong', label: 'Insert Date && Time — Long', section: 'Edit', verb: 'insertDateTimeLong', when: isWritable, keywords: 'date time timestamp now' },

  // Edit — comments and whitespace
  { id: 'edit.toggleComment', label: 'Toggle Comment', section: 'Edit', verb: 'toggleComment', key: 'Mod+/', when: isWritable, keywords: 'comment uncomment' },
  { id: 'edit.toggleBlockComment', label: 'Toggle Block Comment', section: 'Edit', verb: 'toggleBlockComment', key: 'Mod+Shift+/', when: isWritable, keywords: 'comment uncomment block' },
  { id: 'edit.trimTrailingWhitespace', label: 'Trim Trailing Whitespace', section: 'Edit', verb: 'trimTrailingWhitespace', when: isWritable, keywords: 'whitespace spaces clean' },

  // Edit — transforms
  { id: 'edit.beautify', label: 'Beautify', section: 'Edit', verb: 'beautify', key: 'Mod+Alt+Shift+M', when: isWritable, keywords: 'format pretty print json sql xml' },
  { id: 'edit.transformSchema', label: 'Transform schema', section: 'Edit', verb: 'transformToDiagram', key: 'Mod+Alt+Shift+K', when: hasFileBuf, keywords: 'diagram er prisma dbml ddl' },
  { id: 'edit.removeDuplicates', label: 'Remove Duplicates', section: 'Edit', verb: 'removeDuplicates', key: 'Mod+Alt+Shift+C', when: isWritable, keywords: 'deduplicate dedupe unique lines' },

  // Edit — indent. Monaco owns Tab/Shift+Tab natively, so the dispatcher never
  // claims them; these entries exist so the menu and palette reach the action.
  { id: 'edit.indent', label: 'Indent Selection', section: 'Edit', verb: 'indentSelection', key: 'Tab', when: isWritable, nativeKey: true },
  { id: 'edit.outdent', label: 'Outdent Selection', section: 'Edit', verb: 'outdentSelection', key: 'Shift+Tab', when: isWritable, nativeKey: true, keywords: 'unindent dedent' },

  // Search — Monaco-driven
  { id: 'search.goToLine', label: 'Go to Line…', section: 'Search', verb: 'goToLine', key: 'Mod+G', when: hasFileBuf, keywords: 'jump line number' },
  { id: 'search.toggleBookmark', label: 'Toggle Bookmark', section: 'Search', verb: 'toggleBookmark', key: 'Mod+F2', when: hasFileBuf },
  { id: 'search.nextBookmark', label: 'Next Bookmark', section: 'Search', verb: 'nextBookmark', key: 'F2', when: hasFileBuf },
  { id: 'search.prevBookmark', label: 'Previous Bookmark', section: 'Search', verb: 'prevBookmark', key: 'Shift+F2', when: hasFileBuf },
  { id: 'search.clearBookmarks', label: 'Clear All Bookmarks', section: 'Search', verb: 'clearBookmarks', when: hasFileBuf },

  // View
  { id: 'view.preview', label: 'Preview', section: 'View', verb: 'togglePreview', key: 'Mod+P', when: hasFileBuf, keywords: 'markdown csv json sqlplan render' },
  { id: 'view.zoomIn', label: 'Zoom In', section: 'View', verb: 'zoomIn', key: 'Mod+=' },
  { id: 'view.zoomOut', label: 'Zoom Out', section: 'View', verb: 'zoomOut', key: 'Mod+-' },
  { id: 'view.zoomReset', label: 'Reset Zoom', section: 'View', verb: 'zoomReset', key: 'Mod+0' },
  { id: 'view.columnSelectMode', label: 'Column Select Mode', section: 'View', verb: 'toggleColumnSelect', when: hasEditor, keywords: 'rectangular block selection' },
  { id: 'view.foldAll', label: 'Fold All', section: 'View', verb: 'foldAll', when: hasEditor, keywords: 'collapse folding' },
  { id: 'view.unfoldAll', label: 'Unfold All', section: 'View', verb: 'unfoldAll', when: hasEditor, keywords: 'expand folding' }
]

const verbCommands: CommandDef[] = VERB_COMMANDS.map((v) => ({
  id: v.id,
  label: v.label,
  section: v.section,
  ...(v.key ? { defaultKey: v.key } : {}),
  ...(v.keywords ? { keywords: v.keywords } : {}),
  ...(v.when ? { when: v.when } : {}),
  ...(v.nativeKey ? { nativeKey: true } : {}),
  run: editorVerb(v.verb)
}))

const pick = (id: string): CommandDef => {
  const c = verbCommands.find((x) => x.id === id)
  if (!c) throw new Error(`unknown verb command: ${id}`)
  return c
}
const picks = (...ids: string[]): CommandDef[] => ids.map(pick)

// ── Encoding / EOL commands ──────────────────────────────────────────────────
// Dispatch the same CustomEvents the status-bar Quick Picks use.

const encodingCommands: CommandDef[] = ENCODINGS.map((e) => ({
  id: `encoding.set.${slugify(e.value)}`,
  label: `Encode in ${e.label}`,
  section: 'Encoding' as const,
  keywords: `encoding charset ${e.value}`,
  when: isWritable,
  run: () => {
    window.dispatchEvent(new CustomEvent('editor:set-encoding', { detail: e.value }))
  }
}))

const eolCommands: CommandDef[] = EOLS.map((eo) => ({
  id: `eol.set.${slugify(eo.value)}`,
  label: `EOL Conversion → ${eo.label}`,
  section: 'Encoding' as const,
  keywords: `line ending newline eol ${eo.value}`,
  when: isWritable,
  run: () => {
    window.dispatchEvent(new CustomEvent('editor:set-eol', { detail: eo.value }))
  }
}))

// ── Role-owned commands ──────────────────────────────────────────────────────
// Undo/Redo/Cut/Copy/Paste/Select All are Electron `role:` items (BR-003): the OS
// owns the keystroke and they are not rebindable. They stay in the registry only
// so their ids — and therefore any already-persisted overrides — survive, and so
// Settings ▸ Keyboard Shortcuts keeps documenting their keys.

interface RoleSpec {
  id: string
  label: string
  key: string
}

const ROLE_COMMANDS: RoleSpec[] = [
  { id: 'edit.undo', label: 'Undo', key: 'Mod+Z' },
  { id: 'edit.redo', label: 'Redo', key: 'Mod+Y' },
  { id: 'edit.cut', label: 'Cut', key: 'Mod+X' },
  { id: 'edit.copy', label: 'Copy', key: 'Mod+C' },
  { id: 'edit.paste', label: 'Paste', key: 'Mod+V' },
  { id: 'edit.selectAll', label: 'Select All', key: 'Mod+A' }
]

const roleCommands: CommandDef[] = ROLE_COMMANDS.map((r) => ({
  id: r.id,
  label: r.label,
  section: 'Edit' as const,
  defaultKey: r.key,
  nativeKey: true,
  paletteHidden: true,
  run: () => {
    /* Owned by the OS role / Monaco — nothing to dispatch. */
  }
}))

// ── The registry ─────────────────────────────────────────────────────────────

export const COMMANDS: CommandDef[] = [
  // ── File ──────────────────────────────────────────────────────────────────
  {
    id: 'file.new',
    label: 'New File',
    section: 'File',
    defaultKey: 'Mod+N',
    keywords: 'create untitled',
    run: (ctx) => {
      ctx.fileOps?.newFile()
    }
  },
  {
    id: 'file.open',
    label: 'Open File…',
    section: 'File',
    defaultKey: 'Mod+O',
    run: async (ctx) => {
      if (!ctx.fileOps) return
      const paths = await window.api.file.openDialog()
      if (paths) await ctx.fileOps.openFiles(paths)
    }
  },
  {
    id: 'file.openFolder',
    label: 'Open Folder…',
    section: 'File',
    defaultKey: 'Mod+Shift+O',
    keywords: 'workspace directory project',
    run: async () => {
      const dir = await window.api.file.openDirDialog()
      if (!dir) return
      // Fresh root — drop the previous tree's expanded paths (mirrors App.tsx).
      ui().setExpandedFolders([])
      ui().setWorkspaceFolder(dir)
      ui().setShowSidebar(true)
      ui().setSidebarPanel('files')
    }
  },
  {
    id: 'file.save',
    label: 'Save',
    section: 'File',
    defaultKey: 'Mod+S',
    when: hasFileBuf,
    run: (ctx) => {
      const id = editors().activeId
      if (id) void ctx.fileOps?.saveBuffer(id)
    }
  },
  {
    id: 'file.saveAs',
    label: 'Save As…',
    section: 'File',
    defaultKey: 'Mod+Shift+S',
    when: hasFileBuf,
    run: (ctx) => {
      void ctx.fileOps?.saveActiveAs()
    }
  },
  {
    id: 'file.saveAll',
    label: 'Save All',
    section: 'File',
    defaultKey: 'Mod+Alt+S',
    // Sequential: saveBuffer raises a native Save As dialog per untitled buffer,
    // so saving in parallel would stack N dialogs at once (as in App.tsx).
    run: async (ctx) => {
      const ops = ctx.fileOps
      if (!ops) return
      for (const b of editors().buffers) {
        if (b.isDirty) await ops.saveBuffer(b.id)
      }
    }
  },
  {
    id: 'file.reload',
    label: 'Reload from Disk',
    section: 'File',
    defaultKey: 'Mod+R',
    when: hasFileBuf,
    keywords: 'revert refresh',
    run: (ctx) => {
      const id = editors().activeId
      if (id) void ctx.fileOps?.reloadBuffer(id)
    }
  },
  {
    id: 'file.close',
    label: 'Close File',
    section: 'File',
    defaultKey: 'Mod+W',
    when: hasBuffer,
    keywords: 'close tab',
    run: (ctx) => {
      const id = editors().activeId
      if (id) void ctx.fileOps?.closeBuffer(id)
    }
  },
  {
    id: 'file.closeAll',
    label: 'Close All Files',
    section: 'File',
    when: hasBuffer,
    keywords: 'close every tab',
    // Sequential for the same reason as saveAll: one confirm dialog per dirty buffer.
    run: async (ctx) => {
      const ops = ctx.fileOps
      if (!ops) return
      for (const b of editors().buffers) await ops.closeBuffer(b.id)
    }
  },
  ...picks('file.print', 'file.exportPdf'),

  // ── Edit ──────────────────────────────────────────────────────────────────
  ...roleCommands,
  ...picks(
    'edit.beginEndSelect',
    'edit.beginEndSelectColumn',
    'edit.duplicateLine',
    'edit.deleteLine',
    'edit.moveLineUp',
    'edit.moveLineDown',
    'edit.sortLinesAsc',
    'edit.sortLinesDesc',
    'edit.toUpperCase',
    'edit.toLowerCase',
    'edit.toTitleCase',
    'edit.copyFullPath',
    'edit.copyFileName',
    'edit.copyDirPath',
    'edit.insertDateTimeShort',
    'edit.insertDateTimeLong',
    'edit.toggleComment',
    'edit.toggleBlockComment',
    'edit.trimTrailingWhitespace',
    'edit.beautify',
    'edit.transformSchema',
    'edit.removeDuplicates',
    'edit.indent',
    'edit.outdent'
  ),

  // ── Search ────────────────────────────────────────────────────────────────
  {
    id: 'search.find',
    label: 'Find…',
    section: 'Search',
    defaultKey: 'Mod+F',
    keywords: 'search',
    run: (ctx) => ui().openFind('find', selectionSeed(ctx))
  },
  {
    id: 'search.replace',
    label: 'Replace…',
    section: 'Search',
    defaultKey: 'Mod+H',
    keywords: 'search substitute',
    run: (ctx) => ui().openFind('replace', selectionSeed(ctx))
  },
  {
    id: 'search.findInFiles',
    label: 'Find in Files…',
    section: 'Search',
    defaultKey: 'Mod+Shift+F',
    when: hasWorkspace,
    keywords: 'search workspace folder grep',
    run: (ctx) => ui().openFind('findInFiles', selectionSeed(ctx))
  },
  {
    id: 'search.mark',
    label: 'Mark…',
    section: 'Search',
    // Deliberately unbound: Ctrl+M stays a native accelerator on Windows, and
    // ⌘M is the OS minimize shortcut on macOS.
    keywords: 'highlight search',
    run: (ctx) => ui().openFind('mark', selectionSeed(ctx))
  },
  ...picks(
    'search.goToLine',
    'search.toggleBookmark',
    'search.nextBookmark',
    'search.prevBookmark',
    'search.clearBookmarks'
  ),
  {
    id: 'search.commandPalette',
    label: 'Command Palette',
    section: 'Search',
    defaultKey: 'Mod+Shift+P',
    keywords: 'commands run show all',
    run: () => ui().setCommandPalette('commands')
  },
  {
    id: 'search.goToFile',
    label: 'Go to File…',
    section: 'Search',
    defaultKey: 'Mod+E',
    when: hasWorkspace,
    keywords: 'quick open fuzzy file finder',
    run: () => ui().setCommandPalette('files')
  },

  // ── View ──────────────────────────────────────────────────────────────────
  {
    id: 'view.toggleSidebar',
    label: 'Toggle Sidebar',
    section: 'View',
    defaultKey: 'Mod+B',
    keywords: 'explorer files panel',
    run: () => ui().setShowSidebar(!ui().showSidebar)
  },
  pick('view.preview'),
  {
    id: 'view.wordWrap',
    label: 'Word Wrap',
    section: 'View',
    defaultKey: 'Alt+Z',
    keywords: 'wrap lines',
    run: () => {
      const v = !ui().wordWrap
      ui().setWordWrap(v)
      window.dispatchEvent(
        new CustomEvent('editor:set-option-local', { detail: { wordWrap: v ? 'on' : 'off' } })
      )
    }
  },
  ...picks('view.zoomIn', 'view.zoomOut', 'view.zoomReset'),
  {
    id: 'view.aiAssistant',
    label: 'AI Assistant',
    section: 'View',
    // Mod+Shift+A, not Mod+Shift+I — Electron reserves Ctrl/Cmd+Shift+I for DevTools.
    defaultKey: 'Mod+Shift+A',
    keywords: 'ai chat gemini assistant',
    run: () => {
      // Off means "not set up yet" — send the user somewhere useful rather than
      // toggling a panel they can't use.
      if (!useConfigStore.getState().aiEnabled) {
        openSettingsAt('ai')
        return
      }
      useAiStore.getState().togglePanel()
    }
  },
  {
    id: 'view.notes',
    label: 'Notes',
    section: 'View',
    defaultKey: 'Mod+Shift+N',
    keywords: 'sticky notes scratchpad',
    run: () => ui().toggleNotesPanel()
  },
  {
    id: 'view.toggleToolbar',
    label: 'Toggle Toolbar',
    section: 'View',
    run: () => ui().setShowToolbar(!ui().showToolbar)
  },
  {
    id: 'view.toggleStatusBar',
    label: 'Toggle Status Bar',
    section: 'View',
    run: () => ui().setShowStatusBar(!ui().showStatusBar)
  },
  {
    id: 'view.splitView',
    label: 'Split View',
    section: 'View',
    defaultKey: 'Mod+\\',
    when: hasFileBuf,
    keywords: 'split editor side by side',
    run: () => ui().setSplitView(!ui().splitView)
  },
  ...picks('view.columnSelectMode', 'view.foldAll', 'view.unfoldAll'),

  // ── Encoding ──────────────────────────────────────────────────────────────
  ...encodingCommands,
  ...eolCommands,

  // ── Preferences ───────────────────────────────────────────────────────────
  {
    id: 'prefs.settings',
    label: 'Open Settings',
    section: 'Preferences',
    defaultKey: 'Mod+,',
    keywords: 'preferences options configuration',
    run: () => openSettingsAt(null)
  },
  {
    id: 'prefs.shortcuts',
    label: 'Open Keyboard Shortcuts',
    section: 'Preferences',
    keywords: 'keybindings keys rebind',
    run: () => openSettingsAt('shortcuts')
  },
  {
    id: 'prefs.toggleTheme',
    label: 'Toggle Light/Dark Mode',
    section: 'Preferences',
    keywords: 'theme dark light appearance',
    run: () => {
      ui().toggleTheme()
      useConfigStore.getState().setProp('theme', ui().theme)
    }
  },

  // ── Plugins ───────────────────────────────────────────────────────────────
  {
    id: 'plugins.manager',
    label: 'Plugin Manager',
    section: 'Plugins',
    keywords: 'extensions plugins install',
    run: () => {
      editors().openPluginManagerTab()
    }
  },

  // ── Window ────────────────────────────────────────────────────────────────
  {
    id: 'window.nextTab',
    label: 'Next Tab',
    section: 'Window',
    defaultKey: 'Mod+Tab',
    run: () => {
      const s = editors()
      const idx = s.buffers.findIndex((b) => b.id === s.activeId)
      const next = s.buffers[(idx + 1) % s.buffers.length]
      if (next) s.setActive(next.id)
    }
  },
  {
    id: 'window.prevTab',
    label: 'Previous Tab',
    section: 'Window',
    defaultKey: 'Mod+Shift+Tab',
    run: () => {
      const s = editors()
      const idx = s.buffers.findIndex((b) => b.id === s.activeId)
      const prev = s.buffers[(idx - 1 + s.buffers.length) % s.buffers.length]
      if (prev) s.setActive(prev.id)
    }
  },

  // ── Help ──────────────────────────────────────────────────────────────────
  {
    id: 'help.whatsNew',
    label: "What's New",
    section: 'Help',
    keywords: 'changelog release notes version',
    run: () => {
      editors().openVirtualTab('whatsNew')
    }
  },
  {
    id: 'help.about',
    label: 'About NovaPad',
    section: 'Help',
    keywords: 'version credits',
    run: () => ui().setShowAbout(true)
  },
  {
    id: 'help.checkForUpdates',
    label: 'Check for Updates…',
    section: 'Help',
    keywords: 'update upgrade version',
    run: () => {
      void window.api.update.check()
    }
  }
]

// Re-exported for the palette's own `when` needs and for tests.
export { hasEditor, hasBuffer, hasFileBuf, isWritable, hasSelection, hasWorkspace }
