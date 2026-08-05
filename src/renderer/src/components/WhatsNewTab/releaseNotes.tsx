import type { ReactNode } from 'react'
import { PreviewButtonsDemo } from './PreviewButtonsDemo'

/**
 * Per-version "What's New" content map.
 *
 * Each release gets its own entry here. The WhatsNewTab looks up the running
 * app version (window.api.app.getVersion()) and renders the matching entry —
 * so shipping new notes is just adding an object to the TOP of RELEASE_NOTES,
 * no component edits required.
 *
 * IMPORTANT — add a new entry for every release. Bodies are ReactNode, so use
 * JSX freely (bold lead-ins, <span className="font-mono"> for sizes/paths,
 * links, etc.). Keep the array sorted newest-first; getReleaseNote() treats
 * RELEASE_NOTES[0] as the latest.
 */

export interface ReleaseHighlight {
  /** Bold lead-in label, rendered with a trailing colon. */
  title: string
  /** Free-form description. JSX allowed. */
  body: ReactNode
}

export interface ReleaseNote {
  /** Must match the value app.getVersion() reports for this release. */
  version: string
  /** One-paragraph intro shown above the highlight list. */
  summary: ReactNode
  highlights: ReleaseHighlight[]
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '1.6.5',
    summary: (
      <>
        A <strong>command palette</strong> that searches everything NovaPad can do, a Keyboard Shortcuts
        editor that finally applies your rebinds, and <strong>Sticky Notes</strong> — a scratchpad that
        never becomes a tab.
      </>
    ),
    highlights: [
      {
        title: 'Command palette — one search box for every command',
        body: (
          <>
            Press <span className="font-mono text-sm">Ctrl/Cmd+Shift+P</span> and start typing. Around 150
            commands — every menu entry, all nine developer tools, each colour theme, every Settings
            category, and anything your plugins contribute — are fuzzy-searchable by name, section or
            related words, so <span className="font-mono text-sm">enc</span> finds{' '}
            <em>Encode in UTF-8</em> and <span className="font-mono text-sm">color</span> finds both the
            Color Converter and the colour themes. Each row shows the command&apos;s shortcut, so the palette
            doubles as the fastest way to learn them. Commands you can&apos;t run right now — editor
            operations with no file open, workspace searches with no folder open — are simply left out.
            <br />
            <br />
            <strong>Heads up — this moves a shortcut.</strong>{' '}
            <span className="font-mono text-sm">Ctrl/Cmd+Shift+P</span> used to open <em>Go to File</em>,
            which now lives on <span className="font-mono text-sm">Ctrl/Cmd+E</span>. Both share one
            overlay: delete the leading <span className="font-mono text-sm">&gt;</span> to search files
            instead of commands, and type it back to return.{' '}
            <span className="font-mono text-sm">Ctrl/Cmd+P</span> still toggles Preview.
          </>
        )
      },
      {
        title: 'Keyboard Shortcuts now actually rebind',
        body: (
          <>
            <strong>Settings ▸ Keyboard Shortcuts</strong> saved your changes and showed them in the menus,
            but nothing applied them — you pressed the new key and nothing happened while the old one kept
            working. Every shortcut now resolves through a single handler that reads your overrides, so a
            rebind takes effect the moment you record it, with no restart. Two commands sharing a key warn
            each other and name the winner, and combos the operating system owns (
            <span className="font-mono text-sm">Ctrl+C</span>,{' '}
            <span className="font-mono text-sm">Ctrl+Z</span>,{' '}
            <span className="font-mono text-sm">F12</span>) are refused with a reason instead of silently
            accepted. The panel also covers far more of the app than the 46 commands it used to list.
          </>
        )
      },
      {
        title: 'Menu items that did nothing now work',
        body: (
          <>
            <em>Edit ▸ Indent Selection</em> and <em>Outdent Selection</em> were wired to a handler that did
            not exist — both menus offered them and nothing happened. Same for <em>Undo</em> and{' '}
            <em>Redo</em> on the Windows menu bar and the toolbar. <em>Begin/End Select</em> was greyed out
            in both menus despite being fully implemented. All of them work now.
          </>
        )
      },
      {
        title: 'Sticky Notes — a scratchpad that never becomes a tab',
        body: (
          <>
            Press <span className="font-mono text-sm">Ctrl/Cmd+Shift+N</span> (or use <strong>Tools ▸ Notes</strong>,
            or the new sticky-note icon at the right end of the toolbar) for a <strong>Notes</strong> view in
            the sidebar. It stacks <strong>below the File Explorer</strong> with a draggable divider instead of
            replacing it, so opening Notes never costs you the file tree. Notes save themselves
            as you type, survive a restart, and never occupy a tab, show a dirty dot, or prompt you on quit —
            so a clipboard fragment or a reminder no longer has to live in an untitled document.
            <br />
            <br />
            Notes bridge to the editor three ways: right-click a selection and pick{' '}
            <strong>Send Selection to Note</strong> to park it, <strong>Insert at Cursor</strong> to drop a note
            into the document (a single <span className="font-mono text-sm">Ctrl+Z</span> undoes it), and{' '}
            <strong>Open as Tab</strong> when a note outgrows the panel and should become a real file. You can
            pin notes to the top, tint them one of six colours, and filter by title or body.
            <br />
            <br />
            Notes are stored as <strong>plain, unencrypted text</strong> in{' '}
            <span className="font-mono text-sm">notes.json</span> in the app&apos;s config folder — treat them
            like a paper pad, not a password manager.
          </>
        )
      },
      {
        title: 'Sidebar and config-write fixes',
        body: (
          <>
            The sidebar now reopens on the panel you left it on. <em>Symbols</em> and <em>Map</em> previously
            fell back to <em>File Browser</em> after a restart. Settings and notes are also written
            <strong> atomically</strong> now (write-then-rename), so a crash or power loss mid-write can no
            longer leave a truncated <span className="font-mono text-sm">config.json</span>.
          </>
        )
      }
    ]
  },
  {
    version: '1.6.0',
    summary: (
      <>
        An optional <strong>AI assistant</strong> you can point at the open document — ask questions,
        transform text, or generate a regex — plus a fix for the editor freezing after a confirmation prompt.
      </>
    ),
    highlights: [
      {
        title: 'Ask Gemini about the open document',
        body: (
          <>
            Add a Google Gemini API key in <strong>Settings ▸ AI Assistant</strong> and a badge appears at the
            bottom-right of the editor. Click it for a chat panel docked beside your file: summarize it, explain
            a format, remove duplicate rows, sort or clean up text, convert between CSV and JSON, or have a regex
            built and dropped straight into Find &amp; Replace.
            <br />
            <br />
            Anything that <strong>rewrites text shows you a diff first</strong> — nothing changes your file until
            you press Apply, and Apply is a single{' '}
            <span className="font-mono text-sm">Ctrl+Z</span> away from being undone. The chat always shows exactly
            what is being sent before you send it. Your key is encrypted with your operating system&apos;s
            credential store, and the feature is <strong>off until you turn it on</strong>.
          </>
        )
      },
      {
        title: 'No more frozen editor after a confirmation prompt',
        body: (
          <>
            Confirmation prompts — closing an unsaved tab, quitting with unsaved changes, deleting a file,
            switching workspace, uninstalling a plugin — are now proper <strong>native dialogs</strong>.
            Previously, dismissing one could leave the editor unable to paint or accept keystrokes until you
            restarted the app. <em>Close All</em>, <em>Close Others</em> and <em>Save All</em> also ask about one
            file at a time now, instead of stacking every prompt on top of each other.
          </>
        )
      }
    ]
  },
  {
    version: '1.5.9',
    summary: (
      <>
        A quality pass on <strong>Find &amp; Replace</strong> — it no longer loses editor focus or hides
        behind other panels — plus an option to stop the editor from auto-enabling Word Wrap on long lines.
      </>
    ),
    highlights: [
      {
        title: 'Find & Replace focus and overlay fixes',
        body: (
          <>
            Closing the Find &amp; Replace dialog (<span className="font-mono text-sm">Esc</span> or the ✕ button)
            now returns focus to the editor, so you can keep typing right away. The dialog also no longer gets
            stuck <strong>behind</strong> other full-screen panels (About, Quick Open, Tools): opening one of
            these now closes the others, so Find &amp; Replace can't end up visible-but-unclickable.
          </>
        )
      },
      {
        title: 'Auto word wrap is now optional',
        body: (
          <>
            Beautifying or pasting content with very long lines still turns on <strong>Word Wrap</strong> for
            you by default. If you'd rather it never toggle Word Wrap on its own, uncheck{' '}
            <strong>Auto word wrap on long lines</strong> in{' '}
            <span className="font-mono text-sm">Settings ▸ Editor</span>.
          </>
        )
      }
    ]
  },
  {
    version: '1.5.8',
    summary: (
      <>
        A fresh look — new logo, app icon, and color theme — plus{' '}
        <span className="font-mono text-sm text-primary">novapad://</span> deeplinks (great for Slack)
        and VS Code-style preview buttons on the tab bar.
      </>
    ),
    highlights: [
      {
        title: 'New look — logo, icon & theme',
        body: (
          <>
            NovaPad has a new <strong>{'{ N }'}</strong> logo and app icon. Light mode keeps its familiar
            <strong> blue</strong> accent, while dark mode gets a <strong>Dracula</strong>-based palette
            (editor and chrome in one tone) with a <strong>violet</strong> accent. Pick a theme from the new
            picker (<span className="font-mono text-sm">Settings ▸ Appearance</span>, or the gear menu ▸{' '}
            <strong>Themes</strong>) — including a new <strong>Solarized Light</strong>.
          </>
        )
      },
      {
        title: 'Deeplinks (novapad://)',
        body: (
          <>
            Click a link in Slack, a browser, or an internal tool to open a file in NovaPad.
            <ul className="mt-3 space-y-2.5">
              <li>
                <span className="font-mono text-sm font-semibold text-primary">open</span>
                <span className="font-mono text-sm text-muted-foreground">?url=&lt;https&gt;&amp;line=N</span>
                <span className="text-muted-foreground"> — read-only tab</span>
              </li>
              <li>
                <span className="font-mono text-sm font-semibold text-primary">preview</span>
                <span className="font-mono text-sm text-muted-foreground">?url=&lt;https&gt;</span>
                <span className="text-muted-foreground"> — read-only + preview pane</span>
              </li>
              <li>
                <span className="font-mono text-sm font-semibold text-primary">new</span>
                <span className="font-mono text-sm text-muted-foreground">?title=…&amp;content=…</span>
                <span className="text-muted-foreground"> — new editable tab</span>
              </li>
            </ul>
            <div className="mt-3 rounded bg-secondary/40 p-3 font-mono text-sm break-all">
              <span className="text-primary">novapad://open</span>
              <span className="text-foreground">?url=https%3A%2F%2Fhost%2Freport.md&amp;line=42</span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              <span className="font-mono">https</span> only; unknown hosts ask before opening. Remote files
              open read-only (use <strong>Save&nbsp;As</strong> to edit locally).
            </p>
          </>
        )
      },
      {
        title: 'Preview buttons on the tab bar',
        body: (
          <>
            For previewable files (Markdown, JSON, CSV, SQL plan), two buttons sit next to{' '}
            <span className="font-mono text-sm">+</span>: <strong>Preview</strong> (replaces the editor in
            the tab) and <strong>Open Preview to the Side</strong> (<span className="font-mono text-sm">Ctrl/Cmd+P</span>).
            <PreviewButtonsDemo />
          </>
        )
      },
      {
        title: 'Whole-window zoom',
        body: (
          <>
            <span className="font-mono text-sm">Ctrl/Cmd</span> <span className="font-mono text-sm">+</span> /{' '}
            <span className="font-mono text-sm">-</span> / <span className="font-mono text-sm">0</span> now zoom the
            entire app (UI and editor) and work everywhere — even on the Welcome screen. The zoom level is
            remembered across launches.
          </>
        )
      }
    ]
  },
  {
    version: '1.5.7',
    summary: (
      <>
        Four editor staples land at once: a <strong>Function&nbsp;/&nbsp;Symbol List</strong> and{' '}
        <strong>Document Map</strong> in the sidebar, a real <strong>Split View</strong>, and{' '}
        <strong>Print / Export to PDF</strong> — plus one-click <strong>HTML / PDF</strong> export from the
        Markdown preview and <strong>JSON / JSON&nbsp;Schema</strong> export from the JSON preview.
      </>
    ),
    highlights: [
      {
        title: 'Function List & Document Map in the sidebar',
        body: (
          <>
            The activity bar gains two new panels: <strong>Symbols</strong> lists the functions, classes, and
            other symbols in the current file (click to jump), and <strong>Map</strong> shows a bird's-eye{' '}
            <strong>document map</strong> you can click to scroll. Both live next to the File Browser.
          </>
        )
      },
      {
        title: 'Split View',
        body: (
          <>
            Toggle <strong>Split View</strong> (<span className="font-mono text-sm">Ctrl+\</span>, or{' '}
            <span className="font-mono text-sm">View ▸ Split View</span>) to open a second editor beside the
            first. It mirrors the active document — edits in either side stay in sync, while scroll position and
            cursor are independent.
          </>
        )
      },
      {
        title: 'Print & Export to PDF',
        body: (
          <>
            <span className="font-mono text-sm">File ▸ Print…</span> (
            <span className="font-mono text-sm">Ctrl+Alt+P</span>) opens the system print dialog, and{' '}
            <span className="font-mono text-sm">File ▸ Export to PDF…</span> writes a clean, line-numbered PDF
            of the current document.
          </>
        )
      },
      {
        title: 'Export from preview panes',
        body: (
          <>
            The <strong>Markdown</strong> preview can now export the rendered document as{' '}
            <strong>HTML</strong> or <strong>PDF</strong>, and the <strong>JSON</strong> preview can export
            <strong> formatted JSON</strong> or an <strong>inferred JSON Schema</strong> — all from the pane
            header. (CSV export — all rows, filtered, or changed — already lives in the Table Lens preview.)
          </>
        )
      }
    ]
  },
  {
    version: '1.5.5',
    summary: (
      <>
        A small but welcome shortcut fix: <strong>Quick Open</strong> moves to{' '}
        <span className="font-mono text-sm">Ctrl+Shift+P</span>, and{' '}
        <span className="font-mono text-sm">Ctrl+P</span> goes back to opening <strong>Preview</strong> —
        the way it always worked.
      </>
    ),
    highlights: [
      {
        title: 'Quick Open & Preview shortcuts, sorted out',
        body: (
          <>
            <strong>Quick Open</strong> now lives on <span className="font-mono text-sm">Ctrl+Shift+P</span>{' '}
            (<span className="font-mono text-sm">⌘⇧P</span> on macOS), and{' '}
            <span className="font-mono text-sm">Ctrl+P</span> (<span className="font-mono text-sm">⌘P</span>)
            once again toggles <strong>Preview</strong> for Markdown, JSON, CSV, and SQL plans — restoring the
            long-standing shortcut that briefly moved in the previous release. Preview now works from{' '}
            <span className="font-mono text-sm">Ctrl+P</span> even while you're typing in the editor.
          </>
        )
      }
    ]
  },
  {
    version: '1.5.4',
    summary: (
      <>
        Find any file in a keystroke, rename and create right in the tree, and a round of
        under-the-hood <strong>security hardening</strong> — the File Browser gets a lot more capable
        and the app a lot more locked down.
      </>
    ),
    highlights: [
      {
        title: 'Quick Open files with Ctrl+P',
        body: (
          <>
            Press <span className="font-mono text-sm">Ctrl+P</span> (
            <span className="font-mono text-sm">⌘P</span> on macOS) to <strong>fuzzy-search every file</strong>{' '}
            in the open folder and jump straight to it — type a few characters, use{' '}
            <span className="font-mono text-sm">↑/↓</span> and <span className="font-mono text-sm">Enter</span>,
            just like VS Code — and it works <strong>anywhere</strong>, even while you're typing in the editor.
            Markdown/JSON <strong>Preview moves to <span className="font-mono text-sm">Ctrl+Shift+V</span></strong> (
            <span className="font-mono text-sm">⌘⇧V</span> on macOS), and the file-tree right-click menu has been
            reorganized so the actions you use most sit up top.
          </>
        )
      },
      {
        title: 'Rename & create files right in the tree',
        body: (
          <>
            <strong>Rename</strong>, <strong>New File…</strong> and <strong>New Folder…</strong> in the File Browser
            now edit <strong>inline</strong> — the row turns into a text box you confirm with{' '}
            <span className="font-mono text-sm">Enter</span> (or cancel with{' '}
            <span className="font-mono text-sm">Esc</span>), just like VS Code, instead of a pop-up prompt that
            never appeared. Renaming a file that's <strong>open in a tab</strong> now updates the tab in place —
            and no longer fires a misleading "deleted from disk" warning.
          </>
        )
      },
      {
        title: 'The File Browser remembers where you were',
        body: (
          <>
            The <strong>File Browser</strong> sidebar now restores across restarts: reopen the app and
            your folder is back, the sidebar reappears (or stays hidden) exactly as you left it, and the
            folders you had <strong>expanded stay expanded</strong> — no re-navigating the tree every launch.
          </>
        )
      },
      {
        title: 'Pasted long lines stay readable',
        body: (
          <>
            Pasting content with very long lines — like markdown copied from another app, where
            each paragraph is one unbroken line — now <strong>auto-enables Word Wrap</strong> so the
            text reflows to fit the window instead of scrolling off to the right. Toggle it any time
            with <span className="font-mono text-sm">Alt+Z</span>.
          </>
        )
      },
      {
        title: 'Language follows the file you saved',
        body: (
          <>
            Saving an untitled note as <span className="font-mono text-sm">.md</span> (or any typed
            extension) now <strong>switches syntax highlighting to match</strong> right away. Content
            auto-detection also stops <strong>downgrading a recognized file type to plain text</strong>
            {' '}— so markdown, CSV, and config files keep their highlighting on open and save.
          </>
        )
      },
      {
        title: 'Hardened & more secure',
        body: (
          <>
            A round of under-the-hood security work you'll never see but always benefit from: the app
            now ships with <strong>Electron security fuses</strong> enabled and{' '}
            <strong>asar integrity</strong> checks (so a tampered bundle won't run), runs every window
            in a <strong>fully sandboxed renderer</strong>, <strong>blocks unexpected navigation and
            new-window requests</strong>, and enforces a <strong>tightened Content-Security-Policy</strong>.
            Day to day nothing changes — the attack surface just got a lot smaller.
          </>
        )
      }
    ]
  },
  {
    version: '1.5.3',
    summary: (
      <>
        Logs and traces get first-class syntax highlighting — open any{' '}
        <span className="font-mono text-sm">.log</span> or{' '}
        <span className="font-mono text-sm">.trace</span> file and it reads at a glance.
      </>
    ),
    highlights: [
      {
        title: 'Syntax highlighting for logs & traces',
        body: (
          <>
            <span className="font-mono text-sm">.log</span> and{' '}
            <span className="font-mono text-sm">.trace</span> files (plus{' '}
            <span className="font-mono text-sm">.trc</span>/
            <span className="font-mono text-sm">.out</span>/
            <span className="font-mono text-sm">.err</span> and rotated names like{' '}
            <span className="font-mono text-sm">app.log.1</span>) now get real coloring. One
            format-agnostic highlighter lights up <strong>severity levels</strong> (error/warn/info
            by color), timestamps, durations, IP addresses, UUIDs &amp; trace IDs, HTTP methods,
            quoted strings, and <span className="font-mono text-sm">key: value</span> pairs — so app
            logs, access logs, syslog, and distributed traces all read at a glance.
          </>
        )
      }
    ]
  },
  {
    version: '1.5.2',
    summary: (
      <>
        Bookmarks come alive, the <span className="font-mono text-sm">Edit</span> and{' '}
        <span className="font-mono text-sm">View</span> menus gain handy new tools, and the{' '}
        <span className="font-mono text-sm">Window</span> menu finally works on Windows and Linux.
      </>
    ),
    highlights: [
      {
        title: 'Bookmarks are live',
        body: (
          <>
            The bookmark items in the <strong>Search</strong> menu are now enabled. Drop a marker in
            the gutter with <span className="font-mono text-sm">Ctrl+F2</span>, jump between marks
            with <span className="font-mono text-sm">F2</span> /{' '}
            <span className="font-mono text-sm">Shift+F2</span>, and clear them all in one go.
          </>
        )
      },
      {
        title: 'Copy path & Insert date/time',
        body: (
          <>
            New <strong>Edit ▸ Copy to Clipboard</strong> entries copy the current document&apos;s
            full path, file name, or containing directory. <strong>Edit ▸ Insert</strong> drops a
            short or long timestamp at the caret.
          </>
        )
      },
      {
        title: 'Code folding from the menu',
        body: (
          <>
            A new <strong>View ▸ Folding</strong> submenu adds <strong>Fold All</strong>,{' '}
            <strong>Unfold All</strong>, and <strong>Collapse Level 1–7</strong> for quickly
            outlining a large file.
          </>
        )
      },
      {
        title: 'Window menu fixed on Windows & Linux',
        body: (
          <>
            <strong>Window ▸ Minimize</strong> and <strong>Window ▸ Zoom</strong> now work on
            Windows and Linux, not just macOS.
          </>
        )
      }
    ]
  },
  {
    version: '1.5.1',
    summary: (
      <>
        A new <span className="font-mono text-sm">Encoding</span> menu lands in the menu bar, and the
        non-functional <span className="font-mono text-sm">Macro</span> menu is gone — a smaller,
        cleaner top bar.
      </>
    ),
    highlights: [
      {
        title: 'New Encoding menu',
        body: (
          <>
            A dedicated <span className="font-mono text-sm">Encoding</span> menu joins the menu bar.
            Set the active document&apos;s encoding —{' '}
            <span className="font-mono text-sm">UTF-8</span>,{' '}
            <span className="font-mono text-sm">UTF-8 with BOM</span>,{' '}
            <span className="font-mono text-sm">UTF-16 LE/BE</span>,{' '}
            <span className="font-mono text-sm">Windows-1252</span>, or{' '}
            <span className="font-mono text-sm">ISO-8859-1</span> — and convert line endings between{' '}
            <strong>Windows (CRLF)</strong>, <strong>Unix (LF)</strong>, and{' '}
            <strong>Macintosh (CR)</strong>, all from the menu. It stays in sync with the
            click-to-change encoding and EOL controls in the status bar.
          </>
        )
      },
      {
        title: 'Menu bar cleanup',
        body: (
          <>
            Removed the <span className="font-mono text-sm">Macro</span> menu, which was a
            non-functional placeholder. Macro recording was never wired up, so the menu only ever
            showed disabled entries — it&apos;s gone until the feature actually ships.
          </>
        )
      }
    ]
  },
  {
    version: '1.5.0',
    summary: (
      <>
        Search leveled up. The Find Results panel now behaves like VSCode&apos;s search tree —
        keyboard navigation, inline file actions, and Notepad++-style line copying — and every
        search mode picks up the text you have selected.
      </>
    ),
    highlights: [
      {
        title: 'Copy from Find Results',
        body: (
          <>
            Select result lines in the Find Results panel — click,{' '}
            <span className="font-mono text-sm">Ctrl/⌘+Click</span> to toggle,{' '}
            <span className="font-mono text-sm">Shift+Click</span> for a range — and copy their full
            line text with <span className="font-mono text-sm">Ctrl/⌘+C</span>, or right-click for{' '}
            <strong>Copy Selected</strong>, <strong>Copy All</strong>, and{' '}
            <strong>Select All</strong>, just like Notepad++.
          </>
        )
      },
      {
        title: 'Search shortcuts respect your selection',
        body: (
          <>
            The selected text now prefills the search field for{' '}
            <span className="font-mono text-sm">Find in Files</span> (
            <span className="font-mono text-sm">Ctrl/⌘+Shift+F</span>) and when switching modes
            while the dialog is already open — not just for Find. Plus a new{' '}
            <span className="font-mono text-sm">Search → Mark...</span> menu entry (
            <span className="font-mono text-sm">Ctrl+M</span> on Windows/Linux) opens the Mark tab
            directly.
          </>
        )
      },
      {
        title: 'Find Results panel, VSCode style',
        body: (
          <>
            Navigate results with the <span className="font-mono text-sm">arrow keys</span> — ↑/↓
            move through rows, ←/→ collapse/expand file groups, <span className="font-mono text-sm">Enter</span>{' '}
            opens the hit. Hover a file header for inline <strong>Open file</strong> and{' '}
            <strong>Dismiss</strong> actions, and the right-click menu gained{' '}
            <strong>Copy Path</strong>, <strong>Open File</strong>, and <strong>Dismiss</strong>.
          </>
        )
      }
    ]
  },
  {
    version: '1.4.0',
    summary: (
      <>
        A new <span className="font-mono text-sm">Tools</span> menu turns NovaPad into a handy
        developer toolbox — hashing plus a set of everyday encoders, converters, and generators,
        all without leaving the editor.
      </>
    ),
    highlights: [
      {
        title: 'New Tools menu',
        body: (
          <>
            A built-in developer toolbox: <span className="font-mono text-sm">MD5</span> /
            <span className="font-mono text-sm"> SHA-1</span> /
            <span className="font-mono text-sm"> SHA-256</span> /
            <span className="font-mono text-sm"> SHA-512</span> hashing (of typed text, picked
            files, or the current selection straight to the clipboard), plus a unified panel with a
            UUID/ULID generator, epoch &amp; color converters, a cron builder, a Lorem Ipsum
            generator, and JWT / URL / CSP utilities. Find it under <span className="font-mono text-sm">Tools</span>.
          </>
        )
      }
    ]
  },
  {
    version: '1.3.0',
    summary: (
      <>
        A big maintenance and polish drop. The installer is dramatically smaller, your unsaved
        scratch tabs survive a crash, file associations actually work, and the plugin system grew
        up. Less ceremony, more editing.
      </>
    ),
    highlights: [
      {
        title: 'Slimmer installer',
        body: (
          <>
            A round of bundle-excludes (TensorFlow, Monaco, Magika, and friends) shrank both
            builds — the Windows NSIS dropped from
            <span className="font-mono text-sm"> 254&nbsp;MB</span> to
            <span className="font-mono text-sm"> 93&nbsp;MB</span> (-63%), and the macOS dmg
            slimmed down by the same cuts. Your bandwidth and your SSD both said thanks.
          </>
        )
      },
      {
        title: 'Notepad++-style snapshot & restore',
        body: (
          <>
            Unsaved buffers are persisted to disk and brought back exactly as you left them after a
            relaunch — even untitled scratch tabs, even after a crash.
          </>
        )
      },
      {
        title: 'File associations & Open With',
        body: (
          <>
            Register the app as a handler for common text formats. Windows "Open with / Edit with"
            and macOS "Open With → NovaPad" both surface NovaPad in the OS file menu.
          </>
        )
      },
      {
        title: 'Auto-update',
        body: (
          <>
            Built on electron-updater — new versions land in the background and prompt you to
            restart, no more manual installer hunts.
          </>
        )
      },
      {
        title: 'Plugin Manager, redesigned',
        body: (
          <>
            Plugins now live in a full VS&nbsp;Code-style page (not a tiny dialog), with a dedicated
            detail view per plugin.
          </>
        )
      },
      {
        title: 'Smarter file detection',
        body: (
          <>
            Google's Magika ML model identifies file types by content, not extension — so a
            mislabeled
            <span className="font-mono text-sm"> .txt</span> still gets the right syntax
            highlighting.
          </>
        )
      },
      {
        title: 'TableLens CSV viewer',
        body: (
          <>
            Open a<span className="font-mono text-sm"> .csv</span> and get a real table view with
            sorting and column sizing — no more squinting at commas.
          </>
        )
      },
      {
        title: 'Beautify everywhere',
        body: (
          <>
            Format JSON, SQL, and XML alongside the existing formatters. Paste detection now figures
            out the language for you.
          </>
        )
      },
      {
        title: 'Quality of life',
        body: (
          <>
            Full file path in the status bar, double-click the tab strip to open a new document, and
            a pile of dialog and session-restore fixes you'll only notice because nothing breaks.
          </>
        )
      }
    ]
  }
]

/**
 * Resolve the release note to display for a given app version.
 *
 * Exact version match first. When there's no entry for the running version
 * (a release that forgot to add notes, or test mode where getVersion() returns
 * the Electron binary version), fall back to the newest entry so the tab is
 * never blank. Returns undefined only if the map is empty.
 */
export function getReleaseNote(version: string): ReleaseNote | undefined {
  if (RELEASE_NOTES.length === 0) return undefined
  return RELEASE_NOTES.find((note) => note.version === version) ?? RELEASE_NOTES[0]
}
