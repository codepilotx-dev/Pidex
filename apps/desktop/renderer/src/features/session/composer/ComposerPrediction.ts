/**
 * 输入预测的纯逻辑：请求门控、迟到响应序号与 Tab/Escape 裁决。
 *
 * RPC 调用与渲染留在 `ComposerCard`，这里不依赖 DOM，便于直接测试。
 */

export type ComposerPredictionGate = {
  /** 设置开关、只读状态与可用能力共同决定是否允许请求。 */
  enabled: boolean
  threadId: string | null
  /** 只有最近一条回复成功完成时才带上该轮次；其余情况为 null。 */
  turnId: string | null
  /** 输入框为空且没有附件/令牌。 */
  inputEmpty: boolean
}

export type ComposerPredictionRequest = {
  sequence: number
  threadId: string
  turnId: string
}

const predictionIdentity = (gate: ComposerPredictionGate): string | null =>
  gate.enabled && gate.threadId && gate.turnId ? `${gate.threadId}:${gate.turnId}` : null

/**
 * 同一轮次只请求一次；输入变化、切换聊天或关闭开关都会让在途响应失效，
 * 迟到结果不得覆盖非空草稿。
 */
export class ComposerPredictionController {
  private sequence = 0
  private identity: string | null = null
  private requested = false
  private dismissed = false
  private current: string | null = null

  get prediction(): string | null {
    return this.current
  }

  /**
   * 对齐门控状态，返回需要执行的请求（每轮最多一次）。
   *
   * 聊天或轮次身份变化会作废在途请求并重新允许一次请求；关闭开关或失去
   * 完成轮次时清空预测。输入非空只阻止发起，不重置"本轮已请求"标记。
   */
  sync(gate: ComposerPredictionGate): ComposerPredictionRequest | null {
    const identity = predictionIdentity(gate)
    if (identity !== this.identity) {
      this.identity = identity
      this.requested = false
      this.dismissed = false
      this.current = null
      this.sequence += 1
    }
    if (!identity) return null
    if (!gate.inputEmpty) {
      // 输入非空：立即作废在途响应并撤下灰字，避免迟到结果落到新草稿上。
      if (this.current !== null) {
        this.current = null
        this.sequence += 1
      }
      return null
    }
    if (this.requested || this.dismissed) return null
    this.requested = true
    this.sequence += 1
    return { sequence: this.sequence, threadId: gate.threadId!, turnId: gate.turnId! }
  }

  /** 迟到响应只有在序号仍最新且输入仍为空时才能落地。 */
  accept(sequence: number, prediction: string | null, inputEmpty: boolean): boolean {
    if (sequence !== this.sequence || !inputEmpty || !prediction) return false
    this.current = prediction
    return true
  }

  /** Escape 关闭后同一轮次不再自动弹出，直到聊天或轮次身份变化。 */
  dismiss(): void {
    this.dismissed = true
    this.current = null
    this.sequence += 1
  }

  /** 接受预测后清空，避免同一预测重复写入。 */
  consume(): void {
    this.current = null
    this.sequence += 1
  }

  reset(): void {
    this.sequence += 1
    this.identity = null
    this.requested = false
    this.dismissed = false
    this.current = null
  }
}

export type ComposerPredictionKeyAction = { type: 'accept' } | { type: 'dismiss' } | null

/**
 * Tab / Escape 的裁决。只在预测存在、输入为空且没有打开菜单时生效。
 * `accept` 只把灰字写入草稿，绝不提交消息。
 */
export function resolveComposerPredictionKeyAction(input: {
  key: string
  shiftKey: boolean
  composing: boolean
  menuOpen: boolean
  prediction: string | null
  inputEmpty: boolean
}): ComposerPredictionKeyAction {
  if (!input.prediction || !input.inputEmpty) return null
  if (input.composing || input.menuOpen) return null
  if (input.key === 'Tab' && !input.shiftKey) return { type: 'accept' }
  if (input.key === 'Escape') return { type: 'dismiss' }
  return null
}

/** 从会话事件里取最近一轮的轮次 ID；仅当该轮成功完成时才作为预测依据。 */
export function selectLatestCompletedTurnId(
  events: readonly { metadata?: Record<string, unknown> | null }[],
  latestTurnStatus: string | null | undefined,
): string | null {
  if (latestTurnStatus !== 'completed') return null
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const turnId = events[index]?.metadata?.turnId
    if (typeof turnId === 'string' && turnId.length > 0) return turnId
  }
  return null
}
