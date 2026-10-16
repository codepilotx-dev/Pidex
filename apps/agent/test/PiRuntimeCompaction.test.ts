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
  shouldAutoCompact?: boolean | (() => boolean)
  history?: string
  toolResult?: string
  manualAfterTool?: boolean
  manualOnFinal?: boolean
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
  if (input.history) {
    await session.appendMessage({ role: 'user', content: input.history, timestamp: 1 })
    await session.appendMessage(fauxAssistantMessage('old assistant answer'))
  }
  let manualPending = false
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
      definition: () => ({
        sdkName: 'probe',
        description: 'probe',
        schema: { parse: (value: unknown) => value },
        inputSchema: { type: 'object', properties: {} },
      }),
      execute: async () => {
        manualPending = input.manualAfterTool ?? false
        return input.toolResult ?? 'probe result'
      },
      deferredDefinitions: (exposure: { frozenDeferredToolNames?: readonly string[] }) =>
        frozenDeferredEnvelope([], exposure.frozenDeferredToolNames),
    } as never,
    eventSink: {
      assistantMessageCompleted: (_context, event) => {
        if (input.manualOnFinal && event.text === 'completed task') manualPending = true
      },
      compacted: async (_context, event) => {
        compacted.push(event.trigger)
        manualPending = false
      },
    },
    compaction: {
      lifecycle: {
        anchor: () => null,
        pending: () => (manualPending ? { status: 'queued' } : null),
        running: () => ({ signal: new AbortController().signal }),
        finish: () => {
          manualPending = false
        },
        budget: () => {},
      } as never,
      shouldAutoCompact: async () =>
        typeof input.shouldAutoCompact === 'function'
          ? input.shouldAutoCompact()
          : (input.shouldAutoCompact ?? false),
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
      compact: () => active!.compact('manual'),
    },
    request,
    compacted,
    failures,
    session,
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
  test.each([true, false])(
    'checks compaction between tool batches with permission %s',
    async (allowed) => {
      let pending = false
      let continuationContext: Context | undefined
      const setup = await createRuntime({
        responses: [
          () => {
            pending = true
            return fauxAssistantMessage(
              [{ type: 'toolCall', id: 'probe-call', name: 'probe', arguments: {} }],
              { stopReason: 'toolUse' },
            )
          },
          ...(allowed
            ? [
                () => {
                  pending = false
                  return fauxAssistantMessage('mid-task compact summary')
                },
              ]
            : []),
          (context: Context) => {
            continuationContext = context
            return fauxAssistantMessage('continued task')
          },
        ],
        shouldAutoCompact: () => pending,
        toolResult: allowed ? 'x'.repeat(200_000) : 'probe result',
      })
      setup.request.exposedTools = ['probe']
      setup.request.canAutoCompact = () => allowed
      try {
        await expect(setup.runtime.run(setup.request)).resolves.toEqual({
          status: 'completed',
          output: 'continued task',
        })
        expect(setup.compacted).toEqual(allowed ? ['automatic'] : [])
        expect(setup.failures).toEqual([])
        expect(JSON.stringify(continuationContext?.messages)).toContain(
          allowed ? 'mid-task compact summary' : 'probe result',
        )
      } finally {
        await setup.runtime.dispose()
      }
    },
  )

  test('compacts before the first provider request without duplicating the new input', async () => {
    let next: Context | undefined
    const setup = await createRuntime({
      history: 'x'.repeat(200_000),
      shouldAutoCompact: true,
      responses: [
        fauxAssistantMessage('pre-request summary'),
        (context: Context) => {
          next = context
          return fauxAssistantMessage('completed')
        },
      ],
    })
    await expect(setup.runtime.run(setup.request)).resolves.toMatchObject({
      status: 'completed',
      output: 'completed',
    })
    expect(setup.compacted).toEqual(['automatic'])
    expect(
      next?.messages.filter((message) => messageText(message) === setup.request.content),
    ).toHaveLength(1)
    await setup.runtime.dispose()
  })

  test('failed candidate preserves history and blocks the unsafe provider request', async () => {
    const setup = await createRuntime({
      history: 'x'.repeat(200_000),
      shouldAutoCompact: true,
      responses: [
        fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'summary unavailable' }),
      ],
    })
    await expect(setup.runtime.run(setup.request)).rejects.toBeInstanceOf(AgentError)
    expect(setup.compacted).toEqual([])
    expect(setup.failures).toEqual(['automatic'])
    expect((await setup.session.getBranch()).some((entry) => entry.type === 'compaction')).toBe(
      false,
    )
    await setup.runtime.dispose()
  })

  test('queued manual compaction runs after tools and continues the same task', async () => {
    const setup = await createRuntime({
      manualAfterTool: true,
      responses: [
        fauxAssistantMessage([{ type: 'toolCall', id: 'probe', name: 'probe', arguments: {} }], {
          stopReason: 'toolUse',
        }),
        fauxAssistantMessage('manual summary'),
        fauxAssistantMessage('continued task'),
      ],
    })
    setup.request.exposedTools = ['probe']
    await expect(setup.runtime.run(setup.request)).resolves.toMatchObject({
      output: 'continued task',
    })
    expect(setup.compacted).toEqual(['manual'])
    await setup.runtime.dispose()
  })

  test('manual compaction queued during the final response runs at the natural finish boundary', async () => {
    const setup = await createRuntime({
      manualOnFinal: true,
      history: 'previous history',
      responses: [fauxAssistantMessage('completed task'), fauxAssistantMessage('settled summary')],
    })
    try {
      await expect(setup.runtime.run(setup.request)).resolves.toMatchObject({
        output: 'completed task',
      })
      expect(setup.compacted).toEqual(['manual'])
    } finally {
      await setup.runtime.dispose()
    }
  })

  test('two oversized candidates preserve the old history and stop sampling', async () => {
    const setup = await createRuntime({
      history: 'x'.repeat(200_000),
      shouldAutoCompact: true,
      responses: [
        fauxAssistantMessage('oversized summary'.repeat(20_000)),
        fauxAssistantMessage('oversized summary'.repeat(20_000)),
      ],
    })
    try {
      await expect(setup.runtime.run(setup.request)).rejects.toMatchObject({
        code: 'CONTEXT_BUDGET_EXCEEDED',
      })
      expect(setup.compacted).toEqual([])
      expect((await setup.session.getBranch()).some((entry) => entry.type === 'compaction')).toBe(
        false,
      )
      expect(setup.failures).toEqual(['automatic'])
    } finally {
      await setup.runtime.dispose()
    }
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
    expect(userMessages).not.toContain('Continue the previous task')
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
