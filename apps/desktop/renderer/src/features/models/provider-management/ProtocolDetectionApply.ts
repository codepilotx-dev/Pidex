/**
 * 协议检测结果的纯函数应用逻辑：只计算新的本地草稿，不触发任何保存或网络请求。
 * 检测结果来自 `provider/protocol/detect`，这里保持结构化输入以便单测。
 */

/** 检测矩阵的固定协议顺序，也是“优先成功协议”的排序依据。 */
export const DETECTION_PROTOCOL_ORDER = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
] as const

export type DetectionChatProtocol = (typeof DETECTION_PROTOCOL_ORDER)[number]

export type DetectionCellLike = {
  protocol: string
  status: 'success' | 'failed'
  latencyMs?: number
  category?: string
  message?: string
}

export type DetectionModelLike = {
  model: string
  cells: readonly DetectionCellLike[]
}

export type DetectionResultLike = {
  mode?: 'single' | 'batch'
  protocols?: readonly string[]
  models: readonly DetectionModelLike[]
  totalModels?: number
  skippedModels?: number
}

/** 请求配置草稿里保存的模型协议视图，id + api 即可表达检测结果的应用目标。 */
export type DetectionDraftModel = {
  id: string
  api: string
}

export type ProtocolDetectionDraftInput = {
  /** 当前默认/试用的 API 地址（协议检测使用的 `baseUrl`）。 */
  address: string
  /** 每个协议已配置的地址；缺失表示未单独配置。 */
  endpoints: Record<string, string>
  /** 当前默认协议；`mixed` 表示按模型设置。 */
  protocol: string
  /** 自定义供应商的聊天模型；builtin 或零模型时为空。 */
  models?: readonly DetectionDraftModel[]
}

export type ProtocolDetectionApplyResult = {
  endpoints: Record<string, string>
  models?: DetectionDraftModel[]
  protocol?: string
}

function protocolRank(protocol: string): number {
  const index = DETECTION_PROTOCOL_ORDER.indexOf(protocol as DetectionChatProtocol)
  return index < 0 ? DETECTION_PROTOCOL_ORDER.length : index
}

/** 按 Chat、Responses、Anthropic、Gemini 顺序取第一个成功协议。 */
export function preferredDetectedProtocol(
  result: DetectionResultLike,
): DetectionChatProtocol | null {
  const successes = new Set<string>()
  for (const row of result.models) {
    for (const cell of row.cells) {
      if (cell.status === 'success') successes.add(cell.protocol)
    }
  }
  const ordered = [...successes].sort((left, right) => protocolRank(left) - protocolRank(right))
  const first = ordered[0]
  return first && protocolRank(first) < DETECTION_PROTOCOL_ORDER.length
    ? (first as DetectionChatProtocol)
    : null
}

/**
 * 应用检测矩阵到本地请求配置草稿：
 * - 任一模型成功的协议写入该协议本次使用的地址；失败协议保留草稿原值且不新增键。
 * - 每个检测行只在该行存在成功协议时调整模型 api：单协议成功直接切换；
 *   多协议成功时原 api 仍成功则保留，否则按固定顺序选第一个成功协议。
 * - 失败不删除模型；没有可写模型（builtin 或零模型）时把优先成功协议作为默认协议。
 */
export function applyProtocolDetection(
  draft: ProtocolDetectionDraftInput,
  result: DetectionResultLike,
  currentModels: readonly DetectionDraftModel[] = draft.models ?? [],
): ProtocolDetectionApplyResult {
  const endpoints: Record<string, string> = { ...draft.endpoints }
  const succeeded = new Set<string>()
  for (const row of result.models) {
    for (const cell of row.cells) {
      if (cell.status === 'success') succeeded.add(cell.protocol)
    }
  }
  for (const protocol of DETECTION_PROTOCOL_ORDER) {
    if (!succeeded.has(protocol)) continue
    const address = (draft.endpoints[protocol] ?? draft.address).trim()
    if (address) endpoints[protocol] = address
  }

  let models: DetectionDraftModel[] | undefined
  if (currentModels.length > 0) {
    models = currentModels.map((model) => {
      const row = result.models.find((candidate) => candidate.model === model.id)
      if (!row) return model
      const successes = row.cells
        .filter((cell) => cell.status === 'success')
        .map((cell) => cell.protocol)
        .sort((left, right) => protocolRank(left) - protocolRank(right))
      const single = successes[0]
      if (!single) return model
      if (successes.length === 1) return model.api === single ? model : { ...model, api: single }
      if (successes.includes(model.api)) return model
      return model.api === single ? model : { ...model, api: single }
    })
  }

  const preferred = preferredDetectedProtocol(result)
  // 有可写模型时由模型 api 表达检测结果；没有模型（builtin/零模型）才回落到默认协议。
  const protocol = preferred && currentModels.length === 0 ? preferred : undefined
  return {
    endpoints,
    ...(models ? { models } : {}),
    ...(protocol ? { protocol } : {}),
  }
}
