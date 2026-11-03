import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import {
  InteractionQuestionSchema,
  QUESTION_CHOICES_READ_MAX,
  QUESTION_CHOICES_WRITE_MAX,
} from '@pidex/shared/thread'

const question = (choiceCount: number) => ({
  id: 'optimization_axis',
  header: '方向',
  prompt: '主要指哪个方向？',
  choices: Array.from({ length: choiceCount }, (_, index) => ({
    id: `c${index}`,
    label: `选项 ${index}`,
    description: '说明',
    recommended: false,
  })),
  allowFreeform: true as const,
  required: true as const,
})

const decodes = (choiceCount: number) =>
  Schema.decodeUnknownSync(InteractionQuestionSchema)(question(choiceCount))

describe('InteractionQuestionSchema 选项上限', () => {
  test('读取侧宽于写入侧，接受其它构建写入的 5 个选项', () => {
    expect(QUESTION_CHOICES_READ_MAX).toBeGreaterThan(QUESTION_CHOICES_WRITE_MAX)
    expect(decodes(5).choices).toHaveLength(5)
    expect(decodes(QUESTION_CHOICES_READ_MAX).choices).toHaveLength(QUESTION_CHOICES_READ_MAX)
  })

  test('仍拒绝单个选项与超出读取上限的数据', () => {
    expect(() => decodes(1)).toThrow()
    expect(() => decodes(QUESTION_CHOICES_READ_MAX + 1)).toThrow()
    expect(decodes(0).choices).toHaveLength(0)
  })
})
