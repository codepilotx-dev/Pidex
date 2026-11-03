import type { DesktopSessionExecution, DesktopWorkspace } from '../../../../shared/Types.js'
import type {
  ComposerDraft,
  ComposerLaunchAttempt,
  ComposerLaunchSettings,
} from './ComposerTypes.js'

export const DEFAULT_COMPOSER_LAUNCH_SETTINGS: ComposerLaunchSettings = Object.freeze({
  createWorktree: false,
  branch: null,
})

/** 发起设置按项目隔离；没有项目身份时不保存任何选择。 */
export function composerLaunchProjectKey(workspace: DesktopWorkspace | null): string | null {
  if (!workspace) return null
  return workspace.projectId ?? workspace.path ?? null
}

export function readComposerLaunchSettings(
  draft: ComposerDraft | undefined,
  projectKey: string | null,
): ComposerLaunchSettings {
  if (!draft || !projectKey) return DEFAULT_COMPOSER_LAUNCH_SETTINGS
  return draft.launchSettingsByProject?.[projectKey] ?? DEFAULT_COMPOSER_LAUNCH_SETTINGS
}

export function mergeComposerLaunchSettings(
  draft: ComposerDraft,
  projectKey: string,
  next: ComposerLaunchSettings,
): ComposerDraft {
  return {
    ...draft,
    launchSettingsByProject: {
      ...draft.launchSettingsByProject,
      [projectKey]: next,
    },
  }
}

/**
 * 分支设置只保存待使用的值：`null` 跟随项目当前分支，显式选择则固定在该分支，
 * 直到用户改回。不会因为选择而立即检出。
 */
export function resolveComposerLaunchBranch(
  settings: ComposerLaunchSettings,
  workspace: DesktopWorkspace | null,
): string | null {
  const selected = settings.branch?.trim()
  if (selected) return selected
  const current = workspace?.branchName?.trim()
  return current ? current : null
}

export function isComposerLaunchGitWorkspace(workspace: DesktopWorkspace | null): boolean {
  if (!workspace || workspace.isGitRepo === false) return false
  // 明确是 Git 仓库时即使处于 detached HEAD 也算 Git，只是需要先选分支。
  if (workspace.isGitRepo === true) return true
  return Boolean(workspace.branchName?.trim()) || (workspace.branches?.length ?? 0) > 0
}

export type ComposerLaunchPlan = {
  execution: DesktopSessionExecution
  /** 本地模式需要先检出的分支；为空表示直接使用项目当前检出。 */
  checkoutBranch: string | null
  /** 开启工作树但没有可用分支时阻止发送，不允许静默换成其他执行位置。 */
  blockedReason: string | null
}

/**
 * 首页发起设置显式决定执行位置：开关关闭用项目本地目录（需要时先检出所选分支），
 * 开启则由 Agent 从所选分支创建托管工作树。非 Git 项目始终使用本地目录。
 */
export function planComposerLaunch(input: {
  settings: ComposerLaunchSettings
  workspace: DesktopWorkspace | null
}): ComposerLaunchPlan {
  const git = isComposerLaunchGitWorkspace(input.workspace)
  const branch = resolveComposerLaunchBranch(input.settings, input.workspace)
  if (git && input.settings.createWorktree) {
    if (!branch) {
      return {
        execution: { kind: 'local' },
        checkoutBranch: null,
        blockedReason: '请选择分支',
      }
    }
    return {
      execution: { kind: 'worktree', startingState: { type: 'branch', branchName: branch } },
      checkoutBranch: null,
      blockedReason: null,
    }
  }
  const current = input.workspace?.branchName?.trim() ?? null
  return {
    execution: { kind: 'local' },
    checkoutBranch: git && branch && branch !== current ? branch : null,
    blockedReason: null,
  }
}

/**
 * 同一草稿、同一执行位置和同一首次消息标题的重试会得到同一个 operationId；
 * `thread/create` 据此重放已创建的工作树，而不是再建一棵。
 */
export function composerLaunchAttemptSignature(
  execution: DesktopSessionExecution,
  sessionName?: string,
  settingsKey?: string,
): string {
  const branch =
    execution.kind === 'worktree'
      ? 'startingState' in execution && execution.startingState.type === 'branch'
        ? execution.startingState.branchName
        : 'worktreeId' in execution
          ? execution.worktreeId
          : ''
      : ''
  return `${execution.kind}:${branch}:${sessionName ?? ''}:${settingsKey ?? ''}`
}

/**
 * 创建失败回退草稿时把本次尝试带回来源页；不带回就会丢失 operationId，
 * 重试时重复创建已存在的工作树。
 */
export function withLaunchAttempt(
  draft: ComposerDraft,
  attempt: ComposerLaunchAttempt | undefined,
): ComposerDraft {
  return attempt ? { ...draft, launchAttempt: attempt } : draft
}

/**
 * 本地模式：先检出所选分支，成功后才创建会话；检出失败直接抛出，草稿与修改保持原样。
 * 工作树模式不做任何源目录检出。
 */
export async function createComposerLaunchSession(input: {
  plan: ComposerLaunchPlan
  operationId: string
  checkout: (branch: string) => Promise<void>
  create: (options: {
    execution: DesktopSessionExecution
    operationId: string
  }) => Promise<string | null>
}): Promise<string | null> {
  if (input.plan.blockedReason) throw new Error(input.plan.blockedReason)
  if (input.plan.checkoutBranch) await input.checkout(input.plan.checkoutBranch)
  return input.create({ execution: input.plan.execution, operationId: input.operationId })
}
