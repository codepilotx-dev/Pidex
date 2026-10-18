import { lazy, Suspense, useCallback, useState, type ReactNode } from 'react'
import type { DesktopWorkspace } from '../../../shared/Types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { useDesktopSettings } from '../settings/UseDesktopSettings.js'
import { useGitBoard } from './GitBoardContext.js'
import { GitBoardCheckoutDialog } from './GitBoardCheckoutDialog.js'
import type { GitBoardAction } from './GitBoardRepositoryMenu.js'

const GitWorkflowModal = lazy(() =>
  import('../layout/panels/GitWorkflowModal.js').then((module) => ({
    default: module.GitWorkflowModal,
  })),
)

type WorkflowMode = 'commit' | 'push' | 'branch'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Git 看板列的日常操作状态机：提交/推送/创建分支复用布局层 GitWorkflowModal，
 * 签出走独立对话框，Fetch/Pull 直接调用共享 desktop client。
 * 所有操作结束后都只刷新当前列，避免旧轮询响应覆盖操作后的状态。
 */
export function useGitBoardActions(onBranchChanged: (projectId: string) => void): {
  begin: (project: DesktopWorkspace, action: GitBoardAction) => void
  isBusy: (projectId: string) => boolean
  errorFor: (projectId: string) => string | undefined
  host: ReactNode
} {
  const settings = useDesktopSettings()
  const { projects, repositories, capabilities, refreshProject } = useGitBoard()
  const [workflow, setWorkflow] = useState<{ projectId: string; mode: WorkflowMode } | null>(null)
  const [checkoutProjectId, setCheckoutProjectId] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, GitBoardAction | undefined>>({})
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const setPendingAction = useCallback((projectId: string, action: GitBoardAction | undefined) => {
    setPending((current) => {
      if (action) return { ...current, [projectId]: action }
      const next = { ...current }
      delete next[projectId]
      return next
    })
  }, [])
  const setProjectError = useCallback((projectId: string, message: string | undefined) => {
    setErrors((current) => {
      if (message) return { ...current, [projectId]: message }
      const next = { ...current }
      delete next[projectId]
      return next
    })
  }, [])
  const runSync = useCallback(
    async (project: DesktopWorkspace, action: 'fetch' | 'pull') => {
      const projectId = project.projectId!
      setProjectError(projectId, undefined)
      setPendingAction(projectId, action)
      try {
        const result =
          action === 'fetch'
            ? await desktopClient.fetchWorkspaceRepository(project.path, projectId)
            : await desktopClient.pullWorkspaceRepository(project.path, projectId)
        if (result.ok === false) setProjectError(projectId, result.error)
      } catch (error) {
        setProjectError(projectId, errorMessage(error))
      } finally {
        setPendingAction(projectId, undefined)
        refreshProject(projectId)
      }
    },
    [refreshProject, setPendingAction, setProjectError],
  )
  const runCheckout = useCallback(
    async (project: DesktopWorkspace, branchName: string) => {
      const projectId = project.projectId!
      setProjectError(projectId, undefined)
      setPendingAction(projectId, 'checkoutBranch')
      try {
        await desktopClient.checkoutWorkspaceBranch(project.path, branchName, projectId)
        setCheckoutProjectId(null)
        onBranchChanged(projectId)
        refreshProject(projectId, { branchChanged: true })
      } catch (error) {
        setProjectError(projectId, errorMessage(error))
        refreshProject(projectId)
      } finally {
        setPendingAction(projectId, undefined)
      }
    },
    [onBranchChanged, refreshProject, setPendingAction, setProjectError],
  )
  const begin = useCallback(
    (project: DesktopWorkspace, action: GitBoardAction) => {
      const projectId = project.projectId!
      if (!projectId || pending[projectId]) return
      setProjectError(projectId, undefined)
      if (action === 'commit' || action === 'push' || action === 'createBranch') {
        setWorkflow({ projectId, mode: action === 'createBranch' ? 'branch' : action })
        return
      }
      if (action === 'checkoutBranch') {
        setCheckoutProjectId(projectId)
        return
      }
      void runSync(project, action)
    },
    [pending, runSync, setProjectError],
  )
  const isBusy = (projectId: string) =>
    pending[projectId] !== undefined ||
    workflow?.projectId === projectId ||
    checkoutProjectId === projectId
  const errorFor = (projectId: string) => errors[projectId]

  const workflowProject = workflow
    ? (projects.find((project) => project.projectId === workflow.projectId) ?? null)
    : null
  const workflowResult = workflowProject
    ? repositories[workflowProject.projectId!]?.result
    : undefined
  const checkoutProject = checkoutProjectId
    ? (projects.find((project) => project.projectId === checkoutProjectId) ?? null)
    : null
  const host = (
    <>
      {workflow && workflowProject ? (
        <Suspense fallback={null}>
          <GitWorkflowModal
            mode={workflow.mode}
            workspace={workflowProject}
            gitStatus={workflowResult?.ok ? workflowResult.status : null}
            gitBranchPrefix={settings.gitBranchPrefix}
            allowForcePush={settings.allowForcePush}
            commitMessagePrompt={settings.commitMessagePrompt}
            pullRequestPrompt={settings.pullRequestPrompt}
            onClose={() => setWorkflow(null)}
            onError={(message) => {
              const projectId = workflowProject.projectId!
              setProjectError(projectId, message)
              refreshProject(projectId)
            }}
            onRefreshWorkspace={async () => {
              refreshProject(workflowProject.projectId!)
            }}
            onWorkspaceChanged={async () => {
              const projectId = workflowProject.projectId!
              onBranchChanged(projectId)
              refreshProject(projectId, { branchChanged: true })
            }}
          />
        </Suspense>
      ) : null}
      <GitBoardCheckoutDialog
        open={checkoutProject !== null}
        project={checkoutProject}
        repository={checkoutProject ? repositories[checkoutProject.projectId!] : undefined}
        busy={checkoutProject !== null && pending[checkoutProject.projectId!] === 'checkoutBranch'}
        error={checkoutProject ? (errors[checkoutProject.projectId!] ?? null) : null}
        canCheckout={capabilities.includes('git.workspace.v1')}
        onRetryBranches={() => {
          if (checkoutProject) refreshProject(checkoutProject.projectId!)
        }}
        onCheckout={(branchName) => {
          if (checkoutProject) void runCheckout(checkoutProject, branchName)
        }}
        onClose={() => setCheckoutProjectId(null)}
      />
    </>
  )
  return { begin, isBusy, errorFor, host }
}
