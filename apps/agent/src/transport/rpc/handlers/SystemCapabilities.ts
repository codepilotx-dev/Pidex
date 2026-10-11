import { BrowserRepository } from '../../../storage/repositories/BrowserRepository'
import { BrowserDataRepository } from '../../../storage/repositories/BrowserDataRepository'
import { Capabilities, type ProtocolCapability } from '@pidex/agent-protocol'
import type { AgentDatabase } from '../../../storage/database/AgentDatabase'
import {
  probeAutomationStorageCapabilities,
  probeArtifactsStorageCapabilities,
  probeScheduleCalendarStorageCapabilities,
  probeThreadsStorageCapabilities,
} from '../../../storage/database/StorageCapabilities'

/**
 * 探测服务端实际支持的能力子集，按 serverAvailable 稳定顺序返回。
 *
 * 集中探测 history 库中的可选存储能力：
 * - `threads.creation_surface` 列存在：返回完整 `Capabilities`；缺失时剔除
 *   `thread.creation-surface.v1`，避免在无法持久化的库上虚假广告。
 * - `thread_goals`、`thread_goal_history`、`thread_goal_operations` 三张表齐全且
 *   schema 46 必要字段可读、存量 Goal 行全部符合共享 schema 时：保留
 *   `thread.goal.v1`；部分表、未知形状或存在无法校验的 Goal 行时剔除，库保持
 *   只读降级，不广告不可执行的 mutation（绝不 ALTER 或降级 user_version）。
 * - `item_artifacts` 表存在：保留 `artifacts.read.v1`；缺失时剔除，保持旧库
 *   只读兼容（绝不 ALTER 或降级 user_version）。
 */
export function filterAdvertisedCapabilities(
  db: AgentDatabase,
  freshPlanAvailable = true,
): ReadonlyArray<ProtocolCapability> {
  const { creationSurface, projectlessOwner } = probeThreadsStorageCapabilities(db.sqlite)
  const { itemArtifactsTable } = probeArtifactsStorageCapabilities(db.sqlite)
  const { automations, automationRuns } = probeAutomationStorageCapabilities(db.sqlite)
  const tables = new Set(
    (
      db.sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string
      }>
    ).map((row) => row.name),
  )
  const { scheduledTasks, schedulePlanProposals } = probeScheduleCalendarStorageCapabilities(
    db.sqlite,
  )
  return Capabilities.filter(
    (capability): capability is ProtocolCapability =>
      ((capability !== 'subagents.recursive.v1' && capability !== 'subagents.followup.v1') ||
        (tables.has('subagent_messages') &&
          tables.has('subagent_completions') &&
          tables.has('subagent_task_policies'))) &&
      (capability !== 'plan.approval.fresh.v1' || (freshPlanAvailable && projectlessOwner)) &&
      ((capability !== 'browser.manage.v1' && capability !== 'browser.host.v1') ||
        new BrowserRepository(db).available()) &&
      (capability !== 'browser.data.v1' || new BrowserDataRepository(db).available()) &&
      (capability !== 'mcp.elicitation.v1' ||
        db.repositories.interactions.interactionTableAvailable('mcp_elicitations')) &&
      (capability !== 'approval.retry.v1' ||
        db.repositories.interactions.interactionTableAvailable('approval_reviews')) &&
      ((capability !== 'project.edit.v1' && capability !== 'project.restore.v1') ||
        db.projectMembershipAvailable()) &&
      (capability !== 'thread.creation-surface.v1' || creationSurface) &&
      ((capability !== 'plan.approval.v1' && capability !== 'plan.approval.fresh.v1') ||
        db.repositories.planApprovals.available()) &&
      (capability !== 'thread.goal.v1' ||
        (db.repositories.threadGoals.available() &&
          db.repositories.threadGoalLedger.available() &&
          db.repositories.threadGoalContinuations.available() &&
          db.repositories.threadGoals.visibleGoalsValid())) &&
      (capability !== 'thread.bookmarks.v1' || db.repositories.threadBookmarks.available()) &&
      (capability !== 'artifacts.read.v1' || itemArtifactsTable) &&
      (capability !== 'automation.manage.v1' || (automations && automationRuns)) &&
      (capability !== 'worktree.settings.v1' || tables.has('worktree_owned_roots')) &&
      (capability !== 'local-environment.multiple.v1' ||
        (tables.has('local_environment_selections') &&
          tables.has('worktree_environment_snapshots'))) &&
      (capability !== 'github.watch.v1' ||
        (automations &&
          automationRuns &&
          tables.has('pr_watches') &&
          tables.has('automation_host_tool_calls'))) &&
      (capability !== 'calendar.manage.v1' ||
        (automations && automationRuns && scheduledTasks && schedulePlanProposals)),
  )
}

/**
 * 计算客户端请求与服务端可用能力的交集。
 * 返回结果为 `clientRequested ∩ serverAvailable`，顺序与 serverAvailable 一致。
 */
export function negotiateCapabilities(
  clientRequested: Iterable<ProtocolCapability>,
  serverAvailable: ReadonlyArray<ProtocolCapability>,
): ReadonlySet<ProtocolCapability> {
  const clientSet = new Set(clientRequested)
  const negotiated = new Set<ProtocolCapability>()
  for (const cap of serverAvailable) {
    if (clientSet.has(cap)) {
      negotiated.add(cap)
    }
  }
  return negotiated
}
