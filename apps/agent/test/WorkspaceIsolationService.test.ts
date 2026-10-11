import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { WorkspaceIsolationService } from '../src/subagent/WorkspaceIsolationService'

const paths: string[] = []

afterEach(async () => removeFixturePaths(paths.splice(0)))

const git = async (cwd: string, args: readonly string[]) => {
  const process = Bun.spawn(['git', ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  return { stdout: stdout.trim(), stderr: stderr.trim(), code }
}

const setupRepository = async () => {
  const parent = await mkdtemp(join(tmpdir(), 'pidex-isolation-'))
  paths.push(parent)
  const root = join(parent, 'repository')
  const data = join(parent, 'data')
  await mkdir(root)
  await mkdir(data)
  expect((await git(root, ['init'])).code).toBe(0)
  await writeFile(join(root, '.gitignore'), 'ignored.bin\n', 'utf8')
  await writeFile(join(root, 'tracked.txt'), 'committed\n', 'utf8')
  await writeFile(join(root, 'tracked.bin'), new Uint8Array([0, 1, 2, 3]))
  expect((await git(root, ['add', '.'])).code).toBe(0)
  expect(
    (
      await git(root, [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        'commit',
        '-m',
        'initial',
      ])
    ).code,
  ).toBe(0)
  return { root, data }
}

describe('WorkspaceIsolationService', () => {
  test('用隐藏 baseline commit 将完整脏工作树复制到受控 worktree', async () => {
    const { root, data } = await setupRepository()
    await writeFile(join(root, 'tracked.txt'), 'shared baseline\n', 'utf8')
    const dirtyBinary = new Uint8Array([0, 9, 2, 255])
    await writeFile(join(root, 'tracked.bin'), dirtyBinary)
    await writeFile(join(root, 'untracked.txt'), 'untracked\n', 'utf8')
    await writeFile(join(root, 'ignored.bin'), new Uint8Array([7, 7, 7]))

    const service = await WorkspaceIsolationService.open(root, data)
    expect(service.repository.kind).toBe('git')
    const baseline = await service.createWorktree('worker-1')

    expect(await readFile(join(baseline.workspacePath, 'tracked.bin'))).toEqual(
      Buffer.from(dirtyBinary),
    )
    expect(
      (await readFile(join(baseline.workspacePath, 'untracked.txt'), 'utf8')).replaceAll(
        '\r\n',
        '\n',
      ),
    ).toBe('untracked\n')
    expect(await Bun.file(join(baseline.workspacePath, 'ignored.bin')).exists()).toBe(false)
    expect((await git(baseline.workspacePath, ['status', '--porcelain'])).stdout).toBe('')
    expect((await git(root, ['diff', '--cached', '--name-only'])).stdout).toBe('')
    expect((await git(root, ['cat-file', '-t', baseline.snapshotCommit!])).stdout).toBe('commit')
    expect(
      (await git(root, ['cat-file', '-e', `${baseline.snapshotCommit}:ignored.bin`])).code,
    ).not.toBe(0)

    await writeFile(join(baseline.workspacePath, 'tracked.txt'), 'child result\n', 'utf8')
    await writeFile(join(baseline.workspacePath, 'created.txt'), 'created\n', 'utf8')
    const diff = await service.diff(baseline)
    expect(diff.empty).toBe(false)
    expect(diff.patch).toContain('child result')
    expect(diff.patch).toContain('created.txt')

    const preflight = await service.preflightThreeWay(diff.patch)
    expect(preflight.status).toBe('ready')
    if (preflight.status !== 'ready') throw new Error(preflight.diagnostics)
    expect(await service.applyThreeWay(preflight.token)).toMatchObject({ status: 'applied' })
    expect((await readFile(join(root, 'tracked.txt'), 'utf8')).replaceAll('\r\n', '\n')).toBe(
      'child result\n',
    )
    expect((await readFile(join(root, 'created.txt'), 'utf8')).replaceAll('\r\n', '\n')).toBe(
      'created\n',
    )

    expect(await service.complete('worker-1')).toMatchObject({ disposition: 'completed' })
    expect(await Bun.file(baseline.workspacePath).exists()).toBe(false)

    const discarded = await service.createWorktree('worker-2')
    await writeFile(join(discarded.workspacePath, 'discarded.txt'), 'discard me', 'utf8')
    expect(await service.discard('worker-2')).toMatchObject({ disposition: 'discarded' })
    expect(await Bun.file(discarded.workspacePath).exists()).toBe(false)
  }, 30_000)

  test('识别非 Git 工作区并拒绝不安全隔离和路径注入', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'pidex-isolation-nongit-'))
    paths.push(parent)
    const root = join(parent, 'workspace')
    const data = join(parent, 'data')
    await mkdir(root)
    await mkdir(data)
    const service = await WorkspaceIsolationService.open(root, data)

    expect(service.repository).toMatchObject({ kind: 'non-git' })
    expect(await service.captureSharedBaseline()).toMatchObject({
      mode: 'shared',
      repositoryKind: 'non-git',
      snapshotCommit: null,
    })
    await expect(service.createWorktree('../escape')).rejects.toMatchObject({
      code: 'SUBAGENT_WORKSPACE_ID_INVALID',
    })
    await expect(service.createWorktree('worker')).rejects.toMatchObject({
      code: 'SUBAGENT_GIT_REQUIRED',
    })
  })
})
