import {
  ConfigBatchWriteParamsSchema,
  ConfigProfileSelectParamsSchema,
  ConfigReadParamsSchema,
  ConfigValueWriteParamsSchema,
  ProjectTrustReadParamsSchema,
  ProjectTrustUpdateParamsSchema,
  type RpcMethod,
} from '@pidex/agent-protocol'
import { Schema } from 'effect'
import { ConfigServiceError } from '../../../config/ConfigService'
import { AgentError } from '../../../Domain'
import type { RpcRouter } from '../RpcRouter'
import type { RpcRouterContext } from '../RequestContext'
import type { RpcHandlerGroup } from './Types'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

const decodeRead = Schema.decodeUnknownSync(ConfigReadParamsSchema)
const decodeValueWrite = Schema.decodeUnknownSync(ConfigValueWriteParamsSchema)
const decodeBatchWrite = Schema.decodeUnknownSync(ConfigBatchWriteParamsSchema)
const decodeProfileSelect = Schema.decodeUnknownSync(ConfigProfileSelectParamsSchema)
const decodeTrustRead = Schema.decodeUnknownSync(ProjectTrustReadParamsSchema)
const decodeTrustUpdate = Schema.decodeUnknownSync(ProjectTrustUpdateParamsSchema)

const requireKnownWorkspace = (runtime: RpcRouter, cwd: string | undefined) => {
  if (!cwd) return
  if (!isAbsolute(cwd)) {
    throw new AgentError('CONFIG_PATH_NOT_FOUND', '项目配置路径无效', 404)
  }
  const canonical = resolve(cwd)
  const known = runtime.dependencies.db.listProjects().some((project) => {
    const root = resolve(project.rootPath)
    const child = relative(root, canonical)
    return child === '' || (!child.startsWith('..') && !isAbsolute(child))
  })
  if (!known) {
    throw new AgentError('CONFIG_PATH_NOT_FOUND', '项目不属于当前 Agent 已知工作区', 404)
  }
}

const mapConfigError = (cause: unknown): never => {
  if (cause instanceof ConfigServiceError) {
    const status =
      cause.code === 'CONFIG_PATH_NOT_FOUND' || cause.code === 'CONFIG_PROFILE_NOT_FOUND'
        ? 404
        : cause.code === 'CONFIG_VERSION_CONFLICT'
          ? 409
          : cause.code === 'CONFIG_PROJECT_UNTRUSTED' || cause.code === 'CONFIG_LAYER_READONLY'
            ? 403
            : 400
    throw new AgentError(cause.code, cause.message, status)
  }
  throw cause
}

export const configHandlers = {
  name: 'config',
  methods: [
    'config/read',
    'config/value/write',
    'config/batchWrite',
    'config/profile/list',
    'config/profile/select',
    'project/trust/read',
    'project/trust/update',
  ],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ) {
    const config = runtime.dependencies.config
    try {
      switch (method) {
        case 'config/read': {
          const params = decodeRead(rawParams)
          requireKnownWorkspace(runtime, params.cwd)
          return await config.read(params)
        }
        case 'config/value/write': {
          const params = decodeValueWrite(rawParams)
          if (params.cwd) requireKnownWorkspace(runtime, params.cwd)
          if (params.filePath && resolve(params.filePath) !== resolve(config.userConfigPath)) {
            requireKnownWorkspace(runtime, params.cwd ?? dirname(dirname(params.filePath)))
          }
          return await config.writeValue(params as never)
        }
        case 'config/batchWrite': {
          const params = decodeBatchWrite(rawParams)
          if (params.cwd) requireKnownWorkspace(runtime, params.cwd)
          if (params.filePath && resolve(params.filePath) !== resolve(config.userConfigPath)) {
            requireKnownWorkspace(runtime, params.cwd ?? dirname(dirname(params.filePath)))
          }
          return await config.batchWrite(params as never)
        }
        case 'config/profile/list':
          return await config.profileList()
        case 'config/profile/select': {
          const params = decodeProfileSelect(rawParams)
          return await config.profileSelect(params.profileId)
        }
        case 'project/trust/read': {
          const params = decodeTrustRead(rawParams)
          requireKnownWorkspace(runtime, params.cwd)
          return await config.trustRead(params.cwd)
        }
        case 'project/trust/update': {
          const params = decodeTrustUpdate(rawParams)
          requireKnownWorkspace(runtime, params.cwd)
          return await config.trustUpdate(params.cwd, params.trustLevel, params.expectedVersion)
        }
        default:
          return undefined
      }
    } catch (cause) {
      return mapConfigError(cause)
    }
  },
} as const satisfies RpcHandlerGroup
