const CONTEXT_OVERFLOW_MARKERS = [
  'context_length_exceeded',
  'maximum context length',
  'prompt is too long',
  'too many tokens',
] as const

/** Provider-neutral fallback for Pi responses that currently expose only error text. */
export const isProviderContextOverflow = (message: string | undefined) => {
  const normalized = message?.trim().toLowerCase()
  if (!normalized) return false
  if (CONTEXT_OVERFLOW_MARKERS.some((marker) => normalized.includes(marker))) return true
  if (
    normalized.includes('context window') &&
    /(exceed|too (?:large|long)|maximum|limit)/.test(normalized)
  )
    return true
  if (
    normalized.includes('input token count') &&
    /(exceed|too (?:large|high)|maximum|limit)/.test(normalized)
  )
    return true
  return false
}

export const REACTIVE_COMPACTION_INSTRUCTIONS = [
  '保留当前用户请求、已经完成的工具调用、关键文件状态和剩余步骤。',
  '删除无助于继续当前任务的旧工具输出和重复背景。',
  '不得把压缩过程本身当成用户请求。',
].join('\n')

export const REACTIVE_CONTINUATION_PROMPT = [
  '上下文刚刚因为窗口限制被压缩。继续当前尚未完成的请求。',
  '不要承认或复述压缩过程，不要重新询问用户已经提供的信息。',
  '优先复用保留历史中的工具结果；不得重复执行具有相同 toolCallId 或已经明确完成的副作用。',
].join('\n')
