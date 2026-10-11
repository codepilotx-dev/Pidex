import { expect, test } from 'bun:test'
import { resolveAvailableCodingModel } from '../src/features/session/composer/CodingModelSelection.js'

test('代码模型仅在仍存在于 Provider 目录时参与计划实施切换', () => {
  const providers = [
    {
      providerID: 'openai',
      modelPresets: [{ id: 'gpt-code', label: 'GPT Code', value: 'gpt-code' }],
    },
  ]

  expect(resolveAvailableCodingModel('openai/gpt-code', providers)).toBe('openai/gpt-code')
  expect(resolveAvailableCodingModel('openai/removed', providers)).toBeUndefined()
  expect(resolveAvailableCodingModel('invalid', providers)).toBeUndefined()
})
