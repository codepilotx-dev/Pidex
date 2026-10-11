import type { DesktopProjectFolder } from '../../../shared/Types.js'

export type ProjectFolderSaveDraft = Pick<DesktopProjectFolder, 'path' | 'role'> & {
  originalId: string | null
}

export function projectFolderPaths(folders: readonly ProjectFolderSaveDraft[]): string[] {
  return [
    ...folders.filter((folder) => folder.role === 'primary'),
    ...folders.filter((folder) => folder.role !== 'primary'),
  ].map((folder) => folder.path)
}
