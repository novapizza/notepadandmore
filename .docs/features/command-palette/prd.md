# Command Palette & Command Registry - Overview

## 1. Description

NovaPad has roughly 130 commands — native menu entries, custom MenuBar entries, 9 tools, 3 themes,
8 settings categories, and plugin contributions — and every one of them is reachable only by
hunting through menus. There is no search and no discovery surface.

Underneath that, command *definitions* are scattered: `SHORTCUT_CATALOG` holds 49 ids, labels and
default keys but no handlers; handlers live in `menu.ts` accelerators, `MenuBar.tsx` closures,
`EditorPane`'s `dispatchCommand` switch, and two bespoke `keydown` listeners in `App.tsx`. Nothing
knows about all commands at once. The visible consequence is that **the Keyboard Shortcuts editor
does not work** — rebinding is saved and displayed but never applied at runtime, so users rebind a
key, press it, and nothing happens while the old key still works.

This feature introduces a **command registry** — one module where a command's id, label, section,
default binding, availability predicate and handler live together — and a **command palette**
(`Ctrl/Cmd+Shift+P`) that searches it. Deriving `SHORTCUT_CATALOG` from the registry and routing
every binding through one dispatcher makes the Shortcuts editor functional as a direct consequence.

> See [Brainstorm Notes](./raw/notes.md) for decision rationale, the `Mod+Shift+P` conflict
> resolution, the `registerAccelerator: false` mechanism, and three bugs found while scoping.

---

## 2. Features

| ID | Feature | Priority | Stories | Description |
|----|---------|----------|---------|-------------|
| F1 | Command registry | Must Have | US-001 | `commands/` module defining `CommandDef` (`id`, `label`, `section`, `defaultKey?`, `keywords?`, `when?`, `run`) plus lookup and invoke helpers. |
| F2 | `SHORTCUT_CATALOG` derived | Must Have | US-002 | The catalog becomes `COMMANDS.filter(c => c.defaultKey)`. Pure helpers in `shortcutCatalog.ts` are unchanged. |
| F3 | Single keybinding dispatcher | Must Have | US-003, US-004 | One capture-phase handler resolving `captureBinding(e)` against every command's effective binding, honouring `config.shortcuts`. |
| F4 | Display-only native accelerators | Must Have | US-004 | Registry-owned `menu.ts` items gain `registerAccelerator: false` — the key still shows in the menu but the renderer owns dispatch. `role:` items keep native accelerators. |
| F5 | Working Shortcuts editor | Must Have | US-005, US-006 | Rebinding in Settings takes effect immediately, with conflict detection. Removes the "not wired yet" caveat. |
| F6 | Command palette UI | Must Have | US-007, US-008, US-009 | Fuzzy-searchable overlay listing available commands with their section and binding. |
| F7 | Two modes, one palette | Must Have | US-010 | `>` = commands, no prefix = files. Absorbs `QuickOpenPalette`. |
| F8 | `Mod+Shift+P` → commands, `Mod+E` → files | Must Have | US-011 | Behaviour change: `Mod+Shift+P` currently opens Go to File. `Mod+P` keeps Preview. |
| F9 | `when` availability | Must Have | US-012 | Commands needing an editor, a selection, or a workspace are omitted from the palette when unavailable. |
| F10 | Editor-command migration | Must Have | US-013 | ~35 `editor:command` verbs become registry entries dispatching the same CustomEvent. No editor behaviour change. |
| F11 | Dynamic contributions | Should Have | US-014 | Tools, themes, settings categories and plugin menu items generate entries from their existing metadata. |
| F12 | MRU ordering | Should Have | US-015 | With an empty query, the 5 most recently run commands sort first. Session-only. |
| F13 | Fix dead indent commands | Must Have | US-016 | `indentSelection` / `outdentSelection` are dispatched but unhandled. Wire them to Monaco's built-in actions. |

---

## 3. User Stories

### Actors

| Actor | Description |
|-------|-------------|
| User | Anyone using NovaPad to edit files, on any platform (macOS, Windows, Linux) |
| Plugin Author | Someone shipping a NovaPad plugin that contributes menu items |

### Stories

#### US-001: Commands are defined in one place
> **As a** maintainer, **I want** every command's id, label, key and handler declared together, **so that** adding a command means editing one file instead of four.

**Acceptance Criteria:**
- [ ] `CommandDef` carries `id`, `label`, `section`, optional `defaultKey`, `keywords`, `when`, and a required `run`
- [ ] `getCommand(id)` and `runCommand(id)` are exported and used by every dispatch path
- [ ] `run` receives a context object; no handler reaches into React state directly
- [ ] Adding a command requires no change to the palette, the dispatcher, or the Shortcuts editor
- [ ] Duplicate ids fail loudly in development rather than silently shadowing

#### US-002: The shortcut catalog stops being a second list
> **As a** maintainer, **I want** `SHORTCUT_CATALOG` derived from the registry, **so that** the two can't drift.

**Acceptance Criteria:**
- [ ] `SHORTCUT_CATALOG` is computed as `COMMANDS.filter(c => c.defaultKey)`, preserving declaration order
- [ ] `formatBinding`, `captureBinding`, `resolveBinding`, `bindingDisplay`, `getShortcutDef` keep their current signatures and behaviour
- [ ] `SHORTCUT_SECTIONS` covers every section present in the registry
- [ ] Settings ▸ Keyboard Shortcuts renders the same 49 commands as before, grouped identically, plus any new sections

#### US-003: One keystroke path, no double-firing
> **As a** User, **I want** each shortcut to fire its command exactly once, **so that** toggles don't cancel themselves.

**Acceptance Criteria:**
- [ ] A single capture-phase `keydown` listener on `document.documentElement` resolves and dispatches all registry bindings
- [ ] The two bespoke handlers (Quick Open, AI Assistant) are removed in favour of it
- [ ] A toggle command bound to a key toggles once per press, with focus inside **and** outside Monaco
- [ ] Bindings fire on the Welcome screen and on virtual tabs (Settings, What's New, Plugin Manager)
- [ ] A press matching no binding is left entirely alone (no `preventDefault`)
- [ ] Typing in an input, textarea, or the Monaco editor is never swallowed by a plain-character binding

#### US-004: Menus still show shortcuts, but don't own them
> **As a** User, **I want** the menu to keep displaying each command's key, **so that** I can still discover shortcuts by browsing.

**Acceptance Criteria:**
- [ ] Registry-owned `menu.ts` items keep their `accelerator` **and** gain `registerAccelerator: false`
- [ ] The accelerator text still renders in the native menu on macOS and Windows
- [ ] Pressing such a key fires the command exactly once (via the renderer)
- [ ] `role:` items (Undo, Redo, Cut, Copy, Paste, Select All, Minimize, Zoom, Quit) keep native accelerators and are excluded from the registry
- [ ] Clicking the menu item still works and routes through `runCommand(id)`

#### US-005: Rebinding a shortcut actually works
> **As a** User, **I want** a shortcut I rebind in Settings to take effect, **so that** the Shortcuts editor isn't lying to me.

**Acceptance Criteria:**
- [ ] Rebinding a command in Settings ▸ Keyboard Shortcuts makes the new combo invoke it immediately — no restart
- [ ] The old default combo stops invoking it
- [ ] Resetting one binding, or Reset All, restores default behaviour immediately
- [ ] The menu's displayed accelerator reflects the override
- [ ] The "re-binding … is not wired yet" caveat is removed from the UI text and the source comment
- [ ] Overrides survive a restart

#### US-006: Conflicting bindings are surfaced
> **As a** User, **I want** to be told when two commands share a key, **so that** I'm not left guessing which one wins.

**Acceptance Criteria:**
- [ ] Assigning a combo already held by another command shows an inline warning naming that command
- [ ] The conflict is visible on both rows
- [ ] The assignment is still permitted (the user may be mid-swap), but resolution is deterministic and documented: first match in registry declaration order wins
- [ ] Reserved combos that cannot be captured (OS-level `role:` accelerators, `F12`) are rejected with an explanation rather than silently accepted

#### US-007: User opens the palette and finds a command by name
> **As a** User, **I want** to press one key and type what I want, **so that** I don't have to know which menu holds it.

**Acceptance Criteria:**
- [ ] `Ctrl/Cmd+Shift+P` opens the palette in command mode from anywhere in the app
- [ ] The input is focused immediately; the full available command list shows before typing
- [ ] Typing fuzzy-filters on label, section and keywords
- [ ] Matched characters are highlighted in the label
- [ ] Up/Down move the selection, Enter runs it, Escape closes without running
- [ ] Clicking a row runs it; hovering moves the selection
- [ ] The palette closes before the command runs, so commands that open overlays aren't fighting it

#### US-008: The palette shows where a command lives and how to bind it
> **As a** User, **I want** each row to show its section and shortcut, **so that** the palette teaches me the app.

**Acceptance Criteria:**
- [ ] Each row shows `Section: Label` (e.g. `Edit: Duplicate Line`)
- [ ] A command with an effective binding shows it right-aligned, formatted per platform (`⇧⌘P` / `Ctrl+Shift+P`)
- [ ] The displayed binding reflects any user override
- [ ] Commands with no binding show nothing in that column
- [ ] Rows are keyboard-reachable without a mouse

#### US-009: The palette handles no-results and long lists
> **As a** User, **I want** the palette to stay fast and legible, **so that** it's usable with 130+ commands.

**Acceptance Criteria:**
- [ ] Results are capped (50) with the cap applied *after* ranking
- [ ] A query matching nothing shows "No matching commands"
- [ ] The list scrolls internally; the selected row is scrolled into view
- [ ] Filtering 130 commands introduces no perceptible lag

#### US-010: One palette, two modes
> **As a** User, **I want** files and commands in the same overlay, **so that** I don't have to remember which key I pressed.

**Acceptance Criteria:**
- [ ] A leading `>` puts the palette in command mode; removing it returns to file mode
- [ ] File mode preserves today's Quick Open behaviour exactly: workspace-scoped recursive listing, fuzzy match, the "no folder open" prompt, the "Indexing files…" state, and the truncation footer
- [ ] Switching modes resets the selection but keeps the overlay open
- [ ] The placeholder text states the active mode and how to switch
- [ ] `QuickOpenPalette` is removed, not left orphaned

#### US-011: The palette owns `Mod+Shift+P`; Quick Open moves to `Mod+E`
> **As a** User coming from another editor, **I want** `Ctrl+Shift+P` to open commands, **so that** my muscle memory works.

**Acceptance Criteria:**
- [ ] `Mod+Shift+P` opens command mode
- [ ] `Mod+E` opens file mode
- [ ] `Mod+P` still toggles Preview, unchanged
- [ ] *Search ▸ Go to File* remains, retargeted to file mode, showing `Mod+E`
- [ ] A new *Search ▸ Command Palette* entry shows `Mod+Shift+P`
- [ ] Both commands appear in Settings ▸ Keyboard Shortcuts and are rebindable
- [ ] The change is documented as **Changed** (not Added) in `CHANGELOG.md` and What's New

#### US-012: Unavailable commands don't clutter the list
> **As a** User, **I want** the palette to show only what I can actually run, **so that** the list stays short and honest.

**Acceptance Criteria:**
- [ ] Commands whose `when` predicate is false are omitted from palette results
- [ ] Commands needing an editor are absent on the Welcome screen
- [ ] Commands needing a selection are absent with an empty selection
- [ ] Commands needing a workspace folder are absent when none is open
- [ ] Buffer-mutating commands are absent for a read-only (deeplink) buffer
- [ ] `when` gates palette visibility only — it does not disable a bound keystroke (documented limitation)
- [ ] A command whose `when` throws is treated as unavailable, not allowed to break the palette

#### US-013: Editor commands migrate without behaviour change
> **As a** User, **I want** line operations, case conversion, folding and the rest to work exactly as before, **so that** the refactor is invisible.

**Acceptance Criteria:**
- [ ] All ~35 `editor:command` verbs are registry entries dispatching the same `CustomEvent`
- [ ] `EditorPane`'s `dispatchCommand` switch is unchanged
- [ ] Every verb reachable from the native menu, MenuBar, editor context menu and Toolbar still works
- [ ] Each is runnable from the palette
- [ ] No verb is dispatched that has no handler (see US-016)

#### US-014: Tools, themes and plugins appear without being hand-listed
> **As a** Plugin Author, **I want** my menu item to appear in the palette automatically, **so that** users can find it.

**Acceptance Criteria:**
- [ ] All 9 entries in `TOOLS` generate `Tools: <label>` commands from existing metadata
- [ ] All themes in `THEMES` generate `Preferences: Color Theme → <name>` commands
- [ ] The 8 settings categories generate `Preferences: Open Settings → <category>` commands
- [ ] `pluginStore.dynamicMenuItems` generate `Plugin: <pluginName> → <label>` commands
- [ ] Adding a tool or theme requires no registry edit
- [ ] Plugin entries disappear when a plugin is disabled or uninstalled
- [ ] Dynamic entries have no `defaultKey` and never appear in the Shortcuts editor

#### US-015: Recently used commands come back first
> **As a** User, **I want** commands I just used near the top, **so that** repeating an action is fast.

**Acceptance Criteria:**
- [ ] With an empty query, the 5 most recently run commands appear first, newest first
- [ ] MRU affects the empty-query order only; a typed query is ranked purely by fuzzy score
- [ ] MRU is session-only and not written to `config.json`
- [ ] A command no longer available (or removed) is skipped rather than shown

#### US-016: Dead commands are fixed, not exposed
> **As a** User, **I want** every command in the palette to actually do something, **so that** the palette is trustworthy.

**Acceptance Criteria:**
- [ ] `indentSelection` and `outdentSelection` are handled — wired to Monaco's `editor.action.indentLines` / `outdentLines`
- [ ] Both work from the native menu, the MenuBar, and the palette
- [ ] Their catalog entries (`edit.indent` `Tab`, `edit.outdent` `Shift+Tab`) behave as advertised, and plain typing of Tab in the editor is unaffected
- [ ] The `beginEndSelect` / `beginEndSelectColumn` discrepancy (disabled in MenuBar, enabled natively, implemented in `EditorPane`) is reconciled in one direction
- [ ] An audit confirms every registry `run` reaches a real handler

---

## 4. Business Rules

| ID | Rule | Description |
|----|------|-------------|
| BR-001 | One definition per command | A command's id, label, section, default key, availability and handler are declared once, in the registry. No second enumeration may exist. |
| BR-002 | The renderer owns keybindings | Registry-owned menu items use `registerAccelerator: false`. Exactly one code path may respond to a given keypress. |
| BR-003 | `role:` items stay native | Undo, Redo, Cut, Copy, Paste, Select All, Minimize, Zoom and Quit are OS roles — not registry commands, not rebindable. |
| BR-004 | Deterministic conflict resolution | If two commands resolve to the same binding, the first in registry declaration order wins. The Shortcuts editor must warn, but behaviour is never ambiguous. |
| BR-005 | `when` gates visibility, not keys | A false `when` hides a command from the palette. It does not block a bound keystroke; handlers stay individually defensive. |
| BR-006 | Palette closes before running | The overlay dismisses first, then the command runs, so commands that open dialogs or overlays don't race the palette's own teardown. |
| BR-007 | Overlay exclusivity | The palette participates in `CLOSE_TOP_OVERLAYS` like Find & Replace, About, Quick Open and Tools — opening it closes the others, and vice versa. |
| BR-008 | No behaviour change to editor dispatch | Migration re-fronts `editor:command`; it does not rewrite `EditorPane`'s switch. |
| BR-009 | Dynamic entries are unbindable | Contributions from tools, themes, settings and plugins carry no `defaultKey` and are excluded from the Shortcuts editor. |
| BR-010 | No dead commands | A registry entry whose handler does not exist is a defect. Dead verbs are fixed or removed, never listed. |
| BR-011 | File mode is behaviour-preserving | The palette's file mode must match today's Quick Open exactly, including its empty, loading and truncated states. |

---

## 5. Dependencies

### Upstream (Required by this feature)

| Dependency | Purpose |
|------------|---------|
| [`shortcutCatalog.ts`](../../../src/renderer/src/utils/shortcutCatalog.ts) | `captureBinding`, `resolveBinding`, `formatBinding`, `bindingDisplay` — reused unchanged |
| [`fuzzyFilter.ts`](../../../src/renderer/src/utils/fuzzyFilter.ts) | Ranking + `matchRanges` for both modes |
| [`QuickOpenPalette.tsx`](../../../src/renderer/src/components/QuickOpen/QuickOpenPalette.tsx) | Overlay markup, file-mode logic and states to absorb |
| [`QuickPick.tsx`](../../../src/renderer/src/components/QuickPick/QuickPick.tsx) | Prior art for overlay/keyboard-nav conventions |
| [`editorRegistry.ts`](../../../src/renderer/src/utils/editorRegistry.ts) | Monaco access from non-React modules; pattern for the new `fileOpsRegistry` |
| [`useFileOps.ts`](../../../src/renderer/src/hooks/useFileOps.ts) | File command handlers, bridged via `fileOpsRegistry` |
| `uiStore` `CLOSE_TOP_OVERLAYS` | Overlay exclusivity |
| `configStore.shortcuts` | Binding overrides |
| Electron `MenuItem.registerAccelerator` | Display-without-registering accelerators |
| `TOOLS`, `THEMES`, `pluginStore.dynamicMenuItems` | Dynamic contributions |
| `EditorPane.dispatchCommand` | Existing target for ~35 migrated verbs |

### Downstream (Features that depend on this)

| Feature | Impact |
|---------|--------|
| Sticky Notes | `view.notes` becomes a registry command; its toggle avoids the double-fire trap by construction |
| Macro record & playback | Recording a command stream requires a command registry — this is the prerequisite |
| `@symbol` / `:line` palette modes | Extra modes plug into the same component |
| Plugin API v2 | Plugins registering real commands (with `when` and bindings) rather than menu items only |

---

## 6. Out of Scope

- `@symbol` and `:line` palette modes (v2)
- Persisted MRU or frequency ranking
- Chord bindings (`Ctrl+K Ctrl+S`) — the binding format is single-combo
- Rebindable OS `role:` commands
- Per-binding `when` scoping (visibility only — BR-005)
- Plugin-declared default keybindings
- Removing the native menu or custom MenuBar
- Migrating all ~130 commands in one pass — the long tail lands as palette-only entries
- Localising command labels
- A palette-driven settings search

---

## 7. Assumptions

- `registerAccelerator: false` behaves as documented on all three platforms: the accelerator text
  still renders, the key is not registered. **Verify on macOS and Windows in Phase 3** — the whole
  dispatch design rests on it.
- `captureBinding` produces a canonical string for every combo used as a default; combos it can't
  represent are out of scope as bindings.
- Adapting commands to `fuzzyFilter`'s `{ name, path }` shape gives good enough ranking without
  changing the scorer.
- Zustand `getState()` plus `editorRegistry` and the new `fileOpsRegistry` cover every handler's
  needs — no React context in the registry.
- Fuzzy-filtering ~150 items per keystroke is cheap enough to need no memo beyond `useMemo`.
- The three themes and 9 tools shipping today are representative; contribution generation is driven
  by their existing metadata shape.

---

## 8. Glossary

| Term | Definition |
|------|------------|
| Command | A named, invocable action with a stable id, defined once in the registry |
| Command registry | The module holding all `CommandDef`s plus lookup/invoke helpers |
| Command palette | The fuzzy-search overlay listing available commands |
| Binding | A canonical single-combo key string (`Mod+Shift+P`), where `Mod` is Ctrl on Windows/Linux and Cmd on macOS |
| Effective binding | A command's user override if present, else its `defaultKey` |
| `when` predicate | A function deciding whether a command is currently available (palette visibility only) |
| Contribution | A palette entry generated at runtime from tool/theme/settings/plugin metadata rather than hand-declared |
| Display-only accelerator | A menu accelerator shown to the user but not registered with the OS (`registerAccelerator: false`) |
| Mode | Which list the palette searches — commands (`>` prefix) or files (no prefix) |
| MRU | Most-recently-used ordering applied to the empty-query command list |
