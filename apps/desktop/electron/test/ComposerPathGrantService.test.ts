import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ComposerPathGrantService } from '../src/ipc/ComposerPathGrantService'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('Composer 本地路径临时授权', () => {
  test('按 renderer 隔离授权，并支持文本预览和目录分页', async () => {
    const root = await createTemporaryDirectory()
    await mkdir(join(root, 'docs'))
    await writeFile(join(root, 'docs', 'a.txt'), '你好，Pidex', 'utf8')
    await writeFile(join(root, 'docs', 'b.bin'), new Uint8Array([0, 1, 2]))
    const service = new ComposerPathGrantService()

    const [grant] = await service.grantPaths(7, [join(root, 'docs'), join(root, 'docs')])
    expect(grant?.pathKind).toBe('directory')
    expect((await service.grantPaths(7, [join(root, 'docs')]))[0]?.grantId).toBe(grant?.grantId)
    await expect(
      service.read(8, { grantId: grant!.grantId, relativePath: 'a.txt' }),
    ).rejects.toThrow('授权无效')

    expect(
      await service.read(7, {
        grantId: grant!.grantId,
        relativePath: 'a.txt',
      }),
    ).toMatchObject({
      kind: 'text',
      encoding: 'utf8',
      data: '你好，Pidex',
      relativePath: 'a.txt',
    })
    expect(await service.list(7, { grantId: grant!.grantId, limit: 1 })).toMatchObject({
      entries: [{ name: 'a.txt', pathKind: 'file' }],
      nextCursor: '1',
    })
    expect(
      await service.list(7, {
        grantId: grant!.grantId,
        cursor: '1',
        limit: 1,
      }),
    ).toMatchObject({
      entries: [{ name: 'b.bin', pathKind: 'file' }],
      nextCursor: null,
    })

    service.clearOwner(7)
    await expect(service.list(7, { grantId: grant!.grantId })).rejects.toThrow('授权无效')
  })

  test('拒绝路径穿越和指向授权目录外的链接', async () => {
    const root = await createTemporaryDirectory()
    const outside = await createTemporaryDirectory()
    await mkdir(join(root, 'selected'))
    await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8')
    await symlink(
      outside,
      join(root, 'selected', 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    const service = new ComposerPathGrantService()
    const [grant] = await service.grantPaths(1, [join(root, 'selected')])

    await expect(
      service.read(1, {
        grantId: grant!.grantId,
        relativePath: '../outside/secret.txt',
      }),
    ).rejects.toThrow('路径无效')
    await expect(
      service.read(1, {
        grantId: grant!.grantId,
        relativePath: 'escape/secret.txt',
      }),
    ).rejects.toThrow('路径无效')
    expect(await service.list(1, { grantId: grant!.grantId })).toEqual({
      entries: [],
      nextCursor: null,
    })
  })
})

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'pidex-composer-path-'))
  temporaryDirectories.push(directory)
  return directory
}
