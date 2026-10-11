import { useEffect, useRef } from 'react'
import type { DesktopSystemNotificationSettings } from '../../../shared/Types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { TaskNotificationDispatcher } from './TaskNotificationDispatcher.js'
import { AutomationNotificationDispatcher } from './AutomationNotificationDispatcher.js'

export function useSystemNotifications(
  settings: DesktopSystemNotificationSettings | undefined,
): void {
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
}
