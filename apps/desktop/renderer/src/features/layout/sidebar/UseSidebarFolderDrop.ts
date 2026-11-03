import { useRef, useState, type DragEvent } from 'react'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { normalizePathForComparison } from '../../../utils/PathUtils.js'
import { toUserErrorMessage } from '../../../utils/Errors.js'
import { notifyProjectCatalogChanged } from '../../projects/ProjectCatalogEvents.js'

export async function openSidebarDroppedFolders(
  files: readonly File[],
  onError: (message: string) => void,
): Promise<void> {
  const seen = new Set<string>()
  for (const file of files) {
    try {
      const path = desktopClient.getComposerFilePath(file)
      if (!path) {
        onError('无法获取拖入文件夹的本地路径，请使用添加项目。')
        continue
      }
      const key = normalizePathForComparison(path)
      if (seen.has(key)) continue
      seen.add(key)
      await desktopClient.openWorkspace(path)
      notifyProjectCatalogChanged()
    } catch (error) {
      onError(toUserErrorMessage(error))
    }
  }
}

export function useSidebarFolderDrop(enabled: boolean, onError: (message: string) => void) {
  const [isDragActive, setDragActive] = useState(false)
  const depth = useRef(0)
  function reset(): void {
    depth.current = 0
    setDragActive(false)
  }
  function accepts(event: DragEvent<HTMLElement>): boolean {
    return enabled && !event.defaultPrevented && event.dataTransfer.types.includes('Files')
  }
  return {
    isDragActive,
    dropHandlers: {
      onDragEnter(event: DragEvent<HTMLElement>): void {
        if (!accepts(event)) return
        event.preventDefault()
        depth.current += 1
        setDragActive(true)
      },
      onDragOver(event: DragEvent<HTMLElement>): void {
        if (!accepts(event)) {
          reset()
          return
        }
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setDragActive(true)
      },
      onDragLeave(): void {
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDragActive(false)
      },
      onDrop(event: DragEvent<HTMLElement>): void {
        const accepted = accepts(event)
        reset()
        if (!accepted) return
        event.preventDefault()
        void openSidebarDroppedFolders(Array.from(event.dataTransfer.files), onError)
      },
      onDragEnd: reset,
    },
  }
}
