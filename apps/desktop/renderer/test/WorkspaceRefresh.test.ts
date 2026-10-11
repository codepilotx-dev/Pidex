import { describe, expect, test } from 'bun:test'
import type { DesktopGitStatus, DesktopGitStatusResult, DesktopWorkspace } from '../shared/Types.js'
import type {
  DesktopReviewAgentSummary,
  DesktopReviewAgentSummaryResult,
} from '../src/services/desktop-client/Types.js'
import {
  createWorkspaceRefreshCoordinator,
  mergeWorkspaceGitProjection,
  mergeWorkspaceReviewFileStats,
  resolveWorkspaceGitProjection,
  type WorkspaceGitProjectionLoaders,
  workspaceIdentity,
  shouldApplyWorkspaceGitProjection,
} from '../src/features/workspace/UseWorkspaceState.js'

describe('workspace refresh coordination', () => {
  test('publishes repository type before slow Review statistics finish', async () => {
    let finish!: () => void
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    let detected: string | null = null
    let completed = false
    const result = resolveWorkspaceGitProjection(
      workspace(),
      {
        loadGitStatus: async () => ({ ok: true, status: gitStatus('dev', []) }),
        loadBranches: async () => [],
        loadReviewSummary: async (source) => {
          await pending
          return reviewAgentSummaryResult(source.kind, [])
        },
      },
      (projection) => {
        detected = projection.detection
      },
    )
    void result.then(() => {
      completed = true
    })
    await Promise.resolve()
    expect(detected).toBe('git')
    expect(completed).toBe(false)
    finish()
    expect((await result).detection).toBe('git')
  })
  test('rejects results from previous projects and earlier requests, including A to B to A', () => {
    const a = workspaceIdentity(workspace())
    const b = workspaceIdentity(workspace({ projectId: 'other', path: 'C:\\Other' }))
    expect(shouldApplyWorkspaceGitProjection(a, 1, a, 1)).toBe(true)
    expect(shouldApplyWorkspaceGitProjection(b, 2, a, 1)).toBe(false)
    expect(shouldApplyWorkspaceGitProjection(a, 3, b, 2)).toBe(false)
    expect(shouldApplyWorkspaceGitProjection(a, 3, a, 1)).toBe(false)
    expect(shouldApplyWorkspaceGitProjection(a, 4, a, 3)).toBe(false)
    expect(shouldApplyWorkspaceGitProjection(null, 5, a, 4)).toBe(false)
  })

  test('an error message that mentions non-repository does not confirm non-Git', async () => {
    const original = workspace({ isGitRepo: true })
    const result = await resolveWorkspaceGitProjection(original, {
      loadGitStatus: async () => ({ ok: false, error: 'REPOSITORY_NOT_FOUND' }),
      loadBranches: async () => {
        throw new Error('must not load')
      },
      loadReviewSummary: async () => {
        throw new Error('must not load')
      },
    })
    expect(result.detection).toBe('error')
    expect(result.workspace).toBe(original)
  })
  test('normalizes paths while preserving project and folder identity', () => {
    const first = workspace({
      path: 'C:\\Code\\Project\\',
      projectId: 'project-a',
      primaryFolderId: 'folder-a',
    })

    expect(
      workspaceIdentity(
        workspace({
          path: 'c:/code/project',
          projectId: 'project-a',
          primaryFolderId: 'folder-a',
        }),
      ),
    ).toBe(workspaceIdentity(first))
    expect(
      workspaceIdentity(
        workspace({
          path: 'c:/code/project',
          projectId: 'project-b',
          primaryFolderId: 'folder-a',
        }),
      ),
    ).not.toBe(workspaceIdentity(first))
    expect(
      workspaceIdentity(
        workspace({
          path: 'c:/code/project',
          projectId: 'project-a',
          primaryFolderId: 'folder-b',
        }),
      ),
    ).not.toBe(workspaceIdentity(first))
  })

  test('reuses in-flight work, skips an applied identity, and honors force', async () => {
    let loads = 0
    const coordinator = createWorkspaceRefreshCoordinator(async () => {
      loads += 1
      return loads
    })
    const firstWorkspace = workspace({ path: 'C:\\Code\\Project\\' })
    const equivalentWorkspace = workspace({ path: 'c:/code/project' })

    const first = coordinator.load(firstWorkspace)
    const duplicate = coordinator.load(equivalentWorkspace)
    const forcedDuplicate = coordinator.load(equivalentWorkspace, {
      force: true,
    })
    expect(first).not.toBeNull()
    expect(duplicate).toBe(first)
    expect(forcedDuplicate).toBe(first)
    expect(loads).toBe(1)

    await first
    coordinator.markApplied(firstWorkspace)
    expect(coordinator.load(equivalentWorkspace)).toBeNull()
    expect(loads).toBe(1)

    const different = coordinator.load(workspace({ path: 'C:\\Code\\Other' }))
    expect(different).not.toBeNull()
    await different
    expect(loads).toBe(2)

    const forced = coordinator.load(equivalentWorkspace, { force: true })
    expect(forced).not.toBeNull()
    await forced
    expect(loads).toBe(3)
  })

  test('projects the current branch and local branches into the workspace', () => {
    const projected = mergeWorkspaceGitProjection(
      workspace({
        branchName: 'stale',
        branches: ['stale'],
        isGitRepo: false,
      }),
      gitStatus('dev'),
      [
        { name: 'feature/local', remote: false },
        { name: 'origin/dev', remote: true },
        { name: 'dev', remote: false },
        { name: 'feature/local', remote: false },
      ],
    )

    expect(projected).toMatchObject({
      branchName: 'dev',
      branches: ['dev', 'feature/local'],
      isGitRepo: true,
    })
  })

  test('keeps the current branch when branch enumeration is unavailable', () => {
    const projected = mergeWorkspaceGitProjection(workspace(), gitStatus('dev'), [])

    expect(projected.branchName).toBe('dev')
    expect(projected.branches).toEqual(['dev'])
    expect(projected.isGitRepo).toBe(true)
  })

  test('clears stale branch data when git status is unavailable', () => {
    const projected = mergeWorkspaceGitProjection(
      workspace({
        branchName: 'stale',
        branches: ['stale'],
        isGitRepo: false,
      }),
      null,
      [{ name: 'stale', remote: false }],
    )

    expect(projected.branchName).toBeNull()
    expect(projected.branches).toEqual([])
    expect(projected.isGitRepo).toBe(false)
  })

  test('non-Git REPOSITORY_NOT_FOUND skips branches and both Review loaders', async () => {
    const calls = { gitStatus: 0, branches: 0, unstaged: 0, staged: 0 }
    const result = await resolveWorkspaceGitProjection(
      workspace({ branchName: 'stale', branches: ['stale'], isGitRepo: true }),
      {
        loadGitStatus: async () => {
          calls.gitStatus += 1
          return { ok: false, error: '非仓库', errorCode: 'REPOSITORY_NOT_FOUND' }
        },
        loadBranches: async () => {
          calls.branches += 1
          return [{ name: 'dev', remote: false }]
        },
        loadReviewSummary: async (source) => {
          calls[source.kind === 'staged' ? 'staged' : 'unstaged'] += 1
          return reviewAgentSummaryResult(source.kind, [])
        },
      },
    )

    expect(calls.gitStatus).toBe(1)
    expect(calls.branches).toBe(0)
    expect(calls.unstaged).toBe(0)
    expect(calls.staged).toBe(0)
    expect(result.gitStatus).toBeNull()
    expect(result.workspace).toMatchObject({
      branchName: null,
      branches: [],
      isGitRepo: false,
    })
  })

  test('Git status rejection is an error and preserves the known workspace type', async () => {
    const calls = { gitStatus: 0, branches: 0, unstaged: 0, staged: 0 }
    const result = await resolveWorkspaceGitProjection(workspace(), {
      loadGitStatus: async () => {
        calls.gitStatus += 1
        throw new Error('REPOSITORY_NOT_FOUND')
      },
      loadBranches: async () => {
        calls.branches += 1
        return []
      },
      loadReviewSummary: async (source) => {
        calls[source.kind === 'staged' ? 'staged' : 'unstaged'] += 1
        return reviewAgentSummaryResult(source.kind, [])
      },
    })

    expect(calls.gitStatus).toBe(1)
    expect(calls.branches).toBe(0)
    expect(calls.unstaged).toBe(0)
    expect(calls.staged).toBe(0)
    expect(result.gitStatus).toBeNull()
    expect(result.detection).toBe('error')
    expect(result.workspace).toEqual(workspace())
  })

  test('Git repository loads branches and both Review summaries with merged stats', async () => {
    const calls = { gitStatus: 0, branches: 0, unstaged: 0, staged: 0 }
    const result = await resolveWorkspaceGitProjection(workspace(), {
      loadGitStatus: async () => {
        calls.gitStatus += 1
        return { ok: true, status: gitStatus('dev', [gitFile('src/main.ts')]) }
      },
      loadBranches: async () => {
        calls.branches += 1
        return [
          { name: 'feature/local', remote: false },
          { name: 'origin/dev', remote: true },
        ]
      },
      loadReviewSummary: async (source) => {
        if (source.kind === 'staged') {
          calls.staged += 1
          return reviewAgentSummaryResult('staged', [reviewFile('src/main.ts', 3, 1)])
        }
        calls.unstaged += 1
        return reviewAgentSummaryResult('unstaged', [reviewFile('src/main.ts', 4, 2)])
      },
    })

    expect(calls.gitStatus).toBe(1)
    expect(calls.branches).toBe(1)
    expect(calls.unstaged).toBe(1)
    expect(calls.staged).toBe(1)
    expect(result.workspace).toMatchObject({
      branchName: 'dev',
      branches: ['dev', 'feature/local'],
      isGitRepo: true,
    })
    expect(result.gitStatus?.files[0]).toMatchObject({
      additions: 7,
      deletions: 3,
    })
  })

  test('Git repository keeps git status without partial stats when a Review summary fails', async () => {
    const calls = { gitStatus: 0, branches: 0, unstaged: 0, staged: 0 }
    const status = gitStatus('dev', [gitFile('src/main.ts')])
    const result = await resolveWorkspaceGitProjection(workspace(), {
      loadGitStatus: async () => {
        calls.gitStatus += 1
        return { ok: true, status }
      },
      loadBranches: async () => {
        calls.branches += 1
        return []
      },
      loadReviewSummary: async (source) => {
        if (source.kind === 'staged') {
          calls.staged += 1
          throw new Error('REPOSITORY_NOT_FOUND')
        }
        calls.unstaged += 1
        return reviewAgentSummaryResult('unstaged', [reviewFile('src/main.ts', 4, 2)])
      },
    })

    expect(calls.unstaged).toBe(1)
    expect(calls.staged).toBe(1)
    expect(result.gitStatus).toBe(status)
    expect(result.gitStatus?.files[0]).toMatchObject({
      additions: null,
      deletions: null,
    })
  })

  test('merges staged and unstaged review stats by normalized path', () => {
    const status = gitStatus('dev', [
      gitFile('SRC\\Main.ts'),
      gitFile('assets/logo.png'),
      gitFile('src/unavailable.ts'),
    ])
    const merged = mergeWorkspaceReviewFileStats(status, [
      reviewSummary([
        reviewFile('src/main.ts', 4, 2),
        reviewFile('assets/logo.png', null, null, true),
      ]),
      reviewSummary([reviewFile('src/main.ts', 3, 1)]),
    ])

    expect(merged?.files).toEqual([
      { ...gitFile('SRC\\Main.ts'), additions: 7, deletions: 3 },
      { ...gitFile('assets/logo.png'), additions: 0, deletions: 0 },
      gitFile('src/unavailable.ts'),
    ])
  })

  test('does not publish partial line stats when either review summary fails', () => {
    const status = gitStatus('dev', [gitFile('src/main.ts')])
    const merged = mergeWorkspaceReviewFileStats(status, [
      reviewSummary([reviewFile('src/main.ts', 4, 2)]),
      null,
    ])

    expect(merged).toBe(status)
    expect(merged?.files[0]).toMatchObject({ additions: null, deletions: null })
  })
})

function workspace(overrides: Partial<DesktopWorkspace> = {}): DesktopWorkspace {
  return {
    name: 'Workspace',
    path: 'C:\\Code\\Project',
    ...overrides,
  }
}

function gitStatus(
  branchName: string | null,
  files: DesktopGitStatus['files'] = [],
): DesktopGitStatus {
  return {
    branchName,
    upstream: null,
    ahead: 0,
    behind: 0,
    clean: true,
    files,
  }
}

function gitFile(path: string): DesktopGitStatus['files'][number] {
  return {
    path,
    status: ' M',
    stagedStatus: ' ',
    unstagedStatus: 'M',
    additions: null,
    deletions: null,
    isUntracked: false,
  }
}

function reviewSummary(
  files: DesktopReviewAgentSummary['files'],
): Pick<DesktopReviewAgentSummary, 'files'> {
  return { files }
}

function reviewAgentSummaryResult(
  source: 'unstaged' | 'staged',
  files: DesktopReviewAgentSummary['files'],
): DesktopReviewAgentSummaryResult {
  return {
    snapshot: {
      projectId: 'project-a',
      generation: `generation:${source}`,
      source: { kind: source },
      repositoryRoot: 'C:\\Code\\Project',
      headSha: null,
      baseSha: null,
      files,
      totals: {
        files: files.length,
        additions: 0,
        deletions: 0,
        changedLines: 0,
        changedBytes: 0,
      },
      largeDiffMode: false,
    },
    cacheState: 'fresh',
  }
}

function reviewFile(
  path: string,
  additions: number | null,
  deletions: number | null,
  binary = false,
): DesktopReviewAgentSummary['files'][number] {
  return {
    path,
    previousPath: null,
    status: 'modified',
    additions,
    deletions,
    changedLines: (additions ?? 0) + (deletions ?? 0),
    changedBytes: 0,
    binary,
    revision: `revision:${path}`,
  }
}
