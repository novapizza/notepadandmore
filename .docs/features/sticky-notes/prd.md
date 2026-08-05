# Sticky Notes (Notes Sidebar Panel) - Overview

## 1. Description

NovaPad has no home for throwaway text. Users who need a scratchpad — a clipboard fragment in
transit, a snippet staged for pasting, a reminder about the file they're reading — open an
untitled tab and rely on `rememberUnsavedOnExit` to keep it across restarts. That works but
misuses the document model: the scratch text consumes a tab, reads as permanently dirty, and
raises a save prompt on quit.

This feature adds a **Notes** panel to the sidebar: a list of short, always-saved text notes that
persist across restarts and never behave like documents. Notes are reachable from the SideNav or
`Ctrl/Cmd+Shift+N`, are stored as plain text in a single `notes.json`, and bridge to the editor
in three directions — send a selection to a note, insert a note at the cursor, or graduate a note
into a real tab.

> See [Brainstorm Notes](./raw/notes.md) for decision rationale, the surface trade-off
> (panel vs. tab vs. floating window), and architecture sketch.

---

## 2. Features

| ID | Feature | Priority | Stories | Description |
|----|---------|----------|---------|-------------|
| F1 | Notes store & persistence | Must Have | US-001, US-002 | Zustand `notesStore` backed by `notes.json` in `userData/config/`. Debounced, **atomic** writes. Loaded once at launch. |
| F2 | Notes sidebar panel | Must Have | US-003, US-004 | `'notes'` added to `sidebarPanel`; SideNav entry with `StickyNote` icon; panel renders a filterable list of notes with an inline editor. |
| F3 | Keyboard toggle `Mod+Shift+N` | Must Have | US-005 | Native accelerator + capture-phase renderer handler. Opens Notes; collapses the sidebar if Notes is already active. |
| F4 | Create / edit / delete / pin | Must Have | US-006, US-007, US-008 | New note, inline edit with autosave, delete with confirm, pin to top. Title derives from the first line unless set explicitly. |
| F5 | Send Selection to Note | Must Have | US-009 | Editor context-menu action creating a note from the current selection, carrying the buffer's language. |
| F6 | Insert Note at Cursor | Must Have | US-010 | Per-note action inserting the note body into the active buffer at the cursor / over the selection. |
| F7 | Open Note as Tab | Must Have | US-011 | Per-note action opening the body as a new untitled buffer using the note's language. The note is retained. |
| F8 | Filter notes | Should Have | US-012 | Text input filtering by title and body, case-insensitive substring. |
| F9 | Colour tint | Should Have | US-013 | Six preset theme-resolved tints for visual grouping. No custom picker. |
| F10 | Session restore of panel selection | Must Have | US-014 | Notes survives as the remembered sidebar panel across restarts — requires fixing the existing `SessionManager` allowlist drift. |
| F11 | Shortcut catalog entry | Must Have | US-015 | `view.notes` registered in `SHORTCUT_CATALOG` so it appears in Settings ▸ Keyboard Shortcuts and in menu accelerator text. |

---

## 3. User Stories

### Actors

| Actor | Description |
|-------|-------------|
| User | Anyone using NovaPad to edit files, on any platform (macOS, Windows, Linux) |

### Stories

#### US-001: Notes survive a restart without ever being "saved"
> **As a** User, **I want** my notes to still be there after quitting and reopening NovaPad, **so that** I can use them as a scratchpad without naming or saving files.

**Acceptance Criteria:**
- [ ] Notes are written to `userData/config/notes.json` within 1s of the last keystroke
- [ ] All notes, their titles, colours, pin state, and order are restored on next launch
- [ ] Notes never appear as tabs, never show a dirty indicator, and never raise a save prompt
- [ ] Quitting with unsaved *documents* prompts as before; notes are not part of that prompt
- [ ] A missing or corrupt `notes.json` yields an empty notes list, never a crash or a blocked launch

#### US-002: A crash never truncates my notes
> **As a** User, **I want** note writes to be atomic, **so that** a crash or power loss mid-write cannot destroy every note I have.

**Acceptance Criteria:**
- [ ] `config:write-raw` writes to a temp file in the same directory, then renames over the target
- [ ] A failed write leaves the previous file contents intact
- [ ] `config.json` benefits from the same change (shared handler) with no behavioural regression

#### US-003: User opens Notes from the SideNav
> **As a** User, **I want** a Notes icon in the activity bar, **so that** the panel is discoverable without knowing a shortcut.

**Acceptance Criteria:**
- [ ] A `StickyNote` icon appears in the SideNav below the existing five entries
- [ ] Its tooltip reads `Notes (Ctrl+Shift+N)` — using the platform modifier and honouring any rebind
- [ ] Clicking it opens the sidebar with the Notes panel active
- [ ] Clicking it while Notes is already the active panel collapses the sidebar (matching Files / Symbols / Map)
- [ ] The icon shows the active-state styling (accent text + left accent border) when Notes is showing

#### US-004: The panel header matches the other sidebar panels
> **As a** User, **I want** Notes to look like the rest of the sidebar, **so that** it doesn't feel bolted on.

**Acceptance Criteria:**
- [ ] The panel header shows the title `NOTES` in the same uppercase/tracking style as other panels
- [ ] The header's ✕ button collapses the sidebar
- [ ] The panel fills the sidebar height and scrolls internally without the sidebar itself scrolling

#### US-005: User toggles Notes from the keyboard
> **As a** User, **I want** `Ctrl/Cmd+Shift+N` to toggle Notes, **so that** I can jot something down without leaving the keyboard.

**Acceptance Criteria:**
- [ ] `Mod+Shift+N` opens the sidebar with Notes active from anywhere in the app
- [ ] It works while the Monaco editor has focus (capture-phase handler, as with Quick Open and the AI panel)
- [ ] Pressing it while Notes is already active collapses the sidebar
- [ ] It works on the Welcome screen and on virtual tabs (Settings, What's New)
- [ ] A *View ▸ Notes* menu entry exists showing the same accelerator
- [ ] The binding does not shadow any existing command

#### US-006: User creates a note
> **As a** User, **I want** to add a note in one click, **so that** capturing a fragment is faster than opening a tab.

**Acceptance Criteria:**
- [ ] A `+ New` action in the panel header creates an empty note at the top of the list
- [ ] The new note opens in edit mode with the cursor in the body, ready to type
- [ ] An empty note that loses focus without any text entered is discarded rather than persisted

#### US-007: User edits a note with no save step
> **As a** User, **I want** my typing to be kept automatically, **so that** I never think about saving a note.

**Acceptance Criteria:**
- [ ] Clicking a note expands it into an editable plain-text area inline in the panel
- [ ] Edits persist automatically (debounced ≤ 1s) with no Save button
- [ ] The note's title is the first non-empty line, truncated for display, unless a title was set explicitly
- [ ] `updatedAt` advances on edit and the list reflects the resulting order
- [ ] `Esc` collapses the note back to list view, keeping the text
- [ ] Tab characters can be typed into a note body without moving focus out of the textarea

#### US-008: User deletes and pins notes
> **As a** User, **I want** to remove notes I'm done with and keep important ones on top, **so that** the list stays useful.

**Acceptance Criteria:**
- [ ] Each note has an overflow (`⋯`) menu with Delete and Pin / Unpin
- [ ] Delete asks for confirmation via the **native** dialog path (never `window.confirm`)
- [ ] Pinned notes sort above unpinned ones; within each group, most-recently-updated first
- [ ] Pin state persists across restarts

#### US-009: User sends a selection to a note
> **As a** User, **I want** to push selected editor text into a new note, **so that** I can park a fragment without a scratch file.

**Acceptance Criteria:**
- [ ] The editor context menu offers *Send Selection to Note*, enabled only with a non-empty selection
- [ ] Invoking it creates a note containing the selected text, tagged with the buffer's language
- [ ] The sidebar opens on Notes with the new note visible
- [ ] The document is not modified
- [ ] A selection larger than the note size cap is refused with a toast, not silently truncated

#### US-010: User inserts a note into the document
> **As a** User, **I want** to drop a note's text at my cursor, **so that** staged snippets are one click from the document.

**Acceptance Criteria:**
- [ ] Each note offers *Insert at Cursor*
- [ ] The body is inserted at the cursor, replacing the selection if one exists
- [ ] The insert is a single undo step (`Ctrl+Z` reverts it entirely)
- [ ] The action is disabled when no file buffer is active, or when the active buffer is read-only
- [ ] Editor focus returns to the document after inserting

#### US-011: User graduates a note into a tab
> **As a** User, **I want** to open a note as a real document, **so that** a note that outgrew the panel can become a file.

**Acceptance Criteria:**
- [ ] Each note offers *Open as Tab*
- [ ] A new untitled buffer opens containing the note body, with the note's language applied
- [ ] The note remains in the panel (the tab is a snapshot; the two do not stay in sync)
- [ ] The new buffer behaves like any untitled buffer — dirty, saveable via Save As

#### US-012: User filters notes
> **As a** User, **I want** to search my notes, **so that** the panel stays usable past a couple of dozen.

**Acceptance Criteria:**
- [ ] A filter input at the top of the panel narrows the list as the user types
- [ ] Matching is case-insensitive substring over both title and body
- [ ] Clearing the filter restores the full list
- [ ] An empty result shows a "No matching notes" state

#### US-013: User tints a note
> **As a** User, **I want** to colour-code notes, **so that** I can group them at a glance.

**Acceptance Criteria:**
- [ ] The overflow menu offers six tints: Default, Yellow, Green, Blue, Pink, Purple
- [ ] Tints are resolved from theme tokens and remain legible in Dark, Light, and Solarized Light
- [ ] The tint persists across restarts
- [ ] Note text meets normal contrast expectations on every tint in every theme

#### US-014: Notes is remembered as the active panel
> **As a** User, **I want** the sidebar to reopen on Notes if that's where I left it, **so that** my layout survives restarts.

**Acceptance Criteria:**
- [ ] With Notes active at quit, the next launch restores the sidebar to Notes
- [ ] `SessionManager`'s panel allowlist accepts every value `uiStore.sidebarPanel` can hold
- [ ] The pre-existing regression is fixed as part of this: `functions` and `docmap` also restore correctly
- [ ] An unknown persisted panel value still falls back to `files` rather than crashing

#### US-015: The Notes shortcut is listed and rebindable-in-principle
> **As a** User, **I want** the Notes command to appear in Settings ▸ Keyboard Shortcuts, **so that** it's discoverable alongside every other command.

**Acceptance Criteria:**
- [ ] `view.notes` is registered in `SHORTCUT_CATALOG` under the `View` section with `defaultKey: 'Mod+Shift+N'`
- [ ] It appears in the Settings shortcuts list and is matched by the search filter
- [ ] Its accelerator text renders correctly on macOS (`⇧⌘N`) and Windows/Linux (`Ctrl+Shift+N`)
- [ ] It inherits the same known limitation as every other catalog entry — rebinding is saved and displayed but not yet applied at runtime (see Assumptions)

---

## 4. Business Rules

| ID | Rule | Description |
|----|------|-------------|
| BR-001 | Notes are never documents | Notes have no dirty state, never occupy a tab, never appear in Save All / Close All, and never block quit. The only crossing point is *Open as Tab*, which creates an ordinary untitled buffer. |
| BR-002 | One persistence owner | Notes live solely in `notes.json` via `notesStore`. They must not be routed through `BackupManager`, the snapshot timer, or `SessionManager`'s buffer list. |
| BR-003 | Writes are atomic | Note persistence writes temp-then-rename. A partial write must never be observable. |
| BR-004 | Notes are plaintext, and we say so | `notes.json` is unencrypted. The panel's empty state or Settings copy must state where notes are stored. No API key or credential is ever written there. |
| BR-005 | Panel toggle parity | Notes obeys the same SideNav toggle contract as Files / Symbols / Map: re-activating the current panel collapses the sidebar. |
| BR-006 | Native dialogs only | Note deletion confirms via the main-process native dialog path. `window.confirm` / `alert` are forbidden — they previously froze the renderer's render scheduler (fixed in 1.6.0). |
| BR-007 | Editor access via `editorRegistry` | Insert-at-cursor and send-to-note use `editorRegistry`, as `AiChatPanel` does. No new IPC channels and no new `editor:command` verbs. |
| BR-008 | Soft size cap | Warn past ~500 notes or ~5 MB total `notes.json`; do not block. Single-note bodies over the cap are refused at the point of creation with a toast. |
| BR-009 | Notes are global | Notes are not scoped to `workspaceFolder`. Switching or closing a workspace does not change the notes list. |
| BR-010 | Empty notes are not persisted | A note with an empty body and no title is dropped on blur rather than saved. |

---

## 5. Dependencies

### Upstream (Required by this feature)

| Dependency | Purpose |
|------------|---------|
| `config:read-raw` / `config:write-raw` ([`configHandlers.ts`](../../../src/main/ipc/configHandlers.ts)) | Generic JSON persistence for `notes.json`. `write-raw` gains atomic semantics as part of this work. |
| Zustand + the `configStore` debounce pattern | Store shape and save-debounce precedent |
| [`uiStore`](../../../src/renderer/src/store/uiStore.ts) `sidebarPanel` / `showSidebar` | Panel selection and visibility |
| [`SideNav`](../../../src/renderer/src/components/SideNav/SideNav.tsx) / [`Sidebar`](../../../src/renderer/src/components/Sidebar/Sidebar.tsx) | Host surfaces — both carry a local `SidebarPanelId` union that must be extended |
| [`editorRegistry`](../../../src/renderer/src/utils/editorRegistry.ts) | Reading the selection and inserting text |
| [`editorStore.addBuffer`](../../../src/renderer/src/store/editorStore.ts) | *Open as Tab* |
| [`SessionManager`](../../../src/main/sessions/SessionManager.ts) | Persisting the active sidebar panel |
| [`shortcutCatalog`](../../../src/renderer/src/utils/shortcutCatalog.ts) | Registering `view.notes` and rendering its accelerator |
| `EditorContextMenu` + `menu.ts` | *Send Selection to Note* and *View ▸ Notes* |
| `sonner` toasts | Size-cap and failed-write feedback |

### Downstream (Features that depend on this)

| Feature | Impact |
|---------|--------|
| Future command palette | Notes commands (new note, toggle panel, insert) become palette entries once a command registry exists |
| Future detachable notes window | The store and panel component are the reusable half; only the window shell would be new |
| Future snippets feature | Notes is the informal ancestor — a pinned, language-tagged note is a snippet without the trigger mechanics |

---

## 6. Out of Scope

- Freeform drag-to-position canvas or board layout
- Rich text, Markdown rendering, checklists, images, attachments
- Reminders, due dates, or notifications
- Sync, sharing, or cloud storage of any kind
- Encryption of `notes.json` (deliberate — see BR-004)
- Export to file (*Open as Tab* + Save As is the escape hatch)
- A Monaco instance per note
- Notes appearing in Find in Files results
- Workspace-scoped notes
- Detached always-on-top notes window (v2 candidate)
- Wiring runtime rebinding for `view.notes` — that's the separate command-registry work

---

## 7. Assumptions

- The existing generic `config:*-raw` IPC is sufficient; no notes-specific IPC channel is needed,
  so the preload allowlist is unchanged.
- `notes.json` read whole at launch is fine at the intended scale (hundreds of short notes); the
  soft cap in BR-008 exists to keep that true.
- A plain `<textarea>` is adequate for note bodies. Users needing editor features use *Open as Tab*.
- Rebinding `view.notes` will not take effect at runtime, because **no** catalog entry does — the
  Shortcuts editor currently saves and displays overrides without applying them
  ([`ShortcutsSection.tsx:18-22`](../../../src/renderer/src/components/SettingsTab/ShortcutsSection.tsx)).
  Notes inherits that limitation rather than working around it; fixing it is the command-registry
  refactor's job.
- The three colour themes shipping today (Dark, Light, Solarized Light) are the full set the tints
  must satisfy.

---

## 8. Glossary

| Term | Definition |
|------|------------|
| Note | A titled plain-text fragment persisted in `notes.json`. Not a buffer, not a file. |
| Notes panel | The sidebar panel rendering the notes list and inline editor |
| Sidebar panel | One of the mutually exclusive views hosted by `Sidebar.tsx`, selected by `uiStore.sidebarPanel` |
| SideNav | The 48px activity bar on the far left holding panel icons |
| Graduate | Promote a note into an ordinary untitled editor buffer via *Open as Tab* |
| Tint | A flat preset background colour applied to a note card, resolved from theme tokens |
| Atomic write | Write to a temp file, then rename over the destination, so readers never see a partial file |
