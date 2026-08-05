import { useEffect, useMemo } from 'react'
import { useConfigStore } from '../store/configStore'
import { captureBinding } from '../utils/shortcutCatalog'
import { allCommands, runCommand } from './registry'

/**
 * The one keyboard path for every registry command.
 *
 * Native menu accelerators are display-only (`registerAccelerator: false` in
 * `main/menu.ts`), so this hook is the only thing that turns a keypress into a
 * command — which is what makes rebinding in Settings take effect immediately
 * (the binding map is derived from `config.shortcuts`) and what removes the
 * double-fire class of bug, where a native accelerator and a bespoke renderer
 * listener both ran the same toggle.
 */

/** Keys Monaco owns outright; claiming them would break ordinary editing. */
const NEVER_DISPATCH = new Set(['Tab', 'Shift+Tab'])

/**
 * Whether this keypress belongs to whatever the user is typing into rather than
 * to a command. Non-negotiable, because catalog defaults include bare `F2`.
 *
 * The rule is about the *combo*, not just the element: inside an editable target
 * we claim only combos a person could not be typing — anything carrying
 * Ctrl/Cmd/Alt, plus the function keys. Everything else (letters, digits, Tab,
 * Enter, Escape, Backspace) belongs to the field.
 *
 * Element-only checks are not enough in either direction. Monaco's own input is
 * a `<textarea>`, so rejecting every textarea would kill `Mod+S` and `Alt+Up`
 * exactly where they matter most; and letting bare keys through to commands
 * would have `F2` fire Next Bookmark mid-word.
 */
function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  const editable =
    tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable || !!el.closest('.monaco-editor')
  if (!editable) return false
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  if (/^F\d{1,2}$/.test(e.key)) return false
  return true
}

export function useCommandKeys(): void {
  const overrides = useConfigStore((s) => s.shortcuts)

  const bindingMap = useMemo(() => {
    const m = new Map<string, string>() // binding → command id
    for (const c of allCommands()) {
      // `nativeKey` commands document a keystroke the OS or Monaco already owns.
      if (c.nativeKey) continue
      const binding = overrides?.[c.id] ?? c.defaultKey
      if (!binding || NEVER_DISPATCH.has(binding)) continue
      // First declaration wins, so a conflict resolves deterministically (BR-004).
      if (!m.has(binding)) m.set(binding, c.id)
    }
    return m
  }, [overrides])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isTypingTarget(e)) return
      const combo = captureBinding(e)
      if (!combo || NEVER_DISPATCH.has(combo)) return
      const id = bindingMap.get(combo)
      // Leave unmatched keys completely alone — no preventDefault.
      if (!id) return
      e.preventDefault()
      e.stopPropagation()
      runCommand(id)
    }
    // Capture phase on documentElement: Monaco's internal keybindings otherwise
    // swallow the event before it reaches us while the editor has focus.
    document.documentElement.addEventListener('keydown', onKeyDown, { capture: true })
    return () =>
      document.documentElement.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [bindingMap])
}
