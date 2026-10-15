import { describe, expect, test } from 'bun:test'
import type { EditableModel } from '../src/features/models/provider-management/ProviderEditorForm.js'
import { fillModelDraft } from '../src/features/models/provider-management/SmartModelDraft.js'

const draft = (): EditableModel => ({
  editorKey: 'one',
  id: 'example',
  name: 'Example',
  api: 'openai-completions',
  enabled: false,
  contextWindow: 32000,
  maxTokens: 8192,
  reasoning: true,
  imageInput: true,
  inputCost: 2,
  outputCost: 3,
  cacheReadCost: 0,
  cacheWriteCost: 0,
  headers: 'X-Test: keep',
  thinkingLevelMap: '',
  compat: '',
})

describe('模型智能填充', () => {
  test('推荐填入现有字段，保留未提供的值和连接参数，不修改原对象', () => {
    const original = draft()
    const filled = fillModelDraft(original, {
      contextWindow: 128000,
      maxInputTokens: 120000,
      maxTokens: 16000,
      reasoning: false,
      tools: false,
      input: [],
      cost: { input: 0 },
    })
    expect(filled).toMatchObject({
      contextWindow: 128000,
      maxInputTokens: 120000,
      maxTokens: 16000,
      reasoning: false,
      tools: false,
      imageInput: false,
      inputCost: 0,
      outputCost: 3,
      enabled: false,
      headers: 'X-Test: keep',
      api: 'openai-completions',
      id: 'example',
    })
    expect(original.contextWindow).toBe(32000)
  })
  test('填充后直接修改普通参数，不附加跟踪或持久化标记', () => {
    const filled = fillModelDraft(draft(), { name: 'Recommended', contextWindow: 128000 })
    const edited = { ...filled, contextWindow: 256000, name: 'My model' }
    expect(edited).toMatchObject({ name: 'My model', contextWindow: 256000 })
    expect(edited).not.toHaveProperty('smartConfig')
    expect(fillModelDraft(edited, {})).toEqual(edited)
  })
})
