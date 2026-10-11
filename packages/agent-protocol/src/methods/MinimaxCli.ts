import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import {
  NonEmptyStringSchema,
  OperationParamsSchema,
  SequenceSchema,
  TimestampSchema,
} from '../wire/Primitives'

export const MiniMaxCliInstallationStatusSchema = Schema.Literals([
  'not-installed',
  'installed',
  'installing',
  'updating',
  'uninstalling',
  'missing-prerequisite',
  'error',
])

export const MiniMaxCliAuthStatusSchema = Schema.Literals([
  'coding-plan-synced',
  'api-key',
  'oauth',
  'not-authenticated',
  'unknown',
])

export const MiniMaxCliCredentialSourceSchema = Schema.Struct({
  providerId: Schema.Literals(['minimax-cn-coding-plan', 'minimax-coding-plan']),
  credentialId: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  maskedValue: NonEmptyStringSchema,
  region: Schema.Literals(['cn', 'global']),
})

export const MiniMaxCliStatusSchema = Schema.Struct({
  installationStatus: MiniMaxCliInstallationStatusSchema,
  installedVersion: Schema.optional(NonEmptyStringSchema),
  latestVersion: Schema.optional(NonEmptyStringSchema),
  updateAvailable: Schema.Boolean,
  nodeVersion: Schema.optional(NonEmptyStringSchema),
  npmVersion: Schema.optional(NonEmptyStringSchema),
  prerequisiteReason: Schema.optional(NonEmptyStringSchema),
  authStatus: MiniMaxCliAuthStatusSchema,
  credentialSource: Schema.optional(MiniMaxCliCredentialSourceSchema),
  quotaStatus: Schema.optional(Schema.Literals(['available', 'unavailable', 'unknown'])),
  quotaLabel: Schema.optional(NonEmptyStringSchema),
  operationError: Schema.optional(NonEmptyStringSchema),
  generation: SequenceSchema,
  updatedAt: TimestampSchema,
})

export const MiniMaxCliStatusParamsSchema = Schema.Struct({
  forceReload: Schema.optional(Schema.Boolean),
})

export const MiniMaxCliMutationParamsSchema = Schema.Struct({
  ...OperationParamsSchema.fields,
})

const MiniMaxCliErrors = [
  'MINIMAX_CLI_PREREQUISITE_MISSING',
  'MINIMAX_CLI_INSTALL_FAILED',
  'MINIMAX_CLI_UNINSTALL_FAILED',
  'MINIMAX_CLI_CONFIG_FAILED',
  'CONFLICT',
  'PATH_DENIED',
  'INTERNAL_ERROR',
] as const

export const MiniMaxCliRpcMethods = {
  'minimaxCli/status': defineMethod({
    params: MiniMaxCliStatusParamsSchema,
    result: MiniMaxCliStatusSchema,
    errors: MiniMaxCliErrors,
    capability: 'integrations.minimax-cli.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'minimaxCli/install': defineMethod({
    params: MiniMaxCliMutationParamsSchema,
    result: MiniMaxCliStatusSchema,
    errors: MiniMaxCliErrors,
    capability: 'integrations.minimax-cli.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'minimaxCli/uninstall': defineMethod({
    params: MiniMaxCliMutationParamsSchema,
    result: MiniMaxCliStatusSchema,
    errors: MiniMaxCliErrors,
    capability: 'integrations.minimax-cli.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type MiniMaxCliInstallationStatus = typeof MiniMaxCliInstallationStatusSchema.Type
export type MiniMaxCliAuthStatus = typeof MiniMaxCliAuthStatusSchema.Type
export type MiniMaxCliCredentialSource = typeof MiniMaxCliCredentialSourceSchema.Type
export type MiniMaxCliStatus = typeof MiniMaxCliStatusSchema.Type
