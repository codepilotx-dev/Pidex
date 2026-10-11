import type { AdditionalPermissions, PermissionGrantScope } from '@pidex/shared/thread'
import { pathContains } from './PathPermissions'
import type { RequestedPermissions } from './PermissionDecisionEngine'

export interface PermissionGrant {
  id: string
  threadID: string
  turnID: string
  agentID: string
  scope: PermissionGrantScope
  permissions: RequestedPermissions
  createdAt: number
}

export interface PermissionGrantRequest {
  threadID: string
  turnID: string
  agentID: string
  scope: PermissionGrantScope
  requested: AdditionalPermissions
  granted: AdditionalPermissions
}

export interface PermissionGrantLookup {
  threadID: string
  turnID: string
  agentID: string
  requested: RequestedPermissions
  consumeToolCall?: boolean
}

const unique = (values: readonly string[] | undefined) => [...new Set(values ?? [])]

const normalized = (permissions: AdditionalPermissions): RequestedPermissions => ({
  readPaths: unique(permissions.readPaths),
  writePaths: unique(permissions.writePaths),
  networkDomains: unique(
    permissions.networkDomains?.map((domain) => domain.trim().toLowerCase()).filter(Boolean),
  ),
})

const domainContains = (parent: string, candidate: string) =>
  candidate === parent || candidate.endsWith(`.${parent}`)

const intersectPaths = (requested: readonly string[], granted: readonly string[]) =>
  unique(granted.filter((candidate) => requested.some((parent) => pathContains(parent, candidate))))

const intersectDomains = (requested: readonly string[], granted: readonly string[]) =>
  unique(
    granted.filter((candidate) => requested.some((parent) => domainContains(parent, candidate))),
  )

/** User grants can only narrow a model request; they can never broaden it. */
export const intersectPermissionGrant = (
  requestedInput: AdditionalPermissions,
  grantedInput: AdditionalPermissions,
): RequestedPermissions => {
  const requested = normalized(requestedInput)
  const granted = normalized(grantedInput)
  return {
    readPaths: intersectPaths(requested.readPaths, granted.readPaths),
    writePaths: intersectPaths(requested.writePaths, granted.writePaths),
    networkDomains: intersectDomains(requested.networkDomains, granted.networkDomains),
  }
}

const coversPaths = (granted: readonly string[], requested: readonly string[]) =>
  requested.every((candidate) => granted.some((parent) => pathContains(parent, candidate)))

const coversDomains = (granted: readonly string[], requested: readonly string[]) =>
  requested.every((candidate) => granted.some((parent) => domainContains(parent, candidate)))

const hasPermissions = (permissions: RequestedPermissions) =>
  permissions.readPaths.length > 0 ||
  permissions.writePaths.length > 0 ||
  permissions.networkDomains.length > 0

/**
 * Process-local permission grants. Session grants intentionally survive turns
 * in the same thread but are discarded with the Agent process.
 */
export class PermissionGrantStore {
  private readonly grantsByThread = new Map<string, PermissionGrant[]>()

  grant(input: PermissionGrantRequest): PermissionGrant | null {
    const permissions = intersectPermissionGrant(input.requested, input.granted)
    if (!hasPermissions(permissions)) return null
    const grant: PermissionGrant = {
      id: crypto.randomUUID(),
      threadID: input.threadID,
      turnID: input.turnID,
      agentID: input.agentID,
      scope: input.scope,
      permissions,
      createdAt: Date.now(),
    }
    const grants = this.grantsByThread.get(input.threadID) ?? []
    grants.push(grant)
    this.grantsByThread.set(input.threadID, grants)
    return grant
  }

  authorize(input: PermissionGrantLookup): PermissionGrant | null {
    const grants = this.grantsByThread.get(input.threadID)
    if (!grants || !hasPermissions(input.requested)) return null
    const index = grants.findIndex(
      (grant) =>
        (grant.scope === 'session' ||
          (grant.turnID === input.turnID &&
            (grant.scope === 'turn' || grant.agentID === input.agentID))) &&
        coversPaths(
          [...grant.permissions.readPaths, ...grant.permissions.writePaths],
          input.requested.readPaths,
        ) &&
        coversPaths(grant.permissions.writePaths, input.requested.writePaths) &&
        coversDomains(grant.permissions.networkDomains, input.requested.networkDomains),
    )
    if (index < 0) return null
    const grant = grants[index]!
    if (grant.scope === 'tool-call' && input.consumeToolCall) {
      grants.splice(index, 1)
      if (grants.length === 0) this.grantsByThread.delete(input.threadID)
    }
    return grant
  }

  clearTurn(threadID: string, turnID: string) {
    const grants = this.grantsByThread.get(threadID)
    if (!grants) return
    const remaining = grants.filter((grant) => grant.scope === 'session' || grant.turnID !== turnID)
    if (remaining.length > 0) this.grantsByThread.set(threadID, remaining)
    else this.grantsByThread.delete(threadID)
  }

  clearThread(threadID: string) {
    this.grantsByThread.delete(threadID)
  }

  list(threadID: string): readonly PermissionGrant[] {
    return [...(this.grantsByThread.get(threadID) ?? [])]
  }
}
