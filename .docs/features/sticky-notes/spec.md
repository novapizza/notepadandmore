# Technical Spec: Sticky Notes (Notes Sidebar Panel)

**Feature:** sticky-notes
**Date:** 2026-08-04

> References:
> - [PRD](./prd.md) — features, user stories, business rules
> - [Brainstorm Notes](./raw/notes.md) — decision rationale

---

## 1. Overview

Notes is a sixth sidebar panel backed by a standalone Zustand store persisted to a single
`notes.json`. It reuses the generic `config:*-raw` IPC pair, so **no new IPC channel and no
preload allowlist change is required**. All editor interaction goes through the existing
`editorRegistry` singleton, mirroring `AiChatPanel`.

The only main-process change is making `config:write-raw` atomic.

---

## 2. Data Shapes

### 2.1 Note

`src/renderer/src/store/notesStore.ts`

```ts
export type NoteColor = 'default' | 'yellow' | 'green' | 'blue' | 'pink' | 'purple'

export interface Note {
  /** crypto.randomUUID() — stable across restarts. */
  id: string
  /** Explicit title. Empty string means "derive from the first body line". */
  title: string
  body: string
  /** Monaco language id, used only when the note graduates to a tab. 'plaintext' default. */
  language: string
  color: NoteColor
  pinned: boolean
  /** Epoch ms. */
  createdAt: number
  updatedAt: number
}
```

### 2.2 Persisted file

`userData/config/notes.json`

```ts
export interface NotesFile {
  /** Bump only on a breaking shape change; readers must tolerate unknown future versions. */
  version: 1
  notes: Note[]
}
```

Example:

```json
{
  "version": 1,
  "notes": [
    {
      "id": "9f2c…",
      "title": "",
      "body": "ssh prod && ./deploy.sh",
      "language": "shell",
      "color": "yellow",
      "pinned": true,
      "createdAt": 1754300000000,
      "updatedAt": 1754300500000
    }
  ]
}
```

### 2.3 Limits

| Constant | Value | Enforcement |
|----------|-------|-------------|
| `MAX_NOTE_CHARS` | `100_000` | Hard. Creation (incl. *Send Selection to Note*) is refused with a toast; typing past it is clamped. |
| `SOFT_MAX_NOTES` | `500` | Soft. One-time toast when exceeded; never blocks. |
| `SOFT_MAX_TOTAL_BYTES` | `5 * 1024 * 1024` | Soft. One-time toast when the serialized file exceeds it. |
| `TITLE_DISPLAY_CHARS` | `60` | Display-only truncation of the derived title. |
| `SAVE_DEBOUNCE_MS` | `500` | Debounce before writing `notes.json`. |

### 2.4 Store contract

```ts
interface NotesState {
  notes: Note[]
  loaded: boolean
  /** Note currently expanded in the panel; null = list view. Not persisted. */
  editingId: string | null
  /** Panel filter text. Not persisted. */
  filter: string

  load: () => Promise<void>
  /** Debounced; call after any mutation. */
  save: () => void

  /** Returns the new note's id. Prepends. Refuses (returns null) past MAX_NOTE_CHARS. */
  createNote: (init?: Partial<Pick<Note, 'body' | 'language' | 'title' | 'color'>>) => string | null
  updateNote: (id: string, patch: Partial<Pick<Note, 'title' | 'body' | 'language' | 'color' | 'pinned'>>) => void
  deleteNote: (id: string) => void
  togglePin: (id: string) => void

  setEditingId: (id: string | null) => void
  setFilter: (q: string) => void
}
```

`updateNote` always advances `updatedAt`. `createNote` returning `null` means the caller must
surface the size-cap toast; it does not toast itself (keeps the store UI-free).

### 2.5 Derived values (not stored)

| Value | Derivation |
|-------|------------|
| Display title | `note.title` if non-empty, else the first non-empty line of `body` trimmed to `TITLE_DISPLAY_CHARS`, else `'Empty note'` |
| Sort order | `pinned` desc, then `updatedAt` desc |
| Filtered list | Case-insensitive substring of `filter` over display title **and** `body` |

Sorting is derived at render time from `notes`; the stored array order is not authoritative.

---

## 3. Persistence

### 3.1 Load

Called once from `App.tsx` alongside the existing config load.

```
window.api.config.readRaw('notes.json')
  → null            → { notes: [], loaded: true }
  → invalid JSON    → { notes: [], loaded: true }   (do not throw; do not overwrite the file)
  → valid           → notes = parsed.notes.filter(isValidNote)
```

`isValidNote` is a defensive per-entry guard: `id`/`body` are strings, `createdAt`/`updatedAt` are
finite numbers, `color` is in the known set (else `'default'`), `pinned` is boolean (else `false`),
`language` is a string (else `'plaintext'`). Invalid entries are dropped individually — one bad
note must not lose the rest.

**Corrupt-file rule:** if the file exists but does not parse, load empty and **skip the next
write** until the user makes an explicit mutation, so a transient read failure can't silently
erase notes on launch.

### 3.2 Save

Mirrors [`configStore`](../../../src/renderer/src/store/configStore.ts)'s module-level timer:

```ts
let saveTimer: ReturnType<typeof setTimeout> | null = null
// in save():
if (saveTimer) clearTimeout(saveTimer)
saveTimer = setTimeout(() => {
  const { notes } = get()
  const payload: NotesFile = { version: 1, notes }
  void window.api.config.writeRaw('notes.json', JSON.stringify(payload, null, 2))
}, SAVE_DEBOUNCE_MS)
```

A final flush on `beforeunload` is **not** required — `SAVE_DEBOUNCE_MS` is 500ms and Electron's
quit path already awaits the close handler — but a `flush()` that clears the timer and writes
synchronously-ish is cheap insurance and should be called from the same place `configStore` is
flushed, if such a call exists.

### 3.3 Atomic write (main process)

`config:write-raw` in [`configHandlers.ts`](../../../src/main/ipc/configHandlers.ts) currently does
a bare `fs.writeFileSync(fp, content, 'utf8')`. Replace with temp-then-rename:

```ts
ipcMain.handle('config:write-raw', async (_event, name: string, content: string) => {
  ensureConfigDir()
  const fp = configPath(name)
  const dir = path.dirname(fp)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const tmp = `${fp}.tmp-${process.pid}`
  try {
    fs.writeFileSync(tmp, content, 'utf8')
    fs.renameSync(tmp, fp)          // atomic within the same filesystem
  } catch (err) {
    try { fs.unlinkSync(tmp) } catch { /* best effort */ }
    throw err
  }
})
```

Notes:
- The temp file must be in the **same directory** as the target, or `rename` stops being atomic
  across filesystems.
- The handler's signature and return type are unchanged (`Promise<void>`), so `config.json`
  callers are unaffected other than gaining crash-safety.
- `config:write` (the XML path) is left alone — out of scope.

---

## 4. Component Contracts

### 4.1 `NotesPanel`

`src/renderer/src/components/Notes/NotesPanel.tsx` — takes no props, mirroring
`FileBrowserPanel` / `FunctionListPanel`.

Layout, top to bottom:

| Region | Content |
|--------|---------|
| Toolbar | Filter input (`Search` icon, placeholder `Filter notes…`) + `+ New` button (`Plus` icon) |
| List | Scrollable `NoteCard`s in derived sort order |
| Empty state | `No notes yet` + a one-line note that notes are stored unencrypted in the app's config folder (BR-004) |
| Filtered-empty state | `No matching notes` |

The panel is the only place that toasts; the store stays UI-free.

### 4.2 `NoteCard`

`src/renderer/src/components/Notes/NoteCard.tsx`

```ts
interface NoteCardProps {
  note: Note
  expanded: boolean
  onExpand: () => void
  onCollapse: () => void
}
```

**Collapsed:** tint background, display title (single line, ellipsis), a 2-line body preview, a
pin glyph when pinned, and a `⋯` overflow trigger.

**Expanded:** an auto-growing `<textarea>` bound to `body`, plus an action row.

Textarea requirements:
- `onChange` → `updateNote(id, { body })` (the store debounces persistence; do not debounce
  the controlled value or typing will feel laggy)
- `Esc` → `onCollapse()`; must `stopPropagation` so it doesn't reach the overlay-closing handlers
- `Tab` → insert a literal tab and `preventDefault` (US-007), rather than moving focus
- Growth capped (~40vh) then internal scroll

### 4.3 Action row (expanded card)

| Action | Enabled when | Behaviour |
|--------|--------------|-----------|
| Insert at Cursor | `editorRegistry.get()` non-null, active buffer `kind === 'file'`, not `isReadOnly` | §5.2 |
| Open as Tab | always | §5.3 |
| Overflow `⋯` | always | Pin/Unpin, colour swatches, Delete |

Delete → `await window.api.dialog.confirm('Delete this note?', <display title>, 'Delete')`
(BR-006). Only on `true` does `deleteNote` run.

### 4.4 SideNav entry

In [`SideNav.tsx`](../../../src/renderer/src/components/SideNav/SideNav.tsx):

- Extend the local `SidebarPanelId` union with `'notes'`
- Add `'notes'` to the `PANEL_IDS` set — **required**, or `handleNav` falls through and the click
  does nothing
- Append to `NAV_ITEMS`:
  `{ id: 'notes', icon: <StickyNote size={18} />, label: 'Notes', tip: \`Notes (${mod}+Shift+N)\` }`

`StickyNote` is a valid `lucide-react` export. Tip text uses `shortcutMod()` like the Find entry.
Prefer `bindingDisplay('view.notes', shortcuts)` from the catalog over hand-built text if the
component already has config access; otherwise match the existing `${mod}+F` style.

### 4.5 Sidebar registration

In [`Sidebar.tsx`](../../../src/renderer/src/components/Sidebar/Sidebar.tsx), all three
structures must be updated together or TypeScript will reject the `Record` literals:

- `SidebarPanelId` union → add `'notes'`
- `PANEL_TITLES` → `notes: 'Notes'`
- `panels` → `notes: <NotesPanel />`

---

## 5. Editor Bridges

All three use `editorRegistry` directly (BR-007). No new IPC, no new `editor:command` verb.

### 5.1 Send Selection to Note

Added to `EditorContextMenu.tsx`, enabled only with a non-empty selection.

```ts
const editor = editorRegistry.get()
const sel = editor?.getSelection()
const text = sel ? editor?.getModel()?.getValueInRange(sel) ?? '' : ''
if (!text) return
const lang = useEditorStore.getState().buffers.find(b => b.id === activeId)?.language ?? 'plaintext'
const id = useNotesStore.getState().createNote({ body: text, language: lang })
if (!id) { toast.error('Selection is too large for a note'); return }
useUIStore.getState().setSidebarPanel('notes')
useUIStore.getState().setShowSidebar(true)
useNotesStore.getState().setEditingId(id)
```

The document is not modified.

### 5.2 Insert at Cursor

```ts
const editor = editorRegistry.get()
if (!editor) return
const sel = editor.getSelection()
if (!sel) return
editor.executeEdits('notes-insert', [{ range: sel, text: note.body, forceMoveMarkers: true }])
editor.focus()
```

`executeEdits` with a single edit is one undo step, satisfying US-010. Using the selection as the
range makes "replace selection" and "insert at cursor" the same code path (an empty selection is a
zero-width range) — the same approach as the `plugin:insert-text` handler in
[`EditorPane.tsx`](../../../src/renderer/src/components/EditorPane/EditorPane.tsx).

### 5.3 Open as Tab

```ts
const id = useEditorStore.getState().addBuffer({
  filePath: null,
  title: displayTitle(note),
  content: note.body,
  isDirty: true,
  encoding: 'UTF-8',
  hasBom: false,
  eol: useConfigStore.getState().defaultEol,
  language: note.language,
  mtime: 0,
  viewState: null,
  savedViewState: null,
  bookmarks: [],
  loaded: true,
  missing: false,
  isLargeFile: false
})
useEditorStore.getState().setActive(id)
```

`kind` defaults to `'file'`, so this is an ordinary untitled buffer. The note is retained
(open question resolved in `raw/notes.md`). The two copies then diverge by design.

---

## 6. Shortcut Wiring

`Mod+Shift+N` needs all four registrations. Missing any one produces a partially-working key.

### 6.1 Catalog

In [`shortcutCatalog.ts`](../../../src/renderer/src/utils/shortcutCatalog.ts), in the `View`
section next to `view.aiAssistant`:

```ts
{ id: 'view.notes', label: 'Notes', section: 'View', defaultKey: 'Mod+Shift+N' },
```

### 6.2 Native menu

In [`menu.ts`](../../../src/main/menu.ts)'s View section:

```ts
{
  label: 'Notes',
  accelerator: 'CmdOrCtrl+Shift+N',
  click: () => win.webContents.send('ui:toggle-notes')
}
```

### 6.3 Preload allowlist

`ui:toggle-notes` must be added to the renderer-receive channel list in
[`preload/index.ts`](../../../src/preload/index.ts) (both arrays that enumerate `menu:*` / `ui:*`
channels). This is the one allowlist change the feature needs — the *config* IPC needs none.

### 6.4 Renderer handler

Two paths, both landing on one shared `toggleNotes()` helper in `App.tsx`:

```ts
function toggleNotes(): void {
  const ui = useUIStore.getState()
  if (ui.showSidebar && ui.sidebarPanel === 'notes') {
    ui.setShowSidebar(false)          // BR-005 parity with SideNav.handleNav
  } else {
    ui.setSidebarPanel('notes')
    ui.setShowSidebar(true)
  }
}
```

- IPC: `window.api.on('ui:toggle-notes', toggleNotes)` — registered with the other `menu:*`
  listeners, and torn down in the same cleanup block (`window.api.off('ui:toggle-notes')`).
- Keyboard: a capture-phase listener on `document.documentElement`, copying the AI-panel handler
  at [`App.tsx:135`](../../../src/renderer/src/App.tsx):

```ts
const mod = window.api.platform === 'darwin' ? e.metaKey : e.ctrlKey
if (mod && e.shiftKey && !e.altKey && (e.key === 'n' || e.key === 'N')) {
  e.preventDefault(); e.stopPropagation(); toggleNotes()
}
```

Capture phase is required for the same documented reason as Quick Open and the AI panel: the
native accelerator alone is swallowed while Monaco has focus. The `!e.altKey` guard keeps
`Mod+Alt+Shift+N` free for a future binding.

---

## 7. Session Restore

[`SessionManager.ts`](../../../src/main/sessions/SessionManager.ts) drifted from `uiStore`:

```ts
// line 30
type SidebarPanel = 'files' | 'search' | 'plugins'
// line 46
const KNOWN_SIDEBAR_PANELS: ReadonlySet<SidebarPanel> = new Set(['files', 'search', 'plugins'])
```

`uiStore` allows `'functions'` and `'docmap'` too, so those two silently fail to restore today
(the validator at line 131 rejects them and the value becomes `undefined` → `files`). Fix both
declarations to the full set:

```ts
type SidebarPanel = 'files' | 'search' | 'plugins' | 'functions' | 'docmap' | 'notes'
const KNOWN_SIDEBAR_PANELS: ReadonlySet<SidebarPanel> =
  new Set(['files', 'search', 'plugins', 'functions', 'docmap', 'notes'])
```

The union must stay in sync with `uiStore.sidebarPanel`; the two files are the drift risk and the
fix is to make them match, not to loosen the validator (an unknown persisted value must still fall
back to `files`).

---

## 8. Theming

Tints resolve from CSS variables, never literals, so all three themes work. Note the actual
mechanism — it is **not** one block per theme:

- **Base light/dark** come from the static `:root` and `.dark` blocks in
  [`tailwind.css`](../../../src/renderer/src/styles/tailwind.css) (lines ~39 and ~109).
  Values are bare HSL triplets (`220 14% 96%`), consumed as `hsl(var(--token))`.
- **Named themes** (currently only `solarized-light`) override tokens at runtime via
  `applyTheme()` in [`themes.ts`](../../../src/renderer/src/utils/themes.ts#L137), which
  `setProperty`s each entry of the theme's `tokens` record onto `<html>`. A named theme
  inherits every token it does not override from its `base`.

### 8.1 Required changes

1. Add five variables to **both** the `:root` and `.dark` blocks in `tailwind.css`:
   `--note-yellow`, `--note-green`, `--note-blue`, `--note-pink`, `--note-purple` — bare HSL
   triplets, matching the surrounding convention.
2. Consume them in `noteColors.ts` as Tailwind arbitrary values:
   `bg-[hsl(var(--note-yellow))]`.
3. `default` uses the existing `--card` / `--secondary` surface — **no new variable**.

### 8.2 Solarized Light

Solarized has `base: 'light'`, so it inherits the `:root` tints automatically and is *functional*
without further work. But the `:root` tints are tuned against a white `--card`, and Solarized's is
cream (`44 87% 94%`), so verify by eye and add overrides to `SOLARIZED_LIGHT_TOKENS` if they clash.

**Gotcha if you do add overrides:** `ALL_TOKEN_KEYS` is derived as
`Object.keys(SOLARIZED_LIGHT_TOKENS)` ([`themes.ts:121`](../../../src/renderer/src/utils/themes.ts)),
and `applyTheme` only clears keys in that list. Adding the tints to `SOLARIZED_LIGHT_TOKENS`
therefore also enrolls them in the clear-set, which is what you want. Adding a tint override to
some *other* future theme without adding it to Solarized would leak across theme switches — a
pre-existing sharp edge in this design, not something Notes introduces.

### 8.3 Requirements

- Tints are low-saturation backgrounds only; body text keeps `text-foreground`
- Verify legibility in Dark, Light, and Solarized Light (US-013)
- No inline `style` colour values, so theme switches stay instant

---

## 9. Files Touched

### New

| File | Purpose |
|------|---------|
| `src/renderer/src/store/notesStore.ts` | Store, persistence, limits, validation |
| `src/renderer/src/components/Notes/NotesPanel.tsx` | Panel shell: toolbar, list, empty states |
| `src/renderer/src/components/Notes/NoteCard.tsx` | Collapsed/expanded card, textarea, actions |
| `src/renderer/src/components/Notes/noteColors.ts` | `NoteColor` → class map + swatch metadata |

### Modified

| File | Change |
|------|--------|
| `src/main/ipc/configHandlers.ts` | `config:write-raw` → atomic temp+rename |
| `src/main/menu.ts` | *View ▸ Notes* with `CmdOrCtrl+Shift+N` |
| `src/main/sessions/SessionManager.ts` | Sidebar panel union + allowlist → full set (§7) |
| `src/preload/index.ts` | Allowlist `ui:toggle-notes` |
| `src/renderer/src/store/uiStore.ts` | `sidebarPanel` union → add `'notes'` |
| `src/renderer/src/components/SideNav/SideNav.tsx` | Union, `PANEL_IDS`, `NAV_ITEMS` entry |
| `src/renderer/src/components/Sidebar/Sidebar.tsx` | Union, `PANEL_TITLES`, `panels` |
| `src/renderer/src/components/EditorPane/EditorContextMenu.tsx` | *Send Selection to Note* |
| `src/renderer/src/App.tsx` | `notesStore.load()`, `toggleNotes()`, IPC + keydown handlers |
| `src/renderer/src/utils/shortcutCatalog.ts` | `view.notes` entry |
| `src/renderer/src/styles/tailwind.css` | Five tint variables in the `:root` and `.dark` blocks |
| `src/renderer/src/utils/themes.ts` | *Only if* Solarized needs tint overrides — see §8.2 |
| `src/renderer/src/components/WhatsNewTab/releaseNotes.tsx` | Highlight in the top entry (repo rule) |
| `CHANGELOG.md` | `## [Unreleased] › Added` entries (repo rule) |

No `electron-api.d.ts` change is needed — `config.readRaw` / `writeRaw` and `dialog.confirm` are
already declared.

---

## 10. Non-Goals Restated (guardrails during implementation)

- No `Buffer`/`BufferKind` change. Notes are not a buffer kind.
- No `BackupManager`, snapshot-timer, or `SessionManager` buffer-list involvement.
- No Monaco instance inside the panel.
- No new IPC channel for note data — `config:*-raw` is sufficient.
- No `window.confirm` / `window.alert` anywhere (BR-006).
- No `notes.json` encryption.
