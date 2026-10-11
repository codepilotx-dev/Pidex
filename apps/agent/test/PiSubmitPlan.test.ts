import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { InMemorySessionRepo } from '../scripts/support/PiSessionMemory'
import { DEFAULT_PERMISSION_CONFIG, type StructuredPlan } from '@pidex/shared/thread'
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Api,
  type JsonObject,
  type Model as PiModel,
  type Models,
} from '@earendil-works/pi-ai'
import { executeHarnessRun } from '../src/orchestration/pi/ExecuteHarnessRun'
import { AgentRuntimeService } from '../src/orchestration/AgentRuntimeService'
import { frozenDeferredEnvelope } from '../src/tool/ToolExecutor'
import {
  parseStructuredPlan,
  structuredPlanDomainFields,
  structuredPlanParameters,
} from '../src/orchestration/plan/StructuredPlan'
import type {
  ActiveHarness,
  HarnessRuntimeOptions,
  HarnessRuntimeRequest,
  PiToolCompletionMetadata,
} from '../src/orchestration/pi/Types'

const validPlan = (overrides: JsonObject = {}): JsonObject => ({
  title: '结构化计划交付',
  summary: '把最终方案从标签解析升级为 submit_plan 结构化提交。',
  changes: [{ area: '共享契约', items: ['新增 StructuredPlanSchema'] }],
  interfaceChanges: ['新增 plan.structured.v1 capability'],
  tests: ['Agent 聚焦测试'],
  assumptions: [],
  ...overrides,
})

const planMarkdown = (plan: StructuredPlan): string =>
  [
    `# ${plan.title}`,
    '',
    plan.summary,
    '',
    '## 实现变更',
    `### ${plan.changes[0]!.area}`,
    `- ${plan.changes[0]!.items[0]}`,
    '',
    '## 接口变化',
    `- ${plan.interfaceChanges[0]}`,
    '',
    '## 测试',
    `- ${plan.tests[0]}`,
  ].join('\n')

type RuntimeCapture = {
  planStarted: number
  planDeltas: string[]
  completedPlans: Array<string | null | undefined>
}

async function createRuntime(input: {
  responses: Parameters<ReturnType<typeof fauxProvider>['setResponses']>[0]
  lifecycle?: HarnessRuntimeOptions['lifecycle']
  exposedTools?: readonly string[]
  taskMode?: 'plan' | 'chat'
  onActivated?: (active: ActiveHarness) => void
}) {
  const faux = fauxProvider({
    models: [{ id: 'submit-plan-test', input: ['text'], contextWindow: 64_000 }],
  })
  faux.setResponses(input.responses)
  const models = createModels()
  models.setProvider(faux.provider)
  const repo = new InMemorySessionRepo()
  const sessionID = crypto.randomUUID()
  const session = await repo.create({ id: sessionID })
  const finished: Array<{ tool: string; result: string; isError: boolean }> = []
  const capture: RuntimeCapture = { planStarted: 0, planDeltas: [], completedPlans: [] }
  let active: ActiveHarness | undefined
  const runtimeOptions: HarnessRuntimeOptions = {
    activated: (_threadID, value) => {
      active = value
      input.onActivated?.(value)
    },
    harnessFactory: { resolve: async () => ({ models, session }) },
    toolExecutor: {
      deferredDefinitions: (exposure: { frozenDeferredToolNames?: readonly string[] }) =>
        frozenDeferredEnvelope([], exposure.frozenDeferredToolNames),
    } as never,
    eventSink: {
      toolFinished: async (_context, event) => {
        finished.push({ tool: event.tool, result: event.result, isError: event.isError })
      },
      planStarted: async () => {
        capture.planStarted += 1
      },
      planDelta: async (_context, event) => {
        capture.planDeltas.push(event.delta)
      },
      assistantMessageCompleted: async (
        _context,
        event: { plan?: string | null; completion?: PiToolCompletionMetadata },
      ) => {
        capture.completedPlans.push(event.plan)
      },
      settled: async () => undefined,
    },
    ...(input.lifecycle ? { lifecycle: input.lifecycle } : {}),
  }
  const request: HarnessRuntimeRequest = {
    threadID: 'thread-submit-plan',
    turnID: 'turn-submit-plan',
    agentID: 'agent-submit-plan',
    sessionID,
    content: '调查并制定计划',
    taskMode: input.taskMode ?? 'plan',
    permissionConfig: DEFAULT_PERMISSION_CONFIG,
    signal: new AbortController().signal,
    workspace: {} as never,
    model: faux.getModel(),
    policyModel: { providerID: 'faux', id: 'submit-plan-test' } as never,
    exposedTools: input.exposedTools ?? ['submit_plan'],
    promptSections: [
      {
        id: 'test-system',
        role: 'system',
        cache: 'global-stable',
        authority: 'builtin',
        source: { type: 'builtin', name: 'test' },
        content: 'submit plan test',
      },
    ],
  }
  return {
    runtime: {
      run: (value: HarnessRuntimeRequest) => executeHarnessRun(runtimeOptions, value),
      dispose: () => active?.harness.abort() ?? Promise.resolve(),
    },
    request,
    finished,
    capture,
    models,
    faux,
  }
}

describe('structured plan module', () => {
  test('长度与列表上限告知模型，报错包含字段和上限但不泄露值', () => {
    const schema = structuredPlanParameters
    expect(Reflect.get(schema.properties.summary, 'maxLength')).toBe(4000)
    expect(Reflect.get(schema.properties.changes, 'maxItems')).toBe(20)
    const group = schema.properties.changes.items
    expect(Reflect.get(group.properties.items, 'maxItems')).toBe(50)
    expect(Reflect.get(group, 'additionalProperties')).toBe(false)
    try {
      parseStructuredPlan(validPlan({ summary: 'sk-sensitive-value'.repeat(300) }))
      throw new Error('should reject')
    } catch (error) {
      expect(String(error)).toContain('summary')
      expect(String(error)).toContain('4000')
      expect(String(error)).not.toContain('sk-sensitive-value')
    }
  })
  test('模型可见参数 schema 覆盖共享领域全部字段', () => {
    const exposed = Object.keys(
      (structuredPlanParameters as { properties?: Record<string, unknown> }).properties ?? {},
    ).sort()
    expect(exposed).toEqual(structuredPlanDomainFields)
  })

  test('缺字段、空字符串和额外字段都被拒绝且不回显字段值', () => {
    const missing = validPlan()
    delete (missing as Record<string, unknown>).changes
    for (const invalid of [
      missing,
      validPlan({ title: '   ' }),
      validPlan({ changes: [{ area: '共享契约', items: [] }] }),
      { ...validPlan(), extra: 'sk-sensitive-value' },
    ]) {
      try {
        parseStructuredPlan(invalid)
        throw new Error('expected parseStructuredPlan to reject')
      } catch (error) {
        expect(String(error)).toContain('结构化计划参数无效')
        expect(String(error)).not.toContain('sk-sensitive-value')
      }
    }
    expect(parseStructuredPlan(validPlan()).changes).toHaveLength(1)
  })
})

describe('submit_plan runtime delivery', () => {
  test('合法独立提交结束循环并把校验后的方案交给宿主，不产生标签计划', async () => {
    const hostInputs: Array<{ plan: StructuredPlan; id: string }> = []
    const setup = await createRuntime({
      responses: [
        fauxAssistantMessage(fauxToolCall('submit_plan', validPlan()), { stopReason: 'toolUse' }),
      ],
      lifecycle: {
        submitPlan: async (plan: StructuredPlan, id: string) => {
          hostInputs.push({ plan, id })
          return { status: 'submitted' }
        },
      },
    })
    const result = await setup.runtime.run(setup.request)
    expect(result.status).toBe('completed')
    expect(hostInputs).toHaveLength(1)
    expect(hostInputs[0]!.id).toBeTypeOf('string')
    expect(hostInputs[0]!.plan).toEqual(parseStructuredPlan(validPlan()))
    const submitted = setup.finished.filter((entry) => entry.tool === 'submit_plan')
    expect(submitted).toHaveLength(1)
    expect(submitted[0]!.isError).toBe(false)
    expect(setup.capture.planStarted).toBe(0)
    expect(setup.capture.planDeltas).toEqual([])
    expect(setup.capture.completedPlans).toEqual([null])
    await setup.runtime.dispose()
  })

  test('非法提交返回工具错误，模型修正后可提交成功', async () => {
    const hostInputs: StructuredPlan[] = []
    const setup = await createRuntime({
      responses: [
        fauxAssistantMessage(fauxToolCall('submit_plan', { title: '缺字段' }), {
          stopReason: 'toolUse',
        }),
        fauxAssistantMessage(fauxToolCall('submit_plan', validPlan()), { stopReason: 'toolUse' }),
      ],
      lifecycle: {
        submitPlan: async (plan: StructuredPlan) => {
          hostInputs.push(plan)
          return { status: 'submitted' }
        },
      },
    })
    const result = await setup.runtime.run(setup.request)
    expect(result.status).toBe('completed')
    const submitted = setup.finished.filter((entry) => entry.tool === 'submit_plan')
    expect(submitted).toHaveLength(2)
    expect(submitted[0]!.isError).toBe(true)
    expect(submitted[0]!.result).toContain('submit_plan')
    expect(submitted[1]!.isError).toBe(false)
    expect(hostInputs).toHaveLength(1)
    await setup.runtime.dispose()
  })

  test('额外字段在运行时被拒绝且不结束循环', async () => {
    const hostInputs: StructuredPlan[] = []
    const setup = await createRuntime({
      responses: [
        fauxAssistantMessage(fauxToolCall('submit_plan', validPlan({ extra: 'forged' })), {
          stopReason: 'toolUse',
        }),
        fauxAssistantMessage(fauxToolCall('submit_plan', validPlan()), { stopReason: 'toolUse' }),
      ],
      lifecycle: {
        submitPlan: async (plan: StructuredPlan) => {
          hostInputs.push(plan)
          return { status: 'submitted' }
        },
      },
    })
    const result = await setup.runtime.run(setup.request)
    expect(result.status).toBe('completed')
    const submitted = setup.finished.filter((entry) => entry.tool === 'submit_plan')
    expect(submitted).toHaveLength(2)
    expect(submitted[0]!.isError).toBe(true)
    expect(submitted[1]!.isError).toBe(false)
    expect(hostInputs).toHaveLength(1)
    expect(Object.keys(hostInputs[0]!).sort()).toEqual(structuredPlanDomainFields)
    await setup.runtime.dispose()
  })

  test('与其他工具混在同一条回复时被拒绝，其他工具正常执行', async () => {
    const hostInputs: StructuredPlan[] = []
    let skillCalls = 0
    const setup = await createRuntime({
      exposedTools: ['skill_list', 'submit_plan'],
      responses: [
        fauxAssistantMessage(
          [fauxToolCall('skill_list', {}), fauxToolCall('submit_plan', validPlan())],
          { stopReason: 'toolUse' },
        ),
        fauxAssistantMessage(fauxToolCall('submit_plan', validPlan()), { stopReason: 'toolUse' }),
      ],
      lifecycle: {
        skillList: async () => {
          skillCalls += 1
          return []
        },
        submitPlan: async (plan: StructuredPlan) => {
          hostInputs.push(plan)
          return { status: 'submitted' }
        },
      },
    })
    const result = await setup.runtime.run(setup.request)
    expect(result.status).toBe('completed')
    expect(skillCalls).toBe(1)
    const submitted = setup.finished.filter((entry) => entry.tool === 'submit_plan')
    expect(submitted).toHaveLength(2)
    expect(submitted[0]!.isError).toBe(true)
    expect(submitted[0]!.result).toContain('唯一的工具调用')
    expect(submitted[1]!.isError).toBe(false)
    expect(hostInputs).toHaveLength(1)
    await setup.runtime.dispose()
  })

  test('同一条回复里的标签计划被忽略，只保留结构化提交', async () => {
    const hostInputs: StructuredPlan[] = []
    const setup = await createRuntime({
      responses: [
        fauxAssistantMessage(
          [
            {
              type: 'text',
              text: '<proposed_plan>\n# 旧标签方案\n</proposed_plan>\n',
            },
            fauxToolCall('submit_plan', validPlan()),
          ] as never,
          { stopReason: 'toolUse' },
        ),
      ],
      lifecycle: {
        submitPlan: async (plan: StructuredPlan) => {
          hostInputs.push(plan)
          return { status: 'submitted' }
        },
      },
    })
    const result = await setup.runtime.run(setup.request)
    expect(result.status).toBe('completed')
    expect(hostInputs).toHaveLength(1)
    expect(setup.capture.planStarted).toBe(0)
    expect(setup.capture.planDeltas).toEqual([])
    expect(setup.capture.completedPlans).toEqual([null])
    await setup.runtime.dispose()
  })

  test('未调用 submit_plan 时标签计划继续作为兼容回退', async () => {
    const setup = await createRuntime({
      responses: [fauxAssistantMessage('<proposed_plan>\n# 旧标签方案\n</proposed_plan>')],
      lifecycle: { submitPlan: async () => ({ status: 'submitted' }) },
    })
    const result = await setup.runtime.run(setup.request)
    expect(result.status).toBe('completed')
    expect(setup.capture.planStarted).toBe(1)
    expect(setup.capture.planDeltas.join('')).toContain('# 旧标签方案')
    expect(setup.capture.completedPlans).toEqual(['# 旧标签方案'])
    await setup.runtime.dispose()
  })
})

describe('submit_plan persistence', () => {
  test('以确定性的单条 plan item 持久化结构化方案与派生 Markdown', async () => {
    const items = new Map<string, Record<string, unknown>>()
    const events: Array<{ method: string; params: unknown }> = []
    const db = {
      getItem: (id: string) => items.get(id) ?? null,
      upsertItemWithEvent: (threadID: string, item: Record<string, unknown>, method: string) => {
        const stored = { ...item, ordinal: items.size }
        items.set(item.id as string, stored)
        const event = {
          id: events.length + 1,
          threadID,
          turnID: item.turnID,
          method,
          params: { item: stored },
        }
        events.push({ method, params: event.params })
        return { item: stored, event }
      },
    }
    const service = new AgentRuntimeService({
      db: db as never,
      hub: { publish: () => Effect.void } as never,
      models: {} as never,
      toolExecutor: {} as never,
      contextCompaction: {} as never,
    })
    const persist = (
      service as unknown as {
        persistStructuredPlan(input: {
          threadID: string
          turnID: string
          agentID: string
          plan: StructuredPlan
        }): Promise<{ status: string; itemID: string }>
      }
    ).persistStructuredPlan.bind(service)

    const plan = parseStructuredPlan(validPlan())
    const first = await persist({
      threadID: 'thread-1',
      turnID: 'turn-1',
      agentID: 'agent-1',
      plan,
    })
    const second = await persist({
      threadID: 'thread-1',
      turnID: 'turn-1',
      agentID: 'agent-1',
      plan,
    })

    expect(first.itemID).toBe('turn-1:plan')
    expect(second.itemID).toBe(first.itemID)
    expect(items.size).toBe(1)
    expect(events.map((event) => event.method)).toEqual(['item/completed', 'item/completed'])
    expect(items.get('turn-1:plan')).toMatchObject({
      id: 'turn-1:plan',
      type: 'plan',
      status: 'completed',
      data: {
        title: plan.title,
        markdown: planMarkdown(plan),
        structured: plan,
      },
    })
  })
})
