import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RpcRouter } from '../src/transport/rpc/RpcRouter'
import { removeFixturePaths } from './FixtureCleanup'

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)))

test('push and create PR use the thread execution directory and preserve project fallback', async () => {
  await import('../src/transport/rpc/RpcRouter')
  const { githubHandlers } = await import('../src/transport/rpc/handlers/Github')
  const root = await mkdtemp(join(tmpdir(), 'pidex-github-root-'))
  paths.push(root)
  const worktree = join(root, 'worktree')
  await mkdir(worktree)
  const operations: string[] = []
  const resolved: string[] = []
  const runtime = {
    dependencies: {
      db: {
        getProject: () => ({ rootPath: root }),
        projectMembership: () => 'project',
      },
      terminalContext: {
        resolve: async (threadId: string) => {
          resolved.push(threadId)
          return { target: { cwd: worktree } }
        },
      },
      github: {
        push: async ({ workspaceRoot }: { workspaceRoot: string }) => {
          operations.push(workspaceRoot)
        },
        createPullRequestForProject: async ({ workspaceRoot }: { workspaceRoot: string }) => {
          operations.push(workspaceRoot)
          return {
            pullRequest: {
              htmlUrl: 'https://github.com/octocat/fixture/pull/7',
              title: 'PR',
              head: { ref: 'feature' },
            },
          }
        },
      },
      threadPullRequests: { record: () => undefined },
    },
  } as unknown as RpcRouter
  for (const method of ['github/push', 'github/pullRequest/createForProject'] as const) {
    await githubHandlers.handle(runtime, method, {
      projectId: 'project',
      threadId: 'thread',
      title: 'PR',
    })
    await githubHandlers.handle(runtime, method, { projectId: 'project', title: 'PR' })
  }
  expect(operations).toEqual([worktree, root, worktree, root])
  expect(resolved).toEqual(['thread', 'thread'])
  await expect(
    githubHandlers.handle(runtime, 'github/push', { projectId: 'other', threadId: 'thread' }),
  ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  expect(operations).toHaveLength(4)
})
