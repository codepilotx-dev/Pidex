import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ModelRecommendationIndex, type RecommendationInput } from './ModelRecommendations'

const URL = 'https://models.dev/catalog.json?type=all'
const REFRESH_INTERVAL_MS = 5 * 60 * 1000
type Document = { owner: 'pidex'; formatVersion: 1; updatedAt: number; catalog: unknown }

export class ModelRecommendationStore {
  private loaded = false
  private index?: ModelRecommendationIndex
  private updatedAt?: number
  private operation: Promise<unknown> = Promise.resolve()
  private refreshTimer: ReturnType<typeof setInterval> | undefined
  constructor(
    private readonly path?: string,
    private readonly request: (
      input: string | URL | Request,
      init?: RequestInit,
    ) => Promise<Response> = fetch,
  ) {}

  startAutoRefresh() {
    if (this.refreshTimer) return
    const update = () => {
      void this.refresh().catch(() => undefined)
    }
    update()
    this.refreshTimer = setInterval(update, REFRESH_INTERVAL_MS)
    this.refreshTimer.unref()
  }

  dispose() {
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    this.refreshTimer = undefined
  }

  private async load(force = false) {
    if (this.loaded && !force) return
    if (this.path) {
      try {
        const raw = JSON.parse(await readFile(this.path, 'utf8')) as Document
        if (raw.owner !== 'pidex' || raw.formatVersion !== 1 || !Number.isFinite(raw.updatedAt))
          throw new Error('Unsupported recommendation cache')
        this.index = new ModelRecommendationIndex(raw.catalog)
        this.updatedAt = raw.updatedAt
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
          throw error
      }
    }
    this.loaded = true
  }

  async resolve(input: RecommendationInput) {
    await this.load()
    return {
      ...(this.index?.resolve(input) ?? {
        status: 'no-cache' as const,
        recommended: {} as import('@pidex/model-schema').Model.Recommendation,
      }),
      ...(this.updatedAt !== undefined ? { updatedAt: this.updatedAt } : {}),
    }
  }

  refresh() {
    return this.serial(async () => {
      await this.load(true)
      const response = await this.request(URL, {
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
      })
      if (!response.ok) throw new Error('models.dev recommendation download failed')
      const reader = response.body?.getReader()
      if (!reader) throw new Error('Empty models.dev response')
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.length
          if (size > 64 * 1024 * 1024) throw new Error('models.dev catalog too large')
          chunks.push(value)
        }
      } finally {
        await reader.cancel()
      }
      const catalog: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const index = new ModelRecommendationIndex(catalog)
      const updatedAt = Date.now()
      if (this.path) {
        await mkdir(dirname(this.path), { recursive: true })
        const temporary = `${this.path}.${randomUUID()}.tmp`
        try {
          await writeFile(
            temporary,
            JSON.stringify({ owner: 'pidex', formatVersion: 1, updatedAt, catalog }),
            'utf8',
          )
          await rename(temporary, this.path)
        } finally {
          await rm(temporary, { force: true })
        }
      }
      this.index = index
      this.updatedAt = updatedAt
      return { updatedAt }
    })
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.operation.then(action, action)
    this.operation = next.catch(() => undefined)
    return next
  }
}
