import { createStore, type StoreApi } from 'zustand/vanilla'

import type { DesktopWorkspace, DesktopUserMessageInput } from '../../../../shared/Types.js'
import type { ComposerDraftKey, PreparedComposerSubmission } from '../composer/ComposerTypes.js'

const PENDING_STATE_CHANNEL = 'pidex:pending-submission'

export type PendingSubmissionStage = 'creating' | 'sending'

/**
 * 首次发送在会话真正建立前的内存提交。`submissionId` 就是发送时预分配的
 * 会话 ID（也等于草稿 `clientId`），因此路由、提交快照与首条消息的 `inputId`
 * 从头到尾是同一个值，不需要在临时路由和真实路由之间搬运状态。
 */
export type PendingSubmission = {
  submissionId: string
  sourceDraftKey: ComposerDraftKey
  stage: PendingSubmissionStage
  input: DesktopUserMessageInput
  workspace: DesktopWorkspace | null
  createdAt: number
}

type PendingSubmissionState = {
  submissions: Readonly<Record<string, PendingSubmission>>
}

/**
 * 当前窗口可见的提交快照都在 Renderer 内存里完成。Electron 的多个 Renderer
 * 进程（新窗口/宠物窗）不共享模块状态，因此需要只读广播作为旁路；接收端
 * 不加载草稿，只渲染广播的提交快照。
 */
type PendingSubmissionBroadcast = {
  source: string
  submissionId: string
  submission: PendingSubmission | null
}

class PendingSubmissionStore {
  readonly #store: StoreApi<PendingSubmissionState>
  readonly #source = globalThis.crypto.randomUUID()
  readonly #channel: BroadcastChannel | null

  constructor() {
    this.#store = createStore<PendingSubmissionState>()(() => ({ submissions: {} }))
    this.#channel =
      typeof BroadcastChannel === 'function' ? new BroadcastChannel(PENDING_STATE_CHANNEL) : null
    if (this.#channel) {
      this.#channel.onmessage = (event: MessageEvent<PendingSubmissionBroadcast>) => {
        const message = event.data
        if (!message || message.source === this.#source) return
        if (message.submission) this.#write(message.submission)
        else this.#remove(message.submissionId)
      }
    }
  }

  get store(): StoreApi<PendingSubmissionState> {
    return this.#store
  }

  register(submission: PendingSubmission): void {
    this.#write(submission)
    this.#post({ submissionId: submission.submissionId, submission })
  }

  update(submissionId: string, patch: Partial<Pick<PendingSubmission, 'stage'>>): void {
    const current = this.#store.getState().submissions[submissionId]
    if (!current) return
    const next = { ...current, ...patch }
    this.#write(next)
    this.#post({ submissionId, submission: next })
  }

  remove(submissionId: string): void {
    if (!this.#remove(submissionId)) return
    this.#post({ submissionId, submission: null })
  }

  /** 立即清理所有未完成的临时提交；只影响内存状态。 */
  clear(): void {
    const submissionIds = Object.keys(this.#store.getState().submissions)
    if (submissionIds.length === 0) return
    this.#store.setState({ submissions: {} })
    for (const submissionId of submissionIds) this.#post({ submissionId, submission: null })
  }

  get(submissionId: string): PendingSubmission | null {
    return this.#store.getState().submissions[submissionId] ?? null
  }

  #write(submission: PendingSubmission): void {
    this.#store.setState((state) => ({
      submissions: { ...state.submissions, [submission.submissionId]: submission },
    }))
  }

  #remove(submissionId: string): boolean {
    if (!(submissionId in this.#store.getState().submissions)) return false
    this.#store.setState((state) => {
      const { [submissionId]: _removed, ...submissions } = state.submissions
      return { submissions }
    })
    return true
  }

  #post(message: Omit<PendingSubmissionBroadcast, 'source'>): void {
    const payload: PendingSubmissionBroadcast = { ...message, source: this.#source }
    this.#channel?.postMessage(payload)
  }
}

/** Renderer 内存中的 pending 提交注册表；不写数据库，也不进入正式会话目录。 */
export const pendingSubmissionStore = new PendingSubmissionStore()

export function createPendingSubmission(input: {
  prepared: PreparedComposerSubmission
  sourceDraftKey: ComposerDraftKey
  workspace: DesktopWorkspace | null
}): PendingSubmission {
  return {
    submissionId: input.prepared.clientId,
    sourceDraftKey: input.sourceDraftKey,
    stage: 'creating',
    input: input.prepared.input,
    workspace: input.workspace,
    createdAt: Date.now(),
  }
}

/**
 * 本次新建会话的首条消息在等待期间不展示整块加载画面：消息区从提交快照
 * 直接过渡到思考态与正式投影。历史会话、子代理和侧边聊天保持原有加载行为。
 */
export function shouldDeferThreadLoading(input: {
  firstInputId: string | null | undefined
  isCurrentFirstSubmit: boolean
  loading: boolean
  error: string | null
}): boolean {
  return (
    input.isCurrentFirstSubmit &&
    input.loading &&
    input.error === null &&
    Boolean(input.firstInputId)
  )
}

/** canonical projection 出现同一 inputId 后，pending 消息才交棒。 */
export function hasPendingInput(inputIds: Iterable<string>, inputId: string): boolean {
  for (const candidate of inputIds) {
    if (candidate === inputId) return true
  }
  return false
}
