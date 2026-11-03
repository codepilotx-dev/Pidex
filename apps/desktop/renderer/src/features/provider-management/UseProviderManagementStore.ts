import { useEffect } from 'react'
import { useStore } from 'zustand/react'
import { useShallow } from 'zustand/react/shallow'
import { providerManagementStore, type ProviderManagementStore } from './ProviderManagementStore.js'
import type { ProviderManagementState } from './Types.js'

/**
 * 按字段订阅 Provider 管理状态。聚合字段用 `useShallow`，字段本身也须保持引用稳定；
 * 缺失分区直接选择 undefined，避免 selector 内新建空对象导致快照循环。
 * 挂载时确保目录、凭据与用量来源已读取；重复调用复用同一在途批次。
 */
export function useProviderManagementStore<T>(
  selector: (state: ProviderManagementState) => T,
  store: ProviderManagementStore = providerManagementStore,
): T {
  const value = useStore(store, selector)
  useEffect(() => {
    void store.ensureLoaded()
  }, [store])
  return value
}

export { useShallow }
