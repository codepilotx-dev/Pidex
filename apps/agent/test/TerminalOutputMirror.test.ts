import { describe, expect, test } from 'bun:test'
import { TerminalOutputMirror } from '../src/terminal/TerminalOutputMirror'

const reset = (mirror: TerminalOutputMirror, overrides: Record<string, unknown> = {}) =>
  mirror.reset({
    threadId: 'thread:1',
    terminalId: 'terminal:1',
    instanceId: 'instance:1',
    oldestSequence: 0,
    nextSequence: 0,
    chunks: [],
    state: 'running',
    exitCode: null,
    ...overrides,
  } as never)

const append = (mirror: TerminalOutputMirror, sequence: number, data: string) =>
  mirror.append({
    threadId: 'thread:1',
    chunk: {
      terminalId: 'terminal:1',
      instanceId: 'instance:1',
      sequence,
      data,
    },
  })

describe('TerminalOutputMirror', () => {
  test('只保留脱敏纯文本，并跨 chunk 丢弃终端控制序列', () => {
    const mirror = new TerminalOutputMirror()
    reset(mirror)
    append(mirror, 0, '\u001b[31mapi_key=secret-value\u001b[0m\r\n')
    append(mirror, 1, '\u001b]52;c;clipboard-')
    append(mirror, 2, 'secret\u0007visible\u0000\r\n')

    expect(mirror.read({ threadId: 'thread:1' })).toMatchObject({
      terminalId: 'terminal:1',
      instanceId: 'instance:1',
      oldestSequence: 0,
      nextSequence: 3,
      gap: false,
      content: 'api_key=<redacted>\r\nvisible\r\n',
    })
  })

  test('报告源序列 gap、保留实例身份并忽略旧实例 clear', () => {
    const mirror = new TerminalOutputMirror()
    reset(mirror)
    append(mirror, 2, 'later')
    expect(mirror.read({ threadId: 'thread:1', afterSequence: -1 })).toMatchObject({
      oldestSequence: 2,
      nextSequence: 3,
      gap: true,
      content: 'later',
    })

    mirror.reset({
      threadId: 'thread:1',
      terminalId: 'terminal:1',
      instanceId: 'instance:2',
      oldestSequence: 0,
      nextSequence: 1,
      chunks: [{ terminalId: 'terminal:1', instanceId: 'instance:2', sequence: 0, data: 'new' }],
      state: 'running',
      exitCode: null,
    })
    mirror.clear({ threadId: 'thread:1', terminalId: 'terminal:1', instanceId: 'instance:1' })
    expect(mirror.read({ threadId: 'thread:1' })?.content).toBe('new')
  })

  test('按字节裁剪并在 TTL 到期后彻底丢弃', () => {
    let now = 100
    const mirror = new TerminalOutputMirror({
      maxTerminalBytes: 8,
      maxTotalBytes: 16,
      maxChunkBytes: 8,
      ttlMs: 50,
      now: () => now,
    })
    reset(mirror)
    append(mirror, 0, '123456')
    append(mirror, 1, 'abcdef')
    expect(mirror.read({ threadId: 'thread:1' })).toMatchObject({
      oldestSequence: 1,
      truncated: true,
      gap: true,
      content: 'abcdef',
    })
    now = 151
    expect(mirror.read({ threadId: 'thread:1' })).toBeNull()
  })
})
