import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import type { DesktopFilePreview } from '../shared/Types.js'
import {
  checkFileDocumentForExternalChange,
  fileDocumentLoadErrorMessage,
  fileDocumentKey,
  prefetchFileDocument,
  saveAllFileDocuments,
  startFileDocumentExternalChecks,
  updateFileDocument,
} from '../src/features/workspace/FileDocumentStore.js'
import { desktopClient } from '../src/services/desktop-client/index.js'

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')

afterEach(() => {
  restoreGlobal('window', originalWindowDescriptor)
  restoreGlobal('document', originalDocumentDescriptor)
})

describe('file document external checks', () => {
  test('maps safe RPC codes to actionable file errors', () => {
    expect(fileDocumentLoadErrorMessage('PROJECT_FOLDER_NOT_FOUND', 'raw path')).toEqual({
      code: 'PROJECT_FOLDER_NOT_FOUND',
      message: '文件所属的项目目录已失效，请重新打开项目后再试。',
      retryable: true,
    })
    expect(fileDocumentLoadErrorMessage('FILE_NOT_TEXT', 'raw path')).toEqual({
      code: 'FILE_NOT_TEXT',
      message: '该文件不是受支持的文本文件。',
      retryable: false,
    })
  })

  test('uses project and folder identity to isolate identical relative paths', () => {
    const workspacePath = 'C:\\shared'
    const path = 'README.md'
    const first = fileDocumentKey(workspacePath, path, {
      projectId: 'project-a',
      folderId: 'folder-a',
    })
    expect(
      fileDocumentKey(workspacePath, path, {
        projectId: 'project-b',
        folderId: 'folder-a',
      }),
    ).not.toBe(first)
    expect(
      fileDocumentKey(workspacePath, path, {
        projectId: 'project-a',
        folderId: 'folder-b',
      }),
    ).not.toBe(first)
  })

  test('save all forwards only the stable project and folder scope', async () => {
    const workspacePath = 'C:\\workspace\\save-all-scope'
    const path = 'src\\scope.ts'
    const scope = { projectId: 'project-a', folderId: 'folder-a' }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { setTimeout: () => 1, clearTimeout: () => undefined },
    })
    const read = spyOn(desktopClient, 'readWorkspaceFile').mockResolvedValue(
      preview(path, 'const value = 1', 1),
    )
    const save = spyOn(desktopClient, 'saveWorkspaceFile').mockResolvedValue({
      outcome: 'saved',
      revision: { mtimeMs: 2, sha256: 'sha-2' },
    })

    await prefetchFileDocument(workspacePath, path, scope)
    updateFileDocument(workspacePath, path, 'const value = 2', scope)
    await expect(saveAllFileDocuments()).resolves.toBe(true)

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath,
        filePath: path,
        projectId: 'project-a',
        folderId: 'folder-a',
      }),
    )
    read.mockRestore()
    save.mockRestore()
  })

  test('retries a prefetch after the first load promise rejects', async () => {
    const workspacePath = 'C:\\workspace\\prefetch-retry'
    const path = 'src\\retry.ts'
    const loaded = preview(path, 'export const retried = true', 1)
    const read = spyOn(desktopClient, 'readWorkspaceFile')
      .mockRejectedValueOnce(new Error('首次读取失败'))
      .mockResolvedValueOnce(loaded)

    await expect(prefetchFileDocument(workspacePath, path)).rejects.toThrow('首次读取失败')
    await expect(checkFileDocumentForExternalChange(workspacePath, path)).resolves.toEqual({
      status: 'skipped',
    })
    expect(read).toHaveBeenCalledTimes(1)

    await expect(prefetchFileDocument(workspacePath, path)).resolves.toMatchObject({
      status: 'ready',
      baseContent: loaded.content,
      draftContent: loaded.content,
      loadError: null,
    })
    expect(read).toHaveBeenCalledTimes(2)
    read.mockRestore()
  })

  test('skips documents that have not been loaded', async () => {
    const read = spyOn(desktopClient, 'readWorkspaceFile')
    const result = await checkFileDocumentForExternalChange('C:\\workspace', 'not-loaded.ts')

    expect(result).toEqual({ status: 'skipped' })
    expect(read).not.toHaveBeenCalled()
    read.mockRestore()
  })

  test('keeps ready content and save state when an external read fails', async () => {
    const workspacePath = 'C:\\workspace\\unavailable'
    const path = 'src\\ready.ts'
    const initial = preview(path, 'const ready = true', 1)
    const read = spyOn(desktopClient, 'readWorkspaceFile')
      .mockResolvedValueOnce(initial)
      .mockRejectedValueOnce(new Error('文件不存在'))

    await expect(prefetchFileDocument(workspacePath, path)).resolves.toMatchObject({
      status: 'ready',
      baseContent: initial.content,
      draftContent: initial.content,
      saveError: null,
    })

    const result = await checkFileDocumentForExternalChange(workspacePath, path)
    expect(result).toMatchObject({
      status: 'unavailable',
      error: expect.objectContaining({ message: '文件不存在' }),
    })
    await expect(prefetchFileDocument(workspacePath, path)).resolves.toMatchObject({
      status: 'ready',
      baseContent: initial.content,
      draftContent: initial.content,
      saveError: null,
      loadError: null,
    })
    read.mockRestore()
  })

  test('reports one load error per unavailable streak and resets after success', async () => {
    const workspacePath = 'C:\\workspace\\notifications'
    const path = 'src\\watched.ts'
    const initial = preview(path, 'export const watched = true', 1)
    const read = spyOn(desktopClient, 'readWorkspaceFile')
      .mockResolvedValueOnce(initial)
      .mockRejectedValueOnce(new Error('第一次失败'))
      .mockRejectedValueOnce(new Error('第二次失败'))
      .mockResolvedValueOnce(initial)
      .mockRejectedValueOnce(new Error('恢复后再次失败'))
    const watch = spyOn(desktopClient, 'watchWorkspaceFile').mockResolvedValue(undefined)
    const unwatch = spyOn(desktopClient, 'unwatchWorkspaceFile').mockResolvedValue(undefined)
    const windowHarness = installWindowHarness()
    await prefetchFileDocument(workspacePath, path)

    const errors: string[] = []
    const stop = startFileDocumentExternalChecks(workspacePath, path, {
      onLoadError: (error) => errors.push(error.message),
    })

    await windowHarness.dispatch('focus')
    expect(errors).toEqual(['第一次失败'])

    await windowHarness.dispatch('focus')
    expect(errors).toEqual(['第一次失败'])

    await windowHarness.dispatch('focus')
    expect(errors).toEqual(['第一次失败'])

    await windowHarness.dispatch('focus')
    expect(errors).toEqual(['第一次失败', '恢复后再次失败'])

    stop()
    expect(watch).toHaveBeenCalledWith(workspacePath, path)
    expect(unwatch).toHaveBeenCalledWith(workspacePath, path)
    read.mockRestore()
    watch.mockRestore()
    unwatch.mockRestore()
  })

  test('releases a watcher that finishes installing after cleanup', async () => {
    const workspacePath = 'C:\\workspace\\delayed-watch'
    const path = 'src\\watched.ts'
    let finishWatch!: () => void
    const pendingWatch = new Promise<void>((resolve) => {
      finishWatch = resolve
    })
    const watch = spyOn(desktopClient, 'watchWorkspaceFile').mockReturnValue(pendingWatch)
    const unwatch = spyOn(desktopClient, 'unwatchWorkspaceFile').mockResolvedValue(undefined)
    installWindowHarness()

    const stop = startFileDocumentExternalChecks(workspacePath, path)
    stop()
    stop()
    expect(unwatch).not.toHaveBeenCalled()

    finishWatch()
    await pendingWatch
    await Promise.resolve()

    expect(unwatch).toHaveBeenCalledTimes(1)
    expect(unwatch).toHaveBeenCalledWith(workspacePath, path)
    watch.mockRestore()
    unwatch.mockRestore()
  })
})

function preview(path: string, content: string, version: number): DesktopFilePreview {
  return {
    path,
    content,
    sizeBytes: content.length,
    readonly: false,
    revision: {
      mtimeMs: version,
      sha256: `sha-${version}`,
    },
  }
}

function installWindowHarness(): {
  dispatch: (type: string) => Promise<void>
} {
  const listeners = new Map<string, Set<EventListener>>()
  const fakeWindow = {
    addEventListener(type: string, listener: EventListener) {
      const bucket = listeners.get(type) ?? new Set<EventListener>()
      bucket.add(listener)
      listeners.set(type, bucket)
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.get(type)?.delete(listener)
    },
    setInterval: () => 1,
    clearInterval: () => undefined,
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: fakeWindow,
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { visibilityState: 'visible' },
  })

  return {
    async dispatch(type) {
      for (const listener of listeners.get(type) ?? []) {
        listener(new Event(type))
      }
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

function restoreGlobal(
  key: 'window' | 'document',
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(globalThis, key, descriptor)
  } else {
    Reflect.deleteProperty(globalThis, key)
  }
}
