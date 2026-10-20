import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { GitWorkspaceService } from '../src/git/GitWorkspaceService'
import { RpcMethods } from '@pidex/agent-protocol'
import { dispatchRpcMessageWithMethods } from '@pidex/agent-protocol/dispatcher'
import { GitReviewService } from '../src/review/GitReviewService'
import type { RpcRouter } from '../src/transport/rpc/RpcRouter'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'

const roots: string[] = []

afterEach(async () => {
  await removeFixturePaths(roots.splice(0))
})

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

const fixture = async () => {
  const container = await mkdtemp(join(tmpdir(), 'pidex-git-workspace-'))
  roots.push(container)
  const root = join(container, 'repository')
  await mkdir(root)
  await git(root, 'init', '-b', 'main')
  await git(root, 'config', 'user.name', 'Pidex Test')
  await git(root, 'config', 'user.email', 'test@pidex.local')
  await writeFile(join(root, 'tracked.txt'), 'main\n', 'utf8')
  await git(root, 'add', 'tracked.txt')
  await git(root, 'commit', '-m', 'initial')
  const db = new AgentDatabase(join(container, 'agent.sqlite'))
  const project = db.createProject({ rootPath: root })
  return { db, project, root, service: new GitWorkspaceService(db) }
}

const upstreamFixture = async () => {
  const container = await mkdtemp(join(tmpdir(), 'pidex-git-sync-'))
  roots.push(container)
  const remote = join(container, 'origin.git')
  await mkdir(remote)
  await git(remote, 'init', '--bare', '-b', 'main')
  const root = join(container, 'repository')
  await mkdir(root)
  await git(root, 'init', '-b', 'main')
  await git(root, 'config', 'user.name', 'Pidex Test')
  await git(root, 'config', 'user.email', 'test@pidex.local')
  await writeFile(join(root, 'tracked.txt'), 'main\n', 'utf8')
  await git(root, 'add', 'tracked.txt')
  await git(root, 'commit', '-m', 'initial')
  await git(root, 'remote', 'add', 'origin', remote)
  await git(root, 'push', '-u', 'origin', 'main')
  const peer = join(container, 'peer')
  await git(container, 'clone', remote, peer)
  await git(peer, 'config', 'user.name', 'Pidex Peer')
  await git(peer, 'config', 'user.email', 'peer@pidex.local')
  const db = new AgentDatabase(join(container, 'agent.sqlite'))
  const project = db.createProject({ rootPath: root })
  return { db, project, root, peer, service: new GitWorkspaceService(db) }
}

describe('GitWorkspaceService', () => {
  test('Git 操作结果通过真实 RPC 严格编码，不泄露内部项目字段', async () => {
    await import('../src/transport/rpc/RpcRouter')
    const { gitHandlers } = await import('../src/transport/rpc/handlers/Git')
    const { db, project, service } = await upstreamFixture()
    const review = new GitReviewService(db)
    const runtime = { dependencies: { git: service, review } } as unknown as RpcRouter
    const operations = [
      { method: 'git/fetch', params: { projectId: project.id } },
      { method: 'git/pull', params: { projectId: project.id } },
      { method: 'git/branch/create', params: { projectId: project.id, branchName: 'rpc-check' } },
      { method: 'git/branch/checkout', params: { projectId: project.id, branchName: 'main' } },
    ] as const
    try {
      for (const { method, params } of operations) {
        const response = await dispatchRpcMessageWithMethods(
          { jsonrpc: '2.0', id: method, method, params },
          RpcMethods,
          { [method]: () => gitHandlers.handle(runtime, method, params, {}) },
          {},
        )
        expect(response, method).not.toHaveProperty('error')
        expect(response).toHaveProperty('result.project.id', project.id)
        expect(response).not.toHaveProperty('result.project.rootPath')
      }
    } finally {
      review.dispose()
      db.close()
    }
  }, 30_000)

  test('创建并切换已有本地分支，拒绝非法名称与覆盖本地修改', async () => {
    const { db, project, root, service } = await fixture()
    try {
      await service.createBranch({
        projectId: project.id,
        branchName: 'feature/desktop-rpc',
      })
      expect(await git(root, 'branch', '--show-current')).toBe('feature/desktop-rpc')
      await writeFile(join(root, 'tracked.txt'), 'feature\n', 'utf8')
      await git(root, 'add', 'tracked.txt')
      await git(root, 'commit', '-m', 'feature')
      await service.checkoutBranch({
        projectId: project.id,
        branchName: 'main',
      })
      expect(await git(root, 'branch', '--show-current')).toBe('main')

      await expect(
        service.createBranch({
          projectId: project.id,
          branchName: '../invalid',
        }),
      ).rejects.toMatchObject({ code: 'GIT_BRANCH_INVALID' })

      await writeFile(join(root, 'tracked.txt'), 'local change\n', 'utf8')
      await expect(
        service.checkoutBranch({
          projectId: project.id,
          branchName: 'feature/desktop-rpc',
        }),
      ).rejects.toMatchObject({ code: 'GIT_CHECKOUT_CONFLICT' })
      expect(await git(root, 'branch', '--show-current')).toBe('main')
    } finally {
      db.close()
    }
  }, 30_000)

  test('Fetch 更新远端引用但不改变工作树', async () => {
    const { db, project, root, peer, service } = await upstreamFixture()
    try {
      await writeFile(join(peer, 'peer.txt'), 'peer\n', 'utf8')
      await git(peer, 'add', 'peer.txt')
      await git(peer, 'commit', '-m', 'peer')
      await git(peer, 'push', 'origin', 'main')
      const peerHead = await git(peer, 'rev-parse', 'HEAD')
      const localHead = await git(root, 'rev-parse', 'HEAD')
      await writeFile(join(root, 'tracked.txt'), 'local dirty\n', 'utf8')

      await service.fetch(project.id)

      expect(await git(root, 'rev-parse', 'refs/remotes/origin/main')).toBe(peerHead)
      expect(await git(root, 'rev-parse', 'HEAD')).toBe(localHead)
      expect(await readFile(join(root, 'tracked.txt'), 'utf8')).toBe('local dirty\n')
      expect(await git(root, 'status', '--porcelain')).toContain('tracked.txt')
    } finally {
      db.close()
    }
  }, 30_000)

  test('Pull 对当前分支上游执行仅快进更新', async () => {
    const { db, project, root, peer, service } = await upstreamFixture()
    try {
      await writeFile(join(peer, 'peer.txt'), 'peer\n', 'utf8')
      await git(peer, 'add', 'peer.txt')
      await git(peer, 'commit', '-m', 'peer')
      await git(peer, 'push', 'origin', 'main')
      const peerHead = await git(peer, 'rev-parse', 'HEAD')

      await service.pull(project.id)

      expect(await git(root, 'rev-parse', 'HEAD')).toBe(peerHead)
      expect((await readFile(join(root, 'peer.txt'), 'utf8')).trim()).toBe('peer')
    } finally {
      db.close()
    }
  }, 30_000)

  test('Pull 拒绝分叉、无上游和 detached HEAD', async () => {
    const { db, project, root, peer, service } = await upstreamFixture()
    try {
      await writeFile(join(root, 'local.txt'), 'local\n', 'utf8')
      await git(root, 'add', 'local.txt')
      await git(root, 'commit', '-m', 'local')
      const localHead = await git(root, 'rev-parse', 'HEAD')
      await writeFile(join(peer, 'peer.txt'), 'peer\n', 'utf8')
      await git(peer, 'add', 'peer.txt')
      await git(peer, 'commit', '-m', 'peer')
      await git(peer, 'push', 'origin', 'main')

      await expect(service.pull(project.id)).rejects.toMatchObject({ code: 'GIT_PULL_FAILED' })
      expect(await git(root, 'rev-parse', 'HEAD')).toBe(localHead)

      await git(root, 'checkout', '-b', 'no-upstream')
      await expect(service.pull(project.id)).rejects.toMatchObject({ code: 'GIT_BRANCH_REQUIRED' })

      await git(root, 'checkout', '--detach')
      await expect(service.pull(project.id)).rejects.toMatchObject({ code: 'GIT_BRANCH_REQUIRED' })
    } finally {
      db.close()
    }
  }, 30_000)

  test('Pull 不覆盖未提交的本地改动', async () => {
    const { db, project, root, peer, service } = await upstreamFixture()
    try {
      await writeFile(join(peer, 'tracked.txt'), 'peer\n', 'utf8')
      await git(peer, 'add', 'tracked.txt')
      await git(peer, 'commit', '-m', 'peer')
      await git(peer, 'push', 'origin', 'main')
      const localHead = await git(root, 'rev-parse', 'HEAD')
      await writeFile(join(root, 'tracked.txt'), 'local change\n', 'utf8')

      await expect(service.pull(project.id)).rejects.toMatchObject({ code: 'GIT_PULL_FAILED' })

      expect(await readFile(join(root, 'tracked.txt'), 'utf8')).toBe('local change\n')
      expect(await git(root, 'rev-parse', 'HEAD')).toBe(localHead)
    } finally {
      db.close()
    }
  }, 30_000)

  test('Fetch 逐行 trim 后解析 remote，兼容 CRLF 输出', async () => {
    const container = await mkdtemp(join(tmpdir(), 'pidex-git-crlf-'))
    roots.push(container)
    const root = join(container, 'repository')
    await mkdir(root)
    const db = new AgentDatabase(join(container, 'agent.sqlite'))
    const project = db.createProject({ rootPath: root })
    const calls: string[][] = []
    // Windows git may emit CRLF; a remote name carrying '\r' would break config lookups.
    const runner = {
      run: async ({ args }: { args: readonly string[] }) => {
        calls.push([...args])
        if (args[0] === 'rev-parse') return { code: 0, stdout: `${root}\n`, stderr: '' }
        if (args[0] === 'remote') return { code: 0, stdout: 'origin\r\nbackup\r\n', stderr: '' }
        return { code: 1, stdout: '', stderr: '' }
      },
    }
    const fetched: string[] = []
    const service = new GitWorkspaceService(
      db,
      runner as never,
      {
        runRemoteGit: async (_cwd: string, remote: string) => {
          fetched.push(remote)
          return { code: 0, stdout: '', stderr: '' }
        },
      },
    )
    try {
      await service.fetch(project.id)
      // Both names survive the CRLF split intact and reach the remote runner trimmed.
      expect(fetched).toEqual(['origin', 'backup'])
      const skipLookups = calls.filter((args) => args.includes('--get'))
      expect(skipLookups.map((args) => args[3])).toEqual([
        'remote.origin.skipFetchAll',
        'remote.backup.skipFetchAll',
      ])
      for (const remote of fetched) expect(remote).not.toContain('\r')
    } finally {
      db.close()
    }
  }, 30_000)
})
