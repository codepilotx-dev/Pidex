import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { GitCommandRunner } from '../src/git/GitCommandRunner'
import type { AgentLogger } from '../src/observability/AgentLogger'
import { GitReviewService } from '../src/review/GitReviewService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'

const roots: string[] = []
afterEach(async () => {
  await removeFixturePaths(roots.splice(0))
}, 30_000)

const git = async (cwd: string, ...args: string[]) => {
  const child = Bun.spawn(['git', ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(`git ${args.join(' ')}: ${stderr}`)
  return stdout.trim()
}

type ReviewLogRecord = {
  level: 'info' | 'warn' | 'error'
  event: string
  fields: Record<string, unknown> | undefined
}

const captureReviewLogger = (
  records: ReviewLogRecord[],
): Pick<AgentLogger, 'info' | 'warn' | 'error'> => ({
  info: (event, fields) => records.push({ level: 'info', event, fields }),
  warn: (event, fields) => records.push({ level: 'warn', event, fields }),
  error: (event, fields) => records.push({ level: 'error', event, fields }),
})

const fixture = async (
  options: {
    onChanged?: (projectId: string) => void | Promise<void>
    onGitCommand?: (args: readonly string[]) => void
    logger?: Pick<AgentLogger, 'info' | 'warn' | 'error'>
    resolvePullRequest?: (input: {
      workspaceRoot: string
      owner: string
      repository: string
      number: number
    }) => Promise<{ baseSha: string; headSha: string }>
  } = {},
) => {
  const container = await mkdtemp(join(tmpdir(), 'pidex-review-'))
  roots.push(container)
  const root = join(container, 'repository')
  await mkdir(root)
  await git(root, 'init', '-b', 'main')
  await git(root, 'config', 'user.name', 'Pidex Test')
  await git(root, 'config', 'user.email', 'test@pidex.local')
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'index.ts'), 'export const value = 1\n', 'utf8')
  await git(root, 'add', '.')
  await git(root, 'commit', '-m', 'initial')
  const db = new AgentDatabase(join(container, 'agent.sqlite'))
  const project = db.createProject({ rootPath: root })
  const thread = db.createThread('Review fixture', project.id)
  return {
    root,
    db,
    project,
    thread,
    review: new GitReviewService(
      db,
      options.onChanged,
      options.resolvePullRequest,
      options.onGitCommand,
      options.logger,
    ),
  }
}

describe('GitReviewService', () => {
  test('Git runner 流式限制输出、严格解码且失败不暴露 stderr', async () => {
    const { root, db, review } = await fixture()
    const invalidPath = join(root, 'invalid-utf8.bin')
    await writeFile(invalidPath, new Uint8Array([0xff, 0xfe]))
    const blob = await git(root, 'hash-object', '-w', 'invalid-utf8.bin')
    const runner = new GitCommandRunner({ maxOutputBytes: 1_024, timeoutMs: 20_000 })
    await expect(
      runner.run({
        cwd: root,
        args: ['cat-file', 'blob', blob],
      }),
    ).rejects.toMatchObject({ code: 'GIT_OUTPUT_ENCODING_INVALID', details: undefined })
    await expect(
      runner.run({
        cwd: root,
        args: ['rev-parse', '--verify', 'refs/heads/does-not-exist'],
      }),
    ).rejects.toMatchObject({ code: 'GIT_COMMAND_FAILED', details: undefined })
    const limited = new GitCommandRunner({ maxOutputBytes: 1, timeoutMs: 20_000 })
    await expect(
      limited.run({
        cwd: root,
        args: ['rev-parse', 'HEAD'],
      }),
    ).rejects.toMatchObject({ code: 'GIT_OUTPUT_TOO_LARGE', details: undefined })
    review.dispose()
    db.close()
  }, 30_000)

  test('读取项目当前工作分支', async () => {
    const { root, db, project, review } = await fixture()
    await git(root, 'switch', '-c', 'codex/hover-card')

    expect(await review.currentBranch(project.id)).toBe('codex/hover-card')
    db.close()
  })

  test('生成未暂存摘要和文件级 hunk，并保护过期快照', async () => {
    const logs: ReviewLogRecord[] = []
    const { root, db, project, review } = await fixture({
      logger: captureReviewLogger(logs),
    })
    await writeFile(
      join(root, 'src', 'index.ts'),
      'export const value = 2\nexport const added = true\n',
      'utf8',
    )

    const snapshot = await review.summary(project.id, { kind: 'unstaged' })
    expect(snapshot.files).toHaveLength(1)
    expect(snapshot.files[0]).toMatchObject({
      path: 'src/index.ts',
      status: 'modified',
      additions: 2,
      deletions: 1,
    })
    expect(snapshot.largeDiffMode).toBe(false)
    expect(logs.find((record) => record.event === 'review.summary.started')).toMatchObject({
      level: 'info',
      fields: { details: { sourceKind: 'unstaged', refresh: true, cacheHit: false } },
    })
    expect(logs.find((record) => record.event === 'review.summary.completed')).toMatchObject({
      level: 'info',
      fields: {
        details: {
          sourceKind: 'unstaged',
          refresh: true,
          cacheHit: false,
          cacheState: 'fresh',
          fileCount: 1,
          largeDiffMode: false,
          durationMs: expect.any(Number),
        },
      },
    })
    await review.summaryResult(project.id, { kind: 'unstaged' })
    expect(
      logs.filter((record) => record.event === 'review.summary.completed').at(-1),
    ).toMatchObject({
      fields: { details: { cacheHit: true, cacheState: 'fresh', fileCount: 1 } },
    })

    const diff = await review.fileDiff({
      projectId: project.id,
      source: { kind: 'unstaged' },
      generation: snapshot.generation,
      path: 'src/index.ts',
    })
    expect(diff.renderable).toBe(true)
    expect(diff.patch).toContain('+export const value = 2')
    expect(diff.hunks).toHaveLength(1)

    await writeFile(join(root, 'src', 'index.ts'), 'export const value = 3\n', 'utf8')
    await expect(
      review.fileDiff({
        projectId: project.id,
        source: { kind: 'unstaged' },
        generation: snapshot.generation,
        path: 'src/index.ts',
      }),
    ).rejects.toMatchObject({ code: 'REVIEW_SNAPSHOT_EXPIRED' })
    const fileFailure = logs.find((record) => record.event === 'review.file-diff.failed')
    expect(fileFailure).toMatchObject({
      level: 'error',
      fields: {
        details: {
          sourceKind: 'unstaged',
          path: 'src/index.ts',
          code: 'REVIEW_SNAPSHOT_EXPIRED',
          status: 409,
        },
      },
    })
    await expect(
      review.fileDiffs({
        projectId: project.id,
        source: { kind: 'unstaged' },
        generation: snapshot.generation,
        paths: ['src/index.ts'],
      }),
    ).rejects.toMatchObject({ code: 'REVIEW_SNAPSHOT_EXPIRED' })
    const batchFailure = logs.find((record) => record.event === 'review.file-diffs.failed')
    expect(batchFailure).toMatchObject({
      level: 'error',
      fields: {
        details: {
          sourceKind: 'unstaged',
          pathCount: 1,
          code: 'REVIEW_SNAPSHOT_EXPIRED',
          status: 409,
        },
      },
    })
    expect(JSON.stringify(batchFailure)).not.toContain(root)

    await expect(
      review.summary(project.id, {
        kind: 'branch',
        baseBranch: 'missing-review-base',
      }),
    ).rejects.toBeInstanceOf(Error)
    const buildFailure = logs.find((record) => record.event === 'review.snapshot.build.failed')
    expect(buildFailure).toMatchObject({
      level: 'error',
      fields: { details: { sourceKind: 'branch', attempt: 1, phase: 'source' } },
    })
    expect(JSON.stringify([fileFailure, buildFailure])).not.toContain(root)
    db.close()
  }, 30_000)

  test('暂存、取消暂存和恢复文件使用 generation/revision 乐观锁', async () => {
    const { root, db, project, review } = await fixture()
    await writeFile(join(root, 'src', 'index.ts'), 'export const value = 2\n', 'utf8')

    const unstaged = await review.summary(project.id, { kind: 'unstaged' })
    const unstagedDiff = await review.fileDiff({
      projectId: project.id,
      source: { kind: 'unstaged' },
      generation: unstaged.generation,
      path: 'src/index.ts',
    })
    await review.apply({
      projectId: project.id,
      source: { kind: 'unstaged' },
      generation: unstaged.generation,
      expectedRevision: unstagedDiff.revision,
      action: 'stage',
      target: { kind: 'file', path: 'src/index.ts' },
    })
    expect((await review.summary(project.id, { kind: 'unstaged' })).files).toHaveLength(0)

    const staged = await review.summary(project.id, { kind: 'staged' })
    const stagedDiff = await review.fileDiff({
      projectId: project.id,
      source: { kind: 'staged' },
      generation: staged.generation,
      path: 'src/index.ts',
    })
    await review.apply({
      projectId: project.id,
      source: { kind: 'staged' },
      generation: staged.generation,
      expectedRevision: stagedDiff.revision,
      action: 'unstage',
      target: { kind: 'file', path: 'src/index.ts' },
    })

    const restoredSource = await review.summary(project.id, { kind: 'unstaged' })
    const restoredDiff = await review.fileDiff({
      projectId: project.id,
      source: { kind: 'unstaged' },
      generation: restoredSource.generation,
      path: 'src/index.ts',
    })
    await review.apply({
      projectId: project.id,
      source: { kind: 'unstaged' },
      generation: restoredSource.generation,
      expectedRevision: restoredDiff.revision,
      action: 'revert',
      target: { kind: 'file', path: 'src/index.ts' },
    })
    expect((await Bun.file(join(root, 'src', 'index.ts')).text()).replaceAll('\r\n', '\n')).toBe(
      'export const value = 1\n',
    )
    db.close()
  }, 30_000)

  test('批量暂存只构建一次最终摘要，并在任一 revision 过期时整体拒绝', async () => {
    const commands: string[][] = []
    const { root, db, project, review } = await fixture({
      onGitCommand: (args) => commands.push([...args]),
    })
    for (let index = 0; index < 128; index += 1) {
      await writeFile(
        join(root, 'src', `batch-${index}.ts`),
        `export const value${index} = ${index}\n`,
        'utf8',
      )
    }
    await git(root, 'add', '.')
    await git(root, 'commit', '-m', 'batch fixture')
    for (let index = 0; index < 128; index += 1) {
      await writeFile(
        join(root, 'src', `batch-${index}.ts`),
        `export const value${index} = ${index + 1}\n`,
        'utf8',
      )
    }

    const snapshot = await review.summary(project.id, { kind: 'unstaged' })
    const items = snapshot.files.map((file) => ({
      path: file.path,
      expectedRevision: file.revision,
    }))
    commands.length = 0
    const applied = await review.applyBatch({
      projectId: project.id,
      source: { kind: 'unstaged' },
      generation: snapshot.generation,
      action: 'stage',
      items,
    })
    expect(applied.paths).toHaveLength(128)
    expect(commands.filter((args) => args[0] === 'add')).toHaveLength(1)
    expect(commands.filter((args) => args.includes('--raw'))).toHaveLength(1)

    const staged = await review.summary(project.id, { kind: 'staged' })
    commands.length = 0
    await expect(
      review.applyBatch({
        projectId: project.id,
        source: { kind: 'staged' },
        generation: staged.generation,
        action: 'unstage',
        items: staged.files.map((file, index) => ({
          path: file.path,
          expectedRevision: index === staged.files.length - 1 ? 'expired' : file.revision,
        })),
      }),
    ).rejects.toMatchObject({ code: 'REVIEW_SNAPSHOT_EXPIRED' })
    expect(commands.some((args) => args[0] === 'restore' || args[0] === 'rm')).toBe(false)
    expect((await review.summary(project.id, { kind: 'staged' })).files).toHaveLength(128)
    review.dispose()
    db.close()
  }, 30_000)

  test('读取工作区状态并仅提交经过验证的仓库内路径', async () => {
    const { root, db, project, review } = await fixture()
    await writeFile(join(root, 'src', 'index.ts'), 'export const value = 2\n', 'utf8')
    await writeFile(join(root, 'src', 'new.ts'), 'export const added = true\n', 'utf8')

    const before = await review.status(project.id)
    expect(before).toMatchObject({
      branchName: 'main',
      clean: false,
    })
    expect(before.files.map((file) => file.path).sort()).toEqual(['src/index.ts', 'src/new.ts'])
    const branchSnapshot = await review.summary(project.id, {
      kind: 'branch',
      baseBranch: 'main',
    })
    expect(branchSnapshot.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'src/index.ts', status: 'modified' }),
        expect.objectContaining({ path: 'src/new.ts', status: 'untracked' }),
      ]),
    )

    const committed = await review.commit({
      projectId: project.id,
      message: 'review fixture commit',
      paths: ['src/index.ts', 'src/new.ts'],
    })
    expect(committed.ok).toBe(true)
    expect(committed.headSha).toHaveLength(40)
    expect(committed.status.clean).toBe(true)
    expect(await git(root, 'log', '-1', '--format=%s')).toBe('review fixture commit')

    await expect(
      review.commit({
        projectId: project.id,
        message: 'invalid path',
        paths: ['../outside.txt'],
      }),
    ).rejects.toMatchObject({ code: 'PATH_DENIED' })
    db.close()
  }, 30_000)

  test('列出本地分支和提交，并拒绝未接入的 PR 来源', async () => {
    const { db, project, review } = await fixture()
    const branches = await review.branches(project.id)
    expect(branches.current).toBe('main')
    expect(branches.branches.some((branch) => branch.name === 'main' && branch.current)).toBe(true)
    const commits = await review.commits(project.id)
    expect(commits.commits[0]?.subject).toBe('initial')
    await expect(
      review.summary(project.id, {
        kind: 'pull-request',
        owner: 'pidex',
        repository: 'fixture',
        number: 1,
      }),
    ).rejects.toMatchObject({ code: 'REVIEW_SOURCE_UNAVAILABLE' })
    db.close()
  }, 30_000)

  test('提交历史按引用只读查询并拒绝无效引用', async () => {
    const { root, db, project, review } = await fixture()
    try {
      await git(root, 'branch', 'other')
      await git(root, 'commit', '--allow-empty', '-m', 'main only')
      expect((await review.commits(project.id)).commits[0]?.subject).toBe('main only')
      expect((await review.commits(project.id, 20, 'other')).commits[0]?.subject).toBe('initial')
      expect(await git(root, 'branch', '--show-current')).toBe('main')
      for (const ref of ['missing-branch', '--all', 'main --all', 'main\0']) {
        await expect(review.commits(project.id, 20, ref)).rejects.toBeDefined()
      }
      await git(root, 'checkout', '--orphan', 'empty')
      expect((await review.commits(project.id)).commits).toEqual([])
      await expect(review.commits(project.id, 20, 'empty')).rejects.toMatchObject({
        code: 'REVIEW_SOURCE_UNAVAILABLE',
      })
    } finally {
      db.close()
    }
  }, 30_000)

  test('Git 暂态不会生成相互矛盾的 Review generation', async () => {
    const { root, db, project, review } = await fixture()
    const mergeHead = await git(root, 'rev-parse', '--git-path', 'MERGE_HEAD')
    await writeFile(join(root, mergeHead), `${'a'.repeat(40)}\n`, 'utf8')

    await expect(review.summary(project.id, { kind: 'unstaged' })).rejects.toMatchObject({
      code: 'REVIEW_SOURCE_UNAVAILABLE',
      status: 503,
      details: { operation: 'merge' },
    })
    db.close()
  }, 30_000)

  test('1200 文件摘要只扫描元数据，不读取整仓 patch', async () => {
    const commands: string[][] = []
    const { root, db, project, review } = await fixture({
      onGitCommand: (args) => commands.push([...args]),
    })
    await Promise.all(
      Array.from({ length: 1_200 }, (_, index) =>
        writeFile(
          join(root, 'src', `bulk-${index}.ts`),
          `export const value${index} = ${index}\n`,
          'utf8',
        ),
      ),
    )
    await git(root, 'add', '.')
    await git(root, 'commit', '-m', 'bulk fixture')
    await Promise.all(
      Array.from({ length: 1_200 }, (_, index) =>
        writeFile(
          join(root, 'src', `bulk-${index}.ts`),
          `export const value${index} = ${index + 1}\n`,
          'utf8',
        ),
      ),
    )

    commands.length = 0
    const snapshot = await review.summary(project.id, { kind: 'unstaged' })
    expect(snapshot.files).toHaveLength(1_200)
    expect(snapshot.largeDiffMode).toBe(true)
    expect(commands.length).toBeLessThanOrEqual(8)
    expect(commands.filter((args) => args.includes('--numstat'))).toHaveLength(1)
    expect(commands.filter((args) => args.includes('--raw'))).toHaveLength(1)
    expect(commands.some((args) => args.includes('--binary'))).toBe(false)
    db.close()
  }, 60_000)

  test('相同摘要刷新和批量 Diff 的并发请求会合并，单文件随后命中缓存', async () => {
    const commands: string[][] = []
    const logs: ReviewLogRecord[] = []
    const { root, db, project, review } = await fixture({
      onGitCommand: (args) => commands.push([...args]),
      logger: captureReviewLogger(logs),
    })
    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        writeFile(
          join(root, 'src', `concurrent-${index}.ts`),
          `export const value${index} = ${index}\n`,
          'utf8',
        ),
      ),
    )
    await git(root, 'add', '.')
    await git(root, 'commit', '-m', 'concurrent fixture')
    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        writeFile(
          join(root, 'src', `concurrent-${index}.ts`),
          `export const value${index} = ${index + 1}\n`,
          'utf8',
        ),
      ),
    )

    const [first, second] = await Promise.all([
      review.summaryResult(project.id, { kind: 'unstaged' }, true),
      review.summaryResult(project.id, { kind: 'unstaged' }, true),
    ])
    expect(first.snapshot.generation).toBe(second.snapshot.generation)
    expect(first.cacheState).toBe('fresh')
    expect(commands.filter((args) => args.includes('--raw'))).toHaveLength(1)
    expect(logs.find((record) => record.event === 'review.snapshot.refresh.joined')).toMatchObject({
      level: 'info',
      fields: { details: { sourceKind: 'unstaged', ageMs: expect.any(Number) } },
    })

    commands.length = 0
    const input = {
      projectId: project.id,
      source: { kind: 'unstaged' } as const,
      generation: first.snapshot.generation,
      paths: first.snapshot.files.map((file) => file.path),
      hideWhitespace: true,
    }
    const [firstDiffs, secondDiffs] = await Promise.all([
      review.fileDiffs(input),
      review.fileDiffs(input),
    ])
    expect(firstDiffs).toEqual(secondDiffs)
    expect(commands.filter((args) => args[0] === 'diff')).toHaveLength(1)
    expect(logs.filter((record) => record.event === 'review.file-diffs.started')).toHaveLength(2)
    expect(logs.filter((record) => record.event === 'review.file-diffs.completed')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'info',
          fields: {
            details: expect.objectContaining({
              sourceKind: 'unstaged',
              pathCount: 5,
              resultType: 'success',
              changedBytes: expect.any(Number),
              durationMs: expect.any(Number),
            }),
          },
        }),
      ]),
    )
    const commandCountAfterBatch = commands.length
    await review.fileDiff({
      projectId: project.id,
      source: { kind: 'unstaged' },
      generation: first.snapshot.generation,
      path: first.snapshot.files[0]!.path,
      hideWhitespace: true,
    })
    expect(commands).toHaveLength(commandCountAfterBatch)
    db.close()
  }, 30_000)

  test('批量、单文件和单行按字节与行数阈值分级', async () => {
    const { root, db, project, review } = await fixture()
    const paths = [
      'src/changed-lines.ts',
      'src/changed-bytes.ts',
      'src/line-bytes.ts',
      ...Array.from({ length: 7 }, (_, index) => `src/batch-${index}.ts`),
    ]
    await Promise.all(paths.map((path) => writeFile(join(root, path), '', 'utf8')))
    await git(root, 'add', '.')
    await git(root, 'commit', '-m', 'threshold fixture')
    await writeFile(join(root, 'src', 'changed-lines.ts'), 'line\n'.repeat(15_001), 'utf8')
    await writeFile(
      join(root, 'src', 'changed-bytes.ts'),
      `${'x'.repeat(4_096)}\n`.repeat(1_000),
      'utf8',
    )
    await writeFile(join(root, 'src', 'line-bytes.ts'), `${'x'.repeat(1_100_000)}\n`, 'utf8')
    await Promise.all(
      Array.from({ length: 7 }, (_, index) =>
        writeFile(join(root, 'src', `batch-${index}.ts`), `${'x'.repeat(2_000_000)}\n`, 'utf8'),
      ),
    )

    const snapshot = await review.summary(project.id, { kind: 'unstaged' })
    const single = async (path: string) =>
      review.fileDiff({
        projectId: project.id,
        source: { kind: 'unstaged' } as const,
        generation: snapshot.generation,
        path,
      })
    expect(await single('src/changed-lines.ts')).toMatchObject({
      renderable: false,
      tooLargeReason: 'changed-lines',
    })
    expect(await single('src/changed-bytes.ts')).toMatchObject({
      renderable: false,
      tooLargeReason: 'changed-bytes',
    })
    expect(await single('src/line-bytes.ts')).toMatchObject({
      renderable: false,
      tooLargeReason: 'line-bytes',
    })
    expect(
      await review.fileDiffs({
        projectId: project.id,
        source: { kind: 'unstaged' },
        generation: snapshot.generation,
        paths: Array.from({ length: 7 }, (_, index) => `src/batch-${index}.ts`),
      }),
    ).toMatchObject({ type: 'large', reason: 'changed-bytes' })
    review.dispose()
    db.close()
  }, 60_000)

  test('未暂存摘要遵循原生 git diff，未跟踪文件暂存后进入已暂存来源', async () => {
    const { root, db, project, review } = await fixture()
    await writeFile(
      join(root, 'src', 'index.ts'),
      'export const value = 2\nexport const tracked = true\n',
      'utf8',
    )
    await writeFile(
      join(root, 'src', 'untracked.ts'),
      'export const first = true\nexport const second = true\n',
      'utf8',
    )

    const nativeNumstat = await git(root, 'diff', '--numstat')
    const [nativeAdditions, nativeDeletions] = nativeNumstat.split('\t').map(Number)
    const snapshot = await review.summary(project.id, { kind: 'unstaged' })
    expect(snapshot.files.map((file) => file.path)).toEqual(['src/index.ts'])
    expect(snapshot.totals).toMatchObject({
      files: 1,
      additions: nativeAdditions,
      deletions: nativeDeletions,
    })
    await expect(
      review.fileDiff({
        projectId: project.id,
        source: { kind: 'unstaged' },
        generation: snapshot.generation,
        path: 'src/untracked.ts',
      }),
    ).rejects.toMatchObject({
      code: 'REVIEW_SOURCE_UNAVAILABLE',
      status: 404,
    })

    await git(root, 'add', '--', 'src/untracked.ts')
    const staged = await review.summary(project.id, { kind: 'staged' })
    expect(staged.files).toEqual([
      expect.objectContaining({
        path: 'src/untracked.ts',
        status: 'added',
        additions: 2,
        deletions: 0,
      }),
    ])
    expect(staged.totals).toMatchObject({ files: 1, additions: 2, deletions: 0 })
    db.close()
  }, 30_000)

  test('本地分支来源不准备远端，PR 来源继续走现有远端准备器', async () => {
    let pullRequestPreparations = 0
    const { db, project, review } = await fixture({
      resolvePullRequest: async () => {
        pullRequestPreparations += 1
        return {
          baseSha: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
          headSha: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
        }
      },
    })

    await review.summary(project.id, { kind: 'branch', baseBranch: 'main' })
    expect(pullRequestPreparations).toBe(0)
    await review.summary(project.id, {
      kind: 'pull-request',
      owner: 'pidex',
      repository: 'fixture',
      number: 1,
    })
    expect(pullRequestPreparations).toBe(1)
    db.close()
  }, 30_000)

  test('watcher 仅标记旧快照 stale，refresh 再返回新 generation', async () => {
    let resolveChanged: (() => void) | undefined
    const changed = new Promise<void>((resolve) => {
      resolveChanged = resolve
    })
    let changedCalls = 0
    const { root, db, project, review } = await fixture({
      onChanged: () => {
        changedCalls += 1
        resolveChanged?.()
      },
    })
    const initial = await review.summaryResult(project.id, { kind: 'unstaged' })
    await writeFile(join(root, 'src', 'index.ts'), 'export const value = 2\n', 'utf8')
    await Promise.race([
      changed,
      Bun.sleep(3_000).then(() => {
        throw new Error('等待 Git watcher 超时')
      }),
    ])

    const stale = await review.summaryResult(project.id, { kind: 'unstaged' })
    expect(stale.cacheState).toBe('stale')
    expect(stale.snapshot.generation).toBe(initial.snapshot.generation)
    const refreshed = await review.summaryResult(project.id, { kind: 'unstaged' }, true)
    expect(refreshed.cacheState).toBe('fresh')
    expect(refreshed.snapshot.generation).not.toBe(initial.snapshot.generation)
    expect(changedCalls).toBe(1)
    review.dispose()
    db.close()
  }, 30_000)

  test('watcher 合并事件风暴并忽略 gitignored 文件', async () => {
    let changedCalls = 0
    let resolveChanged: (() => void) | undefined
    const changed = new Promise<void>((resolve) => {
      resolveChanged = resolve
    })
    const { root, db, project, review } = await fixture({
      onChanged: () => {
        changedCalls += 1
        resolveChanged?.()
      },
    })
    await writeFile(join(root, '.gitignore'), 'ignored.log\n', 'utf8')
    await git(root, 'add', '.gitignore')
    await git(root, 'commit', '-m', 'ignore fixture')
    await review.summaryResult(project.id, { kind: 'unstaged' })

    await writeFile(join(root, 'ignored.log'), 'ignored\n', 'utf8')
    await Bun.sleep(600)
    expect(changedCalls).toBe(0)

    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        writeFile(join(root, 'src', 'index.ts'), `export const value = ${index}\n`, 'utf8'),
      ),
    )
    await Promise.race([
      changed,
      Bun.sleep(3_000).then(() => {
        throw new Error('等待合并后的 Git watcher 事件超时')
      }),
    ])
    await Bun.sleep(600)
    expect(changedCalls).toBe(1)
    review.dispose()
    db.close()
  }, 30_000)

  test('每批有效变化都会通知，客户端的自动刷新计时可以持续重置', async () => {
    const notifications: number[] = []
    let resolveNotification: (() => void) | undefined
    const nextNotification = () =>
      new Promise<void>((resolve) => {
        resolveNotification = resolve
      })
    let notification = nextNotification()
    const { root, db, project, review } = await fixture({
      onChanged: () => {
        notifications.push(Date.now())
        resolveNotification?.()
      },
    })
    await review.summaryResult(project.id, { kind: 'unstaged' })

    await writeFile(join(root, 'src', 'index.ts'), 'export const value = 2\n', 'utf8')
    await Promise.race([
      notification,
      Bun.sleep(3_000).then(() => {
        throw new Error('等待第一批 Git watcher 通知超时')
      }),
    ])

    notification = nextNotification()
    await writeFile(join(root, 'src', 'index.ts'), 'export const value = 3\n', 'utf8')
    await Promise.race([
      notification,
      Bun.sleep(3_000).then(() => {
        throw new Error('等待第二批 Git watcher 通知超时')
      }),
    ])

    expect(notifications).toHaveLength(2)
    review.dispose()
    db.close()
  }, 30_000)

  test('仓库持续变化时有界重试并返回 busy', async () => {
    let rootPath = ''
    let statusCalls = 0
    let mutate = true
    const logs: ReviewLogRecord[] = []
    const fixtureValue = await fixture({
      logger: captureReviewLogger(logs),
      onGitCommand: (args) => {
        if (!mutate || !rootPath || !args.includes('--porcelain=v2')) return
        statusCalls += 1
        if (statusCalls % 2 === 0) {
          writeFileSync(
            join(rootPath, 'src', 'index.ts'),
            `export const value = ${statusCalls}\n`,
            'utf8',
          )
        }
      },
    })
    rootPath = fixtureValue.root
    await expect(
      fixtureValue.review.summary(fixtureValue.project.id, { kind: 'unstaged' }),
    ).rejects.toMatchObject({ code: 'REVIEW_REPOSITORY_BUSY', status: 503 })
    expect(statusCalls).toBe(6)
    expect(
      logs
        .filter((record) => record.event === 'review.snapshot.retry')
        .map((record) => (record.fields as { details: { attempt: number } }).details.attempt),
    ).toEqual([1, 2, 3])
    expect(logs.find((record) => record.event === 'review.summary.failed')).toMatchObject({
      level: 'error',
      fields: {
        details: {
          sourceKind: 'unstaged',
          refresh: true,
          code: 'REVIEW_REPOSITORY_BUSY',
          status: 503,
        },
      },
    })

    mutate = false
    expect(
      (await fixtureValue.review.summary(fixtureValue.project.id, { kind: 'unstaged' })).files,
    ).toHaveLength(1)
    fixtureValue.review.dispose()
    fixtureValue.db.close()
  }, 30_000)

  test('字面 pathspec 不会扩展相似文件，仓库外 symlink 只读取链接元数据', async () => {
    const { root, db, project, review } = await fixture()
    await writeFile(join(root, 'src', 'literal[1].ts'), 'export const selected = true\n', 'utf8')
    await writeFile(join(root, 'src', 'literal1.ts'), 'export const untouched = true\n', 'utf8')
    await review.commit({
      projectId: project.id,
      message: 'literal pathspec fixture',
      paths: ['src/literal[1].ts'],
    })
    expect(await git(root, 'ls-files', 'src/literal[1].ts')).toBe('src/literal[1].ts')
    expect(await git(root, 'ls-files', 'src/literal1.ts')).toBe('')

    const outside = join(root, '..', 'outside-secret.txt')
    await writeFile(outside, 'must-not-be-read\n', 'utf8')
    await symlink(outside, join(root, 'outside-link.txt'), 'file')
    const branch = await review.summary(project.id, { kind: 'branch', baseBranch: 'main' })
    const linked = branch.files.find((file) => file.path === 'outside-link.txt')
    expect(linked).toBeDefined()
    const diff = await review.fileDiff({
      projectId: project.id,
      source: { kind: 'branch', baseBranch: 'main' },
      generation: branch.generation,
      path: 'outside-link.txt',
    })
    expect(diff.patch).not.toContain('must-not-be-read')
    expect(diff.patch).toContain('outside-secret.txt')
    review.dispose()
    db.close()
  }, 30_000)

  test('linked worktree 的外部提交会令旧摘要 stale 并收敛到最新状态', async () => {
    let watchedProjectId: string | undefined
    let resolveChanged: (() => void) | undefined
    const changed = new Promise<void>((resolve) => {
      resolveChanged = resolve
    })
    const { root, db, review } = await fixture({
      onChanged: (projectId) => {
        watchedProjectId = projectId
        resolveChanged?.()
      },
    })
    const linkedRoot = join(root, '..', 'linked-worktree')
    await git(root, 'worktree', 'add', '-b', 'linked-review', linkedRoot)
    const linkedProject = db.createProject({ rootPath: linkedRoot })
    await writeFile(join(linkedRoot, 'src', 'index.ts'), 'export const value = 2\n', 'utf8')
    const initial = await review.summaryResult(linkedProject.id, { kind: 'unstaged' })
    expect(initial.snapshot.files).toHaveLength(1)

    await git(linkedRoot, 'add', '--', 'src/index.ts')
    await git(linkedRoot, 'commit', '-m', 'linked worktree update')
    await Promise.race([
      changed,
      Bun.sleep(3_000).then(() => {
        throw new Error('等待 linked worktree Git metadata watcher 超时')
      }),
    ])

    expect(watchedProjectId).toBe(linkedProject.id)
    const stale = await review.summaryResult(linkedProject.id, { kind: 'unstaged' })
    expect(stale.cacheState).toBe('stale')
    expect(stale.snapshot.generation).toBe(initial.snapshot.generation)
    const refreshed = await review.summaryResult(linkedProject.id, { kind: 'unstaged' }, true)
    expect(refreshed.cacheState).toBe('fresh')
    expect(refreshed.snapshot.files).toHaveLength(0)
    review.dispose()
    db.close()
  }, 30_000)

  test('dispose 会取消 watcher 尚未触发的 debounce 通知', async () => {
    let changedCalls = 0
    const { root, db, project, review } = await fixture({
      onChanged: () => {
        changedCalls += 1
      },
    })
    await review.summaryResult(project.id, { kind: 'unstaged' })
    await writeFile(join(root, 'src', 'index.ts'), 'export const value = 2\n', 'utf8')
    review.dispose()
    await Bun.sleep(500)
    expect(changedCalls).toBe(0)
    db.close()
  }, 30_000)

  test('评论按 Thread/项目隔离，并保存最近一轮 tree 快照', async () => {
    const { root, db, project, thread, review } = await fixture()
    const turn = db.createTurn(thread.id, {
      content: 'fixture',
      model: { providerID: 'fixture' as never, id: 'fixture' as never },
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      },
      strategy: 'queue',
      taskMode: 'chat',
    })
    const tree = await git(root, 'write-tree')
    db.saveTurnGitSnapshot({
      threadId: thread.id,
      turnId: turn.turnID,
      projectId: project.id,
      repositoryRoot: root,
      beforeTree: tree,
      afterTree: tree,
    })
    expect(db.getTurnGitSnapshot(thread.id, turn.turnID)).toMatchObject({
      beforeTree: tree,
      afterTree: tree,
    })

    const comment = review.saveComment({
      threadId: thread.id,
      projectId: project.id,
      sourceKey: 'unstaged',
      path: 'src/index.ts',
      side: 'new',
      line: 1,
      hunkId: null,
      revision: 'revision',
      body: '检查这一行',
    })
    expect(
      review.listComments({ threadId: thread.id, projectId: project.id, sourceKey: 'unstaged' }),
    ).toHaveLength(1)
    expect(
      review.saveComment({
        id: comment.id,
        threadId: thread.id,
        projectId: project.id,
        sourceKey: 'unstaged',
        path: 'src/index.ts',
        side: 'new',
        line: 1,
        hunkId: null,
        revision: 'revision',
        body: '检查这一行',
        githubCommentId: '123',
      }).githubCommentId,
    ).toBe('123')
    expect(
      review.resolveComment({ id: comment.id, threadId: thread.id, projectId: project.id }).status,
    ).toBe('resolved')
    expect(
      review.deleteComment({ id: comment.id, threadId: thread.id, projectId: project.id }),
    ).toEqual({ ok: true })
    db.close()
  }, 30_000)

  test('最近一轮快照由私有 ref 锚定且不能跨项目读取', async () => {
    const { root, db, project, thread, review } = await fixture()
    const turn = db.createTurn(thread.id, {
      content: 'snapshot fixture',
      model: { providerID: 'fixture' as never, id: 'fixture' as never },
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      },
      strategy: 'queue',
      taskMode: 'chat',
    })
    await review.captureTurnSnapshot({
      projectId: project.id,
      threadId: thread.id,
      turnId: turn.turnID,
      phase: 'before',
    })
    await writeFile(join(root, 'src', 'index.ts'), 'export const value = 2\n', 'utf8')
    await review.captureTurnSnapshot({
      projectId: project.id,
      threadId: thread.id,
      turnId: turn.turnID,
      phase: 'after',
    })
    const refRoot = `refs/pidex/review/${thread.id}/${turn.turnID}`
    expect(await git(root, 'show-ref', '--verify', `${refRoot}/before`)).toContain(
      `${refRoot}/before`,
    )
    expect(await git(root, 'show-ref', '--verify', `${refRoot}/after`)).toContain(
      `${refRoot}/after`,
    )
    await git(root, 'gc', '--prune=now')
    const source = { kind: 'last-turn', threadId: thread.id, turnId: turn.turnID } as const
    expect((await review.summary(project.id, source)).files).toHaveLength(1)

    const otherRoot = join(root, '..', 'other-repository')
    await mkdir(otherRoot)
    await git(otherRoot, 'init', '-b', 'main')
    await git(otherRoot, 'config', 'user.name', 'Pidex Test')
    await git(otherRoot, 'config', 'user.email', 'test@pidex.local')
    await writeFile(join(otherRoot, 'README.md'), 'other\n', 'utf8')
    await git(otherRoot, 'add', '.')
    await git(otherRoot, 'commit', '-m', 'other')
    const otherProject = db.createProject({ rootPath: otherRoot })
    await expect(review.summary(otherProject.id, source)).rejects.toMatchObject({
      code: 'PROJECT_SCOPE_MISMATCH',
    })
    const cleanup = review.prepareThreadSnapshotCleanup(thread.id)
    await cleanup()
    expect(await git(root, 'for-each-ref', '--format=%(refname)', refRoot)).toBe('')
    review.dispose()
    db.close()
  }, 30_000)
})

test('uncommitted combines index and working tree; full context preserves canonical hunks', async () => {
  const { root, db, project, review } = await fixture()
  try {
    await writeFile(join(root, 'src/index.ts'), 'export const value = 2\n', 'utf8')
    await git(root, 'add', 'src/index.ts')
    await writeFile(join(root, 'src/index.ts'), 'export const value = 3\n', 'utf8')
    await writeFile(join(root, 'new.ts'), 'export const added = true\n', 'utf8')
    await git(root, 'update-ref', 'refs/remotes/origin/release', 'HEAD')
    await git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/release')
    expect(
      (await review.branches(project.id)).branches.find((branch) => branch.default)?.name,
    ).toBe('origin/release')
    const snapshot = await review.summary(project.id, { kind: 'uncommitted' })
    expect(snapshot.files.map((file) => file.path).sort()).toEqual(['new.ts', 'src/index.ts'])
    const diff = await review.fileDiff({
      projectId: project.id,
      source: snapshot.source,
      generation: snapshot.generation,
      path: 'src/index.ts',
    })
    expect(diff.patch).toContain('-export const value = 1')
    expect(diff.patch).toContain('+export const value = 3')
    const text = Array.from(
      { length: 40 },
      (_, line) => `export const value${line} = ${line}\n`,
    ).join('')
    await writeFile(join(root, 'src/index.ts'), text, 'utf8')
    await git(root, 'add', 'src/index.ts')
    await git(root, 'commit', '-m', 'context fixture')
    await writeFile(
      join(root, 'src/index.ts'),
      text.replace('value20 = 20', 'value20 = 99'),
      'utf8',
    )
    const next = await review.summary(project.id, { kind: 'unstaged' })
    const input = {
      projectId: project.id,
      source: next.source,
      generation: next.generation,
      path: 'src/index.ts',
    }
    const partial = await review.fileDiff(input)
    const full = await review.fileDiff({ ...input, loadFullFiles: true })
    expect(full.patch).toBe(partial.patch)
    expect(full.hunks).toEqual(partial.hunks)
    expect(full.contextPatch).toContain('value0 = 0')
    expect(full.contextPatch).toContain('value39 = 39')
  } finally {
    review.dispose()
    db.close()
  }
})
