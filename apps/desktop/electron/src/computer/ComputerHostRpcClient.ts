import { Schema } from 'effect'
import {
  ComputerRpcMethods,
  ComputerHostRpcMethods,
  type RpcParams,
  type RpcResult,
} from '@pidex/agent-protocol'
import type { SidecarSupervisor } from '../sidecar/Supervisor.js'

const methods = { ...ComputerRpcMethods, ...ComputerHostRpcMethods }
type Method = keyof typeof methods

/** The agent long-polls `host/next`; the transport timeout must outlast it. */
const NEXT_TIMEOUT_MS = 25_000
const CALL_TIMEOUT_MS = 35_000

export class ComputerHostRpcClient {
  readonly capabilities = new Set<string>()
  private connectionId?: string
  private initialization?: Promise<void>
  private sequence = 0

  constructor(private readonly getSupervisor: () => SidecarSupervisor | undefined) {}

  invalidate() {
    this.connectionId = undefined
    this.capabilities.clear()
  }

  async call<M extends Method>(method: M, params: RpcParams<M>): Promise<RpcResult<M>> {
    const supervisor = this.getSupervisor()
    if (!supervisor) throw new Error('Agent 尚未连接')
    if (!this.connectionId) {
      this.initialization ??= this.initialize(supervisor).finally(() => {
        this.initialization = undefined
      })
      await this.initialization
    }
    const capability = methods[method].capability
    if (capability && !this.capabilities.has(capability))
      throw new Error('Agent 未提供电脑控制能力')
    const payload = await this.request(supervisor, method, params)
    if (payload.error) {
      if (payload.error.data?.code === 'UNAUTHORIZED') this.invalidate()
      throw new Error(payload.error.message ?? 'Agent 拒绝电脑控制请求')
    }
    return Schema.decodeUnknownSync(methods[method].result as Schema.Decoder<any, never>)(
      payload.result,
    ) as RpcResult<M>
  }

  private async request(supervisor: SidecarSupervisor, method: string, params: unknown) {
    const response = await supervisor.request('/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.connectionId ? { 'X-Pidex-Connection-ID': this.connectionId } : {}),
      },
      signal: AbortSignal.timeout(
        method === 'computer/host/next' ? NEXT_TIMEOUT_MS : CALL_TIMEOUT_MS,
      ),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `desktop-computer:${++this.sequence}`,
        method,
        params,
      }),
    })
    return (await response.json()) as {
      result?: unknown
      error?: { message?: string; data?: { code?: string } }
    }
  }

  private async initialize(supervisor: SidecarSupervisor) {
    const payload = await this.request(supervisor, 'initialize', {
      clientInfo: {
        name: 'pidex-desktop-computer-host',
        version: '1.0.0',
        platform: process.platform,
        authority: 'desktop-host',
      },
      protocols: ['thread-rpc-v4'],
      capabilities: [
        'rpc.typed.v1',
        'computer.host.v1',
        'computer.host.identity.v1',
        'computer.policy.v1',
        'computer.use.v1',
      ],
      interactionDelivery: 'observe',
    })
    const capabilities = (payload.result as { capabilities?: string[] })?.capabilities ?? []
    if (payload.error || !capabilities.includes('computer.host.identity.v1'))
      throw new Error('Agent 未提供电脑控制能力')
    const connectionId = (payload.result as { connectionId: string }).connectionId
    const response = await supervisor.request('/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Pidex-Connection-ID': connectionId,
      },
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialized',
        params: { protocol: 'thread-rpc-v4' },
      }),
    })
    if (response.status !== 204) throw new Error('无法完成电脑控制 Agent 连接')
    this.connectionId = connectionId
    this.capabilities.clear()
    for (const capability of capabilities) this.capabilities.add(capability)
  }
}
