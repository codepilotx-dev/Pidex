import { expect, spyOn, test } from 'bun:test'
import { openSidebarDroppedFolders } from '../src/features/layout/sidebar/UseSidebarFolderDrop.js'
import { subscribeProjectCatalogChanges } from '../src/features/projects/ProjectCatalogEvents.js'
import { desktopClient } from '../src/services/desktop-client/index.js'

test('拖入目录按 Windows 路径去重，逐个复用打开项目并通知目录刷新', async () => {
  const files = [new File([], 'first'), new File([], 'duplicate'), new File([], 'second')]
  const paths = ['F:\\Project\\One', 'f:/project/one/', 'F:\\Project\\Two']
  const getPath = spyOn(desktopClient, 'getComposerFilePath')
    .mockImplementation((file) => paths[files.indexOf(file)]!)
  const opened: string[] = []
  const open = spyOn(desktopClient, 'openWorkspace').mockImplementation(async (path) => {
    opened.push(path)
    return { path, name: '项目', projectId: path }
  })
  let changes = 0
  const unsubscribe = subscribeProjectCatalogChanges(() => { changes += 1 })
  const errors: string[] = []
  try {
    await openSidebarDroppedFolders(files, (message) => errors.push(message))
    expect(opened).toEqual([paths[0]!, paths[2]!])
    expect(open.mock.calls).toEqual([[paths[0]!], [paths[2]!]])
    expect(changes).toBe(2)
    expect(errors).toEqual([])
  } finally {
    unsubscribe()
    getPath.mockRestore()
    open.mockRestore()
  }
})

test('无法读取路径或宿主拒绝文件时继续处理剩余目录，只刷新成功项', async () => {
  const files = [new File([], 'no-path'), new File([], 'file.txt'), new File([], 'folder')]
  const getPath = spyOn(desktopClient, 'getComposerFilePath')
    .mockImplementation((file) => file.name === 'no-path' ? '' : `F:/${file.name}`)
  const open = spyOn(desktopClient, 'openWorkspace').mockImplementation(async (path) => {
    if (path.endsWith('.txt')) throw new Error('所选路径不是可访问的目录')
    return { path, name: '项目', projectId: path }
  })
  let changes = 0
  const unsubscribe = subscribeProjectCatalogChanges(() => { changes += 1 })
  const errors: string[] = []
  try {
    await openSidebarDroppedFolders(files, (message) => errors.push(message))
    expect(open.mock.calls).toEqual([['F:/file.txt'], ['F:/folder']])
    expect(changes).toBe(1)
    expect(errors).toHaveLength(2)
  } finally {
    unsubscribe()
    getPath.mockRestore()
    open.mockRestore()
  }
})
