import { expect, test } from 'bun:test'
import { reasoningHeading } from '../src/features/session/timeline/ReasoningPresentation.js'

test('reasoning status uses the latest non-empty line without Markdown title markers', () => {
  expect(reasoningHeading('**开始检查**\n\n**确认调用方**\n')).toBe('确认调用方')
  expect(reasoningHeading(' \n')).toBeNull()
})
