import { afterEach, expect, spyOn, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DesktopModelProviderState } from '../shared/Types.js'
import { useSideChatController } from '../src/features/layout/dock/UseSideChatController.js'
import { sessionModelSelections } from '../src/features/session/state/SessionModelSelectionStore.js'
import { desktopClient } from '../src/services/desktop-client/index.js'

const providerState: DesktopModelProviderState = {
  selectedProviderID: 'openai',
  model: 'gpt-5',
  models: ['gpt-5'],
  provider: {
    providerID: 'openai',
    displayName: 'OpenAI',
    kind: 'openai',
    apiKeyConfigured: true,
    defaultModels: ['gpt-5'],
  },
  baseURL: 'https://target.example/v1',
  apiKeyConfigured: true,
  apiKeySource: null,
  modelConfigured: true,
}

const spies: Array<{ mockRestore(): void }> = []
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
})

function controller() {
  let result: ReturnType<typeof useSideChatController> | undefined
  const errors: string[] = []
  function Harness() {
    result = useSideChatController({
      activeTab: null,
      sourceThreadId: 'source',
      initialSettings: {
        permissionMode: 'default',
        planModeActive: false,
        providerID: 'source-provider',
        providerBaseURL: 'https://source.example',
        model: 'source-model',
        selectedModelPreset: 'source-model',
        thinkingMode: 'adaptive',
        variant: 'adaptive',
      },
      openRightDockTab() {},
      removeWorkbenchTab() {},
      replaceWorkbenchTab() {},
      onError: (message) => errors.push(message),
    })
    return null
  }
  renderToStaticMarkup(<Harness />)
  if (!result) throw new Error('Hook did not render')
  return { api: result, errors }
}

test('missing side chat waits for its own model and never exposes the source selection', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof sessionModelSelections.load>>) => void
  const load = spyOn(sessionModelSelections, 'load').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const provider = spyOn(desktopClient, 'getModelProviderState').mockResolvedValue(providerState)
  const send = spyOn(desktopClient, 'sendUserMessage').mockResolvedValue(undefined)
  spies.push(load, provider, send)
  const { api } = controller()
  expect(api.getSideChatSettings('side-chat:b').model).toBe('')
  const submission = api.sideChatSubmitToSession('b', 'hello')
  expect(send).not.toHaveBeenCalled()
  resolve({ providerID: 'openai', model: 'gpt-5', thinkingMode: 'enabled', variant: 'high' })
  await submission
  expect(load).toHaveBeenCalledWith('b')
  expect(provider).toHaveBeenCalledWith('openai')
  expect(send).toHaveBeenCalledWith(
    'b',
    'hello',
    {
      providerID: 'openai',
      model: 'gpt-5',
      variant: 'high',
      providerBaseURL: providerState.baseURL,
    },
    undefined,
  )
})

test('side chat drafts and queued sends remain keyed to the target thread', async () => {
  const load = spyOn(sessionModelSelections, 'load').mockImplementation(async (id) => ({
    providerID: 'openai',
    model: `model-${id}`,
    thinkingMode: 'default',
  }))
  const set = spyOn(sessionModelSelections, 'set').mockImplementation(() => {})
  const provider = spyOn(desktopClient, 'getModelProviderState').mockResolvedValue(providerState)
  const send = spyOn(desktopClient, 'sendUserMessage').mockResolvedValue(undefined)
  const queue = spyOn(desktopClient, 'submitSessionFollowUp').mockResolvedValue('queued')
  spies.push(load, set, provider, send, queue)
  const { api } = controller()
  await api.sideChatSubmitToSession('a', 'first')
  api.updateSideChatSettings('side-chat:a', {
    model: 'new-a',
    thinkingMode: 'enabled',
    variant: 'high',
  })
  await api.sideChatSubmitToSession('b', 'second')
  await api.sideChatSubmitToSession('a', 'queued', { delivery: 'follow-up' })
  expect(api.getSideChatSettings('side-chat:a').model).toBe('new-a')
  expect(api.getSideChatSettings('side-chat:b').model).toBe('model-b')
  expect(api.getSideChatSettings('side-chat:b').variant).toBeUndefined()
  expect(queue).toHaveBeenCalledWith('a', 'queued', 'follow-up', undefined, {
    providerID: 'openai',
    model: 'new-a',
    variant: 'high',
    providerBaseURL: providerState.baseURL,
  })
})

test('failed restoration rejects sending and rejects a partial patch instead of inheriting source defaults', async () => {
  const load = spyOn(sessionModelSelections, 'load').mockRejectedValue(
    new Error('history unavailable'),
  )
  const send = spyOn(desktopClient, 'sendUserMessage').mockResolvedValue(undefined)
  spies.push(load, send)
  const { api, errors } = controller()
  api.updateSideChatSettings('side-chat:b', { thinkingMode: 'enabled' })
  expect(errors).toHaveLength(1)
  await expect(api.sideChatSubmitToSession('b', 'hello')).rejects.toThrow('history unavailable')
  expect(send).not.toHaveBeenCalled()
  expect(api.getSideChatSettings('side-chat:b').model).toBe('')
})

test('opening the same thread in the main view shares its latest selection and clears an old variant', async () => {
  const threadId = 'shared-side-model-test'
  const provider = spyOn(desktopClient, 'getModelProviderState').mockResolvedValue(providerState)
  const send = spyOn(desktopClient, 'sendUserMessage').mockResolvedValue(undefined)
  spies.push(provider, send)
  try {
    sessionModelSelections.set(threadId, {
      providerID: 'openai',
      model: 'old',
      thinkingMode: 'enabled',
      variant: 'high',
    })
    const { api } = controller()
    await api.sideChatSubmitToSession(threadId, 'first')
    sessionModelSelections.set(threadId, {
      providerID: 'openai',
      model: 'new',
      thinkingMode: 'default',
    })
    expect(api.getSideChatSettings(`side-chat:${threadId}`).model).toBe('new')
    expect(api.getSideChatSettings(`side-chat:${threadId}`).variant).toBeUndefined()
    await api.sideChatSubmitToSession(threadId, 'second')
    expect(send).toHaveBeenLastCalledWith(
      threadId,
      'second',
      {
        providerID: 'openai',
        model: 'new',
        providerBaseURL: providerState.baseURL,
      },
      undefined,
    )
  } finally {
    sessionModelSelections.delete(threadId)
  }
})
