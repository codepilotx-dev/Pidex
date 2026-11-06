import { describe, expect, test } from 'bun:test'
import type React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComposerDraftStore } from '../src/features/session/composer/ComposerDraftStore.js'
import {
  createComposerDocument,
  type ComposerDraft,
} from '../src/features/session/composer/ComposerTypes.js'
import {
  createPendingSubmission,
  hasPendingInput,
  pendingSubmissionStore,
  shouldDeferThreadLoading,
} from '../src/features/session/state/PendingSubmissionStore.js'
import { PendingSubmissionMessages } from '../src/features/session/conversation/PendingSubmissionView.js'
import {
  prepareComposerSubmission,
  executeComposerSubmitTransaction,
} from '../src/features/session/composer/ComposerSubmitTransaction.js'

function draft(overrides: Partial<ComposerDraft> = {}): ComposerDraft {
  return {
    clientId: 'draft-1',
    document: createComposerDocument('首次发送的消息'),
    attachments: [],
    collaborationMode: 'default',
    ...overrides,
  }
}

function pendingFrom(overrides: Partial<ComposerDraft> = {}) {
  const source = draft(overrides)
  const prepared = prepareComposerSubmission(source)
  if ('status' in prepared) throw new Error('prepare failed')
  return createPendingSubmission({
    prepared,
    sourceDraftKey: 'home',
    workspace: { name: 'Pidex', path: '/repo/pidex' },
  })
}

describe('pending submission snapshot', () => {
  test('以草稿 clientId 标识并保留提交快照', () => {
    const submission = pendingFrom({
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
      skills: [{ name: 'review', path: 'skills/review/SKILL.md' }],
      goalModeEnabled: true,
    })

    expect(submission.submissionId).toBe('draft-1')
    expect(submission.stage).toBe('creating')
    expect(submission.input.text).toBe('首次发送的消息')
    expect(submission.input.attachments?.map((attachment) => attachment.id)).toEqual([
      'attachment-1',
    ])
    expect(submission.input.skills).toEqual([{ name: 'review', path: 'skills/review/SKILL.md' }])
    expect(submission.workspace?.path).toBe('/repo/pidex')
  })

  test('提交快照按草稿 clientId 登记，创建完成后只推进阶段', () => {
    const submission = pendingFrom()
    pendingSubmissionStore.register(submission)
    expect(pendingSubmissionStore.get('draft-1')?.submissionId).toBe('draft-1')
    pendingSubmissionStore.update('draft-1', { stage: 'sending' })
    expect(pendingSubmissionStore.get('draft-1')).toMatchObject({ stage: 'sending' })
    pendingSubmissionStore.remove('draft-1')
    expect(pendingSubmissionStore.get('draft-1')).toBeNull()
  })
  test('交棒只在 canonical 投影出现同一 inputId 后发生', () => {
    expect(hasPendingInput(['other-input'], 'draft-1')).toBe(false)
    expect(hasPendingInput(['draft-1'], 'draft-1')).toBe(true)
  })
  test('首条提交尚未进入投影时推迟整块加载画面', () => {
    const base = {
      firstInputId: 'draft-1',
      isCurrentFirstSubmit: true,
      loading: true,
      error: null,
    }
    expect(shouldDeferThreadLoading(base)).toBe(true)
    expect(shouldDeferThreadLoading({ ...base, isCurrentFirstSubmit: false })).toBe(false)
    expect(shouldDeferThreadLoading({ ...base, firstInputId: null })).toBe(false)
    expect(shouldDeferThreadLoading({ ...base, error: '加载失败' })).toBe(false)
    expect(shouldDeferThreadLoading({ ...base, loading: false })).toBe(false)
  })
})

describe('pending message rendering', () => {
  /**
   * 生产路径上 pending 消息与 canonical 时间线是兄弟节点，可能在没有
   * ConversationItemContext.Provider 的位置渲染；严格 context 会整页崩溃。
   */
  function render(submission: ReturnType<typeof pendingFrom>): string {
    return renderToStaticMarkup(<PendingSubmissionMessages submission={submission} />)
  }

  test('立即展示提交内容与启动状态，且不显示停止入口', () => {
    const markup = render(pendingFrom())
    expect(markup).toContain('首次发送的消息')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('正在开启会话…')
    expect(markup).toContain('data-pending-submission="draft-1"')
    expect(markup).toContain('canonical-user-message__bubble')
    expect(markup).not.toContain('正在加载会话内容')
    expect(markup).not.toContain('停止')
  })

  test('会话建立后状态文案直接变成正在思考，不再回到准备阶段', () => {
    const markup = render({ ...pendingFrom(), sessionId: 'session-1', stage: 'sending' })
    expect(markup).toContain('正在思考')
    expect(markup).not.toContain('正在开启会话…')
    expect(markup).not.toContain('正在加载会话内容')
  })

  test('Skill 提交快照沿用已落盘消息的展示约定', () => {
    const markup = render(
      pendingFrom({ skills: [{ name: 'review', path: 'skills/review/SKILL.md' }] }),
    )
    expect(markup).toContain('$review')
    expect(markup).toContain('composer-inline-skill-token')
    expect(markup).not.toContain('skills/review/SKILL.md')
  })

  test('展示一次：交棒前的快照与 canonical 投影不会同时渲染同一消息', () => {
    const submission = pendingFrom()
    const markup = render(submission)
    const occurrences = markup.split('首次发送的消息').length - 1
    expect(occurrences).toBe(1)
  })
})

describe('pending draft handoff', () => {
  test('创建成功后草稿交给真实会话并保留原 clientId', () => {
    const store = new ComposerDraftStore(() => 'draft-next')
    store.set('home', draft())
    store.handoff('home', 'session:session-1')
    expect(store.get('session:session-1').clientId).toBe('draft-1')
    expect(store.peek('session:session-1')?.document.text).toBe('首次发送的消息')
  })

  test('创建失败且用户仍在该页时原稿回到来源页，临时目标被丢弃', () => {
    const store = new ComposerDraftStore(() => 'draft-next')
    store.set('home', draft())
    store.handoff('home', 'session:draft-1')
    store.revertHandoff(
      'home',
      'session:draft-1',
      draft({ document: createComposerDocument('首次发送的消息') }),
    )
    expect(store.peek('session:draft-1')).toBeUndefined()
    expect(store.get('home')).toMatchObject({
      clientId: 'draft-1',
      document: { text: '首次发送的消息' },
    })
  })

  test('发送失败保留真实会话草稿且只丢弃启动提示', () => {
    const store = new ComposerDraftStore(() => 'draft-next')
    store.set('home', draft({ goalModeEnabled: true }))
    store.handoff('home', 'session:session-1')
    store.discard('session:unused')
    expect(store.get('session:session-1')).toMatchObject({
      clientId: 'draft-1',
      goalModeEnabled: true,
    })
    expect(store.peek('session:unused')).toBeUndefined()
  })

  test('交接后移走已提交内容，但保留同一草稿身份', () => {
    const store = new ComposerDraftStore(() => 'draft-next')
    store.set(
      'home',
      draft({
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
        skills: [{ name: 'review', path: 'skills/review/SKILL.md' }],
        goalModeEnabled: true,
      }),
    )
    const handoff = store.handoff('home', 'session:session-1')
    store.clearSubmittedContent('session:session-1', handoff!.submitted.clientId)
    const cleared = store.get('session:session-1')
    expect(cleared.clientId).toBe('draft-1')
    expect(cleared.document.text).toBe('')
    expect(cleared.attachments).toEqual([])
    expect(cleared.skills).toEqual([])
    expect(cleared.goalModeEnabled).toBeUndefined()
    // 身份不符时不覆盖：并发的其他提交不能清掉别人的草稿。
    store.set('session:session-1', draft({ clientId: 'draft-later' }))
    store.clearSubmittedContent('session:session-1', 'draft-1')
    expect(store.get('session:session-1').clientId).toBe('draft-later')
    expect(store.get('session:session-1').document.text).toBe('首次发送的消息')
  })

  test('提交完成时保留等待期间新输入的内容，只轮换身份', () => {
    const store = new ComposerDraftStore(() => 'draft-next')
    store.set('session:session-1', draft())
    store.clearSubmittedContent('session:session-1', 'draft-1')
    store.update('session:session-1', (current) => ({
      ...current,
      document: createComposerDocument('等待期间补写的内容'),
    }))
    const completed = store.completeSubmission('session:session-1', 'draft-1', {
      clearContent: false,
    })
    expect(completed.document.text).toBe('等待期间补写的内容')
    expect(completed.clientId).toBe('draft-next')
  })
})

describe('composer submit transaction with pending route', () => {
  test('会话 ID 在登记时就确定，创建完成后不再切换路由', async () => {
    const navigations: string[] = []
    let releaseCreate: (sessionId: string) => void = () => undefined
    const creating = new Promise<string>((resolve) => {
      releaseCreate = resolve
    })
    const outcome = (async () =>
      executeComposerSubmitTransaction({
        draft: draft(),
        onPrepared: (prepared) => {
          // 预分配的会话 ID 就是草稿 clientId：路由、快照与 inputId 同一个值。
          navigations.push(`/threads/${prepared.clientId}`)
        },
        createSession: () => creating,
        onSessionCreated: () => undefined,
        submitToSession: async () => 'sent',
      }))()

    expect(navigations).toEqual(['/threads/draft-1'])
    releaseCreate('draft-1')
    expect(await outcome).toEqual({ status: 'sent', sessionId: 'draft-1' })
    // 创建完成不产生第二次导航：这条路由从一开始就是最终会话。
    expect(navigations).toEqual(['/threads/draft-1'])
  })

  test('无效输入不登记提交，也不触发任何导航', async () => {
    const navigations: string[] = []
    const outcome = await executeComposerSubmitTransaction({
      draft: draft({ document: createComposerDocument('   ') }),
      onPrepared: () => navigations.push('/threads/draft-1'),
      createSession: async () => 'session-1',
      submitToSession: async () => 'sent',
    })
    expect(outcome.status).toBe('failed')
    expect(navigations).toEqual([])
  })
})

export type { React }
