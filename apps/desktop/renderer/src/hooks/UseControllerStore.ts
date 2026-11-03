import { useEffect, useState } from 'react'
import { createStore } from 'zustand/vanilla'

/** Controller 的派生字段和动作投影；源状态由领域 Store 持有。 */
export function useControllerStore<State extends object>(snapshot: State) {
  const [store] = useState(() => createStore<State>(() => snapshot))
  useEffect(() => {
    store.setState(snapshot)
  })
  return store
}
