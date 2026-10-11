import { z } from 'zod'

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
      .max(3)
      .refine((options) => options.length !== 1, '提供零项或二至三项选项'),
    multiSelect: z
      .boolean()
      .refine((value) => !value, 'Plan 问题仅支持单选')
      .optional(),
  })
  .strict()

export const requestUserInputSchema = z
  .object({
    questions: z.array(richQuestionSchema).min(1).max(3),
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
    maxAnswers: 1,
  }))
