import { Schema } from 'effect'
import { PermissionConfigSchema } from './Permission'

export const TaskModeSchema = Schema.Literals(['chat', 'plan', 'grill'])
export type TaskMode = typeof TaskModeSchema.Type

/** Plan and Grill investigate read-only until the user confirms the requirements. */
export const isReadOnlyTaskMode = (mode: TaskMode): boolean => mode === 'plan' || mode === 'grill'

export const MaxContextTokensSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 10_000_000 }),
)
export type MaxContextTokens = typeof MaxContextTokensSchema.Type

export const ThreadSettingsSchema = Schema.Struct({
  taskMode: TaskModeSchema,
  permissionConfig: PermissionConfigSchema,
  maxContextTokens: Schema.optional(Schema.NullOr(MaxContextTokensSchema)),
})
export type ThreadSettings = typeof ThreadSettingsSchema.Type

export const ThreadSettingsPatchSchema = Schema.Struct({
  taskMode: Schema.optional(TaskModeSchema),
  permissionConfig: Schema.optional(PermissionConfigSchema),
  maxContextTokens: Schema.optional(Schema.NullOr(MaxContextTokensSchema)),
})
export type ThreadSettingsPatch = typeof ThreadSettingsPatchSchema.Type
