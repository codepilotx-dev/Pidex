import { describe, expect, test } from 'bun:test'
import { InMemorySessionRepo } from '../scripts/support/PiSessionMemory'
import { DEFAULT_PERMISSION_CONFIG } from '@pidex/shared/thread'
import type { ContextUsageBreakdownEntry } from '@pidex/shared/thread'
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type Api,
  type Model as PiModel,
} from '@earendil-works/pi-ai'
import { executeHarnessRun } from '../src/orchestration/pi/ExecuteHarnessRun'
import { frozenDeferredEnvelope } from '../src/tool/ToolExecutor'
import type { HarnessRuntimeOptions, HarnessRuntimeRequest } from '../src/orchestration/pi/Types'

const SYSTEM_CHARS = 200
const SKILL_CHARS = 50
const USER_CHARS = 100

describe('上下文用量度量', () => {
  test('每次 provider 请求前上报按来源实测的字符量', async () => {
    const faux = fauxProvider({
      models: [{ id: 'usage-test', input: ['text'], contextWindow: 64_000 }],
    })
    faux.setResponses([fauxAssistantMessage('完成')])
    const models = createModels()
    models.setProvider(faux.provider)
    const session = await new InMemorySessionRepo().create({ id: crypto.randomUUID() })
    const events: string[] = []

    const runtimeOptions: HarnessRuntimeOptions = {
      harnessFactory: { resolve: async () => ({ models, session }) } as never,
      toolExecutor: {
        deferredDefinitions: (exposure: { frozenDeferredToolNames?: readonly string[] }) =>
          frozenDeferredEnvelope([], exposure.frozenDeferredToolNames),
      } as never,
      eventSink: {
        event: (_context, event) => {
          events.push(event.type)
        },
      },
    }
    const request: HarnessRuntimeRequest = {
      threadID: 'thread-usage',
      turnID: 'turn-usage',
      agentID: 'agent-usage',
      sessionID: 'session-usage',
      content: 'h'.repeat(USER_CHARS),
      taskMode: 'chat',
      permissionConfig: DEFAULT_PERMISSION_CONFIG,
      signal: new AbortController().signal,
      workspace: {} as never,
      model: faux.getModel() as unknown as PiModel<Api>,
      policyModel: { providerID: 'faux', id: 'usage-test' } as never,
      exposedTools: [],
      promptSections: [
        {
          id: 'builtin.identity-security',
          role: 'system',
          cache: 'global-stable',
          authority: 'builtin',
          source: { type: 'builtin', name: 'identity-security' },
          content: 's'.repeat(SYSTEM_CHARS),
        },
        {
          id: 'skills.catalog',
          role: 'contextual-user',
          cache: 'session-stable',
          authority: 'project',
          source: { type: 'runtime', name: 'skills-catalog' },
          content: 'k'.repeat(SKILL_CHARS),
        },
      ],
    }

    const measured: ContextUsageBreakdownEntry[][] = []
    await executeHarnessRun(runtimeOptions, {
      ...request,
      onContextUsageMeasured: (breakdown) => measured.push([...breakdown]),
    })

    expect(measured.length).toBeGreaterThan(0)
    expect(events.filter((type) => type === 'before_provider_request')).toHaveLength(1)
    expect(events).toContain('before_agent_start')
    expect(events).toContain('context')
    expect(events.indexOf('context')).toBeLessThan(events.indexOf('before_provider_request'))
    expect(events.indexOf('before_provider_request')).toBeLessThan(
      events.lastIndexOf('message_end'),
    )
    // Messages 已扣除注入的 context_data 文本，技能段不再被双算；
    // 余下的 2 个字符是 context_data 与用户正文之间的拼接分隔符。
    expect(measured.at(-1)).toEqual([
      { source: 'messages', chars: USER_CHARS + 2 },
      { source: 'system_prompt', chars: SYSTEM_CHARS },
      { source: 'skills', chars: SKILL_CHARS },
    ])
  })
})
