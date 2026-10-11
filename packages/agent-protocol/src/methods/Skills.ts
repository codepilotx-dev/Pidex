import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import { OperationParamsSchema, SequenceSchema, TimestampSchema } from '../wire/Primitives'

const SkillPathSchema = Schema.String.check(Schema.isMinLength(1))

export const SkillScopeSchema = Schema.Literals(['workspace', 'user'])
export const SkillFormatSchema = Schema.Literals(['pidex', 'agents', 'codex', 'claude'])

export const InstalledSkillSchema = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)),
  description: Schema.String,
  path: SkillPathSchema,
  scope: SkillScopeSchema,
  format: SkillFormatSchema,
  enabled: Schema.Boolean,
})

export const SkillListParamsSchema = Schema.Struct({
  workspace: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  forceReload: Schema.optional(Schema.Boolean),
})

export const SkillListResultSchema = Schema.Struct({
  skills: Schema.Array(InstalledSkillSchema),
  generation: SequenceSchema,
  updatedAt: TimestampSchema,
})

export const SkillReadParamsSchema = Schema.Struct({
  workspace: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  path: SkillPathSchema,
})

export const SkillReadResultSchema = Schema.Struct({
  skill: InstalledSkillSchema,
  content: Schema.String,
})

export const SkillSetEnabledParamsSchema = Schema.Struct({
  path: SkillPathSchema,
  enabled: Schema.Boolean,
  ...OperationParamsSchema.fields,
})

export const SkillSetEnabledResultSchema = Schema.Struct({
  skill: InstalledSkillSchema,
  generation: SequenceSchema,
  updatedAt: TimestampSchema,
})

const SkillErrors = ['SKILL_NOT_FOUND', 'PATH_DENIED', 'CONFLICT', 'INTERNAL_ERROR'] as const

export const SkillRpcMethods = {
  'skill/list': defineMethod({
    params: SkillListParamsSchema,
    result: SkillListResultSchema,
    errors: SkillErrors,
    capability: 'skills.manage.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'skill/read': defineMethod({
    params: SkillReadParamsSchema,
    result: SkillReadResultSchema,
    errors: SkillErrors,
    capability: 'skills.manage.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'skill/setEnabled': defineMethod({
    params: SkillSetEnabledParamsSchema,
    result: SkillSetEnabledResultSchema,
    errors: SkillErrors,
    capability: 'skills.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type InstalledSkill = typeof InstalledSkillSchema.Type
export type SkillScope = typeof SkillScopeSchema.Type
export type SkillFormat = typeof SkillFormatSchema.Type
