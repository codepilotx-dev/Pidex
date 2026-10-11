import type { Project } from '@pidex/shared'
import type { createAgentRpcClient } from '../AgentRpcClient.js'
import {
  browserVisualReviewFileDiff,
  browserVisualReviewSummary,
  isBrowserVisualReviewCase,
} from './Fixtures.js'
import type {
  DesktopAgentReviewApi,
  DesktopReviewAgentComment,
  DesktopReviewAgentFileDiff,
  DesktopReviewAgentSummaryResult,
} from './Types.js'

type ReviewApiMethod =
  | 'getAgentReviewSummary'
  | 'getAgentReviewFileDiff'
  | 'getAgentReviewFileDiffs'
  | 'applyAgentReviewOperation'
  | 'applyAgentReviewBatch'
  | 'getAgentReviewBranches'
  | 'getAgentReviewCommits'
  | 'listAgentReviewComments'
  | 'saveAgentReviewComment'
  | 'resolveAgentReviewComment'
  | 'deleteAgentReviewComment'
  | 'publishAgentGithubReviewComment'
  | 'submitAgentGithubReview'

type ReviewApi = Pick<DesktopAgentReviewApi, ReviewApiMethod>

type Dependencies = {
  rpc: Pick<ReturnType<typeof createAgentRpcClient>, 'call' | 'ensureInitialized'>
  loadProjectById: (projectId: string) => Promise<Project>
  loadProjectForPath: (workspacePath: string) => Promise<Project>
  preparePullRequestReview: (
    projectId: string,
    source: Parameters<ReviewApi['getAgentReviewSummary']>[0]['source'],
    force?: boolean,
  ) => Promise<void>
  requireGithubPullRequestCapability: () => void
  requireReviewCapability: () => void
  unsupportedReviewOperation: () => never
  withAgentOrMock: <T>(
    agentOperation: () => Promise<T>,
    mockOperation: () => Promise<T>,
  ) => Promise<T>
}

export function createAgentReviewApi({
  rpc,
  loadProjectById,
  loadProjectForPath,
  preparePullRequestReview,
  requireGithubPullRequestCapability,
  requireReviewCapability,
  unsupportedReviewOperation,
  withAgentOrMock,
}: Dependencies): ReviewApi {
  const loadProject = (workspacePath: string, projectId?: string) =>
    projectId ? loadProjectById(projectId) : loadProjectForPath(workspacePath)

  return {
    getAgentReviewSummary: (input) => {
      const visualFixture = browserVisualReviewSummary(input.source)
      if (visualFixture) return Promise.resolve(visualFixture)
      return withAgentOrMock(
        async () => {
          requireReviewCapability()
          if (
            input.source.kind === 'uncommitted' &&
            !(await rpc.ensureInitialized()).capabilities.includes('git.review.uncommitted.v1')
          )
            unsupportedReviewOperation()
          const project = await loadProject(input.workspacePath, input.projectId)
          await preparePullRequestReview(project.id, input.source, input.refresh === true)
          return rpc.call<DesktopReviewAgentSummaryResult>(
            input.refresh ? 'review/refresh' : 'review/summary',
            { projectId: project.id, source: input.source },
          )
        },
        async () => unsupportedReviewOperation(),
      )
    },
    getAgentReviewFileDiff: (input) => {
      const visualFixture = browserVisualReviewFileDiff(input.source, input.path)
      if (visualFixture) return Promise.resolve(visualFixture)
      return withAgentOrMock(
        async () => {
          requireReviewCapability()
          if (
            input.source.kind === 'uncommitted' &&
            !(await rpc.ensureInitialized()).capabilities.includes('git.review.uncommitted.v1')
          )
            unsupportedReviewOperation()
          const project = await loadProject(input.workspacePath, input.projectId)
          return rpc.call<DesktopReviewAgentFileDiff>('review/fileDiff', {
            projectId: project.id,
            source: input.source,
            generation: input.generation,
            path: input.path,
            hideWhitespace: input.hideWhitespace,
            ...((await rpc.ensureInitialized()).capabilities.includes('git.review.context.v1')
              ? { loadFullFiles: input.loadFullFiles }
              : {}),
          })
        },
        async () => unsupportedReviewOperation(),
      )
    },
    getAgentReviewFileDiffs: (input) => {
      if (isBrowserVisualReviewCase()) {
        const files = input.paths.flatMap((path) => {
          const file = browserVisualReviewFileDiff(input.source, path)
          return file ? [file] : []
        })
        return Promise.resolve({
          type: 'success' as const,
          generation: input.generation,
          files,
          changedBytes: files.reduce((total, file) => total + file.patch.length, 0),
        })
      }
      return withAgentOrMock(
        async () => {
          requireReviewCapability()
          if (
            input.source.kind === 'uncommitted' &&
            !(await rpc.ensureInitialized()).capabilities.includes('git.review.uncommitted.v1')
          )
            unsupportedReviewOperation()
          if (!(await rpc.ensureInitialized()).capabilities.includes('git.review.batch.v1')) {
            unsupportedReviewOperation()
          }
          const project = await loadProject(input.workspacePath, input.projectId)
          return rpc.call('review/file-diffs', {
            projectId: project.id,
            source: input.source,
            generation: input.generation,
            paths: [...input.paths],
            hideWhitespace: input.hideWhitespace,
            ...((await rpc.ensureInitialized()).capabilities.includes('git.review.context.v1')
              ? { loadFullFiles: input.loadFullFiles }
              : {}),
          })
        },
        async () => unsupportedReviewOperation(),
      )
    },
    applyAgentReviewOperation: (input) =>
      isBrowserVisualReviewCase()
        ? Promise.resolve()
        : withAgentOrMock(
            async () => {
              requireReviewCapability()
              const project = await loadProject(input.workspacePath, input.projectId)
              await rpc.call('review/apply', {
                projectId: project.id,
                source: input.source,
                generation: input.generation,
                expectedRevision: input.expectedRevision,
                action: input.action,
                target: input.target,
                atomic: true,
              })
            },
            async () => unsupportedReviewOperation(),
          ),
    applyAgentReviewBatch: (input) =>
      isBrowserVisualReviewCase()
        ? Promise.resolve({
            ok: true as const,
            action: input.action,
            paths: input.items.map((item) => item.path),
            generation: input.generation,
            appliedCount: input.items.length,
          })
        : withAgentOrMock(
            async () => {
              requireReviewCapability()
              const project = await loadProject(input.workspacePath, input.projectId)
              return rpc.call('review/applyBatch', {
                projectId: project.id,
                source: input.source,
                generation: input.generation,
                action: input.action,
                items: input.items,
              })
            },
            async () => unsupportedReviewOperation(),
          ),
    getAgentReviewBranches: (workspacePath, projectId) =>
      isBrowserVisualReviewCase()
        ? Promise.resolve([])
        : withAgentOrMock(
            async () => {
              requireReviewCapability()
              const project = await loadProject(workspacePath, projectId)
              const result = await rpc.call<{
                branches: Array<{
                  name: string
                  sha: string
                  current: boolean
                  remote: boolean
                  default?: boolean
                }>
              }>('review/branches', { projectId: project.id })
              return result.branches
            },
            async () => unsupportedReviewOperation(),
          ),
    getAgentReviewCommits: (workspacePath, projectId) =>
      isBrowserVisualReviewCase()
        ? Promise.resolve([])
        : withAgentOrMock(
            async () => {
              requireReviewCapability()
              const project = await loadProject(workspacePath, projectId)
              const result = await rpc.call<{
                commits: Array<{
                  sha: string
                  shortSha: string
                  subject: string
                  author: string
                  authoredAt: string
                }>
              }>('review/commits', { projectId: project.id, limit: 20 })
              return result.commits
            },
            async () => unsupportedReviewOperation(),
          ),
    listAgentReviewComments: (input) =>
      isBrowserVisualReviewCase()
        ? Promise.resolve([])
        : withAgentOrMock(
            async () => {
              requireReviewCapability()
              const project = await loadProject(input.workspacePath, input.projectId)
              const result = await rpc.call<{
                comments: DesktopReviewAgentComment[]
              }>('review/comment/list', {
                projectId: project.id,
                threadId: input.threadId,
                sourceKey: input.sourceKey,
              })
              return result.comments
            },
            async () => unsupportedReviewOperation(),
          ),
    saveAgentReviewComment: (input) =>
      withAgentOrMock(
        async () => {
          requireReviewCapability()
          const project = await loadProject(input.workspacePath, input.projectId)
          const result = await rpc.call<{
            comment: DesktopReviewAgentComment
          }>('review/comment/save', {
            ...(input.id ? { id: input.id } : {}),
            projectId: project.id,
            threadId: input.threadId,
            sourceKey: input.sourceKey,
            path: input.path,
            side: input.side,
            line: input.line,
            hunkId: input.hunkId,
            revision: input.revision,
            body: input.body,
            ...(input.githubCommentId ? { githubCommentId: input.githubCommentId } : {}),
            ...(input.githubThreadId ? { githubThreadId: input.githubThreadId } : {}),
          })
          return result.comment
        },
        async () => unsupportedReviewOperation(),
      ),
    resolveAgentReviewComment: (input) =>
      withAgentOrMock(
        async () => {
          requireReviewCapability()
          const project = await loadProject(input.workspacePath, input.projectId)
          const result = await rpc.call<{
            comment: DesktopReviewAgentComment
          }>('review/comment/resolve', {
            projectId: project.id,
            threadId: input.threadId,
            id: input.id,
          })
          return result.comment
        },
        async () => unsupportedReviewOperation(),
      ),
    deleteAgentReviewComment: (input) =>
      withAgentOrMock(
        async () => {
          requireReviewCapability()
          const project = await loadProject(input.workspacePath, input.projectId)
          await rpc.call('review/comment/delete', {
            projectId: project.id,
            threadId: input.threadId,
            id: input.id,
          })
        },
        async () => unsupportedReviewOperation(),
      ),
    publishAgentGithubReviewComment: (input) =>
      withAgentOrMock(
        async () => {
          requireGithubPullRequestCapability()
          const result = await rpc.call<{
            comment: {
              id: number
              nodeId: string
              htmlUrl: string
              body: string
            }
          }>('github/pullRequest/comment', {
            owner: input.source.owner,
            repository: input.source.repository,
            number: input.source.number,
            body: input.body,
            path: input.path,
            side: input.side,
            line: input.line,
            expectedHeadRevision: input.expectedHeadRevision,
            ...(input.commitId ? { commitId: input.commitId } : {}),
          })
          return result.comment
        },
        async () => unsupportedReviewOperation(),
      ),
    submitAgentGithubReview: (input) =>
      withAgentOrMock(
        async () => {
          requireGithubPullRequestCapability()
          const result = await rpc.call<{
            review: { id: number; state: string; htmlUrl: string }
          }>('github/pullRequest/submitReview', {
            owner: input.source.owner,
            repository: input.source.repository,
            number: input.source.number,
            event: input.event,
            expectedHeadRevision: input.expectedHeadRevision,
            ...(input.body ? { body: input.body } : {}),
          })
          return result.review
        },
        async () => unsupportedReviewOperation(),
      ),
  }
}
