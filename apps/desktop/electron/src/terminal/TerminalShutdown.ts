import type { TerminalManager } from './TerminalManager.js'

export interface TerminalShutdownOptions {
  manager: Pick<TerminalManager, 'stopAll'> | undefined
  stopSupervisor: () => Promise<void>
  timeoutMs?: number
}

const DEFAULT_TERMINAL_SHUTDOWN_TIMEOUT_MS = 5_000

export async function stopTerminalsBeforeSupervisor(
  options: TerminalShutdownOptions,
): Promise<void> {
  const stopTerminals = options.manager?.stopAll('app-quit') ?? Promise.resolve()
  await settleBounded(stopTerminals, options.timeoutMs ?? DEFAULT_TERMINAL_SHUTDOWN_TIMEOUT_MS)
  await options.stopSupervisor()
}

async function settleBounded(promise: Promise<unknown>, milliseconds: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      promise.catch(() => undefined),
      new Promise<void>((resolveDelay) => {
        timer = setTimeout(resolveDelay, milliseconds)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
