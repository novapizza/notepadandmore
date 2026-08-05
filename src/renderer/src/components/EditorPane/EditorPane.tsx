import React, { useRef, useEffect, useCallback, useState } from 'react'
import * as monaco from 'monaco-editor'
import { useEditorStore, EOLType } from '../../store/editorStore'
import { useUIStore } from '../../store/uiStore'
import { useConfigStore } from '../../store/configStore'
import { useNavigationStore } from '../../store/navigationStore'
import { editorRegistry } from '../../utils/editorRegistry'
import { useBookmarks } from '../../hooks/useBookmarks'
import { useFileOps } from '../../hooks/useFileOps'
import { refineLanguageAsync, sampleFromString } from '../../utils/refineLanguage'
import { beautify, detectBeautifyFormat } from '../../utils/beautify'
import { registerNppThemes } from '../../utils/monacoThemes'
import { monacoThemeFor } from '../../utils/themes'
import { registerLogLanguage } from '../../utils/logLanguage'
import { EditorContextMenu } from './EditorContextMenu'

registerLogLanguage()
registerNppThemes()

/** Same-buffer cursor moves below this line-delta do not push a navigation entry (spec BR-005). */
const NAV_LINE_THRESHOLD = 10

/**
 * Inject the CSS for the Begin/End-Select anchor marker once. The marker
 * combines a glyph-margin icon, an overview-ruler tick, and a thin vertical
 * bar at the exact column (rendered via a zero-width ::before pseudo-element
 * so it doesn't shift the surrounding text).
 */
let _anchorStylesInjected = false
function injectAnchorStyles(): void {
  if (_anchorStylesInjected) return
  _anchorStylesInjected = true
  const style = document.createElement('style')
  style.textContent = `
    .nmp-anchor-glyph::before {
      content: '◆';
      color: #f59e0b;
      font-size: 11px;
      line-height: 1;
    }
    .nmp-anchor-bar::before {
      content: '';
      display: inline-block;
      width: 0;
      height: 1.2em;
      border-left: 2px solid #f59e0b;
      margin-right: -2px;
      vertical-align: text-bottom;
      pointer-events: none;
    }
  `
  document.head.appendChild(style)
}

interface EditorPaneProps {
  activeId?: string | null
}

export const EditorPane: React.FC<EditorPaneProps> = ({ activeId }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const { updateBuffer, getBuffer } = useEditorStore()
  const activeBufLoaded = useEditorStore((s) => s.buffers.find((b) => b.id === activeId)?.loaded)
  const activeBufIsLarge = useEditorStore((s) => s.buffers.find((b) => b.id === activeId)?.isLargeFile)
  const activeBufIsReadOnly = useEditorStore((s) => s.buffers.find((b) => b.id === activeId)?.isReadOnly ?? false)
  const { theme } = useUIStore()
  const { loadBuffer } = useFileOps()
  const currentIdRef = useRef<string | null>(null)
  /** Last cursor line recorded into the navigation history for the active buffer. */
  const lastRecordedLineRef = useRef<number>(1)
  /**
   * Pending Begin/End-Select anchor (Notepad++ port). First invoke saves the
   * caret as a zero-width Monaco decoration — letting Monaco track it across
   * edits — and the second invoke turns the anchor→caret range into a
   * stream or column (rectangular) selection.
   */
  const beginEndAnchorRef = useRef<{ decorationId: string; isColumn: boolean; modelUri: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingSize, setLoadingSize] = useState<number | null>(null)
  const [missingFile, setMissingFile] = useState<string | null>(null)

  const { toggleBookmark, nextBookmark, prevBookmark, clearBookmarks, restoreDecorations } = useBookmarks()

  // Extracted command dispatch — shared by menu IPC and CustomEvent listeners.
  const dispatchCommand = useCallback((command: string) => {
    const editor = editorRef.current
    if (!editor) return

    // Fold to a specific nesting depth (View ▸ Folding ▸ Collapse Level N).
    // Monaco exposes editor.foldLevel1 … editor.foldLevel7; map the command
    // straight onto the action id rather than listing seven near-identical cases.
    if (/^foldLevel[1-7]$/.test(command)) {
      editor.getAction(`editor.${command}`)?.run()
      return
    }

    switch (command) {
      case 'duplicateLine':
        editor.getAction('editor.action.copyLinesDownAction')?.run()
        break
      case 'deleteLine':
        editor.getAction('editor.action.deleteLines')?.run()
        break
      case 'moveLineUp':
        editor.getAction('editor.action.moveLinesUpAction')?.run()
        break
      case 'moveLineDown':
        editor.getAction('editor.action.moveLinesDownAction')?.run()
        break
      case 'toUpperCase':
        editor.getAction('editor.action.transformToUppercase')?.run()
        break
      case 'toLowerCase':
        editor.getAction('editor.action.transformToLowercase')?.run()
        break
      case 'toTitleCase':
        editor.getAction('editor.action.transformToTitlecase')?.run()
        break
      case 'toggleComment':
        editor.getAction('editor.action.commentLine')?.run()
        break
      case 'toggleBlockComment':
        editor.getAction('editor.action.blockComment')?.run()
        break
      case 'trimTrailingWhitespace':
        editor.getAction('editor.action.trimTrailingWhitespace')?.run()
        break
      // Tab / Shift+Tab already indent a selection natively; these exist so the
      // menu and palette entries reach the same Monaco actions. The keyboard
      // dispatcher deliberately never claims bare Tab (see commands/useCommandKeys).
      case 'indentSelection':
        editor.trigger('command', 'editor.action.indentLines', null)
        break
      case 'outdentSelection':
        editor.trigger('command', 'editor.action.outdentLines', null)
        break
      // Undo / Redo reach Monaco's own history. The native menu uses OS roles for
      // these; the custom MenuBar and Toolbar route here instead, since a role's
      // accelerator is the only part of it that works on a hidden Windows menu.
      case 'undo':
        editor.trigger('command', 'undo', null)
        break
      case 'redo':
        editor.trigger('command', 'redo', null)
        break
      case 'goToLine':
        editor.getAction('editor.action.gotoLine')?.run()
        break
      // zoomIn/zoomOut/zoomReset are handled globally in App.tsx (whole-window
      // zoom via webFrame) so they work even without an active editor.
      case 'sortLinesAsc':
        editor.getAction('editor.action.sortLinesAscending')?.run()
        break
      case 'sortLinesDesc':
        editor.getAction('editor.action.sortLinesDescending')?.run()
        break
      case 'toggleBookmark': {
        const id = currentIdRef.current
        if (!id) break
        const lineNumber = editor.getPosition()?.lineNumber ?? 1
        toggleBookmark(id, lineNumber)
        break
      }
      case 'nextBookmark': {
        const id = currentIdRef.current
        if (!id) break
        const currentLine = editor.getPosition()?.lineNumber ?? 1
        const line = nextBookmark(id, currentLine)
        if (line != null) {
          editor.revealLineInCenter(line)
          editor.setPosition({ lineNumber: line, column: 1 })
          editor.focus()
        }
        break
      }
      case 'prevBookmark': {
        const id = currentIdRef.current
        if (!id) break
        const currentLine = editor.getPosition()?.lineNumber ?? 1
        const line = prevBookmark(id, currentLine)
        if (line != null) {
          editor.revealLineInCenter(line)
          editor.setPosition({ lineNumber: line, column: 1 })
          editor.focus()
        }
        break
      }
      case 'clearBookmarks': {
        const id = currentIdRef.current
        if (id) clearBookmarks(id)
        break
      }
      case 'copyFullPath':
      case 'copyFileName':
      case 'copyDirPath': {
        // Edit ▸ Copy to Clipboard — full path / file name / containing dir of
        // the active buffer. File name falls back to the tab title so untitled
        // buffers still copy something sensible; the other two need a saved path.
        const id = currentIdRef.current
        const buf = id ? useEditorStore.getState().getBuffer(id) : null
        const fp = buf?.filePath ?? null
        let value: string | null = null
        if (command === 'copyFileName') {
          value = fp ? (fp.split(/[/\\]/).pop() ?? fp) : (buf?.title ?? null)
        } else if (fp) {
          if (command === 'copyFullPath') {
            value = fp
          } else {
            const idx = Math.max(fp.lastIndexOf('/'), fp.lastIndexOf('\\'))
            value = idx > 0 ? fp.slice(0, idx) : fp
          }
        }
        if (!value) {
          useUIStore.getState().addToast('Save the document first — it has no path on disk yet.', 'warn')
          break
        }
        void navigator.clipboard.writeText(value)
        const what =
          command === 'copyFullPath' ? 'Full path' : command === 'copyFileName' ? 'File name' : 'Directory path'
        useUIStore.getState().addToast(`${what} copied to clipboard.`, 'info')
        break
      }
      case 'insertDateTimeShort':
      case 'insertDateTimeLong': {
        // Edit ▸ Insert ▸ Date & Time — write a locale-formatted timestamp at
        // the caret (replacing any selection). Short = numeric date + time;
        // long = full weekday/date + seconds.
        const sel = editor.getSelection()
        if (!sel) break
        const now = new Date()
        const text =
          command === 'insertDateTimeLong'
            ? now.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'medium' })
            : now.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
        editor.executeEdits('insert-datetime', [{ range: sel, text, forceMoveMarkers: true }])
        editor.focus()
        break
      }
      case 'foldAll':
        editor.getAction('editor.foldAll')?.run()
        break
      case 'unfoldAll':
        editor.getAction('editor.unfoldAll')?.run()
        break
      case 'togglePreview': {
        // Ctrl+P: open the right-side preview pane if the active buffer is
        // a previewable type (.sqlplan / xml-with-ShowPlan / .csv / .md).
        // App.tsx decides which component to render from buffer state.
        useUIStore.getState().togglePreview()
        break
      }
      case 'transformToDiagram': {
        // Ctrl+Alt+Shift+K: parse the active buffer as Prisma / DBML / DDL
        // and open the ER-diagram overlay. Distinct from preview — chooses
        // its parser by content sniff, not by buffer language.
        const id = currentIdRef.current
        const model = editor.getModel()
        if (!id || !model) break
        const text = model.getValue()
        const buf = useEditorStore.getState().getBuffer(id)
        const title = buf?.title ?? 'untitled'
        ;(async () => {
          const { parseSchema } = await import('../../utils/schemaParse')
          const res = parseSchema(text)
          if (!res.ok) {
            useUIStore.getState().addToast(res.reason, 'warn')
            return
          }
          if (res.model.tables.length === 0) {
            useUIStore.getState().addToast('No tables found in this buffer.', 'warn')
            return
          }
          useUIStore.getState().openTransform(res.model, res.kind, title)
        })()
        break
      }
      case 'removeDuplicates': {
        // Ctrl+Alt+Shift+C: dedupe the current selection (or full buffer if
        // no selection). Whitespace-trim and empty-line removal applied too,
        // matching exifmaster-pro's ListCleaner defaults.
        const model = editor.getModel()
        if (!model) break
        const sel = editor.getSelection()
        const hasSelection = sel && !sel.isEmpty()
        const range = hasSelection ? sel : model.getFullModelRange()
        const text = model.getValueInRange(range)
        if (!text.trim()) break
        ;(async () => {
          const { processListItems, DEFAULT_CLEAN_OPTIONS } = await import('../../utils/listOps')
          const before = text.split(/\r?\n/).filter((l) => l.trim()).length
          const cleaned = processListItems(text, DEFAULT_CLEAN_OPTIONS)
          const after = cleaned ? cleaned.split('\n').length : 0
          editor.executeEdits('remove-duplicates', [{ range, text: cleaned, forceMoveMarkers: true }])
          const removed = before - after
          useUIStore.getState().addToast(
            removed > 0
              ? `Removed ${removed} duplicate line${removed !== 1 ? 's' : ''} (${after} unique).`
              : 'No duplicates found.',
            removed > 0 ? 'info' : 'warn'
          )
        })()
        break
      }
      case 'toggleColumnSelect': {
        const current = editor.getOption(monaco.editor.EditorOption.columnSelection)
        editor.updateOptions({ columnSelection: !current })
        useUIStore.getState().setColumnSelectMode(!current, true)
        break
      }
      case 'beginEndSelect':
      case 'beginEndSelectColumn': {
        const isColumn = command === 'beginEndSelectColumn'
        const model = editor.getModel()
        const pos = editor.getPosition()
        if (!model || !pos) break

        const modelUri = model.uri.toString()
        const pending = beginEndAnchorRef.current
        const samePending = pending && pending.modelUri === modelUri

        if (!samePending) {
          // Different buffer (or none) — clear any stale anchor first
          if (pending) {
            const prevModel = monaco.editor.getModel(monaco.Uri.parse(pending.modelUri))
            prevModel?.deltaDecorations([pending.decorationId], [])
          }
          // First invoke: drop a zero-width tracked decoration at the caret
          // (visible: glyph icon + column-precise bar + overview-ruler tick).
          injectAnchorStyles()
          const ids = model.deltaDecorations([], [{
            range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
            options: {
              description: 'begin-end-select-anchor',
              stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
              glyphMarginClassName: 'nmp-anchor-glyph',
              glyphMarginHoverMessage: {
                value: isColumn
                  ? 'Begin Select anchor (column mode) — invoke again to complete'
                  : 'Begin Select anchor — invoke again to complete'
              },
              beforeContentClassName: 'nmp-anchor-bar',
              overviewRuler: {
                color: '#f59e0b',
                position: monaco.editor.OverviewRulerLane.Center
              }
            }
          }])
          beginEndAnchorRef.current = { decorationId: ids[0], isColumn, modelUri }
          useUIStore.getState().addToast(
            isColumn
              ? 'Begin Select set (column mode) — invoke again to complete'
              : 'Begin Select set — invoke again to complete',
            'info'
          )
        } else {
          // Second invoke: read tracked anchor (already drift-corrected by Monaco)
          const anchorRange = model.getDecorationRange(pending.decorationId)
          const wasColumn = pending.isColumn
          model.deltaDecorations([pending.decorationId], [])
          beginEndAnchorRef.current = null

          if (!anchorRange) break
          const aLine = anchorRange.startLineNumber
          const aCol = anchorRange.startColumn

          if (wasColumn) {
            // Build a rectangular selection: one Selection per line spanning [aCol..pos.column]
            const startLine = Math.min(aLine, pos.lineNumber)
            const endLine = Math.max(aLine, pos.lineNumber)
            const selections: monaco.Selection[] = []
            for (let line = startLine; line <= endLine; line++) {
              selections.push(new monaco.Selection(line, aCol, line, pos.column))
            }
            editor.setSelections(selections)
          } else {
            editor.setSelection(new monaco.Selection(aLine, aCol, pos.lineNumber, pos.column))
          }
          editor.focus()
          useUIStore.getState().addToast('Selection completed', 'info')
        }
        break
      }
      case 'beautify': {
        const id = currentIdRef.current
        const model = editor.getModel()
        if (!id || !model) break
        const buf = useEditorStore.getState().getBuffer(id)

        // Markdown files: Ctrl+Alt+Shift+M toggles the live preview pane
        // instead of attempting to beautify the source.
        if (buf?.language === 'markdown') {
          useUIStore.getState().togglePreview()
          break
        }

        const cfg = useConfigStore.getState()
        const indent = cfg.insertSpaces ? cfg.tabSize : '\t'
        const sel = editor.getSelection()
        const hasSelection = sel && !sel.isEmpty()
        const range = hasSelection ? sel : model.getFullModelRange()
        const text = model.getValueInRange(range)
        const format = detectBeautifyFormat(text, buf?.language)
        if (!format) {
          useUIStore
            .getState()
            .addToast('Cannot beautify — unrecognized format (JSON / SQL / XML / Markdown).', 'warn')
          break
        }

        // Auto-enable word wrap when the buffer has any pathologically long
        // line (e.g. minified JSON pasted as a single ~100KB line). The
        // horizontal scrollbar on those buffers is unusable, and a formatted
        // result can still contain long string values — so we leave wrap on
        // rather than restoring afterwards. Persisted via configStore so the
        // menu checkbox and next launch stay in sync.
        if (!cfg.wordWrap && useConfigStore.getState().autoWrapLongLines) {
          const lineCount = model.getLineCount()
          let hasLongLine = false
          for (let line = 1; line <= lineCount; line++) {
            if (model.getLineLength(line) > 500) {
              hasLongLine = true
              break
            }
          }
          if (hasLongLine) {
            useConfigStore.getState().setProp('wordWrap', true)
            useUIStore.getState().setWordWrap(true)
          }
        }

        // beautify() is now async because the SQL path lazy-loads sql-formatter
        // (~1.6 MB) into its own chunk on first use, keeping the main bundle lean.
        ;(async () => {
          try {
            const formatted = await beautify(text, format, indent as string | number, buf?.language)
            editor.executeEdits('beautify', [
              { range, text: formatted, forceMoveMarkers: true }
            ])
            monaco.editor.setModelLanguage(model, format)
            useEditorStore.getState().updateBuffer(id, { language: format })
          } catch {
            useUIStore
              .getState()
              .addToast(`Not valid ${format.toUpperCase()} — cannot beautify.`, 'warn')
          }
        })()
        break
      }
      case 'printDocument':
      case 'exportPdf': {
        // File ▸ Print / Export to PDF — render the active buffer to a clean,
        // line-numbered HTML document in the main process and either open the
        // system print dialog or write a PDF via a Save dialog.
        const id = currentIdRef.current
        const model = editor.getModel()
        if (!id || !model) break
        const buf = useEditorStore.getState().getBuffer(id)
        const title = buf?.title ?? 'document'
        const content = model.getValue()
        ;(async () => {
          const { buildPlainDocumentHtml } = await import('../../utils/exportDoc')
          const html = buildPlainDocumentHtml({ title, content })
          if (command === 'exportPdf') {
            const base = buf?.filePath
              ? buf.filePath.replace(/\.[^.]+$/, '')
              : title.replace(/\.[^.]+$/, '')
            const res = await window.api.print.toPdf(html, `${base}.pdf`)
            if (res?.error) useUIStore.getState().addToast(`PDF export failed: ${res.error}`, 'error')
            else if (!res?.canceled) useUIStore.getState().addToast('Saved PDF.', 'info')
          } else {
            const res = await window.api.print.document(html)
            if (res && !res.success && res.error) {
              useUIStore.getState().addToast(`Print failed: ${res.error}`, 'error')
            }
          }
        })()
        break
      }
    }
  }, [toggleBookmark, nextBookmark, prevBookmark, clearBookmarks])

  // Initialize editor
  useEffect(() => {
    if (!containerRef.current) return

    const cfg = useConfigStore.getState()
    const editor = monaco.editor.create(containerRef.current, {
      theme: monacoThemeFor(theme),
      fontSize: cfg.fontSize,
      fontFamily: cfg.fontFamily,
      lineNumbers: cfg.showLineNumbers ? 'on' : 'off',
      glyphMargin: true,
      folding: true,
      foldingHighlight: true,
      showFoldingControls: 'always',
      minimap: { enabled: cfg.showMinimap },
      scrollBeyondLastLine: false,
      wordWrap: cfg.wordWrap ? 'on' : 'off',
      renderWhitespace: cfg.renderWhitespace as monaco.editor.RenderWhitespace,
      renderControlCharacters: false,
      guides: { indentation: cfg.renderIndentGuides, bracketPairs: true },
      bracketPairColorization: { enabled: cfg.bracketPairColorization },
      autoClosingBrackets: cfg.autoCloseBrackets ? 'always' : 'never',
      autoClosingQuotes: cfg.autoCloseQuotes ? 'always' : 'never',
      suggestOnTriggerCharacters: cfg.autoCompleteEnabled,
      quickSuggestions: cfg.autoCompleteEnabled,
      parameterHints: { enabled: true },
      contextmenu: false,
      multiCursorModifier: 'alt',
      columnSelection: false,
      links: true,
      colorDecorators: true,
      renderLineHighlight: cfg.highlightCurrentLine ? 'line' : 'none',
      tabSize: cfg.tabSize,
      insertSpaces: cfg.insertSpaces,
      scrollbar: {
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10
      },
      // Match VS Code / Cursor defaults: Ctrl+wheel does NOT zoom the editor
      // font. Whole-window zoom is via Cmd/Ctrl +/-/0 (handled in App.tsx).
      mouseWheelZoom: false,
      padding: { top: 4 }
    })

    editorRef.current = editor
    editorRegistry.set(editor)

    // Override Monaco's built-in Cmd+F / Ctrl+H to use our custom dialog
    // Pre-fill with current selection if it's a single-line non-empty string
    const getSelectionText = () => {
      const sel = editor.getSelection()
      if (!sel) return ''
      const text = editor.getModel()?.getValueInRange(sel) ?? ''
      return text.includes('\n') ? '' : text.trim()
    }
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
      useUIStore.getState().openFind('find', getSelectionText())
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, () => {
      useUIStore.getState().openFind('replace', getSelectionText())
    })
    // Beautify (JSON / SQL / XML) — Ctrl+Alt+Shift+M (Cmd on macOS). Routed
    // through the editor:command event bus so the always-current
    // dispatchCommand handles it (avoids the stale closure that addCommand
    // would otherwise capture from this init effect).
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyM,
      () => window.dispatchEvent(new CustomEvent('editor:command', { detail: 'beautify' }))
    )
    // Ctrl+Alt+Shift+K: Transform → ER diagram. Parses the buffer as
    // Prisma / DBML / DDL and opens the standalone TransformOverlay (not
    // routed through Ctrl+P preview).
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyK,
      () => window.dispatchEvent(new CustomEvent('editor:command', { detail: 'transformToDiagram' }))
    )
    // Ctrl+P (Cmd+P on macOS): toggle the right-side preview pane. The pane
    // itself decides what to render based on the active buffer's language /
    // content (.sqlplan / xml-with-ShowPlan / .csv / .md).
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP,
      () => window.dispatchEvent(new CustomEvent('editor:command', { detail: 'togglePreview' }))
    )
    // Ctrl+Alt+Shift+C: remove duplicate lines in selection (or whole buffer).
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyC,
      () => window.dispatchEvent(new CustomEvent('editor:command', { detail: 'removeDuplicates' }))
    )
    // Convert Case — register Ctrl+Shift+U / Ctrl+Shift+L directly on the
    // editor so they fire reliably when Monaco has focus. Ctrl+Shift+L would
    // otherwise be intercepted by Monaco's built-in selectHighlights action.
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyU,
      () => window.dispatchEvent(new CustomEvent('editor:command', { detail: 'toUpperCase' }))
    )
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyL,
      () => window.dispatchEvent(new CustomEvent('editor:command', { detail: 'toLowerCase' }))
    )

    // Re-run language autodetect whenever the user pastes content. Together
    // with on-load and on-save detection, this keeps syntax highlighting in
    // sync as content evolves (e.g. paste minified JSON into "new 1" — Magika
    // re-classifies it as json so the beautify shortcut works on it).
    editor.onDidPaste((e) => {
      const id = currentIdRef.current
      if (!id) return
      const buf = useEditorStore.getState().getBuffer(id)
      if (!buf) return
      const model = editor.getModel()
      const text = model?.getValue() ?? ''
      if (!text) return
      void refineLanguageAsync(id, sampleFromString(text), buf.language)

      // Auto-enable word wrap when the pasted content has a line too long to
      // fit the viewport (e.g. markdown copied from another app stores each
      // paragraph as one unbroken line). Without wrap, Monaco scrolls
      // horizontally to the cursor and the text reads as fragments. Match
      // beautify's behavior — persist via configStore so the menu checkbox and
      // next launch stay in sync.
      if (
        model &&
        !useConfigStore.getState().wordWrap &&
        useConfigStore.getState().autoWrapLongLines
      ) {
        const { contentWidth } = editor.getLayoutInfo()
        const charW = editor.getOption(monaco.editor.EditorOption.fontInfo)
          .typicalHalfwidthCharacterWidth
        const visibleCols = charW > 0 ? Math.floor(contentWidth / charW) : 120
        let hasLongLine = false
        for (let line = e.range.startLineNumber; line <= e.range.endLineNumber; line++) {
          if (model.getLineLength(line) > visibleCols) {
            hasLongLine = true
            break
          }
        }
        if (hasLongLine) {
          useConfigStore.getState().setProp('wordWrap', true)
          useUIStore.getState().setWordWrap(true)
        }
      }
    })

    // Track content changes — compare Monaco's alternative version id to the
    // last clean baseline so that undoing back to the saved state clears the
    // dirty flag (same approach VS Code uses).
    editor.onDidChangeModelContent(() => {
      const id = currentIdRef.current
      if (!id) return
      const buf = useEditorStore.getState().getBuffer(id)
      if (!buf) return
      const model = editor.getModel()
      if (!model) return
      const nextDirty = model.getAlternativeVersionId() !== buf.savedVersionId
      if (nextDirty !== buf.isDirty) {
        updateBuffer(id, { isDirty: nextDirty })
      }
    })

    // Track cursor position -> status bar + navigation history (threshold)
    editor.onDidChangeCursorPosition((e) => {
      const id = currentIdRef.current
      if (!id) return

      window.dispatchEvent(new CustomEvent('editor:cursor', {
        detail: { line: e.position.lineNumber, col: e.position.column }
      }))

      // Navigation history: push only on "significant" jumps (spec §3.2 / BR-005).
      // Skip while a programmatic navigation is replaying — it sets its own position.
      const nav = useNavigationStore.getState()
      if (nav.isNavigating) return

      const newLine = e.position.lineNumber
      if (Math.abs(newLine - lastRecordedLineRef.current) > NAV_LINE_THRESHOLD) {
        const buf = useEditorStore.getState().getBuffer(id)
        if (buf?.kind === 'file') {
          nav.pushEntry({
            bufferId: id,
            line: newLine,
            column: e.position.column,
            timestamp: Date.now(),
          })
          lastRecordedLineRef.current = newLine
        }
      }
    })

    // Dispatch scroll event for Document Map sync
    editor.onDidScrollChange(() => {
      window.dispatchEvent(new CustomEvent('editor:scroll'))
    })

    // Handle resize
    const ro = new ResizeObserver(() => editor.layout())
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      editorRegistry.set(null)
      editor.dispose()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Update theme
  useEffect(() => {
    if (editorRef.current) {
      monaco.editor.setTheme(monacoThemeFor(theme))
    }
  }, [theme])

  // Live-apply config changes from Preferences dialog
  useEffect(() => {
    const unsub = useConfigStore.subscribe((cfg) => {
      const editor = editorRef.current
      if (!editor) return
      editor.updateOptions({
        fontSize: cfg.fontSize,
        fontFamily: cfg.fontFamily,
        lineNumbers: cfg.showLineNumbers ? 'on' : 'off',
        wordWrap: cfg.wordWrap ? 'on' : 'off',
        renderWhitespace: cfg.renderWhitespace as monaco.editor.RenderWhitespace,
        guides: { indentation: cfg.renderIndentGuides, bracketPairs: true },
        bracketPairColorization: { enabled: cfg.bracketPairColorization },
        autoClosingBrackets: cfg.autoCloseBrackets ? 'always' : 'never',
        autoClosingQuotes: cfg.autoCloseQuotes ? 'always' : 'never',
        suggestOnTriggerCharacters: cfg.autoCompleteEnabled,
        quickSuggestions: cfg.autoCompleteEnabled,
        renderLineHighlight: cfg.highlightCurrentLine ? 'line' : 'none',
        tabSize: cfg.tabSize,
        insertSpaces: cfg.insertSpaces,
        minimap: { enabled: cfg.showMinimap }
      })
    })
    return unsub
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Swap model when active buffer changes (supports ghost/lazy buffers)
  // Also re-runs when activeBufLoaded flips from false→true after hydration
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !activeId) return

    const buf = getBuffer(activeId)
    if (!buf) return

    // Save view state of previous buffer + push a navigation entry for where
    // we're leaving (spec §3.1). Skip while a programmatic back/forward
    // navigation is in flight — its own setActive call shouldn't pollute the
    // history it's trying to traverse.
    if (currentIdRef.current && currentIdRef.current !== activeId) {
      // Clear any pending Begin/End-Select anchor — it belongs to the buffer
      // we're leaving, so it shouldn't apply once we land on a different model.
      const pending = beginEndAnchorRef.current
      if (pending) {
        const prevModel = monaco.editor.getModel(monaco.Uri.parse(pending.modelUri))
        prevModel?.deltaDecorations([pending.decorationId], [])
        beginEndAnchorRef.current = null
      }

      const vs = editor.saveViewState()
      updateBuffer(currentIdRef.current, { viewState: vs })

      const nav = useNavigationStore.getState()
      if (!nav.isNavigating) {
        // Per spec §3.5: skip the push when either the source or destination
        // of the switch is a virtual tab. `buf` is the destination (the new
        // activeId's buffer) and `prevBuf` is the source.
        const prevBuf = getBuffer(currentIdRef.current)
        if (prevBuf && prevBuf.kind === 'file' && buf.kind === 'file') {
          const pos = editor.getPosition()
          if (pos) {
            nav.pushEntry({
              bufferId: currentIdRef.current,
              line: pos.lineNumber,
              column: pos.column,
              timestamp: Date.now(),
            })
          }
        }
      }
    }

    currentIdRef.current = activeId
    // Seed lastRecordedLine for the threshold check (spec §3.2, P2.3). If the
    // new buffer already has a known cursor via its viewState, use it; else 1.
    const seedLine = buf.viewState?.cursorState?.[0]?.position?.lineNumber
      ?? (buf.savedViewState as { cursorState?: Array<{ position?: { lineNumber?: number } }> } | null)?.cursorState?.[0]?.position?.lineNumber
      ?? 1
    lastRecordedLineRef.current = seedLine
    setMissingFile(null)

    // Missing file — show placeholder
    if (buf.missing) {
      editor.setModel(null)
      setLoading(false)
      setMissingFile(buf.filePath)
      return
    }

    // Ghost buffer — trigger lazy load; effect will re-run when loaded becomes true
    if (!buf.loaded) {
      editor.setModel(null)
      setLoading(true)
      // Fetch file size to display in loading overlay
      if (buf.filePath) {
        window.api.file.stat(buf.filePath).then((s) => {
          if (s.exists && s.size > 0) setLoadingSize(s.size)
        })
      }
      loadBuffer(activeId)
      return
    }

    // Loaded buffer — set model (handles both normal open and post-hydration)
    setLoading(false)
    setLoadingSize(null)
    if (buf.model) {
      editor.setModel(buf.model)
      // Prefer live viewState, fall back to savedViewState from session.
      // After consuming savedViewState, drop it — subsequent saves use the
      // live viewState captured from the editor, so retaining a second
      // serialized copy per buffer wastes memory across many open tabs.
      if (buf.viewState) {
        editor.restoreViewState(buf.viewState)
      } else if (buf.savedViewState) {
        try { editor.restoreViewState(buf.savedViewState as monaco.editor.ICodeEditorViewState) } catch { /* ignore */ }
        updateBuffer(activeId, { savedViewState: null })
      }
      restoreDecorations(activeId)

      // Large file mode: disable expensive editor features
      if (buf.isLargeFile) {
        editor.updateOptions({
          minimap: { enabled: false },
          folding: false,
          foldingHighlight: false,
          bracketPairColorization: { enabled: false },
          guides: { indentation: false, bracketPairs: false },
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
          wordBasedSuggestions: 'off',
          renderLineHighlight: 'none',
          colorDecorators: false,
          links: false
        })
      } else {
        // Restore config-based options when switching from large to normal file
        const cfg = useConfigStore.getState()
        editor.updateOptions({
          minimap: { enabled: cfg.showMinimap },
          folding: true,
          foldingHighlight: true,
          bracketPairColorization: { enabled: cfg.bracketPairColorization },
          guides: { indentation: cfg.renderIndentGuides, bracketPairs: true },
          quickSuggestions: cfg.autoCompleteEnabled,
          suggestOnTriggerCharacters: cfg.autoCompleteEnabled,
          wordBasedSuggestions: 'currentDocument',
          renderLineHighlight: cfg.highlightCurrentLine ? 'line' : 'none',
          colorDecorators: true,
          links: true
        })
      }
    }

    editor.focus()
  }, [activeId, activeBufLoaded, getBuffer, updateBuffer, restoreDecorations, loadBuffer])

  // Read-only mode (deeplink-opened remote buffers). Reactive to the flag —
  // not just tab switches — so Save As flipping isReadOnly false unlocks the
  // editor in place.
  useEffect(() => {
    editorRef.current?.updateOptions({
      readOnly: activeBufIsReadOnly,
      readOnlyMessage: { value: 'Read-only remote file — use File → Save As to edit a local copy' }
    })
  }, [activeBufIsReadOnly, activeId])

  // Handle editor commands from menu (IPC from native menu + CustomEvent from custom MenuBar/context menu)
  // Hold dispatchCommand in a ref so the IPC listener stays registered exactly
  // once across renders — re-binding on dispatchCommand identity change would
  // leak listeners and cause Begin/End-Select to toggle N times per keypress.
  const dispatchCommandRef = useRef(dispatchCommand)
  useEffect(() => { dispatchCommandRef.current = dispatchCommand }, [dispatchCommand])
  useEffect(() => {
    const ipcHandler = (...args: unknown[]) => {
      dispatchCommandRef.current(args[0] as string)
    }
    const customHandler = (e: Event) => {
      dispatchCommandRef.current((e as CustomEvent<string>).detail)
    }
    const unsub = window.api.on('editor:command', ipcHandler)
    window.addEventListener('editor:command', customHandler)
    return () => {
      unsub()
      window.removeEventListener('editor:command', customHandler)
    }
  }, [])

  // Handle editor option changes from menu
  useEffect(() => {
    const applyEditorOptions = (opts: monaco.editor.IEditorOptions, fromMain = false) => {
      editorRef.current?.updateOptions(opts)
      // Sync toggle state → uiStore
      const ui = useUIStore.getState()
      if ('wordWrap' in opts) ui.setWordWrap(opts.wordWrap === 'on', fromMain)
      if ('renderWhitespace' in opts) ui.setRenderWhitespace(opts.renderWhitespace === 'all', fromMain)
      if (opts.guides && typeof opts.guides === 'object' && 'indentation' in opts.guides) {
        ui.setIndentationGuides(!!(opts.guides as { indentation: boolean }).indentation, fromMain)
      }
      if ('columnSelection' in opts) ui.setColumnSelectMode(!!opts.columnSelection, fromMain)
      if ('renderControlCharacters' in opts) ui.setShowNonPrinting(!!opts.renderControlCharacters, fromMain)
      if (opts.unicodeHighlight && typeof opts.unicodeHighlight === 'object' && 'invisibleCharacters' in opts.unicodeHighlight) {
        ui.setShowControlChars(!!(opts.unicodeHighlight as { invisibleCharacters: boolean }).invisibleCharacters, fromMain)
      }
    }
    // From native menu (IPC)
    const unsub = window.api.on('editor:set-option', (...args: unknown[]) => {
      applyEditorOptions(args[0] as monaco.editor.IEditorOptions, true)
    })
    // From custom MenuBar (CustomEvent)
    const handleLocalOption = (e: Event) => {
      applyEditorOptions((e as CustomEvent).detail as monaco.editor.IEditorOptions)
    }
    window.addEventListener('editor:set-option-local', handleLocalOption)
    return () => {
      unsub()
      window.removeEventListener('editor:set-option-local', handleLocalOption)
    }
  }, [])

  // EOL-marker overlay: when "Show End of Line" is on, render a faint
  // LF/CRLF/CR marker after each line. Bound to current model; refreshes on
  // model swap, content change, and toggle. Capped at 50k lines for perf.
  useEffect(() => {
    let enabled = false
    let collection: monaco.editor.IEditorDecorationsCollection | null = null
    let contentSub: monaco.IDisposable | null = null
    let modelSub: monaco.IDisposable | null = null

    const rebuild = () => {
      const editor = editorRef.current
      if (!editor) return
      if (!collection) collection = editor.createDecorationsCollection()
      const model = editor.getModel()
      if (!enabled || !model) { collection.clear(); return }
      const eol = model.getEOL()
      const marker = eol === '\r\n' ? '↵' : eol === '\r' ? '↵' : '↵'
      const lineCount = Math.min(model.getLineCount(), 50000)
      const decs: monaco.editor.IModelDeltaDecoration[] = []
      for (let line = 1; line < lineCount; line++) {
        const col = model.getLineMaxColumn(line)
        decs.push({
          range: new monaco.Range(line, col, line, col),
          options: { after: { content: marker, inlineClassName: 'eol-marker' } },
        })
      }
      collection.set(decs)
    }

    const bindModel = () => {
      contentSub?.dispose()
      const model = editorRef.current?.getModel()
      contentSub = model?.onDidChangeContent(() => rebuild()) ?? null
      rebuild()
    }

    const onEvt = (e: Event) => {
      // Store toggle was already set by MenuBar before dispatching this event.
      enabled = !!(e as CustomEvent).detail
      rebuild()
    }
    window.addEventListener('editor:set-eol-marker', onEvt)
    // From native menu (IPC)
    const unsubIpc = window.api.on('editor:set-eol-marker', (...args: unknown[]) => {
      enabled = !!args[0]
      useUIStore.getState().setShowEOL(enabled, true)
      rebuild()
    })

    // The editor may not yet be created on first render — defer binding.
    const timer = window.setTimeout(() => {
      modelSub = editorRef.current?.onDidChangeModel(bindModel) ?? null
      bindModel()
    }, 0)

    return () => {
      window.removeEventListener('editor:set-eol-marker', onEvt)
      unsubIpc()
      window.clearTimeout(timer)
      contentSub?.dispose()
      modelSub?.dispose()
      collection?.clear()
    }
  }, [])

  // Handle EOL change from menu (IPC) or status bar click (CustomEvent)
  useEffect(() => {
    const applyEol = (eol: EOLType) => {
      const id = currentIdRef.current
      const editor = editorRef.current
      if (!id || !editor) return
      const monacoEol =
        eol === 'CRLF'
          ? monaco.editor.EndOfLineSequence.CRLF
          : monaco.editor.EndOfLineSequence.LF
      editor.getModel()?.setEOL(monacoEol)
      updateBuffer(id, { eol })
    }
    const ipcHandler = (...args: unknown[]) => applyEol(args[0] as EOLType)
    const customHandler = (e: Event) => applyEol((e as CustomEvent<EOLType>).detail)
    const unsub = window.api.on('editor:set-eol', ipcHandler)
    window.addEventListener('editor:set-eol', customHandler)
    return () => {
      unsub()
      window.removeEventListener('editor:set-eol', customHandler)
    }
  }, [updateBuffer])

  // Handle encoding change from menu (IPC) or status bar click (CustomEvent)
  useEffect(() => {
    const applyEncoding = (encoding: string) => {
      const id = currentIdRef.current
      if (!id) return
      // Encoding change is a non-content dirty marker — bump savedVersionId out
      // of reach so undoing within Monaco can't accidentally clear the flag.
      updateBuffer(id, { encoding, isDirty: true, savedVersionId: -1 })
    }
    const ipcHandler = (...args: unknown[]) => applyEncoding(args[0] as string)
    const customHandler = (e: Event) => applyEncoding((e as CustomEvent<string>).detail)
    const unsub = window.api.on('editor:set-encoding', ipcHandler)
    window.addEventListener('editor:set-encoding', customHandler)
    return () => {
      unsub()
      window.removeEventListener('editor:set-encoding', customHandler)
    }
  }, [updateBuffer])

  // Handle language change from menu (IPC + CustomEvent)
  useEffect(() => {
    const applyLanguage = (lang: string) => {
      const buf = currentIdRef.current ? getBuffer(currentIdRef.current) : null
      if (buf?.model) {
        monaco.editor.setModelLanguage(buf.model, lang)
        updateBuffer(buf.id, { language: lang })
      }
    }
    const unsub = window.api.on('editor:set-language', (...args: unknown[]) => applyLanguage(args[0] as string))
    const handleLocalLang = (e: Event) => applyLanguage((e as CustomEvent<string>).detail)
    window.addEventListener('editor:set-language-local', handleLocalLang)
    return () => {
      unsub()
      window.removeEventListener('editor:set-language-local', handleLocalLang)
    }
  }, [getBuffer, updateBuffer])

  // Handle go-to-line from status bar Quick Pick
  useEffect(() => {
    const handler = (e: Event) => {
      const { line, column } = (e as CustomEvent<{ line: number; column: number }>).detail
      const editor = editorRef.current
      if (!editor) return
      editor.revealLineInCenter(line)
      editor.setPosition({ lineNumber: line, column })
      editor.focus()
    }
    window.addEventListener('editor:goto-line', handler)
    return () => window.removeEventListener('editor:goto-line', handler)
  }, [])

  // Handle plugin API requests that need editor access
  useEffect(() => {
    const unsubGetText = window.api.on('plugin:editor-get-text', () => {
      const buf = currentIdRef.current ? getBuffer(currentIdRef.current) : null
      window.api.send('plugin:editor-get-text:reply', buf?.model?.getValue() ?? '')
    })
    const unsubGetSel = window.api.on('plugin:editor-get-selection', () => {
      const editor = editorRef.current
      const selection = editor?.getSelection()
      const text = selection ? editor?.getModel()?.getValueInRange(selection) ?? '' : ''
      window.api.send('plugin:editor-get-selection:reply', text)
    })
    const unsubGetPath = window.api.on('plugin:editor-get-path', () => {
      const buf = currentIdRef.current ? getBuffer(currentIdRef.current) : null
      window.api.send('plugin:editor-get-path:reply', buf?.filePath ?? null)
    })
    const unsubInsert = window.api.on('plugin:insert-text', (...args: unknown[]) => {
      const text = args[1] as string
      const editor = editorRef.current
      if (!editor || !text) return
      const selection = editor.getSelection()
      if (selection) {
        editor.executeEdits('plugin', [{ range: selection, text, forceMoveMarkers: true }])
      }
    })
    return () => { unsubGetText(); unsubGetSel(); unsubGetPath(); unsubInsert() }
  }, [getBuffer])

  return (
    <EditorContextMenu>
    <div className="flex flex-col flex-1 h-full overflow-hidden relative" data-testid="editor-pane">
      <div ref={containerRef} className="flex-1 h-full w-full" />
      {loading && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-background pointer-events-none z-[1]">Loading...{loadingSize ? ` (${(loadingSize / 1024 / 1024).toFixed(1)} MB)` : ''}</div>}
      {missingFile && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-background pointer-events-none z-[1]">File not found: {missingFile}</div>}
    </div>
    </EditorContextMenu>
  )
}
