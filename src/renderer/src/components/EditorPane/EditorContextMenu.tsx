import * as monaco from 'monaco-editor'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../ui/context-menu'
import { shortcutMod } from '../../utils/platform'
import { editorRegistry } from '../../utils/editorRegistry'
import { useConfigStore } from '../../store/configStore'
import { useAiStore } from '../../store/aiStore'

const editorCmd = (cmd: string) =>
  window.dispatchEvent(new CustomEvent('editor:command', { detail: cmd }))

// document.execCommand('paste') is blocked in Chromium for security; cut/copy
// also stopped being reliable from non-keyboard events. Drive the active
// Monaco editor directly via navigator.clipboard + executeEdits so the menu
// items actually do what their label says.
function getActiveSelection() {
  const ed = editorRegistry.get()
  if (!ed) return null
  const sel = ed.getSelection()
  const model = ed.getModel()
  if (!sel || !model) return null
  return { ed, sel, model }
}

async function doCut() {
  const ctx = getActiveSelection()
  if (!ctx || ctx.sel.isEmpty()) return
  const text = ctx.model.getValueInRange(ctx.sel)
  try { await navigator.clipboard.writeText(text) } catch { return }
  ctx.ed.executeEdits('contextmenu-cut', [
    { range: ctx.sel, text: '', forceMoveMarkers: true },
  ])
  ctx.ed.focus()
}

async function doCopy() {
  const ctx = getActiveSelection()
  if (!ctx || ctx.sel.isEmpty()) return
  const text = ctx.model.getValueInRange(ctx.sel)
  try { await navigator.clipboard.writeText(text) } catch { /* swallow */ }
  ctx.ed.focus()
}

async function doPaste() {
  const ed = editorRegistry.get()
  if (!ed) return
  let text = ''
  try { text = await navigator.clipboard.readText() } catch { return }
  if (!text) return
  const sel = ed.getSelection() ?? new monaco.Range(1, 1, 1, 1)
  ed.executeEdits('contextmenu-paste', [
    { range: sel, text, forceMoveMarkers: true },
  ])
  ed.focus()
}

function doSelectAll() {
  const ed = editorRegistry.get()
  const model = ed?.getModel()
  if (!ed || !model) return
  ed.setSelection(model.getFullModelRange())
  ed.focus()
}

/**
 * Open the assistant with the selection as its context. The panel's context
 * chip resolves 'selection' against the live editor, so nothing needs to be
 * copied across here — just pin the mode and show the panel.
 */
function openAiForSelection() {
  const ctx = getActiveSelection()
  const ai = useAiStore.getState()
  ai.setContextOverride(ctx && !ctx.sel.isEmpty() ? 'selection' : 'auto')
  ai.openPanel()
}

interface EditorContextMenuProps {
  children: React.ReactNode
}

export function EditorContextMenu({ children }: EditorContextMenuProps) {
  const mod = shortcutMod()
  const aiEnabled = useConfigStore((s) => s.aiEnabled)
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[200px]">
        <ContextMenuItem onSelect={() => void doCut()}>
          Cut
          <ContextMenuShortcut>{mod}+X</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void doCopy()}>
          Copy
          <ContextMenuShortcut>{mod}+C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void doPaste()}>
          Paste
          <ContextMenuShortcut>{mod}+V</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onSelect={doSelectAll}>
          Select All
          <ContextMenuShortcut>{mod}+A</ContextMenuShortcut>
        </ContextMenuItem>

        {aiEnabled && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={openAiForSelection}>
              Ask AI about selection
              <ContextMenuShortcut>{mod}+Shift+A</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}

        <ContextMenuSeparator />

        <ContextMenuItem onSelect={() => editorCmd('goToLine')}>
          Go to Line...
          <ContextMenuShortcut>{mod}+G</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => editorCmd('toggleComment')}>
          Toggle Comment
          <ContextMenuShortcut>{mod}+/</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuSub>
          <ContextMenuSubTrigger>Convert Case</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onSelect={() => editorCmd('toUpperCase')}>
              UPPERCASE
              <ContextMenuShortcut>{mod}+Shift+U</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => editorCmd('toLowerCase')}>
              lowercase
              <ContextMenuShortcut>{mod}+U</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => editorCmd('toTitleCase')}>
              Title Case
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  )
}
