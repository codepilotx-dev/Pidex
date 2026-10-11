import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Context,
} from '@earendil-works/pi-ai'
import { createReviewConcurrencyFileContent } from './ReviewConcurrencyContent'

export const REVIEW_CONCURRENCY_PROVIDER_ID = 'openai'
export const REVIEW_CONCURRENCY_MODEL_ID = 'faux-1'
export const REVIEW_CONCURRENCY_RELEASE_FILE = '.review-concurrency-release'
export const REVIEW_CONCURRENCY_FILES = [
  'src/session-1.ts',
  'src/session-2.ts',
  'src/session-3.ts',
] as const

export function initializeReviewConcurrencyDatabase(db: {
  setSetting: (key: string, value: unknown) => void
}): void {
  db.setSetting('defaultModel', {
    providerID: REVIEW_CONCURRENCY_PROVIDER_ID,
    id: REVIEW_CONCURRENCY_MODEL_ID,
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

export function createReviewConcurrencyModels() {
  const faux = fauxProvider({
    provider: REVIEW_CONCURRENCY_PROVIDER_ID,
    models: [
      {
        id: REVIEW_CONCURRENCY_MODEL_ID,
        input: ['text'],
        contextWindow: 64_000,
        reasoning: true,
      },
    ],
    tokenSize: { min: 1, max: 1 },
  })
  const response = (context: Context) => responseForContext(context)
  faux.setResponses(Array.from({ length: 768 }, () => response))
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
  if (/\[review-history\]/.test(userText)) {
    return fauxAssistantMessage('历史压力回合已完成。')
  }
  const match = /\[review-concurrency:(1|2|3)\]/.exec(userText)
  if (!match) {
    return fauxAssistantMessage([], {
      stopReason: 'error',
      errorMessage: 'Review concurrency fixture ignored background inference',
    })
  }

  const sessionIndex = Number(match[1]) as 1 | 2 | 3
  const filePath = REVIEW_CONCURRENCY_FILES[sessionIndex - 1]
  const toolResults = context.messages.filter((message) => message.role === 'toolResult')

  if (toolResults.length === 0) {
    return fauxAssistantMessage(fauxToolCall('Read', { file_path: filePath }), {
      stopReason: 'toolUse',
    })
  }
  if (toolResults.length === 1) {
    return fauxAssistantMessage(
      fauxToolCall('PowerShell', {
        command: [
          `$release = Join-Path (Get-Location) '${REVIEW_CONCURRENCY_RELEASE_FILE}'`,
          `$target = Join-Path (Get-Location) '${filePath}'`,
          'while (-not (Test-Path -LiteralPath $release)) {',
          '  Start-Sleep -Milliseconds 25',
          '}',
          'for ($pulse = 1; $pulse -le 120; $pulse += 1) {',
          '  Add-Content -LiteralPath $target -Value "// concurrency-pulse-$pulse" -Encoding utf8',
          '  Start-Sleep -Milliseconds 20',
          '}',
          `Add-Content -LiteralPath $target -Value '// updated-by-thread-${sessionIndex}' -Encoding utf8`,
        ].join('\n'),
        timeout: 60_000,
        description: '等待并发 Review 压力测试统一放行',
      }),
      { stopReason: 'toolUse' },
    )
  }
  if (toolResults.length === 2) {
    return fauxAssistantMessage(
      fauxToolCall('Write', {
        file_path: filePath,
        content: createReviewConcurrencyFileContent(sessionIndex, 'updated'),
      }),
      { stopReason: 'toolUse' },
    )
  }

  return fauxAssistantMessage(`会话 ${sessionIndex} 已更新 ${filePath}。`)
}
