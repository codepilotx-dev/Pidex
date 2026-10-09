import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { DesktopLogger } from '../src/logging/DesktopLogger'
import {
  matchesExpectedInstanceToken,
  probeReady,
  waitForReadyMessage,
} from '../src/sidecar/Readiness'

describe('Sidecar readiness 实例校验', () => {
  test('ready stdout 必须回显预期实例标识', async () => {
    const child = fakeChild()
    const result = waitForReadyMessage(child, logger, 'expected-token')
    child.stdout.write(
      `${JSON.stringify({
        type: 'ready',
        host: '127.0.0.1',
        port: 4312,
        instanceToken: 'expected-token',
      })}\n`,
    )

    await expect(result).resolves.toMatchObject({
      type: 'ready',
      port: 4312,
      instanceToken: 'expected-token',
    })
  })

  test('ready stdout 标识不匹配时拒绝且错误不包含标识', async () => {
    const child = fakeChild()
    const result = waitForReadyMessage(child, logger, 'expected-secret')
    child.stdout.write(
      `${JSON.stringify({
        type: 'ready',
        port: 4312,
        instanceToken: 'other-secret',
      })}\n`,
    )

    await expect(result).rejects.toThrow('实例标识不匹配')
    await result.catch((error) => {
      expect(String(error)).not.toContain('expected-secret')
      expect(String(error)).not.toContain('other-secret')
    })
  })

  test('非 ready stdout 即使包含实例标识也只转发脱敏文本', async () => {
    const child = fakeChild()
    const forwarded: string[] = []
    const capturingLogger: DesktopLogger = {
      ...logger,
      forwardConsoleLine: (line) => {
        forwarded.push(line)
      },
    }
    const result = waitForReadyMessage(child, capturingLogger, 'expected-secret')
    child.stdout.write('diagnostic PIDEX_SIDECAR_INSTANCE_TOKEN=expected-secret\n')
    child.stdout.write(
      `${JSON.stringify({
        type: 'ready',
        port: 4312,
        instanceToken: 'expected-secret',
      })}\n`,
    )

    await result
    expect(forwarded).toHaveLength(1)
    expect(forwarded[0]).not.toContain('expected-secret')
    expect(forwarded[0]).toContain('[REDACTED]')
  })

  test('/api/ready 仅在 owned sidecar 场景校验实例标识', async () => {
    const matching = async () =>
      new Response(
        JSON.stringify({
          ok: true,
          instanceToken: 'expected-token',
        }),
      )
    await expect(
      probeReady('http://127.0.0.1:4312', matching, 'auth', 100, 'expected-token'),
    ).resolves.toBeUndefined()

    const standalone = async () => new Response(JSON.stringify({ ok: true }))
    await expect(
      probeReady('http://127.0.0.1:4312', standalone, 'auth', 100),
    ).resolves.toBeUndefined()
    await expect(
      probeReady('http://127.0.0.1:4312', standalone, 'auth', 100, 'expected-token'),
    ).rejects.toThrow('实例标识不匹配')
  })

  test('常量时间比较同时拒绝缺失值和不同值', () => {
    expect(matchesExpectedInstanceToken('same', 'same')).toBe(true)
    expect(matchesExpectedInstanceToken('different', 'same')).toBe(false)
    expect(matchesExpectedInstanceToken(undefined, 'same')).toBe(false)
  })
})

function fakeChild(): ChildProcessWithoutNullStreams {
  const emitter = new EventEmitter() as EventEmitter & Record<string, unknown>
  emitter.stdin = new PassThrough()
  emitter.stdout = new PassThrough()
  emitter.stderr = new PassThrough()
  emitter.exitCode = null
  emitter.signalCode = null
  return emitter as unknown as ChildProcessWithoutNullStreams
}

const logger: DesktopLogger = {
  directory: '',
  consoleEnabled: false,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  forwardConsoleLine: () => undefined,
}
