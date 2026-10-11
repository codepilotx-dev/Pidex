import type { DesktopTerminalChunk } from '@pidex/shared/desktop-terminal-ipc'

export interface TerminalReplay {
  oldestSequence: number
  nextSequence: number
  chunks: readonly DesktopTerminalChunk[]
  gap: boolean
  truncated: boolean
}

export class TerminalOutputBuffer {
  readonly #maximumBytes: number
  readonly #terminalId: string
  readonly #instanceId: string
  readonly #chunks: Array<DesktopTerminalChunk & { bytes: number }> = []
  #nextSequence = 0
  #totalBytes = 0
  #truncated = false

  constructor(terminalId: string, instanceId: string, maximumBytes = 1_048_576) {
    this.#terminalId = terminalId
    this.#instanceId = instanceId
    this.#maximumBytes = maximumBytes
  }

  append(data: string): DesktopTerminalChunk {
    const sequence = this.#nextSequence++
    const normalizedData = trimUtf8Tail(data, this.#maximumBytes)
    const bytes = Buffer.byteLength(normalizedData, 'utf8')
    const chunk = {
      terminalId: this.#terminalId,
      instanceId: this.#instanceId,
      sequence,
      data: normalizedData,
      bytes,
    }
    this.#chunks.push(chunk)
    this.#totalBytes += bytes
    while (this.#totalBytes > this.#maximumBytes && this.#chunks.length > 1) {
      const removed = this.#chunks.shift()
      if (removed) this.#totalBytes -= removed.bytes
      this.#truncated = true
    }
    if (Buffer.byteLength(data, 'utf8') > bytes) this.#truncated = true
    return chunk
  }

  replay(afterSequence: number): TerminalReplay {
    const oldestSequence = this.#chunks[0]?.sequence ?? this.#nextSequence
    const gap = afterSequence < oldestSequence - 1
    const chunks = this.#chunks
      .filter((chunk) => chunk.sequence > afterSequence)
      .map(({ bytes: _bytes, ...chunk }) => chunk)
    return {
      oldestSequence,
      nextSequence: this.#nextSequence,
      chunks,
      gap,
      truncated: this.#truncated,
    }
  }

  /** 当前仍可回放的最小序号；已全部淘汰时等于下一个待分配序号。 */
  oldestSequence(): number {
    return this.#chunks[0]?.sequence ?? this.#nextSequence
  }

  /**
   * 按序号取一条仍在缓冲内的记录（含其字节数）。序号连续且只从队首淘汰，
   * 因此可以直接按下标定位，不需要遍历。
   */
  at(sequence: number): (DesktopTerminalChunk & { bytes: number }) | undefined {
    const oldest = this.#chunks[0]?.sequence
    if (oldest === undefined) return undefined
    const index = sequence - oldest
    if (index < 0 || index >= this.#chunks.length) return undefined
    return this.#chunks[index]
  }

  clear(): void {
    this.#chunks.length = 0
    this.#totalBytes = 0
  }
}

function trimUtf8Tail(value: string, maximumBytes: number): string {
  const encoded = Buffer.from(value, 'utf8')
  if (encoded.byteLength <= maximumBytes) return value
  let start = encoded.byteLength - maximumBytes
  while (start < encoded.byteLength && (encoded[start]! & 0xc0) === 0x80) start += 1
  return encoded.subarray(start).toString('utf8')
}
