import { z } from 'zod'

export const executionPlanStepStatusSchema = z.enum(['pending', 'in_progress', 'completed'])

export const executionPlanInputSchema = z
  .object({
    explanation: z.string().trim().min(1).optional(),
    plan: z
      .array(
        z
          .object({
            step: z.string().trim().min(1),
            status: executionPlanStepStatusSchema,
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((input, context) => {
    const normalized = input.plan.map(({ step }) => step.toLocaleLowerCase())
    if (new Set(normalized).size !== normalized.length) {
      context.addIssue({
        code: 'custom',
        path: ['plan'],
        message: '计划步骤必须唯一',
      })
    }
    if (input.plan.filter(({ status }) => status === 'in_progress').length > 1) {
      context.addIssue({
        code: 'custom',
        path: ['plan'],
        message: '最多只能有一个进行中的步骤',
      })
    }
  })

export type ExecutionPlanInput = z.infer<typeof executionPlanInputSchema>
