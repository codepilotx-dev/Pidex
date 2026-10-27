import { useMemo } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import type {
  DesktopTerminalEvent,
  DesktopTerminalSnapshot,
} from '@pidex/shared/desktop-terminal-ipc'
import React, { use, useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button.js'
import { getEffectiveReducedMotion } from '../../hooks/UsePrefersReducedMotion.js'
import { loadDesktopTerminalClient } from '../../services/desktop-client/index.js'
import { getResizeActivityCoordinator } from '../layout/shell/ResizeActivityCoordinator.js'
import { useDesktopSettingsField } from '../settings/UseDesktopSettings.js'
import {
  consumeTerminalEvent,
  consumeTerminalSnapshot,
  createTerminalOutputState,
  type TerminalOutputState,
  type TerminalOutputUpdate,
} from './TerminalOutputState.js'
import '../../styles/lazy/terminal.css'
import { OPEN_TERMINAL_EVENT, type OpenTerminalEventDetail } from './OpenTerminalEvent.js'
import { readTerminalFont, readTerminalTheme } from './TerminalTheme.js'
import { errorMessageOf as errorMessage } from '@pidex/shared/errors'

export type TerminalPanelProps = {
  threadId: string
  terminalId?: string
  cwd?: string | null
  onDisplayPathChange?: (displayPath: string | null) => void
}

let terminalClientResource: Promise<Awaited<ReturnType<typeof loadDesktopTerminalClient>>> | null =
  null

/** ack 合并阈值：xterm 已解析这么多字符就立即上报一次 credit。 */
const ACK_CHARACTERS_THRESHOLD = 32 * 1024
const ACK_INTERVAL_MS = 50
/** 拖拽期间把中间尺寸发给 ConPTY 的最小间隔；结束时强制补一次最终尺寸。 */
const RESIZE_STREAM_THROTTLE_MS = 150

function loadTerminalClientResource(): Promise<
  Awaited<ReturnType<typeof loadDesktopTerminalClient>>
> {
  terminalClientResource ??= loadDesktopTerminalClient().catch((error) => {
    terminalClientResource = null
    throw error
  })
  return terminalClientResource
}

export function TerminalPanel({
  threadId,
  terminalId,
  cwd,
  onDisplayPathChange,
}: TerminalPanelProps): React.ReactNode {
  const terminalClient = use(loadTerminalClientResource())
  const subscribedTerminalProfileId = useDesktopSettingsField(
    (state) => state.draft.values.terminalProfileId,
  )
  const { draft } = useMemo(
    () => ({ draft: { values: { terminalProfileId: subscribedTerminalProfileId } } }),
    [subscribedTerminalProfileId],
  )
  const profileId = draft.values.terminalProfileId
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const outputStateRef = useRef<TerminalOutputState>(createTerminalOutputState())
  const snapshotRef = useRef<DesktopTerminalSnapshot | null>(null)
  const displayPathCallbackRef = useRef(onDisplayPathChange)
  displayPathCallbackRef.current = onDisplayPathChange
  const replayPendingRef = useRef(false)
  const [status, setStatus] = useState<TerminalOutputState['state']>('starting')
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restartVersion, setRestartVersion] = useState(0)
  /**
   * 已提交给 xterm 但尚未确认解析完成的字符数，以及对应的最大连续序号。
   * 达到阈值或超时后合并成一次 ack 上报，驱动主进程的 credit 窗口。
   */
  const ackRef = useRef({
    pending: 0,
    sequence: -1,
    timer: null as ReturnType<typeof setTimeout> | null,
  })

  const flushAck = useCallback((): void => {
    const state = outputStateRef.current
    const ack = ackRef.current
    if (ack.timer !== null) {
      clearTimeout(ack.timer)
      ack.timer = null
    }
    if (ack.pending === 0 || ack.sequence < 0) return
    if (!state.terminalId || !state.instanceId) return
    terminalClient.ackTerminalOutput?.({
      terminalId: state.terminalId,
      instanceId: state.instanceId,
      sequence: ack.sequence,
      characters: ack.pending,
    })
    ack.pending = 0
  }, [terminalClient])

  const scheduleAck = useCallback((): void => {
    const ack = ackRef.current
    if (ack.timer !== null) return
    ack.timer = setTimeout(() => {
      ack.timer = null
      flushAck()
    }, ACK_INTERVAL_MS)
  }, [flushAck])

  const applyUpdate = useCallback(
    (update: TerminalOutputUpdate): void => {
      outputStateRef.current = update.state
      setStatus(update.state.state)
      setExitCode(update.state.exitCode)
      setTruncated(update.state.truncated)
      const terminal = terminalRef.current
      if (!terminal) return
      if (update.reset) terminal.reset()
      for (const chunk of update.chunks) {
        terminal.write(chunk.data, () => {
          const ack = ackRef.current
          ack.pending += chunk.data.length
          ack.sequence = Math.max(ack.sequence, chunk.sequence)
          scheduleAck()
          if (ack.pending >= ACK_CHARACTERS_THRESHOLD) flushAck()
        })
      }
    },
    [flushAck, scheduleAck],
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const initialFont = readTerminalFont(document.documentElement)
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: !getEffectiveReducedMotion(),
      fontFamily: initialFont.fontFamily,
      fontSize: initialFont.fontSize,
      lineHeight: initialFont.lineHeight,
      scrollback: 5_000,
      theme: readTerminalTheme(document.documentElement),
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    let disposed = false
    displayPathCallbackRef.current?.(null)
    let snapshotReady = false
    let snapshotGeneration = 0
    const queuedEvents: DesktopTerminalEvent[] = []

    const adoptSnapshot = (snapshot: DesktopTerminalSnapshot): void => {
      snapshotGeneration += 1
      snapshotRef.current = snapshot
      displayPathCallbackRef.current?.(snapshotDisplayPath(snapshot))
      applyUpdate(consumeTerminalSnapshot(createTerminalOutputState(), snapshot))
      snapshotReady = true
      for (const event of queuedEvents.splice(0)) consumeEvent(event)
      setError(null)
    }

    const replay = async (): Promise<void> => {
      const current = outputStateRef.current
      if (replayPendingRef.current || !current.terminalId || !current.instanceId) return
      replayPendingRef.current = true
      try {
        const snapshot = await terminalClient.attachTerminal({
          terminalId: current.terminalId,
          instanceId: current.instanceId,
          afterSequence: current.nextSequence - 1,
        })
        if (disposed) return
        snapshotRef.current = snapshot
        displayPathCallbackRef.current?.(snapshotDisplayPath(snapshot))
        const update = consumeTerminalSnapshot(outputStateRef.current, snapshot)
        applyUpdate(update)
        if (update.replayRequired) setError('终端输出存在缺口，请重新打开终端。')
      } catch (reason) {
        if (!disposed) setError(errorMessage(reason))
      } finally {
        replayPendingRef.current = false
      }
    }

    const consumeEvent = (event: DesktopTerminalEvent): void => {
      const update = consumeTerminalEvent(outputStateRef.current, event)
      applyUpdate(update)
      if (update.replayRequired) void replay()
    }

    const onOpenTerminal = (event: Event): void => {
      const detail = (event as CustomEvent<OpenTerminalEventDetail>).detail
      if (detail?.threadId !== threadId || !detail.snapshot) return
      if (terminalId && detail.snapshot.terminalId !== terminalId) return
      adoptSnapshot(detail.snapshot)
    }
    window.addEventListener(OPEN_TERMINAL_EVENT, onOpenTerminal)

    const unsubscribe = terminalClient.onTerminalEvent((event) => {
      const eventTerminalId = event.type === 'output' ? event.chunk.terminalId : event.terminalId
      if (snapshotRef.current) {
        if (eventTerminalId !== snapshotRef.current.terminalId) return
        consumeEvent(event)
        return
      }
      if (terminalId && eventTerminalId !== terminalId) return
      queuedEvents.push(event)
    })

    const inputDisposable = terminal.onData((data) => {
      const snapshot = snapshotRef.current
      if (!snapshot || outputStateRef.current.state !== 'running') return
      terminalClient.writeTerminal({
        terminalId: snapshot.terminalId,
        instanceId: snapshot.instanceId,
        data,
      })
    })

    let resizeFrame: number | null = null
    let lastSentSize = { cols: 0, rows: 0 }
    let lastResizeSentAt = 0
    const resizeActivity = getResizeActivityCoordinator()
    const fitAndResize = (options: { force?: boolean } = {}): void => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null
        if (disposed || host.clientWidth <= 0 || host.clientHeight <= 0) return
        fitAddon.fit()
        const cols = terminal.cols
        const rows = terminal.rows
        if (cols === lastSentSize.cols && rows === lastSentSize.rows) return
        // 拖拽期间节流：让 ConPTY 为每个中间尺寸重排代价很高，且会与输出互相
        // 争抢；缩放结束后由下面的订阅强制补一次最终尺寸。
        const now = Date.now()
        if (
          !options.force &&
          resizeActivity.isResizing() &&
          now - lastResizeSentAt < RESIZE_STREAM_THROTTLE_MS
        ) {
          return
        }
        const snapshot = snapshotRef.current
        if (!snapshot || outputStateRef.current.state !== 'running') return
        // 只有真正发出后才记录，否则被节流跳过的最终尺寸不会再补发。
        lastResizeSentAt = now
        lastSentSize = { cols, rows }
        terminalClient.resizeTerminal({
          terminalId: snapshot.terminalId,
          instanceId: snapshot.instanceId,
          cols,
          rows,
        })
      })
    }
    const resizeObserver = new ResizeObserver(() => fitAndResize())
    resizeObserver.observe(host)

    const unsubscribeResizeActivity = resizeActivity.subscribe(() => {
      if (resizeActivity.isResizing()) return
      // 缩放结束：只执行一次 fit 与一次最终 resize，不做逐帧重排。
      fitAndResize({ force: true })
    })

    const themeObserver = new MutationObserver(() => {
      const font = readTerminalFont(document.documentElement)
      terminal.options.theme = readTerminalTheme(document.documentElement)
      terminal.options.fontFamily = font.fontFamily
      terminal.options.fontSize = font.fontSize
      terminal.options.lineHeight = font.lineHeight
      fitAndResize({ force: true })
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    })

    const initialize = async (): Promise<void> => {
      const initializeGeneration = snapshotGeneration
      try {
        fitAddon.fit()
        const snapshot = await terminalClient.ensureTerminal({
          threadId,
          terminalId,
          cwd: cwd ?? undefined,
          profileId,
          cols: Math.max(2, terminal.cols),
          rows: Math.max(1, terminal.rows),
        })
        if (disposed || initializeGeneration !== snapshotGeneration) return
        snapshotRef.current = snapshot
        displayPathCallbackRef.current?.(snapshotDisplayPath(snapshot))
        const update = consumeTerminalSnapshot(createTerminalOutputState(), snapshot)
        applyUpdate(update)
        snapshotReady = true
        for (const event of queuedEvents.splice(0)) consumeEvent(event)
        fitAndResize()
        terminal.focus()
      } catch (reason) {
        snapshotReady = true
        if (!disposed) {
          setStatus('failed')
          setError(errorMessage(reason))
        }
      }
    }
    void initialize()

    return () => {
      disposed = true
      window.removeEventListener(OPEN_TERMINAL_EVENT, onOpenTerminal)
      unsubscribe()
      inputDisposable.dispose()
      resizeObserver.disconnect()
      unsubscribeResizeActivity()
      themeObserver.disconnect()
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
      // 卸载前把已消费的进度上报一次，避免主进程一直停在暂停窗口上；
      // 之后由主进程的消费者静默看门狗兜底。
      flushAck()
      if (ackRef.current.timer !== null) {
        clearTimeout(ackRef.current.timer)
        ackRef.current.timer = null
      }
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      snapshotRef.current = null
      outputStateRef.current = createTerminalOutputState()
      displayPathCallbackRef.current?.(null)
    }
  }, [applyUpdate, cwd, flushAck, profileId, restartVersion, terminalId, threadId])

  const handleRestart = useCallback(async (): Promise<void> => {
    const snapshot = snapshotRef.current
    setError(null)
    try {
      if (snapshot) {
        await terminalClient.closeTerminal({
          terminalId: snapshot.terminalId,
          instanceId: snapshot.instanceId,
          reason: 'user-close',
        })
      }
      setRestartVersion((version) => version + 1)
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }, [])

  return (
    <section
      className="integrated-terminal tw:flex tw:h-full tw:w-full tw:min-h-0 tw:min-w-0 tw:flex-auto tw:flex-col"
      data-terminal-keyboard-capture
      data-thread-id={threadId}
      data-terminal-id={terminalId}
    >
      {truncated ? (
        <div
          className="integrated-terminal__notice tw:flex tw:min-h-7 tw:items-center tw:gap-1 tw:border-b tw:border-app-border tw:bg-app-panel tw:px-2 tw:py-1 tw:type-caption tw:text-app-text-meta"
          role="status"
        >
          输出已截断，更早内容不可用。
        </div>
      ) : null}
      {status === 'exited' || status === 'failed' ? (
        <div
          className="integrated-terminal__lifecycle tw:flex tw:min-h-10 tw:items-center tw:justify-between tw:gap-2 tw:border-b tw:border-app-border tw:bg-app-panel tw:px-2 tw:py-1 tw:type-caption tw:text-app-danger tw:shadow-none"
          role="status"
        >
          <span>{error || terminalStatusLabel(status, exitCode)}</span>
          <Button color="secondary" type="button" onClick={() => void handleRestart()}>
            重新启动
          </Button>
        </div>
      ) : null}
      <div
        ref={hostRef}
        className="integrated-terminal__viewport tw:min-h-0 tw:min-w-0 tw:flex-1 tw:p-2"
      />
    </section>
  )
}

function terminalStatusLabel(
  status: TerminalOutputState['state'],
  exitCode: number | null,
): string {
  if (status === 'failed') return '启动失败'
  return exitCode === null ? '已退出' : `已退出（代码 ${exitCode}）`
}

function snapshotDisplayPath(snapshot: DesktopTerminalSnapshot): string | null {
  if (!('displayPath' in snapshot) || typeof snapshot.displayPath !== 'string') return null
  return snapshot.displayPath
}
