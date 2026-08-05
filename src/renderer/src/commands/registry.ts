import { editorRegistry } from '../utils/editorRegistry'
import { useUIStore } from '../store/uiStore'
import { fileOpsRegistry } from './fileOpsRegistry'
import { COMMANDS } from './definitions'
import { contributedCommands } from './contributions'
import type { CommandContext, CommandDef } from './types'

/**
 * Lookup and invocation for the command registry. Every dispatch path — the
 * palette, the keyboard dispatcher, the menus — goes through `runCommand`, so a
 * command has exactly one implementation.
 *
 * This module deliberately imports no binding helpers from
 * `utils/shortcutCatalog`: that module derives its catalog from `definitions`,
 * and importing it back here would close the cycle.
 */

export { COMMANDS }

/** Recent commands shown first on an empty palette query. Session-only (BR-009). */
const MRU_SIZE = 5
const mru: string[] = []

// A hand-written list this long is exactly where a copy-paste duplicate hides,
// and a duplicate id silently shadows whichever entry comes second.
{
  const seen = new Set<string>()
  const dupes: string[] = []
  for (const c of COMMANDS) {
    if (seen.has(c.id)) dupes.push(c.id)
    seen.add(c.id)
  }
  if (dupes.length) {
    console.error(`[commands] duplicate command ids: ${dupes.join(', ')}`)
  }
}

export function getContext(): CommandContext {
  return { editor: editorRegistry.get(), fileOps: fileOpsRegistry.get() }
}

/** Static definitions plus runtime contributions, deduped by id (static wins). */
export function allCommands(): CommandDef[] {
  const byId = new Set(COMMANDS.map((c) => c.id))
  return [...COMMANDS, ...contributedCommands().filter((c) => !byId.has(c.id))]
}

export function getCommand(id: string): CommandDef | undefined {
  return allCommands().find((c) => c.id === id)
}

/**
 * Commands currently runnable. A `when` predicate that throws is treated as
 * unavailable (US-012) — a broken predicate must not empty the palette.
 */
export function availableCommands(): CommandDef[] {
  const ctx = getContext()
  return allCommands().filter((c) => {
    if (c.paletteHidden) return false
    if (!c.when) return true
    try {
      return c.when(ctx)
    } catch (err) {
      console.warn(`[commands] when() threw for ${c.id}`, err)
      return false
    }
  })
}

/**
 * Look the command up, run it with a fresh context, and record it in the MRU.
 * A throwing handler is toasted rather than allowed to propagate — one broken
 * command must not take the palette down with it.
 */
export function runCommand(id: string): void {
  const cmd = getCommand(id)
  if (!cmd) {
    console.warn(`[commands] unknown command id: ${id}`)
    return
  }
  // Record before running: an async handler that rejects later has still been used.
  const at = mru.indexOf(id)
  if (at >= 0) mru.splice(at, 1)
  mru.unshift(id)
  if (mru.length > MRU_SIZE) mru.length = MRU_SIZE

  try {
    const result = cmd.run(getContext())
    if (result instanceof Promise) {
      result.catch((err) => reportFailure(cmd, err))
    }
  } catch (err) {
    reportFailure(cmd, err)
  }
}

function reportFailure(cmd: CommandDef, err: unknown): void {
  console.error(`[commands] ${cmd.id} failed`, err)
  useUIStore.getState().addToast(`"${cmd.label}" failed to run.`, 'error')
}

/** Newest first, at most MRU_SIZE. */
export function recentCommandIds(): string[] {
  return [...mru]
}
