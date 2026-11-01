import {
  SharedModelCatalogCache,
  downloadCatalogJson,
} from './SharedModelCatalogCache'
import type { RecommendationInput } from './ModelRecommendations'

const REFRESH_INTERVAL_MS = 5 * 60 * 1000

export { downloadCatalogJson }

/**
 * 推荐目录的持久化交给共享的 models.dev 缓存（{@link SharedModelCatalogCache}）。
 *
 * `path` 仍指向旧 `model-recommendations.json`：文件存在时用于只读兼容迁移，
 * 新格式写入同目录的 `shared-model-catalog.json`，不再单独保存第二份 models.dev。
 * `version()`/`updatedAt()` 语义保持不变，PiModelService 的 fingerprint 依赖它。
 */
export class ModelRecommendationStore {
  private readonly cache: SharedModelCatalogCache
  private readonly request: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>
  private refreshTimer: ReturnType<typeof setInterval> | undefined

  constructor(
    path?: string,
    request: (
      input: string | URL | Request,
      init?: RequestInit,
    ) => Promise<Response> = fetch,
  ) {
    this.cache = SharedModelCatalogCache.forPath(path)
    this.request = request
  }

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

  async resolve(input: RecommendationInput) {
    return this.cache.resolve(input)
  }

  /** 当前目录版本；推荐更新后指纹变化会触发已保存模型重新合成。 */
  async version(): Promise<number | undefined> {
    return this.cache.version()
  }

  refresh() {
    return this.cache.refresh(this.request)
  }
}
