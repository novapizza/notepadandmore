import type { FileOpsHandle } from './types'

/**
 * Module-level singleton bridging the `useFileOps()` handle out of App.tsx, so
 * command handlers — which are plain functions, not React components — can
 * reach it. Same problem and same solution as `utils/editorRegistry.ts`.
 */
let _fileOps: FileOpsHandle | null = null

export const fileOpsRegistry = {
  set(f: FileOpsHandle | null): void {
    _fileOps = f
  },
  get(): FileOpsHandle | null {
    return _fileOps
  }
}
