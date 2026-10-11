import {
  ToolingInstallParamsSchema,
  ToolingSetPreferenceParamsSchema,
  type RpcMethod,
} from '@pidex/agent-protocol'
import { Schema } from 'effect'
import { AgentError } from '../../../Domain'
import { ToolingError } from '../../../tool/ToolingManager'
import type { RpcRouter } from '../RpcRouter'
import type { RpcRouterContext } from '../RequestContext'
import type { RpcHandlerGroup } from './Types'

const decodeSetPreference = Schema.decodeUnknownSync(ToolingSetPreferenceParamsSchema)
const decodeInstall = Schema.decodeUnknownSync(ToolingInstallParamsSchema)

export const toolingHandlers = {
  name: 'tooling',
  methods: ['tooling/list', 'tooling/refresh', 'tooling/setPreference', 'tooling/install'],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ): Promise<unknown> {
    const tooling = runtime.dependencies.tooling
    try {
      switch (method) {
        case 'tooling/list':
          return { statuses: await tooling.listStatuses() }
        case 'tooling/refresh':
          return { statuses: await tooling.refreshStatuses() }
        case 'tooling/setPreference': {
          const params = decodeSetPreference(rawParams)
          await runtime.dependencies.config.writeValue({
            keyPath: ['desktop', 'tooling', params.id],
            value: params.preference,
          })
          return { status: await tooling.setPreference(params.id, params.preference) }
        }
        case 'tooling/install': {
          const params = decodeInstall(rawParams)
          return {
            status: await tooling.install(params.id, {
              force: params.force === true,
            }),
          }
        }
        default:
          return undefined
      }
    } catch (cause) {
      if (cause instanceof ToolingError) {
        const code =
          cause.code === 'TOOLING_ABORTED'
            ? 'TOOLING_ABORTED'
            : method === 'tooling/install' &&
                /CHECKSUM|INTEGRITY|ARCHIVE_UNSAFE|VALIDATION/.test(cause.code)
              ? 'TOOLING_INTEGRITY_FAILED'
              : method === 'tooling/install'
                ? 'TOOLING_DOWNLOAD_FAILED'
                : 'TOOLING_UNAVAILABLE'
        throw new AgentError(code, cause.message, 503)
      }
      throw cause
    }
  },
} as const satisfies RpcHandlerGroup
