import type { ProtocolCapability, RpcMethod } from '@pidex/agent-protocol'
import type { RpcRouter } from '../RpcRouter'
import type { RpcRouterContext } from '../RequestContext'
import { filterAdvertisedCapabilities, negotiateCapabilities } from './SystemCapabilities'
import {
  decodeRpcParams as decodeParams,
  optionalRpcRecord as optionalRecord,
  rpcRecord as record,
} from '../Decoders'
import { AgentError, decodeSandboxUninstall, stringParam } from '../RpcRouter'
import type { RpcHandlerGroup } from './Types'

const unsupportedSandboxResult = () => ({
  sandbox: {
    state: 'unsupported' as const,
    platform: process.platform,
    architecture: process.arch,
    runtimeVersion: 'host-hook-v1',
    maturity: 'alpha' as const,
    maxConcurrentCommands: 1,
    error: '内置命令沙箱已移除；Shell 经 Pi Hook 和权限检查后以当前用户身份在本机执行。',
    operations: {
      canInstall: false,
      canRepair: false,
      canUninstall: false,
    },
  },
})

export const systemHandlers = {
  name: 'system',
  methods: [
    'initialize',
    'sandbox/status',
    'sandbox/refresh',
    'sandbox/install',
    'sandbox/repair',
    'sandbox/uninstall',
    'shutdown',
    'event/subscribe',
    'event/ack',
    'event/unsubscribe',
    'system/shrinkMemory',
  ],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    context: RpcRouterContext,
  ): Promise<unknown> {
    const { db } = runtime.dependencies
    const params = optionalRecord(rawParams)
    switch (method) {
      case 'initialize':
        db.probeHealth()
        if (!Array.isArray(params.protocols) || !params.protocols.includes('thread-rpc-v4')) {
          throw new AgentError('PROTOCOL_VERSION_UNSUPPORTED', '客户端不支持 thread-rpc-v4', 409)
        }
        if (!Array.isArray(params.capabilities) || !params.capabilities.includes('rpc.typed.v1')) {
          throw new AgentError('CAPABILITY_REQUIRED', '客户端缺少 rpc.typed.v1 capability', 409)
        }
        const requestedAuthority = record(params.clientInfo, 'clientInfo').authority
        if (
          requestedAuthority === 'desktop-host' &&
          (context.transportAuthority !== 'desktop-host' ||
            process.env.PIDEX_DESKTOP_MANAGED !== '1')
        ) {
          throw new AgentError('PERMISSION_DENIED', '桌面宿主 authority 与传输认证来源不匹配', 403)
        }
        const connectionId = crypto.randomUUID()
        const createdAt = runtime.now()
        const serverAvailable = filterAdvertisedCapabilities(
          db,
          runtime.planApprovals.supportsFresh(),
        )
        const clientRequested = params.capabilities as readonly ProtocolCapability[]
        const negotiated = negotiateCapabilities(clientRequested, serverAvailable)
        runtime.connections.set(connectionId, {
          initialized: false,
          createdAt,
          lastSeenAt: createdAt,
          capabilities: negotiated,
          ...(context.transportAuthority ? { transportAuthority: context.transportAuthority } : {}),
          ...(requestedAuthority === 'desktop-host' ? { authority: 'desktop-host' as const } : {}),
        })
        return {
          protocol: 'thread-rpc-v4',
          serverInfo: { name: 'pidex-agent', version: '0.1.0' },
          capabilities: [...negotiated],
          limits: {
            maxFrameBytes: 16 * 1024 * 1024,
            maxSubscriptions: 16,
            maxStreamsPerSubscription: 64,
            maxPendingRequests: 128,
          },
          connectionId,
        }
      case 'sandbox/status':
      case 'sandbox/refresh':
        return unsupportedSandboxResult()
      case 'sandbox/install':
      case 'sandbox/repair':
        throw new AgentError('SANDBOX_UNAVAILABLE', 'Pidex 不再提供内置安全沙箱。', 503)
      case 'sandbox/uninstall':
        decodeParams(decodeSandboxUninstall, rawParams, 'sandbox/uninstall')
        throw new AgentError('SANDBOX_UNAVAILABLE', 'Pidex 不再提供内置安全沙箱。', 503)
      case 'shutdown':
        if (process.env.PIDEX_DESKTOP_MANAGED !== '1')
          throw new AgentError('SHUTDOWN_DENIED', '仅桌面托管的 Agent 可以通过 RPC 关闭', 403)
        setTimeout(() => process.emit('SIGTERM'), 25)
        return { ok: true, acceptedAt: Date.now() }
      case 'event/subscribe': {
        const connectionId = runtime.requireConnection(context)
        const connection = runtime.connections.get(connectionId)
        return runtime.subscriptions.subscribe(
          connectionId,
          params as never,
          connection?.capabilities ?? new Set(),
        )
      }
      case 'event/ack':
        return runtime.subscriptions.ack(runtime.requireConnection(context), params as never)
      case 'event/unsubscribe':
        return runtime.subscriptions.unsubscribe(
          runtime.requireConnection(context),
          stringParam(params, 'subscriptionId'),
        )
      case 'system/shrinkMemory': {
        const memoryManager = runtime.dependencies.memoryManager
        const reason =
          typeof params.reason === 'string' &&
          (params.reason === 'turn_end' || params.reason === 'idle' || params.reason === 'manual')
            ? params.reason
            : 'manual'
        if (!memoryManager) {
          const stats = process.memoryUsage()
          return {
            success: true,
            stats: {
              rss: stats.rss,
              heapTotal: stats.heapTotal,
              heapUsed: stats.heapUsed,
              external: stats.external,
              arrayBuffers: stats.arrayBuffers,
            },
          }
        }
        return memoryManager.shrink(reason)
      }
      default:
        throw new AgentError('METHOD_NOT_FOUND', `未知 RPC 方法：${method}`, 404)
    }
  },
} as const satisfies RpcHandlerGroup
