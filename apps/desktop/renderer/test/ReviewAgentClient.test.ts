import { describe, expect, spyOn, test } from 'bun:test'
import { AgentRpcError } from '../src/services/AgentRpcClient.js'
import { AgentRpcTimeoutError } from '../src/services/RpcFetch.js'
import {
  pickDefaultReviewBaseBranch,
  retainCurrentReviewFileDiffs,
  ReviewFileRequestCoordinator,
  reviewLoadStateForError,
} from '../src/features/review/source/ReviewAgentClient.js'
import { formatReviewCount } from '../src/features/review/diff/ReviewFormat.js'
import {
  reviewFileDiffLoadMode,
  reviewFileLoadMessage,
} from '../src/features/review/diff/WorkspaceReviewDiff.js'
import {
  reviewDiagnosticMessage,
  startReviewDiagnosticTimer,
} from '../src/features/review/source/ReviewDiagnostics.js'
import { createAgentReviewApi } from '../src/services/desktop-client/AgentReviewApi.js'
import {
  buildReviewFileTree,
  flattenReviewFileTree,
} from '../src/features/review/workspace/BuildReviewFileTree.js'
import type { DesktopReviewDiffFile } from '../shared/Types.js'
import type {
  ReviewFileDiff,
  ReviewFileSummary,
  ReviewSummarySnapshot,
} from '../src/features/review/source/ReviewAgentClient.js'

describe('review load state', () => {
  test('文件树按固定虚拟行顺序扁平化并跳过折叠目录内容', () => {
    const files = [
      reviewTreeFile('root.ts'),
      reviewTreeFile('src/a.ts'),
      reviewTreeFile('src/nested/b.ts'),
    ]
    const tree = buildReviewFileTree(files)

    expect(
      flattenReviewFileTree(tree, new Set()).map((row) => [
        row.kind,
        row.kind === 'file' ? row.file.path : row.node.dirPath,
        row.depth,
      ]),
    ).toEqual([
      ['file', 'root.ts', 0],
      ['directory', 'src', 0],
      ['file', 'src/a.ts', 1],
      ['directory', 'src/nested', 1],
      ['file', 'src/nested/b.ts', 2],
    ])
    expect(flattenReviewFileTree(tree, new Set(['src'])).map((row) => row.key)).toEqual([
      'file:root.ts',
      'directory:src',
    ])
  })

  test('审阅统计使用精确千分位而不是截断为 999+', () => {
    expect(formatReviewCount(3344)).toBe('3,344')
    expect(formatReviewCount(626)).toBe('626')
    expect(formatReviewCount(-1)).toBe('0')
  })

  test('区分非仓库、过期快照、能力缺失和普通错误', () => {
    expect(
      reviewLoadStateForError(
        new AgentRpcError('不是 Git 仓库', -32_000, {
          code: 'REPOSITORY_NOT_FOUND',
        }),
      ),
    ).toBe('not-repository')
    expect(
      reviewLoadStateForError(
        new AgentRpcError('快照过期', -32_000, {
          code: 'REVIEW_SNAPSHOT_EXPIRED',
        }),
      ),
    ).toBe('stale')
    expect(
      reviewLoadStateForError(
        new AgentRpcError('能力不可用', -32_000, {
          code: 'CAPABILITY_REQUIRED',
        }),
      ),
    ).toBe('unsupported')
    expect(reviewLoadStateForError(new Error('网络中断'))).toBe('error')
  })

  test('fresh 快照即使 generation 不变也会触发正确的文件加载模式', () => {
    const common = {
      hasSummary: true,
      largeWorkspaceMode: false,
      selectedPath: 'src/app.ts',
    }

    expect(
      reviewFileDiffLoadMode({
        ...common,
        cacheState: 'stale',
        summaryLoadState: 'stale',
      }),
    ).toBe('none')
    expect(
      reviewFileDiffLoadMode({
        ...common,
        cacheState: 'fresh',
        summaryLoadState: 'success',
      }),
    ).toBe('batch')
    expect(
      reviewFileDiffLoadMode({
        ...common,
        cacheState: 'fresh',
        summaryLoadState: 'large-diff',
        largeWorkspaceMode: true,
      }),
    ).toBe('selected')
    for (const summaryLoadState of ['loading', 'empty', 'error'] as const) {
      expect(
        reviewFileDiffLoadMode({
          ...common,
          cacheState: 'fresh',
          summaryLoadState,
        }),
      ).toBe('none')
    }
    expect(
      reviewFileDiffLoadMode({
        ...common,
        cacheState: 'fresh',
        summaryLoadState: 'large-diff',
        largeWorkspaceMode: true,
        selectedPath: null,
      }),
    ).toBe('none')
  })

  test('分支来源优先选择远端主分支并在单分支仓库回退当前分支', () => {
    expect(
      pickDefaultReviewBaseBranch([
        { name: 'feature/review', sha: '1', current: true, remote: false },
        { name: 'origin/main', sha: '2', current: false, remote: true },
        { name: 'origin/feature/review', sha: '1', current: false, remote: true },
      ]),
    ).toBe('origin/main')
    expect(
      pickDefaultReviewBaseBranch([{ name: 'main', sha: '1', current: true, remote: false }]),
    ).toBe('main')
    expect(pickDefaultReviewBaseBranch([])).toBeNull()
  })

  test('摘要刷新只丢弃 revision 已变化或已删除文件的 Diff', () => {
    const stable = reviewFileDiff(reviewFileSummary('stable.ts', 'rev-1'))
    const changed = reviewFileDiff(reviewFileSummary('changed.ts', 'rev-1'))
    const deleted = reviewFileDiff(reviewFileSummary('deleted.ts', 'rev-1'))
    const retained = retainCurrentReviewFileDiffs(
      reviewSummary([
        reviewFileSummary('stable.ts', 'rev-1'),
        reviewFileSummary('changed.ts', 'rev-2'),
        reviewFileSummary('new.ts', 'rev-1'),
      ]),
      new Map([
        ['stable.ts', stable],
        ['changed.ts', changed],
        ['deleted.ts', deleted],
      ]),
    )

    expect([...retained.keys()]).toEqual(['stable.ts'])
    expect(retained.get('stable.ts')).toBe(stable)
  })

  test('文件加载合并相同请求，并将并发限制为 2', async () => {
    const coordinator = new ReviewFileRequestCoordinator(2)
    let active = 0
    let peak = 0
    let firstRunCount = 0
    const started: string[] = []
    const releases: Array<() => void> = []
    const task = (onRun?: () => void) => async (): Promise<void> => {
      onRun?.()
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>((resolve) => releases.push(resolve))
      active -= 1
    }

    const first = coordinator.schedule(
      'generation:path-a:standard',
      task(() => {
        firstRunCount += 1
        started.push('a')
      }),
      'selected',
    )
    const duplicate = coordinator.schedule(
      'generation:path-a:standard',
      task(() => {
        firstRunCount += 1
      }),
    )
    const second = coordinator.schedule(
      'generation:path-b:standard',
      task(() => started.push('b')),
    )
    const third = coordinator.schedule(
      'generation:path-c:standard',
      task(() => started.push('c')),
    )
    const fourth = coordinator.schedule(
      'generation:path-d:standard',
      task(() => started.push('d')),
    )
    const promoted = coordinator.schedule(
      'generation:path-d:standard',
      task(() => started.push('duplicate-d')),
      'selected',
    )

    await Promise.resolve()
    expect(first).toBe(duplicate)
    expect(fourth).toBe(promoted)
    expect(firstRunCount).toBe(1)
    expect(active).toBe(2)
    expect(peak).toBe(2)

    releases.shift()?.()
    await Bun.sleep(0)
    expect(active).toBe(2)
    expect(peak).toBe(2)
    expect(started[2]).toBe('d')

    while (active > 0 || releases.length > 0) {
      while (releases.length > 0) releases.shift()?.()
      await Bun.sleep(0)
    }
    await Promise.all([first, duplicate, second, third, fourth, promoted])
  })
})

describe('review diagnostics', () => {
  test('保留相对文件路径并过滤 RPC details、绝对路径和凭据', () => {
    const message = reviewDiagnosticMessage(
      'review.file-diff.load.failed',
      {
        sourceKind: 'unstaged',
        path: 'src/index.ts',
        stage: 'initial',
      },
      new AgentRpcError(
        '读取 C:\\private\\workspace\\src\\index.ts 失败 token=secret-value',
        -32_000,
        {
          code: 'REVIEW_SNAPSHOT_EXPIRED',
          status: 409,
          details: {
            latestGeneration: 'generation-secret',
            stack: 'stack-secret',
          },
        },
      ),
    )

    expect(message).toContain('[review] {')
    expect(message).toContain('review.file-diff.load.failed')
    expect(message).toContain('src/index.ts')
    expect(message).toContain('REVIEW_SNAPSHOT_EXPIRED')
    expect(message).toContain('"status":409')
    expect(message).toContain('[PATH]')
    expect(message).toContain('token=[REDACTED]')
    expect(message).not.toContain('C:\\private')
    expect(message).not.toContain('generation-secret')
    expect(message).not.toContain('stack-secret')
  })

  test('文件差异加载文案区分摘要刷新、真实请求与摘要失败', () => {
    expect(reviewFileLoadMessage({ status: 'idle' }, 'stale')).toBe('正在刷新变更快照…')
    expect(reviewFileLoadMessage({ status: 'loading' }, 'success')).toBe('正在加载文件差异…')
    expect(reviewFileLoadMessage({ status: 'idle' }, 'error')).toBe(
      '变更快照加载失败，请使用上方重试。',
    )
  })

  test('慢请求恢复日志可搜索且超时错误只暴露安全字段', async () => {
    const warning = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const timer = startReviewDiagnosticTimer(
        'review.file-diffs.load',
        { sourceKind: 'unstaged', pathCount: 52, hideWhitespace: false },
        0,
        100,
      )
      await Bun.sleep(5)
      timer.succeed({ resultType: 'success' })

      const messages = warning.mock.calls.map((call) => String(call[0]))
      expect(messages.some((message) => message.includes('review.file-diffs.load.slow'))).toBe(true)
      expect(messages.some((message) => message.includes('review.file-diffs.load.recovered'))).toBe(
        true,
      )
      expect(messages.join('\n')).not.toContain('generation')
      expect(messages.join('\n')).not.toContain('C:\\private')

      const timeout = reviewDiagnosticMessage(
        'review.file-diffs.load.failed',
        { sourceKind: 'unstaged', pathCount: 52 },
        new AgentRpcTimeoutError('review/file-diffs'),
      )
      expect(timeout).toContain('REVIEW_REQUEST_TIMEOUT')
      expect(timeout).not.toContain('stack')
    } finally {
      warning.mockRestore()
    }
  })
})

describe('review batch capability', () => {
  test('uses the explicit project identity instead of resolving by path', async () => {
    const calls: Array<[string, unknown]> = []
    const api = createAgentReviewApi({
      rpc: {
        ensureInitialized: async () => ({ capabilities: ['git.review.v1'] }),
        call: async (method: string, input: unknown) => {
          calls.push([method, input])
          return { snapshot: reviewSummary([]), cacheState: 'fresh' }
        },
      } as never,
      loadProjectById: async (projectId) => ({ id: projectId }) as never,
      loadProjectForPath: async () => {
        throw new Error('不应按路径解析项目')
      },
      preparePullRequestReview: async () => {},
      requireGithubPullRequestCapability: () => {},
      requireReviewCapability: () => {},
      unsupportedReviewOperation: () => {
        throw new Error('unsupported')
      },
      withAgentOrMock: (agentOperation) => agentOperation(),
    })

    await api.getAgentReviewSummary({
      projectId: 'project-explicit',
      workspacePath: 'C:\\shared',
      source: { kind: 'unstaged' },
    })

    expect(calls).toEqual([
      [
        'review/summary',
        {
          projectId: 'project-explicit',
          source: { kind: 'unstaged' },
        },
      ],
    ])
  })

  test('旧 Agent 缺少批量能力时不会发送批量 RPC', async () => {
    const calls: string[] = []
    const api = createReviewApiForBatchTest(false, calls)

    await expect(
      api.getAgentReviewFileDiffs({
        workspacePath: 'C:\\workspace',
        source: { kind: 'unstaged' },
        generation: 'generation-1',
        paths: ['src/a.ts', 'src/b.ts'],
        hideWhitespace: false,
      }),
    ).rejects.toMatchObject({ code: 'AGENT_OPERATION_UNSUPPORTED' })
    expect(calls).toEqual([])
  })

  test('协商到批量能力时只发送一次批量 RPC', async () => {
    const calls: string[] = []
    const api = createReviewApiForBatchTest(true, calls)

    await api.getAgentReviewFileDiffs({
      workspacePath: 'C:\\workspace',
      source: { kind: 'unstaged' },
      generation: 'generation-1',
      paths: ['src/a.ts', 'src/b.ts'],
      hideWhitespace: false,
    })

    expect(calls).toEqual(['review/file-diffs'])
  })
})

function reviewFileSummary(path: string, revision: string): ReviewFileSummary {
  return {
    path,
    previousPath: null,
    status: 'modified',
    additions: 1,
    deletions: 1,
    changedLines: 2,
    changedBytes: 16,
    binary: false,
    revision,
  }
}

function reviewTreeFile(path: string): DesktopReviewDiffFile {
  return {
    path,
    status: 'modified',
    additions: 1,
    deletions: 1,
    isUntracked: false,
    hunks: [],
  }
}

function reviewFileDiff(file: ReviewFileSummary): ReviewFileDiff {
  return {
    file,
    revision: file.revision,
    patch: '',
    hunks: [],
    renderable: true,
    tooLargeReason: null,
  }
}

function reviewSummary(files: ReviewFileSummary[]): ReviewSummarySnapshot {
  return {
    projectId: 'project-1',
    generation: 'generation-2',
    source: { kind: 'unstaged' },
    repositoryRoot: 'C:\\workspace',
    headSha: 'head',
    baseSha: 'base',
    files,
    totals: {
      files: files.length,
      additions: 0,
      deletions: 0,
      changedLines: 0,
      changedBytes: 0,
    },
    largeDiffMode: false,
  }
}

function createReviewApiForBatchTest(supportsReviewBatch: boolean, calls: string[]) {
  return createAgentReviewApi({
    rpc: {
      ensureInitialized: async () => ({
        capabilities: supportsReviewBatch
          ? ['git.review.v1', 'git.review.batch.v1']
          : ['git.review.v1'],
      }),
      call: async (method: string) => {
        calls.push(method)
        return {
          type: 'success',
          generation: 'generation-1',
          files: [],
          changedBytes: 0,
        }
      },
    } as never,
    loadProjectForPath: async () => ({ id: 'project-1' }) as never,
    loadProjectById: async (projectId) => ({ id: projectId }) as never,
    preparePullRequestReview: async () => {},
    requireGithubPullRequestCapability: () => {},
    requireReviewCapability: () => {},
    unsupportedReviewOperation: () => {
      const error = new Error('git.review.v1') as Error & { code: string }
      error.code = 'AGENT_OPERATION_UNSUPPORTED'
      throw error
    },
    withAgentOrMock: (agentOperation) => agentOperation(),
  })
}

test('full context keeps hunk identity and import filtering keeps mixed code edits', async () => {
  expect(
    pickDefaultReviewBaseBranch([
      { name: 'origin/main', sha: 'main', current: false, remote: true },
      { name: 'origin/release', sha: 'release', current: false, remote: true, default: true },
    ]),
  ).toBe('origin/release')
  const { unifiedPatchToDesktopHunks, expandReviewContext, hideImportOnlyHunks } =
    await import('../src/features/review/diff/ReviewDiffAdapter.js')
  const patch = '@@ -2,1 +2,1 @@\n-import x from "old"\n+import x from "new"\n'
  const hunks = unifiedPatchToDesktopHunks(patch, [
    {
      id: 'canonical',
      header: '@@ -2,1 +2,1 @@',
      oldStart: 2,
      oldLines: 1,
      newStart: 2,
      newLines: 1,
      patch,
    },
  ])
  const full = expandReviewContext(
    hunks,
    '@@ -1,3 +1,3 @@\n // before\n-import x from "old"\n+import x from "new"\n // after\n',
  )
  expect(full[0]?.id).toBe('canonical')
  expect(full[0]?.patch).toBe(patch)
  expect(full[0]?.lines.map((line) => line.content)).toEqual([
    '// before',
    'import x from "old"',
    'import x from "new"',
    '// after',
  ])
  expect(hideImportOnlyHunks(full)).toEqual([])
  const mixed = [
    {
      ...full[0]!,
      lines: [
        ...full[0]!.lines,
        {
          id: 'logic',
          type: 'added' as const,
          oldLine: null,
          newLine: 4,
          content: 'run()',
          raw: '+run()',
        },
      ],
    },
  ]
  expect(hideImportOnlyHunks(mixed)).toEqual(mixed)
})

test('import filtering keeps malformed long imports and handles multiline declarations', async () => {
  const { hideImportOnlyHunks } = await import('../src/features/review/diff/ReviewDiffAdapter.js')
  const hunk = (content: string) => ({
    id: 'import',
    header: '',
    oldStart: 1,
    oldLines: 0,
    newStart: 1,
    newLines: 1,
    patch: '',
    lines: [
      {
        id: 'line',
        type: 'added' as const,
        oldLine: null,
        newLine: 1,
        content,
        raw: '+' + content,
      },
    ],
  })
  expect(
    hideImportOnlyHunks([hunk('import {\n a, b\n} from "module";\nimport "side-effect"')]),
  ).toEqual([])
  const malformed = [hunk('import ' + '\t\tfrom "!"import'.repeat(10000))]
  expect(hideImportOnlyHunks(malformed)).toEqual(malformed)
  const logic = [hunk('import x from "module"; run()')]
  expect(hideImportOnlyHunks(logic)).toEqual(logic)
})
