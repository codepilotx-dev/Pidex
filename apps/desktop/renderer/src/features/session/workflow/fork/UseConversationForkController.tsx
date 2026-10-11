import React from 'react'

import { GlobalErrorModal } from '../../../../components/GlobalErrorModal.js'
import {
  abandonConversationFork,
  continueConversationForkWithoutSetup,
  resumeConversationFork,
  retryConversationForkSetup,
  runConversationFork,
  type ConversationForkOperation,
  type ConversationForkProgress,
  type ConversationForkResult,
} from './ConversationForkController.js'
import {
  conversationForkClient,
  type ConversationForkDestination,
  type ConversationForkPoint,
} from './ForkClient.js'

const LazyConversationForkDialog = React.lazy(async () => {
  const module = await import('./ConversationForkDialog.js')
  return { default: module.ConversationForkDialog }
})

type ForkMessageRequest = {
  itemId: string
  turnId: string
}

type Input = {
  canUseNewWorktree: boolean
  sourceRunning: boolean
  sourceThreadId: string | null
  onNavigateTarget: (targetThreadId: string) => void
}

type Output = {
  dialog: React.ReactNode
  onForkFromMessage?: (request: ForkMessageRequest) => void
}

export function useConversationForkController({
  canUseNewWorktree,
  sourceRunning,
  sourceThreadId,
  onNavigateTarget,
}: Input): Output {
  const client = React.useMemo(() => conversationForkClient(), [])
  const [supportedSourceThreadId, setSupportedSourceThreadId] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [point, setPoint] = React.useState<ConversationForkPoint | null>(null)
  const [operation, setOperation] = React.useState<ConversationForkOperation | null>(null)
  const [progress, setProgress] = React.useState<ConversationForkProgress | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const openRef = React.useRef(open)
  const sourceThreadIdRef = React.useRef(sourceThreadId)
  const inFlightRef = React.useRef<Promise<void> | null>(null)
  openRef.current = open
  sourceThreadIdRef.current = sourceThreadId
  const forkSupported = sourceThreadId !== null && supportedSourceThreadId === sourceThreadId

  React.useEffect(() => {
    let cancelled = false
    setSupportedSourceThreadId(null)
    if (!sourceThreadId)
      return () => {
        cancelled = true
      }
    void client.supportsThreadFork().then((supported) => {
      if (!cancelled && supported) setSupportedSourceThreadId(sourceThreadId)
    })
    return () => {
      cancelled = true
    }
  }, [client, sourceThreadId])

  React.useEffect(() => {
    sourceThreadIdRef.current = sourceThreadId
    openRef.current = false
    inFlightRef.current = null
    setOpen(false)
    setBusy(false)
    setPoint(null)
    setOperation(null)
    setProgress(null)
    return () => {
      sourceThreadIdRef.current = null
      openRef.current = false
      inFlightRef.current = null
    }
  }, [sourceThreadId])

  const observeProgress = React.useCallback((next: ConversationForkProgress) => {
    setOperation(next.operation)
    setProgress(next)
  }, [])

  const observeProgressFor = React.useCallback(
    (expectedSourceThreadId: string) =>
      (next: ConversationForkProgress): void => {
        if (sourceThreadIdRef.current !== expectedSourceThreadId) return
        observeProgress(next)
      },
    [observeProgress],
  )

  const finish = React.useCallback(
    (result: ConversationForkResult, expectedSourceThreadId: string): void => {
      if (sourceThreadIdRef.current !== expectedSourceThreadId) return
      setBusy(false)
      setOperation(result.operation)
      if (result.kind === 'completed' && result.operation.targetThreadId) {
        if (openRef.current) {
          openRef.current = false
          setOpen(false)
          onNavigateTarget(result.operation.targetThreadId)
        } else {
          setNotice('新聊天已创建，可从侧边栏打开。')
        }
        return
      }
      if (result.kind === 'abandoned') {
        openRef.current = false
        setOpen(false)
        setNotice('已放弃创建新聊天。')
        return
      }
      if (result.kind === 'failed' && !openRef.current) {
        reportError(result.operation.errorCode ?? '无法创建新聊天。')
      }
    },
    [onNavigateTarget],
  )

  const run = React.useCallback(
    (task: () => Promise<ConversationForkResult>, expectedSourceThreadId: string) => {
      setBusy(true)
      const promise = task()
        .then((result) => finish(result, expectedSourceThreadId))
        .catch((cause) => {
          if (sourceThreadIdRef.current !== expectedSourceThreadId) return
          setBusy(false)
          reportError(message(cause))
        })
        .finally(() => {
          if (inFlightRef.current === promise) inFlightRef.current = null
        })
      inFlightRef.current = promise
    },
    [finish],
  )

  const onForkFromMessage = React.useCallback(
    (request: ForkMessageRequest): void => {
      if (!forkSupported || !sourceThreadId) return
      if (inFlightRef.current) {
        if (point?.sourceItemId === request.itemId && point.lastTurnId === request.turnId) {
          openRef.current = true
          setOpen(true)
        } else {
          setNotice('另一条消息的分叉仍在进行，请等待完成后再试。')
        }
        return
      }
      const nextPoint = {
        sourceThreadId,
        lastTurnId: request.turnId,
        sourceItemId: request.itemId,
      }
      setPoint(nextPoint)
      setOperation(null)
      setProgress(null)
      openRef.current = true
      setOpen(true)
      setBusy(true)
      const promise = resumeConversationFork(client, nextPoint, observeProgressFor(sourceThreadId))
        .then((result) => {
          if (sourceThreadIdRef.current !== sourceThreadId) return
          setBusy(false)
          if (result) finish(result, sourceThreadId)
        })
        .catch((cause) => {
          if (sourceThreadIdRef.current !== sourceThreadId) return
          setBusy(false)
          reportError(message(cause))
        })
        .finally(() => {
          if (inFlightRef.current === promise) inFlightRef.current = null
        })
      inFlightRef.current = promise
    },
    [client, finish, forkSupported, observeProgressFor, point, sourceThreadId],
  )

  const selectDestination = React.useCallback(
    (destination: ConversationForkDestination) => {
      if (!point || inFlightRef.current) return
      run(
        () =>
          runConversationFork({
            client,
            point,
            destination,
            onProgress: observeProgressFor(point.sourceThreadId),
          }),
        point.sourceThreadId,
      )
    },
    [client, observeProgressFor, point, run],
  )

  const retrySetup = React.useCallback(() => {
    if (!operation || inFlightRef.current) return
    run(
      () =>
        retryConversationForkSetup(client, operation, observeProgressFor(operation.sourceThreadId)),
      operation.sourceThreadId,
    )
  }, [client, observeProgressFor, operation, run])

  const continueWithoutSetup = React.useCallback(() => {
    if (!operation || inFlightRef.current) return
    run(
      () =>
        continueConversationForkWithoutSetup(
          client,
          operation,
          observeProgressFor(operation.sourceThreadId),
        ),
      operation.sourceThreadId,
    )
  }, [client, observeProgressFor, operation, run])

  const abandon = React.useCallback(() => {
    if (!operation || inFlightRef.current) return
    run(
      () =>
        abandonConversationFork(client, operation, observeProgressFor(operation.sourceThreadId)),
      operation.sourceThreadId,
    )
  }, [client, observeProgressFor, operation, run])

  const handleOpenChange = React.useCallback((nextOpen: boolean): void => {
    openRef.current = nextOpen
    setOpen(nextOpen)
  }, [])

  return {
    onForkFromMessage: forkSupported ? onForkFromMessage : undefined,
    dialog: forkSupported ? (
      <>
        <React.Suspense fallback={null}>
          <LazyConversationForkDialog
            busy={busy}
            canUseNewWorktree={canUseNewWorktree}
            open={open}
            operation={operation}
            progress={progress}
            sourceRunning={sourceRunning}
            onAbandon={abandon}
            onContinueWithoutSetup={continueWithoutSetup}
            onOpenChange={handleOpenChange}
            onRetrySetup={retrySetup}
            onSelectDestination={selectDestination}
          />
        </React.Suspense>
        <GlobalErrorModal message={notice} tone="status" onDismiss={() => setNotice(null)} />
      </>
    ) : null,
  }
}

function reportError(error: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('desktop:error', { detail: error }))
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : '无法创建新聊天。'
}
