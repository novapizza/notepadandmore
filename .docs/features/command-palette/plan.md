# Implementation Plan: Command Palette & Command Registry

**Feature:** command-palette
**Date:** 2026-08-04
**Prerequisites:** PRD and Spec finalized. Tests document pending (`/create-tests`).

> References:
> - [PRD](./prd.md) — features, user stories, business rules
> - [Spec](./spec.md) — types, registry API, dispatcher, palette contracts
> - [Brainstorm Notes](./raw/notes.md) — decision rationale, bugs found while scoping

---

## Phase Overview

| # | Phase | Description | Depends On | Deliverable | Verification |
|---|-------|-------------|------------|-------------|--------------|
| 0 | Fix dead commands | Wire `indentSelection`/`outdentSelection`; reconcile Begin/End Select | — | No dispatched verb lacks a handler | Build + manual |
| 1 | Registry foundation | Types, registry module, `fileOpsRegistry` — no consumers yet | Phase 0 | `commands/` module compiling, unused | Build |
| 2 | Populate registry | Migrate all 49 catalogued + ~35 editor verbs by class | Phase 1 | `definitions.ts` complete | Build + per-class smoke |
| 3 | Dispatcher + accelerators | One keydown handler; `registerAccelerator: false`; derive `SHORTCUT_CATALOG` | Phase 2 | **Shortcuts editor works** | Build + two-platform check |
| 4 | Palette UI | `CommandPalette` with both modes; retire `QuickOpenPalette` | Phase 3 | `Mod+Shift+P` / `Mod+E` | Build + dev server |
| 5 | Contributions | Tools, themes, settings, plugin entries | Phase 4 | ~20 more palette entries | Build + dev server |
| 6 | Shortcuts editor polish | Remove caveat, conflict warnings, reject unbindables | Phase 3 | Honest Shortcuts UI | Build + dev server |
| 7 | Release artifacts | Release notes, changelog (**Changed** for the key move), security review | 0–6 | Shippable | `/security-review` |

> Phases 0–4 are sequential. Phases 5 and 6 both depend only on Phase 4 / Phase 3 respectively and
> may run in either order.

**Why Phase 0 is first:** the palette makes dead commands glaringly visible. Shipping a list that
contains two entries which do nothing would undermine trust in the whole surface, and fixing them
first means Phase 2 can assert "every registry entry reaches a real handler" as an invariant.

**Why Phase 3 is the pivot:** it is where the Shortcuts editor stops lying. It is also the riskiest
phase, since it depends on `registerAccelerator: false` behaving as documented — verify that before
building anything on top.

---

## Phase 0: Fix Dead Commands

**Goal:** no verb is dispatched without a handler. Implements PRD US-016, Spec §4.4.

**Input:** Spec §4.4
**Output:** Two working commands, one reconciled discrepancy. Independently shippable.

### Tasks

| # | Task | File | Description | Verification |
|---|------|------|-------------|--------------|
| 0.1 | Handle indent/outdent | `src/renderer/src/components/EditorPane/EditorPane.tsx` | Add `case 'indentSelection'` / `case 'outdentSelection'` to `dispatchCommand`, triggering Monaco's `editor.action.indentLines` / `editor.action.outdentLines`. | `npm run dev`: *Edit ▸ Indent Selection* now indents (it currently does nothing) |
| 0.2 | Verify Begin/End Select | `src/renderer/src/components/editor/MenuBar.tsx` | The handler at `EditorPane.tsx:292` is fully implemented but the MenuBar entries are `disabled: true` (lines 155–156) while the native menu enables them. Test via the native menu; if it works, drop `disabled`. If it doesn't, disable it natively too and note why. | `npm run dev`: consistent behaviour between both menus |
| 0.3 | Audit for other dead verbs | — | Cross-check every verb sent as `editor:command` from `menu.ts` + `MenuBar.tsx` against `EditorPane`'s `case` labels. Note that `zoomIn`/`zoomOut`/`zoomReset` are intentionally handled in `App.tsx:280`, not `EditorPane` — those are fine. | Diff of the two lists is empty except the known `App.tsx` zoom trio |

### Phase Exit Criteria

- [ ] `npm run build` passes
- [ ] Indent / Outdent Selection work from both menus
- [ ] Typing Tab in the editor still indents normally (no regression)
- [ ] Begin/End Select behaves the same in both menus
- [ ] Every `editor:command` verb has a handler somewhere, documented where

---

## Phase 1: Registry Foundation

**Goal:** the module skeleton, compiling and unused, so Phase 2 is pure data entry. Implements PRD
US-001, Spec §2.1, §3.

**Input:** Spec §2.1, §3.1–§3.3
**Output:** `commands/` module with no consumers — zero behaviour change.

### Tasks

| # | Task | File | Description | Verification |
|---|------|------|-------------|--------------|
| 1.1 | Types | `src/renderer/src/commands/types.ts` | `CommandSection` (superset of `ShortcutSection`), `CommandContext`, `CommandDef` per Spec §2.1. Types only — no imports from `shortcutCatalog` (cycle risk, Spec §10). | `npm run build` |
| 1.2 | `fileOpsRegistry` | `src/renderer/src/commands/fileOpsRegistry.ts` | Module singleton mirroring `editorRegistry` exactly. `FileOpsHandle` = `ReturnType<typeof useFileOps>`. | `npm run build` |
| 1.3 | Registry core | `src/renderer/src/commands/registry.ts` | `COMMANDS` (empty for now), `getContext()`, `allCommands()`, `getCommand()`, `availableCommands()` (treating a thrown `when` as unavailable), `runCommand()` (try/catch + toast), `recentCommandIds()`, module-level MRU capped at `MRU_SIZE`. | `npm run build` |
| 1.4 | Duplicate-id guard | `src/renderer/src/commands/registry.ts` | At module load, detect duplicate ids and `console.error` in dev. Cheap insurance for a hand-written 130-entry list. | `npm run build`; temporarily add a dup and confirm the error |
| 1.5 | Wire `fileOpsRegistry` | `src/renderer/src/App.tsx` | `useEffect(() => { fileOpsRegistry.set(fileOps); return () => fileOpsRegistry.set(null) }, [fileOps])`. Nothing consumes it yet. | `npm run dev`: no behaviour change, no console errors |

### Phase Exit Criteria

- [ ] `npm run build` passes
- [ ] App behaves **identically** — this phase ships no user-visible change
- [ ] `getContext()` returns a live editor and live fileOps when a file is open (check in DevTools)
- [ ] No import cycle between `commands/` and `utils/shortcutCatalog.ts`

---

## Phase 2: Populate the Registry

**Goal:** every command declared, migrated by class so each step is small and smoke-testable.
Implements PRD US-013, Spec §4.

**Input:** Phase 1. Spec §4.1–§4.3.
**Output:** `definitions.ts` covering the 49 catalogued commands plus the editor verbs.

> **Hard invariant for this phase:** all 49 existing ids from `SHORTCUT_CATALOG` are preserved
> **verbatim**. They are the keys for already-persisted `config.shortcuts` overrides — renaming one
> silently discards a user's rebind.

### Tasks

| # | Task | File | Description | Verification |
|---|------|------|-------------|--------------|
| 2.1 | `when` helpers | `src/renderer/src/commands/definitions.ts` | `hasEditor`, `hasFileBuf`, `isWritable`, `hasSelection`, `hasWorkspace` per Spec §4.3. Each defensive — never throws on a missing buffer. | `npm run build` |
| 2.2 | Editor verbs (~35) | `src/renderer/src/commands/definitions.ts` | One entry per verb in Spec §4.1's editor class, each `run` dispatching the same `CustomEvent('editor:command', { detail: verb })`. Copy labels from the existing menus; apply `isWritable`/`hasFileBuf` per §4.3. | `npm run build`; invoke a sample via `runCommand()` in DevTools |
| 2.3 | File ops (8) | `src/renderer/src/commands/definitions.ts` | `file.new/open/openFolder/save/saveAs/saveAll/reload/close` via `ctx.fileOps`. Guard on `ctx.fileOps === null`. | DevTools invoke each |
| 2.4 | UI toggles (~8) | `src/renderer/src/commands/definitions.ts` | Sidebar, statusbar, toolbar, split view, preview, word wrap, find, find-in-files via `useUIStore.getState()`. | DevTools invoke each |
| 2.5 | Encoding / EOL (9) | `src/renderer/src/commands/definitions.ts` | Dispatch `editor:set-encoding` / `editor:set-eol` CustomEvents — the same mechanism the status-bar Quick Picks use. Section `Encoding`. | DevTools invoke; status bar updates |
| 2.6 | Virtual tabs + misc | `src/renderer/src/commands/definitions.ts` | Settings, What's New, Plugin Manager, About, Check for Updates, Next/Previous Tab, AI Assistant. `view.aiAssistant`'s `run` **must keep** the existing "nudge to Settings when `aiEnabled` is false" behaviour from `App.tsx:404-412`. | DevTools invoke each |
| 2.7 | Palette commands | `src/renderer/src/commands/definitions.ts` | `search.commandPalette` (`Mod+Shift+P`) and `search.goToFile` (`Mod+E`, `when: hasWorkspace`). Handlers land in Phase 4; stub to `setCommandPalette` now. | `npm run build` |
| 2.8 | Id-preservation check | — | Grep every id in the old `SHORTCUT_CATALOG` and assert each appears in `definitions.ts` with the same string. A missing id is a silently-dropped user override. | All 49 present; diff empty |

### Phase Exit Criteria

- [ ] `npm run build` passes
- [ ] All 49 original ids present verbatim, with their original `defaultKey`s
- [ ] Every editor verb from Phase 0.3's audit has a registry entry
- [ ] Each command runs correctly via `runCommand(id)` from DevTools
- [ ] No duplicate-id error logged
- [ ] Still no user-visible change — nothing consumes the registry yet

---

## Phase 3: Dispatcher & Display-Only Accelerators

**Goal:** one keystroke path, and a Shortcuts editor that works. Implements PRD US-002, US-003,
US-004, US-005; Spec §5, §6.

**Input:** Phase 2. Spec §5.1–§5.4, §6.
**Output:** Rebinding takes effect. Native accelerators display but don't fire.

> **Do task 3.1 first and stop if it fails.** The entire dispatch design rests on
> `registerAccelerator: false` displaying the key while not registering it. If a platform disagrees,
> take the documented fallback (drop `accelerator`, render the key into the label) before proceeding.

### Tasks

| # | Task | File | Description | Verification |
|---|------|------|-------------|--------------|
| 3.1 | Spike `registerAccelerator: false` | `src/main/menu.ts` | Apply to **one** item (e.g. Duplicate Line). Confirm the menu still shows `Ctrl+D` and pressing it no longer fires. | Manual on Windows **and** macOS |
| 3.2 | Derive `SHORTCUT_CATALOG` | `src/renderer/src/utils/shortcutCatalog.ts` | Replace the literal array with `allCommands().filter(c => c.defaultKey).map(…)` per Spec §6. Widen `SHORTCUT_SECTIONS`; alias `ShortcutSection` to `CommandSection`. Keep all helper signatures. | `npm run build`; Settings ▸ Shortcuts renders the same 49 plus new sections |
| 3.3 | Dispatcher hook | `src/renderer/src/commands/useCommandKeys.ts` | Per Spec §5.1: memoise `binding → id` from `allCommands()` + `config.shortcuts` (first wins, BR-004); capture-phase listener; `preventDefault` only on a match. | `npm run build` |
| 3.4 | Typing guard | `src/renderer/src/commands/useCommandKeys.ts` | `isTypingTarget` per Spec §5.3 — all three rules, including hard-excluding bare `Tab`/`Shift+Tab` from keyboard dispatch. | Type Tab, F2, letters in: editor, an `<input>`, a `<textarea>` — nothing swallowed |
| 3.5 | Mount the dispatcher | `src/renderer/src/App.tsx` | Call `useCommandKeys()` once. | `npm run dev`: shortcuts still work |
| 3.6 | Remove bespoke handlers | `src/renderer/src/App.tsx` | Delete the Quick Open handler (lines ~90–101) and the AI Assistant handler (lines ~132–145) per Spec §5.2. Both are now registry commands. | `Mod+Shift+A` toggles the AI panel exactly once, with focus inside **and** outside Monaco |
| 3.7 | Strip accelerator registration | `src/main/menu.ts` | Add `registerAccelerator: false` to every registry-owned item. **Leave alone:** the 15 `role:` entries and `F12`. | Every menu still shows its key; each key fires once |
| 3.8 | Route MenuBar through the registry | `src/renderer/src/components/editor/MenuBar.tsx` | Where a registry id exists, replace the inline closure with `runCommand(id)`. Leave `role`-equivalents (`document.execCommand` cut/copy/paste) and submenu-only UI as-is. | `npm run dev`: every MenuBar item still works |

### Phase Exit Criteria

- [ ] `npm run build` passes
- [ ] **Rebinding a shortcut in Settings takes effect immediately, with no restart** (US-005)
- [ ] The old default stops working after a rebind; Reset restores it
- [ ] Every shortcut fires its command exactly **once** — verified for a toggle both inside and outside Monaco
- [ ] Native menus still display accelerators on macOS and Windows
- [ ] `role:` accelerators (Undo/Copy/Paste/Select All) still work natively
- [ ] Typing is never swallowed in the editor, inputs, or textareas
- [ ] Unmatched keypresses are not `preventDefault`ed
- [ ] Spot-check: `Mod+S`, `Mod+F`, `Mod+B`, `Mod+P` (Preview), `F2`, `Alt+Z`, `Mod+\`

---

## Phase 4: Palette UI

**Goal:** the visible feature. Implements PRD US-007 – US-012; Spec §7, §2.2.

**Input:** Phase 3. Spec §2.2–§2.4, §7.
**Output:** `CommandPalette` with both modes; `QuickOpenPalette` retired.

### Tasks

| # | Task | File | Description | Verification |
|---|------|------|-------------|--------------|
| 4.1 | Store state | `src/renderer/src/store/uiStore.ts` | Replace `quickOpenVisible` with `commandPaletteMode: 'commands' \| 'files' \| null` + `setCommandPalette`. Update `CLOSE_TOP_OVERLAYS` (line ~167) to carry `commandPaletteMode: null`. Opening spreads `CLOSE_TOP_OVERLAYS` (BR-007). | `npm run build` (expect errors at old call sites — fix them) |
| 4.2 | Component shell | `src/renderer/src/components/CommandPalette/CommandPalette.tsx` | Copy `QuickOpenPalette`'s overlay markup and its `Highlighted` sub-component. Return `null` when closed. Keep applicable `data-testid`s. | `npm run build` |
| 4.3 | Mode derivation | `.../CommandPalette.tsx` | Derive mode from the `>` prefix per Spec §7.2; seed `query` from the opening mode; reset selection on mode change; mode-specific placeholder. | `npm run dev`: typing/deleting `>` flips modes live |
| 4.4 | Command mode | `.../CommandPalette.tsx` | `toSearchItem` adapter (Spec §2.4); `availableCommands()` snapshot on open; `fuzzyFilter` with `MAX_RESULTS`; rows show `Section: Label` + `bindingDisplay(id, overrides)`; highlight `matchRanges`. | `npm run dev` |
| 4.5 | File mode | `.../CommandPalette.tsx` | Port Quick Open's logic verbatim (BR-011): recursive listing on open, "Indexing files…", "No folder is open", truncation footer, `openFiles([path])`. | `npm run dev`: identical to today's Quick Open |
| 4.6 | Keyboard + invoke | `.../CommandPalette.tsx` | Arrow wrap, Enter, Escape, backdrop click, hover-to-select, scroll-into-view. **Close before invoking** (BR-006, Spec §7.5). | `npm run dev`: run a command that opens an overlay (e.g. Find) — it stays open |
| 4.7 | MRU | `.../CommandPalette.tsx` + `registry.ts` | On empty query, `recentCommandIds()` first, then the rest. Typed queries rank purely by score. Skip unavailable/removed ids. | `npm run dev`: run 2 commands, reopen — both at top |
| 4.8 | Swap in `App.tsx` | `src/renderer/src/App.tsx` | Render `<CommandPalette />` in place of `<QuickOpenPalette />`; delete the old import. | `npm run build` |
| 4.9 | Rebind the two keys | `src/main/menu.ts` + `definitions.ts` | Wire `search.commandPalette` → `Mod+Shift+P` (command mode) and `search.goToFile` → `Mod+E` (file mode). Update *Search ▸ Go to File*'s accelerator; add *Search ▸ Command Palette*. `Mod+P` (Preview) untouched. | `npm run dev`: all three keys behave per US-011 |
| 4.10 | Delete `QuickOpenPalette` | — | Remove the file. Grep for stragglers (`quickOpenVisible`, `QuickOpenPalette`, `quick-open` test ids) and update E2E selectors. | `npm run build`; grep clean |

### Phase Exit Criteria

- [ ] `npm run build` passes
- [ ] `Mod+Shift+P` opens command mode; `Mod+E` opens file mode; `Mod+P` still previews
- [ ] Fuzzy search matches label, section and keywords, with highlighting
- [ ] Rows show the correct binding, reflecting user overrides
- [ ] Unavailable commands are absent (Welcome screen, no selection, no workspace, read-only buffer)
- [ ] Mode switching via `>` works both ways without closing the overlay
- [ ] File mode matches today's Quick Open exactly, including all three states
- [ ] Palette closes before the command runs; command overlays survive
- [ ] MRU orders the empty-query list
- [ ] Opening the palette closes Find/About/Tools and vice versa (BR-007)
- [ ] `QuickOpenPalette.tsx` is deleted with no dangling references

---

## Phase 5: Contributions

**Goal:** tools, themes, settings and plugins appear without hand-listing. Implements PRD US-014,
Spec §8.

**Input:** Phase 4. Spec §8.
**Output:** ~20 generated entries plus N plugin entries.

### Tasks

| # | Task | File | Description | Verification |
|---|------|------|-------------|--------------|
| 5.1 | Tools (9) | `src/renderer/src/commands/contributions.ts` | Map `TOOLS` → `tools.open.<id>`, label `Tools: <label>`, `keywords` from the tool's `description` and `group`. | Palette: "epoch" finds Epoch Converter |
| 5.2 | Themes (3) | `.../contributions.ts` | Map `THEMES` → `theme.set.<id>`, `Preferences: Color Theme → <name>`. `run` sets `configStore.theme` and calls `applyTheme(id)`. | Palette switches theme live |
| 5.3 | Settings categories (8) | `.../contributions.ts` | `settings.open.<cat>` → `setPendingSettingsCategory(cat)` + `openVirtualTab('settings')`. | Palette opens Settings on the right category |
| 5.4 | Plugin items | `.../contributions.ts` | Read `pluginStore.dynamicMenuItems` at call time; `run` sends `plugin:invoke-menu-click`. **Slugify** ids so labels with spaces/punctuation can't collide or malform. | Install a plugin → entry appears; disable → it disappears |
| 5.5 | Join into `allCommands()` | `src/renderer/src/commands/registry.ts` | `allCommands()` = static ∪ contributed, deduped by id with static winning. Contributions must never enter `SHORTCUT_CATALOG` (no `defaultKey`, BR-009). | Settings ▸ Shortcuts shows no contributed entries |

### Phase Exit Criteria

- [ ] `npm run build` passes
- [ ] All 9 tools, 3 themes and 8 settings categories are palette-reachable
- [ ] Plugin menu items appear and disappear with plugin state
- [ ] No contributed entry appears in the Shortcuts editor
- [ ] Adding a hypothetical 10th tool requires no registry edit
- [ ] No duplicate-id errors

---

## Phase 6: Shortcuts Editor Polish

**Goal:** make the Shortcuts UI honest now that it works. Implements PRD US-006, Spec §6.1.

**Input:** Phase 3. Spec §6.1.
**Output:** No stale caveat, conflicts surfaced, unbindables rejected.

### Tasks

| # | Task | File | Description | Verification |
|---|------|------|-------------|--------------|
| 6.1 | Remove the caveat | `src/renderer/src/components/SettingsTab/ShortcutsSection.tsx` | Delete the "not wired yet" claim from the doc comment (lines 18–22) **and** the matching sentence in the visible copy (~line 59). It is no longer true. | Read the panel: no stale disclaimer |
| 6.2 | Conflict detection | `.../ShortcutsSection.tsx` | Build `Map<binding, id[]>` over effective bindings; render an inline warning on each row of a 2+ group naming the other command, noting that the first in list order wins (BR-004). | Bind two commands to `Mod+J` → both warn |
| 6.3 | Reject unbindables | `.../ShortcutsSection.tsx` | Refuse `role:`-owned combos (`Mod+Z/Y/X/C/V/A`) and `F12` with an explanation. Mark `edit.indent`/`edit.outdent` non-rebindable per Spec §5.3 rule 3 rather than offering a capture field that can't take effect. | Try to bind `Mod+C` → explained refusal |

### Phase Exit Criteria

- [ ] `npm run build` passes
- [ ] No stale caveat in the source comment or the UI
- [ ] Conflicts warn on both rows without blocking the assignment
- [ ] Reserved combos are refused with a reason
- [ ] `edit.indent` / `edit.outdent` are shown as non-rebindable
- [ ] Reset All still clears every override and restores defaults live

---

## Phase 7: Release Artifacts

**Goal:** satisfy the mandatory release rules in [`CLAUDE.md`](../../../CLAUDE.md).

**Input:** Phases 0–6.
**Output:** Release notes, changelog, clean security review.

### Tasks

| # | Task | File | Description | Verification |
|---|------|------|-------------|--------------|
| 7.1 | Release notes | `src/renderer/src/components/WhatsNewTab/releaseNotes.tsx` | Add to the top entry (`RELEASE_NOTES[0].version` must equal `package.json`). Lead with the palette; **call out the `Mod+Shift+P` change explicitly** — it moves an existing shortcut. Also note the now-working Shortcuts editor. Real JSX, `font-mono` for key combos. | `npm run build` |
| 7.2 | Changelog | `CHANGELOG.md` | `Added`: palette, registry, contributions. **`Changed`**: `Mod+Shift+P` → Command Palette, Go to File → `Mod+E`. **`Fixed`**: Shortcuts editor now applies rebinds; Indent/Outdent Selection did nothing; AI toggle double-fire (if confirmed). | Manual read |
| 7.3 | Security review | — | `/security-review` over the staged diff. Focus: plugin-contributed ids and labels are untrusted input rendered into the palette and slugified into ids — check for injection into `run` targets; confirm `plugin:invoke-menu-click` args are still validated main-side. | Clean or findings justified |

### Phase Exit Criteria

- [ ] `RELEASE_NOTES[0].version === package.json` version
- [ ] The shortcut change is documented under **Changed**, not buried in Added
- [ ] `/security-review` passes
- [ ] `npm run build` passes from clean

---

## Verification Strategy

### Automated Checks (per task)

| Method | When to Use | How |
|--------|-------------|-----|
| **Build** | Every code task | `npm run build` |
| **DevTools invoke** | Phase 2 | `runCommand('id')` from the console — verifies handlers without UI |
| **Dev server** | Phases 0, 3–6 | `npm run dev` |
| **Two-platform check** | Task 3.1, 3.7 | macOS **and** Windows — `registerAccelerator` is the one platform-sensitive dependency |
| **Grep invariants** | Phases 2, 4 | All 49 old ids present; no `quickOpenVisible` / `QuickOpenPalette` stragglers |
| **E2E** | After Phase 4 | `npm run test:e2e` — existing `quick-open` test ids will need updating |

### Manual Test Checklist (Dev Server)

**Dispatch correctness (the risky part):**
1. `Mod+Shift+A` with the editor focused → AI panel toggles **once**
2. `Mod+Shift+A` on the Welcome screen → toggles **once** (the suspected pre-existing double-fire)
3. Rebind Save to `Mod+Alt+J` → it saves; `Mod+S` no longer does; Reset restores both
4. Type Tab, Shift+Tab, F2, and plain letters in the editor → all behave normally
5. Type in the Find input and a Settings field → no command hijacks a keystroke
6. Press an unbound combo (`Mod+Shift+Y`) → nothing happens, no console noise
7. Every native menu still displays its accelerator (macOS + Windows)
8. `Mod+Z` / `Mod+C` / `Mod+V` still work (native roles)

**Palette:**
9. `Mod+Shift+P` → command mode, list populated, input focused
10. Type "dup" → Duplicate Line ranks first with highlighting
11. Type "enc" → encoding commands appear (section/keyword match)
12. Enter runs the command; Escape closes without running
13. Delete the `>` → file mode; retype `>` → command mode
14. `Mod+E` → file mode directly; `Mod+P` → still Preview
15. On the Welcome screen → editor commands absent
16. With a read-only deeplink tab → mutating commands absent
17. With no folder open → Go to File / Find in Files absent
18. Run Find from the palette → Find & Replace opens and **stays** open
19. Run two commands, reopen → both at the top (MRU)
20. Open the palette while Find is open → Find closes (exclusivity)
21. 50-result cap holds on a broad query; list scrolls; selection scrolls into view

**Contributions:**
22. "color" → Color Converter tool **and** Color Theme entries
23. Switch theme from the palette → applies live and persists
24. A settings-category entry opens Settings on that category
25. Plugin item appears; disable the plugin → it's gone

**Regression:**
26. Indent / Outdent Selection work from both menus (Phase 0)
27. Every Toolbar button still works
28. Editor context-menu items still work
29. Status-bar Quick Picks (encoding/language/EOL) still work — `QuickPick.tsx` untouched

---

## Execution Notes

- **Commits:** one per task, or per phase for small ones. `fix(core):` for Phase 0 and the Phase 3/6
  bug fixes; `refactor(commands):` for Phases 1–2; `feat(palette):` for Phases 4–5.
- **Security review before every commit and push**, per `CLAUDE.md` — Phase 7.3 is the final pass,
  not the only one.
- **Do not stage** `.claude/settings.local.json`.
- **Phases 1 and 2 ship zero user-visible change.** That's deliberate: the risky cutover is isolated
  in Phase 3, so if it needs backing out, the registry survives.
- **Id stability is the one irreversible thing here.** Once a command id ships, it's a key in users'
  `config.shortcuts`. Get the names right in Phase 2 — `edit.duplicateLine`, not `duplicateLine` or
  `editor.dupLine`.
- **Existing E2E tests reference `quick-open` test ids.** Phase 4.10 must update them or they'll
  fail for reasons unrelated to the feature.
- **`CLAUDE.md` is stale** in ways a reader of this plan will notice: the "Incomplete / Stubbed
  Features" list still names Find/Replace, Preferences, Plugin Manager and Split View, all of which
  ship; and it documents the config dir as `~/.config/notepad-and-more/` while the code uses
  `app.getPath('userData')`. Worth a separate cleanup commit; out of scope here.
