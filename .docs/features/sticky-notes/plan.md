# Implementation Plan: Sticky Notes (Notes Sidebar Panel)

**Feature:** sticky-notes
**Date:** 2026-08-04
**Prerequisites:** PRD and Spec finalized. Tests document pending (`/create-tests`).

> References:
> - [PRD](./prd.md) — features, user stories, business rules
> - [Spec](./spec.md) — data shapes, store contract, component contracts, wiring
> - [Brainstorm Notes](./raw/notes.md) — decision rationale

---

## Phase Overview

| # | Phase | Description | Depends On | Deliverable | Verification |
|---|-------|-------------|------------|-------------|--------------|
| 1 | Foundations | Atomic `write-raw` + `SessionManager` allowlist fix | — | Crash-safe config writes; sidebar panel restore fixed for `functions`/`docmap` | `npm run build` + manual restart test |
| 2 | Notes store | `notesStore` with persistence, validation, limits | Phase 1 | `notesStore.ts` | `npm run build` + DevTools console |
| 3 | Panel UI | `NotesPanel`, `NoteCard`, tints; registered in SideNav + Sidebar | Phase 2 | Working panel reachable by click | `npm run build` + dev server |
| 4 | Shortcut wiring | Catalog, native menu, preload, IPC + keydown | Phase 3 | `Mod+Shift+N` toggles Notes app-wide | `npm run build` + dev server |
| 5 | Editor bridges | Send-to-note, insert-at-cursor, open-as-tab | Phase 3 | Three bridges working | `npm run build` + dev server |
| 6 | Release artifacts | Release notes + changelog, security review | Phases 1–5 | Updated `releaseNotes.tsx` + `CHANGELOG.md` | `/security-review` clean |

> Phases 1–3 are strictly sequential. Phases 4 and 5 both depend only on Phase 3 and may be done
> in either order.

**Deliberate ordering note:** Phase 1 fixes a pre-existing bug (`functions`/`docmap` never
restore) *before* adding `'notes'`. Doing it after would mean shipping the same defect a third
time, then fixing three cases instead of two.

---

## Phase 1: Foundations

**Goal:** make config writes crash-safe and repair the sidebar-panel restore drift, so Notes is
built on correct ground. Implements PRD US-002, US-014 and Spec §3.3, §7.

**Input:** Spec §3.3 (Atomic write), §7 (Session Restore)
**Output:** Two small main-process fixes, independently valuable and independently revertable.

### Tasks

| # | Task | File | Description | Verification |
|---|------|------|-------------|--------------|
| 1.1 | Make `config:write-raw` atomic | `src/main/ipc/configHandlers.ts` | Replace the bare `fs.writeFileSync` with temp-then-rename per Spec §3.3. Temp file must sit in the same directory as the target (`${fp}.tmp-${process.pid}`). On failure, best-effort `unlinkSync` the temp and rethrow. Leave the handler's `Promise<void>` signature and `config:write` (XML) untouched. | `npm run build`; edit a setting and confirm `config.json` still round-trips; confirm no `.tmp-*` files linger in `userData/config/` |
| 1.2 | Fix sidebar panel union + allowlist | `src/main/sessions/SessionManager.ts` | Widen `SidebarPanel` (line ~30) and `KNOWN_SIDEBAR_PANELS` (line ~46) to `'files' \| 'search' \| 'plugins' \| 'functions' \| 'docmap' \| 'notes'`. Keep the line ~131 validator's fallback-to-`undefined` behaviour so unknown values still degrade to `files`. | `npm run build`; open Symbols panel → quit → relaunch → sidebar reopens on Symbols (this **fails** before the fix) |

### Phase Exit Criteria

- [ ] `npm run build` passes
- [ ] Settings changes still persist to `config.json`
- [ ] No `.tmp-*` leftovers in `userData/config/` after a dozen setting changes
- [ ] Sidebar restores to `functions` and to `docmap` across a restart (regression fixed)
- [ ] An unknown `sidebarPanel` value in `session.json` still falls back to `files`

---

## Phase 2: Notes Store

**Goal:** the complete data layer with no UI, per Spec §2 and §3.

**Input:** Phase 1 (atomic writes). Spec §2.1–§2.5, §3.1–§3.2.
**Output:** `notesStore.ts` — loadable, mutable, persisting.

### Tasks

| # | Task | File | Description | Verification |
|---|------|------|-------------|--------------|
| 2.1 | Types and limits | `src/renderer/src/store/notesStore.ts` | Define `NoteColor`, `Note`, `NotesFile` per Spec §2.1–§2.2 and the five limit constants from §2.3. Export all. | `npm run build` |
| 2.2 | Store skeleton | `src/renderer/src/store/notesStore.ts` | `create<NotesState>()` with `notes: []`, `loaded: false`, `editingId: null`, `filter: ''` and the action signatures from Spec §2.4. | `npm run build` |
| 2.3 | `load()` + validation | `src/renderer/src/store/notesStore.ts` | Read via `window.api.config.readRaw('notes.json')`. Implement the per-entry `isValidNote` guard from Spec §3.1 — drop bad entries individually, never throw. Implement the corrupt-file rule: on parse failure, load empty **and** set an internal `skipNextWrite` flag so a read failure can't erase the file before the user mutates anything. | `npm run build`; hand-write a `notes.json` with one valid and one malformed entry → only the valid one loads and the file is not rewritten |
| 2.4 | Debounced `save()` | `src/renderer/src/store/notesStore.ts` | Module-level `saveTimer` at `SAVE_DEBOUNCE_MS`, writing `{ version: 1, notes }` via `config.writeRaw`, following the `configStore` pattern. Honour and clear `skipNextWrite`. | `npm run build`; mutate via DevTools → `notes.json` appears within ~1s |
| 2.5 | Mutations | `src/renderer/src/store/notesStore.ts` | `createNote` (prepend, `crypto.randomUUID()`, returns `null` past `MAX_NOTE_CHARS`), `updateNote` (patch + advance `updatedAt`, clamp body at the cap), `deleteNote`, `togglePin`, `setEditingId`, `setFilter`. Each mutation calls `save()`; the UI-only setters (`setEditingId`, `setFilter`) must **not**. | `npm run build`; exercise each from DevTools and confirm `notes.json` contents |
| 2.6 | Derived helpers | `src/renderer/src/store/notesStore.ts` | Export pure `displayTitle(note)` and `sortNotes(notes)` per Spec §2.5. Keep them outside the store so `NoteCard` can use them without subscribing. | `npm run build` |
| 2.7 | Soft-cap signals | `src/renderer/src/store/notesStore.ts` | Expose booleans (or a `getCapWarning()`) for `SOFT_MAX_NOTES` / `SOFT_MAX_TOTAL_BYTES` breaches. The store must not toast — the panel owns UI. | `npm run build` |
| 2.8 | Load on launch | `src/renderer/src/App.tsx` | Call `useNotesStore.getState().load()` where `configStore.load()` is already called. Must not block first paint. | `npm run dev`; no console errors on a cold start with no `notes.json` |

### Phase Exit Criteria

- [ ] `npm run build` passes
- [ ] Notes created/edited/deleted from DevTools persist and survive a restart
- [ ] Missing `notes.json` → empty list, no error
- [ ] Malformed `notes.json` → empty list, **file left intact**, no crash
- [ ] Partially-malformed → valid entries survive
- [ ] A body over `MAX_NOTE_CHARS` is refused by `createNote` (returns `null`)
- [ ] No note ever carries a dirty flag or reaches `BackupManager` (BR-001, BR-002)

---

## Phase 3: Panel UI

**Goal:** the visible panel, registered in both host surfaces. Implements PRD US-003, US-004,
US-006, US-007, US-008, US-012, US-013.

**Input:** Phase 2 complete. Spec §4.1–§4.5, §8.
**Output:** Notes reachable by clicking the SideNav icon.

### Tasks

| # | Task | File | Description | Verification |
|---|------|------|-------------|--------------|
| 3.1 | Tint tokens | `src/renderer/src/styles/tailwind.css` | Add `--note-{yellow,green,blue,pink,purple}` to **both** the `:root` (line ~39) and `.dark` (line ~109) blocks as bare HSL triplets, matching the surrounding convention. Low-saturation backgrounds only. `default` reuses `--card`/`--secondary` — no new variable. Solarized Light inherits `:root` automatically (`base: 'light'`); see Spec §8.2 before adding overrides. | `npm run build` |
| 3.2 | Colour map | `src/renderer/src/components/Notes/noteColors.ts` | Static `Record<NoteColor, string>` of Tailwind arbitrary-value classes (`bg-[hsl(var(--note-yellow))]`), plus swatch metadata (label + class) for the overflow menu. No inline `style` colours. | `npm run build` |
| 3.3 | `uiStore` union | `src/renderer/src/store/uiStore.ts` | Add `'notes'` to the `sidebarPanel` union (line ~33). No other change — `setSidebarPanel` is already generic. | `npm run build` |
| 3.4 | `NoteCard` collapsed | `src/renderer/src/components/Notes/NoteCard.tsx` | Props per Spec §4.2. Collapsed view: tint background, `displayTitle` on one line with ellipsis, 2-line body preview, pin glyph when pinned, `⋯` trigger. Click → `onExpand()`. | `npm run build` |
| 3.5 | `NoteCard` expanded | `src/renderer/src/components/Notes/NoteCard.tsx` | Auto-growing `<textarea>` (cap ~40vh then internal scroll) bound to `body`, `onChange` → `updateNote`. **`Esc`** collapses and must `stopPropagation` so it doesn't reach overlay-closing handlers. **`Tab`** inserts a literal tab and `preventDefault`s. Autofocus when expanded via `createNote`. | `npm run dev`: type, press Tab, press Esc |
| 3.6 | Overflow menu | `src/renderer/src/components/Notes/NoteCard.tsx` | `dropdown-menu` with Pin/Unpin, the six colour swatches, and Delete. Delete → `await window.api.dialog.confirm(...)` per Spec §4.3; act only on `true`. **Never** `window.confirm` (BR-006). | `npm run dev`: delete prompts natively and cancels cleanly |
| 3.7 | `NotesPanel` shell | `src/renderer/src/components/Notes/NotesPanel.tsx` | Toolbar (filter input + `+ New`), scrollable list in `sortNotes` order, both empty states per Spec §4.1. The empty state states that notes are stored unencrypted in the app config folder (BR-004). | `npm run build` |
| 3.8 | Filter + create | `src/renderer/src/components/Notes/NotesPanel.tsx` | Filter narrows by `displayTitle` + `body`, case-insensitive substring. `+ New` calls `createNote()` then `setEditingId(newId)`. Drop an untouched empty note on blur (BR-010). Surface the size-cap toast when `createNote` returns `null`, and the soft-cap toast once per session. | `npm run dev` |
| 3.9 | Register in Sidebar | `src/renderer/src/components/Sidebar/Sidebar.tsx` | Update all three structures together (Spec §4.5): `SidebarPanelId` union, `PANEL_TITLES.notes = 'Notes'`, `panels.notes = <NotesPanel />`. | `npm run build` |
| 3.10 | Register in SideNav | `src/renderer/src/components/SideNav/SideNav.tsx` | Union + **add `'notes'` to `PANEL_IDS`** (without it the click silently does nothing) + `NAV_ITEMS` entry with `StickyNote` icon and tip `Notes (${mod}+Shift+N)`. | `npm run dev`: icon toggles the panel, and re-clicking collapses the sidebar |

### Phase Exit Criteria

- [ ] `npm run build` passes
- [ ] SideNav icon opens Notes; clicking again collapses the sidebar (BR-005)
- [ ] Create / edit / delete / pin all work and survive a restart
- [ ] Pinned notes sort above unpinned; ties by `updatedAt` desc
- [ ] Filter narrows correctly; empty result shows its state
- [ ] All six tints legible in Dark, Light, and Solarized Light
- [ ] Delete uses the native dialog and cancels without deleting
- [ ] `Tab` types a tab; `Esc` collapses without closing other overlays
- [ ] An empty untouched note is not persisted
- [ ] Panel header matches the other sidebar panels; list scrolls internally

---

## Phase 4: Shortcut Wiring

**Goal:** `Mod+Shift+N` works app-wide, including while Monaco has focus. Implements PRD US-005,
US-015 and Spec §6.

**Input:** Phase 3 complete. Spec §6.1–§6.4.
**Output:** Menu entry, catalog entry, and a working key.

### Tasks

| # | Task | File | Description | Verification |
|---|------|------|-------------|--------------|
| 4.1 | Catalog entry | `src/renderer/src/utils/shortcutCatalog.ts` | Add `{ id: 'view.notes', label: 'Notes', section: 'View', defaultKey: 'Mod+Shift+N' }` beside `view.aiAssistant`. | `npm run build`; entry appears in Settings ▸ Keyboard Shortcuts and matches the search filter |
| 4.2 | `toggleNotes()` helper | `src/renderer/src/App.tsx` | Single helper per Spec §6.4: collapse if Notes is already the active *and* visible panel, else select Notes and show the sidebar. Both the IPC and keyboard paths must call this one function — no duplicated logic. | `npm run build` |
| 4.3 | Native menu entry | `src/main/menu.ts` | *View ▸ Notes* with `accelerator: 'CmdOrCtrl+Shift+N'` sending `ui:toggle-notes`. Place it near the sidebar/preview toggles. | `npm run dev`: menu item present with the right accelerator text |
| 4.4 | Preload allowlist | `src/preload/index.ts` | Add `ui:toggle-notes` to the renderer-receive channel list — **both** arrays that enumerate these channels (~lines 179 and 213). Missing either leaves the menu item dead. | `npm run dev`: menu item toggles the panel |
| 4.5 | IPC listener | `src/renderer/src/App.tsx` | `window.api.on('ui:toggle-notes', toggleNotes)` alongside the other `menu:*` listeners, with matching `window.api.off('ui:toggle-notes')` in the cleanup block. | `npm run dev` |
| 4.6 | Capture-phase keydown | `src/renderer/src/App.tsx` | Copy the AI-panel handler at line ~135: capture-phase listener on `document.documentElement`, `mod && e.shiftKey && !e.altKey && key === 'n'/'N'` → `preventDefault`, `stopPropagation`, `toggleNotes()`. Remove the listener on unmount. | `npm run dev`: works with Monaco focused, on Welcome, and on Settings/What's New tabs |

### Phase Exit Criteria

- [ ] `npm run build` passes
- [ ] `Ctrl/Cmd+Shift+N` opens Notes from the editor, Welcome screen, and virtual tabs
- [ ] Pressing it again collapses the sidebar
- [ ] *View ▸ Notes* works and shows the accelerator
- [ ] macOS renders `⇧⌘N`; Windows/Linux `Ctrl+Shift+N`
- [ ] No existing shortcut regressed — spot-check `Mod+N`, `Mod+Shift+P` (Go to File), `Mod+Shift+A`, `Mod+B`
- [ ] `Mod+Alt+Shift+N` is not captured (the `!e.altKey` guard)

---

## Phase 5: Editor Bridges

**Goal:** the three crossings that make Notes better than an untitled tab. Implements PRD US-009,
US-010, US-011 and Spec §5.

**Input:** Phase 3 complete. Spec §5.1–§5.3.
**Output:** Selection → note, note → cursor, note → tab.

### Tasks

| # | Task | File | Description | Verification |
|---|------|------|-------------|--------------|
| 5.1 | Send Selection to Note | `src/renderer/src/components/EditorPane/EditorContextMenu.tsx` | Add the item per Spec §5.1, enabled only on a non-empty selection. Read the selection via `editorRegistry`, tag with the active buffer's `language`, `createNote`, then reveal: `setSidebarPanel('notes')` + `setShowSidebar(true)` + `setEditingId(id)`. Toast and abort when `createNote` returns `null`. Must not modify the document. | `npm run dev`: select code → note appears with the text, document unchanged |
| 5.2 | Insert at Cursor | `src/renderer/src/components/Notes/NoteCard.tsx` | Action-row button per Spec §5.2: single `executeEdits('notes-insert', …)` over the current selection range, then `editor.focus()`. Disable when there's no editor, when the active buffer isn't `kind === 'file'`, or when it's `isReadOnly`. | `npm run dev`: inserts at cursor; replaces a selection; **one** `Ctrl+Z` fully reverts it; disabled on a deeplink read-only tab |
| 5.3 | Open as Tab | `src/renderer/src/components/Notes/NoteCard.tsx` | Action-row button per Spec §5.3: `addBuffer` with the full field set (untitled, `isDirty: true`, `eol` from `configStore.defaultEol`, note's `language`), then `setActive(id)`. The note is retained. | `npm run dev`: opens an untitled dirty tab with the body and correct highlighting; note still in the panel |

### Phase Exit Criteria

- [ ] `npm run build` passes
- [ ] *Send Selection to Note* creates the note, opens the panel, leaves the document untouched
- [ ] It is disabled/hidden with no selection
- [ ] *Insert at Cursor* is a single undo step and returns focus to the editor
- [ ] *Insert at Cursor* is disabled with no active file buffer and on read-only buffers
- [ ] *Open as Tab* produces an ordinary untitled buffer that Save As can write
- [ ] The note survives *Open as Tab*
- [ ] No new IPC channel was added for note data (BR-007)

---

## Phase 6: Release Artifacts

**Goal:** satisfy the repo's mandatory release-notes and security rules from
[`CLAUDE.md`](../../../CLAUDE.md).

**Input:** Phases 1–5 complete.
**Output:** Updated release notes, changelog, and a clean security review.

### Tasks

| # | Task | File | Description | Verification |
|---|------|------|-------------|--------------|
| 6.1 | Release notes | `src/renderer/src/components/WhatsNewTab/releaseNotes.tsx` | Add highlights to the **top** entry (`RELEASE_NOTES[0].version` must equal `package.json`'s version — currently `1.6.0`; if a bump lands first, add a new top entry instead). Real JSX, `<span className="font-mono">` for `Ctrl/Cmd+Shift+N` and `notes.json`. Mention that notes are stored unencrypted. | `npm run build` |
| 6.2 | Changelog | `CHANGELOG.md` | Under `## [Unreleased]` › `Added`: the Notes panel + shortcut, and the three bridges. Under `Fixed`: sidebar panel restore for Symbols/Map, and atomic config writes. | Manual read |
| 6.3 | Security review | — | Run `/security-review` on the staged changes. Pay particular attention to: the `notes.json` name being a fixed literal (no renderer-supplied path reaching `configPath`), the temp-file path in the atomic write, and the absence of any credential material in notes. | `/security-review` clean or findings justified |

### Phase Exit Criteria

- [ ] `RELEASE_NOTES[0].version === package.json` version
- [ ] `CHANGELOG.md` `## [Unreleased]` covers every user-facing change, including the two fixes
- [ ] `/security-review` passes (mandatory before commit per `CLAUDE.md`)
- [ ] `npm run build` passes from clean

---

## Verification Strategy

### Automated Checks (per task)

| Method | When to Use | How |
|--------|-------------|-----|
| **Typecheck / build** | Every code task | `npm run build` (compiles all three bundles) |
| **Dev server** | UI tasks (Phases 3–5) | `npm run dev` → manual interaction |
| **Restart test** | Persistence (Phases 1–2) | Quit fully and relaunch — not just a renderer reload; session and config writes only settle on quit |
| **Grep** | Guardrails | `window.confirm` / `window.alert` must not appear in new code; `sidebarPanel` unions must match across `uiStore`, `SideNav`, `Sidebar`, `SessionManager` |
| **E2E** | After Phase 5 | `npm run test:e2e` once tests exist via `/create-tests` |

### Manual Test Checklist (Dev Server)

1. Cold start with no `notes.json` → Notes panel opens empty, no console error
2. `+ New` → type → collapse → restart app → note is still there with the same title
3. Type a `Tab` inside a note → a tab character is inserted, focus stays in the textarea
4. `Esc` in an expanded note → collapses, text kept, no other overlay closes
5. Pin two notes → both sort above unpinned, ordered by last edit
6. Apply each of the six tints → check Dark, Light, Solarized Light
7. Delete → native prompt → Cancel keeps the note → confirm removes it
8. Filter for a word that only appears in a body → that note shows
9. `Ctrl/Cmd+Shift+N` from the editor, from Welcome, from Settings → opens Notes each time
10. `Ctrl/Cmd+Shift+N` again → sidebar collapses
11. Select code → context menu → *Send Selection to Note* → note created, document untouched
12. *Insert at Cursor* → text lands, single `Ctrl+Z` reverts it entirely
13. *Insert at Cursor* on a `novapad://open` read-only tab → disabled
14. *Open as Tab* → untitled dirty tab with correct highlighting; note still present
15. Leave the sidebar on Notes → quit → relaunch → reopens on Notes
16. Leave it on Symbols → quit → relaunch → reopens on Symbols (the Phase 1 regression fix)
17. Paste ~150k chars into a new note → clamped/refused with a toast, not silently truncated
18. Corrupt `notes.json` by hand → relaunch → empty list, no crash, **file not overwritten**

---

## Execution Notes

- **Commits:** one per task, or per phase where tasks are small. Messages: `feat(notes): …` for
  Phases 2–5, `fix(core): …` for Phase 1's two bug fixes (they stand alone and are worth
  separating in history).
- **Security review is mandatory before every commit and push** per `CLAUDE.md` — not just at
  Phase 6. Phase 6.3 is the final pass over the whole feature.
- **Do not stage** `.claude/settings.local.json`.
- **Union drift is the recurring hazard here.** `sidebarPanel` is declared in four places
  (`uiStore`, `SideNav`, `Sidebar`, `SessionManager`). Phase 1 and Phase 3 each touch a subset;
  after both, grep to confirm all four agree. The `functions`/`docmap` bug exists precisely
  because this drifted once already.
- **`CLAUDE.md` is stale** on two counts a reader of this plan may trip over: its "Incomplete /
  Stubbed Features" list names features that all ship today, and it describes the config path as
  `~/.config/notepad-and-more/` while the code uses Electron's `app.getPath('userData')`. Worth a
  separate cleanup commit; out of scope here.
- **Tests document:** create via `/create-tests` after Phase 5, before Phase 6.
