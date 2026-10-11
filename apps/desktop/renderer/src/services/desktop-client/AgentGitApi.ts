import type { Project } from '@pidex/shared'
import { AgentRpcError } from '../AgentRpcClient.js'
import type { ProtocolCapability } from '@pidex/agent-protocol'
import type {
  DesktopGithubAuthStatus,
  DesktopGithubProfileOverviewResult,
  DesktopGithubRepositoryListResult,
  DesktopGitOperationResult,
  DesktopPullRequestResult,
} from '../../../shared/Types.js'
import { projectToDesktopWorkspace } from '../AgentThreadAdapter.js'
import type { createAgentRpcClient } from '../AgentRpcClient.js'
import { githubLoginFailure } from './Fixtures.js'
import { desktopGitStatus, type ReviewAgentGitStatus } from './ReviewClient.js'
import type { DesktopClient, DesktopClientEnvironment } from './Types.js'

type GitApiMethod =
  | 'getGithubAuthStatus'
  | 'startGithubLogin'
  | 'pollGithubLogin'
  | 'logoutGithub'
  | 'listGithubRepositories'
  | 'cloneGithubRepository'
  | 'getGithubProfileOverview'
  | 'setGithubUserStatus'
  | 'clearGithubUserStatus'
  | 'pushWorkspaceBranch'
  | 'createPullRequest'
  | 'getWorkspaceGitStatus'
  | 'checkoutWorkspaceBranch'
  | 'createWorkspaceBranch'
  | 'commitWorkspaceChanges'

type GitApi = Pick<DesktopClient, GitApiMethod>

type Dependencies = {
  environment: DesktopClientEnvironment
  ensureDesktopProjectTrusted: (project: Project) => Promise<Project>
  invalidateProjectCache: () => void
  loadProjectById: (projectId: string) => Promise<Project>
  loadProjectForPath: (workspacePath: string) => Promise<Project>
  operationError: (error: unknown) => string
  requireAgentCapability: (
    name: Extract<
      ProtocolCapability,
      'github.oauth.v1' | 'github.pullRequests.v1' | 'git.review.v1' | 'git.workspace.v1'
    >,
  ) => void
  rpc: Pick<ReturnType<typeof createAgentRpcClient>, 'call'>
  withRequiredAgent: <T>(operation: () => Promise<T>) => Promise<T>
}

export function createAgentGitApi({
  environment,
  ensureDesktopProjectTrusted,
  invalidateProjectCache,
  loadProjectById,
  loadProjectForPath,
  operationError,
  requireAgentCapability,
  rpc,
  withRequiredAgent,
}: Dependencies): GitApi {
  const loadProject = (workspacePath: string, projectId?: string) =>
    projectId ? loadProjectById(projectId) : loadProjectForPath(workspacePath)

  let activeGithubLoginId: string | null = null
  let activeGithubLoginMode: Parameters<GitApi['startGithubLogin']>[0]['mode'] = 'browser'

  return {
    getGithubAuthStatus: async (): Promise<DesktopGithubAuthStatus> => {
      try {
        return await withRequiredAgent(async () => {
          requireAgentCapability('github.oauth.v1')
          return rpc.call<DesktopGithubAuthStatus>('github/auth/status')
        })
      } catch (error) {
        return {
          configured: false,
          authenticated: false,
          user: null,
          error: operationError(error),
        }
      }
    },
    startGithubLogin: async (input) => {
      try {
        return await withRequiredAgent(async () => {
          requireAgentCapability('github.oauth.v1')
          const status = await rpc.call('github/auth/start', {
            mode: input.mode,
          })
          activeGithubLoginId = status.loginId
          activeGithubLoginMode = status.mode
          return status
        })
      } catch (error) {
        return githubLoginFailure(operationError(error), activeGithubLoginId, input.mode)
      }
    },
    pollGithubLogin: async () => {
      try {
        return await withRequiredAgent(async () => {
          requireAgentCapability('github.oauth.v1')
          if (!activeGithubLoginId) {
            throw new Error('当前没有可轮询的 GitHub 登录请求，请重新开始登录。')
          }
          const status = await rpc.call('github/auth/poll', {
            loginId: activeGithubLoginId,
          })
          if (status.state === 'completed' || status.state === 'failed') {
            activeGithubLoginId = null
          }
          return status
        })
      } catch (error) {
        return githubLoginFailure(operationError(error), activeGithubLoginId, activeGithubLoginMode)
      }
    },
    logoutGithub: async (): Promise<DesktopGithubAuthStatus> => {
      try {
        return await withRequiredAgent(async () => {
          requireAgentCapability('github.oauth.v1')
          const status = await rpc.call<DesktopGithubAuthStatus>('github/auth/logout')
          activeGithubLoginId = null
          return status
        })
      } catch (error) {
        return {
          configured: false,
          authenticated: false,
          user: null,
          error: operationError(error),
        }
      }
    },
    listGithubRepositories: async (): Promise<DesktopGithubRepositoryListResult> => {
      try {
        return await withRequiredAgent(async () => {
          requireAgentCapability('github.oauth.v1')
          const result = await rpc.call<{
            repositories: Extract<DesktopGithubRepositoryListResult, { ok: true }>['repositories']
          }>('github/repositories')
          return { ok: true, repositories: result.repositories }
        })
      } catch (error) {
        return { ok: false, error: operationError(error) }
      }
    },
    cloneGithubRepository: async (input) => {
      try {
        return await withRequiredAgent(async () => {
          requireAgentCapability('github.oauth.v1')
          const picker = environment.window?.DesktopBridge?.pickWorkspaceDirectory
          if (!picker) {
            throw new Error('当前桌面环境不支持选择克隆目录。')
          }
          const targetParent = await picker()
          if (!targetParent) {
            return { ok: false as const, error: '已取消选择克隆目录。' }
          }
          const result = await rpc.call('github/repository/clone', {
            repositoryId: input.repository.id,
            targetParent,
          })
          invalidateProjectCache()
          await ensureDesktopProjectTrusted(result.project)
          let branchName: string | null = null
          try {
            requireAgentCapability('git.review.v1')
            const status = await rpc.call('review/status', {
              projectId: result.project.id,
            })
            branchName = status.status.branchName
          } catch {
            // 克隆与项目注册已经成功，状态补充失败不应把成功结果伪装成失败。
          }
          return {
            ok: true as const,
            workspace: {
              ...projectToDesktopWorkspace(result.project, result.project.id),
              branchName,
            },
          }
        })
      } catch (error) {
        return { ok: false as const, error: operationError(error) }
      }
    },
    getGithubProfileOverview: async (): Promise<DesktopGithubProfileOverviewResult> => {
      try {
        return await withRequiredAgent(async () => {
          requireAgentCapability('github.oauth.v1')
          const result = await rpc.call<{
            overview: Extract<DesktopGithubProfileOverviewResult, { ok: true }>['overview']
          }>('github/profileOverview')
          return { ok: true, overview: result.overview }
        })
      } catch (error) {
        return { ok: false, error: operationError(error) }
      }
    },
    setGithubUserStatus: async () => ({
      ok: false,
      error: 'GitHub 用户状态编辑尚未接入 Agent。',
    }),
    clearGithubUserStatus: async () => ({
      ok: false,
      error: 'GitHub 用户状态编辑尚未接入 Agent。',
    }),
    pushWorkspaceBranch: async (input) => {
      try {
        return await withRequiredAgent(async (): Promise<DesktopGitOperationResult> => {
          requireAgentCapability('github.pullRequests.v1')
          const project = await loadProject(input.workspacePath, input.projectId)
          const result = await rpc.call<{
            repositoryUrl: string
            status: Extract<DesktopGitOperationResult, { ok: true }>['status']
          }>('github/push', {
            projectId: project.id,
            setUpstream: input.setUpstream === true,
            forceWithLease: input.forceWithLease === true,
          })
          return {
            ok: true,
            status: result.status,
            output: `已推送到 ${result.repositoryUrl}`,
          }
        })
      } catch (error) {
        return { ok: false, error: operationError(error) }
      }
    },
    createPullRequest: async (input) => {
      try {
        return await withRequiredAgent(async (): Promise<DesktopPullRequestResult> => {
          requireAgentCapability('github.pullRequests.v1')
          const project = await loadProject(input.workspacePath, input.projectId)
          const result = await rpc.call<{
            pullRequest: { htmlUrl: string; number: number }
          }>('github/pullRequest/createForProject', {
            projectId: project.id,
            title: input.title,
            ...(input.body === undefined ? {} : { body: input.body }),
            ...(input.draft === undefined ? {} : { draft: input.draft }),
          })
          return {
            ok: true,
            url: result.pullRequest.htmlUrl,
            output: `已创建 Pull Request #${result.pullRequest.number}`,
          }
        })
      } catch (error) {
        return { ok: false, error: operationError(error) }
      }
    },
    getWorkspaceGitStatus: async (workspacePath, projectId) => {
      try {
        return await withRequiredAgent(async () => {
          requireAgentCapability('git.review.v1')
          const project = await loadProject(workspacePath, projectId)
          const result = await rpc.call<{ status: ReviewAgentGitStatus }>('review/status', {
            projectId: project.id,
          })
          return { ok: true as const, status: desktopGitStatus(result.status) }
        })
      } catch (error) {
        return {
          ok: false as const,
          error: operationError(error),
          ...(error instanceof AgentRpcError && error.errorCode
            ? { errorCode: error.errorCode }
            : {}),
        }
      }
    },
    checkoutWorkspaceBranch: async (workspacePath, branchName, projectId) =>
      withRequiredAgent(async () => {
        requireAgentCapability('git.workspace.v1')
        const project = await loadProject(workspacePath, projectId)
        const result = await rpc.call('git/branch/checkout', {
          projectId: project.id,
          branchName,
        })
        invalidateProjectCache()
        return {
          ...projectToDesktopWorkspace(result.project, result.project.id),
          branchName: result.status.branchName,
        }
      }),
    createWorkspaceBranch: async (input) => {
      try {
        return await withRequiredAgent(async () => {
          requireAgentCapability('git.workspace.v1')
          const project = await loadProject(input.workspacePath, input.projectId)
          const result = await rpc.call('git/branch/create', {
            projectId: project.id,
            branchName: input.branchName,
            ...(input.startPoint === undefined ? {} : { startPoint: input.startPoint }),
          })
          invalidateProjectCache()
          return {
            ok: true as const,
            workspace: {
              ...projectToDesktopWorkspace(result.project, result.project.id),
              branchName: result.status.branchName,
            },
            status: desktopGitStatus(result.status),
          }
        })
      } catch (error) {
        return { ok: false as const, error: operationError(error) }
      }
    },
    commitWorkspaceChanges: async (input) => {
      try {
        return await withRequiredAgent(async (): Promise<DesktopGitOperationResult> => {
          requireAgentCapability('git.review.v1')
          const project = await loadProject(input.workspacePath, input.projectId)
          const result = await rpc.call<{
            output: string
            status: ReviewAgentGitStatus
          }>('review/commit', {
            projectId: project.id,
            message: input.message,
            paths: input.paths,
          })
          return {
            ok: true,
            status: desktopGitStatus(result.status),
            output: result.output,
          }
        })
      } catch (error) {
        return { ok: false, error: operationError(error) }
      }
    },
  }
}
