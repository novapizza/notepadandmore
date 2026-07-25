import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { useUIStore } from '../store/uiStore'

/**
 * Document-level drag-and-drop for opening files / setting workspace folder.
 *
 * Behavior (matches VSCode-style drop):
 *  - Files dropped → opened as tabs.
 *  - Folder dropped → replaces current workspace (with confirm dialog if a
 *    workspace was already set).
 *  - Mixed drop → both happen.
 *  - >1 folder → first wins, toast warns about the rest.
 */
export function useFileDrop(openFiles: (paths: string[]) => Promise<void>): { dragActive: boolean } {
  const [dragActive, setDragActive] = useState(false)
  // Counter compensates for dragenter/leave firing on every child element as
  // the cursor moves; only the outermost enter/leave should toggle the overlay.
  const dragDepth = useRef(0)

  const handleDrop = useCallback(async (e: DragEvent) => {
    // Child handlers (e.g. CsvViewer's CSV loader) signal they consumed the
    // drop by calling preventDefault during the bubble phase. Don't double-open.
    if (e.defaultPrevented) {
      dragDepth.current = 0
      setDragActive(false)
      return
    }
    if (!e.dataTransfer?.files.length) return
    e.preventDefault()
    dragDepth.current = 0
    setDragActive(false)

    const paths: string[] = []
    for (const f of Array.from(e.dataTransfer.files)) {
      const p = window.api.file.pathForFile(f)
      if (p) paths.push(p)
    }
    if (paths.length === 0) return

    const stats = await Promise.all(
      paths.map((p) => window.api.file.stat(p).then((s) => ({ p, ...s })))
    )
    const filePaths = stats.filter((s) => s.exists && !s.isDir).map((s) => s.p)
    const folderPaths = stats.filter((s) => s.exists && s.isDir).map((s) => s.p)

    if (folderPaths.length > 1) {
      useUIStore
        .getState()
        .addToast('Only one folder can be opened at a time. Opened the first.', 'warn')
    }

    if (filePaths.length) {
      await openFiles(filePaths)
    }

    if (folderPaths.length) {
      const newFolder = folderPaths[0]
      const ui = useUIStore.getState()
      const current = ui.workspaceFolder
      if (current && current !== newFolder) {
        const dirty = useEditorStore.getState().buffers.filter((b) => b.isDirty).length
        const ok = await window.api.dialog.confirm(
          `Switch workspace to:\n${newFolder}?`,
          dirty > 0 ? `${dirty} unsaved file(s) will remain open.` : undefined,
          'Switch'
        )
        if (!ok) return
      }
      ui.setWorkspaceFolder(newFolder)
      ui.setShowSidebar(true)
      ui.setSidebarPanel('files')
    }
  }, [openFiles])

  useEffect(() => {
    const isFileDrag = (e: DragEvent): boolean =>
      // Browser exposes 'Files' in types when an OS file/folder is being dragged.
      // Internal HTML drags (tab reorder, text selection) won't include it.
      !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')

    const onDragEnter = (e: DragEvent): void => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      dragDepth.current++
      if (dragDepth.current === 1) setDragActive(true)
    }
    const onDragOver = (e: DragEvent): void => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (e: DragEvent): void => {
      if (!isFileDrag(e)) return
      dragDepth.current--
      if (dragDepth.current <= 0) {
        dragDepth.current = 0
        setDragActive(false)
      }
    }
    const onDrop = (e: DragEvent): void => {
      void handleDrop(e)
    }

    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
    }
  }, [handleDrop])

  return { dragActive }
}
