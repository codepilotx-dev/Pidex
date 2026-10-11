import { useCallback, useEffect, useState } from 'react'
import type { DesktopSubagentRead } from '../../../../shared/Types.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import type { WorkbenchTabDescriptor } from './RightDockState.js'

export function useSubagentDockController({
  activeSideTaskId,
  openRightDockTab,
  onError,
}: {
  activeSideTaskId: string | null
  openRightDockTab: (tab: WorkbenchTabDescriptor) => void
  onError: (message: string) => void
}) {
  const [selectedSubagent, setSelectedSubagent] = useState<DesktopSubagentRead | null>(null)
  const [selectedSubagentError, setSelectedSubagentError] = useState<string | null>(null)
  const [subagentAvailability, setSubagentAvailability] = useState<
    'loading' | 'available' | 'unavailable'
  >('loading')

  const selectedSubagentTaskId = activeSideTaskId

  useEffect(() => {
    let disposed = false
    void desktopClient
      .getRuntimeCapabilities()
      .then((capabilities) => {
        if (!disposed) {
          setSubagentAvailability(
            capabilities.includes('subagents.v1') ? 'available' : 'unavailable',
          )
        }
      })
      .catch(() => {
        if (!disposed) setSubagentAvailability('unavailable')
      })
    return () => {
      disposed = true
    }
  }, [])

  const refreshSelectedSubagent = useCallback(async (): Promise<void> => {
    if (
      !selectedSubagentTaskId ||
      subagentAvailability !== 'available' ||
      !desktopClient.readSubagent
    ) {
      setSelectedSubagent(null)
      return
    }
    try {
      const next = await desktopClient.readSubagent(selectedSubagentTaskId)
      setSelectedSubagent(next)
      setSelectedSubagentError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSelectedSubagentError(message)
      throw error
    }
  }, [selectedSubagentTaskId, subagentAvailability])

  useEffect(() => {
    if (!selectedSubagentTaskId || subagentAvailability !== 'available') {
      setSelectedSubagent(null)
      setSelectedSubagentError(
        selectedSubagentTaskId && subagentAvailability === 'unavailable'
          ? '当前 Agent 不支持子智能体工作台。'
          : null,
      )
      return
    }
    let disposed = false
    let timer: number | null = null
    let failureCount = 0
    const poll = async (): Promise<void> => {
      try {
        await refreshSelectedSubagent()
        failureCount = 0
      } catch (error) {
        failureCount += 1
        if (failureCount === 1) {
          onError(error instanceof Error ? error.message : String(error))
        }
      }
      if (disposed) return
      const delay = Math.min(15_000, 1_000 * 2 ** failureCount)
      timer = window.setTimeout(() => void poll(), delay)
    }
    void poll()
    return () => {
      disposed = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [onError, refreshSelectedSubagent, selectedSubagentTaskId, subagentAvailability])

  const handleOpenSubagent = useCallback(
    (taskId: string): void => {
      if (subagentAvailability !== 'available' || !desktopClient.readSubagent) {
        onError('当前桌面桥接不支持读取子智能体')
        return
      }
      void desktopClient
        .readSubagent(taskId)
        .then((read) => {
          openRightDockTab({
            id: `side-task:${taskId}`,
            kind: 'side-task',
            taskId,
            childThreadId: read.task.childThreadId,
          })
        })
        .catch((error) => onError(error instanceof Error ? error.message : String(error)))
    },
    [onError, openRightDockTab, subagentAvailability],
  )

  return {
    selectedSubagentTaskId,
    selectedSubagent,
    selectedSubagentError,
    subagentAvailability,
    refreshSelectedSubagent,
    handleOpenSubagent,
  }
}
