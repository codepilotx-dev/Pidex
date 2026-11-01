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
  reasoningLevelValues: '',
  reasoningLevelMap: '',
  maxOutputTokensMax: 0,
  maxOutputTokensMap: '',
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

  test('已固定字段不被推荐覆盖，未固定字段继续跟随', () => {
    const filled = fillModelDraft(
      draft(),
      {
        name: 'Recommended',
        contextWindow: 128000,
        maxTokens: 16000,
        input: ['text', 'image', 'audio'],
        cost: { input: 1, output: 2 },
      },
      ['contextWindow', 'audioInput', 'inputCost'],
    )
    expect(filled).toMatchObject({
      name: 'Recommended',
      contextWindow: 32000,
      maxTokens: 16000,
      imageInput: true,
      inputCost: 2,
      outputCost: 2,
      videoInput: false,
    })
    // 被固定的 audioInput 保持草稿原值（未设置，即 undefined），不跟随推荐变成 true。
    expect(filled.audioInput).toBeUndefined()
  })

  test('推荐携带 optionSpecs 时填入 values/map/max', () => {
    const filled = fillModelDraft(draft(), {
      optionSpecs: {
        reasoningLevel: {
          values: ['none', 'low', 'high', 'max'],
          map: '{"reasoning_effort": reasoningLevel}',
        },
        maxOutputTokens: { max: 64000, map: '{"max_tokens": maxOutputTokens}' },
      },
    })
    expect(filled).toMatchObject({
      reasoningLevelValues: 'none\nlow\nhigh\nmax',
      reasoningLevelMap: '{"reasoning_effort": reasoningLevel}',
      maxOutputTokensMax: 64000,
      maxOutputTokensMap: '{"max_tokens": maxOutputTokens}',
    })
  })

  test('没有 optionSpecs 时回退到 reasoningLevels 固定档位', () => {
    const filled = fillModelDraft(draft(), {
      reasoningLevels: ['off', 'low', 'high', 'max'],
    })
    expect(filled.reasoningLevelValues).toBe('off\nlow\nhigh\nmax')
    expect(filled.reasoningLevelMap).toBe('')
  })

  test('已固定的 reasoning/maxTokens 分别保护对应 optionSpecs 子字段', () => {
    const filled = fillModelDraft(
      { ...draft(), reasoningLevelValues: 'keep-me', maxOutputTokensMax: 1024 },
      {
        optionSpecs: {
          reasoningLevel: { values: ['none', 'high'], map: '{"reasoning_effort": reasoningLevel}' },
          maxOutputTokens: { max: 64000, map: '{"max_tokens": maxOutputTokens}' },
        },
        reasoningLevels: ['off', 'high'],
      },
      ['reasoning', 'maxTokens'],
    )
    expect(filled.reasoningLevelValues).toBe('keep-me')
    expect(filled.maxOutputTokensMax).toBe(1024)
    expect(filled.reasoningLevelMap).toBe('')
    expect(filled.maxOutputTokensMap).toBe('')
  })
})
