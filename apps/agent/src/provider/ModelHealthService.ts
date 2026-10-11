import { Model, Provider } from '@pidex/model-schema'
import type { Api, Model as PiModel } from '@earendil-works/pi-ai'
import { Schema } from 'effect'
import { AgentError } from '../Domain'
import type { PiModelService } from './pi'

const modelRef = Schema.decodeUnknownSync(Model.Ref)

export type ModelHealthFailureCategory =
  'authentication' | 'configuration' | 'network' | 'rate-limit' | 'timeout' | 'provider' | 'unknown'

export type ModelHealthItem =
  | {
      model: Model.Ref
      status: 'queued'
    }
  | {
      model: Model.Ref
      status: 'running'
      startedAt: number
    }
  | {
      model: Model.Ref
      status: 'healthy'
      startedAt: number
      completedAt: number
      latencyMs: number
    }
  | {
      model: Model.Ref
      status: 'failed'
      startedAt: number
      completedAt: number
      category: ModelHealthFailureCategory
      message: string
    }
  | {
      model: Model.Ref
      status: 'cancelled'
      completedAt: number
    }

export type ModelHealthExcludedProvider = {
  providerId: Provider.ID
  reason: 'provider-disabled' | 'provider-unconfigured' | 'no-eligible-models'
  modelCount: number
}

export type ModelHealthCounts = {
  total: number
  queued: number
  running: number
  healthy: number
  failed: number
  cancelled: number
}

export type ModelHealthRun = {
  runId: string
  status: 'running' | 'cancelling' | 'completed' | 'cancelled'
  startedAt: number
  completedAt?: number
  counts: ModelHealthCounts
  excludedProviders: ModelHealthExcludedProvider[]
  items: ModelHealthItem[]
}

export type ModelHealthUpdatedPayload = {
  runId: string
  status: ModelHealthRun['status']
  counts: ModelHealthCounts
  changed?: ModelHealthItem
  completedAt?: number
}

type ProbeResult =
  | { ok: true; latencyMs: number }
  | { ok: false; category: ModelHealthFailureCategory; message: string }

type HealthUpdatedHandler = (payload: ModelHealthUpdatedPayload) => void | Promise<void>

/** A start() still building candidates; cancel() can flip it before any probe. */
type Admission = {
  operationId: string
  promise: Promise<ModelHealthRun>
  cancelled: boolean
}

const valueAt = (value: unknown, key: string): unknown =>
  value && typeof value === 'object' && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined

const statusCode = (cause: unknown): number | undefined => {
  const direct = valueAt(cause, 'statusCode') ?? valueAt(cause, 'status')
  if (typeof direct === 'number') return direct
  const nested = valueAt(cause, 'cause')
  return nested === cause ? undefined : statusCode(nested)
}

const isTimeoutSignal = (cause: unknown, message: string): boolean => {
  if (
    cause instanceof DOMException &&
    (cause.name === 'TimeoutError' || cause.name === 'AbortError')
  )
    return true
  return /timed?\s*out|timeout|abort/i.test(message)
}

export const providerFailureCategory = (cause: unknown): ModelHealthFailureCategory => {
  const status = statusCode(cause)
  const message = cause instanceof Error ? cause.message : String(cause)
  if (
    cause &&
    typeof cause === 'object' &&
    'name' in cause &&
    (cause as { name?: unknown }).name === 'AbortError'
  ) {
    return 'timeout'
  }
  if (status === 401 || status === 403) return 'authentication'
  if (status === 429) return 'rate-limit'
  if (
    /unauthori[sz]ed|forbidden|invalid\s*(?:api.?key|token)|auth(?:entication)?\s*(?:failed|error)/i.test(
      message,
    )
  )
    return 'authentication'
  if (/rate[\s_-]?limit|429|too many requests/i.test(message)) return 'rate-limit'
  if (isTimeoutSignal(cause, message)) return 'timeout'
  if (cause instanceof TypeError || /network|fetch|socket|dns|connect|econn/i.test(message))
    return 'network'
  if (status !== undefined && status >= 500) return 'provider'
  if (status !== undefined && status >= 400 && status < 500) return 'configuration'
  if (cause instanceof Error && cause.name === 'PiModelServiceError') return 'configuration'
  return 'unknown'
}

export const providerFailureMessage = (
  category: ModelHealthFailureCategory,
  context: 'request' | 'health-check',
): string => {
  switch (category) {
    case 'authentication':
      return '凭据鉴权失败'
    case 'configuration':
      return '模型或 Provider 配置不可用'
    case 'network':
      return '网络连接失败'
    case 'rate-limit':
      return '请求受到限流'
    case 'timeout':
      return context === 'request' ? '模型请求超时，请稍后重试' : '请求在 15 秒内未完成'
    case 'provider':
      return 'Provider 服务暂时不可用'
    default:
      return context === 'request' ? '模型请求失败，请稍后重试' : '模型测试失败'
  }
}

const emptyCounts = (): ModelHealthCounts => ({
  total: 0,
  queued: 0,
  running: 0,
  healthy: 0,
  failed: 0,
  cancelled: 0,
})

const isRunActive = (status: ModelHealthRun['status']): boolean =>
  status === 'running' || status === 'cancelling'

const conflictError = (message = '另一个模型健康测试批次正在进行'): AgentError =>
  new AgentError('CONFLICT', message, 409)

/** Recomputes counts from item statuses so every transition keeps total = queued + running + healthy + failed + cancelled. */
const recountCounts = (run: ModelHealthRun): void => {
  const counts = emptyCounts()
  counts.total = run.items.length
  for (const item of run.items) counts[item.status] += 1
  run.counts = counts
}

/** Bounded worker pool keeping at most `limit` tasks in-flight. */
class ProbePool {
  private readonly queue: Array<() => Promise<void>> = []
  private active = 0
  private firstError: unknown = null
  private idleResolvers: Array<() => void> = []

  constructor(private readonly limit: number) {}

  enqueue(task: () => Promise<void>): void {
    this.queue.push(task)
    this.schedule()
  }

  private schedule(): void {
    while (this.active < this.limit && this.queue.length > 0) {
      const task = this.queue.shift()!
      this.active += 1
      void this.runOne(task)
    }
    if (this.active === 0 && this.queue.length === 0) {
      for (const resolve of this.idleResolvers.splice(0)) resolve()
    }
  }

  private async runOne(task: () => Promise<void>): Promise<void> {
    try {
      await task()
    } catch (error) {
      // Keep the first failure so drain() can reject; never leak an unhandled
      // rejection from background worker tasks.
      this.firstError ??= error
    } finally {
      this.active -= 1
      this.schedule()
    }
  }

  /**
   * Settles once every enqueued task has run, then rejects with the first task
   * failure. Queued tasks are not abandoned on error: the caller aborts the
   * batch controller and lets them convert items to a terminal state.
   */
  async drain(): Promise<void> {
    while (this.active > 0 || this.queue.length > 0) {
      await new Promise<void>((resolve) => {
        this.idleResolvers.push(resolve)
        if (this.active === 0 && this.queue.length === 0) resolve()
      })
    }
    if (this.firstError) throw this.firstError
  }
}

/**
 * Single implementation behind provider/API-key/batch model probes. Performs a
 * real, minimal text request through Pi's unique credential chain (an explicit
 * apiKey overrides only for that request without mutating active credentials).
 */
export class ModelHealthService {
  private currentRun: ModelHealthRun | null = null
  private pendingStart: Admission | null = null
  private currentController: AbortController | null = null
  private batchPromise: Promise<void> | null = null
  private consumed = false

  constructor(
    private readonly piModels: PiModelService,
    private readonly onUpdated: HealthUpdatedHandler,
  ) {}

  async preview(): Promise<{
    totalRequests: number
    excludedProviders: ModelHealthExcludedProvider[]
  }> {
    const { candidates, excludedProviders } = await this.buildCandidates()
    return {
      totalRequests: candidates.length,
      excludedProviders,
    }
  }

  /**
   * Single-flight admission: the first call with an operationId builds the
   * candidates and starts the batch exactly once; concurrent calls with the
   * same operationId reuse the same promise; a different operationId while an
   * admission or batch is pending fails fast with CONFLICT.
   */
  async start(operationId: string): Promise<ModelHealthRun> {
    if (this.consumed) {
      throw new AgentError('SERVICE_UNAVAILABLE', '模型健康测试服务已释放', 503)
    }
    if (this.pendingStart) {
      if (this.pendingStart.operationId === operationId) {
        return this.snapshot(await this.pendingStart.promise)
      }
      throw conflictError()
    }
    if (this.currentRun) {
      if (this.currentRun.runId === operationId) return this.snapshot(this.currentRun)
      if (isRunActive(this.currentRun.status)) throw conflictError()
    }

    const admission: Admission = {
      operationId,
      promise: undefined as unknown as Promise<ModelHealthRun>,
      cancelled: false,
    }
    admission.promise = this.buildRun(admission)
    this.pendingStart = admission
    try {
      return this.snapshot(await admission.promise)
    } finally {
      if (this.pendingStart === admission) this.pendingStart = null
    }
  }

  async read(runId: string): Promise<ModelHealthRun | null> {
    if (this.currentRun && this.currentRun.runId === runId) return this.snapshot(this.currentRun)
    return null
  }

  async cancel(runId: string, _operationId: string): Promise<ModelHealthRun> {
    // A cancel racing a start in candidate-building flips the admission: the
    // build resolves a cancelled snapshot without launching any probe.
    const admission = this.pendingStart
    if (admission && admission.operationId === runId) {
      admission.cancelled = true
      return this.snapshot(await admission.promise)
    }
    const run = this.currentRun
    if (!run || run.runId !== runId) throw conflictError('未找到对应的模型健康测试批次')
    if (run.status === 'completed' || run.status === 'cancelled') {
      return this.snapshot(run)
    }
    run.status = 'cancelling'
    const now = Date.now()
    let changed = false
    for (let index = 0; index < run.items.length; index++) {
      const item = run.items[index]
      if (!item || item.status !== 'queued') continue
      this.replaceItem(run, index, {
        model: item.model,
        status: 'cancelled',
        completedAt: now,
      })
      changed = true
    }
    if (changed) recountCounts(run)
    this.currentController?.abort()
    if (changed) {
      await this.emit({
        runId,
        status: run.status,
        counts: run.counts,
        completedAt: now,
      }).catch(() => undefined)
    }
    return this.snapshot(run)
  }

  async dispose(): Promise<void> {
    if (this.consumed) return
    this.consumed = true
    if (this.pendingStart) this.pendingStart.cancelled = true
    this.currentController?.abort()
    const batch = this.batchPromise
    if (batch) await batch.catch(() => undefined)
  }

  private async buildRun(admission: Admission): Promise<ModelHealthRun> {
    const { candidates, excludedProviders } = await this.buildCandidates()
    const startedAt = Date.now()
    if (admission.cancelled) {
      // The batch was cancelled before it started: publish a consistent
      // cancelled snapshot and never touch the provider.
      const completedAt = Date.now()
      const items: ModelHealthItem[] = candidates.map((model) => ({
        model,
        status: 'cancelled',
        completedAt,
      }))
      const counts = emptyCounts()
      counts.total = items.length
      counts.cancelled = items.length
      const run: ModelHealthRun = {
        runId: admission.operationId,
        status: 'cancelled',
        startedAt,
        completedAt,
        counts,
        excludedProviders,
        items,
      }
      this.currentRun = run
      await this.emit({
        runId: run.runId,
        status: run.status,
        counts: run.counts,
        completedAt,
      }).catch(() => undefined)
      return run
    }

    const items: ModelHealthItem[] = candidates.map((model) => ({
      model,
      status: 'queued',
    }))
    const counts = emptyCounts()
    counts.total = items.length
    counts.queued = items.length
    const run: ModelHealthRun = {
      runId: admission.operationId,
      status: 'running',
      startedAt,
      counts,
      excludedProviders,
      items,
    }
    this.currentRun = run
    const controller = new AbortController()
    this.currentController = controller
    await this.emit({
      runId: run.runId,
      status: run.status,
      counts: run.counts,
    }).catch(() => undefined)
    this.batchPromise = this.runBatch(run, controller)
    return run
  }

  private async runBatch(run: ModelHealthRun, controller: AbortController): Promise<void> {
    const pool = new ProbePool(4)
    let probeError: unknown = null
    try {
      for (let index = 0; index < run.items.length; index++) {
        const taskIndex = index
        pool.enqueue(() => this.dispatchProbe(run, controller, taskIndex))
      }
      await pool.drain()
    } catch (error) {
      probeError = error
    }
    if (probeError) {
      controller.abort()
      // Queued tasks still run through dispatchProbe with the aborted signal so
      // every item lands in a terminal state before the run terminal event.
      await pool.drain().catch(() => undefined)
      const now = Date.now()
      for (let index = 0; index < run.items.length; index++) {
        const item = run.items[index]
        if (!item || (item.status !== 'queued' && item.status !== 'running')) continue
        this.replaceItem(run, index, {
          model: item.model,
          status: 'cancelled',
          completedAt: now,
        })
      }
      recountCounts(run)
    }
    run.status =
      probeError || controller.signal.aborted || run.status === 'cancelling'
        ? 'cancelled'
        : 'completed'
    run.completedAt = Date.now()
    await this.emitTerminal(run)
  }

  private async emitTerminal(run: ModelHealthRun): Promise<void> {
    try {
      await this.emit({
        runId: run.runId,
        status: run.status,
        counts: run.counts,
        ...(run.completedAt === undefined ? {} : { completedAt: run.completedAt }),
      })
    } catch {
      // Terminal publication is best-effort: the snapshot stays readable via
      // read() and a failed second publish must not surface as an unhandled
      // rejection.
    }
  }

  private async dispatchProbe(
    run: ModelHealthRun,
    controller: AbortController,
    index: number,
  ): Promise<void> {
    const current = run.items[index]
    // A cancel() may have already replaced this queued item before we started.
    if (!current || current.status !== 'queued') return
    if (controller.signal.aborted) {
      this.replaceItem(run, index, {
        model: current.model,
        status: 'cancelled',
        completedAt: Date.now(),
      })
      recountCounts(run)
      return
    }
    const startedAt = Date.now()
    const runningItem: ModelHealthItem = {
      model: current.model,
      status: 'running',
      startedAt,
    }
    this.replaceItem(run, index, runningItem)
    recountCounts(run)
    await this.emit({
      runId: run.runId,
      status: run.status,
      counts: run.counts,
      changed: runningItem,
    })

    // The emit above can interleave with cancel()/dispose(): never start a
    // probe on an already-aborted signal, or its abort listener would never
    // fire and the item would stay running until the timeout.
    if (controller.signal.aborted) {
      if (run.items[index]?.status !== 'running') return
      const cancelledItem: ModelHealthItem = {
        model: current.model,
        status: 'cancelled',
        completedAt: Date.now(),
      }
      this.replaceItem(run, index, cancelledItem)
      recountCounts(run)
      return
    }

    const result = await this.probe(current.model, { signal: controller.signal })
    const completedAt = Date.now()
    if (controller.signal.aborted) {
      // runBatch's error handler may have already converted this item.
      if (run.items[index]?.status !== 'running') return
      const cancelledItem: ModelHealthItem = {
        model: current.model,
        status: 'cancelled',
        completedAt,
      }
      this.replaceItem(run, index, cancelledItem)
      recountCounts(run)
      await this.emit({
        runId: run.runId,
        status: run.status,
        counts: run.counts,
        changed: cancelledItem,
      })
      return
    }
    if (result.ok) {
      const healthyItem: ModelHealthItem = {
        model: current.model,
        status: 'healthy',
        startedAt,
        completedAt,
        latencyMs: result.latencyMs,
      }
      this.replaceItem(run, index, healthyItem)
      recountCounts(run)
      await this.emit({
        runId: run.runId,
        status: run.status,
        counts: run.counts,
        changed: healthyItem,
      })
    } else {
      const failedItem: ModelHealthItem = {
        model: current.model,
        status: 'failed',
        startedAt,
        completedAt,
        category: result.category,
        message: result.message,
      }
      this.replaceItem(run, index, failedItem)
      recountCounts(run)
      await this.emit({
        runId: run.runId,
        status: run.status,
        counts: run.counts,
        changed: failedItem,
      })
    }
  }

  private replaceItem(run: ModelHealthRun, index: number, to: ModelHealthItem): void {
    if (index >= 0 && index < run.items.length) run.items[index] = to
  }

  private async emit(payload: ModelHealthUpdatedPayload): Promise<void> {
    // Copy every mutable reference before it reaches the EventHub/SSE buffer:
    // historical events must not change with later healthy/failed updates.
    await this.onUpdated({
      runId: payload.runId,
      status: payload.status,
      counts: { ...payload.counts },
      ...(payload.changed
        ? { changed: { ...payload.changed, model: { ...payload.changed.model } } }
        : {}),
      ...(payload.completedAt !== undefined ? { completedAt: payload.completedAt } : {}),
    })
  }

  private snapshot(run: ModelHealthRun): ModelHealthRun {
    return {
      runId: run.runId,
      status: run.status,
      startedAt: run.startedAt,
      ...(run.completedAt === undefined ? {} : { completedAt: run.completedAt }),
      counts: { ...run.counts },
      excludedProviders: run.excludedProviders.map((entry) => ({ ...entry })),
      items: run.items.map((item) => ({ ...item, model: { ...item.model } })),
    }
  }

  private async buildCandidates(): Promise<{
    candidates: Model.Ref[]
    excludedProviders: ModelHealthExcludedProvider[]
  }> {
    const providers = await this.piModels.list()
    const candidates: Model.Ref[] = []
    const excludedProviders: ModelHealthExcludedProvider[] = []
    const seen = new Set<string>()

    for (const provider of providers) {
      const providerID = provider.id
      if (provider.disabled) {
        excludedProviders.push({
          providerId: providerID,
          reason: 'provider-disabled',
          modelCount: 0,
        })
        continue
      }
      const models = await this.piModels.models(providerID)
      const enabled = models.filter((model) => model.enabled === true)
      if (models.length === 0) {
        excludedProviders.push({
          providerId: providerID,
          reason: 'no-eligible-models',
          modelCount: 0,
        })
        continue
      }
      if (enabled.length === 0) {
        excludedProviders.push({
          providerId: providerID,
          reason: 'provider-unconfigured',
          modelCount: models.length,
        })
        continue
      }
      for (const model of enabled) {
        const key = `${String(providerID)}/${String(model.id)}`
        if (seen.has(key)) continue
        seen.add(key)
        candidates.push(
          modelRef({
            providerID,
            id: model.id,
          }),
        )
      }
    }

    return { candidates, excludedProviders }
  }

  /**
   * Executes one real minimal text request for a model and classifies the
   * outcome. Uses the active provider credential unless an explicit apiKey is
   * supplied (which overrides for this request only).
   */
  async probe(
    ref: Model.Ref,
    opts: {
      explicitApiKey?: string
      signal?: AbortSignal
    } = {},
  ): Promise<ProbeResult> {
    let piModel: PiModel<Api>
    try {
      piModel = await this.piModels.getPiModel(ref)
    } catch {
      return {
        ok: false,
        category: 'configuration',
        message: providerFailureMessage('configuration', 'health-check'),
      }
    }
    // getPiModel can race cancel()/dispose(): never hand an already-aborted
    // signal to the request, or its abort listener would never fire.
    if (opts.signal?.aborted) {
      return { ok: false, category: 'timeout', message: '模型测试已取消' }
    }
    const startedAt = performance.now()
    try {
      const response = await this.piModels.pi.completeSimple(
        piModel,
        {
          messages: [
            {
              role: 'user',
              content: 'Reply OK.',
              timestamp: Date.now(),
            },
          ],
        },
        {
          ...(opts.explicitApiKey ? { apiKey: opts.explicitApiKey } : {}),
          maxTokens: 8,
          maxRetries: 0,
          signal: AbortSignal.any([
            ...(opts.signal ? [opts.signal] : []),
            AbortSignal.timeout(15_000),
          ]),
        },
      )
      if (response.stopReason === 'error' || response.stopReason === 'aborted') {
        throw new Error(response.errorMessage ?? '模型的响应异常')
      }
      return { ok: true, latencyMs: Math.max(0, Math.round(performance.now() - startedAt)) }
    } catch (cause) {
      if (opts.signal?.aborted) {
        return { ok: false, category: 'timeout', message: '模型测试已取消' }
      }
      const category = providerFailureCategory(cause)
      return { ok: false, category, message: providerFailureMessage(category, 'health-check') }
    }
  }
}
