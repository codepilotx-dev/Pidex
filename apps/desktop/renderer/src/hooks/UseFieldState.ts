import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { useStore } from 'zustand/react'
import type { StoreApi } from 'zustand/vanilla'

/** 保留现有 updater 语义，状态只保存在所属实例的 Zustand Store。 */
export function useFieldState<State, Key extends keyof State>(
  store: StoreApi<State>,
  key: Key,
): [State[Key], Dispatch<SetStateAction<State[Key]>>] {
  const value = useStore(store, (state) => state[key])
  const setValue = useCallback(
    (update: SetStateAction<State[Key]>) => {
      const current = store.getState()[key]
      const next =
        typeof update === 'function'
          ? (update as (value: State[Key]) => State[Key])(current)
          : update
      if (!Object.is(current, next))
        store.setState((state) => Object.assign({}, state, { [key]: next }))
    },
    [store, key],
  )
  return [value, setValue]
}
