# Technical Spec: Command Palette & Command Registry

**Feature:** command-palette
**Date:** 2026-08-04

> References:
> - [PRD](./prd.md) — features, user stories, business rules
> - [Brainstorm Notes](./raw/notes.md) — decision rationale, conflict resolution, bugs found

---

## 1. Overview

Three layers, built bottom-up:

1. **Registry** (`src/renderer/src/commands/`) — `CommandDef[]` with handlers. Becomes the single
   source for the palette, the key dispatcher, the Shortcuts editor, and (where practical) the menus.
2. **Dispatcher** — one capture-phase `keydown` listener. Native accelerators become display-only
   via `registerAccelerator: false`, which is what makes rebinding work and eliminates double-firing.
3. **Palette** — one overlay with a command mode and a file mode, replacing `QuickOpenPalette`.

The registry re-fronts existing dispatch rather than rewriting it: ~35 editor commands still emit
the same `CustomEvent('editor:command', …)` that `EditorPane.dispatchCommand` already handles.

---

## 2. Data Shapes

### 2.1 `CommandDef`

`src/renderer/src/commands/types.ts`

```ts
export type CommandSection =
  | 'File' | 'Edit' | 'Search' | 'View' | 'Window'      // existing ShortcutSection values
  | 'Encoding' | 'Tools' | 'Preferences' | 'Plugins' | 'Help'

export interface CommandContext {
  /** Monaco instance, or null when no editor is mounted. */
  editor: monaco.editor.IStandaloneCodeEditor | null
  /** File operations bridged out of App.tsx — see §3.2. Null before App mounts. */
  fileOps: FileOpsHandle | null
}

export interface CommandDef {
  /** Stable, dot-namespaced, e.g. 'edit.duplicateLine'. Never change once shipped —
   *  it is the key for config.shortcuts overrides. */
  id: string
  label: string
  section: CommandSection
  /** Canonical binding using `Mod`. Absent = palette-only, unbindable. */
  defaultKey?: string
  /** Extra search terms, space-separated. Not displayed. */
  keywords?: string
  /** Availability. Absent = always available. Palette visibility only (BR-005). */
  when?: (ctx: CommandContext) => boolean
  run: (ctx: CommandContext) => void | Promise<void>
}
```

`CommandSection` is a superset of the existing `ShortcutSection`, so `SHORTCUT_SECTIONS` widens and
Settings ▸ Keyboard Shortcuts gains sections. That is intended.

### 2.2 Palette state

Lives in `uiStore` (it must participate in overlay exclusivity):

```ts
/** null = closed. 'commands' | 'files' = open in that mode. */
commandPaletteMode: 'commands' | 'files' | null
setCommandPalette: (mode: 'commands' | 'files' | null) => void
```

`quickOpenVisible` is **removed** and its entry in `CLOSE_TOP_OVERLAYS` replaced with
`commandPaletteMode: null`. `setCommandPalette(mode)` spreads `CLOSE_TOP_OVERLAYS` when opening,
exactly as `setQuickOpenVisible` does today ([`uiStore.ts:306`](../../../src/renderer/src/store/uiStore.ts)).

Query text, selected index and MRU are **component/module state**, not store state.

### 2.3 Palette row (both modes adapt to this)

```ts
interface PaletteRow {
  key: string                 // command id, or file path
  /** Left-hand text with fuzzy highlight applied. */
  primary: string
  matchRanges: number[]
  /** Muted text after the primary: section for commands, relative dir for files. */
  secondary?: string
  /** Right-aligned: formatted binding for commands; unused for files. */
  trailing?: string
  invoke: () => void
}
```

### 2.4 Fuzzy adapter

`fuzzyFilter` requires `{ name: string; path: string }` and is left untouched (BR: no regression to
file search). Commands adapt:

```ts
interface CommandSearchItem { name: string; path: string; cmd: CommandDef }

const toSearchItem = (c: CommandDef): CommandSearchItem => ({
  name: c.label,
  path: `${c.section} ${c.label} ${c.keywords ?? ''}`,
  cmd: c
})
```

Because `fuzzyFilter` adds `+100` to name matches, a label hit outranks a section/keyword hit for
free, and `matchRanges` apply to the label (path matches return empty ranges — same as file mode).

### 2.5 Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_RESULTS` | `50` | Cap applied **after** ranking |
| `MRU_SIZE` | `5` | Recent commands shown on empty query |
| `COMMAND_PREFIX` | `'>'` | Mode switch character |

---

## 3. Registry Module

### 3.1 Files

| File | Contents |
|------|----------|
| `commands/types.ts` | `CommandSection`, `CommandContext`, `CommandDef` |
| `commands/registry.ts` | `COMMANDS`, `getCommand`, `runCommand`, `getContext`, `availableCommands`, MRU |
| `commands/definitions.ts` | The static `CommandDef[]` |
| `commands/contributions.ts` | Runtime entries from tools / themes / settings / plugins (§8) |
| `commands/useCommandKeys.ts` | The single keybinding dispatcher hook (§5) |
| `commands/fileOpsRegistry.ts` | Module singleton bridging `useFileOps` out of React (§3.2) |

### 3.2 `fileOpsRegistry`

Mirrors [`editorRegistry`](../../../src/renderer/src/utils/editorRegistry.ts) exactly — the same
problem (a non-React module needing a React-owned handle) with the same solution:

```ts
let _fileOps: FileOpsHandle | null = null
export const fileOpsRegistry = {
  set(f: FileOpsHandle | null): void { _fileOps = f },
  get(): FileOpsHandle | null { return _fileOps }
}
```

`FileOpsHandle` is the return type of `useFileOps()`. `App.tsx` calls
`fileOpsRegistry.set(fileOps)` in an effect on mount and `set(null)` on unmount.

### 3.3 Registry API

```ts
export const COMMANDS: CommandDef[]     // static definitions, declaration order preserved

export function getContext(): CommandContext {
  return { editor: editorRegistry.get(), fileOps: fileOpsRegistry.get() }
}

/** Static + contributed, deduped by id (static wins). */
export function allCommands(): CommandDef[]

export function getCommand(id: string): CommandDef | undefined

/** Filters by `when`, treating a thrown predicate as unavailable (US-012). */
export function availableCommands(): CommandDef[]

/** Looks up, runs with a fresh context, records MRU. No-ops on unknown id. */
export function runCommand(id: string): void

export function recentCommandIds(): string[]     // newest first, max MRU_SIZE
```

Duplicate-id detection runs once at module load and `console.error`s in dev (US-001). `runCommand`
wraps `run` in try/catch and toasts on throw — a broken command must not take down the palette.

MRU is a module-level `string[]`, session-only (BR-009 / US-015).

---

## 4. Command Inventory

### 4.1 Migration classes

| Class | Count | Handling |
|-------|-------|----------|
| Editor verbs | ~35 | `run: () => window.dispatchEvent(new CustomEvent('editor:command', { detail: verb }))`. `EditorPane`'s switch is untouched (BR-008). |
| File ops | 8 | Via `ctx.fileOps` (`openFiles`, `save`, `saveAs`, `saveAll`, `reload`, `close`, `closeAll`, `newFile`) |
| UI toggles | ~8 | `useUIStore.getState()` setters — sidebar, statusbar, toolbar, split view, preview, word wrap, find, find-in-files |
| Encoding / EOL | 9 | `window.dispatchEvent(new CustomEvent('editor:set-encoding' \| 'editor:set-eol', { detail }))` — the mechanism the status-bar Quick Picks already use |
| Virtual tabs | ~4 | `useEditorStore.getState().openVirtualTab(kind)` / `openPluginManagerTab()` |
| Palette itself | 2 | `search.commandPalette`, `search.goToFile` |
| `role:` items | 9 | **Excluded** (BR-003) |
| Contributions | 9 + 3 + 8 + N | Generated (§8) |

### 4.2 Sections and ordering

Declaration order in `definitions.ts` drives both the Shortcuts editor grouping and conflict
precedence (BR-004), so it is significant. Order: `File`, `Edit`, `Search`, `View`, `Encoding`,
`Tools`, `Preferences`, `Plugins`, `Window`, `Help`.

All 49 existing ids from `SHORTCUT_CATALOG` **must be preserved verbatim** — they are the keys for
already-persisted `config.shortcuts` overrides. Renaming one silently drops a user's rebind.

### 4.3 `when` predicates

Shared helpers in `definitions.ts`:

```ts
const hasEditor    = (c: CommandContext) => c.editor !== null
const hasFileBuf   = () => { const s = useEditorStore.getState()
                             const b = s.buffers.find(x => x.id === s.activeId)
                             return !!b && b.kind === 'file' }
const isWritable   = () => { /* hasFileBuf() && !buffer.isReadOnly */ }
const hasSelection = (c: CommandContext) => !c.editor?.getSelection()?.isEmpty() === true
const hasWorkspace = () => !!useUIStore.getState().workspaceFolder
```

| Applies to | Predicate |
|------------|-----------|
| Line ops, case conversion, comments, folding, bookmarks, insert, beautify, transform, dedupe, trim | `isWritable` |
| Copy path / name / dir | `hasFileBuf` |
| Save, Save As, Reload, Close, Print, Export PDF | `hasFileBuf` |
| Encoding / EOL changes | `isWritable` |
| Find in Files, Go to File | `hasWorkspace` |
| Preview | `hasFileBuf` |
| Send Selection to Note (if Notes ships) | `hasSelection` |

### 4.4 Dead commands to fix (US-016, BR-010)

`indentSelection` / `outdentSelection` are dispatched from
[`menu.ts:243,248`](../../../src/main/menu.ts) and
[`MenuBar.tsx:200-201`](../../../src/renderer/src/components/editor/MenuBar.tsx) but **no handler
exists** — `EditorPane`'s switch has no matching `case` and no `default`. Add to `dispatchCommand`:

```ts
case 'indentSelection':
  editor.trigger('command', 'editor.action.indentLines', null); break
case 'outdentSelection':
  editor.trigger('command', 'editor.action.outdentLines', null); break
```

Their catalog bindings are `Tab` / `Shift+Tab`, which Monaco already handles natively for
selections. The dispatcher must therefore **not** capture bare `Tab` (§5.3) — the menu items become
functional without stealing the key.

Also reconcile `beginEndSelect` / `beginEndSelectColumn`: `disabled: true` in MenuBar, enabled in
the native menu, fully implemented at
[`EditorPane.tsx:292`](../../../src/renderer/src/components/EditorPane/EditorPane.tsx). Verify it
works, then drop the `disabled` flag (or disable it natively too).

---

## 5. Keybinding Dispatcher

### 5.1 Hook

`commands/useCommandKeys.ts`, called once from `App.tsx`:

```ts
export function useCommandKeys(): void {
  const overrides = useConfigStore((s) => s.shortcuts)

  const bindingMap = useMemo(() => {
    const m = new Map<string, string>()          // binding → command id
    for (const c of allCommands()) {
      const b = resolveBinding(c.id, overrides)  // reused from shortcutCatalog
      if (!b) continue
      if (!m.has(b)) m.set(b, c.id)              // first wins — BR-004
    }
    return m
  }, [overrides])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return              // §5.3
      const combo = captureBinding(e)            // reused
      if (!combo) return
      const id = bindingMap.get(combo)
      if (!id) return                            // leave unmatched keys alone
      e.preventDefault()
      e.stopPropagation()
      runCommand(id)
    }
    document.documentElement.addEventListener('keydown', onKeyDown, { capture: true })
    return () => document.documentElement.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [bindingMap])
}
```

Capture phase on `documentElement` is required for the documented reason: Monaco's internal
keybindings otherwise swallow the event ([`App.tsx:86-89`](../../../src/renderer/src/App.tsx)).

Because `bindingMap` is derived from `overrides`, rebinding takes effect on the next render — this
is the whole of US-005.

### 5.2 Handlers replaced

Delete both bespoke listeners and let the registry own them:

| Removed | Replaced by |
|---------|-------------|
| `App.tsx:90-101` Quick Open (`Mod+Shift+P`) | `search.goToFile` (now `Mod+E`) + `search.commandPalette` (`Mod+Shift+P`) |
| `App.tsx:132-145` AI Assistant (`Mod+Shift+A`) | `view.aiAssistant`, whose `run` keeps the existing "nudge to Settings when disabled" behaviour |

### 5.3 Typing guard — `isTypingTarget`

Non-negotiable, because catalog defaults include bare `Tab`, `Shift+Tab` and `F2`.

Return `true` (skip dispatch) when **any** holds:

1. `e.target` is `<input>`, `<textarea>`, or `[contenteditable]`
2. `e.target` is inside `.monaco-editor` **and** the combo has no `Mod`/`Alt` modifier
3. The combo is bare `Tab` or `Shift+Tab` — never dispatched from the keyboard at all; those
   commands are menu/palette-invocable only, and Monaco keeps native indent behaviour (§4.4)

Rule 2 keeps `F2` (Next Bookmark) working when the editor has focus while letting Monaco own plain
character keys. Rule 3 is the safety net for the two catalog entries whose "binding" is really a
description of Monaco's own behaviour.

> **Follow-up implied by rule 3:** `edit.indent` / `edit.outdent` display `Tab` / `Shift+Tab` in the
> Shortcuts editor but are not dispatcher-bound. Show them as non-rebindable there rather than
> offering a capture field that won't take effect.

### 5.4 Menu changes

In [`menu.ts`](../../../src/main/menu.ts), every item whose command is in the registry keeps its
`accelerator` and adds `registerAccelerator: false`:

```ts
{
  label: 'Duplicate Line',
  accelerator: 'CmdOrCtrl+D',
  registerAccelerator: false,          // renderer owns the key (BR-002)
  click: () => win.webContents.send('editor:command', 'duplicateLine')
}
```

- The accelerator **text still renders**; the OS no longer registers the key.
- `click` handlers stay as they are — menu clicks keep working through existing IPC.
- **Do not touch** the 15 `role:` entries at lines 36–42, 140, 148–154, 563–564, 576 (BR-003).
- Leave `F12` (DevTools, line 600) native — it is not a registry command.

**Verify on both platforms in Phase 3** (PRD Assumptions): the accelerator must still display while
the key stops firing. If a platform misbehaves, the fallback is to drop `accelerator` from those
items and render the binding into the label text instead.

---

## 6. `SHORTCUT_CATALOG` Derivation

[`shortcutCatalog.ts`](../../../src/renderer/src/utils/shortcutCatalog.ts) keeps every exported
helper unchanged. Only the array changes:

```ts
import { allCommands } from '../commands/registry'

export const SHORTCUT_CATALOG: ShortcutDef[] = allCommands()
  .filter((c) => c.defaultKey)
  .map((c) => ({ id: c.id, label: c.label, section: c.section, defaultKey: c.defaultKey! }))

export const SHORTCUT_SECTIONS: CommandSection[] =
  ['File', 'Edit', 'Search', 'View', 'Encoding', 'Tools', 'Preferences', 'Plugins', 'Window', 'Help']
```

`ShortcutSection` becomes an alias of `CommandSection`. Watch for an import cycle: `registry.ts`
must not import from `shortcutCatalog.ts` at module scope — the dispatcher imports `resolveBinding`
and `captureBinding` from it, so keep those in a leaf module (or have `registry.ts` import only
types).

### 6.1 Shortcuts editor updates

In [`ShortcutsSection.tsx`](../../../src/renderer/src/components/SettingsTab/ShortcutsSection.tsx):

1. **Delete the caveat** in the doc comment (lines 18–22) and the matching sentence in the UI copy —
   rebinding now works (US-005).
2. **Conflict warning** (US-006): compute `Map<binding, id[]>` over effective bindings; any binding
   with 2+ ids renders an inline warning on each affected row naming the other command, plus a note
   that the first in list order wins.
3. **Reject unbindable combos**: refuse `role:`-owned combos (`Mod+Z`, `Mod+C`, `Mod+V`, `Mod+X`,
   `Mod+A`, `Mod+Y`) and `F12`, with an explanation. Mark `edit.indent` / `edit.outdent`
   non-rebindable per §5.3.

---

## 7. Palette Component

`src/renderer/src/components/CommandPalette/CommandPalette.tsx`, replacing
`components/QuickOpen/QuickOpenPalette.tsx`.

### 7.1 Structure

Reuse `QuickOpenPalette`'s markup wholesale — it already has the right overlay geometry
(`fixed inset-0 z-[9000]`, `pt-[12vh]`, a `z-[9001]` 600px panel), the `Highlighted` sub-component
for `matchRanges`, backdrop-click close, and `data-testid` hooks. Keep the test ids that still
apply and add palette-specific ones.

### 7.2 Mode derivation

Mode is derived from the query, seeded by how the palette was opened:

```ts
const mode = query.startsWith(COMMAND_PREFIX) ? 'commands' : 'files'
const term = mode === 'commands' ? query.slice(1) : query
```

Opening via `setCommandPalette('commands')` initialises `query` to `'>'`; via `'files'` to `''`.
Deleting the `>` switches to file mode live; typing `>` at position 0 switches to command mode
(US-010). Selection resets to 0 on mode change; the overlay stays open.

Placeholder: `Type a command name…  (delete '>' to search files)` /
`Search files by name…  (type '>' for commands)`.

### 7.3 Command mode rows

```ts
const items = useMemo(() => availableCommands().map(toSearchItem), [paletteOpen])
const results = useMemo(() => {
  if (!term.trim()) {
    const mru = recentCommandIds()
      .map(id => items.find(i => i.cmd.id === id)).filter(Boolean)
    const rest = items.filter(i => !recentCommandIds().includes(i.cmd.id))
    return [...mru, ...rest].slice(0, MAX_RESULTS).map(/* → zero-score match */)
  }
  return fuzzyFilter(term, items, MAX_RESULTS)
}, [term, items])
```

`availableCommands()` is evaluated **when the palette opens**, not per keystroke — `when` predicates
read stores and the underlying state can't change while the modal overlay holds focus.

Row rendering: `Command` icon, `secondary` = section shown before the label as `Section: Label`,
`trailing` = `bindingDisplay(cmd.id, overrides)`.

### 7.4 File mode

Ported unchanged from `QuickOpenPalette` (BR-011): recursive listing via
`window.api.file.listFilesRecursive(workspaceFolder)` on open, the `truncated` footer, the
"Indexing files…" state, the "No folder is open" prompt, and `openFiles([path])` on Enter.

### 7.5 Keyboard

Same handler shape as `QuickOpenPalette.onKeyDown`: `ArrowDown`/`ArrowUp` wrap, `Enter` invokes,
`Escape` closes. Per BR-006 **close first, then invoke**:

```ts
const invokeAt = (idx: number): void => {
  const row = results[idx]
  if (!row) return
  setCommandPalette(null)        // close BEFORE running
  row.invoke()
}
```

This matters because many commands open overlays; `CLOSE_TOP_OVERLAYS` would otherwise have the
command's own overlay closed by the palette's teardown.

### 7.6 Mounting

`App.tsx` renders `<CommandPalette />` where `<QuickOpenPalette />` is today. It returns `null` when
`commandPaletteMode === null`.

---

## 8. Contributions

`commands/contributions.ts` exports `contributedCommands(): CommandDef[]`, called by
`allCommands()`. All entries are `defaultKey`-less (BR-009).

| Source | Generated | Id pattern | `run` |
|--------|-----------|-----------|-------|
| [`TOOLS`](../../../src/renderer/src/components/Tools/tools.tsx) (9) | `Tools: <label>` | `tools.open.<id>` | Existing tool-open path (`menu:tools-open` equivalent) |
| [`THEMES`](../../../src/renderer/src/utils/themes.ts) (3) | `Preferences: Color Theme → <name>` | `theme.set.<id>` | `configStore.setProp('theme', id)` + `applyTheme(id)` |
| Settings categories (8) | `Preferences: Open Settings → <label>` | `settings.open.<cat>` | `setPendingSettingsCategory(cat)` + `openVirtualTab('settings')` |
| `pluginStore.dynamicMenuItems` | `Plugin: <pluginName> → <label>` | `plugin.<name>.<label>` | `window.api.send('plugin:invoke-menu-click', pluginName, label)` |

Tool and theme labels/descriptions come from existing metadata — adding a tool or theme needs no
registry edit (US-014). Plugin entries are read from the store at call time, so they vanish when a
plugin is disabled. Ids must be slugified (lowercased, non-alphanumerics → `.`) so a plugin label
with spaces can't produce a colliding or malformed id.

---

## 9. Files Touched

### New

| File | Purpose |
|------|---------|
| `src/renderer/src/commands/types.ts` | `CommandSection`, `CommandContext`, `CommandDef` |
| `src/renderer/src/commands/registry.ts` | `COMMANDS`, lookup/invoke, context, MRU, dup detection |
| `src/renderer/src/commands/definitions.ts` | Static command definitions + `when` helpers |
| `src/renderer/src/commands/contributions.ts` | Tools / themes / settings / plugin entries |
| `src/renderer/src/commands/useCommandKeys.ts` | The single keybinding dispatcher |
| `src/renderer/src/commands/fileOpsRegistry.ts` | `useFileOps` bridge singleton |
| `src/renderer/src/components/CommandPalette/CommandPalette.tsx` | The palette overlay |

### Modified

| File | Change |
|------|--------|
| `src/main/menu.ts` | `registerAccelerator: false` on registry-owned items; new *Search ▸ Command Palette*; *Go to File* → `Mod+E` |
| `src/renderer/src/utils/shortcutCatalog.ts` | `SHORTCUT_CATALOG` derived; `SHORTCUT_SECTIONS` widened; helpers unchanged |
| `src/renderer/src/store/uiStore.ts` | `quickOpenVisible` → `commandPaletteMode`; update `CLOSE_TOP_OVERLAYS` |
| `src/renderer/src/App.tsx` | `useCommandKeys()`; `fileOpsRegistry.set()`; delete the two bespoke keydown handlers; swap the palette component |
| `src/renderer/src/components/EditorPane/EditorPane.tsx` | Add `indentSelection` / `outdentSelection` cases (§4.4) |
| `src/renderer/src/components/editor/MenuBar.tsx` | Route actions through `runCommand(id)` where a registry id exists; drop `disabled` on Begin/End Select once verified |
| `src/renderer/src/components/SettingsTab/ShortcutsSection.tsx` | Remove the caveat; add conflict warnings; reject unbindable combos |

### Deleted

| File | Reason |
|------|--------|
| `src/renderer/src/components/QuickOpen/QuickOpenPalette.tsx` | Absorbed into `CommandPalette` file mode |

`QuickPick.tsx` stays — it serves the status-bar selectors and is a different interaction.

---

## 10. Risks

| Risk | Mitigation |
|------|-----------|
| `registerAccelerator: false` behaves differently per platform | Verify on macOS + Windows early (Phase 3 exit criterion). Fallback: drop `accelerator` and render the key into the label. |
| A bare-key binding swallows typing | `isTypingTarget` (§5.3), with rule 3 hard-excluding `Tab`/`Shift+Tab`. Explicit test: type Tab, F2 and letters in the editor, in an input, and in a note textarea. |
| Renaming an id drops a user's saved override | All 49 existing ids preserved verbatim (§4.2). Grep `config.shortcuts` keys against registry ids as a Phase 2 check. |
| Import cycle `registry ↔ shortcutCatalog` | `registry.ts` imports types only; binding helpers stay leaf-level (§6). |
| Big-bang refactor regresses a menu item | Migrate by class (§4.1) with a per-class build+smoke, not all at once. Both menus keep working throughout. |
| Palette lists a command that errors | `runCommand` try/catches and toasts (§3.3). |

---

## 11. Non-Goals Restated (guardrails during implementation)

- Do **not** rewrite `EditorPane.dispatchCommand` — the registry is a new front door (BR-008).
- Do **not** remove the native menu or the custom MenuBar.
- Do **not** make `role:` commands rebindable.
- Do **not** add chord bindings — one combo per command.
- Do **not** persist MRU to `config.json`.
- Do **not** widen `fuzzyFilter`'s signature.
- Do **not** rename any existing command id.
