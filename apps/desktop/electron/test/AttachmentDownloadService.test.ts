import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AttachmentDownloadService,
  decodeAttachmentContent,
  requireSafeFileName,
} from '../src/ipc/AttachmentDownloadService'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('用户附件下载服务', () => {
  test('使用注入的 Downloads 目录并按原字节保存 UTF-8 与 Base64', async () => {
    const downloadsDirectory = await createTemporaryDownloads()
    const service = new AttachmentDownloadService({
      getDownloadsDirectory: () => downloadsDirectory,
    })

    await service.save({
      kind: 'text',
      name: '你好.txt',
      mediaType: 'text/plain',
      encoding: 'utf8',
      data: '你好，Pidex',
    })
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])
    await service.save({
      kind: 'image',
      name: 'image.png',
      mediaType: 'image/png',
      encoding: 'base64',
      data: pngBytes.toString('base64'),
    })

    expect(await readFile(join(downloadsDirectory, '你好.txt'), 'utf8')).toBe('你好，Pidex')
    expect(await readFile(join(downloadsDirectory, 'image.png'))).toEqual(pngBytes)
  })

  test('同名文件使用安全序号且不覆盖原内容', async () => {
    const downloadsDirectory = await createTemporaryDownloads()
    const service = new AttachmentDownloadService({
      getDownloadsDirectory: () => downloadsDirectory,
    })
    const save = (data: string) =>
      service.save({
        kind: 'text' as const,
        name: 'notes.txt',
        mediaType: 'text/plain',
        encoding: 'utf8' as const,
        data,
      })

    expect(await save('first')).toEqual({ fileName: 'notes.txt' })
    expect(await save('second')).toEqual({ fileName: 'notes (1).txt' })
    expect(await save('third')).toEqual({ fileName: 'notes (2).txt' })
    expect(await readFile(join(downloadsDirectory, 'notes.txt'), 'utf8')).toBe('first')
  })

  test('拒绝路径穿越、Windows 保留名和危险结尾', () => {
    for (const name of ['../secret.txt', 'folder\\file.txt', 'CON', 'LPT1.log', '.', 'note. ']) {
      expect(() => requireSafeFileName(name)).toThrow('附件名称无效')
    }
  })

  test('拒绝非法编码、类型、Base64 和超限内容', () => {
    expect(() =>
      decodeAttachmentContent({
        kind: 'image',
        name: 'bad.png',
        mediaType: 'image/png',
        encoding: 'base64',
        data: 'not base64!',
      }),
    ).toThrow('附件数据无效')
    expect(() =>
      decodeAttachmentContent({
        kind: 'image',
        name: 'bad.png',
        mediaType: 'image/png',
        encoding: 'utf8',
        data: 'bad',
      }),
    ).toThrow('附件数据无效')
    expect(() =>
      decodeAttachmentContent({
        kind: 'text',
        name: 'large.txt',
        mediaType: 'text/plain',
        encoding: 'utf8',
        data: 'x'.repeat(1024 * 1024 + 1),
      }),
    ).toThrow('附件数据无效')
    expect(() =>
      decodeAttachmentContent({
        kind: 'binary',
        name: 'bad.bin',
        mediaType: 'application/octet-stream',
        encoding: 'base64',
        data: 'AA==',
      }),
    ).toThrow('附件数据无效')
  })
})

async function createTemporaryDownloads(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'pidex-attachment-'))
  temporaryDirectories.push(directory)
  return directory
}
