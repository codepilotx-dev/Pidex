import type { ProtocolCapability, RpcResult, ToolingStatus } from '@pidex/agent-protocol'
import type { DesktopInstalledSkill, DesktopInstalledSkillDetails } from '../../../shared/Types.js'
import type { createAgentRpcClient } from '../AgentRpcClient.js'
import { AGENT_LIVE_EVENT_FILTERS } from './EventSubscriptionFilters.js'
import type { DesktopClient } from './Types.js'

type ToolingApiMethod =
  | 'listTooling'
  | 'refreshTooling'
  | 'setToolingPreference'
  | 'installTooling'
  | 'listPets'
  | 'listPetCatalog'
  | 'listReleaseNotes'
  | 'installCatalogPet'
  | 'previewPetInstall'
  | 'installPet'
  | 'removePet'
  | 'listRuntimeSkills'
  | 'readRuntimeSkill'
  | 'setRuntimeSkillEnabled'
  | 'onRuntimeSkillsUpdated'
  | 'onToolingUpdated'

type ToolingApi = Pick<DesktopClient, ToolingApiMethod>
type RuntimeSkillsMockApi = Pick<
  DesktopClient,
  'listRuntimeSkills' | 'readRuntimeSkill' | 'setRuntimeSkillEnabled'
>

type Dependencies = {
  currentAppVersion: string
  mockClient: RuntimeSkillsMockApi
  requireAgentCapability: (
    name: Extract<
      ProtocolCapability,
      'tooling.management.v1' | 'pets.management.v1' | 'release-notes.read.v1' | 'skills.manage.v1'
    >,
  ) => void
  rpc: Pick<ReturnType<typeof createAgentRpcClient>, 'call' | 'subscribeEnvelope'>
  withAgentOrMock: <T>(
    agentOperation: () => Promise<T>,
    mockOperation: () => Promise<T>,
  ) => Promise<T>
  withRequiredAgent: <T>(operation: () => Promise<T>) => Promise<T>
}

export function createAgentToolingApi({
  currentAppVersion,
  mockClient,
  requireAgentCapability,
  rpc,
  withAgentOrMock,
  withRequiredAgent,
}: Dependencies): ToolingApi {
  const desktopInstalledSkill = (
    skill: RpcResult<'skill/list'>['skills'][number],
  ): DesktopInstalledSkill => {
    const builtin = skill.path.startsWith('builtin://')
    return {
      name: skill.name,
      description: skill.description,
      path: skill.path,
      scope: builtin ? 'system' : skill.scope === 'workspace' ? 'repo' : 'user',
      source: builtin ? 'system' : skill.scope,
      format: skill.format,
      enabled: skill.enabled,
    }
  }
  const isToolingStatus = (value: unknown): value is ToolingStatus => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const status = value as Partial<ToolingStatus>
    return (
      (status.id === 'nodejs' ||
        status.id === 'python' ||
        status.id === 'git-bash' ||
        status.id === 'ripgrep') &&
      (status.preference === 'managed' || status.preference === 'system') &&
      typeof status.pinnedVersion === 'string'
    )
  }

  return {
    listRuntimeSkills: (workspacePath, options) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('skills.manage.v1')
          const result = await rpc.call('skill/list', {
            ...(workspacePath ? { workspace: workspacePath } : {}),
            ...(options?.forceReload === undefined ? {} : { forceReload: options.forceReload }),
          })
          return {
            state: 'ready' as const,
            data: result.skills.map(desktopInstalledSkill),
            updatedAt: new Date(result.updatedAt).toISOString(),
          }
        },
        () => mockClient.listRuntimeSkills(workspacePath, options),
      ),
    readRuntimeSkill: (path, workspacePath) =>
      withAgentOrMock(
        async (): Promise<DesktopInstalledSkillDetails> => {
          requireAgentCapability('skills.manage.v1')
          const result = await rpc.call('skill/read', {
            path,
            ...(workspacePath ? { workspace: workspacePath } : {}),
          })
          return {
            ...desktopInstalledSkill(result.skill),
            content: result.content,
          }
        },
        () => mockClient.readRuntimeSkill(path, workspacePath),
      ),
    setRuntimeSkillEnabled: (path, enabled) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('skills.manage.v1')
          const result = await rpc.call('skill/setEnabled', {
            path,
            enabled,
            operationId: crypto.randomUUID(),
          })
          return desktopInstalledSkill(result.skill)
        },
        () => mockClient.setRuntimeSkillEnabled(path, enabled),
      ),
    onRuntimeSkillsUpdated: (callback) =>
      rpc.subscribeEnvelope(
        {
          liveEventTypes: AGENT_LIVE_EVENT_FILTERS.skills,
        },
        (events) => {
          for (const event of events) {
            if (event.type !== 'skill/updated') continue
            callback(event.payload.generation)
          }
        },
      ),
    onToolingUpdated: (callback) =>
      rpc.subscribeEnvelope(
        {
          liveEventTypes: AGENT_LIVE_EVENT_FILTERS.tooling,
        },
        (events) => {
          for (const event of events) {
            if (event.type !== 'tooling/updated') continue
            const payload = event.payload
            if (!payload || typeof payload !== 'object') continue
            const status = (payload as { status?: unknown }).status
            if (isToolingStatus(status)) callback(status)
          }
        },
      ),
    listTooling: async () =>
      withRequiredAgent(async () => {
        requireAgentCapability('tooling.management.v1')
        return (await rpc.call('tooling/list', {})).statuses
      }),
    refreshTooling: async () =>
      withRequiredAgent(async () => {
        requireAgentCapability('tooling.management.v1')
        return (await rpc.call('tooling/refresh', {})).statuses
      }),
    setToolingPreference: async (id, preference) =>
      withRequiredAgent(async () => {
        requireAgentCapability('tooling.management.v1')
        return (
          await rpc.call('tooling/setPreference', {
            id,
            preference,
            operationId: crypto.randomUUID(),
          })
        ).status
      }),
    installTooling: async (id, force = false) =>
      withRequiredAgent(async () => {
        requireAgentCapability('tooling.management.v1')
        return (
          await rpc.call('tooling/install', {
            id,
            force,
            operationId: crypto.randomUUID(),
          })
        ).status
      }),
    listPets: () =>
      withRequiredAgent(async () => {
        requireAgentCapability('pets.management.v1')
        return (await rpc.call('pet/list', {})).pets
      }),
    listPetCatalog: (refresh = false) =>
      withRequiredAgent(async () => {
        requireAgentCapability('pets.management.v1')
        return rpc.call('pet/catalog/list', { refresh })
      }),
    listReleaseNotes: (options = {}) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('release-notes.read.v1')
          return (await import('./ReleaseNotesClient.js')).listAgentReleaseNotes(
            rpc,
            currentAppVersion,
            options.refresh,
          )
        },
        async () => (await import('./ReleaseNotesClient.js')).mockReleaseNotes(currentAppVersion),
      ),
    installCatalogPet: (slug, acceptedRestrictedLicense = false) =>
      withRequiredAgent(async () => {
        requireAgentCapability('pets.management.v1')
        return (
          await rpc.call('pet/catalog/install', {
            slug,
            acceptedRestrictedLicense,
            operationId: crypto.randomUUID(),
          })
        ).pet
      }),
    previewPetInstall: (url) =>
      withRequiredAgent(async () => {
        requireAgentCapability('pets.management.v1')
        return rpc.call('pet/install/preview', { url })
      }),
    installPet: (url) =>
      withRequiredAgent(async () => {
        requireAgentCapability('pets.management.v1')
        return (
          await rpc.call('pet/install', {
            url,
            operationId: crypto.randomUUID(),
          })
        ).pet
      }),
    removePet: (id) =>
      withRequiredAgent(async () => {
        requireAgentCapability('pets.management.v1')
        await rpc.call('pet/remove', {
          id,
          operationId: crypto.randomUUID(),
        })
      }),
  }
}
