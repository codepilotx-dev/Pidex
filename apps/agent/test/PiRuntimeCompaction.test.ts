import { describe, expect, test } from 'bun:test'
import { InMemorySessionRepo } from '../scripts/support/PiSessionMemory'
import { DEFAULT_PERMISSION_CONFIG } from '@pidex/shared/thread'
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type Context,
} from '@earendil-works/pi-ai'
import { AgentError } from '../src/Domain'
import { executeHarnessRun } from '../src/orchestration/pi/ExecuteHarnessRun'
import { frozenDeferredEnvelope } from '../src/tool/ToolExecutor'
import { REACTIVE_CONTINUATION_PROMPT } from '../src/orchestration/pi/ContextOverflow'
import type {
  ActiveHarness,
  HarnessRuntimeOptions,
  HarnessRuntimeRequest,
  RuntimeCompactionTrigger,
} from '../src/orchestration/pi/Types'

const providerError = () =>
  fauxAssistantMessage([], {
    stopReason: 'error',
    errorMessage: 'context_length_exceeded: maximum context length reached',
  })

const messageText = (message: Context['messages'][number]) => {
  if (message.role !== 'user') return ''
  if (typeof message.content === 'string') return message.content
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

async function createRuntime(input: {
  responses: Parameters<ReturnType<typeof fauxProvider>['setResponses']>[0]
  shouldAutoCompact?: boolean
}) {
  const faux = fauxProvider({
    models: [{ id: 'runtime-compaction', input: ['text'], contextWindow: 64_000 }],
  })
  faux.setResponses(input.responses)
  const models = createModels()
  models.setProvider(faux.provider)
  const repo = new InMemorySessionRepo()
  const sessionID = crypto.randomUUID()
  const session = await repo.create({ id: sessionID })
  const compacted: RuntimeCompactionTrigger[] = []
  const failures: RuntimeCompactionTrigger[] = []
  let active: ActiveHarness | undefined
  const runtimeOptions: HarnessRuntimeOptions = {
    activated: (_threadID, value) => {
      active = value
    },
    harnessFactory: {
      resolve: async () => ({ models, session }),
    },
    toolExecutor: {
      deferredDefinitions: (exposure: { frozenDeferredToolNames?: readonly string[] }) =>
        frozenDeferredEnvelope([], exposure.frozenDeferredToolNames),
    } as never,
    eventSink: {
      compacted: async (_context, event) => {
        compacted.push(event.trigger)
      },
    },
    compaction: {
      shouldAutoCompact: async () => input.shouldAutoCompact ?? false,
      recordFailure: async (_threadID, trigger) => {
        failures.push(trigger)
      },
    },
  }
  const request: HarnessRuntimeRequest = {
    threadID: 'thread-runtime-compaction',
    turnID: 'turn-runtime-compaction',
    agentID: 'agent-runtime-compaction',
    sessionID,
    content: 'original runtime request',
    taskMode: 'chat',
    permissionConfig: DEFAULT_PERMISSION_CONFIG,
    signal: new AbortController().signal,
    workspace: {} as never,
    model: faux.getModel(),
    policyModel: { providerID: 'faux', id: 'runtime-compaction' } as never,
    exposedTools: [],
    promptSections: [
      {
        id: 'test-system',
        role: 'system',
        cache: 'global-stable',
        authority: 'builtin',
        source: { type: 'builtin', name: 'test' },
        content: 'runtime compaction test',
      },
    ],
  }
  return {
    runtime: {
      run: (request: HarnessRuntimeRequest) => executeHarnessRun(runtimeOptions, request),
      dispose: () => active?.harness.abort() ?? Promise.resolve(),
    },
    request,
    compacted,
    failures,
  }
}

describe('Harness runtime provider errors', () => {
  test.each([
    ['timeout', 'PI_TIMEOUT_FAILED', '模型请求超时，请稍后重试'],
    ['unexpected failure', 'PI_UNKNOWN_FAILED', '模型请求失败，请稍后重试'],
  ])('%s 使用主请求安全文案', async (providerMessage, code, message) => {
    const credential = 'sk-test-private-credential'
    const localPath = 'C:\\private\\credentials.json'
    const setup = await createRuntime({
      responses: [
        fauxAssistantMessage([], {
          stopReason: 'error',
          errorMessage: `${providerMessage}: ${credential} ${localPath}`,
        }),
      ],
    })
    try {
      const error = await setup.runtime.run(setup.request).then(
        () => undefined,
        (cause: unknown) => cause,
      )
      expect(error).toBeInstanceOf(AgentError)
      expect(error).toMatchObject({ code, message, status: 502 })
      expect((error as Error).message).not.toContain(credential)
      expect((error as Error).message).not.toContain(localPath)
    } finally {
      await setup.runtime.dispose()
    }
  })
})

describe('Harness runtime context compaction', () => {
  test('successful turns remain successful when automatic compaction runs afterward', async () => {
    const setup = await createRuntime({
      responses: [
        fauxAssistantMessage('completed before compaction'),
        fauxAssistantMessage('automatic compact summary'),
      ],
      shouldAutoCompact: true,
    })

    await expect(setup.runtime.run(setup.request)).resolves.toEqual({
      status: 'completed',
      output: 'completed before compaction',
    })
    expect(setup.compacted).toEqual(['automatic'])
    expect(setup.failures).toEqual([])
    await setup.runtime.dispose()
  })

  test('automatic compaction failure is recorded without replacing a successful turn', async () => {
    const setup = await createRuntime({
      responses: [
        fauxAssistantMessage('completed before failed compaction'),
        fauxAssistantMessage([], {
          stopReason: 'error',
          errorMessage: 'summary provider unavailable',
        }),
      ],
      shouldAutoCompact: true,
    })

    await expect(setup.runtime.run(setup.request)).resolves.toEqual({
      status: 'completed',
      output: 'completed before failed compaction',
    })
    expect(setup.compacted).toEqual([])
    expect(setup.failures).toEqual(['automatic'])
    await setup.runtime.dispose()
  })

  test('provider overflow compacts once and continues without appending the original request again', async () => {
    let continuationContext: Context | undefined
    const setup = await createRuntime({
      responses: [
        providerError(),
        fauxAssistantMessage('reactive compact summary'),
        (context: Context) => {
          continuationContext = context
          return fauxAssistantMessage('continued after compaction')
        },
      ],
    })

    await expect(setup.runtime.run(setup.request)).resolves.toEqual({
      status: 'completed',
      output: 'continued after compaction',
    })
    expect(setup.compacted).toEqual(['reactive'])
    expect(setup.failures).toEqual([])
    const userMessages =
      continuationContext?.messages.filter((message) => message.role === 'user').map(messageText) ??
      []
    expect(userMessages.filter((text) => text === setup.request.content)).toHaveLength(1)
    expect(userMessages.at(-1)).toBe(REACTIVE_CONTINUATION_PROMPT)
    await setup.runtime.dispose()
  })

  test('a second overflow stops with a typed error instead of entering a recovery loop', async () => {
    const setup = await createRuntime({
      responses: [
        providerError(),
        fauxAssistantMessage('reactive compact summary'),
        providerError(),
      ],
    })

    const error = await setup.runtime.run(setup.request).catch((cause) => cause)
    expect(error).toBeInstanceOf(AgentError)
    expect((error as AgentError).code).toBe('PI_CONTEXT_WINDOW_EXCEEDED')
    expect((error as AgentError).status).toBe(413)
    expect(setup.compacted).toEqual(['reactive'])
    expect(setup.failures).toEqual(['reactive'])
    await setup.runtime.dispose()
  })
})

describe('Frozen deferred tool envelope', () => {
  test('binds only frozen names, excludes newly registered tools, and fails closed on missing names', () => {
    const registry = [{ sdkName: 'frozen-a' }, { sdkName: 'frozen-b' }, { sdkName: 'new-tool' }]
    const bound = frozenDeferredEnvelope(registry, ['frozen-a', 'frozen-b'])
    expect(bound.map((definition) => definition.sdkName)).toEqual(['frozen-a', 'frozen-b'])
    // No frozen envelope → every live definition stays bindable (fresh turns).
    expect(
      frozenDeferredEnvelope(registry, undefined).map((definition) => definition.sdkName),
    ).toEqual(['frozen-a', 'frozen-b', 'new-tool'])
    // A frozen name missing from the live registry fails closed.
    let caught: unknown
    try {
      frozenDeferredEnvelope(registry, ['frozen-a', 'missing'])
    } catch (cause) {
      caught = cause
    }
    expect(caught).toBeInstanceOf(AgentError)
    expect((caught as AgentError).code).toBe('RUNTIME_COMPOSITION_UNAVAILABLE')
  })

  test('resume with a missing frozen deferred tool rejects before running the harness', async () => {
    const setup = await createRuntime({
      responses: [fauxAssistantMessage('completed')],
    })
    const error = await setup.runtime
      .run({
        ...setup.request,
        frozenDeferredToolNames: ['missing-deferred'],
      })
      .catch((cause) => cause)
    expect(error).toBeInstanceOf(AgentError)
    expect((error as AgentError).code).toBe('RUNTIME_COMPOSITION_UNAVAILABLE')
    await setup.runtime.dispose()
  })
})
