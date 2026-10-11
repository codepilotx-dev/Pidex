import { describe, expect, test } from 'bun:test'
import { AgentHarness } from '../../src/orchestration/harness/AgentHarness.ts'
import type { AgentHarnessTool } from '../../src/orchestration/harness/Types.ts'
import type { AgentTool } from '../../src/orchestration/harness/AgentTypes.ts'
import { DeferredToolCatalog } from '../../src/tool/harness/DeferredToolCatalog.ts'
import { InMemorySessionRepo } from '../../scripts/support/PiSessionMemory.ts'
import {
  Type,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  getCurrentTools,
  type TranscriptContext,
} from '@earendil-works/pi-ai'

function setupProvider(responses: Parameters<ReturnType<typeof fauxProvider>['setResponses']>[0]) {
  const faux = fauxProvider({ models: [{ id: 'test', input: ['text'], contextWindow: 64_000 }] })
  faux.setResponses(responses)
  const models = createModels()
  models.setProvider(faux.provider)
  return { faux, models }
}

describe('DeferredToolCatalog', () => {
  test('searches metadata without loading and resolves exact names once', async () => {
    let loads = 0
    const catalog = new DeferredToolCatalog<AgentTool>([
      {
        name: 'repo_search',
        label: 'Repository Search',
        description: 'Search source files',
        load: async () => {
          loads += 1
          return {
            name: 'repo_search',
            label: 'Repository Search',
            description: 'Search source files',
            parameters: Type.Object({}),
            execute: async () => ({ content: [], details: {} }),
          }
        },
      },
    ])
    expect(catalog.search('repo_search', 1)[0]?.name).toBe('repo_search')
    expect(loads).toBe(0)
    expect(
      (await catalog.resolve(['repo_search', 'repo_search'])).map((tool) => tool.name),
    ).toEqual(['repo_search'])
    await catalog.activate(['repo_search'])
    expect(loads).toBe(1)
    await expect(catalog.resolve(['missing'])).rejects.toThrow('Unknown deferred tool')
  })
})

describe('AgentHarness deferred activation', () => {
  test('activates result tools, preserves progress/structured content, and restores from session', async () => {
    type ToolContext = { workspace: string }
    let deferredToolContext: ToolContext | undefined
    const deferredTool: AgentHarnessTool<ToolContext> = {
      name: 'deferred',
      label: 'Deferred',
      description: 'Loaded on demand',
      parameters: Type.Object({}),
      execute: async (_id, _input, _signal, _update, context) => {
        deferredToolContext = context
        return { content: [], details: {} }
      },
    }
    const catalog = new DeferredToolCatalog<AgentHarnessTool<ToolContext>>([
      {
        name: 'deferred',
        label: 'Deferred',
        description: 'Loaded on demand',
        load: () => deferredTool,
      },
    ])
    const discover: AgentHarnessTool<ToolContext> = {
      name: 'discover',
      label: 'Discover',
      description: 'Discovers deferred tools',
      parameters: Type.Object({}),
      execute: async (_id, _input, _signal, update, _context) => {
        update?.({
          progress: { current: 1, total: 2, message: 'searching' },
          structuredContent: { phase: 1 },
        })
        return { structuredContent: { found: ['deferred'] }, addedToolNames: ['deferred'] }
      },
    }
    const firstSetup = setupProvider([
      fauxAssistantMessage(fauxToolCall('discover', {}), { stopReason: 'toolUse' }),
      fauxAssistantMessage(fauxToolCall('discover', {}), { stopReason: 'toolUse' }),
      fauxAssistantMessage('activated'),
    ])
    const repo = new InMemorySessionRepo()
    const session = await repo.create({ id: crypto.randomUUID() })
    const harness = new AgentHarness({
      session,
      models: firstSetup.models,
      model: firstSetup.faux.getModel(),
      tools: [discover],
      deferredToolCatalog: catalog,
      toolContext: { workspace: 'initial' },
    })
    const updates: unknown[] = []
    const savePoints: string[][] = []
    const compositionTools: string[][] = []
    harness.subscribe((event) => {
      if (event.type === 'tool_execution_update') updates.push(event.partialResult)
      if (event.type === 'save_point') savePoints.push(event.activeToolNames)
      if (event.type === 'turn_composition') compositionTools.push(event.activeToolNames)
    })

    await harness.prompt('discover')
    expect(harness.getActiveToolNames()).toEqual(['discover', 'deferred'])
    expect(updates).toEqual([
      { progress: { current: 1, total: 2, message: 'searching' }, structuredContent: { phase: 1 } },
      { progress: { current: 1, total: 2, message: 'searching' }, structuredContent: { phase: 1 } },
    ])
    expect(savePoints.at(-1)).toEqual(['discover', 'deferred'])
    expect(compositionTools.at(-1)).toEqual(['deferred', 'discover'])
    expect((await session.buildContext()).activeToolNames).toEqual(['discover', 'deferred'])

    let restoredProviderTools: string[] = []
    const secondSetup = setupProvider([
      (context: TranscriptContext) => {
        restoredProviderTools = getCurrentTools(context.messages).map((tool) => tool.name)
        return fauxAssistantMessage(fauxToolCall('deferred', {}), { stopReason: 'toolUse' })
      },
      fauxAssistantMessage('restored'),
    ])
    const restored = new AgentHarness({
      session,
      models: secondSetup.models,
      model: secondSetup.faux.getModel(),
      tools: [discover],
      deferredToolCatalog: catalog,
      toolContext: { workspace: 'restored' },
    })
    await restored.prompt('continue')
    expect(restoredProviderTools).toEqual(['discover', 'deferred'])
    expect(restored.getActiveToolNames()).toEqual(['discover', 'deferred'])
    expect(deferredToolContext).toEqual({ workspace: 'restored' })
  })

  test('rejects activation outside the current turn deferred envelope', async () => {
    const discover: AgentHarnessTool<undefined> = {
      name: 'discover',
      label: 'Discover',
      description: 'Returns an unregistered tool name',
      parameters: Type.Object({}),
      execute: async () => ({ addedToolNames: ['not-in-envelope'] }),
    }
    const setup = setupProvider([
      fauxAssistantMessage(fauxToolCall('discover', {}), { stopReason: 'toolUse' }),
    ])
    const repo = new InMemorySessionRepo()
    const session = await repo.create({ id: crypto.randomUUID() })
    const harness = new AgentHarness({
      session,
      models: setup.models,
      model: setup.faux.getModel(),
      tools: [discover],
    })

    const result = await harness.prompt('discover')
    expect(result.stopReason).toBe('error')
    expect(result.errorMessage).toContain('Deferred activation not allowed')
  })
})

describe('AgentHarness turn composition', () => {
  test('resolves an async system prompt at each turn boundary, never in the constructor', async () => {
    let resolutions = 0
    const setup = setupProvider([fauxAssistantMessage('first'), fauxAssistantMessage('second')])
    const repo = new InMemorySessionRepo()
    const session = await repo.create({ id: crypto.randomUUID() })
    const harness = new AgentHarness({
      session,
      models: setup.models,
      model: setup.faux.getModel(),
      systemPrompt: async () => `dynamic-${++resolutions}`,
    })
    const compositionIds: string[] = []
    harness.subscribe((event) => {
      if (event.type === 'turn_composition') compositionIds.push(event.compositionId)
    })

    expect(resolutions).toBe(0)
    await harness.prompt('first')
    expect(resolutions).toBe(1)
    await harness.prompt('second')
    expect(resolutions).toBe(2)
    expect(compositionIds).toHaveLength(2)
    expect(compositionIds[0]).not.toBe(compositionIds[1])
  })

  test('keeps one immutable composition across provider/tool steps and reflects latest active tools per step', async () => {
    const deferredTool: AgentHarnessTool<{ workspace: string }> = {
      name: 'deferred',
      label: 'Deferred',
      description: 'Loaded on demand',
      parameters: Type.Object({}),
      execute: async () => ({ content: [], details: {} }),
    }
    const catalog = new DeferredToolCatalog<AgentHarnessTool<{ workspace: string }>>([
      {
        name: 'deferred',
        label: 'Deferred',
        description: 'Loaded on demand',
        load: () => deferredTool,
      },
    ])
    const discover: AgentHarnessTool<{ workspace: string }> = {
      name: 'discover',
      label: 'Discover',
      description: 'Discovers deferred tools',
      parameters: Type.Object({}),
      execute: async () => ({ addedToolNames: ['deferred'] }),
    }
    const setup = setupProvider([
      fauxAssistantMessage(fauxToolCall('discover', {}), { stopReason: 'toolUse' }),
      fauxAssistantMessage(fauxToolCall('discover', {}), { stopReason: 'toolUse' }),
      fauxAssistantMessage('activated'),
    ])
    const repo = new InMemorySessionRepo()
    const session = await repo.create({ id: crypto.randomUUID() })
    const harness = new AgentHarness({
      session,
      models: setup.models,
      model: setup.faux.getModel(),
      tools: [discover],
      deferredToolCatalog: catalog,
      toolContext: { workspace: 'initial' },
    })
    const compositionIds: string[] = []
    const compositionHashes: string[] = []
    const compositionTools: string[][] = []
    harness.subscribe((event) => {
      if (event.type === 'turn_composition') {
        compositionIds.push(event.compositionId)
        compositionHashes.push(event.compositionHash)
        compositionTools.push(event.activeToolNames)
      }
    })

    await harness.prompt('discover')

    // Multiple provider/tool steps share the same immutable composition.
    expect(compositionIds.length).toBeGreaterThanOrEqual(2)
    expect(new Set(compositionIds).size).toBe(1)
    expect(new Set(compositionHashes).size).toBe(1)
    // The step context (not the composition) reflects the latest active tools.
    expect(compositionTools.at(-1)).toEqual(['deferred', 'discover'])
    expect(harness.getActiveToolNames()).toEqual(['discover', 'deferred'])
  })

  test('resolves an async system prompt once per product turn even across tool steps', async () => {
    let resolutions = 0
    const greet: AgentHarnessTool<undefined> = {
      name: 'greet',
      label: 'Greet',
      description: 'greets',
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: 'text', text: 'hi' }], details: {} }),
    }
    const setup = setupProvider([
      fauxAssistantMessage(fauxToolCall('greet', {}), { stopReason: 'toolUse' }),
      fauxAssistantMessage('done'),
    ])
    const repo = new InMemorySessionRepo()
    const session = await repo.create({ id: crypto.randomUUID() })
    const harness = new AgentHarness({
      session,
      models: setup.models,
      model: setup.faux.getModel(),
      tools: [greet],
      systemPrompt: async () => `dynamic-${++resolutions}`,
    })
    const compositionIds: string[] = []
    harness.subscribe((event) => {
      if (event.type === 'turn_composition') compositionIds.push(event.compositionId)
    })

    expect(resolutions).toBe(0)
    await harness.prompt('start')

    expect(resolutions).toBe(1)
    expect(new Set(compositionIds).size).toBe(1)
  })
})

describe('AgentHarness live steering', () => {
  test('consumes stable input ids one at a time at model boundaries', async () => {
    let harness!: AgentHarness
    const queued: Promise<void>[] = []
    let requested = false
    const setup = setupProvider([
      () => {
        if (!requested) {
          requested = true
          queued.push(harness.steer('first steer', { inputId: 'input:steer:first' }))
          queued.push(harness.steer('second steer', { inputId: 'input:steer:second' }))
        }
        return fauxAssistantMessage('first sample')
      },
      fauxAssistantMessage('second sample'),
      fauxAssistantMessage('done'),
    ])
    const repo = new InMemorySessionRepo()
    const session = await repo.create({ id: crypto.randomUUID() })
    harness = new AgentHarness({
      session,
      models: setup.models,
      model: setup.faux.getModel(),
    })
    const consumed: string[][] = []
    harness.subscribe((event) => {
      if (event.type === 'queue_consumed' && event.delivery === 'steer') {
        consumed.push(event.inputIds)
      }
    })

    await harness.prompt('start')
    await Promise.all(queued)

    expect(consumed).toEqual([['input:steer:first'], ['input:steer:second']])
  })
})
