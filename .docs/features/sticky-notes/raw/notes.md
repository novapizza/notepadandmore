# Brainstorm Notes: Sticky Notes (Notes Sidebar Panel)

## Core Idea

A **Notes** panel in the sidebar holding short-lived scratch text — clipboard fragments, a
snippet you're about to paste, a TODO for the file you're reading — that survives restarts
without ever becoming a file on disk that the user has to name, save, or clean up.

NovaPad users already do this. They open an untitled tab and lean on
`rememberUnsavedOnExit` + [`BackupManager`](../../../src/main/sessions/BackupManager.ts) to keep
it across restarts. That works but abuses the document model: the scratch text occupies a tab,
shows as dirty forever, and prompts on quit. Notes makes it a first-class surface.

## Decisions

### 1. Sidebar panel — not a virtual tab, not a floating window

Notes lives as a sixth [`SideNav`](../../../src/renderer/src/components/SideNav/SideNav.tsx)
entry rendering into the existing sidebar, alongside Files / Symbols / Map.

**Why:** notes are something you want *beside* the document you're annotating, not instead of
it. A full-page virtual tab (the `settings` / `whatsNew` pattern) would fight the editor for the
same rectangle, and "notes" is a strange thing to have *open*. A detached always-on-top
`BrowserWindow` is the most literal reading of "sticky note" and we have precedent in
[`searchWindow.ts`](../../../src/main/windows/searchWindow.ts) — but that's a whole window
lifecycle for a v1. **Sidebar first; a detachable window can come later if users ask.**

### 2. Shortcut: `Ctrl/Cmd+Shift+N`

**Why this key:** it mirrors the sibling it's modelled on. The AI Assistant panel — the other
docked, toggleable panel — is `Mod+Shift+A` ([`menu.ts:531`](../../../src/main/menu.ts)). That
makes `Mod+Shift+<initial>` the pattern for "toggle a docked panel": `A` = AI, `N` = Notes.
Verified free against all 49 entries in
[`shortcutCatalog.ts`](../../../src/renderer/src/utils/shortcutCatalog.ts) and all 47 native
accelerators in `menu.ts`.

**Known risk:** `Ctrl+Shift+N` is "New Window" / "New Incognito Window" in browsers and VS Code.
NovaPad has no new-window command and is single-window by design (one `session.json`, one main
`BrowserWindow` plus the detached search window), so there is no conflict today. If a
"New Window" command is ever added, that is its conventional key and Notes must move —
`Mod+Alt+N` is the reserved fallback.

**Note:** `Mod+Shift+P` was the obvious first instinct and is **already taken** by *Go to File*
([`menu.ts:274`](../../../src/main/menu.ts)) — Quick Open owns VS Code's command-palette key here.

### 3. Toggle semantics follow the existing panels

Pressing the shortcut when Notes is already the active panel **collapses the sidebar**, matching
`handleNav` in [`SideNav.tsx:41-49`](../../../src/renderer/src/components/SideNav/SideNav.tsx).
Notes must not invent its own toggle behaviour.

### 4. Notes are always saved — never "dirty"

The single most important constraint. **Do not** route notes through the buffer/snapshot/backup
machinery. That would give NovaPad *two* unsaved-content systems — two backup paths, two restore
paths, two places a crash loses someone's text.

Notes get one plain store: `notes.json` in `userData/config/`, debounce-written through the
existing generic `config:write-raw` handler, exactly like
[`configStore`](../../../src/renderer/src/store/configStore.ts) writes `config.json`. No dirty
state, no save prompts, no participation in "quit with unsaved changes".

### 5. Writes must be atomic

`config:write-raw` currently does a bare `fs.writeFileSync`
([`configHandlers.ts`](../../../src/main/ipc/configHandlers.ts)). For `config.json` that's
tolerable — it's regenerable from `CONFIG_DEFAULTS`. For notes it is **not**: the file is the
user's only copy, and a crash mid-write truncates it. Make the handler atomic
(write temp → `fs.renameSync`). This also hardens `config.json` for free.

### 6. The editor bridges are what make this more than a gimmick

Without these, an untitled tab already does 90% of the job. These are the feature:

- **Send Selection to Note** — from the editor context menu
- **Insert Note at Cursor** — from a note's action row
- **Open Note as Tab** — a note that outgrew the panel graduates to a real buffer

All three go straight through
[`editorRegistry`](../../../src/renderer/src/utils/editorRegistry.ts), which is exactly how the
sibling [`AiChatPanel`](../../../src/renderer/src/components/AiAssistant/AiChatPanel.tsx#L64)
reads and writes the editor. No new IPC, no new CustomEvents.

### 7. Plain text with a language tag

Notes are plain text. They carry a `language` field only so a pasted code snippet highlights when
it graduates to a tab via *Open as Tab*. The in-panel editor is a plain `<textarea>` — **not** a
second Monaco instance. Monaco per note would be absurd for a 200px column and would multiply
model/disposal bugs.

### 8. Colour is a flat tint, and that's all

Six preset tints for visual grouping (`default`, yellow, green, blue, pink, purple), resolved
from theme tokens so they work in Dark / Light / Solarized Light. No custom colour picker.

## Scope

### In Scope

- `notesStore` (Zustand) + `notes.json` persistence with debounced, atomic writes
- `'notes'` added to `sidebarPanel`, SideNav entry, Sidebar panel registration
- `Mod+Shift+N` — native accelerator + capture-phase renderer handler + shortcut-catalog entry
- Notes panel: list of notes, inline textarea editor, new / delete / pin, text filter
- The three editor bridges (§6)
- Flat colour tint + pinning
- Session restore of the panel selection (requires the `SessionManager` allowlist fix below)

### Out of Scope

- Drag-to-position canvas / freeform board — that's a different product
- Rich text, Markdown rendering, checkboxes, attachments
- Reminders, due dates, notifications
- Sync, sharing, export to file (*Open as Tab* + Save As covers the escape hatch)
- Encryption. Notes are plaintext in `userData`, deliberately — see §9
- Per-note Monaco editors
- A detached always-on-top notes window (candidate for v2)
- Notes participating in Find in Files

### 9. Privacy: say where notes live, don't encrypt them

Scratchpads collect pasted tokens and passwords in practice. We were careful to keep the Gemini
key out of `config.json`
([`configStore.ts:57-61`](../../../src/renderer/src/store/configStore.ts)), so we should not now
be coy about notes: `notes.json` is **plaintext** in `userData/config/`. Encrypting it via
`safeStorage` would be overreach for a scratchpad (and would break the "just a JSON file you can
back up" property), but the storage location must be stated in the panel's empty state or
Settings copy. No surprises.

## Pre-existing bug this feature trips over

[`SessionManager.ts:30,46`](../../../src/main/sessions/SessionManager.ts) declares

```ts
type SidebarPanel = 'files' | 'search' | 'plugins'
const KNOWN_SIDEBAR_PANELS = new Set(['files', 'search', 'plugins'])
```

but [`uiStore.ts:33`](../../../src/renderer/src/store/uiStore.ts) has
`'files' | 'search' | 'plugins' | 'functions' | 'docmap'`. **`functions` and `docmap` already fail
to restore today** — leave the sidebar on Symbols or Map, restart, and it silently reverts to
Files, because the allowlist rejects the persisted value. Adding `'notes'` without fixing this
drift would ship the same bug a third time. Fix the allowlist as Phase 1.

## Architecture Sketch

```
SideNav (w-12)          Sidebar                        Editor
┌──┐  ┌──────────────────────────────┐  ┌────────────────────────┐
│📄│  │ NOTES                    ✕   │  │                        │
│🔍│  ├──────────────────────────────┤  │  const x = ...         │
│🌲│  │ 🔍 filter…              + New │  │       ▲                │
│🗺│  ├──────────────────────────────┤  │       │ Insert at cursor│
│🧩│  │ 📌 deploy steps         ⋯   │  │       │                 │
│📝│◄─│    ssh prod && ./deploy.sh   │──┘       │                 │
└──┘  │──────────────────────────────│          │                 │
 ▲    │    scratch              ⋯   │  Send Selection to Note ───┘
 │    │    TODO: check the retry…    │
Mod+Shift+N └──────────────────────────────┘
```

**Data flow:**

```
NotesPanel edit → notesStore.updateNote() → debounce 500ms
  → window.api.config.writeRaw('notes.json', json) → atomic temp+rename

Insert at cursor  → editorRegistry.get().executeEdits(...)     [no IPC]
Send to note      → EditorContextMenu → notesStore.createFrom(selection)
Open as tab       → editorStore.addBuffer({ content, language }) [untitled, dirty]
```

## Open Questions

- Should *Open as Tab* keep the note, or move it into the tab and delete it?
  **Decision: keep it.** Deleting on graduate is destructive and surprising; the user can delete
  explicitly. Accept that the two copies then diverge — the note is a snapshot, not a live link.
- Cap on note count / size? **Lean yes, soft:** warn past ~500 notes or ~5 MB total, don't block.
  `notes.json` is read whole on launch and a runaway paste shouldn't slow startup silently.
- Should notes be workspace-scoped rather than global? **Decision: global for v1.** Workspace
  scoping needs a story for "note written with no folder open", and global matches how the
  scratchpad is actually used (fragments in transit between projects).
