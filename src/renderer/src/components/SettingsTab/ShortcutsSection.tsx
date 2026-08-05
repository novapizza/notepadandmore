import React, { useMemo, useState, useRef, useEffect } from 'react'
import { AlertTriangle, Lock, RotateCcw, Search, X } from 'lucide-react'
import { useConfigStore } from '../../store/configStore'
import {
  SHORTCUT_CATALOG,
  SHORTCUT_SECTIONS,
  captureBinding,
  formatBinding,
  resolveBinding,
} from '../../utils/shortcutCatalog'
import { cn } from '../../lib/utils'

/**
 * Shortcuts editor inside the Settings tab. Lists every command in the registry
 * that declares a default binding, grouped by section, and lets the user rebind
 * via a click-to-record input. Edits persist to `config.shortcuts` and take
 * effect immediately — `commands/useCommandKeys` derives its binding map from
 * exactly that value, so there is no restart and no second list to keep in sync.
 */

/**
 * Combos the renderer can't take over: they belong to Electron `role:` items or
 * to Electron itself, so accepting a rebind onto one would save a binding that
 * silently never fires.
 */
const RESERVED_COMBOS: Record<string, string> = {
  'Mod+Z': 'Undo',
  'Mod+Y': 'Redo',
  'Mod+X': 'Cut',
  'Mod+C': 'Copy',
  'Mod+V': 'Paste',
  'Mod+A': 'Select All',
  'F12': 'Developer Tools',
}

export function ShortcutsSection() {
  const shortcuts = useConfigStore((s) => s.shortcuts)
  const setProp = useConfigStore((s) => s.setProp)
  const [filter, setFilter] = useState('')
  const [rejected, setRejected] = useState<string | null>(null)

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return SHORTCUT_SECTIONS.map((section) => ({
      section,
      items: SHORTCUT_CATALOG.filter((s) => s.section === section).filter((s) => {
        if (!q) return true
        return (
          s.label.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          formatBinding(resolveBinding(s.id, shortcuts)).toLowerCase().includes(q)
        )
      }),
    })).filter((g) => g.items.length > 0)
  }, [filter, shortcuts])

  /**
   * Effective binding → the commands holding it, in catalog (declaration) order.
   * Computed over the whole catalog, not the filtered view, so a conflict with a
   * command the user has filtered out still shows up.
   */
  const conflicts = useMemo(() => {
    const byBinding = new Map<string, string[]>()
    for (const s of SHORTCUT_CATALOG) {
      // A native-key row can't conflict: nothing in the renderer dispatches it.
      if (s.nativeKey) continue
      const binding = resolveBinding(s.id, shortcuts)
      if (!binding) continue
      const list = byBinding.get(binding)
      if (list) list.push(s.label)
      else byBinding.set(binding, [s.label])
    }
    return byBinding
  }, [shortcuts])

  const setBinding = (id: string, combo: string | null) => {
    if (combo !== null && RESERVED_COMBOS[combo]) {
      setRejected(
        `${formatBinding(combo)} is reserved by the operating system for ${RESERVED_COMBOS[combo]} — pick another combination.`
      )
      return
    }
    setRejected(null)
    const next = { ...shortcuts }
    if (combo === null) delete next[id]
    else next[id] = combo
    setProp('shortcuts', next)
  }

  const resetAll = () => {
    if (Object.keys(shortcuts).length === 0) return
    setRejected(null)
    setProp('shortcuts', {})
  }

  return (
    <div className="flex flex-col gap-3 max-w-[680px]">
      <p className="text-sm text-muted-foreground -mt-1">
        Edit any binding by clicking the key field and pressing the new combo. <kbd>Esc</kbd> cancels;
        <kbd className="mx-1">Backspace</kbd> clears. Changes apply immediately — no restart.
      </p>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-[320px]">
          <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search commands or shortcuts…"
            className="w-full bg-input border border-border rounded pl-8 pr-7 py-1.5 text-sm text-foreground outline-none focus:border-ring"
          />
          {filter && (
            <button
              onClick={() => setFilter('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground"
              title="Clear filter"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button
          onClick={resetAll}
          disabled={Object.keys(shortcuts).length === 0}
          className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          title="Reset every binding to its default"
        >
          <RotateCcw size={14} />
          Reset all
        </button>
      </div>

      {rejected && (
        <div className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-500">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{rejected}</span>
        </div>
      )}

      {groups.length === 0 && (
        <div className="text-sm text-muted-foreground py-4">No matches.</div>
      )}

      {groups.map(({ section, items }) => (
        <section key={section} className="flex flex-col">
          <h3 className="text-sm font-semibold text-foreground mt-2 mb-1 pb-1 border-b border-border">
            {section}
          </h3>
          <div className="flex flex-col">
            {items.map((s) => {
              const isOverride = !!shortcuts[s.id]
              const binding = resolveBinding(s.id, shortcuts)
              const sharing = (conflicts.get(binding) ?? []).filter((l) => l !== s.label)
              return (
                <div key={s.id} className="flex flex-col py-1.5 group">
                  <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
                    <div className="text-sm text-foreground truncate" title={s.id}>
                      {s.label}
                    </div>
                    {s.nativeKey ? (
                      <span
                        className="min-w-[160px] px-2.5 py-1 text-sm rounded border border-border bg-secondary/40 text-muted-foreground text-right font-mono tabular-nums flex items-center justify-end gap-1.5"
                        title="Handled by the operating system or the editor itself — not rebindable"
                      >
                        <Lock size={12} className="shrink-0" />
                        {formatBinding(s.defaultKey)}
                      </span>
                    ) : (
                      <BindingInput
                        value={binding}
                        isOverride={isOverride}
                        onChange={(combo) => setBinding(s.id, combo)}
                      />
                    )}
                    <button
                      onClick={() => setBinding(s.id, null)}
                      disabled={!isOverride || s.nativeKey}
                      className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Reset to default"
                    >
                      <RotateCcw size={14} />
                    </button>
                  </div>
                  {sharing.length > 0 && (
                    <div className="flex items-start gap-1.5 mt-1 text-sm text-amber-600 dark:text-amber-500">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                      <span>
                        Also assigned to {sharing.join(', ')}. The first command in this list wins.
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

interface BindingInputProps {
  value: string
  isOverride: boolean
  onChange: (combo: string | null) => void
}

function BindingInput({ value, isOverride, onChange }: BindingInputProps) {
  const [recording, setRecording] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(false)
        setDraft(null)
        return
      }
      if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        // Clear (reset to default) when Backspace is pressed alone.
        onChange(null)
        setRecording(false)
        setDraft(null)
        return
      }
      const combo = captureBinding(e)
      if (!combo) {
        setDraft(null)
        return
      }
      // Commit the captured combo.
      onChange(combo)
      setRecording(false)
      setDraft(null)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true } as EventListenerOptions)
  }, [recording, onChange])

  const display = draft ? formatBinding(draft) : formatBinding(value)

  return (
    <button
      ref={ref}
      onClick={() => setRecording((v) => !v)}
      onBlur={() => { setRecording(false); setDraft(null) }}
      className={cn(
        'min-w-[160px] px-2.5 py-1 text-sm rounded border outline-none text-right font-mono tabular-nums',
        recording
          ? 'border-primary bg-primary/10 text-foreground'
          : isOverride
            ? 'border-amber-500/60 bg-amber-50 dark:bg-amber-500/10 text-foreground hover:bg-amber-100/60 dark:hover:bg-amber-500/20'
            : 'border-border bg-input text-foreground hover:bg-secondary'
      )}
      title={recording ? 'Press a key combination…' : 'Click to record a new binding'}
    >
      {recording ? <span className="text-muted-foreground">Press keys…</span> : display}
    </button>
  )
}
