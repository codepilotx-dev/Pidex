import { expect, test } from 'bun:test'
import { modelLogoURL } from '../src/services/desktop-client/ModelLogo.js'

test('同组模型按各自品牌解析，未知 ID 可用名称识别', () => {
  expect(modelLogoURL('group/deepseek-v4')).toBe('https://models.dev/logos/deepseek.svg')
  expect(modelLogoURL('group/claude-opus')).toBe('https://models.dev/logos/anthropic.svg')
  expect(modelLogoURL('relay/GLM-5:free')).toBe('https://models.dev/logos/zai.svg')
  expect(modelLogoURL('opaque-id', 'Qwen3.5')).toBe('https://models.dev/logos/alibaba.svg')
  expect(modelLogoURL('unknown/model')).toBeUndefined()
  expect(modelLogoURL('group/deepseek', 'Claude')).toBe('https://models.dev/logos/deepseek.svg')
})
