import { expect, test } from 'bun:test'
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  getCurrentTools,
} from '@earendil-works/pi-ai'
import { DEFAULT_PERMISSION_CONFIG } from '@pidex/shared/thread'
import { InMemorySessionRepo } from '../scripts/support/PiSessionMemory'
import { executeHarnessRun } from '../src/orchestration/pi/ExecuteHarnessRun'
import { ToolExecutor } from '../src/tool/ToolExecutor'
import { ToolRegistry } from '../src/tool/ToolRegistry'

test('Chat 与 Grill 切换时按本轮冻结工具恢复，不沿用历史写入工具或丢失提问工具', async () => {
  const faux = fauxProvider({
    models: [{ id: 'mode-test', input: ['text'], contextWindow: 64_000 }],
  })
  const models = createModels()
  models.setProvider(faux.provider)
  const session = await new InMemorySessionRepo().create({ id: crypto.randomUUID() })
  await session.appendActiveToolsChange(['Write', 'PowerShell', 'update_plan'])
  await session.appendMessage(fauxAssistantMessage(
    '旧会话工具状态：只有 TerminalRead、generate_interactive_ui、task_schedule_view，没有 request_user_input。',
  ))
  const executor = new ToolExecutor(new ToolRegistry())
  for (const taskMode of ['grill', 'chat', 'grill'] as const) {
    let names: string[] = []
    faux.setResponses([
      (context) => {
        names = getCurrentTools(context.messages).map((tool) => tool.name)
        return fauxAssistantMessage('完成')
      },
    ])
    const exposure = executor.exposurePlan({
      taskMode,
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'never',
    })
    if (taskMode === 'grill') {
      expect(exposure.deferred).not.toContain('request_user_input')
      expect(exposure.exposed).toContain('request_user_input')
    }
    await executeHarnessRun(
      {
        harnessFactory: { resolve: async () => ({ models, session }) } as never,
        toolExecutor: executor,
        eventSink: {},
        lifecycle: { requestUserInput: async () => ({}), updatePlan: async () => ({}) },
      },
      {
        threadID: 'mode-thread',
        turnID: crypto.randomUUID(),
        agentID: 'mode-agent',
        sessionID: 'mode-session',
        content: '澄清需求',
        taskMode,
        permissionConfig: { ...DEFAULT_PERMISSION_CONFIG, sandboxMode: 'danger-full-access' },
        signal: new AbortController().signal,
        workspace: {} as never,
        model: faux.getModel(),
        policyModel: { providerID: 'faux', id: 'mode-test' } as never,
        exposedTools: exposure.exposed,
        promptSections: [],
      },
    )
    expect(names.includes('request_user_input')).toBe(taskMode === 'grill')
    expect(names.includes('Write')).toBe(taskMode === 'chat')
    expect(names.includes('PowerShell')).toBe(taskMode === 'chat')
  }
})
