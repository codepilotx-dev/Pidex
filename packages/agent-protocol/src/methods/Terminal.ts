import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import {
  NonEmptyStringSchema,
  OkResultSchema,
  OpaqueIDSchema,
  SequenceSchema,
} from '../wire/Primitives'
const TerminalDataSchema = Schema.String.check(Schema.isMaxLength(262_144))
const TerminalErrors = [
  'THREAD_NOT_FOUND',
  'PERMISSION_DENIED',
  'TERMINAL_OUTPUT_INVALID',
  'TERMINAL_OUTPUT_TOO_LARGE',
  'INTERNAL_ERROR',
] as const

export const TerminalHostContextParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
})

export const TerminalHostContextResultSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  bindingId: OpaqueIDSchema,
  contextVersion: NonEmptyStringSchema,
  workspaceKind: Schema.Literals(['project', 'projectless']),
  target: Schema.Struct({
    kind: Schema.Literals(['local', 'worktree']),
    cwd: NonEmptyStringSchema,
  }),
})

export const TerminalOutputChunkSchema = Schema.Struct({
  terminalId: OpaqueIDSchema,
  instanceId: OpaqueIDSchema,
  sequence: SequenceSchema,
  data: TerminalDataSchema,
})

export const TerminalOutputResetParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  terminalId: OpaqueIDSchema,
  instanceId: OpaqueIDSchema,
  oldestSequence: SequenceSchema,
  nextSequence: SequenceSchema,
  chunks: Schema.Array(TerminalOutputChunkSchema).check(Schema.isMaxLength(4_096)),
  state: Schema.Literals(['starting', 'running', 'closing', 'exited', 'failed']),
  exitCode: Schema.NullOr(Schema.Int),
})

export const TerminalOutputAppendParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  chunk: TerminalOutputChunkSchema,
})

export const TerminalOutputClearParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  terminalId: OpaqueIDSchema,
  instanceId: OpaqueIDSchema,
})

export type TerminalHostContextParams = typeof TerminalHostContextParamsSchema.Type
export type TerminalHostContextResult = typeof TerminalHostContextResultSchema.Type
export type TerminalOutputChunk = typeof TerminalOutputChunkSchema.Type
export type TerminalOutputResetParams = typeof TerminalOutputResetParamsSchema.Type
export type TerminalOutputAppendParams = typeof TerminalOutputAppendParamsSchema.Type
export type TerminalOutputClearParams = typeof TerminalOutputClearParamsSchema.Type

export const TerminalRpcMethods = {
  'terminal/host/context': defineMethod({
    params: TerminalHostContextParamsSchema,
    result: TerminalHostContextResultSchema,
    errors: TerminalErrors,
    capability: 'terminal.host.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'terminal/host/output/reset': defineMethod({
    params: TerminalOutputResetParamsSchema,
    result: OkResultSchema,
    errors: TerminalErrors,
    capability: 'terminal.host.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'terminal/host/output/append': defineMethod({
    params: TerminalOutputAppendParamsSchema,
    result: OkResultSchema,
    errors: TerminalErrors,
    capability: 'terminal.host.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'terminal/host/output/clear': defineMethod({
    params: TerminalOutputClearParamsSchema,
    result: OkResultSchema,
    errors: TerminalErrors,
    capability: 'terminal.host.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type TerminalRpcMethod = keyof typeof TerminalRpcMethods
export type TerminalRpcMethodMap = typeof TerminalRpcMethods
