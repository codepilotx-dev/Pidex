import { describe, expect, test } from 'bun:test'
import { Model, Provider } from '@pidex/model-schema'
import {
  ModelHealthService,
  type ModelHealthFailureCategory,
  type ModelHealthUpdatedPayload,
} from '../src/provider/ModelHealthService'
import type { PiModelService } from '../src/provider/pi'
import type { Api, Model as PiModel } from '@earendil-works/pi-ai'

type ProbeHandler = (
  model: PiModel<Api>,
  context: unknown,
  options: {
    apiKey?: string
    signal?: AbortSignal
  },
) => Promise<unknown> | unknown

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const makeService = (
  handlers: {
    list?: () => Promise<Array<{ id: Provider.ID; disabled?: boolean }>>
    models?: (providerID: Provider.ID) => Promise<Array<{ id: Model.ID; enabled: boolean }>>
    completeSimple?: ProbeHandler
    getPiModelDelayMs?: number
    publish?: (payload: ModelHealthUpdatedPayload) => void | Promise<void>
  } = {},
) => {
  const events: ModelHealthUpdatedPayload[] = []
  const providerID = Provider.ID.make('openai')
  const modelID = Model.ID.make('gpt-test')
  const piModels = {
    list: handlers.list ?? (async () => [{ id: providerID }]),
    models: handlers.models ?? (async () => [{ id: modelID, enabled: true }]),
    getPiModel: async () => ({ provider: 'openai', id: 'gpt-test' }),
    pi: {
      completeSimple: handlers.completeSimple ?? (async () => ({ stopReason: 'stop' })),
    },
  } as unknown as PiModelService
  const service = new ModelHealthService(
    piModels,
    handlers.publish ??
      (async (payload) => {
        events.push(payload)
      }),
  )
  return { service, events, providerID, modelID }
}

/** Deterministic wait: polls the run snapshot instead of relying on wall-clock sleeps. */
const waitForStatus = async (
  service: ModelHealthService,
  runId: string,
  status: 'running' | 'cancelling' | 'completed' | 'cancelled',
) => {
  for (let attempt = 0; attempt < 500; attempt++) {
    const run = await service.read(runId)
    if (run?.status === status) return run
    await wait(2)
  }
  throw new Error(`run ${runId} did not reach ${status}`)
}

describe('ModelHealthService', () => {
  test('仅纳入 enabled=true 的模型', async () => {
    const { service } = makeService({
      models: async () => [
        { id: Model.ID.make('a'), enabled: true },
        { id: Model.ID.make('b'), enabled: false },
      ],
    })
    const preview = await service.preview()
    expect(preview.totalRequests).toBe(1)
  })

  test('停用、未认证、无候选 Provider 被归类且不发起请求', async () => {
    const req: ProbeHandler = async () => {
      throw new Error('should not be called')
    }
    const { service } = makeService({
      list: async () => [
        { id: Provider.ID.make('disabled'), disabled: true },
        { id: Provider.ID.make('unconfigured') },
        { id: Provider.ID.make('none') },
      ],
      models: async (providerID) => {
        if (String(providerID) === 'unconfigured')
          return [{ id: Model.ID.make('x'), enabled: false }]
        if (String(providerID) === 'none') return []
        return []
      },
      completeSimple: req,
    })
    const preview = await service.preview()
    expect(preview.totalRequests).toBe(0)
    expect(preview.excludedProviders).toHaveLength(3)
    const reasons = preview.excludedProviders.map((entry) => entry.reason)
    expect(reasons).toContain('provider-disabled')
    expect(reasons).toContain('provider-unconfigured')
    expect(reasons).toContain('no-eligible-models')
  })

  test('N 个模型恰好发起 N 次请求，不重试不 fallback', async () => {
    let requests = 0
    const { service } = makeService({
      models: async () => [
        { id: Model.ID.make('a'), enabled: true },
        { id: Model.ID.make('b'), enabled: true },
        { id: Model.ID.make('c'), enabled: true },
      ],
      completeSimple: async () => {
        requests += 1
        return { stopReason: 'stop' }
      },
    })
    await service.start('op:1')
    await waitForStatus(service, 'op:1', 'completed')
    const run = await service.read('op:1')
    expect(requests).toBe(3)
    expect(run?.counts.healthy).toBe(3)
    expect(run?.status).toBe('completed')
  })

  test('任意时刻并发探针不超过 4', async () => {
    let inFlight = 0
    let peak = 0
    const { service } = makeService({
      models: async () =>
        Array.from({ length: 20 }, (_, i) => ({
          id: Model.ID.make(`m${i}`),
          enabled: true,
        })),
      completeSimple: async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await wait(10)
        inFlight -= 1
        return { stopReason: 'stop' }
      },
    })
    await service.start('op:conc')
    await waitForStatus(service, 'op:conc', 'completed')
    const run = await service.read('op:conc')
    expect(run?.counts.healthy).toBe(20)
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBe(4)
  })

  test('成功记录真实 wall-clock latency', async () => {
    const { service } = makeService({
      completeSimple: async () => {
        await wait(15)
        return { stopReason: 'stop' }
      },
    })
    await service.start('op:latency')
    await waitForStatus(service, 'op:latency', 'completed')
    const run = await service.read('op:latency')
    const healthy = run?.items.find((item) => item.status === 'healthy')
    expect(healthy?.status).toBe('healthy')
    if (healthy && healthy.status === 'healthy') {
      expect(healthy.latencyMs).toBeGreaterThanOrEqual(10)
    }
  })

  test('错误分类正确', async () => {
    const cases: Array<{ probe: ProbeHandler; expected: ModelHealthFailureCategory }> = [
      {
        probe: async () => {
          throw Object.assign(new Error('401'), { status: 401 })
        },
        expected: 'authentication',
      },
      {
        probe: async () => {
          throw Object.assign(new Error('403'), { status: 403 })
        },
        expected: 'authentication',
      },
      {
        probe: async () => {
          throw Object.assign(new Error('429'), { status: 429 })
        },
        expected: 'rate-limit',
      },
      {
        probe: async () => {
          throw Object.assign(new Error('500'), { status: 500 })
        },
        expected: 'provider',
      },
      {
        probe: async () => {
          throw new TypeError('fetch failed')
        },
        expected: 'network',
      },
      {
        probe: async () => {
          throw Object.assign(new Error('timeout'), { status: 408 })
        },
        expected: 'timeout',
      },
      {
        probe: async () => {
          throw new Error('unrecognized')
        },
        expected: 'unknown',
      },
    ]
    for (const { probe, expected } of cases) {
      const { service } = makeService({ completeSimple: probe as ProbeHandler })
      await service.start('op:cat')
      await waitForStatus(service, 'op:cat', 'completed')
      const run = await service.read('op:cat')
      const failed = run?.items[0]
      expect(failed?.status, expected).toBe('failed')
      if (failed?.status === 'failed') {
        expect(failed.category).toBe(expected)
      }
    }
  })

  test('返回消息不包含测试 Key、Authorization、堆栈或原始响应正文', async () => {
    const { service } = makeService({
      completeSimple: async () => {
        throw Object.assign(
          new Error(`invalid api key sk-abcdef1234 authorization Bearer token stack---`),
          { status: 401 },
        )
      },
    })
    const probe = await service.probe({
      providerID: Provider.ID.make('openai'),
      id: Model.ID.make('x'),
    })
    expect(probe.ok).toBeFalse()
    if (!probe.ok) {
      expect(probe.message).not.toContain('sk-abcdef1234')
      expect(probe.message).not.toContain('Bearer')
      expect(probe.message).not.toContain('stack')
    }
  })

  test('取消后 queued 与 in-flight 项全部进入终态，计数守恒', async () => {
    const { service } = makeService({
      models: async () =>
        Array.from({ length: 10 }, (_, i) => ({
          id: Model.ID.make(`m${i}`),
          enabled: true,
        })),
      completeSimple: async (_m, _c, options) => {
        await new Promise<void>((resolve) => {
          options?.signal?.addEventListener('abort', () => resolve())
          setTimeout(resolve, 5000)
        })
        return { stopReason: 'aborted' }
      },
    })
    await service.start('op:cancel')
    await service.cancel('op:cancel', 'op:cancel')
    await waitForStatus(service, 'op:cancel', 'cancelled')
    const run = await service.read('op:cancel')
    expect(run?.status).toBe('cancelled')
    const sum =
      (run?.counts.healthy ?? 0) +
      (run?.counts.failed ?? 0) +
      (run?.counts.cancelled ?? 0) +
      (run?.counts.running ?? 0) +
      (run?.counts.queued ?? 0)
    expect(run?.counts.total).toBe(10)
    expect(sum).toBe(10)
  })

  test('相同 operation ID 幂等；另一批运行中启动返回冲突', async () => {
    const { service } = makeService({
      models: async () => [{ id: Model.ID.make('a'), enabled: true }],
      completeSimple: async () => {
        await wait(1000)
        return { stopReason: 'stop' }
      },
    })
    const first = await service.start('op:idem')
    await service.start('op:idem')
    const replay = await service.read('op:idem')
    expect(replay?.runId).toBe(first.runId)
    await expect(service.start('op:other')).rejects.toThrow('另一个模型健康测试批次正在进行')
  })

  test('read 对已知 run 返回快照，对未知 run 返回 null', async () => {
    const { service } = makeService()
    await service.start('op:known')
    const known = await service.read('op:known')
    expect(known?.runId).toBe('op:known')
    expect(await service.read('op:unknown')).toBeNull()
  })

  test('同 operationId 并发 start 只构建一次候选并共享同一批次', async () => {
    let candidateBuilds = 0
    let requests = 0
    let resolveBuild!: () => void
    const buildGate = new Promise<void>((resolve) => {
      resolveBuild = resolve
    })
    const { service } = makeService({
      list: async () => {
        candidateBuilds += 1
        await buildGate
        return [{ id: Provider.ID.make('openai') }]
      },
      completeSimple: async () => {
        requests += 1
        return { stopReason: 'stop' }
      },
    })
    const first = service.start('op:single')
    const second = service.start('op:single')
    resolveBuild()
    const [left, right] = await Promise.all([first, second])
    expect(left.runId).toBe(right.runId)
    expect(candidateBuilds).toBe(1)
    await waitForStatus(service, 'op:single', 'completed')
    expect(requests).toBe(1)
  })

  test('不同 operationId 在批次 pending 时并发 start 返回 CONFLICT', async () => {
    let candidateBuilds = 0
    let requests = 0
    let resolveBuild!: () => void
    const buildGate = new Promise<void>((resolve) => {
      resolveBuild = resolve
    })
    const { service } = makeService({
      list: async () => {
        candidateBuilds += 1
        await buildGate
        return [{ id: Provider.ID.make('openai') }]
      },
      completeSimple: async () => {
        requests += 1
        return { stopReason: 'stop' }
      },
    })
    const first = service.start('op:a')
    await expect(service.start('op:b')).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    })
    resolveBuild()
    await first
    await waitForStatus(service, 'op:a', 'completed')
    expect(candidateBuilds).toBe(1)
    expect(requests).toBe(1)
  })

  test('候选构建期间 cancel 产生零请求的 cancelled 快照且计数守恒', async () => {
    let requests = 0
    let resolveBuild!: () => void
    const buildGate = new Promise<void>((resolve) => {
      resolveBuild = resolve
    })
    const { service } = makeService({
      list: async () => {
        await buildGate
        return [{ id: Provider.ID.make('openai') }]
      },
      models: async () =>
        Array.from({ length: 3 }, (_, i) => ({
          id: Model.ID.make(`m${i}`),
          enabled: true,
        })),
      completeSimple: async () => {
        requests += 1
        return { stopReason: 'stop' }
      },
    })
    const startPromise = service.start('op:cancel-pending')
    const cancelPromise = service.cancel('op:cancel-pending', 'op:cancel-pending')
    resolveBuild()
    const [run, cancelled] = await Promise.all([startPromise, cancelPromise])
    expect(cancelled.status).toBe('cancelled')
    expect(run.status).toBe('cancelled')
    expect(run.counts.total).toBe(3)
    expect(run.counts.cancelled).toBe(3)
    expect(run.counts.queued).toBe(0)
    expect(run.items.every((item) => item.status === 'cancelled')).toBe(true)
    expect(requests).toBe(0)
  })

  test('事件发布失败时批次收敛为 cancelled、无 running/queued 残留且可 read', async () => {
    let requests = 0
    let unhandledRejection: unknown = null
    const onUnhandled = (event: PromiseRejectionEvent) => {
      unhandledRejection = event.reason
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const { service } = makeService({
        publish: async () => {
          throw new Error('hub unavailable')
        },
        completeSimple: async () => {
          requests += 1
          return { stopReason: 'stop' }
        },
      })
      await service.start('op:publish-fail')
      const run = await waitForStatus(service, 'op:publish-fail', 'cancelled')
      expect(run.counts.running).toBe(0)
      expect(run.counts.queued).toBe(0)
      expect(run.items.every((item) => item.status === 'cancelled')).toBe(true)
      expect(requests).toBe(0)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(unhandledRejection).toBeNull()
  })

  test('历史 running 事件的 counts 快照不随后续状态变化', async () => {
    const events: ModelHealthUpdatedPayload[] = []
    const { service } = makeService({
      publish: async (payload) => {
        events.push(payload)
      },
    })
    await service.start('op:snapshot')
    await waitForStatus(service, 'op:snapshot', 'completed')
    const runningEvent = events.find((event) => event.changed?.status === 'running')
    expect(runningEvent).toBeDefined()
    expect(runningEvent?.counts).toEqual({
      total: 1,
      queued: 0,
      running: 1,
      healthy: 0,
      failed: 0,
      cancelled: 0,
    })
    const terminalEvent = events.at(-1)
    expect(terminalEvent?.counts).toEqual({
      total: 1,
      queued: 0,
      running: 0,
      healthy: 1,
      failed: 0,
      cancelled: 0,
    })
    expect(runningEvent?.counts).not.toBe(terminalEvent?.counts)
    // Every event keeps the total = queued + running + healthy + failed + cancelled invariant.
    for (const event of events) {
      const counts = event.counts
      expect(
        counts.queued + counts.running + counts.healthy + counts.failed + counts.cancelled,
      ).toBe(counts.total)
    }
  })

  test('dispose 中止并等待后台批次收敛', async () => {
    let probeStarted!: () => void
    const probeGate = new Promise<void>((resolve) => {
      probeStarted = resolve
    })
    let probeDone!: () => void
    const doneGate = new Promise<void>((resolve) => {
      probeDone = resolve
    })
    let probeFinished = false
    const { service } = makeService({
      completeSimple: async () => {
        probeStarted()
        await doneGate
        probeFinished = true
        return { stopReason: 'aborted' }
      },
    })
    await service.start('op:dispose')
    await probeGate
    const disposePromise = service.dispose()
    let settled = false
    disposePromise.then(() => {
      settled = true
    })
    await wait(20)
    expect(settled).toBe(false)
    probeDone()
    await disposePromise
    expect(probeFinished).toBe(true)
    const run = await service.read('op:dispose')
    expect(run?.status).toBe('cancelled')
  })

  test('无 status 的 rate limit 消息正确分类为 rate-limit', async () => {
    const { service } = makeService({
      completeSimple: async () => {
        throw new Error('Rate limit exceeded')
      },
    })
    await service.start('op:rate')
    await waitForStatus(service, 'op:rate', 'completed')
    const run = await service.read('op:rate')
    const failed = run?.items[0]
    expect(failed?.status).toBe('failed')
    if (failed?.status === 'failed') {
      expect(failed.category).toBe('rate-limit')
    }
  })
})
