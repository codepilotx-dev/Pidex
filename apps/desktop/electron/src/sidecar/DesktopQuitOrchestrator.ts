export type DesktopQuitOutcome = 'exited' | 'blocked'

export interface DesktopQuitOrchestratorOptions {
  readonly stopRuntime: () => Promise<void>
  readonly flushState: ReadonlyArray<() => Promise<unknown>>
  readonly exit: () => void
  readonly onBlocked: (error: unknown) => Promise<void> | void
}

/**
 * 桌面退出可容忍窗口状态写入失败，但不能容忍 owned Agent
 * 退出未确认。后者必须保留应用进程，以便用户人工结束后重试。
 */
export async function orchestrateDesktopQuit(
  options: DesktopQuitOrchestratorOptions,
): Promise<DesktopQuitOutcome> {
  const flushPromise = Promise.allSettled(
    options.flushState.map((flush) => Promise.resolve().then(flush)),
  )
  let stopped = false
  let stopError: unknown
  try {
    await options.stopRuntime()
    stopped = true
  } catch (error) {
    stopError = error
  }
  await flushPromise
  if (!stopped) {
    await options.onBlocked(stopError)
    return 'blocked'
  }
  options.exit()
  return 'exited'
}
