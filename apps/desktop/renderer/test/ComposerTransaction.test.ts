import { describe, expect, test } from 'bun:test'
import {
  buildDesktopUserMessageContent,
  desktopUserMessageInputToPreviewText,
} from '../shared/DesktopUserMessage.js'
import { ComposerDraftStore } from '../src/features/session/composer/ComposerDraftStore.js'
import {
  executeComposerSubmitTransaction,
  prepareComposerSubmission,
  serializeComposerDocument,
} from '../src/features/session/composer/ComposerSubmitTransaction.js'
import type { ComposerDraft } from '../src/features/session/composer/ComposerTypes.js'
import {
  createComposerDocument,
  isInlineComposerFailure,
} from '../src/features/session/composer/ComposerTypes.js'

function draft(overrides: Partial<ComposerDraft> = {}): ComposerDraft {
  return {
    clientId: 'draft-1',
    document: createComposerDocument('检查当前改动'),
    attachments: [],
    collaborationMode: 'default',
    ...overrides,
  }
}

describe('composer submit transaction', () => {
  test('引用保留正文位置与同位置顺序，计划前缀移除不修改源草稿', () => {
    const source = draft({
      document: {
        text: '/plan 前中后',
        tokens: [
          { id: 'a', kind: 'plugin', label: 'A', value: 'plugin://a', from: 7, to: 7 },
          { id: 'b', kind: 'browser', label: 'B', value: 'https://b', from: 7, to: 7 },
          { id: 'c', kind: 'thread', label: 'C', value: 'pidex://threads/c', from: 9, to: 9 },
        ],
      },
    })
    const prepared = prepareComposerSubmission(source)
    expect('input' in prepared && prepared.input.text).toBe(
      '前[@A](plugin://a)[B](<https://b>)中后[C](<pidex://threads/c>)',
    )
    expect(source.document.tokens[0]?.from).toBe(7)
    expect(
      serializeComposerDocument({
        text: '前后',
        tokens: [{ ...source.document.tokens[0]!, from: 0, to: 0 }],
      }),
    ).toBe('[@A](plugin://a)前后')
  })
  test('异步创建期间修改原草稿不改变已冻结的 Goal 和模式', async () => {
    const source = draft({ goalModeEnabled: true })
    await executeComposerSubmitTransaction({
      draft: source,
      createSession: async () => {
        source.goalModeEnabled = false
        source.document.text = '后来编辑的正文'
        return 'new'
      },
      submitToSession: async (_id, input, metadata) => {
        expect(input.taskMode).toBe('chat')
        expect(metadata.goal?.objective).toBe('检查当前改动')
      },
    })
    const planned = prepareComposerSubmission(draft({ collaborationMode: 'plan' }))
    expect('input' in planned && planned.input.taskMode).toBe('plan')
  })
  test.each(['default', 'plan'] as const)(
    '/plan 正文以显式 Plan 提交并保留失败草稿，原模式=%s',
    async (collaborationMode) => {
      const source = draft({
        document: createComposerDocument('/plan 设计权限系统\n保留现有数据'),
        collaborationMode,
        goalModeEnabled: true,
      })
      const calls: unknown[] = []
      const result = await executeComposerSubmitTransaction({
        draft: source,
        targetSessionId: 'thread',
        submitToSession: async (_id, input, metadata) => {
          calls.push({ input, metadata })
          throw new Error('发送失败')
        },
      })
      expect(calls).toEqual([
        {
          input: { text: '设计权限系统\n保留现有数据', attachments: [], taskMode: 'plan' },
          metadata: { inputId: source.clientId },
        },
      ])
      expect(result.status).toBe('failed')
      expect(source.document.text).toBe('/plan 设计权限系统\n保留现有数据')
    },
  )
  test('serializes plugin-only references with stable identity and preserves stale drafts', () => {
    const store = new ComposerDraftStore(() => 'plugin-draft')
    store.update('home', (current) => ({
      ...current,
      document: {
        text: '',
        tokens: [
          {
            id: 'plugin:computer-use',
            kind: 'plugin',
            label: '电脑[控制]',
            value: 'plugin://computer-use',
            from: 0,
            to: 0,
          },
        ],
      },
    }))
    const prepared = prepareComposerSubmission(store.get('home'))
    expect('input' in prepared && prepared.input.text).toBe(
      '[@电脑\\[控制\\]](plugin://computer-use)',
    )
    expect(store.get('home').document.tokens[0]?.kind).toBe('plugin')
  })
  test.each([false, true])('Goal 首轮完整提交，new-session=%s', async (isNew) => {
    const source = draft({
      goalModeEnabled: true,
      skills: [{ name: 'repair', path: 'skills/repair' }],
      attachments: [
        {
          id: 'attachment-1',
          name: 'context.txt',
          mimeType: 'text/plain',
          sizeBytes: 4,
          kind: 'text',
          status: 'ready',
        },
      ],
    })
    const calls: Array<unknown> = []
    const outcome = await executeComposerSubmitTransaction({
      draft: source,
      targetSessionId: isNew ? null : 'session:existing',
      createSession: async () => 'session:new',
      submitToSession: async (sessionId, input, metadata) => {
        calls.push({ sessionId, input, metadata })
        return 'sent'
      },
    })
    expect(outcome.status).toBe('sent')
    expect(calls).toEqual([
      {
        sessionId: isNew ? 'session:new' : 'session:existing',
        input: {
          text: source.document.text,
          taskMode: 'chat',
          attachments: source.attachments,
          skills: source.skills,
        },
        metadata: { inputId: 'draft-1', goal: { objective: source.document.text } },
      },
    ])
  })
  test('Goal 草稿迁移后失败保持目标输入状态与提交身份，空目标不创建聊天', async () => {
    const store = new ComposerDraftStore(() => 'draft:next')
    store.set(
      'home',
      draft({ goalModeEnabled: true, skills: [{ name: 'repair', path: 'skills/repair' }] }),
    )
    await executeComposerSubmitTransaction({
      draft: store.get('home'),
      createSession: async () => 'new',
      navigateToSession: () => {
        store.handoff('home', 'session:new')
      },
      submitToSession: async () => {
        throw new Error('冲突')
      },
    })
    expect(store.get('session:new')).toMatchObject({
      clientId: 'draft-1',
      goalModeEnabled: true,
      skills: [{ name: 'repair', path: 'skills/repair' }],
    })
    expect(store.get('home').goalModeEnabled).toBeUndefined()
    let created = false
    const empty = await executeComposerSubmitTransaction({
      draft: draft({
        goalModeEnabled: true,
        document: createComposerDocument(''),
        skills: [{ name: 'repair', path: 'skills/repair' }],
      }),
      createSession: async () => {
        created = true
        return 'unexpected'
      },
      submitToSession: async () => 'sent',
    })
    expect(empty).toMatchObject({ status: 'failed', phase: 'prepare', message: '请输入目标内容' })
    expect(created).toBeFalse()
  })
  test('连续选择与发送后再次选择从当前草稿追加，提交保留全部 Skill', () => {
    const store = new ComposerDraftStore(() => 'draft-1')
    const review = { name: 'review', path: 'skills/review' }
    const plan = { name: 'plan', path: 'skills/plan' }
    store.addSkill('session:test', review)
    store.addSkill('session:test', plan)
    store.addSkill('session:test', review)
    expect(prepareComposerSubmission(store.get('session:test'))).toMatchObject({
      input: { skills: [review, plan] },
    })
    store.completeSubmission('session:test', 'draft-1', { clearContent: true })
    store.addSkill('session:test', review)
    store.addSkill('session:test', plan)
    expect(prepareComposerSubmission(store.get('session:test'))).toMatchObject({
      input: { skills: [review, plan] },
    })
  })
  test('hands off a HOME draft and atomically rotates the source id', () => {
    let nextId = 0
    const store = new ComposerDraftStore(() => `draft-${++nextId}`)
    store.update('home', (current) => ({
      ...current,
      document: createComposerDocument('首页草稿'),
    }))

    const handoff = store.handoff('home', 'session:created')
    expect(handoff?.submitted.clientId).toBe('draft-1')
    expect(handoff?.submitted.document.text).toBe('首页草稿')
    expect(handoff?.replacement.clientId).toBe('draft-2')
    expect(handoff?.replacement.document.text).toBe('')
    expect(store.get('session:created').clientId).toBe('draft-1')
    expect(store.get('home').clientId).toBe('draft-2')
    expect(store.get('home').document.text).toBe('')
  })

  test('does not restore a consumed id when the old route syncs after handoff', async () => {
    let nextId = 0
    const store = new ComposerDraftStore(() => `draft-${++nextId}`)
    store.update('home', (current) => ({
      ...current,
      document: createComposerDocument('第一条消息'),
    }))
    const firstDraft = store.get('home')
    const submittedIds: string[] = []

    await executeComposerSubmitTransaction({
      draft: firstDraft,
      createSession: async () => 'session-1',
      navigateToSession: (sessionId) => {
        const handoff = store.handoff('home', `session:${sessionId}`)
        expect(handoff?.replacement.clientId).toBe('draft-2')
        store.update('home', (current) => ({
          ...current,
          clientId: handoff?.replacement.clientId ?? current.clientId,
          document: createComposerDocument('路由切换期间的旧页面回写'),
        }))
      },
      submitToSession: async (_sessionId, _input, metadata) => {
        submittedIds.push(metadata.inputId)
        return 'sent'
      },
    })

    const replacementDraft = store.get('home')
    expect(store.get('session:session-1').clientId).toBe('draft-1')
    expect(replacementDraft.clientId).toBe('draft-2')
    expect(replacementDraft.clientId).not.toBe(firstDraft.clientId)

    await executeComposerSubmitTransaction({
      draft: replacementDraft,
      targetSessionId: 'session-2',
      submitToSession: async (_sessionId, _input, metadata) => {
        submittedIds.push(metadata.inputId)
        return 'sent'
      },
    })

    expect(submittedIds).toEqual(['draft-1', 'draft-2'])
  })

  test('notifies the routed composer when a submitted id is consumed', () => {
    let nextId = 0
    const store = new ComposerDraftStore(() => `draft-${++nextId}`)
    store.update('home', (current) => ({
      ...current,
      document: createComposerDocument('第一条消息'),
    }))
    store.handoff('home', 'session:created')
    let mountedClientId = store.get('session:created').clientId
    const unsubscribe = store.subscribe(() => {
      mountedClientId = store.get('session:created').clientId
    })

    const completed = store.completeSubmission('session:created', 'draft-1', { clearContent: true })

    expect(completed.clientId).toBe('draft-3')
    expect(completed.document.text).toBe('')
    expect(mountedClientId).toBe('draft-3')
    unsubscribe()
  })

  test('rotates the consumed id without clearing edits made during submission', () => {
    let nextId = 0
    const store = new ComposerDraftStore(() => `draft-${++nextId}`)
    const initial = store.get('session:active')
    store.set('session:active', {
      ...initial,
      document: createComposerDocument('第二条消息'),
      attachments: [
        {
          id: 'attachment-1',
          name: 'notes.txt',
          path: 'notes.txt',
          mediaType: 'text/plain',
          sizeBytes: 5,
          kind: 'text',
          status: 'ready',
        },
      ],
      skillInvocation: { name: 'review', path: 'skills/review' },
    })

    const completed = store.completeSubmission('session:active', initial.clientId, {
      clearContent: false,
    })

    expect(completed.clientId).toBe('draft-2')
    expect(completed.document.text).toBe('第二条消息')
    expect(completed.attachments.map((item) => item.id)).toEqual(['attachment-1'])
    expect(completed.skillInvocation?.name).toBe('review')
  })

  test('keeps failed submission ids retryable and only prepares errors inline', () => {
    const store = new ComposerDraftStore(() => 'draft-1')
    const failedDraft = store.get('session:active')

    expect(store.get('session:active').clientId).toBe(failedDraft.clientId)
    expect(
      isInlineComposerFailure({
        status: 'failed',
        phase: 'prepare',
        message: '附件不可用',
      }),
    ).toBe(true)
    expect(
      isInlineComposerFailure({
        status: 'failed',
        phase: 'create',
        message: '创建失败',
      }),
    ).toBe(false)
    expect(
      isInlineComposerFailure({
        status: 'failed',
        phase: 'send',
        message: '发送失败',
        sessionId: 'session:active',
      }),
    ).toBe(false)
  })

  test('publishes an externally selected skill invocation to the active composer', () => {
    const store = new ComposerDraftStore(() => 'draft-1')
    let updates = 0
    const unsubscribe = store.subscribe(() => {
      updates += 1
    })

    store.setSkillInvocation('home', {
      name: 'review',
      path: 'skills/review/SKILL.md',
    })

    expect(store.get('home').skillInvocation).toEqual({
      name: 'review',
      path: 'skills/review/SKILL.md',
    })
    expect(updates).toBe(1)
    unsubscribe()
  })

  test('prepares a structured skill invocation without rewriting text', () => {
    const prepared = prepareComposerSubmission(
      draft({ skillInvocation: { name: 'review', path: 'skills/review' } }),
    )

    expect('input' in prepared && prepared.input).toEqual({
      text: '检查当前改动',
      taskMode: 'chat',
      attachments: [],
      skills: [{ name: 'review', path: 'skills/review' }],
    })
  })

  test('serializes skill submissions with the canonical $name prefix only', () => {
    const input = {
      text: '检查当前改动',
      attachments: [],
      skillInvocation: {
        name: 'review',
        skillPath: 'F:\\skills\\review\\SKILL.md',
      },
    }

    expect(desktopUserMessageInputToPreviewText(input)).toBe('$review\n\n检查当前改动')
    expect(buildDesktopUserMessageContent(input).text).toBe('$review\n\n检查当前改动')
    expect(buildDesktopUserMessageContent(input).text).not.toContain('SKILL.md')
  })

  test('allows a skill-only submission', () => {
    const prepared = prepareComposerSubmission(
      draft({
        document: createComposerDocument(''),
        skillInvocation: { name: 'review', path: 'skills/review' },
      }),
    )

    expect('input' in prepared && prepared.input.skills?.[0]?.name).toBe('review')
  })

  test('serializes visible task and browser references and allows reference-only submission', () => {
    const prepared = prepareComposerSubmission(
      draft({
        document: {
          text: '',
          tokens: [
            {
              id: 'thread-1',
              kind: 'thread',
              label: '任务：[登录修复]',
              value: 'pidex://threads/thread-1',
              from: 0,
              to: 0,
            },
            {
              id: 'browser-1',
              kind: 'browser',
              label: '网页：参考文档',
              value: 'https://example.com/docs',
              from: 0,
              to: 0,
            },
          ],
        },
      }),
    )

    expect('input' in prepared && prepared.input.text).toBe(
      '[任务：\\[登录修复\\]](<pidex://threads/thread-1>)[网页：参考文档](<https://example.com/docs>)',
    )
    expect('input' in prepared && prepared.input.attachments).toEqual([])
  })

  test('navigates before the first send and reports a recoverable send failure', async () => {
    const events: string[] = []
    let nextId = 0
    const store = new ComposerDraftStore(() => `draft-${++nextId}`)
    store.update('home', (current) => ({
      ...current,
      document: createComposerDocument('检查当前改动'),
    }))
    const source = store.get('home')
    let submittedInputId: string | null = null
    const outcome = await executeComposerSubmitTransaction({
      draft: source,
      createSession: async () => {
        events.push('create')
        return 'session-1'
      },
      navigateToSession: (sessionId) => {
        const handoff = store.handoff('home', `session:${sessionId}`)
        expect(handoff?.replacement.clientId).toBe('draft-2')
        events.push(`navigate:${sessionId}`)
      },
      submitToSession: async (sessionId, _input, metadata) => {
        submittedInputId = metadata.inputId
        events.push(`send:${sessionId}`)
        throw new Error('发送失败')
      },
    })

    expect(events).toEqual(['create', 'navigate:session-1', 'send:session-1'])
    expect(outcome).toEqual({
      status: 'failed',
      phase: 'send',
      message: '发送失败',
      sessionId: 'session-1',
    })
    expect(submittedInputId).toBe('draft-1')
    expect(source.document.text).toBe('检查当前改动')
    expect(store.get('session:session-1').clientId).toBe('draft-1')
    expect(store.get('session:session-1').document.text).toBe('检查当前改动')
    expect(store.get('home').clientId).toBe('draft-2')
    expect(store.get('home').document.text).toBe('')
  })

  test('passes the first submitted text when creating a new session', async () => {
    const calls: Array<{ name?: string; prompt?: string }> = []
    const outcome = await executeComposerSubmitTransaction({
      draft: draft({ skillInvocation: { name: 'review', path: 'skills/review' } }),
      createSession: async (name, prompt) => {
        calls.push({ name, prompt })
        return 'session-projectless'
      },
      submitToSession: async () => 'sent',
    })

    expect(calls).toEqual([
      {
        name: '$review 检查当前改动',
        prompt: '检查当前改动',
      },
    ])
    expect(outcome).toEqual({ status: 'sent', sessionId: 'session-projectless' })
  })

  test('keeps a new-session draft on the source route when creation fails', async () => {
    const events: string[] = []
    let nextId = 0
    const store = new ComposerDraftStore(() => `draft-${++nextId}`)
    store.update('home', (current) => ({
      ...current,
      document: createComposerDocument('检查当前改动'),
    }))
    const source = store.get('home')
    const outcome = await executeComposerSubmitTransaction({
      draft: source,
      createSession: async () => {
        throw new Error('无法创建无项目工作区')
      },
      navigateToSession: (sessionId) => events.push(`navigate:${sessionId}`),
      submitToSession: async (sessionId) => {
        events.push(`send:${sessionId}`)
        return 'sent'
      },
    })

    expect(events).toEqual([])
    expect(outcome).toEqual({
      status: 'failed',
      phase: 'create',
      message: '无法创建无项目工作区',
      sessionId: undefined,
    })
    expect(source.document.text).toBe('检查当前改动')
    expect(store.get('home').clientId).toBe('draft-1')
    expect(store.get('home').document.text).toBe('检查当前改动')
  })

  test('preserves the queued delivery outcome', async () => {
    let submittedInputId: string | null = null
    const outcome = await executeComposerSubmitTransaction({
      draft: draft(),
      targetSessionId: 'session-running',
      submitToSession: async (_sessionId, _input, metadata) => {
        submittedInputId = metadata.inputId
        return 'queued'
      },
    })

    expect(submittedInputId).toBe('draft-1')
    expect(outcome).toEqual({
      status: 'queued',
      sessionId: 'session-running',
    })
  })
})
