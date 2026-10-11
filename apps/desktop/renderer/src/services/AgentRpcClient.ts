import {
  createRpcClient,
  RpcRemoteError,
  type RpcClient,
  type RpcTransport,
} from '@pidex/agent-protocol/client'
import {
  decodeEventEnvelope,
  decodeServerNotification,
  type EventEnvelope,
  type LiveEventType,
} from '@pidex/agent-protocol/events'
import type {
  RpcError,
  InitializedNotification,
  PublicRpcMethod,
  PublicRpcParams,
  PublicRpcResult,
} from '@pidex/agent-protocol'

export type AgentNotification = {
  jsonrpc: '2.0'
  id?: string | number
  method: string
  params: Record<string, unknown>
}

export type AgentRpcClientEnvironment = {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  eventSourceFactory?: (url: string) => EventSource
  eventReconnectDelay?: (attempt: number) => number
  timeout?: (method: PublicRpcMethod) => number | undefined
  handshake?: {
    initialize: PublicRpcParams<'initialize'>
    initialized: InitializedNotification['params']
  }
}

export type AgentRpcSubscription = {
  threadId?: string
  after?: number
  liveEventTypes?: readonly LiveEventType[]
  onReplayComplete?: () => void | Promise<void>
  onCursorExpired?: () => number | void | Promise<number | void>
  onDeliveryError?: (error: unknown) => number | void | Promise<number | void>
}

export type EventBatchDelivery = (events: readonly EventEnvelope[]) => void | Promise<void>

const MAX_EVENTS_PER_DELIVERY = 256
const EVENT_DELIVERY_DELAY_MS = 50
const MAX_BUFFERED_EVENTS = 1_024

export class AgentRpcError extends Error {
  readonly code: number
  readonly data: unknown

  constructor(message: string, code: number, data?: unknown) {
    super(message)
    this.name = 'AgentRpcError'
    this.code = code
    this.data = data
  }

  get errorCode(): string | null {
    if (!this.data || typeof this.data !== 'object') return null
    const value = (this.data as { code?: unknown }).code
    return typeof value === 'string' ? value : null
  }

  get status(): number | null {
    if (this.data && typeof this.data === 'object') {
      const value = (this.data as { status?: unknown }).status
      if (typeof value === 'number') return value
    }
    return this.code >= 400 && this.code <= 599 ? this.code : null
  }

  get details(): unknown {
    if (!this.data || typeof this.data !== 'object') return undefined
    return (this.data as { details?: unknown }).details
  }
}

export function createAgentRpcClient(environment: AgentRpcClientEnvironment) {
  const fetcher = environment.fetch ?? fetch
  let connectionId: string | null = null
  let initializeParams: PublicRpcParams<'initialize'> | null = null
  let initializedParams: InitializedNotification['params'] | null = null
  let initializeResult: PublicRpcResult<'initialize'> | null = null
  let handshakePromise: Promise<PublicRpcResult<'initialize'>> | null = null
  let recoveryPromise: Promise<void> | null = null

  const transport: RpcTransport = {
    async request(message) {
      const response = await (
        await import('./RpcFetch.js')
      ).send(fetcher, message, connectionId, environment.timeout)
      if (!response.ok) throw new Error(await rpcHttpError(response))
      return response.json()
    },
    async notify(message) {
      const response = await fetcher('/rpc', {
        method: 'POST',
        credentials: 'include',
        headers: rpcHeaders(connectionId),
        body: JSON.stringify(message),
      })
      if (!response.ok) throw new Error(await rpcHttpError(response))
      if (response.status !== 204) {
        const error = await rpcNotificationError(response)
        if (error) throw new RpcRemoteError(error)
      }
    },
  }
  const typedClient = createRpcClient(transport, { idPrefix: 'renderer' })

  async function call<M>(
    method: M extends PublicRpcMethod ? M : M extends string ? never : PublicRpcMethod,
    params?: M extends PublicRpcMethod ? PublicRpcParams<M> : unknown,
  ): Promise<M extends PublicRpcMethod ? PublicRpcResult<M> : M> {
    const methodName = method as PublicRpcMethod
    const requestParams = (params ?? {}) as PublicRpcParams<PublicRpcMethod>
    if (methodName !== 'initialize' && environment.handshake) {
      await ensureInitialized()
    }
    const attemptedConnectionId = connectionId
    try {
      const result = await typedClient.call(methodName, requestParams as never)
      if (methodName === 'initialize') {
        initializeParams = requestParams as PublicRpcParams<'initialize'>
        initializeResult = result as PublicRpcResult<'initialize'>
      }
      return result as M extends PublicRpcMethod ? PublicRpcResult<M> : M
    } catch (error) {
      if (
        methodName !== 'initialize' &&
        isUninitializedConnectionError(error) &&
        (await recoverConnection(attemptedConnectionId))
      ) {
        try {
          return (await typedClient.call(
            methodName,
            requestParams as never,
          )) as M extends PublicRpcMethod ? PublicRpcResult<M> : M
        } catch (retryError) {
          throw normalizeRpcError(retryError)
        }
      }
      throw normalizeRpcError(error)
    }
  }

  async function initialized(params: Parameters<RpcClient['initialized']>[0]): Promise<void> {
    try {
      await typedClient.initialized(params)
      initializedParams = params
    } catch (error) {
      throw normalizeRpcError(error)
    }
  }

  async function ensureInitialized(): Promise<PublicRpcResult<'initialize'>> {
    if (initializeResult && initializedParams && connectionId) {
      return initializeResult
    }
    const handshake = environment.handshake
    if (!handshake) {
      throw new Error('Agent RPC client 未配置自动握手参数。')
    }
    handshakePromise ??= (async () => {
      initializeParams = handshake.initialize
      const result = await typedClient.call('initialize', handshake.initialize)
      connectionId = result.connectionId
      initializeResult = result
      await typedClient.initialized(handshake.initialized)
      initializedParams = handshake.initialized
      return result
    })()
      .catch((error) => {
        connectionId = null
        initializeResult = null
        initializedParams = null
        throw error
      })
      .finally(() => {
        handshakePromise = null
      })
    try {
      return await handshakePromise
    } catch (error) {
      throw normalizeRpcError(error)
    }
  }

  async function recoverConnection(failedConnectionId: string | null): Promise<boolean> {
    if (!initializeParams || !initializedParams) return false
    if (connectionId !== null && connectionId !== failedConnectionId) {
      return true
    }
    recoveryPromise ??= (async () => {
      connectionId = null
      const initialized = await typedClient.call('initialize', initializeParams!)
      connectionId = initialized.connectionId
      initializeResult = initialized
      await typedClient.initialized(initializedParams!)
    })().finally(() => {
      recoveryPromise = null
    })
    try {
      await recoveryPromise
      return true
    } catch (error) {
      throw normalizeRpcError(error)
    }
  }

  function subscribeEnvelope(
    options: AgentRpcSubscription,
    deliverBatch: EventBatchDelivery,
  ): () => void {
    const factory = environment.eventSourceFactory ?? defaultEventSourceFactory()
    if (!factory) return () => {}
    const streamId = options.threadId ?? 'global'
    let disposed = false
    let source: EventSource | null = null
    let subscriptionId: string | null = null
    let ackTimer: ReturnType<typeof setTimeout> | null = null
    let deliveryTimer: ReturnType<typeof setTimeout> | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempt = 0
    let generation = 1
    let replayCompleteGeneration = 0
    let failedDeliveryGeneration = 0
    let forceLatest = false
    let pendingEvents: EventEnvelope[] = []
    let inFlightEventCount = 0
    let drainPromise: Promise<void> | null = null
    const pendingPositions = new Map<string, number>()
    const acknowledgedPositions = new Map<string, number>()
    if (options.after !== undefined) {
      acknowledgedPositions.set(streamId, options.after)
    }

    const reconnectDelay = (attempt: number): number =>
      environment.eventReconnectDelay?.(attempt) ?? Math.min(250 * 2 ** attempt, 5_000)

    const recordCommittedPosition = (positionStreamId: string, sequence: number): void => {
      pendingPositions.set(
        positionStreamId,
        Math.max(pendingPositions.get(positionStreamId) ?? 0, sequence),
      )
    }

    const clearAckTimer = (): void => {
      if (ackTimer === null) return
      clearTimeout(ackTimer)
      ackTimer = null
    }

    const clearDeliveryTimer = (): void => {
      if (deliveryTimer === null) return
      clearTimeout(deliveryTimer)
      deliveryTimer = null
    }

    const unsubscribeBestEffort = (id: string | null): void => {
      if (!id) return
      void call('event/unsubscribe', { subscriptionId: id }).catch(() => undefined)
    }

    const closeCurrentConnection = (unsubscribe: boolean): void => {
      const currentSubscriptionId = subscriptionId
      source?.close()
      source = null
      subscriptionId = null
      clearAckTimer()
      clearDeliveryTimer()
      pendingEvents = []
      drainPromise = null
      pendingPositions.clear()
      if (unsubscribe) unsubscribeBestEffort(currentSubscriptionId)
    }

    const scheduleReconnect = (expectedGeneration: number): void => {
      if (disposed || generation !== expectedGeneration) return
      generation += 1
      closeCurrentConnection(true)
      if (retryTimer !== null) clearTimeout(retryTimer)
      const reconnectGeneration = generation
      const delay = reconnectDelay(reconnectAttempt)
      reconnectAttempt += 1
      retryTimer = setTimeout(() => {
        retryTimer = null
        if (disposed || generation !== reconnectGeneration) return
        startConnect(reconnectGeneration)
      }, delay)
    }

    const handleDeliveryFailure = (error: unknown, expectedGeneration: number): void => {
      if (
        disposed ||
        generation !== expectedGeneration ||
        failedDeliveryGeneration === expectedGeneration
      ) {
        return
      }
      failedDeliveryGeneration = expectedGeneration
      source?.close()
      source = null
      clearDeliveryTimer()
      pendingEvents = []
      void Promise.resolve(options.onDeliveryError?.(error))
        .then((recoveredAfter) => {
          if (
            typeof recoveredAfter === 'number' &&
            Number.isSafeInteger(recoveredAfter) &&
            recoveredAfter >= 0
          ) {
            acknowledgedPositions.set(streamId, recoveredAfter)
            forceLatest = false
          }
        })
        .catch(() => undefined)
        .finally(() => {
          scheduleReconnect(expectedGeneration)
        })
    }

    const drainEvents = (expectedGeneration: number): Promise<void> => {
      if (drainPromise) return drainPromise
      clearDeliveryTimer()
      const currentDrain = (async () => {
        while (
          !disposed &&
          generation === expectedGeneration &&
          failedDeliveryGeneration !== expectedGeneration &&
          pendingEvents.length > 0
        ) {
          const batch = pendingEvents.splice(0, MAX_EVENTS_PER_DELIVERY)
          inFlightEventCount += batch.length
          try {
            await deliverBatch(batch)
          } catch (error) {
            handleDeliveryFailure(error, expectedGeneration)
            return
          } finally {
            inFlightEventCount = Math.max(0, inFlightEventCount - batch.length)
          }
          if (
            disposed ||
            generation !== expectedGeneration ||
            failedDeliveryGeneration === expectedGeneration
          ) {
            return
          }
          for (const event of batch) {
            const sequence = event.durability === 'durable' ? event.sequence : event.afterSequence
            recordCommittedPosition(event.streamId, sequence)
          }
          scheduleAck()
        }
      })().finally(() => {
        if (drainPromise === currentDrain) drainPromise = null
      })
      drainPromise = currentDrain
      return currentDrain
    }

    const scheduleDelivery = (expectedGeneration: number): void => {
      if (
        disposed ||
        generation !== expectedGeneration ||
        failedDeliveryGeneration === expectedGeneration
      ) {
        return
      }
      if (pendingEvents.length >= MAX_EVENTS_PER_DELIVERY) {
        clearDeliveryTimer()
        void drainEvents(expectedGeneration)
        return
      }
      if (deliveryTimer !== null || drainPromise !== null) return
      deliveryTimer = setTimeout(() => {
        deliveryTimer = null
        void drainEvents(expectedGeneration)
      }, EVENT_DELIVERY_DELAY_MS)
    }

    const connect = async (expectedGeneration: number): Promise<void> => {
      const acknowledged = acknowledgedPositions.get(streamId)
      let after: number | 'latest' =
        !forceLatest && acknowledged !== undefined ? acknowledged : 'latest'
      const subscribeParams = () => ({
        streams: [{ streamId, after }],
        ...(options.liveEventTypes ? { liveEventTypes: [...options.liveEventTypes] } : {}),
      })
      let subscription: PublicRpcResult<'event/subscribe'>
      try {
        subscription = await call('event/subscribe', subscribeParams())
      } catch (error) {
        if (after !== 'latest' && isCursorExpiredError(error)) {
          const recoveredAfter = options.onCursorExpired
            ? await Promise.resolve(options.onCursorExpired())
            : undefined
          forceLatest = typeof recoveredAfter !== 'number'
          after = typeof recoveredAfter === 'number' ? recoveredAfter : 'latest'
          if (typeof recoveredAfter === 'number') {
            acknowledgedPositions.set(streamId, recoveredAfter)
          }
          subscription = await call('event/subscribe', subscribeParams())
        } else {
          throw error
        }
      }

      if (disposed || generation !== expectedGeneration) {
        unsubscribeBestEffort(subscription.subscriptionId)
        return
      }

      if (after === 'latest') {
        for (const position of subscription.highWatermarks) {
          acknowledgedPositions.set(
            position.streamId,
            Math.max(acknowledgedPositions.get(position.streamId) ?? 0, position.sequence),
          )
        }
      }

      subscriptionId = subscription.subscriptionId
      const nextSource = factory(
        `/rpc/events?subscriptionId=${encodeURIComponent(subscription.subscriptionId)}&connectionId=${encodeURIComponent(connectionId ?? '')}`,
      )
      source = nextSource
      nextSource.onmessage = (message) => {
        if (disposed || generation !== expectedGeneration || source !== nextSource) {
          return
        }
        try {
          const notification = decodeServerNotification(JSON.parse(message.data))
          if (notification.params.subscriptionId !== subscription.subscriptionId) {
            throw new Error('事件通知与当前订阅不匹配。')
          }
          if (notification.method === 'event/next') {
            const event = decodeEventEnvelope(notification.params.event)
            if (event.streamId !== streamId) {
              throw new Error('事件通知与当前 stream scope 不匹配。')
            }
            if (pendingEvents.length + inFlightEventCount >= MAX_BUFFERED_EVENTS) {
              handleDeliveryFailure(
                new Error('事件消费队列已超过 1024 条，正在重新读取会话。'),
                expectedGeneration,
              )
              return
            }
            pendingEvents.push(event)
            scheduleDelivery(expectedGeneration)
            return
          }
          if (notification.method === 'event/replayComplete') {
            clearDeliveryTimer()
            void drainEvents(expectedGeneration)
              .then(async () => {
                if (
                  disposed ||
                  generation !== expectedGeneration ||
                  failedDeliveryGeneration === expectedGeneration
                ) {
                  return
                }
                reconnectAttempt = 0
                if (replayCompleteGeneration === expectedGeneration) return
                replayCompleteGeneration = expectedGeneration
                await options.onReplayComplete?.()
              })
              .catch((error) => {
                handleDeliveryFailure(error, expectedGeneration)
              })
            return
          }
          if (notification.method === 'event/subscriptionClosed') {
            scheduleReconnect(expectedGeneration)
            return
          }
        } catch (error) {
          handleDeliveryFailure(error, expectedGeneration)
        }
      }
      nextSource.onerror = () => {
        scheduleReconnect(expectedGeneration)
      }
    }

    const startConnect = (expectedGeneration: number): void => {
      void connect(expectedGeneration).catch(() => {
        scheduleReconnect(expectedGeneration)
      })
    }

    const flushAck = async (force = false): Promise<void> => {
      const ackSubscriptionId = subscriptionId
      const ackGeneration = generation
      if (!ackSubscriptionId || pendingPositions.size === 0 || (disposed && !force)) {
        return
      }
      const positions = [...pendingPositions].map(([positionStreamId, sequence]) => ({
        streamId: positionStreamId,
        sequence,
      }))
      try {
        await call('event/ack', {
          subscriptionId: ackSubscriptionId,
          positions,
        })
        for (const position of positions) {
          acknowledgedPositions.set(
            position.streamId,
            Math.max(acknowledgedPositions.get(position.streamId) ?? 0, position.sequence),
          )
          if ((pendingPositions.get(position.streamId) ?? 0) <= position.sequence) {
            pendingPositions.delete(position.streamId)
          }
        }
        forceLatest = false
      } catch {
        if (!disposed && !force) scheduleReconnect(ackGeneration)
      }
    }

    const scheduleAck = (): void => {
      if (ackTimer !== null) return
      ackTimer = setTimeout(() => {
        ackTimer = null
        void flushAck()
      }, 1_000)
    }

    startConnect(generation)

    return () => {
      disposed = true
      generation += 1
      if (retryTimer !== null) clearTimeout(retryTimer)
      retryTimer = null
      clearAckTimer()
      clearDeliveryTimer()
      pendingEvents = []
      const finalSubscriptionId = subscriptionId
      source?.close()
      source = null
      void flushAck(true).finally(() => {
        subscriptionId = null
        unsubscribeBestEffort(finalSubscriptionId)
      })
    }
  }

  function subscribe(
    options: AgentRpcSubscription,
    callback: (notification: AgentNotification) => void,
  ): () => void {
    return subscribeEnvelope(options, (events) => {
      for (const event of events) {
        callback(eventEnvelopeToAgentNotification(event))
      }
    })
  }

  return {
    call,
    ensureInitialized,
    initialized,
    setConnectionId(value: string): void {
      connectionId = value
    },
    subscribe,
    subscribeEnvelope,
  }
}

function eventEnvelopeToAgentNotification(event: EventEnvelope): AgentNotification {
  const payload = asRecord(event.payload)
  const turn = asRecord(payload.turn)
  const error = asRecord(payload.error)
  const params = {
    ...payload,
    ...(typeof event.threadId === 'string'
      ? { threadId: event.threadId }
      : typeof turn.threadId === 'string'
        ? { threadId: turn.threadId }
        : {}),
    ...(typeof event.turnId === 'string' ? { turnId: event.turnId } : {}),
    ...(typeof turn.status === 'string' ? { status: turn.status } : {}),
    ...(typeof error.message === 'string' ? { message: error.message } : {}),
    occurredAt: event.occurredAt,
  }
  return {
    jsonrpc: '2.0',
    method: typeof event.type === 'string' ? event.type : 'unknown',
    params,
  } as AgentNotification
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function rpcHeaders(connectionId: string | null): HeadersInit {
  return {
    'content-type': 'application/json',
    ...(connectionId ? { 'x-pidex-connection-id': connectionId } : {}),
  }
}

function normalizeRpcError(error: unknown): unknown {
  if (!(error instanceof RpcRemoteError)) return error
  return new AgentRpcError(error.rpcError.message, error.rpcError.code, error.rpcError.data)
}

function isUninitializedConnectionError(error: unknown): boolean {
  if (!(error instanceof RpcRemoteError)) return false
  const data = error.rpcError.data
  return (
    data !== null &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    (data as { code?: unknown }).code === 'UNAUTHORIZED'
  )
}

function isCursorExpiredError(error: unknown): boolean {
  return error instanceof AgentRpcError && error.errorCode === 'CURSOR_EXPIRED'
}

function defaultEventSourceFactory(): ((url: string) => EventSource) | null {
  if (typeof EventSource === 'undefined') return null
  return (url) => new EventSource(url, { withCredentials: true })
}

async function rpcHttpError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  if (!text) return `RPC 请求失败：${response.status}`
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } }
    return parsed.error?.message ?? text
  } catch {
    return text
  }
}

async function rpcNotificationError(response: Response): Promise<RpcError | null> {
  const payload = await response.json().catch(() => null)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  const error = (payload as { error?: unknown }).error
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null
  const value = error as {
    code?: unknown
    message?: unknown
    data?: unknown
  }
  if (typeof value.code !== 'number' || typeof value.message !== 'string') {
    return null
  }
  if (value.data === undefined) {
    return { code: value.code, message: value.message }
  }
  if (!value.data || typeof value.data !== 'object' || Array.isArray(value.data)) {
    return null
  }
  const data = value.data as {
    code?: unknown
    retryable?: unknown
  }
  if (typeof data.code !== 'string' || typeof data.retryable !== 'boolean') {
    return null
  }
  return {
    code: value.code,
    message: value.message,
    data: value.data as NonNullable<RpcError['data']>,
  }
}
