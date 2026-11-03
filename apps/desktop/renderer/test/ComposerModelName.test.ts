import { expect, test } from 'bun:test'
import { splitComposerModelName } from '../src/features/session/composer/ComposerModelName.js'

test('模型 ID 按最后一个斜杠拆成前缀与模型尾段', () => {
  expect(splitComposerModelName('workbuddy/deepseek-v4.1-flash')).toEqual({
    prefix: 'workbuddy',
    model: 'deepseek-v4.1-flash',
  })
  expect(splitComposerModelName('group/auto-hy3')).toEqual({
    prefix: 'group',
    model: 'auto-hy3',
  })
  expect(splitComposerModelName('a/b/qwen3.8')).toEqual({
    prefix: 'a/b',
    model: 'qwen3.8',
  })
})

test('没有可拆分前缀时整体作为模型名', () => {
  expect(splitComposerModelName('mock')).toEqual({ prefix: '', model: 'mock' })
  expect(splitComposerModelName('/leading')).toEqual({ prefix: '', model: '/leading' })
  expect(splitComposerModelName('trailing/')).toEqual({ prefix: '', model: 'trailing/' })
})
