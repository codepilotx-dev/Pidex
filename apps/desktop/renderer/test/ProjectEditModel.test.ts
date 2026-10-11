import { expect, test } from 'bun:test'
import { projectFolderPaths } from '../src/features/projects/ProjectEditModel.js'

test('项目编辑允许空目录，并将主目录放在新聊天 roots 第一位', () => {
  expect(projectFolderPaths([])).toEqual([])
  expect(
    projectFolderPaths([
      { path: 'C:/secondary', role: 'secondary', originalId: 'secondary' },
      { path: 'D:/primary', role: 'primary', originalId: null },
    ]),
  ).toEqual(['D:/primary', 'C:/secondary'])
})
