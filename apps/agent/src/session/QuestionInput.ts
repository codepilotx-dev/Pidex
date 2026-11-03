import { z } from 'zod'
import { QUESTION_CHOICES_WRITE_MAX } from '@pidex/shared/thread'

export const questionOptionSchema = z
  .object({
    label: z.string().trim().min(1),
    description: z.string().trim().min(1),
    recommended: z.boolean().optional(),
  })
  .strict()

export const richQuestionSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    header: z.string().trim().min(1).max(12),
    question: z.string().trim().min(1),
    options: z
      .array(questionOptionSchema)
      .max(QUESTION_CHOICES_WRITE_MAX)
      .refine((options) => options.length !== 1, '提供零项或二至五项选项'),
    multiSelect: z.boolean().optional(),
  })
  .strict()

export const requestUserInputSchema = z
  .object({
    questions: z.array(richQuestionSchema).min(1).max(5),
    autoResolutionMs: z.number().int().min(60_000).max(240_000).optional(),
  })
  .strict()

export type RichQuestion = z.infer<typeof richQuestionSchema>
export type RequestUserInput = z.infer<typeof requestUserInputSchema>

export interface InteractionQuestion {
  id: string
  header: string
  prompt: string
  choices: Array<{
    id: string
    label: string
    description: string
    recommended: boolean
  }>
  allowFreeform: true
  required: true
  minAnswers: number
  maxAnswers: number
}

export const interactionQuestions = (questions: readonly RichQuestion[]): InteractionQuestion[] =>
  questions.map((question) => ({
    id: question.id,
    header: question.header,
    prompt: question.question,
    choices: question.options.map((option, index) => ({
      id: `${question.id}:${index}`,
      label: option.label,
      description: option.description,
      recommended: option.recommended ?? /[（(](?:recommended|推荐)[）)]\s*$/iu.test(option.label),
    })),
    allowFreeform: true,
    required: true,
    minAnswers: 1,
    // QuestionService 以 choiceIds.length + (text ? 1 : 0) 计数：多选可全选所有
    // 预设项并附加一段自由文本，因此上限是选项数加一。
    maxAnswers: question.multiSelect ? question.options.length + 1 : 1,
  }))
