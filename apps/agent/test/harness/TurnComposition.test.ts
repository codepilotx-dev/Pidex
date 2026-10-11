import { describe, expect, test } from 'bun:test'
import {
  buildHarnessTurnComposition,
  computeCompositionIdentity,
  buildTurnContext,
  buildStepContext,
  validateToolEnvelope,
  validateDeferredActivation,
  type HarnessToolComposition,
} from '../../src/orchestration/harness/TurnComposition.ts'
import type { Model } from '@earendil-works/pi-ai'
import { Type } from 'typebox'

const mockModel = {
  provider: 'test-provider',
  api: 'test-api',
  id: 'test-model',
  name: 'Test Model',
  baseUrl: 'https://test.example.com',
  input: ['text'] as const,
  contextWindow: 128000,
} as unknown as Model<any>

const mockTool = {
  name: 'test-tool',
  label: 'Test Tool',
  description: 'A test tool',
  parameters: Type.Object({}),
  execute: async () => ({ content: [] }),
}

const makeTool = (name: string) => ({ ...mockTool, name })

describe('HarnessCompositionIdentity', () => {
  test('same inputs produce same hash', async () => {
    const p = {
      model: mockModel,
      thinkingLevel: 'medium' as const,
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: ['tool-a', 'tool-b'] as const,
    }
    const id1 = await computeCompositionIdentity(p)
    const id2 = await computeCompositionIdentity(p)
    expect(id1.hash).toBe(id2.hash)
    expect(id1.id).toBe(id2.id)
    expect(id1.version).toBe(1)
  })

  test('different model provider changes hash', async () => {
    const id1 = await computeCompositionIdentity({
      model: { ...mockModel, provider: 'provider-a' },
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
    })
    const id2 = await computeCompositionIdentity({
      model: { ...mockModel, provider: 'provider-b' },
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
    })
    expect(id1.hash).not.toBe(id2.hash)
  })

  test('different thinking level changes hash', async () => {
    const id1 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'low',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
    })
    const id2 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'high',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
    })
    expect(id1.hash).not.toBe(id2.hash)
  })

  test('different system prompt changes hash', async () => {
    const id1 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
    })
    const id2 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a DIFFERENT assistant.',
      registeredToolNames: [],
    })
    expect(id1.hash).not.toBe(id2.hash)
  })

  test('identity does not expose systemPrompt plaintext', async () => {
    const id = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant with secret info.',
      registeredToolNames: [],
    })
    expect(id.hash).not.toBe('You are a helpful assistant with secret info.')
    expect(Object.keys(id as object)).not.toContain('systemPrompt')
  })

  test('different tool names change hash', async () => {
    const id1 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: ['tool-a'],
    })
    const id2 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: ['tool-b'],
    })
    expect(id1.hash).not.toBe(id2.hash)
  })

  test('tool names are sorted in hash input', async () => {
    const id1 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: ['zebra', 'alpha'],
    })
    const id2 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: ['alpha', 'zebra'],
    })
    expect(id1.hash).toBe(id2.hash)
  })

  test('headers do NOT affect hash', async () => {
    const id1 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
      streamOptions: { headers: { Authorization: 'Bearer secret1' } },
    })
    const id2 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
      streamOptions: { headers: { Authorization: 'Bearer secret2' } },
    })
    expect(id1.hash).toBe(id2.hash)
  })

  test('metadata does NOT affect hash', async () => {
    const id1 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
      streamOptions: { metadata: { key: 'v1' } },
    })
    const id2 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
      streamOptions: { metadata: { key: 'v2' } },
    })
    expect(id1.hash).toBe(id2.hash)
  })

  test('timeoutMs does affect hash', async () => {
    const id1 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
      streamOptions: { timeoutMs: 30000 },
    })
    const id2 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
      streamOptions: { timeoutMs: 60000 },
    })
    expect(id1.hash).not.toBe(id2.hash)
  })

  test('maxRetries does affect hash', async () => {
    const id1 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
      streamOptions: { maxRetries: 1 },
    })
    const id2 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
      streamOptions: { maxRetries: 3 },
    })
    expect(id1.hash).not.toBe(id2.hash)
  })

  test('maxRetryDelayMs does affect hash', async () => {
    const id1 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
      streamOptions: { maxRetryDelayMs: 1000 },
    })
    const id2 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
      streamOptions: { maxRetryDelayMs: 2000 },
    })
    expect(id1.hash).not.toBe(id2.hash)
  })

  test('transport does affect hash', async () => {
    const id1 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
      streamOptions: { transport: 'sse' as any },
    })
    const id2 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
      streamOptions: { transport: 'stream' as any },
    })
    expect(id1.hash).not.toBe(id2.hash)
  })

  test('cacheRetention does affect hash', async () => {
    const id1 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
      streamOptions: { cacheRetention: { scope: 'turn' } as any },
    })
    const id2 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
      streamOptions: { cacheRetention: { scope: 'session' } as any },
    })
    expect(id1.hash).not.toBe(id2.hash)
  })

  test('skill content changes affect hash', async () => {
    const id1 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
      resources: {
        skills: [{ name: 'skill', description: '', content: 'content-a', filePath: '/test.md' }],
      },
    })
    const id2 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
      resources: {
        skills: [{ name: 'skill', description: '', content: 'content-b', filePath: '/test.md' }],
      },
    })
    expect(id1.hash).not.toBe(id2.hash)
  })

  test('skill name change affects hash', async () => {
    const id1 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
      resources: {
        skills: [{ name: 'skill-a', description: '', content: 'same', filePath: '/test.md' }],
      },
    })
    const id2 = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
      resources: {
        skills: [{ name: 'skill-b', description: '', content: 'same', filePath: '/test.md' }],
      },
    })
    expect(id1.hash).not.toBe(id2.hash)
  })

  test('id format is v{version}-{16-char-hash}', async () => {
    const id = await computeCompositionIdentity({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      registeredToolNames: [],
    })
    expect(id.id).toMatch(/^v1-[a-f0-9]{16}$/)
  })
})

describe('HarnessTurnComposition', () => {
  test('model, tools, resources, toolContext are external references', async () => {
    const externalModel = { ...mockModel }
    const externalTool = { ...mockTool }
    const externalResources = { skills: [] }
    const composition = await buildHarnessTurnComposition({
      model: externalModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      tools: [externalTool],
      toolContext: { foo: 'bar' } as any,
      resources: externalResources,
    })
    expect(composition.model).toBe(externalModel)
    expect(composition.tools[0]).toBe(externalTool)
    expect(composition.resources).toBe(externalResources)
    expect(composition.toolContext).toEqual({ foo: 'bar' })
  })

  test('external model and tools are NOT frozen', async () => {
    const externalModel = { ...mockModel }
    const externalTool = { ...mockTool }
    await buildHarnessTurnComposition({
      model: externalModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      tools: [externalTool],
      toolContext: undefined,
    })
    expect(Object.isFrozen(externalModel)).toBe(false)
    expect(Object.isFrozen(externalTool)).toBe(false)
  })

  test('tool execute callback is NOT frozen', async () => {
    const toolWithCallback = { ...mockTool, execute: async () => ({ content: [] }) }
    expect(Object.isFrozen(toolWithCallback.execute)).toBe(false)
  })

  test('external resources object and arrays are NOT frozen', async () => {
    const externalResources = {
      skills: [{ name: 's', description: '', content: 'c', filePath: '/f' }],
    }
    await buildHarnessTurnComposition({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      tools: [],
      toolContext: undefined,
      resources: externalResources,
    })
    expect(Object.isFrozen(externalResources)).toBe(false)
    expect(Object.isFrozen(externalResources.skills)).toBe(false)
  })

  test('original streamOptions and headers are NOT frozen', async () => {
    const originalOptions = { headers: { Auth: 'secret' }, timeoutMs: 1000 }
    const composition = await buildHarnessTurnComposition({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      tools: [],
      toolContext: undefined,
      streamOptions: originalOptions,
    })
    expect(Object.isFrozen(originalOptions)).toBe(false)
    expect(Object.isFrozen(originalOptions.headers)).toBe(false)
    expect(Object.isFrozen(composition.streamOptions.headers)).toBe(true)
  })

  test('original metadata is NOT frozen', async () => {
    const originalOptions = { metadata: { key: 'value' } }
    const composition = await buildHarnessTurnComposition({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      tools: [],
      toolContext: undefined,
      streamOptions: originalOptions,
    })
    expect(Object.isFrozen(originalOptions.metadata)).toBe(false)
    expect(Object.isFrozen(composition.streamOptions.metadata)).toBe(true)
  })

  test('composition outer shell is frozen', async () => {
    const composition = await buildHarnessTurnComposition({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      tools: [],
      toolContext: undefined,
    })
    expect(Object.isFrozen(composition)).toBe(true)
    expect(Object.isFrozen(composition.identity)).toBe(true)
    expect(Object.isFrozen(composition.toolPolicy)).toBe(true)
    expect(Object.isFrozen(composition.toolPolicy.registeredNames)).toBe(true)
    expect(Object.isFrozen(composition.toolPolicy.initialActiveNames)).toBe(true)
    expect(Object.isFrozen(composition.toolPolicy.deferredAllowedNames)).toBe(true)
    expect(Object.isFrozen(composition.streamOptions)).toBe(true)
    expect(Object.isFrozen(composition.activeToolNames)).toBe(true)
  })

  test('identity outer object is frozen', async () => {
    const composition = await buildHarnessTurnComposition({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      tools: [],
      toolContext: undefined,
    })
    const id = composition.identity
    expect(Object.isFrozen(id)).toBe(true)
  })

  test('initialActiveToolNames defaults to all tools when not provided', async () => {
    const composition = await buildHarnessTurnComposition({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      tools: [makeTool('a'), makeTool('b')],
      toolContext: undefined,
    })
    expect(composition.toolPolicy.initialActiveNames).toEqual(['a', 'b'])
  })

  test('initialActiveToolNames can be a subset of registered tools', async () => {
    const composition = await buildHarnessTurnComposition({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      tools: [makeTool('a'), makeTool('b'), makeTool('c')],
      initialActiveToolNames: ['a', 'b'] as const,
      toolContext: undefined,
    })
    expect(composition.toolPolicy.registeredNames).toEqual(['a', 'b', 'c'])
    expect(composition.toolPolicy.initialActiveNames).toEqual(['a', 'b'])
  })

  test('initialActiveToolNames cannot include non-registered tools', async () => {
    await expect(
      buildHarnessTurnComposition({
        model: mockModel,
        thinkingLevel: 'medium',
        systemPrompt: 'You are a helpful assistant.',
        tools: [makeTool('a')],
        initialActiveToolNames: ['a', 'unknown'] as const,
        toolContext: undefined,
      }),
    ).rejects.toThrow('Initial active tools not registered')
  })

  test('initialActiveToolNames cannot overlap with deferredAllowedNames', async () => {
    await expect(
      buildHarnessTurnComposition({
        model: mockModel,
        thinkingLevel: 'medium',
        systemPrompt: 'You are a helpful assistant.',
        tools: [makeTool('a')],
        initialActiveToolNames: ['a'] as const,
        deferredToolNames: ['a'],
        toolContext: undefined,
      }),
    ).rejects.toThrow('Tools cannot be both active and deferred')
  })
})

describe('HarnessTurnContext', () => {
  test('buildTurnContext includes all required fields', async () => {
    const composition = await buildHarnessTurnComposition({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      tools: [mockTool],
      toolContext: undefined,
    })
    const context = buildTurnContext({ composition, stepIndex: 0 })
    expect(context.compositionId).toBe(composition.identity.id)
    expect(context.compositionHash).toBe(composition.identity.hash)
    expect(context.stepIndex).toBe(0)
    expect(context.model).toBe(composition.model)
    expect(context.systemPrompt).toBe('You are a helpful assistant.')
    expect(context.activeToolNames).toEqual(['test-tool'])
    expect(context.streamOptions).toBe(composition.streamOptions)
  })

  test('buildTurnContext uses currentActiveToolNames when provided', async () => {
    const composition = await buildHarnessTurnComposition({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      tools: [makeTool('a'), makeTool('b')],
      initialActiveToolNames: ['a'] as const,
      toolContext: undefined,
    })
    const context = buildTurnContext({
      composition,
      stepIndex: 1,
      currentActiveToolNames: ['a', 'b'],
    })
    expect(context.activeToolNames).toEqual(['a', 'b'])
    expect(context.stepIndex).toBe(1)
  })

  test('buildTurnContext returns frozen context', async () => {
    const composition = await buildHarnessTurnComposition({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      tools: [],
      toolContext: undefined,
    })
    const context = buildTurnContext({ composition, stepIndex: 0 })
    expect(Object.isFrozen(context)).toBe(true)
  })
})

describe('HarnessStepContext', () => {
  test('buildStepContext uses provided currentActiveNames', async () => {
    const composition = await buildHarnessTurnComposition({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      tools: [makeTool('a'), makeTool('b')],
      toolContext: undefined,
    })
    const ctx1 = buildStepContext({
      stepIndex: 0,
      currentActiveNames: ['a', 'b'],
      toolPolicy: composition.toolPolicy,
    })
    const ctx2 = buildStepContext({
      stepIndex: 1,
      currentActiveNames: ['a'],
      toolPolicy: composition.toolPolicy,
    })
    expect(ctx1.currentActiveNames).toEqual(['a', 'b'])
    expect(ctx2.currentActiveNames).toEqual(['a'])
    expect(ctx1.isActiveTool('a')).toBe(true)
    expect(ctx2.isActiveTool('b')).toBe(false)
  })

  test('buildStepContext returns frozen context', async () => {
    const composition = await buildHarnessTurnComposition({
      model: mockModel,
      thinkingLevel: 'medium',
      systemPrompt: 'You are a helpful assistant.',
      tools: [],
      toolContext: undefined,
    })
    const ctx = buildStepContext({
      stepIndex: 0,
      currentActiveNames: ['a'],
      toolPolicy: composition.toolPolicy,
    })
    expect(Object.isFrozen(ctx)).toBe(true)
    expect(Object.isFrozen(ctx.currentActiveNames)).toBe(true)
  })
})

describe('validateToolEnvelope', () => {
  test('passes for names in registeredNames', () => {
    const policy: HarnessToolComposition = {
      registeredNames: ['a', 'b'],
      initialActiveNames: ['a'],
      deferredAllowedNames: [],
    }
    expect(() => validateToolEnvelope(['a'], policy)).not.toThrow()
    expect(() => validateToolEnvelope(['a', 'b'], policy)).not.toThrow()
  })

  test('passes for names in deferredAllowedNames', () => {
    const policy: HarnessToolComposition = {
      registeredNames: ['a'],
      initialActiveNames: ['a'],
      deferredAllowedNames: ['b'],
    }
    expect(() => validateToolEnvelope(['b'], policy)).not.toThrow()
  })

  test('throws for unknown names', () => {
    const policy: HarnessToolComposition = {
      registeredNames: ['a'],
      initialActiveNames: ['a'],
      deferredAllowedNames: [],
    }
    expect(() => validateToolEnvelope(['unknown'], policy)).toThrow('Unknown tool(s): unknown')
  })

  test('throws for duplicate names', () => {
    const policy: HarnessToolComposition = {
      registeredNames: ['a', 'b'],
      initialActiveNames: ['a'],
      deferredAllowedNames: [],
    }
    expect(() => validateToolEnvelope(['a', 'a'], policy)).toThrow('Duplicate tool names: a')
  })

  test('throws when name is both registered and deferred', () => {
    const policy: HarnessToolComposition = {
      registeredNames: ['a'],
      initialActiveNames: ['a'],
      deferredAllowedNames: ['a'],
    }
    expect(() => validateToolEnvelope(['a'], policy)).toThrow(
      'cannot be validated as registered envelope and deferred simultaneously',
    )
  })
})

describe('validateDeferredActivation', () => {
  test('passes for names in deferredAllowedNames', () => {
    const policy: HarnessToolComposition = {
      registeredNames: ['a'],
      initialActiveNames: ['a'],
      deferredAllowedNames: ['b', 'c'],
    }
    expect(() => validateDeferredActivation(['b'], policy)).not.toThrow()
    expect(() => validateDeferredActivation(['b', 'c'], policy)).not.toThrow()
  })

  test('throws for names not in deferredAllowedNames', () => {
    const policy: HarnessToolComposition = {
      registeredNames: ['a'],
      initialActiveNames: ['a'],
      deferredAllowedNames: ['b'],
    }
    expect(() => validateDeferredActivation(['a'], policy)).toThrow(
      'Deferred activation not allowed for: a',
    )
    expect(() => validateDeferredActivation(['unknown'], policy)).toThrow(
      'Deferred activation not allowed for: unknown',
    )
  })

  test('throws for duplicate activation names', () => {
    const policy: HarnessToolComposition = {
      registeredNames: ['a'],
      initialActiveNames: ['a'],
      deferredAllowedNames: ['b'],
    }
    expect(() => validateDeferredActivation(['b', 'b'], policy)).toThrow(
      'Duplicate activation names: b',
    )
  })
})

describe('integration', () => {
  test('full composition lifecycle', async () => {
    const composition = await buildHarnessTurnComposition({
      model: mockModel,
      thinkingLevel: 'high',
      systemPrompt: 'You are a helpful assistant.',
      tools: [makeTool('registered'), makeTool('other')],
      initialActiveToolNames: ['registered'] as const,
      deferredToolNames: ['deferred-tool'],
      resources: {
        skills: [{ name: 'skill', description: '', content: 'content', filePath: '/test.md' }],
      },
      toolContext: { workspace: '/test' } as { workspace: string },
      streamOptions: { timeoutMs: 60000, maxRetries: 3 },
    })

    expect(composition.identity.id).toMatch(/^v1-/)
    expect(composition.thinkingLevel).toBe('high')
    expect(composition.toolPolicy.registeredNames).toEqual(['other', 'registered'])
    expect(composition.toolPolicy.initialActiveNames).toEqual(['registered'])
    expect(composition.toolPolicy.deferredAllowedNames).toEqual(['deferred-tool'])

    const context = buildTurnContext({ composition, stepIndex: 5 })
    expect(context.stepIndex).toBe(5)
    expect(context.activeToolNames).toEqual(['registered'])

    const stepCtx = buildStepContext({
      stepIndex: 5,
      currentActiveNames: ['registered', 'deferred-tool'],
      toolPolicy: composition.toolPolicy,
    })
    expect(stepCtx.isDeferredTool('deferred-tool')).toBe(true)
    expect(stepCtx.isActiveTool('registered')).toBe(true)
  })
})
