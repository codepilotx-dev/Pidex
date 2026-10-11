import { afterEach, expect, spyOn, test } from 'bun:test'
import type { DesktopModelProviderState, DesktopSessionSnapshot } from '../shared/Types.js'
import {
  agentThreadSnapshotToDesktop,
  desktopPermissionModeToPermissionConfig,
} from '../src/services/AgentThreadAdapter.js'
import { desktopClient } from '../src/services/desktop-client/index.js'
import { sessionModelSelections as store } from '../src/features/session/state/SessionModelSelectionStore.js'
import { persistRecentNewThreadModel } from '../src/features/models/RecentNewThreadModel.js'

const ids = ['selection-a', 'selection-b', 'selection-empty', 'selection-error', 'selection-late']
const spies: Array<{ mockRestore(): void }> = []
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
  for (const id of [...ids, null]) store.delete(id)
})
const defaults: DesktopModelProviderState = {
  selectedProviderID: 'openai',
  model: 'default-model',
  models: ['default-model'],
  provider: {
    providerID: 'openai',
    displayName: 'OpenAI',
    kind: 'openai',
    apiKeyConfigured: true,
    defaultModels: ['default-model'],
  },
  baseURL: '',
  apiKeyConfigured: true,
  apiKeySource: null,
  modelConfigured: true,
}
/** 目录中可执行的 Provider 摘要：apiKeyConfigured、enabled、有模型。 */
const usableProvider = (overrides: Record<string, unknown> = {}): never =>
  ({
    providerID: 'deepseek',
    displayName: 'DeepSeek',
    kind: 'openai-compatible',
    baseURL: '',
    defaultModels: ['remembered'],
    apiKeyConfigured: true,
    enabled: true,
    authMethods: ['api-key'],
    envVars: [],
    requiresBaseURL: false,
    modelCount: 1,
    ...overrides,
  }) as never
function snapshot(id: string, model?: string): DesktopSessionSnapshot {
  const result = agentThreadSnapshotToDesktop({
    thread: {
      id,
      title: id,
      projectID: null,
      gitBranch: null,
      workspace: {
        kind: 'standalone',
        projectID: null,
        workspaceRoot: null,
        cwd: '/tmp',
        outputDirectory: '/tmp',
      },
      settings: {
        taskMode: 'chat',
        permissionConfig: desktopPermissionModeToPermissionConfig('default'),
      },
      archivedAt: null,
      createdAt: 1,
      updatedAt: 1,
    },
    turns: [],
    inputs: [],
    agents: [],
    messages: [],
    items: [],
    approvals: [],
  })
  result.settings = {
    ...result.settings,
    providerID: model ? 'deepseek' : undefined,
    model,
    thinkingMode: 'enabled',
    variant: model ? 'high' : undefined,
  }
  // List summaries deliberately contain no model; restoration must use the full settings.
  result.item.model = null
  return result
}

test('A/B retain independent unsent choices and reload actual history after memory is discarded', async () => {
  const history = spyOn(desktopClient, 'getSession').mockImplementation(async (id) =>
    snapshot(id, `history-${id}`),
  )
  const global = spyOn(desktopClient, 'getModelProviderState').mockResolvedValue(defaults)
  const save = spyOn(desktopClient, 'saveModelProvider').mockRejectedValue(
    new Error('must not save defaults'),
  )
  spies.push(history, global, save)
  expect(await store.load(ids[0]!)).toMatchObject({ model: `history-${ids[0]}`, variant: 'high' })
  store.set(ids[0]!, {
    providerID: 'openai',
    model: 'unsent-a',
    thinkingMode: 'adaptive',
    variant: 'adaptive',
  })
  await store.load(ids[1]!)
  expect(await store.load(ids[0]!)).toMatchObject({ model: 'unsent-a', thinkingMode: 'adaptive' })
  expect(store.getSnapshot(ids[1]!).selection?.model).toBe(`history-${ids[1]}`)
  store.delete(ids[0]!)
  expect(await store.load(ids[0]!)).toMatchObject({
    model: `history-${ids[0]}`,
    thinkingMode: 'enabled',
    variant: 'high',
  })
  expect(global).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
})

test('a delayed empty history uses global defaults only after confirming it has no model', async () => {
  let release!: (snapshot: DesktopSessionSnapshot) => void
  const history = spyOn(desktopClient, 'getSession').mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const global = spyOn(desktopClient, 'getModelProviderState').mockResolvedValue(defaults)
  spies.push(history, global)
  store.set(ids[0]!, { providerID: 'deepseek', model: 'a', thinkingMode: 'enabled' })
  const pending = store.load(ids[2]!)
  const repeated = store.load(ids[2]!)
  expect(store.getSnapshot(ids[2]!)).toEqual({ selection: null, loading: true, error: null })
  expect(history).toHaveBeenCalledTimes(1)
  expect(global).not.toHaveBeenCalled()
  release(snapshot(ids[2]!))
  await repeated
  expect(await pending).toEqual({
    providerID: 'openai',
    model: 'default-model',
    thinkingMode: 'default',
  })
  expect(store.getSnapshot(ids[0]!).selection?.model).toBe('a')
})

test('history failures remain visible and retry restores the same thread', async () => {
  const history = spyOn(desktopClient, 'getSession')
    .mockRejectedValueOnce(new Error('history unavailable'))
    .mockResolvedValue(snapshot(ids[3]!, 'recovered'))
  const global = spyOn(desktopClient, 'getModelProviderState').mockResolvedValue(defaults)
  spies.push(history, global)
  await expect(store.load(ids[3]!)).rejects.toThrow('history unavailable')
  expect(store.getSnapshot(ids[3]!)).toEqual({
    selection: null,
    loading: false,
    error: 'history unavailable',
  })
  expect(await store.load(ids[3]!)).toMatchObject({ model: 'recovered' })
  expect(store.getSnapshot(ids[3]!).error).toBeNull()
  expect(global).not.toHaveBeenCalled()
})

test('late historical success cannot replace an explicit draft', async () => {
  let release!: (snapshot: DesktopSessionSnapshot) => void
  spies.push(
    spyOn(desktopClient, 'getSession').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    ),
  )
  const pending = store.load(ids[4]!)
  const choice = { providerID: 'openai', model: 'chosen', thinkingMode: 'default' as const }
  store.set(ids[4]!, choice)
  release(snapshot(ids[4]!, 'stale'))
  expect(await pending).toEqual(choice)
  expect(store.getSnapshot(ids[4]!).selection).toEqual(choice)
})

test('late historical failure cannot reject a selection that was explicitly restored meanwhile', async () => {
  let reject!: (error: Error) => void
  spies.push(
    spyOn(desktopClient, 'getSession').mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail
        }),
    ),
  )
  const pending = store.load(ids[4]!)
  const choice = { providerID: 'openai', model: 'chosen', thinkingMode: 'default' as const }
  store.set(ids[4]!, choice)
  reject(new Error('old request failed'))
  expect(await pending).toEqual(choice)
  expect(store.getSnapshot(ids[4]!).error).toBeNull()
})

test('new-task page restores the remembered model when it is still usable', async () => {
  const recent = spyOn(desktopClient, 'getRecentNewThreadModel').mockResolvedValue({
    providerID: 'deepseek',
    id: 'remembered',
    variant: 'high',
  } as never)
  const providers = spyOn(desktopClient, 'listModelProviders').mockResolvedValue([usableProvider()])
  const models = spyOn(desktopClient, 'fetchProviderModels').mockResolvedValue({
    models: ['remembered'],
    modelMetadata: { remembered: { variants: ['high'] } },
  } as never)
  const first = spyOn(desktopClient, 'resolveFirstAvailableModel').mockResolvedValue(null)
  const save = spyOn(desktopClient, 'saveRecentNewThreadModel').mockResolvedValue(undefined)
  spies.push(recent, providers, models, first, save)
  expect(await store.load(null)).toMatchObject({
    providerID: 'deepseek',
    model: 'remembered',
    thinkingMode: 'default',
    variant: 'high',
  })
  expect(first).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
})

test('new-task page rejects a record whose provider is disabled or lacks credentials', async () => {
  const recent = spyOn(desktopClient, 'getRecentNewThreadModel').mockResolvedValue({
    providerID: 'deepseek',
    id: 'remembered',
  } as never)
  const providers = spyOn(desktopClient, 'listModelProviders').mockResolvedValue([
    usableProvider({ apiKeyConfigured: false }),
  ])
  const models = spyOn(desktopClient, 'fetchProviderModels').mockResolvedValue({
    models: ['remembered'],
    modelMetadata: {},
  } as never)
  const first = spyOn(desktopClient, 'resolveFirstAvailableModel').mockResolvedValue({
    providerID: 'openai',
    id: 'first-model',
  } as never)
  const save = spyOn(desktopClient, 'saveRecentNewThreadModel').mockResolvedValue(undefined)
  spies.push(recent, providers, models, first, save)
  expect(await store.load(null)).toMatchObject({ providerID: 'openai', model: 'first-model' })
  expect(models).not.toHaveBeenCalled()
  expect(save).toHaveBeenCalledWith({ providerID: 'openai', id: 'first-model' })
})

test('new-task page rejects a record whose variant is no longer offered', async () => {
  const recent = spyOn(desktopClient, 'getRecentNewThreadModel').mockResolvedValue({
    providerID: 'deepseek',
    id: 'remembered',
    variant: 'removed-variant',
  } as never)
  const providers = spyOn(desktopClient, 'listModelProviders').mockResolvedValue([usableProvider()])
  const models = spyOn(desktopClient, 'fetchProviderModels').mockResolvedValue({
    models: ['remembered'],
    modelMetadata: { remembered: { variants: ['high'] } },
  } as never)
  const first = spyOn(desktopClient, 'resolveFirstAvailableModel').mockResolvedValue({
    providerID: 'openai',
    id: 'first-model',
  } as never)
  const save = spyOn(desktopClient, 'saveRecentNewThreadModel').mockResolvedValue(undefined)
  spies.push(recent, providers, models, first, save)
  expect(await store.load(null)).toMatchObject({ providerID: 'openai', model: 'first-model' })
  expect(save).toHaveBeenCalledWith({ providerID: 'openai', id: 'first-model' })
})

test('re-entering the new-task page revalidates the choice instead of reusing the cache', async () => {
  const recent = spyOn(desktopClient, 'getRecentNewThreadModel').mockResolvedValue({
    providerID: 'deepseek',
    id: 'remembered',
    variant: 'high',
  } as never)
  const providers = spyOn(desktopClient, 'listModelProviders').mockResolvedValue([usableProvider()])
  const models = spyOn(desktopClient, 'fetchProviderModels').mockResolvedValue({
    models: ['remembered'],
    modelMetadata: { remembered: { variants: ['high'] } },
  } as never)
  const first = spyOn(desktopClient, 'resolveFirstAvailableModel').mockResolvedValue(null)
  const save = spyOn(desktopClient, 'saveRecentNewThreadModel').mockResolvedValue(undefined)
  spies.push(recent, providers, models, first, save)
  expect(await store.load(null)).toMatchObject({ model: 'remembered' })

  // 模型随后被禁用：再次进入必须重新验证、自动切换并覆盖最近记录。
  models.mockResolvedValue({ models: [], modelMetadata: {} } as never)
  first.mockResolvedValue({ providerID: 'openai', id: 'first-model' } as never)
  expect(await store.load(null)).toMatchObject({ providerID: 'openai', model: 'first-model' })
  expect(save).toHaveBeenCalledWith({ providerID: 'openai', id: 'first-model' })
})

test('new-task page keeps the in-memory choice when the catalog cannot be read', async () => {
  const recent = spyOn(desktopClient, 'getRecentNewThreadModel').mockResolvedValue(null)
  const providers = spyOn(desktopClient, 'listModelProviders').mockRejectedValue(
    new Error('agent offline'),
  )
  const first = spyOn(desktopClient, 'resolveFirstAvailableModel').mockResolvedValue(null)
  const save = spyOn(desktopClient, 'saveRecentNewThreadModel').mockResolvedValue(undefined)
  spies.push(recent, providers, first, save)
  store.set(null, { providerID: 'deepseek', model: 'chosen', thinkingMode: 'default' })
  expect(await store.load(null)).toMatchObject({ providerID: 'deepseek', model: 'chosen' })
  expect(save).not.toHaveBeenCalled()
})

test('new-task page reports an unsendable state when no model is available', async () => {
  const recent = spyOn(desktopClient, 'getRecentNewThreadModel').mockResolvedValue(null)
  const first = spyOn(desktopClient, 'resolveFirstAvailableModel').mockResolvedValue(null)
  spies.push(recent, first)
  await expect(store.load(null)).rejects.toThrow('没有可用于创建任务的模型')
})

test('new-task page picks and remembers the first available model when there is no record', async () => {
  const recent = spyOn(desktopClient, 'getRecentNewThreadModel').mockResolvedValue(null)
  const first = spyOn(desktopClient, 'resolveFirstAvailableModel').mockResolvedValue({
    providerID: 'openai',
    id: 'first-model',
  } as never)
  const save = spyOn(desktopClient, 'saveRecentNewThreadModel').mockResolvedValue(undefined)
  spies.push(recent, first, save)
  expect(await store.load(null)).toMatchObject({ providerID: 'openai', model: 'first-model' })
  expect(save).toHaveBeenCalledWith({ providerID: 'openai', id: 'first-model' })
})

test('new-task page overwrites a stale record with the first available model', async () => {
  const recent = spyOn(desktopClient, 'getRecentNewThreadModel').mockResolvedValue({
    providerID: 'removed',
    id: 'gone',
  } as never)
  const providers = spyOn(desktopClient, 'listModelProviders').mockResolvedValue([])
  const first = spyOn(desktopClient, 'resolveFirstAvailableModel').mockResolvedValue({
    providerID: 'openai',
    id: 'first-model',
  } as never)
  const save = spyOn(desktopClient, 'saveRecentNewThreadModel').mockResolvedValue(undefined)
  spies.push(recent, providers, first, save)
  expect(await store.load(null)).toMatchObject({ providerID: 'openai', model: 'first-model' })
  expect(save).toHaveBeenCalledWith({ providerID: 'openai', id: 'first-model' })
})

test('persistRecent only writes for the new-task page, never for existing tasks', async () => {
  const save = spyOn(desktopClient, 'saveRecentNewThreadModel').mockResolvedValue(undefined)
  spies.push(save)
  await store.persistRecent(ids[0]!, { providerID: 'openai', model: 'a', thinkingMode: 'default' })
  expect(save).not.toHaveBeenCalled()
  await store.persistRecent(null, {
    providerID: 'openai',
    model: 'home',
    thinkingMode: 'default',
    variant: 'high',
  })
  expect(save).toHaveBeenCalledWith({ providerID: 'openai', id: 'home', variant: 'high' })
})

test('a slow earlier selection cannot overwrite the final selection', async () => {
  const order: string[] = []
  let releaseA!: () => void
  const save = spyOn(desktopClient, 'saveRecentNewThreadModel').mockImplementation((model) => {
    order.push(`start:${model.id}`)
    if (model.id === 'a') {
      return new Promise<void>((resolve) => {
        releaseA = () => {
          order.push('end:a')
          resolve()
        }
      })
    }
    return Promise.resolve().then(() => {
      order.push(`end:${model.id}`)
    })
  })
  spies.push(save)
  const first = persistRecentNewThreadModel({ providerID: 'openai', id: 'a' })
  while (!releaseA) await Promise.resolve()
  const second = persistRecentNewThreadModel({ providerID: 'openai', id: 'b' })
  releaseA()
  await Promise.all([first, second])
  expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b'])
  expect(save.mock.calls.at(-1)?.[0]).toEqual({ providerID: 'openai', id: 'b' })
})

test('a superseded selection that never starts is not written at all', async () => {
  const save = spyOn(desktopClient, 'saveRecentNewThreadModel').mockResolvedValue(undefined)
  spies.push(save)
  const first = persistRecentNewThreadModel({ providerID: 'openai', id: 'a' })
  const second = persistRecentNewThreadModel({ providerID: 'openai', id: 'b' })
  await Promise.all([first, second])
  expect(save).toHaveBeenCalledTimes(1)
  expect(save).toHaveBeenCalledWith({ providerID: 'openai', id: 'b' })
})

test('only the final selection failure surfaces to the caller', async () => {
  const save = spyOn(desktopClient, 'saveRecentNewThreadModel').mockRejectedValue(
    new Error('save failed'),
  )
  spies.push(save)
  await expect(persistRecentNewThreadModel({ providerID: 'openai', id: 'final' })).rejects.toThrow(
    'save failed',
  )
})

test('a superseded selection failure stays silent', async () => {
  let rejectA!: (error: Error) => void
  const save = spyOn(desktopClient, 'saveRecentNewThreadModel').mockImplementation((model) =>
    model.id === 'a'
      ? new Promise<void>((_, reject) => {
          rejectA = reject
        })
      : Promise.resolve(),
  )
  spies.push(save)
  const first = persistRecentNewThreadModel({ providerID: 'openai', id: 'a' })
  while (!rejectA) await Promise.resolve()
  // 更新选择入队后才让旧选择失败：旧失败静默，最终选择仍成功落盘。
  const second = persistRecentNewThreadModel({ providerID: 'openai', id: 'b' })
  rejectA(new Error('a failed'))
  await expect(first).resolves.toBeUndefined()
  await expect(second).resolves.toBeUndefined()
  expect(save.mock.calls.at(-1)?.[0]).toEqual({ providerID: 'openai', id: 'b' })
})
