import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { GitWorkspaceService } from '../src/git/GitWorkspaceService'
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

describe('GitWorkspaceService', () => {
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
})
