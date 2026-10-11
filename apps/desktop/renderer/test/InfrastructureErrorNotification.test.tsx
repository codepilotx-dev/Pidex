import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { toUserErrorMessage } from '../src/utils/Errors.js'
import {
  createTaskSession,
  executeComposerSubmitTransaction,
} from '../src/features/session/composer/ComposerSubmitTransaction.js'
import { ComposerDraftStore } from '../src/features/session/composer/ComposerDraftStore.js'
import { createComposerDocument } from '../src/features/session/composer/ComposerTypes.js'
import type { ComposerDraft } from '../src/features/session/composer/ComposerTypes.js'
import { Command } from 'cmdk'
import { CommandMenuTaskGroup } from '../src/features/search/CommandMenuDialog.js'

describe('toUserErrorMessage sanitization and mapping', () => {
  test('maps internal errors and SQLite errors to safe user message without leaking technical details', () => {
    expect(
      toUserErrorMessage({
        errorCode: 'INTERNAL_ERROR',
        message: 'Agent 内部错误：database locked',
      }),
    ).toBe('Agent 发生内部错误，请重试。')

    expect(toUserErrorMessage({ code: -32603, message: 'Internal JSON-RPC error' })).toBe(
      'Agent 发生内部错误，请重试。',
    )

    expect(
      toUserErrorMessage(
        new Error('SqliteError: no such table: threads at Object.query (db.ts:42)'),
      ),
    ).toBe('Agent 发生内部错误，请重试。')

    expect(
      toUserErrorMessage('SqliteError: constraint failed: UNIQUE constraint failed: threads.id'),
    ).toBe('Agent 发生内部错误，请重试。')
  })

  test('maps agent unavailable and network disconnection errors', () => {
    expect(toUserErrorMessage({ errorCode: 'AGENT_UNAVAILABLE' })).toBe(
      'Agent 暂时不可用，请稍后重试。',
    )

    expect(toUserErrorMessage(new Error('The app-server is unavailable. Please try again.'))).toBe(
      'Agent 暂时不可用，请稍后重试。',
    )

    expect(
      toUserErrorMessage(new Error('fetch failed: connect ECONNREFUSED 127.0.0.1:49999')),
    ).toBe('Agent 暂时不可用，请稍后重试。')

    expect(toUserErrorMessage('无法连接到 Agent sidecar 服务')).toBe(
      'Agent 暂时不可用，请稍后重试。',
    )
  })

  test('maps protocol and capability mismatches to restart/update message', () => {
    expect(
      toUserErrorMessage({
        errorCode: 'CAPABILITY_NOT_FOUND',
        message: 'Capability thread.execution.v2 not found',
      }),
    ).toBe('Agent 版本与桌面端不兼容，请重启或更新应用。')

    expect(toUserErrorMessage({ code: -32601, message: 'Method not found' })).toBe(
      'Agent 版本与桌面端不兼容，请重启或更新应用。',
    )

    expect(toUserErrorMessage(new Error('协议不匹配：Client requires thread-rpc-v4'))).toBe(
      'Agent 版本与桌面端不兼容，请重启或更新应用。',
    )
  })

  test('maps thread loading failures and strips RPC method names', () => {
    expect(toUserErrorMessage({ errorCode: 'THREAD_NOT_FOUND' })).toBe('任务加载失败，请重试。')

    expect(
      toUserErrorMessage(new Error('RPC method thread/list failed to respond'), 'thread-read'),
    ).toBe('任务加载失败，请重试。')

    expect(
      toUserErrorMessage(new Error('Failed to read thread snapshot: thread/read'), 'thread-read'),
    ).toBe('任务加载失败，请重试。')
  })

  test('strips RPC methods and stack traces from unknown technical errors', () => {
    const errorWithStack = `Error: RPC call turn/start failed\n    at Object.call (rpc.ts:120)\n    at Object.send (turn.ts:50)`
    expect(toUserErrorMessage(errorWithStack)).toBe('发送失败，请重试。')

    const projectListError = `Error: project/list encountered an issue`
    expect(toUserErrorMessage(projectListError, 'project-list')).toBe('项目加载失败，请重试。')
  })
})

describe('initialization error deduplication', () => {
  test('deduplicates simultaneous project/list and thread/list errors sharing the same root cause within 1000ms', () => {
    const notifications: string[] = []
    let lastError: { message: string; timestamp: number } | null = null

    const handleErrorMessage = (raw: unknown, now: number): void => {
      const message = toUserErrorMessage(raw)
      if (lastError && lastError.message === message && now - lastError.timestamp < 1000) {
        return
      }
      lastError = { message, timestamp: now }
      notifications.push(message)
    }

    // Agent down error simultaneously encountered by project/list and thread/list at t = 100ms
    const t0 = 100
    const projectError = new Error('fetch failed: connect ECONNREFUSED 127.0.0.1:49999')
    const threadError = new Error('The app-server is unavailable. Please try again.')

    handleErrorMessage(projectError, t0)
    handleErrorMessage(threadError, t0 + 20)

    // Merged to a single user notification
    expect(notifications).toEqual(['Agent 暂时不可用，请稍后重试。'])

    // Later at t = 2000ms (outside 1000ms window), another error occurs
    handleErrorMessage(threadError, t0 + 1900)
    expect(notifications).toEqual([
      'Agent 暂时不可用，请稍后重试。',
      'Agent 暂时不可用，请稍后重试。',
    ])
  })

  test('deduplicates simultaneous internal errors between project/list and thread/list', () => {
    const notifications: string[] = []
    let lastError: { message: string; timestamp: number } | null = null

    const handleErrorMessage = (raw: unknown, now: number): void => {
      const message = toUserErrorMessage(raw)
      if (lastError && lastError.message === message && now - lastError.timestamp < 1000) {
        return
      }
      lastError = { message, timestamp: now }
      notifications.push(message)
    }

    const t0 = 500
    handleErrorMessage({ errorCode: 'INTERNAL_ERROR', message: 'SqliteError: database locked' }, t0)
    handleErrorMessage({ errorCode: 'INTERNAL_ERROR', message: 'Agent 内部错误' }, t0 + 50)

    expect(notifications).toEqual(['Agent 发生内部错误，请重试。'])
  })
})

describe('background reconciliation error throttling and recovery', () => {
  test('notifies on first background reconciliation failure, suppresses consecutive failures, and recovers on success', () => {
    const errorNotifications: string[] = []
    let backgroundReconcileFailed = false

    const notifyReconciliationError = (error: unknown): void => {
      if (backgroundReconcileFailed) return
      backgroundReconcileFailed = true
      errorNotifications.push(toUserErrorMessage(error, 'thread-read'))
    }

    const notifyReconciliationSuccess = (): void => {
      backgroundReconcileFailed = false
    }

    // 1. First failure
    notifyReconciliationError(new Error('thread/list failed'))
    expect(errorNotifications).toEqual(['任务加载失败，请重试。'])

    // 2. Second and third consecutive failures (throttled)
    notifyReconciliationError(new Error('thread/list timeout'))
    notifyReconciliationError(new Error('thread/list network reset'))
    expect(errorNotifications).toHaveLength(1)

    // 3. Background reconciliation succeeds
    notifyReconciliationSuccess()
    expect(backgroundReconcileFailed).toBe(false)

    // 4. Subsequent failure after recovery notifies again
    notifyReconciliationError(new Error('thread/list connection dropped'))
    expect(errorNotifications).toEqual(['任务加载失败，请重试。', '任务加载失败，请重试。'])
  })
})

describe('composer failure handling and draft preservation', () => {
  test('send failure reports via global onError and retains draft and attachments', async () => {
    let nextId = 0
    const store = new ComposerDraftStore(() => `draft-${++nextId}`)
    const draftContent: ComposerDraft = {
      clientId: 'draft-original',
      document: createComposerDocument('重要待发送提示词'),
      attachments: [
        {
          id: 'att-1',
          name: 'report.txt',
          mimeType: 'text/plain',
          size: 1024,
          path: '/tmp/report.txt',
          status: 'ready',
        },
      ],
      collaborationMode: 'default',
    }
    store.set('home', draftContent)

    const errors: string[] = []
    const onError = (msg: string): void => {
      errors.push(msg)
    }

    // Send fails with internal error
    const outcome = await executeComposerSubmitTransaction({
      draft: store.get('home'),
      targetSessionId: 'session-123',
      submitToSession: async () => {
        throw new Error('Agent 内部错误：RPC turn/start failed')
      },
    })

    expect(outcome.status).toBe('failed')
    expect(outcome.phase).toBe('send')

    // Propagate send failure to global onError
    if (outcome.phase === 'send') {
      onError(outcome.message)
    }

    // Global error notified with sanitized user message
    expect(errors).toEqual(['Agent 发生内部错误，请重试。'])

    // Draft in store is preserved and not cleared
    const preservedDraft = store.get('home')
    expect(preservedDraft.document.text).toBe('重要待发送提示词')
    expect(preservedDraft.attachments).toHaveLength(1)
    expect(preservedDraft.attachments[0].name).toBe('report.txt')
  })

  test('task creation failure reports via global onError and retains draft', async () => {
    const notices: string[] = []
    await expect(
      createTaskSession({
        onError: (msg) => notices.push(msg),
        create: async () => {
          throw new Error('thread/create failed with internal error')
        },
      }),
    ).rejects.toBeDefined()

    expect(notices).toEqual(['无法创建任务，请重试或选择本地目录。'])
  })
})

describe('UI surfaces do not leak technical or catalog errors inline', () => {
  test('CommandMenuTaskGroup renders normal empty state and does not show inline catalog error when unavailable', () => {
    const markup = renderToStaticMarkup(
      <Command>
        <CommandMenuTaskGroup
          catalogStatus={{ state: 'unavailable' }}
          query=""
          tasks={[]}
          onSelectTask={() => {}}
        />
      </Command>,
    )

    expect(markup).not.toContain('任务目录暂不可用')
    expect(markup).not.toContain('The app-server is unavailable')
    expect(markup).not.toContain('Agent 内部错误')
    expect(markup).not.toContain('thread/list')
    expect(markup).toContain('暂无任务')
  })

  test('CommandMenuTaskGroup renders cached tasks even when catalogStatus is unavailable', () => {
    const markup = renderToStaticMarkup(
      <Command>
        <CommandMenuTaskGroup
          catalogStatus={{ state: 'unavailable' }}
          query=""
          tasks={[
            {
              id: 'task-1',
              title: '重构全局错误提示',
              workspaceName: 'Pidex',
              shortcutLabel: '1',
              visualState: 'idle',
            },
          ]}
          onSelectTask={() => {}}
        />
      </Command>,
    )

    expect(markup).not.toContain('任务目录暂不可用')
    expect(markup).toContain('重构全局错误提示')
  })
})
