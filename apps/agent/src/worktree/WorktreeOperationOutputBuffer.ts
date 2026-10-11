import { secretScrubber } from '../security/SecretScrubber'
import { TerminalControlStripper } from '../security/TerminalControlStripper'

const MAX_OUTPUT_BYTES = 64 * 1024
const COMPLETED_TTL_MS = 10 * 60 * 1000

type OutputState = {
  data: Buffer
  oldestCursor: number
  nextCursor: number
  complete: boolean
  expiresAt: number | null
  controls: TerminalControlStripper
  secrets: StreamingSecretScrubber
}

class StreamingSecretScrubber {
  private pending = ''
  private droppingLine = false
  truncated = false
  discardedBytes = 0

  write(value: string) {
    let input = value
    if (this.droppingLine) {
      const delimiter = input.search(/[\r\n]/)
      if (delimiter < 0) {
        this.discardedBytes += Buffer.byteLength(input, 'utf8')
        return ''
      }
      const next =
        input[delimiter] === '\r' && input[delimiter + 1] === '\n' ? delimiter + 2 : delimiter + 1
      this.discardedBytes += Buffer.byteLength(input.slice(0, next), 'utf8')
      input = input.slice(next)
      this.droppingLine = false
    }
    this.pending += input
    const delimiter = Math.max(this.pending.lastIndexOf('\r'), this.pending.lastIndexOf('\n'))
    let output = ''
    if (delimiter >= 0) {
      output = secretScrubber.scrubText(this.pending.slice(0, delimiter + 1))
      this.pending = this.pending.slice(delimiter + 1)
    }
    if (Buffer.byteLength(this.pending, 'utf8') > MAX_OUTPUT_BYTES) {
      this.discardedBytes += Buffer.byteLength(this.pending, 'utf8')
      this.pending = ''
      this.droppingLine = true
      this.truncated = true
    }
    return output
  }

  flush() {
    if (this.droppingLine) return ''
    const output = secretScrubber.scrubText(this.pending)
    this.pending = ''
    return output
  }
}

/** Ephemeral setup/cleanup output. It is intentionally never written to SQLite, events or logs. */
export class WorktreeOperationOutputBuffer {
  private readonly operations = new Map<string, OutputState>()

  constructor(private readonly now: () => number = Date.now) {}

  append(operationId: string, chunk: string) {
    this.sweep()
    const state = this.operations.get(operationId) ?? {
      data: Buffer.alloc(0),
      oldestCursor: 0,
      nextCursor: 0,
      complete: false,
      expiresAt: null,
      controls: new TerminalControlStripper(),
      secrets: new StreamingSecretScrubber(),
    }
    const discardedBefore = state.secrets.discardedBytes
    const sanitized = state.secrets.write(state.controls.write(chunk))
    const discarded = state.secrets.discardedBytes - discardedBefore
    if (discarded > 0) {
      state.data = Buffer.alloc(0)
      state.nextCursor += discarded
      state.oldestCursor = state.nextCursor
    }
    this.appendSanitized(state, sanitized)
    this.operations.set(operationId, state)
  }

  private appendSanitized(state: OutputState, value: string) {
    const encoded = Buffer.from(value, 'utf8')
    state.data = Buffer.concat([state.data, encoded])
    state.nextCursor += encoded.byteLength
    if (state.data.length > MAX_OUTPUT_BYTES) {
      const removed = state.data.length - MAX_OUTPUT_BYTES
      let start = removed
      while (start < state.data.length && (state.data[start]! & 0xc0) === 0x80) start += 1
      state.data = state.data.subarray(start)
      state.oldestCursor = state.nextCursor - state.data.byteLength
    }
  }

  complete(operationId: string) {
    const state = this.operations.get(operationId) ?? {
      data: Buffer.alloc(0),
      oldestCursor: 0,
      nextCursor: 0,
      complete: false,
      expiresAt: null,
      controls: new TerminalControlStripper(),
      secrets: new StreamingSecretScrubber(),
    }
    this.appendSanitized(state, state.secrets.flush())
    state.complete = true
    state.expiresAt = this.now() + COMPLETED_TTL_MS
    this.operations.set(operationId, state)
  }

  read(operationId: string, afterCursor = 0) {
    this.sweep()
    const state = this.operations.get(operationId)
    if (!state)
      return { cursor: Math.max(0, afterCursor), data: '', truncated: false, complete: true }
    const safeCursor = Math.max(0, Math.min(afterCursor, state.nextCursor))
    const truncated = safeCursor < state.oldestCursor || state.secrets.truncated
    let start = truncated ? 0 : safeCursor - state.oldestCursor
    while (start < state.data.length && (state.data[start]! & 0xc0) === 0x80) start += 1
    return {
      cursor: state.nextCursor,
      data: state.data.subarray(start).toString('utf8'),
      truncated,
      complete: state.complete,
    }
  }

  private sweep() {
    const timestamp = this.now()
    for (const [id, state] of this.operations) {
      if (state.expiresAt !== null && state.expiresAt <= timestamp) this.operations.delete(id)
    }
  }
}
