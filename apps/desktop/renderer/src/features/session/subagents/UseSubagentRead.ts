import { useCallback, useEffect, useRef, useState } from 'react'
import type { DesktopSubagentRead } from '../../../../shared/Types.js'
import { desktopClient } from '../../../services/desktop-client/index.js'

export type SubagentReadAvailability = 'loading' | 'available' | 'unavailable'

type SubagentReadState = {
  taskId: string | null
  read: DesktopSubagentRead | null
  error: string | null
}

const EMPTY_STATE: SubagentReadState = { taskId: null, read: null, error: null }

/**
 * 读取单个子智能体详情。轮询间隔按失败次数退避（1s 起，最多 15s）；
 * 请求与 taskId、读取代际双向绑定，切任务或卸载后旧响应不得回写。
 */
export function useSubagentRead(taskId: string | null): {
  availability: SubagentReadAvailability
  read: DesktopSubagentRead | null
  error: string | null
  refresh: () => Promise<void>
} {
  const [availability, setAvailability] = useState<SubagentReadAvailability>('loading')
  const [state, setState] = useState<SubagentReadState>(EMPTY_STATE)
  const generationRef = useRef(0)
  const taskIdRef = useRef(taskId)
  taskIdRef.current = taskId

  useEffect(() => {
    let disposed = false
    void desktopClient
      .getRuntimeCapabilities()
      .then((capabilities) => {
        if (!disposed) {
          setAvailability(capabilities.includes('subagents.v1') ? 'available' : 'unavailable')
        }
      })
      .catch(() => {
        if (!disposed) setAvailability('unavailable')
      })
    return () => {
      disposed = true
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const requestedTaskId = taskIdRef.current
    if (!requestedTaskId || !desktopClient.readSubagent) return
    const generation = ++generationRef.current
    try {
      const read = await desktopClient.readSubagent(requestedTaskId)
      if (generation !== generationRef.current || taskIdRef.current !== requestedTaskId) return
      setState({ taskId: requestedTaskId, read, error: null })
    } catch (error) {
      if (generation !== generationRef.current || taskIdRef.current !== requestedTaskId) return
      const message = error instanceof Error ? error.message : String(error)
      setState({ taskId: requestedTaskId, read: null, error: message })
      throw error
    }
  }, [])

  // 切任务立刻丢弃上一任务详情，避免闪现旧内容。
  useEffect(() => {
    generationRef.current += 1
    setState(EMPTY_STATE)
  }, [taskId])

  useEffect(() => {
    if (!taskId || availability !== 'available') return
    let disposed = false
    let timer: number | null = null
    let failureCount = 0
    const poll = async (): Promise<void> => {
      try {
        await refresh()
        failureCount = 0
      } catch {
        failureCount += 1
      }
      if (disposed) return
      timer = window.setTimeout(() => void poll(), Math.min(15_000, 1_000 * 2 ** failureCount))
    }
    void poll()
    return () => {
      disposed = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [availability, refresh, taskId])

  const scoped = state.taskId === taskId ? state : EMPTY_STATE
  const unavailableError =
    taskId && availability === 'unavailable' ? '当前 Agent 不支持子智能体工作台。' : null
  return {
    availability,
    read: scoped.read,
    error: unavailableError ?? scoped.error,
    refresh,
  }
}
