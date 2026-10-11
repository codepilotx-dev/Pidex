import { ComputerRpcMethods, type ComputerHostRpcMethodMap } from './Computer'
import type { Schema } from 'effect'
import type { ParamsOf, ResultOf } from '../wire/Definition'
import { BrowserRpcMethods, type BrowserHostRpcMethodMap } from './Browser'
import { AutomationRpcMethods } from './Automation'
import { BaseRpcMethods } from './Base'
import { CalendarRpcMethods } from './Calendar'
import { PlanApprovalRpcMethods } from './PlanApproval'
import { HandoffRpcMethods } from './Handoff'
import { ThreadGoalRpcMethods } from './Goal'
import { ThreadBookmarkRpcMethods } from './Bookmarks'
import { LocalEnvironmentRpcMethods } from './LocalEnvironment'
import { ThreadForkRpcMethods } from './ThreadFork'
import { SideChatRpcMethods } from './SideChat'
import { WorktreeRpcMethods } from './Worktree'
import { SessionGroupRpcMethods } from './SessionGroup'
import { WorkflowRpcMethods } from './Workflow'
import type { TerminalRpcMethodMap } from './Terminal'
import type { LocalEnvironmentHostRpcMethodMap } from './LocalEnvironment'

export const RpcMethods = {
  ...ComputerRpcMethods,
  ...BrowserRpcMethods,
  ...AutomationRpcMethods,
  ...BaseRpcMethods,
  ...CalendarRpcMethods,
  ...PlanApprovalRpcMethods,
  ...HandoffRpcMethods,
  ...ThreadGoalRpcMethods,
  ...ThreadBookmarkRpcMethods,
  ...LocalEnvironmentRpcMethods,
  ...ThreadForkRpcMethods,
  ...SideChatRpcMethods,
  ...WorktreeRpcMethods,
  ...SessionGroupRpcMethods,
  ...WorkflowRpcMethods,
} as const
export { BaseRpcMethods } from './Base'
export const RpcMethodMap = RpcMethods

export type PublicRpcMethod = keyof typeof RpcMethods
export type RpcMethod =
  | PublicRpcMethod
  | keyof ComputerHostRpcMethodMap
  | keyof TerminalRpcMethodMap
  | keyof LocalEnvironmentHostRpcMethodMap
  | keyof BrowserHostRpcMethodMap
type RpcDefinition<M extends RpcMethod> = M extends PublicRpcMethod
  ? (typeof RpcMethods)[M]
  : M extends keyof TerminalRpcMethodMap
    ? TerminalRpcMethodMap[M]
    : M extends keyof LocalEnvironmentHostRpcMethodMap
      ? LocalEnvironmentHostRpcMethodMap[M]
      : M extends keyof BrowserHostRpcMethodMap
        ? BrowserHostRpcMethodMap[M]
        : M extends keyof ComputerHostRpcMethodMap
          ? ComputerHostRpcMethodMap[M]
          : never
export type RpcParams<M extends RpcMethod> = ParamsOf<RpcDefinition<M>>
export type RpcResult<M extends RpcMethod> = ResultOf<RpcDefinition<M>>
export type RpcErrors<M extends RpcMethod> = RpcDefinition<M>['errors'][number]
export type RpcParamsSchema<M extends RpcMethod> = RpcDefinition<M>['params'] & Schema.Top
export type RpcResultSchema<M extends RpcMethod> = RpcDefinition<M>['result'] & Schema.Top
export type PublicRpcParams<M extends PublicRpcMethod> = ParamsOf<(typeof RpcMethods)[M]>
export type PublicRpcResult<M extends PublicRpcMethod> = ResultOf<(typeof RpcMethods)[M]>

export * from './Computer'
export * from './Browser'
export * from './Core'
export * from './Automation'
export * from './Calendar'
export * from './PlanApproval'
export * from './Config'
export * from './Extended'
export * from './Git'
export * from './Github'
export * from './Goal'
export * from './Bookmarks'
export * from './Handoff'
export * from './Mcp'
export * from './MinimaxCli'
export * from './LocalEnvironment'
export * from './Pet'
export * from './Plugins'
export * from './ReleaseNotes'
export * from './Review'
export * from './Skills'
export * from './Speech'
export * from './Suggestions'
export * from './Tooling'
export * from './ThreadFork'
export * from './SideChat'
export * from './Usage'
export * from './Worktree'
export * from './SessionGroup'
export * from './Workflow'
