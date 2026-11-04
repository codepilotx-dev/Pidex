import { expect, test } from 'bun:test'
import {
  enqueueReasoningLine,
  reasoningLatestLine,
  reasoningPlaybackQueue,
} from '../src/features/session/timeline/ReasoningPresentation.js'

test('reasoning preview preserves Markdown and normalizes line endings', () => {
  expect(reasoningLatestLine('**开始检查**\r\n\r# **确认调用方** `代码`\n ')).toEqual({
    lineIndex: 2,
    text: '# **确认调用方** `代码`',
  })
  expect(reasoningLatestLine(' \r\n\t')).toBeNull()
})

test('reasoning queue refreshes a pending line and retains only next and latest', () => {
  const first = { lineIndex: 1, text: 'one' }
  const second = { lineIndex: 2, text: 'two' }
  const third = { lineIndex: 3, text: 'three' }
  expect(enqueueReasoningLine([], first)).toEqual([first])
  const queue = enqueueReasoningLine([first, second], third)
  expect(queue).toEqual([first, third])
  expect(enqueueReasoningLine(queue, { ...first, text: 'one updated' })).toEqual([
    { ...first, text: 'one updated' },
    third,
  ])
  expect(reasoningPlaybackQueue(queue, 0)).toEqual(queue)
  expect(reasoningPlaybackQueue(queue, 251)).toEqual([third])
})
