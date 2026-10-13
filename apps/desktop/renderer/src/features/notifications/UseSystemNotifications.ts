import { useEffect, useRef, useState } from 'react'
import type { DesktopSystemNotificationSettings } from '../../../shared/Types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { TaskNotificationDispatcher } from './TaskNotificationDispatcher.js'
import { AutomationNotificationDispatcher } from './AutomationNotificationDispatcher.js'
import { sendTaskScheduleNotifications } from './TaskScheduleNotifications.js'
import type { TaskNotificationState } from './TaskScheduleNotifications.js'

export function useSystemNotifications(
  settings: DesktopSystemNotificationSettings | undefined,
): TaskNotificationState {
  const [taskState, setTaskState] = useState<TaskNotificationState>({
    attention: [],
    tasks: [],
    links: [],
  })
  const dispatcherRef = useRef<TaskNotificationDispatcher | null>(null)
  dispatcherRef.current ??= new TaskNotificationDispatcher((request) => {
    const bridge = window.DesktopBridge
    if (typeof bridge?.showDesktopNotification !== 'function') return
    void bridge.showDesktopNotification(request).catch(() => undefined)
  })
  const dispatcher = dispatcherRef.current
  dispatcher.setSettings(settings)

  useEffect(() => {
    let disposed = false
    let sending = false
    let rerun = false
    const send = async () => {
      if (disposed) return
      if (sending) {
        rerun = true
        return
      }
      sending = true
      try {
        const pending = await sendTaskScheduleNotifications(
          desktopClient,
          settings?.questions ? window.DesktopBridge : undefined,
          dispatcher,
        )
        if (!disposed) setTaskState(pending)
      } catch {
        /* Agent 断线后下一次重试。 */
      } finally {
        sending = false
        if (rerun && !disposed) {
          rerun = false
          void send()
        }
      }
    }
    void send()
    const timer = window.setInterval(() => void send(), 30_000)
    const unsubscribe = desktopClient.subscribeAgentEventEnvelopes(
      { liveEventTypes: [] },
      (events) => {
        if (events.some((event) => event.type === 'task-schedule/changed')) void send()
      },
    )
    return () => {
      disposed = true
      window.clearInterval(timer)
      unsubscribe()
    }
  }, [dispatcher, settings?.questions])

  useEffect(() => {
    let disposed = false
    const automationDispatcher = new AutomationNotificationDispatcher(
      desktopClient,
      dispatcher,
      (request) => {
        const bridge = window.DesktopBridge
        if (typeof bridge?.showDesktopNotification !== 'function') return
        void bridge.showDesktopNotification(request).catch(() => undefined)
      },
    )
    void automationDispatcher.initialize().catch(() => undefined)
    const unsubscribeAutomation = desktopClient.subscribeAgentEventEnvelopes(
      { liveEventTypes: [] },
      (events) => automationDispatcher.ingest(events),
    )
    void desktopClient
      .listSessions()
      .then((snapshots) => {
        if (disposed) return
        // 初次 listSessions 只建立基线，并把已有 pending request ID 记为
        // 已观察；不会在启动时补发历史完成、失败或旧审批通知。
        dispatcher.markBaselineReady()
        dispatcher.ingest(snapshots, true)
      })
      .catch(() => {
        dispatcher.markBaselineReady()
      })
    const unsubscribe = desktopClient.onSessionStoreChange((change) => {
      // 基线未就绪前到达的变更按基线吸收。
      dispatcher.ingest(change.sessions, !dispatcher.isBaselineReady())
    })
    return () => {
      disposed = true
      unsubscribeAutomation()
      unsubscribe()
    }
  }, [dispatcher])
  return taskState
}
