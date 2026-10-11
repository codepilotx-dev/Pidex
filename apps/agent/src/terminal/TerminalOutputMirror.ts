import type {
  TerminalOutputAppendParams,
  TerminalOutputClearParams,
  TerminalOutputResetParams,
} from '@pidex/agent-protocol/terminal'
import { AgentError } from '../Domain'
import { secretScrubber } from '../security/SecretScrubber'
import { TerminalControlStripper } from '../security/TerminalControlStripper'

type StoredChunk = {
  sequence: number
  data: string
  bytes: number
}

type MirrorEntry = {
  threadId: string
  terminalId: string
  instanceId: string
  oldestSequence: number
  nextSequence: number
  chunks: StoredChunk[]
  bytes: number
  gap: boolean
  truncated: boolean
  updatedAt: number
  sanitizer: TerminalControlStripper
}

export type TerminalOutputReadResult = {
  terminalId: string
  instanceId: string
  oldestSequence: number
  nextSequence: number
  gap: boolean
  truncated: boolean
  content: string
}

export type TerminalOutputMirrorOptions = {
  maxTerminalBytes?: number
  maxTotalBytes?: number
  maxChunkBytes?: number
  ttlMs?: number
  now?: () => number
}

const DEFAULT_MAX_TERMINAL_BYTES = 262_144
const DEFAULT_MAX_TOTAL_BYTES = 8_388_608
const DEFAULT_MAX_CHUNK_BYTES = 262_144
const DEFAULT_TTL_MS = 5 * 60_000
const DEFAULT_MAX_READ_BYTES = 8_192
const MAX_READ_BYTES = 32_768

const identityKey = (threadId: string, terminalId: string) => `${threadId}\0${terminalId}`
const instanceKey = (threadId: string, terminalId: string, instanceId: string) =>
  `${identityKey(threadId, terminalId)}\0${instanceId}`

const utf8Tail = (value: string, maximumBytes: number) => {
  const encoded = Buffer.from(value, 'utf8')
  if (encoded.byteLength <= maximumBytes) return value
  return encoded.subarray(encoded.byteLength - maximumBytes).toString('utf8')
}

/** Volatile, sanitized terminal output for the approval-gated TerminalRead tool. */
export class TerminalOutputMirror {
  private readonly entries = new Map<string, MirrorEntry>()
  private readonly currentInstances = new Map<string, string>()
  private readonly maxTerminalBytes: number
  private readonly maxTotalBytes: number
  private readonly maxChunkBytes: number
  private readonly ttlMs: number
  private readonly now: () => number
  private totalBytes = 0

  constructor(options: TerminalOutputMirrorOptions = {}) {
    this.maxTerminalBytes = options.maxTerminalBytes ?? DEFAULT_MAX_TERMINAL_BYTES
    this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES
    this.maxChunkBytes = options.maxChunkBytes ?? DEFAULT_MAX_CHUNK_BYTES
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.now = options.now ?? Date.now
  }

  reset(input: TerminalOutputResetParams) {
    this.pruneExpired()
    if (input.nextSequence < input.oldestSequence) this.invalid()
    let previousSequence = input.oldestSequence - 1
    for (const chunk of input.chunks) {
      if (
        chunk.terminalId !== input.terminalId ||
        chunk.instanceId !== input.instanceId ||
        chunk.sequence < input.oldestSequence ||
        chunk.sequence >= input.nextSequence ||
        chunk.sequence <= previousSequence
      )
        this.invalid()
      previousSequence = chunk.sequence
    }

    const identity = identityKey(input.threadId, input.terminalId)
    const previousInstance = this.currentInstances.get(identity)
    if (previousInstance)
      this.deleteEntry(instanceKey(input.threadId, input.terminalId, previousInstance))
    const sanitizer = new TerminalControlStripper()
    const entry: MirrorEntry = {
      threadId: input.threadId,
      terminalId: input.terminalId,
      instanceId: input.instanceId,
      oldestSequence: input.oldestSequence,
      nextSequence: input.nextSequence,
      chunks: [],
      bytes: 0,
      gap: input.chunks.some((chunk, index) =>
        index === 0
          ? chunk.sequence !== input.oldestSequence
          : chunk.sequence !== input.chunks[index - 1]!.sequence + 1,
      ),
      truncated: input.oldestSequence > 0,
      updatedAt: this.now(),
      sanitizer,
    }
    this.entries.set(instanceKey(input.threadId, input.terminalId, input.instanceId), entry)
    this.currentInstances.set(identity, input.instanceId)
    for (const chunk of input.chunks) this.storeChunk(entry, chunk.sequence, chunk.data)
    this.enforceBounds(entry)
  }

  append(input: TerminalOutputAppendParams) {
    this.pruneExpired()
    const { chunk } = input
    const current = this.currentInstances.get(identityKey(input.threadId, chunk.terminalId))
    if (current !== chunk.instanceId) this.invalid()
    const entry = this.entries.get(instanceKey(input.threadId, chunk.terminalId, chunk.instanceId))
    if (!entry) this.invalid()
    if (chunk.sequence < entry.nextSequence) return
    if (chunk.sequence > entry.nextSequence) entry.gap = true
    this.storeChunk(entry, chunk.sequence, chunk.data)
    entry.nextSequence = chunk.sequence + 1
    entry.oldestSequence = entry.chunks[0]?.sequence ?? entry.nextSequence
    entry.updatedAt = this.now()
    this.enforceBounds(entry)
  }

  clear(input: TerminalOutputClearParams) {
    this.pruneExpired()
    const identity = identityKey(input.threadId, input.terminalId)
    if (this.currentInstances.get(identity) !== input.instanceId) return
    this.currentInstances.delete(identity)
    this.deleteEntry(instanceKey(input.threadId, input.terminalId, input.instanceId))
  }

  read(input: {
    threadId: string
    terminalId?: string
    afterSequence?: number
    maxBytes?: number
  }): TerminalOutputReadResult | null {
    this.pruneExpired()
    const candidates = [...this.entries.values()].filter(
      (entry) =>
        entry.threadId === input.threadId &&
        (!input.terminalId || entry.terminalId === input.terminalId),
    )
    const entry = candidates.sort((left, right) => right.updatedAt - left.updatedAt)[0]
    if (!entry) return null
    const afterSequence = input.afterSequence ?? -1
    const maximumBytes = Math.min(
      Math.max(input.maxBytes ?? DEFAULT_MAX_READ_BYTES, 1),
      MAX_READ_BYTES,
    )
    const available = entry.chunks.filter((chunk) => chunk.sequence > afterSequence)
    const selected: StoredChunk[] = []
    let selectedBytes = 0
    let clippedChunk = false
    for (let index = available.length - 1; index >= 0; index -= 1) {
      const chunk = available[index]!
      if (selected.length > 0 && selectedBytes + chunk.bytes > maximumBytes) break
      const data =
        selected.length === 0 && chunk.bytes > maximumBytes
          ? utf8Tail(chunk.data, maximumBytes)
          : chunk.data
      if (data !== chunk.data) clippedChunk = true
      selected.unshift({ sequence: chunk.sequence, data, bytes: Buffer.byteLength(data, 'utf8') })
      selectedBytes += Buffer.byteLength(data, 'utf8')
    }
    const omitted = selected.length < available.length
    return {
      terminalId: entry.terminalId,
      instanceId: entry.instanceId,
      oldestSequence: entry.oldestSequence,
      nextSequence: entry.nextSequence,
      gap: entry.gap || afterSequence < entry.oldestSequence - 1 || omitted || clippedChunk,
      truncated: entry.truncated || omitted || clippedChunk,
      content: selected.map((chunk) => chunk.data).join(''),
    }
  }

  private storeChunk(entry: MirrorEntry, sequence: number, rawData: string) {
    const plainText = entry.sanitizer.write(rawData)
    const scrubbed = secretScrubber.scrubText(plainText)
    const data = utf8Tail(scrubbed, this.maxChunkBytes)
    const bytes = Buffer.byteLength(data, 'utf8')
    if (bytes === 0) return
    entry.chunks.push({ sequence, data, bytes })
    entry.bytes += bytes
    this.totalBytes += bytes
    if (bytes < Buffer.byteLength(scrubbed, 'utf8')) entry.truncated = true
  }

  private enforceBounds(entry: MirrorEntry) {
    while (entry.bytes > this.maxTerminalBytes && entry.chunks.length > 1) {
      this.removeOldestChunk(entry)
    }
    entry.oldestSequence = entry.chunks[0]?.sequence ?? entry.nextSequence
    while (this.totalBytes > this.maxTotalBytes && this.entries.size > 0) {
      const oldest = [...this.entries.entries()].sort(
        ([, left], [, right]) => left.updatedAt - right.updatedAt,
      )[0]
      if (!oldest) break
      this.currentInstances.delete(identityKey(oldest[1].threadId, oldest[1].terminalId))
      this.deleteEntry(oldest[0])
    }
  }

  private removeOldestChunk(entry: MirrorEntry) {
    const removed = entry.chunks.shift()
    if (!removed) return
    entry.bytes -= removed.bytes
    this.totalBytes -= removed.bytes
    entry.truncated = true
    entry.gap = true
  }

  private pruneExpired() {
    const cutoff = this.now() - this.ttlMs
    for (const [key, entry] of this.entries) {
      if (entry.updatedAt > cutoff) continue
      this.currentInstances.delete(identityKey(entry.threadId, entry.terminalId))
      this.deleteEntry(key)
    }
  }

  private deleteEntry(key: string) {
    const entry = this.entries.get(key)
    if (!entry) return
    this.totalBytes -= entry.bytes
    this.entries.delete(key)
  }

  private invalid(): never {
    throw new AgentError('TERMINAL_OUTPUT_INVALID', '终端输出镜像序列或身份无效', 409)
  }
}
