import { describe, expect, test } from 'bun:test'
import { TerminalOutputBuffer } from '../src/terminal/TerminalOutputBuffer'

describe('终端输出缓冲', () => {
  test('使用单调序号回放并报告淘汰间隙', () => {
    const buffer = new TerminalOutputBuffer('terminal', 'instance', 6)
    expect(buffer.append('abc').sequence).toBe(0)
    expect(buffer.append('def').sequence).toBe(1)
    expect(buffer.append('ghi').sequence).toBe(2)

    expect(buffer.replay(0)).toMatchObject({
      oldestSequence: 1,
      nextSequence: 3,
      gap: false,
      truncated: true,
      chunks: [
        { sequence: 1, data: 'def' },
        { sequence: 2, data: 'ghi' },
      ],
    })
    expect(buffer.replay(-1).gap).toBe(true)
  })

  test('按 UTF-8 字节限制保留尾部而不产生破损字符', () => {
    const buffer = new TerminalOutputBuffer('terminal', 'instance', 6)
    buffer.append('a中文')
    const replay = buffer.replay(-1)
    expect(replay.chunks[0]?.data).toBe('中文')
    expect(Buffer.byteLength(replay.chunks[0]?.data ?? '', 'utf8')).toBeLessThanOrEqual(6)
    expect(replay.truncated).toBe(true)
  })
})
