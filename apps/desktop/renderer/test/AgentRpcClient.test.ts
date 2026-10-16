import { describe, expect, test } from 'bun:test'
import { AgentRpcError, createAgentRpcClient } from '../src/services/AgentRpcClient.js'
import { AgentRpcTimeoutError } from '../src/services/RpcFetch.js'

describe('agent RPC v4 client', () => {
  test('连接恢复期间的新请求等待 initialized 完成', async () => {
    let generation = 0
    let expired = false
    let initializedConnection: string | null = null
    let releaseHandshake!: () => void
    let handshakeStarted!: () => void
    const pendingHandshake = new Promise<void>((resolve) => { releaseHandshake = resolve })
    const recovering = new Promise<void>((resolve) => { handshakeStarted = resolve })
    const prematureRequests: string[] = []
    const client = createAgentRpcClient({
      handshake: automaticHandshake('renderer-concurrent-recovery'),
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body))
        const connection = new Headers(init?.headers).get('x-pidex-connection-id')
        if (body.method === 'initialize') {
          return rpcResult(body.id, initializeResult(`connection-${++generation}`))
        }
        if (body.method === 'initialized') {
          if (generation === 2) {
            handshakeStarted()
            await pendingHandshake
          }
          initializedConnection = connection
          return new Response(null, { status: 204 })
        }
        if (expired && connection === 'connection-1') return rpcError(body.id, 'UNAUTHORIZED')
        if (connection !== initializedConnection) {
          prematureRequests.push(body.method)
          return rpcError(body.id, 'UNAUTHORIZED')
        }
        return rpcResult(body.id, { projects: [], nextCursor: null })
      },
    })
    await client.call('project/list', {})
    expired = true
    const first = client.call('project/list', {})
    await recovering
    const second = client.call('project/list', {})
    await new Promise((resolve) => setTimeout(resolve, 10))
    releaseHandshake()
    await Promise.all([first, second])
    expect(prematureRequests).toEqual([])
    expect(generation).toBe(2)
  })

  test('并发业务请求统一等待首次 initialized 握手完成', async () => {
    const methods: string[] = []
    let initialized = false
    const handshake = {
      initialize: {
        clientInfo: {
          name: 'renderer-test',
          version: '1.0.0',
          instanceId: 'renderer-automatic',
        },
        protocols: ['thread-rpc-v4'] as const,
        capabilities: ['rpc.typed.v1'],
        interactionDelivery: 'active' as const,
      },
      initialized: {
        protocol: 'thread-rpc-v4' as const,
        clientInstanceId: 'renderer-automatic',
      },
    }
    const client = createAgentRpcClient({
      handshake,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          id?: string
          method?: string
        }
        methods.push(body.method ?? 'unknown')
        if (body.method === 'initialize') {
          return Response.json({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocol: 'thread-rpc-v4',
              serverInfo: { name: 'test-agent', version: '1.0.0' },
              capabilities: ['rpc.typed.v1'],
              limits: {
                maxFrameBytes: 1024,
                maxSubscriptions: 4,
                maxStreamsPerSubscription: 4,
                maxPendingRequests: 8,
              },
              connectionId: 'connection-automatic',
            },
          })
        }
        if (body.method === 'initialized') {
          expect(new Headers(init?.headers).get('x-pidex-connection-id')).toBe(
            'connection-automatic',
          )
          initialized = true
          return new Response(null, { status: 204 })
        }
        expect(initialized).toBe(true)
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: { projects: [], nextCursor: null },
        })
      },
    })

    const results = await Promise.all([
      client.call('project/list', {}),
      client.call('project/list', {}),
    ])

    expect(results).toEqual([
      { projects: [], nextCursor: null },
      { projects: [], nextCursor: null },
    ])
    expect(methods).toEqual(['initialize', 'initialized', 'project/list', 'project/list'])
  })

  test('initialized 通知收到 JSON-RPC error 时不会误判为握手成功', async () => {
    const client = createAgentRpcClient({
      handshake: {
        initialize: {
          clientInfo: {
            name: 'renderer-test',
            version: '1.0.0',
            instanceId: 'renderer-rejected',
          },
          protocols: ['thread-rpc-v4'],
          capabilities: ['rpc.typed.v1'],
          interactionDelivery: 'active',
        },
        initialized: {
          protocol: 'thread-rpc-v4',
          clientInstanceId: 'renderer-rejected',
        },
      },
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          id?: string
          method?: string
        }
        if (body.method === 'initialize') {
          return Response.json({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocol: 'thread-rpc-v4',
              serverInfo: { name: 'test-agent', version: '1.0.0' },
              capabilities: ['rpc.typed.v1'],
              limits: {
                maxFrameBytes: 1024,
                maxSubscriptions: 4,
                maxStreamsPerSubscription: 4,
                maxPendingRequests: 8,
              },
              connectionId: 'connection-rejected',
            },
          })
        }
        return Response.json({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32_000,
            message: 'RPC 连接尚未完成 initialized 握手',
            data: {
              code: 'UNAUTHORIZED',
              retryable: false,
            },
          },
        })
      },
    })

    await expect(client.call('project/list', {})).rejects.toBeInstanceOf(AgentRpcError)
  })

  test('发送正式 initialize 参数并在 initialized 通知中携带连接标识', async () => {
    const requests: Array<{
      headers: Headers
      body: Record<string, unknown>
    }> = []
    const client = createAgentRpcClient({
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        requests.push({
          headers: new Headers(init?.headers),
          body,
        })
        if (body.method === 'initialize') {
          return Response.json({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocol: 'thread-rpc-v4',
              serverInfo: { name: 'test-agent', version: '1.0.0' },
              capabilities: ['rpc.typed.v1', 'git.review.v1'],
              limits: {
                maxFrameBytes: 1024,
                maxSubscriptions: 4,
                maxStreamsPerSubscription: 4,
                maxPendingRequests: 8,
              },
              connectionId: 'connection-1',
            },
          })
        }
        return new Response(null, { status: 204 })
      },
    })

    const initialized = await client.call('initialize', {
      clientInfo: {
        name: 'renderer-test',
        version: '1.0.0',
        instanceId: 'renderer-1',
      },
      protocols: ['thread-rpc-v4'],
      capabilities: ['rpc.typed.v1', 'git.review.v1'],
      interactionDelivery: 'active',
    })
    client.setConnectionId(initialized.connectionId)
    await client.initialized({
      protocol: 'thread-rpc-v4',
      clientInstanceId: 'renderer-1',
    })

    expect(requests[0]?.body).toMatchObject({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocols: ['thread-rpc-v4'],
        interactionDelivery: 'active',
      },
    })
    expect(requests[1]?.body).toEqual({
      jsonrpc: '2.0',
      method: 'initialized',
      params: {
        protocol: 'thread-rpc-v4',
        clientInstanceId: 'renderer-1',
      },
    })
    expect(requests[1]?.headers.get('x-pidex-connection-id')).toBe('connection-1')
  })

  test('Agent 重启导致连接代次失效时重新握手并只重试当前请求一次', async () => {
    let generation = 0
    let activeConnectionId: string | null = null
    let initializedConnectionId: string | null = null
    const methods: string[] = []
    const client = createAgentRpcClient({
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          id?: string
          method?: string
        }
        const requestConnectionId = new Headers(init?.headers).get('x-pidex-connection-id')
        methods.push(body.method ?? 'unknown')
        if (body.method === 'initialize') {
          activeConnectionId = `connection-${++generation}`
          initializedConnectionId = null
          return Response.json({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocol: 'thread-rpc-v4',
              serverInfo: { name: 'test-agent', version: '1.0.0' },
              capabilities: ['rpc.typed.v1'],
              limits: {
                maxFrameBytes: 1024,
                maxSubscriptions: 4,
                maxStreamsPerSubscription: 4,
                maxPendingRequests: 8,
              },
              connectionId: activeConnectionId,
            },
          })
        }
        if (body.method === 'initialized') {
          if (requestConnectionId === activeConnectionId) {
            initializedConnectionId = requestConnectionId
            return new Response(null, { status: 204 })
          }
        }
        if (
          requestConnectionId !== activeConnectionId ||
          initializedConnectionId !== activeConnectionId
        ) {
          return Response.json({
            jsonrpc: '2.0',
            id: body.id,
            error: {
              code: -32_000,
              message: 'RPC 连接尚未完成 initialized 握手',
              data: {
                code: 'UNAUTHORIZED',
                retryable: false,
                status: 401,
              },
            },
          })
        }
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: { projects: [], nextCursor: null },
        })
      },
    })

    const initialized = await client.call('initialize', {
      clientInfo: {
        name: 'renderer-test',
        version: '1.0.0',
        instanceId: 'renderer-1',
      },
      protocols: ['thread-rpc-v4'],
      capabilities: ['rpc.typed.v1'],
      interactionDelivery: 'active',
    })
    client.setConnectionId(initialized.connectionId)
    await client.initialized({
      protocol: 'thread-rpc-v4',
      clientInstanceId: 'renderer-1',
    })
    expect(await client.call('project/list', {})).toEqual({
      projects: [],
      nextCursor: null,
    })

    activeConnectionId = null
    initializedConnectionId = null

    expect(await client.call('project/list', {})).toEqual({
      projects: [],
      nextCursor: null,
    })
    expect(methods).toEqual([
      'initialize',
      'initialized',
      'project/list',
      'project/list',
      'initialize',
      'initialized',
      'project/list',
    ])
  })

  test('首次事件订阅从 latest 开始且 replayComplete 触发校准回调', async () => {
    const requests: Array<Record<string, unknown>> = []
    const sources: FakeEventSource[] = []
    let replayCompleteCount = 0
    const client = createAgentRpcClient({
      handshake: automaticHandshake('renderer-latest'),
      fetch: createSubscriptionFetcher(requests),
      eventReconnectDelay: () => 0,
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url)
        sources.push(source)
        return source as unknown as EventSource
      },
    })

    const unsubscribe = client.subscribe(
      {
        liveEventTypes: ['catalog/updated', 'config/updated'],
        onReplayComplete: () => {
          replayCompleteCount += 1
        },
      },
      () => {},
    )
    await waitFor(() => sources.length === 1)

    const subscribeRequests = requests.filter((request) => request.method === 'event/subscribe')
    expect(subscribeRequests).toHaveLength(1)
    expect(subscribeRequests[0]?.params).toEqual({
      streams: [{ streamId: 'global', after: 'latest' }],
      liveEventTypes: ['catalog/updated', 'config/updated'],
    })

    sources[0]?.emit({
      jsonrpc: '2.0',
      method: 'event/replayComplete',
      params: {
        subscriptionId: 'subscription-1',
        positions: [{ streamId: 'global', sequence: 12 }],
      },
    })
    await waitFor(() => replayCompleteCount === 1)
    sources[0]?.emit({
      jsonrpc: '2.0',
      method: 'event/subscriptionClosed',
      params: {
        subscriptionId: 'subscription-1',
        reason: 'server-shutdown',
        positions: [{ streamId: 'global', sequence: 12 }],
      },
    })
    await waitFor(() => sources.length === 2)
    expect(
      requests.filter((request) => request.method === 'event/subscribe').at(-1)?.params,
    ).toEqual({
      streams: [{ streamId: 'global', after: 12 }],
      liveEventTypes: ['catalog/updated', 'config/updated'],
    })
    unsubscribe()
  })

  test('raw 事件订阅完整保留 EventEnvelope 字段', async () => {
    const requests: Array<Record<string, unknown>> = []
    const sources: FakeEventSource[] = []
    const received: Array<readonly Record<string, unknown>[]> = []
    const client = createAgentRpcClient({
      handshake: automaticHandshake('renderer-raw-envelope'),
      fetch: createSubscriptionFetcher(requests),
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url)
        sources.push(source)
        return source as unknown as EventSource
      },
    })

    const unsubscribe = client.subscribeEnvelope({ threadId: 'thread-1', after: 7 }, (events) =>
      received.push(events as unknown as readonly Record<string, unknown>[]),
    )
    await waitFor(() => sources.length === 1)
    const envelope = {
      eventId: 'event-8',
      streamId: 'thread-1',
      type: 'item/agentMessage/delta',
      version: 1,
      occurredAt: 1_721_000_000_000,
      threadId: 'thread-1',
      turnId: 'turn-1',
      durability: 'live',
      sequence: null,
      afterSequence: 7,
      payload: {
        itemId: 'item-1',
        turnId: 'turn-1',
        agentId: 'agent-1',
        delta: 'hello',
      },
    }
    sources[0]?.emit({
      jsonrpc: '2.0',
      method: 'event/next',
      params: { subscriptionId: 'subscription-1', event: envelope },
    })

    await waitFor(() => received.length === 1)
    expect(received[0]).toEqual([envelope])
    sources[0]?.emit({
      jsonrpc: '2.0',
      method: 'event/next',
      params: {
        subscriptionId: 'subscription-1',
        event: { ...envelope, version: 2 },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(received).toHaveLength(1)
    expect(requests.find((request) => request.method === 'event/subscribe')?.params).toEqual({
      streams: [{ streamId: 'thread-1', after: 7 }],
    })
    unsubscribe()
  })

  test('只在批量 consumer 提交成功后 ACK 事件位置', async () => {
    const requests: Array<Record<string, unknown>> = []
    const sources: FakeEventSource[] = []
    let deliveryStarted = false
    let releaseDelivery = () => undefined
    const deliveryGate = new Promise<void>((resolve) => {
      releaseDelivery = resolve
    })
    const client = createAgentRpcClient({
      handshake: automaticHandshake('renderer-commit-before-ack'),
      fetch: createSubscriptionFetcher(requests),
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url)
        sources.push(source)
        return source as unknown as EventSource
      },
    })

    const unsubscribe = client.subscribeEnvelope({ threadId: 'thread-1', after: 7 }, async () => {
      deliveryStarted = true
      await deliveryGate
    })
    await waitFor(() => sources.length === 1)
    sources[0]?.emit(eventNext('subscription-1', liveDeltaEnvelope('event-8')))
    await waitFor(() => deliveryStarted)
    await sleep(1_100)
    expect(requests.some((request) => request.method === 'event/ack')).toBe(false)

    releaseDelivery()
    await waitFor(() => requests.some((request) => request.method === 'event/ack'), 1_500)
    expect(requests.find((request) => request.method === 'event/ack')?.params).toEqual({
      subscriptionId: 'subscription-1',
      positions: [{ streamId: 'thread-1', sequence: 7 }],
    })
    unsubscribe()
  })

  test('consumer 失败时不 ACK，并在 history rehydrate 后重连', async () => {
    const requests: Array<Record<string, unknown>> = []
    const sources: FakeEventSource[] = []
    let recoveryCount = 0
    const client = createAgentRpcClient({
      handshake: automaticHandshake('renderer-delivery-recovery'),
      fetch: createSubscriptionFetcher(requests),
      eventReconnectDelay: () => 0,
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url)
        sources.push(source)
        return source as unknown as EventSource
      },
    })

    const unsubscribe = client.subscribeEnvelope(
      {
        threadId: 'thread-1',
        after: 7,
        onDeliveryError: () => {
          recoveryCount += 1
          return 9
        },
      },
      () => {
        throw new Error('projection failed')
      },
    )
    await waitFor(() => sources.length === 1)
    sources[0]?.emit(eventNext('subscription-1', liveDeltaEnvelope('event-8')))
    await waitFor(() => sources.length === 2)

    expect(recoveryCount).toBe(1)
    expect(requests.some((request) => request.method === 'event/ack')).toBe(false)
    expect(
      requests.filter((request) => request.method === 'event/subscribe').at(-1)?.params,
    ).toEqual({ streams: [{ streamId: 'thread-1', after: 9 }] })
    unsubscribe()
  })

  test('按 256 条边界批量提交且保持事件顺序', async () => {
    const requests: Array<Record<string, unknown>> = []
    const sources: FakeEventSource[] = []
    const batches: string[][] = []
    const client = createAgentRpcClient({
      handshake: automaticHandshake('renderer-batch-boundary'),
      fetch: createSubscriptionFetcher(requests),
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url)
        sources.push(source)
        return source as unknown as EventSource
      },
    })

    const unsubscribe = client.subscribeEnvelope({ threadId: 'thread-1', after: 7 }, (events) => {
      batches.push(events.map((event) => event.eventId))
    })
    await waitFor(() => sources.length === 1)
    for (let index = 0; index < 257; index += 1) {
      const envelope = liveDeltaEnvelope(`event-${index}`)
      sources[0]?.emit(eventNext('subscription-1', envelope))
    }
    await waitFor(() => batches.reduce((count, batch) => count + batch.length, 0) === 257)
    expect(batches.map((batch) => batch.length)).toEqual([256, 1])
    expect(batches.flat()).toEqual(Array.from({ length: 257 }, (_, index) => `event-${index}`))
    unsubscribe()
  })

  test('单条事件等待 50ms 批量窗口后提交', async () => {
    const requests: Array<Record<string, unknown>> = []
    const sources: FakeEventSource[] = []
    let delivered = false
    const client = createAgentRpcClient({
      handshake: automaticHandshake('renderer-single-event-delay'),
      fetch: createSubscriptionFetcher(requests),
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url)
        sources.push(source)
        return source as unknown as EventSource
      },
    })
    const unsubscribe = client.subscribeEnvelope({ threadId: 'thread-1', after: 7 }, () => {
      delivered = true
    })
    await waitFor(() => sources.length === 1)
    sources[0]?.emit(eventNext('subscription-1', liveDeltaEnvelope('event-1')))
    await sleep(20)
    expect(delivered).toBe(false)
    await waitFor(() => delivered)
    unsubscribe()
  })

  test('允许 1024 条有界积压，第 1025 条触发 rehydrate 且不 ACK', async () => {
    const createCase = () => {
      const requests: Array<Record<string, unknown>> = []
      const sources: FakeEventSource[] = []
      let delivered = 0
      let recoveryCount = 0
      let release = () => undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const client = createAgentRpcClient({
        handshake: automaticHandshake(crypto.randomUUID()),
        fetch: createSubscriptionFetcher(requests),
        eventReconnectDelay: () => 0,
        eventSourceFactory: (url) => {
          const source = new FakeEventSource(url)
          sources.push(source)
          return source as unknown as EventSource
        },
      })
      const unsubscribe = client.subscribeEnvelope(
        {
          threadId: 'thread-1',
          after: 7,
          onDeliveryError: () => {
            recoveryCount += 1
            return 20
          },
        },
        async (events) => {
          if (delivered === 0) await gate
          delivered += events.length
        },
      )
      return {
        requests,
        sources,
        release,
        unsubscribe,
        delivered: () => delivered,
        recoveryCount: () => recoveryCount,
      }
    }

    const bounded = createCase()
    await waitFor(() => bounded.sources.length === 1)
    for (let index = 0; index < 1_024; index += 1) {
      bounded.sources[0]?.emit(eventNext('subscription-1', liveDeltaEnvelope(`bounded-${index}`)))
    }
    await sleep(20)
    expect(bounded.recoveryCount()).toBe(0)
    bounded.release()
    await waitFor(() => bounded.delivered() === 1_024, 1_500)
    bounded.unsubscribe()

    const overflow = createCase()
    await waitFor(() => overflow.sources.length === 1)
    for (let index = 0; index < 1_025; index += 1) {
      overflow.sources[0]?.emit(eventNext('subscription-1', liveDeltaEnvelope(`overflow-${index}`)))
    }
    await waitFor(() => overflow.recoveryCount() === 1)
    expect(overflow.requests.some((request) => request.method === 'event/ack')).toBe(false)
    overflow.release()
    overflow.unsubscribe()
  })

  test('内容错误在单次快照恢复后仍出现时停止自动恢复且不 ACK', async () => {
    const requests: Array<Record<string, unknown>> = []
    const sources: FakeEventSource[] = []
    let recoveries = 0
    const subscriptionErrors: unknown[] = []
    const client = createAgentRpcClient({
      handshake: automaticHandshake('renderer-invalid-events'),
      fetch: createSubscriptionFetcher(requests),
      eventReconnectDelay: () => 0,
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url)
        sources.push(source)
        return source as unknown as EventSource
      },
    })
    const unsubscribe = client.subscribeEnvelope(
      {
        threadId: 'thread-1',
        after: 7,
        onDeliveryError: () => {
          recoveries += 1
          return 7
        },
        onSubscriptionError: (error) => {
          subscriptionErrors.push(error)
        },
      },
      () => {},
    )
    await waitFor(() => sources.length === 1)
    sources[0]?.emit(eventNext('subscription-1', liveDeltaEnvelope('wrong-scope', 'thread-2')))
    await waitFor(() => sources.length === 2)
    sources[1]?.emit(
      eventNext('subscription-2', {
        ...liveDeltaEnvelope('malformed'),
        version: 2,
      }),
    )
    await waitFor(() => subscriptionErrors.length === 1)

    expect(recoveries).toBe(1)
    expect(sources).toHaveLength(2)
    expect(requests.filter((request) => request.method === 'event/subscribe')).toHaveLength(2)
    expect(requests.some((request) => request.method === 'event/ack')).toBe(false)
    // 错误信息不得携带出错通知的原始内容。
    expect(subscriptionErrors[0]).toBeInstanceOf(Error)
    expect((subscriptionErrors[0] as Error).message).toBe('会话事件内容无法解析或与当前订阅不匹配')
    unsubscribe()
  })

  test('历史重读失败时停止内容错误恢复并保留当前内容', async () => {
    const requests: Array<Record<string, unknown>> = []
    const sources: FakeEventSource[] = []
    let deliveries = 0
    let subscriptionErrors = 0
    const client = createAgentRpcClient({
      handshake: automaticHandshake('renderer-content-error-hydrate-failure'),
      fetch: createSubscriptionFetcher(requests),
      eventReconnectDelay: () => 0,
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url)
        sources.push(source)
        return source as unknown as EventSource
      },
    })
    const unsubscribe = client.subscribeEnvelope(
      {
        threadId: 'thread-1',
        after: 7,
        onDeliveryError: () => {
          throw new Error('history hydration failed')
        },
        onSubscriptionError: () => {
          subscriptionErrors += 1
        },
      },
      () => {
        deliveries += 1
      },
    )
    await waitFor(() => sources.length === 1)
    sources[0]?.emit(eventNext('subscription-1', liveDeltaEnvelope('wrong-scope', 'thread-2')))
    await waitFor(() => subscriptionErrors === 1)

    expect(sources).toHaveLength(1)
    expect(deliveries).toBe(0)
    expect(requests.filter((request) => request.method === 'event/subscribe')).toHaveLength(1)
    expect(requests.some((request) => request.method === 'event/ack')).toBe(false)
    unsubscribe()
  })

  test('提交有效事件批次后内容错误才重新获得一次恢复机会', async () => {
    const requests: Array<Record<string, unknown>> = []
    const sources: FakeEventSource[] = []
    let deliveries = 0
    let recoveries = 0
    let subscriptionErrors = 0
    const client = createAgentRpcClient({
      handshake: automaticHandshake('renderer-content-error-strike-reset'),
      fetch: createSubscriptionFetcher(requests),
      eventReconnectDelay: () => 0,
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url)
        sources.push(source)
        return source as unknown as EventSource
      },
    })
    const unsubscribe = client.subscribeEnvelope(
      {
        threadId: 'thread-1',
        after: 7,
        onDeliveryError: () => {
          recoveries += 1
          return 7
        },
        onSubscriptionError: () => {
          subscriptionErrors += 1
        },
      },
      () => {
        deliveries += 1
      },
    )
    await waitFor(() => sources.length === 1)
    sources[0]?.emit(eventNext('subscription-1', liveDeltaEnvelope('wrong-scope', 'thread-2')))
    await waitFor(() => sources.length === 2)
    sources[1]?.emit(eventNext('subscription-2', liveDeltaEnvelope('event-8')))
    await waitFor(() => deliveries === 1)
    sources[1]?.emit(eventNext('subscription-2', liveDeltaEnvelope('wrong-scope-2', 'thread-2')))
    await waitFor(() => sources.length === 3)
    expect(recoveries).toBe(2)
    sources[2]?.emit(eventNext('subscription-3', liveDeltaEnvelope('wrong-scope-3', 'thread-2')))
    await waitFor(() => subscriptionErrors === 1)

    expect(sources).toHaveLength(3)
    expect(recoveries).toBe(2)
    unsubscribe()
  })

  test('replayComplete 等待批次提交且不会用 high-watermark 推进 ACK', async () => {
    const requests: Array<Record<string, unknown>> = []
    const sources: FakeEventSource[] = []
    let release = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let replayCompleted = false
    const client = createAgentRpcClient({
      handshake: automaticHandshake('renderer-replay-commit'),
      fetch: createSubscriptionFetcher(requests),
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url)
        sources.push(source)
        return source as unknown as EventSource
      },
    })
    const unsubscribe = client.subscribeEnvelope(
      {
        threadId: 'thread-1',
        after: 7,
        onReplayComplete: () => {
          replayCompleted = true
        },
      },
      async () => {
        await gate
      },
    )
    await waitFor(() => sources.length === 1)
    sources[0]?.emit(eventNext('subscription-1', liveDeltaEnvelope('event-8')))
    sources[0]?.emit({
      jsonrpc: '2.0',
      method: 'event/replayComplete',
      params: {
        subscriptionId: 'subscription-1',
        positions: [{ streamId: 'thread-1', sequence: 99 }],
      },
    })
    await sleep(70)
    expect(replayCompleted).toBe(false)
    release()
    await waitFor(() => replayCompleted)
    await waitFor(() => requests.some((request) => request.method === 'event/ack'), 1_500)
    expect(requests.find((request) => request.method === 'event/ack')?.params).toEqual({
      subscriptionId: 'subscription-1',
      positions: [{ streamId: 'thread-1', sequence: 7 }],
    })
    unsubscribe()
  })

  test('事件订阅初始化暂时失败时按退避策略重试', async () => {
    const requests: Array<Record<string, unknown>> = []
    const sources: FakeEventSource[] = []
    const fallbackFetcher = createSubscriptionFetcher(requests)
    let subscribeAttempts = 0
    const client = createAgentRpcClient({
      handshake: automaticHandshake('renderer-subscribe-retry'),
      eventReconnectDelay: () => 0,
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url)
        sources.push(source)
        return source as unknown as EventSource
      },
      fetch: async (input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        if (body.method === 'event/subscribe') {
          subscribeAttempts += 1
          if (subscribeAttempts === 1) {
            requests.push(body)
            return new Response('temporary unavailable', { status: 503 })
          }
        }
        return fallbackFetcher(input, init)
      },
    })

    const unsubscribe = client.subscribe({}, () => {})
    await waitFor(() => sources.length === 1)
    expect(subscribeAttempts).toBe(2)
    expect(requests.filter((request) => request.method === 'event/subscribe')).toHaveLength(2)
    unsubscribe()
  })

  test('SSE 断开后重新握手并从最后成功 ACK 的位置恢复', async () => {
    const requests: Array<{
      connectionId: string | null
      body: Record<string, unknown>
    }> = []
    const sources: FakeEventSource[] = []
    let serverGeneration = 0
    let activeConnectionId: string | null = null
    let initializedConnectionId: string | null = null
    let subscriptionCount = 0
    const client = createAgentRpcClient({
      handshake: automaticHandshake('renderer-reconnect'),
      eventReconnectDelay: () => 0,
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url)
        sources.push(source)
        return source as unknown as EventSource
      },
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        const requestConnectionId = new Headers(init?.headers).get('x-pidex-connection-id')
        requests.push({ connectionId: requestConnectionId, body })
        if (body.method === 'initialize') {
          activeConnectionId = `connection-${++serverGeneration}`
          initializedConnectionId = null
          return rpcResult(body.id, initializeResult(activeConnectionId))
        }
        if (body.method === 'initialized') {
          initializedConnectionId = requestConnectionId
          return new Response(null, { status: 204 })
        }
        if (body.method === 'event/unsubscribe') {
          return rpcResult(body.id, { ok: true })
        }
        if (
          requestConnectionId !== activeConnectionId ||
          initializedConnectionId !== activeConnectionId
        ) {
          return rpcError(body.id, 'UNAUTHORIZED')
        }
        if (body.method === 'event/subscribe') {
          subscriptionCount += 1
          return rpcResult(body.id, {
            subscriptionId: `subscription-${subscriptionCount}`,
            highWatermarks: [{ streamId: 'global', sequence: 12 }],
          })
        }
        if (body.method === 'event/ack') {
          const params = body.params as {
            subscriptionId: string
            positions: Array<{ streamId: string; sequence: number }>
          }
          return rpcResult(body.id, {
            subscriptionId: params.subscriptionId,
            acknowledged: params.positions,
          })
        }
        throw new Error(`Unhandled RPC method: ${String(body.method)}`)
      },
    })

    const unsubscribe = client.subscribe(
      {
        liveEventTypes: ['workspace/file/changed'],
      },
      () => {},
    )
    await waitFor(() => sources.length === 1)
    sources[0]?.emit({
      jsonrpc: '2.0',
      method: 'event/next',
      params: {
        subscriptionId: 'subscription-1',
        event: {
          eventId: 'event-12',
          streamId: 'global',
          type: 'workspace/file/changed',
          version: 1,
          occurredAt: 12,
          durability: 'live',
          sequence: null,
          afterSequence: 12,
          payload: {
            projectId: 'project-1',
            folderId: 'folder-1',
            path: 'src/index.ts',
            changedAt: 12,
          },
        },
      },
    })
    sources[0]?.emit({
      jsonrpc: '2.0',
      method: 'event/replayComplete',
      params: {
        subscriptionId: 'subscription-1',
        positions: [{ streamId: 'global', sequence: 12 }],
      },
    })
    await waitFor(() => requests.some((request) => request.body.method === 'event/ack'), 1_500)

    activeConnectionId = null
    initializedConnectionId = null
    sources[0]?.fail()
    await waitFor(() => sources.length === 2)

    const acceptedSubscriptions = requests.filter(
      (request) =>
        request.body.method === 'event/subscribe' && request.connectionId === activeConnectionId,
    )
    expect(serverGeneration).toBe(2)
    expect(acceptedSubscriptions.at(-1)?.body.params).toEqual({
      streams: [{ streamId: 'global', after: 12 }],
      liveEventTypes: ['workspace/file/changed'],
    })
    expect(sources[1]?.url).toContain('connectionId=connection-2')

    const subscribeRequestCount = requests.filter(
      (request) => request.body.method === 'event/subscribe',
    ).length
    unsubscribe()
    sources[1]?.fail()
    await sleep(10)
    expect(requests.filter((request) => request.body.method === 'event/subscribe')).toHaveLength(
      subscribeRequestCount,
    )
  })

  test('恢复游标过期时使用上层重新 hydration 后的位置建立订阅', async () => {
    const requests: Array<Record<string, unknown>> = []
    const sources: FakeEventSource[] = []
    let rejected = false
    let replayCompleteCount = 0
    let cursorExpiredCount = 0
    const client = createAgentRpcClient({
      handshake: automaticHandshake('renderer-cursor-expired'),
      eventReconnectDelay: () => 0,
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url)
        sources.push(source)
        return source as unknown as EventSource
      },
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        requests.push(body)
        if (body.method === 'initialize') {
          return rpcResult(body.id, initializeResult('connection-1'))
        }
        if (body.method === 'initialized') {
          return new Response(null, { status: 204 })
        }
        if (body.method === 'event/subscribe') {
          const params = body.params as {
            streams: Array<{ after: number | 'latest' }>
          }
          if (!rejected && params.streams[0]?.after === 5) {
            rejected = true
            return rpcError(body.id, 'CURSOR_EXPIRED')
          }
          return rpcResult(body.id, {
            subscriptionId: 'subscription-latest',
            highWatermarks: [{ streamId: 'global', sequence: 20 }],
          })
        }
        if (body.method === 'event/ack') {
          const params = body.params as Record<string, unknown>
          return rpcResult(body.id, {
            subscriptionId: params.subscriptionId,
            acknowledged: params.positions,
          })
        }
        if (body.method === 'event/unsubscribe') {
          return rpcResult(body.id, { ok: true })
        }
        throw new Error(`Unhandled RPC method: ${String(body.method)}`)
      },
    })

    const unsubscribe = client.subscribe(
      {
        after: 5,
        liveEventTypes: ['provider/credential/updated'],
        onReplayComplete: () => {
          replayCompleteCount += 1
        },
        onCursorExpired: () => {
          cursorExpiredCount += 1
          return 19
        },
      },
      () => {},
    )
    await waitFor(() => sources.length === 1)

    const subscribeRequests = requests.filter((request) => request.method === 'event/subscribe')
    expect(subscribeRequests.map((request) => request.params)).toEqual([
      {
        streams: [{ streamId: 'global', after: 5 }],
        liveEventTypes: ['provider/credential/updated'],
      },
      {
        streams: [{ streamId: 'global', after: 19 }],
        liveEventTypes: ['provider/credential/updated'],
      },
    ])
    sources[0]?.emit({
      jsonrpc: '2.0',
      method: 'event/replayComplete',
      params: {
        subscriptionId: 'subscription-latest',
        positions: [{ streamId: 'global', sequence: 20 }],
      },
    })
    await waitFor(() => replayCompleteCount === 1)
    expect(cursorExpiredCount).toBe(1)
    unsubscribe()
  })

  test('Review 读取超时会中止底层 fetch 且允许重新发起', async () => {
    let attempts = 0
    let aborted = false
    const client = createAgentRpcClient({
      timeout: (method) => (method === 'review/summary' ? 10 : undefined),
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          id?: string
          method?: string
        }
        attempts += 1
        if (attempts === 1) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                aborted = true
                reject(init.signal?.reason)
              },
              { once: true },
            )
          })
        }
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            snapshot: {
              projectId: 'project-1',
              generation: 'generation-1',
              source: { kind: 'unstaged' },
              repositoryRoot: 'C:\\workspace',
              headSha: null,
              baseSha: null,
              files: [],
              totals: {
                files: 0,
                additions: 0,
                deletions: 0,
                changedLines: 0,
                changedBytes: 0,
              },
              largeDiffMode: false,
            },
            cacheState: 'fresh',
          },
        })
      },
    })

    const timedOut = client
      .call('review/summary', {
        projectId: 'project-1',
        source: { kind: 'unstaged' },
      })
      .catch((error) => error)
    await Bun.sleep(20)
    expect(await timedOut).toBeInstanceOf(AgentRpcTimeoutError)
    expect(aborted).toBe(true)
    expect(attempts).toBe(1)

    const retried = await client.call('review/summary', {
      projectId: 'project-1',
      source: { kind: 'unstaged' },
    })
    expect(retried.cacheState).toBe('fresh')
    expect(attempts).toBe(2)
  })

  test('游标恢复失败时重试旧游标且不会跳到 latest', async () => {
    const subscribeAfter: Array<number | 'latest'> = []
    const sources: FakeEventSource[] = []
    let recoveryAttempts = 0
    const client = createAgentRpcClient({
      handshake: automaticHandshake('renderer-cursor-retry'),
      eventReconnectDelay: () => 0,
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url)
        sources.push(source)
        return source as unknown as EventSource
      },
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        if (body.method === 'initialize') {
          return rpcResult(body.id, initializeResult('connection-1'))
        }
        if (body.method === 'initialized') {
          return new Response(null, { status: 204 })
        }
        if (body.method === 'event/subscribe') {
          const params = body.params as {
            streams: Array<{ after: number | 'latest' }>
          }
          const after = params.streams[0]?.after ?? 'latest'
          subscribeAfter.push(after)
          if (after === 5) return rpcError(body.id, 'CURSOR_EXPIRED')
          return rpcResult(body.id, {
            subscriptionId: 'subscription-recovered',
            highWatermarks: [{ streamId: 'global', sequence: 20 }],
          })
        }
        if (body.method === 'event/unsubscribe') {
          return rpcResult(body.id, { ok: true })
        }
        throw new Error(`Unhandled RPC method: ${String(body.method)}`)
      },
    })

    const unsubscribe = client.subscribe(
      {
        after: 5,
        liveEventTypes: ['config/updated'],
        onCursorExpired: () => {
          recoveryAttempts += 1
          if (recoveryAttempts === 1) {
            throw new Error('history hydration failed')
          }
          return 19
        },
      },
      () => {},
    )

    await waitFor(() => sources.length === 1)
    expect(subscribeAfter).toEqual([5, 5, 19])
    expect(subscribeAfter).not.toContain('latest')
    unsubscribe()
  })
})

class FakeEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  readonly url: string
  closed = false

  constructor(url: string) {
    this.url = url
  }

  emit(notification: Record<string, unknown>): void {
    this.onmessage?.({
      data: JSON.stringify(notification),
    } as MessageEvent)
  }

  fail(): void {
    this.onerror?.()
  }

  close(): void {
    this.closed = true
  }
}

function eventNext(
  subscriptionId: string,
  event: Record<string, unknown>,
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    method: 'event/next',
    params: { subscriptionId, event },
  }
}

function liveDeltaEnvelope(eventId: string, streamId = 'thread-1'): Record<string, unknown> {
  return {
    eventId,
    streamId,
    type: 'item/agentMessage/delta',
    version: 1,
    occurredAt: 1_721_000_000_000,
    threadId: streamId,
    turnId: 'turn-1',
    durability: 'live',
    sequence: null,
    afterSequence: 7,
    payload: {
      itemId: 'item-1',
      turnId: 'turn-1',
      agentId: 'agent-1',
      delta: eventId,
    },
  }
}

function automaticHandshake(instanceId: string) {
  return {
    initialize: {
      clientInfo: {
        name: 'renderer-test',
        version: '1.0.0',
        instanceId,
      },
      protocols: ['thread-rpc-v4'] as const,
      capabilities: ['rpc.typed.v1'],
      interactionDelivery: 'active' as const,
    },
    initialized: {
      protocol: 'thread-rpc-v4' as const,
      clientInstanceId: instanceId,
    },
  }
}

function initializeResult(connectionId: string) {
  return {
    protocol: 'thread-rpc-v4',
    serverInfo: { name: 'test-agent', version: '1.0.0' },
    capabilities: ['rpc.typed.v1'],
    limits: {
      maxFrameBytes: 1024,
      maxSubscriptions: 4,
      maxStreamsPerSubscription: 4,
      maxPendingRequests: 8,
    },
    connectionId,
  }
}

function createSubscriptionFetcher(requests: Array<Record<string, unknown>>) {
  let subscriptionCount = 0
  return async (_input: string, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    requests.push(body)
    if (body.method === 'initialize') {
      return rpcResult(body.id, initializeResult('connection-1'))
    }
    if (body.method === 'initialized') {
      return new Response(null, { status: 204 })
    }
    if (body.method === 'event/subscribe') {
      subscriptionCount += 1
      return rpcResult(body.id, {
        subscriptionId: `subscription-${subscriptionCount}`,
        highWatermarks: [{ streamId: 'global', sequence: 12 }],
      })
    }
    if (body.method === 'event/ack') {
      const params = body.params as Record<string, unknown>
      return rpcResult(body.id, {
        subscriptionId: params.subscriptionId,
        acknowledged: params.positions,
      })
    }
    if (body.method === 'event/unsubscribe') {
      return rpcResult(body.id, { ok: true })
    }
    throw new Error(`Unhandled RPC method: ${String(body.method)}`)
  }
}

function rpcResult(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, result })
}

function rpcError(id: unknown, code: string): Response {
  return Response.json({
    jsonrpc: '2.0',
    id,
    error: {
      code: -32_000,
      message: code,
      data: { code, retryable: code !== 'UNAUTHORIZED' },
    },
  })
}

async function waitFor(predicate: () => boolean, timeout = 500): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeout) {
      throw new Error('等待条件超时')
    }
    await sleep(5)
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
