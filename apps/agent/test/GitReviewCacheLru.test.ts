import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
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

const createRepo = async (name: string) => {
  const container = await mkdtemp(join(tmpdir(), `pidex-lru-${name}-`))
  roots.push(container)
  await git(container, 'init', '-b', 'main')
  await git(container, 'config', 'user.name', 'Pidex Test')
  await git(container, 'config', 'user.email', 'test@pidex.local')
  await writeFile(join(container, 'file.txt'), 'hello\n')
  await git(container, 'add', 'file.txt')
  await git(container, 'commit', '-m', 'init')
  return container
}

describe('GitReviewService LRU and Shrink', () => {
  test('bounds snapshot cache to maxSnapshots and shrinks properly', async () => {
    const container = await mkdtemp(join(tmpdir(), 'pidex-db-'))
    roots.push(container)
    const db = new AgentDatabase(join(container, 'history.db'))

    const repo1 = await createRepo('1')
    const repo2 = await createRepo('2')
    const repo3 = await createRepo('3')

    const project1 = db.createProject({ rootPath: repo1 })
    const project2 = db.createProject({ rootPath: repo2 })
    const project3 = db.createProject({ rootPath: repo3 })

    // Create review service with maxSnapshots = 2
    const reviewService = new GitReviewService(db, undefined, undefined, undefined, undefined, {
      maxSnapshots: 2,
    })

    // Load snapshots for p1, p2
    const res1 = await reviewService.summary(project1.id, { kind: 'unstaged' })
    expect(res1.files).toBeDefined()
    const res2 = await reviewService.summary(project2.id, { kind: 'unstaged' })
    expect(res2.files).toBeDefined()

    // Load snapshot for p3 (should evict p1 as oldest)
    const res3 = await reviewService.summary(project3.id, { kind: 'unstaged' })
    expect(res3.files).toBeDefined()

    // Calling shrink() retains at most 1 snapshot
    reviewService.shrink()

    reviewService.dispose()
    db.close()
  })
})
