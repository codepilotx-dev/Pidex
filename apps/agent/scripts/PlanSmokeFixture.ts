import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type Context,
} from '@earendil-works/pi-ai'

export const PLAN_SMOKE_PROVIDER_ID = 'openai'
export const PLAN_SMOKE_TITLE = 'Plan 流程自动化方案'
export const PLAN_SMOKE_STEPS = ['验证计划正文', '验证持久化恢复'] as const

export function initializePlanSmokeDatabase(db: {
  setSetting: (key: string, value: unknown) => void
}): void {
  db.setSetting('defaultModel', {
    providerID: PLAN_SMOKE_PROVIDER_ID,
    id: 'faux-1',
  })
  db.setSetting('desktop.settings.v1', {
    enableFullAccessPermissionMode: true,
    firstUseSetupCompleted: 1,
    permissionConfig: {
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
    },
  })
}

export function createPlanSmokeModels() {
  const faux = fauxProvider({
    provider: PLAN_SMOKE_PROVIDER_ID,
    models: [
      {
        id: 'faux-1',
        input: ['text'],
        contextWindow: 64_000,
        reasoning: true,
      },
    ],
    tokenSize: { min: 1, max: 1 },
  })
  const response = (context: Context) => responseForContext(context)
  faux.setResponses(Array.from({ length: 64 }, () => response))
  const models = createModels()
  models.setProvider(faux.provider)
  return { faux, models, model: faux.getModel() }
}

function responseForContext(context: Context) {
  const latestUserText = [...context.messages].reverse().find((message) => message.role === 'user')
  const userText =
    latestUserText?.role === 'user'
      ? latestUserText.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('\n')
      : ''

  if (userText.includes('Plan 流程自动化测试方案') || userText.includes('只读测试方案')) {
    return fauxAssistantMessage(
      fauxText(
        [
          '以下是测试方案。',
          '<proposed_plan>',
          `# ${PLAN_SMOKE_TITLE}`,
          '',
          `- ${PLAN_SMOKE_STEPS[0]}`,
          `- ${PLAN_SMOKE_STEPS[1]}`,
          '</proposed_plan>',
        ].join('\n'),
      ),
    )
  }

  if (userText.includes('update_plan') || userText.includes('执行两个验证步骤')) {
    const updateResults = context.messages.filter(
      (message) => message.role === 'toolResult' && message.toolName === 'update_plan',
    ).length
    if (updateResults === 0) {
      return fauxAssistantMessage(
        fauxToolCall('update_plan', {
          explanation: '开始执行自动化验证。',
          plan: [
            { step: PLAN_SMOKE_STEPS[0], status: 'in_progress' },
            { step: PLAN_SMOKE_STEPS[1], status: 'pending' },
          ],
        }),
        { stopReason: 'toolUse' },
      )
    }
    if (updateResults === 1) {
      return fauxAssistantMessage(
        fauxToolCall('update_plan', {
          explanation: '自动化验证已经完成。',
          plan: [
            { step: PLAN_SMOKE_STEPS[0], status: 'completed' },
            { step: PLAN_SMOKE_STEPS[1], status: 'completed' },
          ],
        }),
        { stopReason: 'toolUse' },
      )
    }
    return fauxAssistantMessage('两个步骤都已完成。')
  }

  return fauxAssistantMessage([], {
    stopReason: 'error',
    errorMessage: 'Plan smoke fixture ignored background inference',
  })
}
