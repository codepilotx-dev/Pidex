import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { WorkspaceService } from '../src/workspace/WorkspaceService'

const paths: string[] = []
const hash = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex')

afterEach(async () => removeFixturePaths(paths.splice(0)))

const waitForFileContent = async (path: string, expected: string, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await readFile(path, 'utf8')) === expected) return
    } catch {
      // The watched process has not published its ready marker yet.
    }
    await Bun.sleep(25)
  }
  throw new Error(`等待文件内容超时: ${path}`)
}

const workspace = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-workspace-'))
  paths.push(root)
  return { root, service: await WorkspaceService.open(root) }
}

describe('WorkspaceService.applyPatch', () => {
  test('Skill 只读目录授权局限于本轮，支持引用并拒绝写入与链接越界', async () => {
    const { service } = await workspace()
    const external = await workspace()
    const skillRoot = join(external.root, 'skill')
    await mkdir(join(skillRoot, 'references'), { recursive: true })
    const reference = join(skillRoot, 'references', 'guide.md')
    await writeFile(reference, 'guidance', 'utf8')
    await writeFile(join(external.root, 'outside.md'), 'outside', 'utf8')
    const turn = service.withReadOnlyPaths([{ path: skillRoot, kind: 'directory' }])
    await expect(turn.readEditorFile(reference)).resolves.toMatchObject({ content: 'guidance' })
    await expect(service.readEditorFile(reference)).rejects.toThrow()
    await expect(service.withReadOnlyPaths([]).readEditorFile(reference)).rejects.toThrow()
    await expect(
      turn.applyPatch({
        operation: 'update',
        path: reference,
        before: 'guidance',
        after: 'changed',
      }),
    ).rejects.toThrow()
    await symlink(external.root, join(skillRoot, 'escape'), 'junction')
    await expect(turn.readEditorFile(join(skillRoot, 'escape', 'outside.md'))).rejects.toThrow()
  })
  test('更新唯一上下文并返回 diff、行数和哈希', async () => {
    const { root, service } = await workspace()
    await writeFile(join(root, 'source.txt'), 'first\nbefore\nlast', 'utf8')

    const result = await service.applyPatch({
      operation: 'update',
      path: 'source.txt',
      before: 'before',
      after: 'after\nnext',
    })

    expect(await readFile(join(root, 'source.txt'), 'utf8')).toBe('first\nafter\nnext\nlast')
    expect(result).toMatchObject({
      operation: 'update',
      path: 'source.txt',
      additions: 2,
      deletions: 1,
    })
    expect(result.diff).toContain(
      '--- a/source.txt\n+++ b/source.txt\n@@ -2,1 +2,2 @@\n-before\n+after\n+next',
    )
    expect(result.beforeSha256).toBe(hash('first\nbefore\nlast'))
    expect(result.afterSha256).toBe(hash('first\nafter\nnext\nlast'))
  })

  test('创建新文件并按预期哈希删除', async () => {
    const { root, service } = await workspace()

    const created = await service.applyPatch({
      operation: 'create',
      path: 'created.txt',
      content: '中文\ncontent',
    })
    expect(await readFile(join(root, 'created.txt'), 'utf8')).toBe('中文\ncontent')
    expect(created).toMatchObject({
      operation: 'create',
      additions: 2,
      deletions: 0,
      beforeSha256: null,
      afterSha256: hash('中文\ncontent'),
    })
    expect(created.diff).toStartWith('--- /dev/null\n+++ b/created.txt')

    const deleted = await service.applyPatch({
      operation: 'delete',
      path: 'created.txt',
      expectedSha256: hash('中文\ncontent'),
    })
    expect(await Bun.file(join(root, 'created.txt')).exists()).toBe(false)
    expect(deleted).toMatchObject({
      operation: 'delete',
      additions: 0,
      deletions: 2,
      beforeSha256: hash('中文\ncontent'),
      afterSha256: null,
    })
    expect(deleted.diff).toStartWith('--- a/created.txt\n+++ /dev/null')
  })

  test('拒绝重复上下文、覆盖创建和哈希不匹配', async () => {
    const { root, service } = await workspace()
    await writeFile(join(root, 'source.txt'), 'same same', 'utf8')

    await expect(
      service.applyPatch({
        operation: 'update',
        path: 'source.txt',
        before: 'same',
        after: 'next',
      }),
    ).rejects.toMatchObject({ code: 'PATCH_CONTEXT_AMBIGUOUS' })
    await expect(
      service.applyPatch({ operation: 'create', path: 'source.txt', content: 'next' }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_EXISTS' })
    await expect(
      service.applyPatch({
        operation: 'delete',
        path: 'source.txt',
        expectedSha256: hash('different'),
      }),
    ).rejects.toMatchObject({ code: 'PATCH_SHA256_MISMATCH' })
    expect(await readFile(join(root, 'source.txt'), 'utf8')).toBe('same same')
  })

  test('将重叠出现的 before 视为不唯一', async () => {
    const { root, service } = await workspace()
    await writeFile(join(root, 'overlap.txt'), 'aaa', 'utf8')

    await expect(
      service.applyPatch({ operation: 'update', path: 'overlap.txt', before: 'aa', after: 'next' }),
    ).rejects.toMatchObject({ code: 'PATCH_CONTEXT_AMBIGUOUS' })
    expect(await readFile(join(root, 'overlap.txt'), 'utf8')).toBe('aaa')
  })

  test('允许根内绝对路径，并拒绝遍历和通过符号链接逃逸', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'pidex-workspace-'))
    paths.push(parent)
    const root = join(parent, 'project')
    const outside = join(parent, 'outside')
    await mkdir(root)
    await mkdir(outside)
    await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8')
    await symlink(outside, join(root, 'outside-link'), 'dir')
    const service = await WorkspaceService.open(root)

    await expect(
      service.applyPatch({ operation: 'create', path: join(root, 'absolute.txt'), content: 'yes' }),
    ).resolves.toMatchObject({ path: 'absolute.txt' })
    await expect(
      service.applyPatch({ operation: 'create', path: 'sub/../traversal.txt', content: 'no' }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_DENIED' })
    await expect(
      service.applyPatch({
        operation: 'update',
        path: 'outside-link/secret.txt',
        before: 'secret',
        after: 'leaked',
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_DENIED' })
    await expect(
      service.applyPatch({ operation: 'create', path: 'outside-link/new.txt', content: 'leaked' }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_DENIED' })
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('secret')
    expect(await Bun.file(join(outside, 'new.txt')).exists()).toBe(false)
  })
})

describe('WorkspaceService editor files', () => {
  test('只允许精确的用户配置别名，并拒绝别名符号链接重定向', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'pidex-config-alias-'))
    paths.push(parent)
    const root = join(parent, 'project')
    const userConfig = join(parent, 'config.json')
    const redirected = join(parent, 'redirected.json')
    await mkdir(root)
    await writeFile(userConfig, '{ "model": "gpt-5" }\n', 'utf8')
    await writeFile(redirected, '{ "model": "other" }\n', 'utf8')
    const service = await WorkspaceService.open(root)
    service.grantEditorAlias('@pidex/config.json', userConfig)

    expect(await service.read('@pidex/config.json')).toBe('{ "model": "gpt-5" }\n')
    await expect(service.read('@pidex/other.json')).rejects.toMatchObject({
      code: 'WORKSPACE_PATH_DENIED',
    })

    const linkedConfig = join(parent, 'linked-config.json')
    await symlink(redirected, linkedConfig, 'file')
    const linkedService = await WorkspaceService.open(root)
    linkedService.grantEditorAlias('@pidex/config.json', linkedConfig)
    await expect(linkedService.read('@pidex/config.json')).rejects.toMatchObject({
      code: 'WORKSPACE_PATH_DENIED',
    })
  })

  test('多根工作区允许附加目录读写，并用绝对显示路径消除歧义', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'pidex-multi-root-'))
    paths.push(parent)
    const primary = join(parent, 'primary')
    const secondary = join(parent, 'secondary')
    const outside = join(parent, 'outside')
    await Promise.all([mkdir(primary), mkdir(secondary), mkdir(outside)])
    await writeFile(join(primary, 'same.txt'), 'primary', 'utf8')
    await writeFile(join(secondary, 'same.txt'), 'secondary', 'utf8')
    const service = await WorkspaceService.openRoots({
      primaryRoot: primary,
      roots: [
        { folderId: 'primary', path: primary, role: 'primary' },
        { folderId: 'secondary', path: secondary, role: 'secondary' },
      ],
    })

    expect(service.roots).toEqual([primary, secondary])
    expect((await service.readEditorFile('same.txt')).content).toBe('primary')
    expect(await service.readEditorFile(join(secondary, 'same.txt'))).toMatchObject({
      path: join(secondary, 'same.txt'),
      content: 'secondary',
    })
    await service.applyPatch({
      operation: 'update',
      path: join(secondary, 'same.txt'),
      before: 'secondary',
      after: 'updated',
    })
    expect(await readFile(join(secondary, 'same.txt'), 'utf8')).toBe('updated')
    await expect(service.readEditorFile(join(outside, 'same.txt'))).rejects.toMatchObject({
      code: 'WORKSPACE_PATH_DENIED',
    })

    const isolated = await WorkspaceService.openRoots({
      primaryRoot: primary,
      roots: [
        { path: primary, role: 'primary' },
        { path: secondary, role: 'secondary', writable: false },
      ],
    })
    expect((await isolated.readEditorFile(join(secondary, 'same.txt'))).content).toBe('updated')
    await expect(
      isolated.applyPatch({
        operation: 'update',
        path: join(secondary, 'same.txt'),
        before: 'updated',
        after: 'blocked',
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FILE_READONLY' })
  })

  test('只列出指定目录的直接子项并忽略目录与符号链接', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'pidex-workspace-'))
    paths.push(parent)
    const root = join(parent, 'project')
    const outside = join(parent, 'outside')
    await mkdir(join(root, 'src', 'nested'), { recursive: true })
    await mkdir(join(root, 'node_modules', 'ignored'), { recursive: true })
    await mkdir(outside)
    await writeFile(join(root, 'README.md'), 'readme', 'utf8')
    await writeFile(join(root, 'src', 'index.ts'), 'export {}', 'utf8')
    await writeFile(join(root, 'src', 'nested', 'value.ts'), 'export const value = 1', 'utf8')
    await writeFile(join(root, 'node_modules', 'ignored', 'index.js'), 'ignored', 'utf8')
    await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8')
    await symlink(outside, join(root, 'outside-link'), 'dir')
    const service = await WorkspaceService.open(root)

    expect(await service.listEditorFiles('.')).toEqual([
      { name: 'src', path: 'src', type: 'directory', depth: 0 },
      { name: 'README.md', path: 'README.md', type: 'file', depth: 0 },
    ])
    expect(await service.listEditorFiles('src')).toEqual([
      { name: 'nested', path: 'src/nested', type: 'directory', depth: 1 },
      { name: 'index.ts', path: 'src/index.ts', type: 'file', depth: 1 },
    ])
    expect(await service.listEditorFiles('src/nested')).toEqual([
      { name: 'value.ts', path: 'src/nested/value.ts', type: 'file', depth: 2 },
    ])
  })

  test('读取 UTF-8 文件并使用 revision 原子保存', async () => {
    const { root, service } = await workspace()
    await writeFile(join(root, 'source.ts'), 'const value = 1\n', 'utf8')

    const opened = await service.readEditorFile('source.ts')
    expect(opened).toMatchObject({
      path: 'source.ts',
      content: 'const value = 1\n',
      sizeBytes: 16,
      readonly: false,
    })
    expect(opened.revision.sha256).toBe(hash(opened.content))

    const saved = await service.saveEditorFile('source.ts', 'const value = 2\n', opened.revision)
    expect(saved.outcome).toBe('saved')
    expect(await readFile(join(root, 'source.ts'), 'utf8')).toBe('const value = 2\n')
  })

  test('只读检查变更路径并识别 UTF-8 BOM，且不会创建缺失目录', async () => {
    const { root, service } = await workspace()
    const bomContent = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('before\r\n', 'utf8'),
    ])
    await writeFile(join(root, 'source.txt'), bomContent)

    const existing = await service.inspectMutationPath('source.txt', 'existing-file')
    expect(existing).toMatchObject({
      expectation: 'existing-file',
      path: 'source.txt',
      content: 'before\r\n',
      utf8Bom: true,
      revision: {
        sha256: hash('before\r\n'),
        rawSha256: createHash('sha256').update(bomContent).digest('hex'),
        utf8Bom: true,
      },
    })
    if (existing.expectation !== 'existing-file')
      throw new Error('expected existing-file inspection')
    expect(existing.rawSha256).toBe(createHash('sha256').update(bomContent).digest('hex'))

    const added = await service.inspectMutationPath('new.txt', 'new-file')
    expect(added).toMatchObject({ expectation: 'new-file', path: 'new.txt' })
    expect(await Bun.file(join(root, 'new.txt')).exists()).toBe(false)
    await expect(service.inspectMutationPath('missing/new.txt', 'new-file')).rejects.toMatchObject({
      code: 'WORKSPACE_PATH_NOT_FOUND',
    })
    expect(await Bun.file(join(root, 'missing')).exists()).toBe(false)

    const readSnapshot = (await service.readEditorFile('source.txt')).revision
    await writeFile(join(root, 'source.txt'), 'before\r\n', 'utf8')
    const withoutBom = await service.inspectMutationPath('source.txt', 'existing-file')
    if (withoutBom.expectation !== 'existing-file')
      throw new Error('expected existing-file inspection')
    await expect(
      service.commitEditorMutations([
        {
          operation: 'update',
          path: 'source.txt',
          content: 'after\r\n',
          expectedRevision: {
            ...readSnapshot,
            mtimeMs: withoutBom.revision.mtimeMs,
          },
        },
      ]),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FILE_STALE' })
    expect(await readFile(join(root, 'source.txt'))).toEqual(Buffer.from('before\r\n', 'utf8'))
  })

  test('批量提交在暂存前拒绝只读目标', async () => {
    const { root, service } = await workspace()
    const target = join(root, 'readonly.txt')
    await writeFile(target, 'before\n', 'utf8')
    const revision = (await service.readEditorFile('readonly.txt')).revision
    await chmod(target, 0o444)
    try {
      await expect(
        service.commitEditorMutations([
          {
            operation: 'update',
            path: 'readonly.txt',
            content: 'after\n',
            expectedRevision: revision,
          },
        ]),
      ).rejects.toMatchObject({ code: 'WORKSPACE_FILE_READONLY' })
      expect(await readFile(target, 'utf8')).toBe('before\n')
    } finally {
      await chmod(target, 0o666)
    }
  })

  test('批量预检通过后保留 BOM 提交 update/create，任一 revision 失效时零写入', async () => {
    const { root, service } = await workspace()
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    await writeFile(join(root, 'first.txt'), Buffer.concat([bom, Buffer.from('first\r\n', 'utf8')]))
    await writeFile(join(root, 'second.txt'), 'second\n', 'utf8')
    const first = await service.inspectMutationPath('first.txt', 'existing-file')
    const second = await service.inspectMutationPath('second.txt', 'existing-file')
    if (first.expectation !== 'existing-file' || second.expectation !== 'existing-file') {
      throw new Error('expected existing-file inspections')
    }

    const committed = await service.commitEditorMutations([
      {
        operation: 'update',
        path: 'first.txt',
        content: 'updated\r\n',
        expectedRevision: first.revision,
      },
      { operation: 'create', path: 'created.txt', content: 'created\n' },
    ])
    expect(committed).toMatchObject({
      outcome: 'committed',
      files: [
        { operation: 'update', path: 'first.txt', beforeSha256: first.revision.sha256 },
        { operation: 'create', path: 'created.txt', beforeSha256: null },
      ],
    })
    expect(await readFile(join(root, 'first.txt'))).toEqual(
      Buffer.concat([bom, Buffer.from('updated\r\n', 'utf8')]),
    )
    expect(await readFile(join(root, 'created.txt'), 'utf8')).toBe('created\n')

    const currentFirst = await service.inspectMutationPath('first.txt', 'existing-file')
    const currentSecond = await service.inspectMutationPath('second.txt', 'existing-file')
    if (
      currentFirst.expectation !== 'existing-file' ||
      currentSecond.expectation !== 'existing-file'
    ) {
      throw new Error('expected existing-file inspections')
    }
    await writeFile(join(root, 'second.txt'), 'external\n', 'utf8')
    await expect(
      service.commitEditorMutations([
        {
          operation: 'update',
          path: 'first.txt',
          content: 'must-not-write\r\n',
          expectedRevision: currentFirst.revision,
        },
        {
          operation: 'update',
          path: 'second.txt',
          content: 'must-not-write\n',
          expectedRevision: currentSecond.revision,
        },
      ]),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FILE_STALE' })
    expect(await readFile(join(root, 'first.txt'))).toEqual(
      Buffer.concat([bom, Buffer.from('updated\r\n', 'utf8')]),
    )
    expect(await readFile(join(root, 'second.txt'), 'utf8')).toBe('external\n')
  })

  test('同一 canonical 文件的并发批量更新串行化，后提交者看到 stale revision', async () => {
    const { root, service } = await workspace()
    await writeFile(join(root, 'source.txt'), 'before\n', 'utf8')
    const inspected = await service.inspectMutationPath('source.txt', 'existing-file')
    if (inspected.expectation !== 'existing-file')
      throw new Error('expected existing-file inspection')

    const settled = await Promise.allSettled([
      service.commitEditorMutations([
        {
          operation: 'update',
          path: 'source.txt',
          content: 'first\n',
          expectedRevision: inspected.revision,
        },
      ]),
      service.commitEditorMutations([
        {
          operation: 'update',
          path: join(root, 'source.txt'),
          content: 'second\n',
          expectedRevision: inspected.revision,
        },
      ]),
    ])

    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = settled.find((result) => result.status === 'rejected')
    expect(rejected).toMatchObject({ status: 'rejected', reason: { code: 'WORKSPACE_FILE_STALE' } })
    expect(['first\n', 'second\n']).toContain(await readFile(join(root, 'source.txt'), 'utf8'))
  })

  test('Windows 下可更新被 Bun watch 文本导入占用的文件', async () => {
    if (process.platform !== 'win32') return

    const { root, service } = await workspace()
    const target = join(root, 'watched.txt')
    const ready = join(root, 'watch-ready.txt')
    const entry = join(root, 'watcher.ts')
    await writeFile(target, 'before', 'utf8')
    await writeFile(
      entry,
      [
        'import watched from "./watched.txt" with { type: "text" }',
        'await Bun.write("watch-ready.txt", watched)',
        'setInterval(() => undefined, 1_000)',
      ].join('\n'),
      'utf8',
    )

    const child = Bun.spawn([process.execPath, '--watch', entry], {
      cwd: root,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    })
    try {
      await waitForFileContent(ready, 'before')
      const inspected = await service.inspectMutationPath('watched.txt', 'existing-file')
      if (inspected.expectation !== 'existing-file')
        throw new Error('expected existing-file inspection')

      await expect(
        service.commitEditorMutations([
          {
            operation: 'update',
            path: 'watched.txt',
            content: 'after',
            expectedRevision: inspected.revision,
          },
        ]),
      ).resolves.toMatchObject({
        outcome: 'committed',
        files: [{ operation: 'update', path: 'watched.txt', afterSha256: hash('after') }],
      })
      expect(await readFile(target, 'utf8')).toBe('after')

      await waitForFileContent(ready, 'after')
      await expect(
        service.applyPatch({
          operation: 'update',
          path: 'watched.txt',
          before: 'after',
          after: 'final',
        }),
      ).resolves.toMatchObject({
        operation: 'update',
        path: 'watched.txt',
        afterSha256: hash('final'),
      })
      expect(await readFile(target)).toEqual(Buffer.from('final', 'utf8'))
    } finally {
      child.kill()
      await child.exited
    }
  }, 15_000)

  test('磁盘内容变化时返回 conflict 且不覆盖', async () => {
    const { root, service } = await workspace()
    await writeFile(join(root, 'source.txt'), 'before', 'utf8')
    const opened = await service.readEditorFile('source.txt')
    await writeFile(join(root, 'source.txt'), 'external change', 'utf8')

    const result = await service.saveEditorFile('source.txt', 'local change', opened.revision)

    expect(result.outcome).toBe('conflict')
    expect(await readFile(join(root, 'source.txt'), 'utf8')).toBe('external change')
  })

  test('超过 10 MiB 的文件只读，并拒绝非法 UTF-8', async () => {
    const { root, service } = await workspace()
    await writeFile(join(root, 'large.txt'), Buffer.alloc(10 * 1024 * 1024 + 1, 97))
    await writeFile(join(root, 'binary.txt'), new Uint8Array([0xff, 0xfe]))

    const large = await service.readEditorFile('large.txt')
    expect(large.readonly).toBe(true)
    await expect(
      service.saveEditorFile('large.txt', 'small', large.revision),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FILE_READONLY' })
    await expect(service.readEditorFile('binary.txt')).rejects.toMatchObject({
      code: 'WORKSPACE_FILE_UNREADABLE',
    })
  })

  test('监听文件变化并可显式释放 watcher', async () => {
    const { root, service } = await workspace()
    await writeFile(join(root, 'watched.txt'), 'before', 'utf8')
    const changed = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('watch timeout')), 2_000)
      void service
        .watchEditorFile('watched.txt', (path) => {
          clearTimeout(timeout)
          resolve(path)
        })
        .then(async (watcher) => {
          await writeFile(join(root, 'watched.txt'), 'after', 'utf8')
          void changed.finally(watcher.close)
        }, reject)
    })

    await expect(changed).resolves.toBe('watched.txt')
  })
})
