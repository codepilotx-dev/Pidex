import { parseThreadDeepLink } from '@pidex/shared/thread-reference'
import type { DesktopLogger } from '../logging/DesktopLogger.js'

export type ThreadDeepLinkPayload = {
  threadId: string
}

export interface ThreadDeepLinkControllerDependencies {
  logger?: DesktopLogger
  getInitialArgv(): readonly string[]
  subscribeRendererReady(listener: () => void): () => void
  isRendererReady(): boolean
  focusMainWindow(): void
  notify(payload: ThreadDeepLinkPayload): void
}

export interface ThreadDeepLinkController {
  consumePendingThreadDeepLink(): ThreadDeepLinkPayload | null
  pushRuntimeActivation(argv: readonly string[]): boolean
  dispose(): void
}

export function createThreadDeepLinkController(
  dependencies: ThreadDeepLinkControllerDependencies,
): ThreadDeepLinkController {
  const { getInitialArgv, subscribeRendererReady, isRendererReady, focusMainWindow, notify } =
    dependencies

  let pendingThreadId: string | null = null
  let disposed = false
  let unsubscribe: (() => void) | undefined

  const coldStartThreadId = findFirstThreadDeepLink(getInitialArgv())
  if (coldStartThreadId !== null) {
    pendingThreadId = coldStartThreadId
  }

  const onRendererReady = (): void => {
    if (disposed) return
    const threadId = pendingThreadId
    if (threadId === null) return
    pendingThreadId = null
    notify({ threadId })
  }

  unsubscribe = subscribeRendererReady(onRendererReady)

  return {
    consumePendingThreadDeepLink: () => {
      if (disposed) return null
      const threadId = pendingThreadId
      if (threadId === null) return null
      pendingThreadId = null
      return { threadId }
    },
    pushRuntimeActivation: (argv) => {
      const threadId = findFirstThreadDeepLink(argv)
      if (threadId === null) return false
      focusMainWindow()
      if (disposed) return true
      if (isRendererReady()) {
        notify({ threadId })
      } else {
        // Renderer 尚未就绪：以最新一次合法显式激活覆盖 pending，
        // 使运行时新目标优先于可能更旧的冷启动目标。
        pendingThreadId = threadId
      }
      return true
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      pendingThreadId = null
      unsubscribe?.()
      unsubscribe = undefined
    },
  }
}

function findFirstThreadDeepLink(argv: readonly string[]): string | null {
  for (const value of argv) {
    if (typeof value !== 'string') continue
    const threadId = parseThreadDeepLink(value)
    if (threadId !== null) return threadId
  }
  return null
}
