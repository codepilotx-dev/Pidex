import { computerHandlers } from './handlers/Computer'
import { type RpcHandlers, type RpcMethod } from '@pidex/agent-protocol'
import { AllRpcMethods as RpcMethods } from '@pidex/agent-protocol/host'
import { browserHandlers } from './handlers/Browser'
import { configHandlers } from './handlers/Config'
import { githubHandlers } from './handlers/Github'
import { gitHandlers } from './handlers/Git'
import { interactionHandlers } from './handlers/Interaction'
import { memoryHandlers } from './handlers/Memory'
import { localContextHandlers } from './handlers/LocalContext'
import { mcpHandlers } from './handlers/Mcp'
import { petHandlers } from './handlers/Pet'
import { pluginHandlers } from './handlers/Plugins'
import { miniMaxCliHandlers } from './handlers/MinimaxCli'
import { releaseNotesHandlers } from './handlers/ReleaseNotes'
import { permissionHandlers } from './handlers/Permission'
import { providerHandlers } from './handlers/Provider'
import { reviewHandlers } from './handlers/Review'
import { skillHandlers } from './handlers/Skills'
import { subagentHandlers } from './handlers/Subagent'
import { suggestionHandlers } from './handlers/Suggestions'
import { systemHandlers } from './handlers/System'
import { terminalHandlers } from './handlers/Terminal'
import { localEnvironmentHandlers } from './handlers/LocalEnvironment'
import { worktreeHandlers } from './handlers/Worktree'
import { handoffHandlers } from './handlers/Handoff'
import { threadForkHandlers } from './handlers/ThreadFork'
import { sideChatHandlers } from './handlers/SideChat'
import { threadGoalHandlers } from './handlers/ThreadGoal'
import { threadBookmarkHandlers } from './handlers/ThreadBookmark'
import { threadHandlers } from './handlers/Thread'
import { toolingHandlers } from './handlers/Tooling'
import { usageHandlers } from './handlers/Usage'
import { speechHandlers } from './handlers/Speech'
import { sessionGroupHandlers } from './handlers/SessionGroup'
import { workflowHandlers } from './handlers/Workflow'
import { automationHandlers } from './handlers/Automation'
import { calendarHandlers } from './handlers/Calendar'
import { planApprovalHandlers } from './handlers/PlanApproval'
import type { RpcHandlerGroup } from './handlers/Types'
import { workspaceHandlers } from './handlers/Workspace'
import type { RpcRouterContext } from './RequestContext'

import type { RpcRouter } from './RpcRouter'

type MapRpcError = (method: RpcMethod, cause: unknown) => Error

const groups: readonly RpcHandlerGroup[] = [
  computerHandlers,
  browserHandlers,
  configHandlers,
  systemHandlers,
  interactionHandlers,
  permissionHandlers,
  workspaceHandlers,
  reviewHandlers,
  gitHandlers,
  mcpHandlers,
  pluginHandlers,
  miniMaxCliHandlers,
  skillHandlers,
  githubHandlers,
  threadHandlers,
  localContextHandlers,
  memoryHandlers,
  petHandlers,
  releaseNotesHandlers,
  subagentHandlers,
  suggestionHandlers,
  terminalHandlers,
  localEnvironmentHandlers,
  worktreeHandlers,
  handoffHandlers,
  threadForkHandlers,
  sideChatHandlers,
  threadGoalHandlers,
  threadBookmarkHandlers,
  providerHandlers,
  toolingHandlers,
  usageHandlers,
  speechHandlers,
  sessionGroupHandlers,
  workflowHandlers,
  automationHandlers,
  calendarHandlers,
  planApprovalHandlers,
]

const registeredMethods = groups.flatMap((group) => group.methods)
const groupByMethod = new Map(
  groups.flatMap((group) => group.methods.map((method) => [method, group] as const)),
)
const uniqueMethods = new Set(registeredMethods)
const declaredMethods = Object.keys(RpcMethods) as RpcMethod[]

if (uniqueMethods.size !== registeredMethods.length) {
  throw new Error('RPC handler registry contains duplicate methods')
}

const missingMethods = declaredMethods.filter((method) => !uniqueMethods.has(method))
const unknownMethods = registeredMethods.filter((method) => !(method in RpcMethods))

if (missingMethods.length > 0 || unknownMethods.length > 0) {
  throw new Error(
    `RPC handler registry mismatch (missing: ${missingMethods.join(', ') || 'none'}; unknown: ${unknownMethods.join(', ') || 'none'})`,
  )
}

export const createRpcHandlerRegistry = (
  runtime: RpcRouter,
  mapError: MapRpcError,
): RpcHandlers<RpcRouterContext> =>
  Object.fromEntries(
    registeredMethods.map((method) => [
      method,
      async (params: unknown, context: RpcRouterContext) => {
        try {
          return await groupByMethod.get(method)!.handle(runtime, method, params, context)
        } catch (cause) {
          throw mapError(method, cause)
        }
      },
    ]),
  ) as unknown as RpcHandlers<RpcRouterContext>
