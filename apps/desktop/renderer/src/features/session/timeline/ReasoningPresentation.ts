export type ReasoningLine = { lineIndex: number; text: string }

export function reasoningLatestLine(text: string): ReasoningLine | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex--) {
    const line = lines[lineIndex]?.trim()
    if (line) return { lineIndex, text: line }
  }
  return null
}

export function enqueueReasoningLine(
  queue: readonly ReasoningLine[],
  next: ReasoningLine,
): ReasoningLine[] {
  const index = queue.findIndex((line) => line.lineIndex === next.lineIndex)
  if (index >= 0) return queue.map((line, position) => (position === index ? next : line))
  return queue.length ? [queue[0]!, next] : [next]
}

export function reasoningPlaybackQueue(
  queue: readonly ReasoningLine[],
  driftMs: number,
): ReasoningLine[] {
  return driftMs > 250 && queue.length > 1 ? queue.slice(-1) : [...queue]
}
