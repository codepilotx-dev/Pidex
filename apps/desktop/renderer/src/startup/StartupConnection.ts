import type {
  DesktopStartupIpcBridge,
  DesktopStartupSnapshot,
} from '@pidex/shared/desktop-startup-ipc'

/** 先订阅再取快照；revision 防止晚到的快照覆盖新事件。 */
export function subscribeStartupConnection(
  bridge: Pick<DesktopStartupIpcBridge, 'getStartupSnapshot' | 'onStartupChanged'>,
  listener: (snapshot: DesktopStartupSnapshot) => void,
  onError: () => void,
): () => void {
  let latest: DesktopStartupSnapshot | undefined
  let disposed = false
  const accept = (snapshot: DesktopStartupSnapshot) => {
    if (
      disposed ||
      (latest && (snapshot.generation < latest.generation || snapshot.revision <= latest.revision))
    )
      return
    latest = snapshot
    listener(snapshot)
  }
  const unsubscribe = bridge.onStartupChanged(accept)
  void bridge.getStartupSnapshot().then(accept, () => {
    if (!disposed) onError()
  })
  return () => {
    disposed = true
    unsubscribe()
  }
}
