import type { DesktopExternalOpenTarget } from '../../shared/Types.js'
import { desktopClient, type DesktopClient } from './desktop-client/index.js'
import { AgentRpcError } from './AgentRpcClient.js'

const DEFAULT_EXTERNAL_OPEN_TARGETS_TTL_MS = 60_000

type ExternalOpenTargetsClient = Pick<
  DesktopClient,
  'listExternalOpenTargets' | 'openPathWithTarget'
>

type ExternalOpenTargetsCacheEntry = {
  expiresAt: number
  request: Promise<DesktopExternalOpenTarget[]>
}

export type ExternalOpenTargetsStore = {
  loadExternalOpenTargets(targetPath: string): Promise<DesktopExternalOpenTarget[]>
  prefetchExternalOpenTargets(targetPath: string): Promise<void>
  openPathWithPreferredExternalTarget(targetPath: string): Promise<DesktopExternalOpenTarget>
  openPathWithExternalTarget(
    targetPath: string,
    targetId: string,
  ): Promise<DesktopExternalOpenTarget>
}

export function shouldFallbackToExternalOpen(error: unknown): boolean {
  return (
    error instanceof AgentRpcError &&
    (error.errorCode === 'FILE_NOT_TEXT' || error.errorCode === 'FILE_TOO_LARGE')
  )
}

export function createExternalOpenTargetsStore(
  client: ExternalOpenTargetsClient,
  options: {
    now?: () => number
    ttlMs?: number
  } = {},
): ExternalOpenTargetsStore {
  const now = options.now ?? Date.now
  const ttlMs =
    options.ttlMs === undefined ? DEFAULT_EXTERNAL_OPEN_TARGETS_TTL_MS : Math.max(0, options.ttlMs)
  const entries = new Map<string, ExternalOpenTargetsCacheEntry>()

  function loadExternalOpenTargets(targetPath: string): Promise<DesktopExternalOpenTarget[]> {
    const key = cacheKey(targetPath)
    const existing = entries.get(key)
    if (existing && existing.expiresAt > now()) return existing.request

    const entry: ExternalOpenTargetsCacheEntry = {
      expiresAt: Number.POSITIVE_INFINITY,
      request: Promise.resolve([]),
    }
    entry.request = client
      .listExternalOpenTargets(targetPath)
      .then((targets) => {
        entry.expiresAt = now() + ttlMs
        return targets
      })
      .catch((error) => {
        if (entries.get(key) === entry) entries.delete(key)
        throw error
      })
    entries.set(key, entry)
    return entry.request
  }

  async function prefetchExternalOpenTargets(targetPath: string): Promise<void> {
    await loadExternalOpenTargets(targetPath)
  }

  async function openPathWithPreferredExternalTarget(
    targetPath: string,
  ): Promise<DesktopExternalOpenTarget> {
    const targets = await loadExternalOpenTargets(targetPath)
    const target = targets.find((candidate) => candidate.preferred) ?? targets[0]
    if (!target) throw new Error('没有可用的外部打开方式。')
    return openPathWithExternalTarget(targetPath, target.id)
  }

  async function openPathWithExternalTarget(
    targetPath: string,
    targetId: string,
  ): Promise<DesktopExternalOpenTarget> {
    const targets = await loadExternalOpenTargets(targetPath)
    const target = targets.find((candidate) => candidate.id === targetId)
    if (!target) throw new Error(`找不到外部打开方式：${targetId}`)

    await client.openPathWithTarget(targetPath, targetId)
    const nextTargets = targets.map((candidate) => ({
      ...candidate,
      preferred: candidate.id === targetId,
    }))
    const key = cacheKey(targetPath)
    const entry = entries.get(key)
    if (entry) {
      entry.request = Promise.resolve(nextTargets)
      entry.expiresAt = now() + ttlMs
    }
    return nextTargets.find((candidate) => candidate.id === targetId) ?? target
  }

  return {
    loadExternalOpenTargets,
    prefetchExternalOpenTargets,
    openPathWithPreferredExternalTarget,
    openPathWithExternalTarget,
  }
}

const externalOpenTargetsStore = createExternalOpenTargetsStore(desktopClient)

export const {
  loadExternalOpenTargets,
  prefetchExternalOpenTargets,
  openPathWithPreferredExternalTarget,
  openPathWithExternalTarget,
} = externalOpenTargetsStore

function cacheKey(targetPath: string): string {
  return targetPath.trim()
}
