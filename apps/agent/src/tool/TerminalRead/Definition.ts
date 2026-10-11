import { z } from 'zod'
import type {
  TerminalOutputMirror,
  TerminalOutputReadResult,
} from '../../terminal/TerminalOutputMirror'
import { AgentError } from '../../Domain'
import type { ToolDefinition } from '../ToolRegistry'

const escapeUntrustedTerminalOutput = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const schema = z
  .object({
    terminalId: z.string().min(1).optional(),
    afterSequence: z.number().int().min(-1).optional(),
    maxBytes: z.number().int().min(1).max(32_768).optional(),
  })
  .strict()

type TerminalReadOutput =
  | TerminalOutputReadResult
  | {
      terminalId: string | null
      instanceId: null
      oldestSequence: 0
      nextSequence: 0
      gap: false
      truncated: false
      content: ''
      unavailable: true
    }

export const createTerminalReadDefinition = (
  mirror: TerminalOutputMirror,
): ToolDefinition<z.infer<typeof schema>, TerminalReadOutput> => ({
  sdkName: 'TerminalRead',
  name: 'terminal.read',
  schema,
  description:
    '读取当前任务的集成终端纯文本输出。输出已移除终端控制序列并脱敏；仅在确实需要观察终端结果时使用。',
  capabilities: {
    filesystem: 'none',
    network: 'none',
    process: false,
    externalState: false,
    userInteraction: true,
  },
  allowedModes: ['chat', 'plan'],
  allowedProfiles: ['main'],
  approvalStrategy: 'policy',
  visibility: 'deferred',
  executionMode: 'sequential',
  inputSchema: {
    type: 'object',
    properties: {
      terminalId: {
        type: 'string',
        description: '可选的终端 ID；省略时读取当前任务最近更新的终端。',
      },
      afterSequence: {
        type: 'integer',
        minimum: -1,
        description: '只读取该序号之后的输出。首次读取可省略。',
      },
      maxBytes: {
        type: 'integer',
        minimum: 1,
        maximum: 32_768,
        default: 8_192,
        description: '返回的最大 UTF-8 字节数；默认 8192。',
      },
    },
    additionalProperties: false,
  },
  execute: async (input, context) => {
    const threadId = context.invocation?.threadID
    if (!threadId)
      throw new AgentError('TERMINAL_CONTEXT_REQUIRED', '终端读取缺少受信任的任务上下文', 403)
    return (
      mirror.read({
        threadId,
        ...(input.terminalId === undefined ? {} : { terminalId: input.terminalId }),
        ...(input.afterSequence === undefined ? {} : { afterSequence: input.afterSequence }),
        ...(input.maxBytes === undefined ? {} : { maxBytes: input.maxBytes }),
      }) ?? {
        terminalId: input.terminalId ?? null,
        instanceId: null,
        oldestSequence: 0,
        nextSequence: 0,
        gap: false,
        truncated: false,
        content: '',
        unavailable: true,
      }
    )
  },
  formatResult: (output) => {
    const { content, ...metadata } = output
    return {
      content: [
        JSON.stringify(metadata),
        '<untrusted_terminal_output>',
        escapeUntrustedTerminalOutput(content),
        '</untrusted_terminal_output>',
      ].join('\n'),
      details: metadata,
    }
  },
})
