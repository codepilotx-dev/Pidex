import { Schema } from 'effect'
import { PermissionConfigSchema } from './Permission'

export const TaskModeSchema = Schema.Literals(['chat', 'plan'])
export type TaskMode = typeof TaskModeSchema.Type

export const ThreadSettingsSchema = Schema.Struct({
  taskMode: TaskModeSchema,
  permissionConfig: PermissionConfigSchema,
})
export type ThreadSettings = typeof ThreadSettingsSchema.Type

export const ThreadSettingsPatchSchema = Schema.Struct({
  taskMode: Schema.optional(TaskModeSchema),
  permissionConfig: Schema.optional(PermissionConfigSchema),
})
export type ThreadSettingsPatch = typeof ThreadSettingsPatchSchema.Type
