import type { DesktopThinkingMode } from '../../../../shared/Types.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import {
  isSelectableRecentNewThreadModel,
  persistRecentNewThreadModel,
  resolveRecentNewThreadModel,
  type RecentNewThreadModel,
} from '../../models/RecentNewThreadModel.js'

export type SessionModelSelection = {
  providerID: string
  model: string
  thinkingMode: DesktopThinkingMode
  variant?: string
}
type SelectionState = {
  selection: SessionModelSelection | null
  loading: boolean
  error: string | null
}
const empty: SelectionState = { selection: null, loading: true, error: null }
const states = new Map<string | null, SelectionState>()
const pending = new Map<string | null, Promise<SessionModelSelection>>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

const thinkingModeForVariant = (variant: string | undefined): DesktopThinkingMode =>
  variant === 'enabled'
    ? 'enabled'
    : variant === 'adaptive'
      ? 'adaptive'
      : variant === 'disabled'
        ? 'disabled'
        : 'default'

const selectionFromRecentModel = (ref: RecentNewThreadModel): SessionModelSelection => ({
  providerID: ref.providerID,
  model: ref.id,
  thinkingMode: thinkingModeForVariant(ref.variant),
  ...(ref.variant ? { variant: ref.variant } : {}),
})

const recentModelFromSelection = (selection: SessionModelSelection): RecentNewThreadModel => ({
  providerID: selection.providerID,
  id: selection.model,
  ...(selection.variant ? { variant: selection.variant } : {}),
})

/**
 * 新建任务一级页没有会话历史，使用全局“最近一次选择的模型”。
 * 每次进入都必须重新验证：内存中的选择仍可用时沿用（避免丢失未落盘的选择），
 * 否则统一解析最近记录并回退到首个启用模型；解析结果不可用时返回不可发送错误。
 */
async function loadRecentNewThreadSelection(
  preferred: SessionModelSelection | null,
): Promise<SessionModelSelection> {
  let preferredUsable = false
  let preferredCheckFailed = false
  if (preferred?.providerID && preferred.model) {
    try {
      preferredUsable = await isSelectableRecentNewThreadModel(recentModelFromSelection(preferred))
    } catch {
      preferredCheckFailed = true
    }
  }
  if (preferredUsable) return { ...preferred! }
  let resolved: RecentNewThreadModel | null = null
  try {
    resolved = await resolveRecentNewThreadModel()
  } catch (error) {
    // 目录或配置暂时不可读时保留内存选择，避免一级页无谓地不可发送。
    if (preferred && preferredCheckFailed) return { ...preferred }
    throw error
  }
  if (resolved) return selectionFromRecentModel(resolved)
  if (preferred && preferredCheckFailed) return { ...preferred }
  throw new Error('没有可用于创建任务的模型，请先连接 Provider')
}

export const sessionModelSelections = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  getSnapshot(id: string | null): SelectionState {
    return states.get(id) ?? empty
  },
  set(id: string | null, selection: SessionModelSelection) {
    pending.delete(id)
    const { providerID, model, thinkingMode, variant } = selection
    states.set(id, {
      selection: { providerID, model, thinkingMode, ...(variant ? { variant } : {}) },
      loading: false,
      error: null,
    })
    emit()
  },
  /**
   * 新建任务一级页发生模型切换时，把选择写回全局“最近新建任务模型”。
   * 写入进入单一串行队列并 latest-write-wins；已有任务保持任务级隔离。
   * 返回的 Promise 只在最后一次选择真正保存失败时 reject，由调用方统一提示。
   */
  persistRecent(id: string | null, selection: SessionModelSelection): Promise<void> {
    if (id !== null) return Promise.resolve()
    return persistRecentNewThreadModel(recentModelFromSelection(selection))
  },
  delete(id: string | null) {
    pending.delete(id)
    states.delete(id)
    emit()
  },
  async load(id: string | null): Promise<SessionModelSelection> {
    const existing = states.get(id)?.selection
    // 一级页每次进入都重新验证最近模型，不复用长期缓存；已有任务沿用内存选择。
    if (existing && id !== null) return { ...existing }
    const request = pending.get(id)
    const operation =
      request ??
      (async () => {
        if (!id) return loadRecentNewThreadSelection(existing ?? null)
        const snapshot = await desktopClient.getSession(id)
        if (!snapshot) throw new Error('会话模型加载失败，请重试')
        const history = snapshot.settings
        if (history?.providerID && history.model) {
          return {
            providerID: history.providerID,
            model: history.model,
            thinkingMode: history.thinkingMode ?? 'default',
            variant: history.variant,
          }
        }
        const defaults = await desktopClient.getModelProviderState()
        return {
          providerID: defaults.selectedProviderID,
          model: defaults.modelConfigured ? defaults.model : '',
          thinkingMode:
            defaults.variant === 'enabled'
              ? ('enabled' as const)
              : defaults.variant === 'adaptive'
                ? ('adaptive' as const)
                : defaults.variant === 'disabled'
                  ? ('disabled' as const)
                  : ('default' as const),
          ...(defaults.variant ? { variant: defaults.variant } : {}),
        }
      })()
    if (!request) {
      // 一级页重新验证期间保留当前选择，避免模型选择器闪回空状态。
      if (!existing) {
        states.set(id, empty)
        emit()
      }
      pending.set(id, operation)
    }
    try {
      const selection = await operation
      if (pending.get(id) === operation) this.set(id, selection)
      const selected = states.get(id)?.selection
      if (!selected) throw new Error('会话模型加载已取消')
      return { ...selected }
    } catch (error) {
      const selected = states.get(id)?.selection
      if (selected) return { ...selected }
      if (pending.get(id) === operation) {
        pending.delete(id)
        states.set(id, {
          selection: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        })
        emit()
      }
      throw error
    }
  },
}
