import type { ModelProviderID } from '../../../shared/Types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { isExecutableDesktopProvider } from '../../services/desktop-client/ProviderAdapters.js'

/**
 * 新建任务的“最近模型”在配置中只保存 providerID/id/variant。
 * 该模块是新建任务页、首次引导和自动化共用的唯一解析入口。
 */
export type RecentNewThreadModel = {
  providerID: string
  id: string
  variant?: string
}

export function asRecentNewThreadModelRef(model: RecentNewThreadModel): {
  providerID: string
  id: string
  variant?: string
} {
  return {
    providerID: model.providerID,
    id: model.id,
    ...(model.variant ? { variant: model.variant } : {}),
  }
}

/**
 * 判定一条最近模型记录当前是否仍可选择：
 * Provider 必须启用且可执行、认证可用，模型必须存在且 enabled，variant 必须合法。
 * 目录暂时不可读时抛出错误，由调用方决定是保留内存选择还是中止。
 */
export async function isSelectableRecentNewThreadModel(
  model: RecentNewThreadModel,
): Promise<boolean> {
  if (!model.providerID || !model.id) return false
  const providers = await desktopClient.listModelProviders()
  const provider = providers.find((item) => String(item.providerID) === model.providerID)
  if (!provider || provider.apiKeyConfigured !== true || !isExecutableDesktopProvider(provider))
    return false
  const page = await desktopClient.fetchProviderModels({
    providerID: model.providerID as ModelProviderID,
    query: model.id,
    limit: 100,
  })
  if (!page.models.includes(model.id)) return false
  if (model.variant && !(page.modelMetadata?.[model.id]?.variants ?? []).includes(model.variant))
    return false
  return true
}

/**
 * 解析新建任务应使用的模型：优先复用仍可用的最近记录，
 * 否则按 Provider 目录顺序回退到首个启用模型并立即覆盖最近记录。
 * 没有任何可用模型时返回 null；目录不可读时抛出错误。
 */
export async function resolveRecentNewThreadModel(): Promise<RecentNewThreadModel | null> {
  await awaitRecentNewThreadModelWrites()
  const stored = await desktopClient.getRecentNewThreadModel()
  if (stored?.providerID && stored.id) {
    const candidate: RecentNewThreadModel = {
      providerID: stored.providerID,
      id: stored.id,
      ...(stored.variant ? { variant: stored.variant } : {}),
    }
    if (await isSelectableRecentNewThreadModel(candidate)) return candidate
  }
  const first = await desktopClient.resolveFirstAvailableModel()
  if (!first?.providerID || !first.id) return null
  const resolved: RecentNewThreadModel = {
    providerID: first.providerID,
    id: first.id,
    ...(first.variant ? { variant: first.variant } : {}),
  }
  // 记录失效时立即用统一解析结果覆盖，保证下次进入直接命中。
  await persistRecentNewThreadModel(resolved).catch(() => undefined)
  return resolved
}

let writeTail: Promise<void> = Promise.resolve()
let writeGeneration = 0

/**
 * 串行保存最近模型，并以 generation 实现 latest-write-wins：
 * 被更新选择取代的中间写入直接跳过；若已开始的写入失败但已被取代，
 * 其失败静默，只有最后一次选择的失败会 reject 给调用方。
 */
export function persistRecentNewThreadModel(model: RecentNewThreadModel): Promise<void> {
  if (!model.providerID || !model.id) return Promise.resolve()
  const generation = ++writeGeneration
  const operation = writeTail
    .catch(() => undefined)
    .then(async () => {
      if (generation !== writeGeneration) return
      try {
        await desktopClient.saveRecentNewThreadModel(asRecentNewThreadModelRef(model))
      } catch (error) {
        // 中间选择失败不覆盖更新的选择，也不向调用方报错。
        if (generation !== writeGeneration) return
        throw error
      }
    })
  writeTail = operation.then(
    () => undefined,
    () => undefined,
  )
  return operation
}

/** 等待所有排队中的最近模型写入结束，避免解析读到过期记录。 */
export function awaitRecentNewThreadModelWrites(): Promise<void> {
  return writeTail
}
