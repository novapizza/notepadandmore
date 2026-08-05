# Brainstorm Notes: Command Palette & Command Registry

## Core Idea

One searchable list of everything NovaPad can do, opened with a keystroke.

The palette is the visible half. The invisible half — and the larger piece of work — is a
**command registry**: a single place where a command's id, label, default key, availability
condition, and *handler* live together. Today those five things are scattered across four files
and no single one of them knows about all commands.

## Why now

Three problems share one root cause, and the registry fixes all three:

1. **~130 commands are reachable only by hunting through menus.** Native menu + custom MenuBar +
   9 tools + 3 themes + 8 settings categories + plugin contributions. No search, no discovery.
2. **The Keyboard Shortcuts editor is decorative.**
   [`ShortcutsSection.tsx:18-22`](../../../src/renderer/src/components/SettingsTab/ShortcutsSection.tsx)
   says so outright: rebinding writes `config.shortcuts` and the menu redraws the text, but nothing
   applies it at runtime. Users rebind, press the new key, and nothing happens while the old key
   still works. That is worse than not shipping the panel.
3. **Command handlers have no home.**
   [`SHORTCUT_CATALOG`](../../../src/renderer/src/utils/shortcutCatalog.ts) is 49 ids with labels
   and keys but **no handlers**. Dispatch lives in `menu.ts` accelerators, `MenuBar.tsx` closures,
   `EditorPane`'s `dispatchCommand` switch, and two bespoke `keydown` listeners in `App.tsx`.

A palette without a registry would be a fifth place that enumerates commands. The registry is the
feature; the palette is what it makes possible.

## Decisions

### 1. The registry is the single source of truth; `shortcutCatalog` becomes derived

New `src/renderer/src/commands/`. A `CommandDef` carries `id`, `label`, `section`, optional
`defaultKey`, optional `keywords`, optional `when`, and a `run` handler.

`SHORTCUT_CATALOG` is then **derived**: `COMMANDS.filter(c => c.defaultKey)`. The pure helpers in
`shortcutCatalog.ts` (`formatBinding`, `captureBinding`, `resolveBinding`, `bindingDisplay`) stay
exactly as they are — they're good and already used by `ShortcutsSection`. Only the array becomes
computed.

**Why:** avoids a parallel list, and `ShortcutsSection` keeps working with a near-zero diff.

### 2. Native accelerators must stop registering keys — `registerAccelerator: false`

This is the crux of making one dispatcher work.

If the renderer dispatches all bindings *and* `menu.ts` keeps its 47 native accelerators, every
key fires twice. For a toggle, twice means nothing happens.

Electron's `MenuItem` supports `registerAccelerator: false` — the accelerator is still **displayed**
in the menu but not registered with the OS. So: menu items keep showing `Ctrl+Shift+P`, the
renderer owns the key, and rebinding actually works without rebuilding the native menu.

**Exception — `role:` items keep native accelerators.** Undo, Redo, Cut, Copy, Paste, Select All,
Minimize, Zoom, Quit ([`menu.ts:148-154,563-564`](../../../src/main/menu.ts)) are OS-level roles.
They stay native, stay out of the registry, and are not rebindable. That matches every other editor.

> **Suspected latent bug this explains.** `Mod+Shift+A` (AI Assistant) is registered *both* as a
> native accelerator ([`menu.ts:531`](../../../src/main/menu.ts)) and as a capture-phase handler
> ([`App.tsx:135`](../../../src/renderer/src/App.tsx)), and both call `togglePanel()`. While Monaco
> has focus the accelerator is swallowed and only one fires — which is the documented reason the
> renderer handler exists. But with focus *outside* Monaco (Welcome screen, Settings tab) both
> should fire and the panel should double-toggle back shut. Worth reproducing; the registry design
> removes the whole class of bug. The same trap would apply to the planned Notes toggle.

### 3. `Mod+Shift+P` becomes the command palette; Quick Open moves to `Mod+E`

The conflict: `Mod+Shift+P` is currently **Go to File**
([`menu.ts:274`](../../../src/main/menu.ts)) — NovaPad put the file finder on the key every other
editor uses for commands, because `Mod+P` was deliberately kept for Preview
([`App.tsx:86-89`](../../../src/renderer/src/App.tsx)).

**Decision:** `Mod+Shift+P` opens the palette in **command** mode. Quick Open (file mode) gets
`Mod+E` (free, and VS Code's own alias for Quick Open). `Mod+P` keeps Preview, untouched.

**Why:** `Ctrl+Shift+P` → commands is close to universal muscle memory. Today it does something
else, which is a small ongoing tax on every developer who tries it.

**This is a behaviour change for existing users** and must ship as a `Changed` entry in the
changelog and What's New, not buried under `Added`. The old *Search ▸ Go to File* menu item stays,
retargeted to file mode, so nothing becomes unreachable.

**Alternative considered and rejected:** keep files on `Mod+Shift+P` and give the palette a
different key (`Mod+Shift+G`, say). Cheaper and breaks nothing, but permanently cements the
non-standard mapping and makes the palette the hard-to-find thing. Rejected on the grounds that
the palette is the more frequently used surface once it exists.

### 4. One palette component, two modes, one prefix

Modes follow VS Code:

| Input | Mode |
|-------|------|
| `>foo` | Commands (default when opened via `Mod+Shift+P`) |
| `foo` (no prefix) | Files (default when opened via `Mod+E`) |

Deleting the leading `>` drops to file mode; typing `>` enters command mode. One component, one
overlay, one result list — not two palettes that look alike.

**Why:** users don't have to remember which key they pressed, and it collapses the existing
`QuickOpenPalette` into the new component rather than leaving two near-identical overlays.

### 5. Reuse `fuzzyFilter` as-is by adapting commands to its shape

[`fuzzyFilter`](../../../src/renderer/src/utils/fuzzyFilter.ts) is generic over
`T extends { name: string; path: string }` and already scores consecutive / start-of-string /
post-separator / camelCase hits, and returns `matchRanges` for bold highlighting.

Rather than widen its signature (used by Quick Open today — a regression risk for no gain),
commands adapt: `name = label`, `path = \`${section} ${label} ${keywords ?? ''}\``. Name matches
already rank +100 above path matches, so a label hit beats a section/keyword hit for free.

**Why:** zero risk to the existing file search, and the section/keyword text becomes searchable
("enc" finds *Encode in UTF-8*) with no new scoring code.

### 6. Availability: `when` predicates hide, they don't grey out

Commands declare `when?: (ctx) => boolean`. Failing commands are **omitted** from the palette
rather than shown disabled.

**Why:** a palette's value is a short, relevant list. VS Code hides too. Menus keep showing greyed
items because their position is spatial memory — the palette has none.

### 7. `run` handlers take an injected context; `fileOps` gets an `editorRegistry`-style bridge

Most handlers need nothing injected — Zustand stores are reachable via `useX.getState()`, and the
Monaco instance via [`editorRegistry`](../../../src/renderer/src/utils/editorRegistry.ts).

The one real closure dependency is `useFileOps()`, a hook whose handles only exist inside the
`App.tsx` render. Solution: a `fileOpsRegistry` module singleton, exactly mirroring the existing
`editorRegistry` pattern — `App.tsx` sets it on mount, the registry reads it.

**Why:** it's a pattern already in the codebase for exactly this problem, rather than threading
React context into a non-React module.

### 8. ~35 editor commands migrate mechanically

Everything currently dispatched as `editor:command` with a verb becomes:

```ts
run: () => window.dispatchEvent(new CustomEvent('editor:command', { detail: 'duplicateLine' }))
```

`EditorPane`'s `dispatchCommand` switch stays exactly as it is. The registry becomes a *new front
door* to the existing dispatch, not a rewrite of it.

**Why:** keeps a large, risky-looking migration boring. No editor behaviour changes.

### 9. Dynamic contributions are computed, not hand-listed

Three sources already carry the metadata a palette entry needs:

- [`TOOLS`](../../../src/renderer/src/components/Tools/tools.tsx) — 9 tools with `id`, `label`,
  `group`, `description`
- [`THEMES`](../../../src/renderer/src/utils/themes.ts) — 3 themes with `id`, `name`, `sub`
- `pluginStore.dynamicMenuItems` — `{ pluginName, label }` pairs

These generate palette entries at render time (`Tools: Color Converter`,
`Preferences: Color Theme → Solarized Light`, `Plugin: <name> → <label>`). Adding a tool or theme
must not require touching the registry.

### 10. MRU is in-memory for v1

When the query is empty, show the 5 most recently run commands first. Session-only — not persisted
to `config.json`.

**Why:** persisting means a config write on every command invocation. The benefit is small; revisit
if users ask.

## Bugs found while scoping (the palette would expose all of these)

1. **`indentSelection` / `outdentSelection` are dead.** Dispatched from
   [`menu.ts:243,248`](../../../src/main/menu.ts) and
   [`MenuBar.tsx:200-201`](../../../src/renderer/src/components/editor/MenuBar.tsx), but there is
   **no handler anywhere** — `EditorPane`'s switch has no case and there's no `default`. Two dead
   menu items, plus two catalog entries (`edit.indent`, `edit.outdent`) promising bindings that do
   nothing. Fix by wiring them to Monaco's built-in `editor.action.indentLines` /
   `outdentLines`. A palette makes dead commands glaringly visible, so this must be fixed, not
   inherited.
2. **`beginEndSelect` / `beginEndSelectColumn` are `disabled: true` in the custom MenuBar**
   ([`MenuBar.tsx:155-156`](../../../src/renderer/src/components/editor/MenuBar.tsx)) but enabled in
   the native menu and fully implemented in
   [`EditorPane.tsx:292`](../../../src/renderer/src/components/EditorPane/EditorPane.tsx). One of
   the two is wrong. Verify and reconcile.
3. **The AI-toggle double-fire described in §2.**

## Scope

### In Scope

- `commands/` module: types, registry, definitions, dynamic contributions
- `SHORTCUT_CATALOG` derived from the registry; `ShortcutsSection` unchanged in behaviour but now
  **functional**
- One capture-phase keybinding dispatcher honouring `config.shortcuts` overrides
- `registerAccelerator: false` across registry-owned menu items
- `CommandPalette` component with command + file modes, absorbing `QuickOpenPalette`
- `Mod+Shift+P` → commands, `Mod+E` → files
- Dynamic entries for tools, themes, settings categories, plugin menu items
- Conflict detection in the Shortcuts editor (two commands, one binding)
- Fixing the two dead indent commands

### Out of Scope

- `@symbol` and `:line` palette modes (v2 — `FunctionListPanel` already computes symbols, so this
  is a natural follow-up)
- Persisted MRU / usage ranking
- Chord bindings (`Ctrl+K Ctrl+S`) — the binding format is single-combo today
- Rebindable `role:` commands (Undo/Copy/Paste stay OS-native)
- Per-keybinding `when` scoping (a binding is global; only *palette visibility* is conditional)
- Plugin-registered commands with their own default keys (plugins contribute palette entries only)
- Removing the native menu or the custom MenuBar — both stay, both now read from the registry
  where practical
- Migrating **all** ~130 commands in one pass. Phase 2 covers the 49 catalogued + the ~35 editor
  verbs; the long tail lands in Phase 5 as palette-only entries with no default key.

## Architecture Sketch

```
                    ┌──────────────────────────────┐
                    │  commands/commands.ts        │
                    │  CommandDef[]                │
                    │  id · label · section        │
                    │  defaultKey? · when? · run   │
                    └──────────────┬───────────────┘
                                   │
     ┌────────────────┬────────────┴──────┬──────────────────┐
     ▼                ▼                   ▼                  ▼
┌──────────┐  ┌───────────────┐  ┌────────────────┐  ┌──────────────┐
│ Palette  │  │ useCommandKeys│  │ SHORTCUT_      │  │ MenuBar /    │
│ (search) │  │ (one keydown, │  │ CATALOG        │  │ menu.ts      │
│          │  │  capture)     │  │ (derived)      │  │ (display key │
│          │  │               │  │      │         │  │  only)       │
└──────────┘  └───────┬───────┘  └──────┼─────────┘  └──────────────┘
                      │                 ▼
                      │          ShortcutsSection
                      │          (now actually works)
                      ▼
              config.shortcuts overrides
```

**Dispatch, before and after:**

```
BEFORE
  native accel ──► IPC ──► App.tsx listener ──┐
  MenuBar click ──► closure ─────────────────┤──► action
  keydown (2 bespoke handlers) ──────────────┘
  ...and config.shortcuts overrides reach none of them

AFTER
  native menu item (display-only accelerator) ──► IPC ──┐
  MenuBar click ──────────────────────────────────────┤──► registry.run(id)
  palette Enter ──────────────────────────────────────┤
  keydown ──► resolveBinding(id, overrides) ──────────┘
```

## Open Questions

- Should the palette show a command's binding on the right-hand side? **Yes** — it's the primary
  way users discover shortcuts, and `bindingDisplay(id, overrides)` already returns the formatted
  string.
- Show unavailable commands greyed instead of hidden? **No** (§6), but revisit if users report
  "the command vanished".
- Should `Mod+Shift+P` with a non-empty selection prefill anything? **No.** Surprising, and the
  palette is not a search box.
- Does the native menu still need accelerators at all once the renderer owns keys?
  **Yes, for display** — users read shortcuts off menus. That's precisely what
  `registerAccelerator: false` preserves.
