# Implementation Notes: Command Palette & Command Registry

**Feature:** command-palette
**Date:** 2026-08-05
**Covers:** Phases 0–7 of [`plan.md`](../plan.md)

---

## What shipped

All seven phases, in one pass. The phase boundaries were kept as commit-sized units of work but
verified together, since `npm run build` (electron-vite) does no typechecking and the meaningful
verification signal is the E2E suite, which only exists at the end.

| Phase | Status | Notes |
|-------|--------|-------|
| 0 Dead commands | Done | Plus a third dead command the docs didn't know about — see below |
| 1 Registry foundation | Done | `commands/{types,fileOpsRegistry,registry}.ts` |
| 2 Populate registry | Done | 46 legacy ids preserved verbatim (not 49 — see below) |
| 3 Dispatcher + accelerators | Done | `displayKey()` helper in `menu.ts`; one bug found in the typing guard |
| 4 Palette UI | Done | `QuickOpenPalette` deleted; E2E spec rewritten |
| 5 Contributions | Done | 9 tools + 3 themes + 8 settings categories + N plugin items |
| 6 Shortcuts editor | Done | Caveat removed, conflicts warn, reserved combos refused |
| 7 Release artifacts | Done | `RELEASE_NOTES[0]` (1.6.0) + `CHANGELOG.md` `## [Unreleased]` |

---

## Deviations from the spec

### The catalog had 46 ids, not 49

Every document says "49 catalogued commands". The actual `SHORTCUT_CATALOG` held **46** entries
(File 8, Edit 21, Search 7, View 8, Window 2). All 46 are preserved verbatim, verified mechanically
against a hard-coded list of the originals. The count in the PRD/spec/plan was simply wrong.

### `role:` commands stay in the registry, contrary to a literal reading of BR-003

BR-003 says OS-role commands (Undo/Redo/Cut/Copy/Paste/Select All) are "not registry commands", but
the Phase 2 invariant says all catalogued ids must survive — and six of them *are* role commands
with persisted-override keys. Dropping them would have silently deleted those rows from the
Shortcuts editor (breaking US-002's "renders the same commands as before").

Resolution: a `nativeKey?: boolean` flag on `CommandDef`. Such a command keeps its id and
`defaultKey` so it still appears in the Shortcuts editor — shown read-only, with a lock icon — but
the dispatcher skips it and the OS role keeps the keystroke. `paletteHidden?: boolean` additionally
keeps the six roles out of the palette. This satisfies both rules rather than picking one.

`edit.indent` / `edit.outdent` use `nativeKey` without `paletteHidden`: Monaco owns Tab/Shift+Tab,
but the commands themselves are the point of Phase 0, so they must stay palette-invocable.

### `SHORTCUT_CATALOG` derives from `COMMANDS`, not `allCommands()`

Spec §6 derives it from `allCommands()`. Deriving from the static `COMMANDS` instead enforces BR-009
structurally — contributions cannot leak into the Shortcuts editor even by accident — and keeps
`contributions.ts` (which imports `tools.tsx`, and through it every tool panel) out of
`shortcutCatalog.ts`'s import graph, removing the cycle risk §10 flags.

### `search.mark` ships unbound

The native *Search ▸ Mark…* item has `Ctrl+M` on Windows only, because ⌘M is the OS minimize
shortcut on macOS. Rather than encode a platform-conditional default binding, `search.mark` is
palette-only and the native `Ctrl+M` accelerator is left registered — it isn't a registry-owned key.

### `file.close` uses `hasBuffer`, not `hasFileBuf`

Spec §4.3 lists Close under `hasFileBuf`, but closing a Settings or What's New tab is a real action.
Gating on "any active buffer" keeps the command available where it does something.

### The hidden Windows `Ctrl+,` menu item was deleted

`menu.ts` carried an invisible *Open Settings* item that existed only to register `Ctrl+,` on
Windows. `prefs.settings` owns that binding in the renderer now, so a display-only duplicate would
do nothing at all.

---

## Bugs found and fixed beyond US-016

1. **`indentSelection` / `outdentSelection` had no handler** (the documented one). Wired to Monaco's
   `editor.action.indentLines` / `outdentLines`.
2. **`editor:undo` / `editor:redo` had no listener at all.** The Windows MenuBar's *Undo*/*Redo*
   entries and the Toolbar's undo/redo buttons dispatched a `CustomEvent` nothing was subscribed to,
   so all four controls were dead. (macOS was unaffected — its native menu uses OS roles.) Added
   `undo`/`redo` cases to `EditorPane.dispatchCommand` and pointed the four call sites at them.
   Not mentioned anywhere in the PRD, spec or notes.
3. **`beginEndSelect` was disabled in *both* menus**, not just the MenuBar. The notes state the
   native menu had it enabled; in fact `menu.ts` carried `enabled: false` too. Since the
   `EditorPane` implementation is complete, both were enabled — the reconciliation direction the
   plan asked for.

---

## The one real bug this work introduced (caught by E2E)

The first cut of `isTypingTarget` followed Spec §5.3's rule order literally: `<input>`/`<textarea>`
first, Monaco second. **Monaco's own text input is a `<textarea>`**, so rule 1 short-circuited and
*no* shortcut fired while the editor had focus — `Mod+S`, `Alt+Up`, `Mod+Shift+N`, all dead. The
sticky-notes suite caught it (13 failures).

The guard is now written in terms of the *combo* rather than the element: inside any editable target
we claim only what a person cannot be typing — anything carrying Ctrl/Cmd/Alt, plus function keys.
Everything else (letters, digits, Tab, Enter, Escape, Backspace) belongs to the field. That protects
typing everywhere while keeping `F2` and `Alt+Up` working exactly where they are used.

---

## Verification

- `npm run build` clean (only the known `"use client"` node_modules warnings).
- `npx tsc -p tsconfig.web.json --noEmit`: no errors in any file touched by this work. The project
  has pre-existing type errors elsewhere (Monaco typings in `EditorPane`, lucide/JSX in
  `JsonPreview`) and does not typecheck as part of its build.
- **`tests/command-palette.spec.ts`: 12/12 pass.** Replaces `tests/quick-open.spec.ts`, which was
  itself broken — it never cleared `ELECTRON_RUN_AS_NODE`, so every test in it failed to launch.
- Specs exercising the surfaces this work changed all pass: `sticky-notes` (16),
  `shortcut-labels` (4), `preview-toggle`, `json-preview-pane` (`Ctrl+P`), `alt-mnemonics`,
  `transform-to-diagram`, `deeplink`, `go-back-forward`, `find-prefill-selection`.

### Suite-wide caveat

The full suite cannot be run: `tests/whats-new.spec.ts` imports `releaseNotes.tsx`, which uses a
Vite `?raw` import Playwright's transform cannot resolve, and the collection error aborts the whole
run. Excluding it, a 174-test batch gave 94 pass / 79 fail — but the failures are not attributable
to this feature:

- Every ambiguous failure passes when its spec is run in isolation (`find-prefill-selection` 3/3,
  `find-results-navigation` 4/4). The batch failures are Electron/clipboard contention under
  `workers: 1` with many isolated app launches.
- `menu-consolidation/platform-rendering` and `quickstrip` assert macOS-only DOM (`QuickStrip`
  renders only on darwin) and cannot pass on Windows.
- `menu-consolidation/disabled-items` asserts Bookmarks, Plugin Manager and Split View are
  `enabled: false`; current `menu.ts` enables all three. `ui-redesign` asserts a *Preferences
  dialog* and `app-settings-rework` a Keyboard Shortcuts *placeholder tab*, neither of which
  exists any more. `whats-new-autoopen` expects no active tab on fresh install, while `App.tsx`
  deliberately activates What's New when the workspace is empty. All stale.
- The two surviving `find-results-copy` failures are CRLF-vs-LF mismatches in that panel's
  clipboard write on Windows.

Establishing a definitive baseline was not possible: the working tree is not a Git repository, so
there is nothing to diff against.

---

## Not done (deliberately)

- **Two-platform accelerator check (plan task 3.1/3.7).** `registerAccelerator: false` is applied
  across every registry-owned menu item, but it has only been exercised on Windows. The plan makes
  a macOS pass an exit criterion, and the documented fallback (drop `accelerator`, render the key
  into the label) is untested. **This is the one open risk in the feature.**
- Interactive `npm run dev` walk-throughs from the plan's manual checklist. Substituted with E2E
  coverage where a spec could express the check.
- `CLAUDE.md`'s stale "Incomplete / Stubbed Features" list and its wrong config-dir path — the plan
  calls this out and puts it out of scope.
