import { closeSync, mkdirSync, openSync } from 'node:fs'
import { basename, join } from 'node:path'
import { appendCollisionSuffix, requireSafeFileName } from '../ipc/AttachmentDownloadService.js'

export function browserDownloadFileName(input: string) {
  const candidate = basename(input.replaceAll('\\', '/'))
    .replace(/[<>:"|?*\x00-\x1f\x7f]/g, '_')
    .replace(/[ .]+$/, '')
    .slice(0, 240)
  try {
    return requireSafeFileName(candidate)
  } catch {
    return 'download'
  }
}
export function reserveBrowserDownloadPath(directory: string, input: string) {
  const fileName = browserDownloadFileName(input)
  mkdirSync(directory, { recursive: true })
  for (let suffix = 0; suffix <= 9999; suffix++) {
    const path = join(directory, suffix ? appendCollisionSuffix(fileName, suffix) : fileName)
    try {
      closeSync(openSync(path, 'wx'))
      return path
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST')
        throw new Error('下载位置不可用')
    }
  }
  throw new Error('下载文件重名过多')
}
