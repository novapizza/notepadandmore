import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ChevronRight, ChevronDown, FolderOpen, Folder, FileText, RefreshCw } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../ui/context-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { useUIStore } from '../../store/uiStore'
import { useFileOps } from '../../hooks/useFileOps'
import { cn } from '../../lib/utils'

interface TreeNode {
  name: string
  path: string
  isDir: boolean
  children?: TreeNode[]
}

function parentDir(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  return normalized.substring(0, normalized.lastIndexOf('/')) || normalized
}

function joinPath(dir: string, name: string): string {
  const normalized = dir.replace(/\\/g, '/')
  return normalized.endsWith('/') ? normalized + name : normalized + '/' + name
}

async function loadChildren(dirPath: string): Promise<TreeNode[]> {
  const entries = await window.api.file.listDir(dirPath)
  return [...entries]
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    .map((e) => ({ name: e.name, path: e.path, isDir: e.isDir }))
}

function updateNodeChildren(nodes: TreeNode[], targetPath: string, children: TreeNode[]): TreeNode[] {
  return nodes.map((n) => {
    if (n.path === targetPath) return { ...n, children }
    if (n.children) return { ...n, children: updateNodeChildren(n.children, targetPath, children) }
    return n
  })
}

/** Inline editing state + commit/cancel callbacks, threaded through the tree. */
interface EditApi {
  /** Path of the node whose label is currently an editable rename input. */
  renamingPath: string | null
  /** Pending new entry: which directory and whether file or folder. */
  creating: { dir: string; kind: 'file' | 'folder' } | null
  commitRename: (node: TreeNode, name: string) => void
  commitCreate: (name: string) => void
  cancelEdit: () => void
}

/**
 * VSCode-style inline name editor used for Rename and New File/Folder.
 * Electron has no working window.prompt(), so we edit in place instead.
 */
function InlineEditInput({
  depth,
  isDir,
  initialValue,
  selectBasename,
  onCommit,
  onCancel,
}: {
  depth: number
  isDir: boolean
  initialValue: string
  selectBasename: boolean
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    // Select the basename (minus extension) for file renames, like VSCode.
    const dot = initialValue.lastIndexOf('.')
    if (selectBasename && dot > 0) el.setSelectionRange(0, dot)
    else el.select()
  }, [initialValue, selectBasename])

  return (
    <div
      className="w-full flex items-center gap-1.5 py-1 text-base"
      style={{ paddingLeft: depth * 14 + 10 }}
    >
      <span className="shrink-0 w-[18px]" />
      <span className="shrink-0 text-primary flex items-center justify-center">
        {isDir ? <Folder size={18} /> : <FileText size={18} className="text-tab-muted" />}
      </span>
      <input
        ref={ref}
        data-testid="inline-edit-input"
        defaultValue={initialValue}
        spellCheck={false}
        autoComplete="off"
        className="flex-1 min-w-0 bg-input text-foreground border border-primary rounded px-1 py-0 text-base outline-none"
        onClick={(e) => e.stopPropagation()}
        onBlur={() => onCancel()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            onCommit(ref.current?.value ?? '')
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
      />
    </div>
  )
}

interface TreeNodeRowProps {
  node: TreeNode
  depth: number
  expanded: Set<string>
  edit: EditApi
  onToggle: (node: TreeNode) => void
  onOpen: (node: TreeNode) => void
  onContextMenu: (node: TreeNode) => void
  handleNewFile: (node: TreeNode) => void
  handleNewFolder: (node: TreeNode) => void
  handleRename: (node: TreeNode) => void
  handleDelete: (node: TreeNode) => void
  handleCopyPath: (node: TreeNode) => void
  handleReveal: (node: TreeNode) => void
}

function TreeNodeRow({ node, depth, expanded, edit, onToggle, onOpen, onContextMenu, handleNewFile, handleNewFolder, handleRename, handleDelete, handleCopyPath, handleReveal }: TreeNodeRowProps) {
  const isRenaming = edit.renamingPath === node.path
  const showCreateRow = node.isDir && expanded.has(node.path) && edit.creating?.dir === node.path
  return (
    <>
      {isRenaming ? (
        <InlineEditInput
          depth={depth}
          isDir={node.isDir}
          initialValue={node.name}
          selectBasename={!node.isDir}
          onCommit={(v) => edit.commitRename(node, v)}
          onCancel={edit.cancelEdit}
        />
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className="w-full flex items-center gap-1.5 py-1 text-base transition-colors hover:bg-explorer-hover cursor-pointer text-explorer-foreground"
              style={{ paddingLeft: depth * 14 + 10 }}
              onClick={() => (node.isDir ? onToggle(node) : onOpen(node))}
              title={node.path}
            >
              <span className="shrink-0 w-[18px] flex justify-center text-muted-foreground">
                {node.isDir ? (
                  expanded.has(node.path) ? <ChevronDown size={18} /> : <ChevronRight size={18} />
                ) : null}
              </span>
              <span className="shrink-0 text-primary flex items-center justify-center">
                {node.isDir ? (
                  expanded.has(node.path) ? <FolderOpen size={18} /> : <Folder size={18} />
                ) : (
                  <FileText size={18} className="text-tab-muted" />
                )}
              </span>
              <span className="truncate">{node.name}</span>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-48">
            {!node.isDir && (
              <>
                <ContextMenuItem onClick={() => onOpen(node)}>Open</ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuItem onClick={() => handleRename(node)}>Rename</ContextMenuItem>
            <ContextMenuItem onClick={() => handleCopyPath(node)}>Copy Path</ContextMenuItem>
            <ContextMenuItem onClick={() => handleReveal(node)}>
              Reveal in {window.api.platform === 'darwin' ? 'Finder' : 'Explorer'}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => handleNewFile(node)}>New File…</ContextMenuItem>
            <ContextMenuItem onClick={() => handleNewFolder(node)}>New Folder…</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => handleDelete(node)}>Delete</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )}
      {node.isDir && expanded.has(node.path) && (
        <>
          {showCreateRow && (
            <InlineEditInput
              depth={depth + 1}
              isDir={edit.creating!.kind === 'folder'}
              initialValue=""
              selectBasename={false}
              onCommit={(v) => edit.commitCreate(v)}
              onCancel={edit.cancelEdit}
            />
          )}
          {node.children?.map((child) => (
            <TreeNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              edit={edit}
              onToggle={onToggle}
              onOpen={onOpen}
              onContextMenu={onContextMenu}
              handleNewFile={handleNewFile}
              handleNewFolder={handleNewFolder}
              handleRename={handleRename}
              handleDelete={handleDelete}
              handleCopyPath={handleCopyPath}
              handleReveal={handleReveal}
            />
          ))}
        </>
      )}
    </>
  )
}

export function FileBrowserPanel() {
  const { workspaceFolder, setWorkspaceFolder, setSidebarPanel, expandedFolders, setExpandedFolders } = useUIStore()
  const { openFiles, updateRenamedBuffer } = useFileOps()
  const [tree, setTree] = useState<TreeNode[]>([])
  // expandedFolders lives in uiStore so it can be persisted across sessions.
  const expanded = useMemo(() => new Set(expandedFolders), [expandedFolders])
  // Inline editing state (Electron has no working window.prompt()).
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [creating, setCreating] = useState<{ dir: string; kind: 'file' | 'folder' } | null>(null)

  // Load root when workspaceFolder changes, rebuilding the tree so any
  // previously-expanded folders (restored from a saved session) are re-loaded
  // and shown expanded. Reads expandedFolders via getState() so this effect
  // only re-runs on workspaceFolder change, not on every toggle.
  useEffect(() => {
    if (!workspaceFolder) { setTree([]); return }
    let cancelled = false
    const norm = (p: string) => p.replace(/\\/g, '/')
    const rootNorm = norm(workspaceFolder)
    const toExpand = useUIStore.getState().expandedFolders
      .filter((p) => {
        const n = norm(p)
        return n !== rootNorm && n.startsWith(rootNorm + '/')
      })
      // Shallow → deep so each parent is in the tree before we merge its child.
      .sort((a, b) => norm(a).split('/').length - norm(b).split('/').length)
    ;(async () => {
      let nextTree = await loadChildren(workspaceFolder)
      if (cancelled) return
      for (const p of toExpand) {
        try {
          const children = await loadChildren(p)
          if (cancelled) return
          nextTree = updateNodeChildren(nextTree, p, children)
        } catch {
          // Folder may have been deleted/renamed since save — skip it.
        }
      }
      if (!cancelled) setTree(nextTree)
    })()
    return () => { cancelled = true }
  }, [workspaceFolder])

  const handleToggle = useCallback(async (node: TreeNode) => {
    const next = new Set(useUIStore.getState().expandedFolders)
    if (next.has(node.path)) {
      next.delete(node.path)
    } else {
      next.add(node.path)
      if (!node.children) {
        const children = await loadChildren(node.path)
        setTree((prev) => updateNodeChildren(prev, node.path, children))
      }
    }
    setExpandedFolders(Array.from(next))
  }, [setExpandedFolders])

  const handleOpen = useCallback((node: TreeNode) => {
    openFiles([node.path])
  }, [openFiles])

  const refreshParent = useCallback(async (nodePath: string) => {
    const dir = nodePath === workspaceFolder ? workspaceFolder : parentDir(nodePath)
    if (!dir) return
    const children = await loadChildren(dir)
    if (dir === workspaceFolder) {
      setTree(children)
    } else {
      setTree((prev) => updateNodeChildren(prev, dir, children))
    }
  }, [workspaceFolder])

  const handleRefresh = useCallback(async () => {
    if (!workspaceFolder) return
    const children = await loadChildren(workspaceFolder)
    setTree(children)
  }, [workspaceFolder])

  // Start an inline "new entry" input inside `node`'s directory: expand the
  // target dir (loading its children if needed) so the input row is visible.
  const startCreate = useCallback(async (node: TreeNode, kind: 'file' | 'folder') => {
    const dir = node.isDir ? node.path : parentDir(node.path)
    setRenamingPath(null)
    if (dir !== workspaceFolder) {
      const current = useUIStore.getState().expandedFolders
      if (!current.includes(dir)) setExpandedFolders([...current, dir])
      const children = await loadChildren(dir)
      setTree((prev) => updateNodeChildren(prev, dir, children))
    }
    setCreating({ dir, kind })
  }, [workspaceFolder, setExpandedFolders])

  const handleNewFile = useCallback((node: TreeNode) => { void startCreate(node, 'file') }, [startCreate])
  const handleNewFolder = useCallback((node: TreeNode) => { void startCreate(node, 'folder') }, [startCreate])
  const handleRename = useCallback((node: TreeNode) => { setCreating(null); setRenamingPath(node.path) }, [])

  const cancelEdit = useCallback(() => { setRenamingPath(null); setCreating(null) }, [])

  const commitRename = useCallback(async (node: TreeNode, newName: string) => {
    setRenamingPath(null)
    const trimmed = newName.trim()
    if (!trimmed || trimmed === node.name) return
    const newPath = joinPath(parentDir(node.path), trimmed)
    const result = await window.api.file.rename(node.path, newPath)
    if (result.error) { void window.api.dialog.alert('Error', result.error); return }
    // Keep any open tab pointing at the renamed file in sync.
    if (!node.isDir) updateRenamedBuffer(node.path, newPath)
    await refreshParent(node.path)
  }, [refreshParent, updateRenamedBuffer])

  const commitCreate = useCallback(async (name: string) => {
    const pending = creating
    setCreating(null)
    if (!pending) return
    const trimmed = name.trim()
    if (!trimmed) return
    const fp = joinPath(pending.dir, trimmed)
    const result = pending.kind === 'file'
      ? await window.api.file.create(fp)
      : await window.api.file.mkdir(fp)
    if (result.error) { void window.api.dialog.alert('Error', result.error); return }
    await refreshParent(fp)
    if (pending.kind === 'file') openFiles([fp])
  }, [creating, refreshParent, openFiles])

  const handleDelete = useCallback(async (node: TreeNode) => {
    const ok = await window.api.dialog.confirm(
      `Delete "${node.name}"?`,
      'This cannot be undone.',
      'Delete'
    )
    if (!ok) return
    const result = await window.api.file.delete(node.path)
    if (result.error) { void window.api.dialog.alert('Error', result.error); return }
    await refreshParent(node.path)
  }, [refreshParent])

  const handleCopyPath = useCallback((node: TreeNode) => {
    navigator.clipboard.writeText(node.path)
  }, [])

  const handleReveal = useCallback((node: TreeNode) => {
    window.api.file.reveal(node.path)
  }, [])

  const handleOpenFolder = async () => {
    const result = await window.api.file.openDirDialog()
    if (!result) return
    // Opening a fresh folder: drop any expanded paths from the previous root.
    setExpandedFolders([])
    setWorkspaceFolder(result)
    setSidebarPanel('files')
  }

  const edit: EditApi = { renamingPath, creating, commitRename, commitCreate, cancelEdit }

  if (!workspaceFolder) {
    return (
      <div className="flex flex-col h-full overflow-hidden text-foreground">
        <div className="flex flex-col items-center justify-center flex-1 gap-2.5 p-4 text-muted-foreground text-base text-center">
          <button
            className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 border-none cursor-pointer"
            onClick={handleOpenFolder}
          >
            Open Folder…
          </button>
          <p>Open a folder to browse files.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden text-foreground relative">
      <div className="flex items-center justify-between text-sm font-semibold uppercase tracking-wider text-muted-foreground px-3 py-1.5 shrink-0">
        <span>{workspaceFolder.replace(/\\/g, '/').split('/').pop()}</span>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="bg-transparent border-none cursor-pointer text-muted-foreground p-1 rounded hover:text-foreground hover:bg-secondary"
                onClick={handleRefresh}
              >
                <RefreshCw size={18} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-base">Refresh</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden editor-scrollbar select-none py-1">
        {/* New File/Folder created directly at the workspace root. */}
        {creating?.dir === workspaceFolder && (
          <InlineEditInput
            depth={0}
            isDir={creating.kind === 'folder'}
            initialValue=""
            selectBasename={false}
            onCommit={commitCreate}
            onCancel={cancelEdit}
          />
        )}
        {tree.length === 0 && creating?.dir !== workspaceFolder ? (
          <div className="p-4 text-muted-foreground text-sm text-center">Empty folder</div>
        ) : (
          tree.map((node) => (
            <TreeNodeRow
              key={node.path}
              node={node}
              depth={0}
              expanded={expanded}
              edit={edit}
              onToggle={handleToggle}
              onOpen={handleOpen}
              onContextMenu={() => {}}
              handleNewFile={handleNewFile}
              handleNewFolder={handleNewFolder}
              handleRename={handleRename}
              handleDelete={handleDelete}
              handleCopyPath={handleCopyPath}
              handleReveal={handleReveal}
            />
          ))
        )}
      </div>
    </div>
  )
}
