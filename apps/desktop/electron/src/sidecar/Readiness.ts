import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash, timingSafeEqual } from 'node:crypto'
import type { DesktopLogger } from '../logging/DesktopLogger.js'

const READY_TIMEOUT_MS = 60_000
const HEALTH_TIMEOUT_MS = 20_000

export interface ReadyMessage {
  readonly type: 'ready'
  readonly port: number
  readonly host?: string
  readonly instanceToken?: string
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export function waitForReadyMessage(
  child: ChildProcessWithoutNullStreams,
  logger: DesktopLogger,
  expectedInstanceToken?: string,
): Promise<ReadyMessage> {
  return new Promise((resolveReady, rejectReady) => {
    let buffer = ''
    let ready = false
    const timer = setTimeout(
      () => finishBeforeReady(new Error('等待 Agent ready 消息超时')),
      READY_TIMEOUT_MS,
    )

    const finishBeforeReady = (result: Error): void => {
      clearTimeout(timer)
      child.stdout.removeListener('data', onData)
      child.removeListener('error', onError)
      child.removeListener('exit', onEarlyExit)
      rejectReady(result)
    }
    const finishReady = (result: ReadyMessage): void => {
      clearTimeout(timer)
      ready = true
      child.removeListener('error', onError)
      child.removeListener('exit', onEarlyExit)
      resolveReady(result)
    }
    const onError = (error: Error): void => finishBeforeReady(error)
    const onEarlyExit = (code: number | null, signal: NodeJS.Signals | null): void =>
      finishBeforeReady(
        new Error(`Agent 在 ready 前退出（code=${String(code)}, signal=${String(signal)}）`),
      )
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8')
      for (;;) {
        const newline = buffer.indexOf('\n')
        if (newline < 0) return
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        try {
          const parsed = JSON.parse(line) as Partial<ReadyMessage>
          if (parsed.type === 'ready' && Number.isInteger(parsed.port) && Number(parsed.port) > 0) {
            if (
              expectedInstanceToken &&
              !matchesExpectedInstanceToken(parsed.instanceToken, expectedInstanceToken)
            ) {
              finishBeforeReady(new Error('Agent ready 实例标识不匹配'))
              return
            }
            if (!ready) {
              finishReady({
                type: 'ready',
                port: Number(parsed.port),
                host: parsed.host,
                instanceToken: parsed.instanceToken,
              })
            }
            return
          }
          logger.forwardConsoleLine(redactSidecarInstanceToken(line, expectedInstanceToken))
        } catch {
          logger.forwardConsoleLine(redactSidecarInstanceToken(line, expectedInstanceToken))
        }
      }
    }

    child.stdout.on('data', onData)
    child.once('error', onError)
    child.once('exit', onEarlyExit)
  })
}

export async function waitForReady(
  origin: string,
  token: string,
  logger: DesktopLogger,
  attempt: number,
  expectedInstanceToken?: string,
): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  let lastError: unknown
  let probeCount = 0
  while (Date.now() < deadline) {
    probeCount += 1
    try {
      await probeReady(origin, fetch, token, 1_500, expectedInstanceToken)
      logger.info('sidecar.ready-probe-ok', { origin, attempt })
      return
    } catch (error) {
      lastError = error
      if (probeCount === 1 || probeCount % 10 === 0) {
        logger.warn('sidecar.ready-probe-error', {
          origin,
          attempt,
          probeCount,
          message: formatError(error),
        })
      }
    }
    await sleep(200)
  }
  throw new Error(`Agent 就绪检查超时：${formatError(lastError)}`)
}

export async function probeReady(
  origin: string,
  fetcher: FetchLike,
  token: string | undefined,
  timeoutMs: number,
  expectedInstanceToken?: string,
): Promise<void> {
  const response = await fetcher(`${origin}/api/ready`, {
    method: 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = (await response.json()) as {
    ok?: boolean
    instanceToken?: string
  }
  if (body.ok !== true) throw new Error('Agent ready 返回无效')
  if (
    expectedInstanceToken &&
    !matchesExpectedInstanceToken(body.instanceToken, expectedInstanceToken)
  ) {
    throw new Error('Agent ready 实例标识不匹配')
  }
}

/**
 * 对 sidecar 内部实例标识做常量时间比较。先哈希可以避免字符串长度差异
 * 让 timingSafeEqual 提前返回；实例标识本身不得进入日志或错误消息。
 */
export function matchesExpectedInstanceToken(
  actual: string | undefined,
  expected: string,
): boolean {
  const actualDigest = createHash('sha256')
    .update(actual ?? '', 'utf8')
    .digest()
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest()
  return (
    timingSafeEqual(actualDigest, expectedDigest) && typeof actual === 'string' && actual.length > 0
  )
}

function redactSidecarInstanceToken(
  line: string,
  expectedInstanceToken: string | undefined,
): string {
  const withoutExpected = expectedInstanceToken
    ? line.split(expectedInstanceToken).join('[REDACTED]')
    : line
  return withoutExpected
    .replace(/(\"instanceToken\"\s*:\s*\")[^\"]*(\")/gi, '$1[REDACTED]$2')
    .replace(
      /\bPIDEX_SIDECAR_INSTANCE_TOKEN=([^\s,;]+)/gi,
      'PIDEX_SIDECAR_INSTANCE_TOKEN=[REDACTED]',
    )
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '未知错误')
}
