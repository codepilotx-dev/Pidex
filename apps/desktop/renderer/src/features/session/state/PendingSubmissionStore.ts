import { createStore, type StoreApi } from 'zustand/vanilla'

import type { DesktopWorkspace, DesktopUserMessageInput } from '../../../../shared/Types.js'
import type { ComposerDraftKey, PreparedComposerSubmission } from '../composer/ComposerTypes.js'

const PENDING_STATE_CHANNEL = 'pidex:pending-submission'

export type PendingSubmissionStage = 'creating' | 'sending'

/**
 * 首次发送在正式会话建立前的内存提交。只服务 pending 路由展示，
 * 不参与会话查询、订阅或 RPC；`submissionId` 就是草稿的 `clientId`。
 */
export type PendingSubmission = {
  submissionId: string
  sourceDraftKey: ComposerDraftKey
  sessionId: string | null
  stage: PendingSubmissionStage
  input: DesktopUserMessageInput
  workspace: DesktopWorkspace | null
  createdAt: number
}

type PendingSubmissionState = {
  submissions: Readonly<Record<string, PendingSubmission>>
}

/**
 * 当前窗口可见的 pending 页面与草稿交接都在 Renderer 内存里完成。
 * Electron 的多个 Renderer 进程（新窗口/宠物窗）不共享模块状态，因此
 * 需要只读广播作为旁路；接收端不加载草稿，只渲染广播的提交快照。
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

  update(
    submissionId: string,
    patch: Partial<Pick<PendingSubmission, 'sessionId' | 'stage'>>,
  ): void {
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
    sessionId: null,
    stage: 'creating',
    input: input.prepared.input,
    workspace: input.workspace,
    createdAt: Date.now(),
  }
}

/**
 * 只有本次新建会话的首条消息（已提交且尚未进入 canonical projection）才允许
 * 推迟整块加载画面。历史会话、子代理和侧边聊天保持原有的加载行为。
 */
export function shouldDeferThreadLoading(input: {
  firstInputId: string | null | undefined
  isCurrentFirstSubmit: boolean
  loading: boolean
  turnCount: number
  error: string | null
}): boolean {
  return (
    input.isCurrentFirstSubmit &&
    input.loading &&
    input.turnCount === 0 &&
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

export type PendingSubmissionRoute = {
  submissionId: string
  submission: PendingSubmission | null
}

export function readPendingSubmissionRoute(pathname: string): PendingSubmissionRoute | null {
  const match = /^\/pending\/([^/]+)$/.exec(pathname)
  if (!match) return null
  const submissionId = decodeURIComponent(match[1]!)
  return { submissionId, submission: pendingSubmissionStore.get(submissionId) }
}

/** 表单提交后同步登记 pending 并导航，不等待创建完成。 */
export function startPendingSubmission(input: {
  submission: PendingSubmission
  navigate: (path: string) => void
}): PendingSubmission {
  pendingSubmissionStore.register(input.submission)
  input.navigate(pendingSubmissionPath(input.submission.submissionId))
  return input.submission
}

export function pendingSubmissionPath(submissionId: string): string {
  return `/pending/${encodeURIComponent(submissionId)}`
}

/** 用户当前是否仍停留在该 pending 页面。 */
export function isOnPendingSubmissionPage(
  pathname: string,
  submissionId: string,
): boolean {
  return readPendingSubmissionRoute(pathname)?.submissionId === submissionId
}
