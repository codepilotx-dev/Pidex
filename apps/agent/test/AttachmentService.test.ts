import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { ATTACHMENT_LIMITS, AttachmentService } from '../src/subagent/AttachmentService'

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)))

const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-attachments-'))
  paths.push(root)
  let sequence = 0
  return AttachmentService.open(root, { now: () => 100, id: () => `attachment-${++sequence}` })
}

const png = (size = 8) => {
  const data = new Uint8Array(size)
  data.set([137, 80, 78, 71, 13, 10, 26, 10])
  return data
}

describe('AttachmentService', () => {
  test('浏览器批注 JSON 与独立 PNG 经附件存储读取往返', async () => {
    const service = await setup()
    const json = JSON.stringify({
      format: 'pidex.browser-annotations',
      schemaVersion: 1,
      annotations: [{ id: 'one', body: '调整按钮', screenshotName: 'annotation.png' }],
    })
    const stored = await service.store([
      {
        kind: 'text',
        name: 'pidex-browser-annotations.json',
        mimeType: 'application/json',
        data: json,
      },
      { kind: 'image', name: 'annotation.png', mimeType: 'image/png', data: png() },
    ])
    expect((await service.readText(stored[0]!.id)).text).toBe(json)
    expect((await service.read(stored[1]!.id)).data).toEqual(png())
  })
  test('存储、校验、读取、绑定并清理孤儿附件', async () => {
    const service = await setup()
    const [text, image] = await service.store([
      { kind: 'text', name: '说明.txt', mimeType: 'text/plain; charset=utf-8', data: '你好 UTF-8' },
      { kind: 'image', name: 'preview.png', mimeType: 'image/png', data: png() },
    ])
    expect(text).toBeDefined()
    expect(image).toBeDefined()
    expect(text!.sha256).toBe(createHash('sha256').update('你好 UTF-8', 'utf8').digest('hex'))
    expect((await service.readText(text!.id)).text).toBe('你好 UTF-8')
    expect((await service.read(image!.id)).data).toEqual(png())

    const binding = { type: 'message', id: 'message-1' }
    expect(await service.bind([text!.id], binding)).toMatchObject([{ binding }])
    expect(await service.cleanupOrphans(100)).toEqual({ removedRecords: 1, deletedBlobs: 1 })
    await expect(service.read(image!.id)).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' })
    expect(await service.listByBinding(binding)).toHaveLength(1)

    await service.unbind([text!.id], binding)
    expect(await service.cleanupOrphans(100)).toEqual({ removedRecords: 1, deletedBlobs: 1 })
    await expect(service.read(text!.id)).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' })
  })

  test('拒绝无效 UTF-8、伪造图片、路径名称和各级额度超限', async () => {
    const service = await setup()
    await expect(
      service.store([
        {
          kind: 'text',
          name: 'bad.txt',
          mimeType: 'text/plain',
          data: new Uint8Array([0xc3, 0x28]),
        },
      ]),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_UTF8_INVALID' })
    await expect(
      service.store([
        { kind: 'image', name: 'fake.png', mimeType: 'image/png', data: new Uint8Array([1, 2, 3]) },
      ]),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_IMAGE_INVALID' })
    await expect(
      service.store([{ kind: 'text', name: '../escape.txt', mimeType: 'text/plain', data: 'no' }]),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_NAME_INVALID' })
    await expect(
      service.store(
        Array.from({ length: ATTACHMENT_LIMITS.maxCount + 1 }, (_, index) => ({
          kind: 'text' as const,
          name: `${index}.txt`,
          mimeType: 'text/plain',
          data: 'x',
        })),
      ),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_COUNT_LIMIT' })
    await expect(
      service.store([
        {
          kind: 'text',
          name: 'large.txt',
          mimeType: 'text/plain',
          data: new Uint8Array(ATTACHMENT_LIMITS.maxTextBytes + 1),
        },
      ]),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_FILE_TOO_LARGE' })

    const largeImage = png(9 * 1024 * 1024)
    await expect(
      service.store(
        [0, 1, 2].map((index) => ({
          kind: 'image' as const,
          name: `${index}.png`,
          mimeType: 'image/png',
          data: largeImage,
        })),
      ),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_TOTAL_TOO_LARGE' })
  })
})
