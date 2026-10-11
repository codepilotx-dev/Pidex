/**
 * AgentRuntimeVerifier.test.ts — 打包 Agent 运行时验证门面的失败与安全边界
 */

import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  assertAuthenticodeValid,
  readCliArgument,
  sanitizeVerifierError,
  verifyPackagedAgentRuntime,
} from './AgentRuntimeVerifier.ts'

const fixture = resolve(import.meta.dir, 'fixtures', 'FakePackagedAgent.ts')

// 假 Agent 通过 bun.exe 启动；整套件负载下冷启动可达 15 秒，
// 因此每个用例显式给出 90 秒预算，避免与 bun 默认 5 秒测试超时竞争。
const TEST_TIMEOUT_MS = 90_000

function verify(mode: string, options: Record<string, unknown> = {}) {
  return verifyPackagedAgentRuntime({
    agentPath: process.execPath,
    agentArgs: [fixture, mode],
    readyTimeoutMs: 30_000,
    ...options,
  } as Parameters<typeof verifyPackagedAgentRuntime>[0])
}

describe('packaged agent runtime verifier', () => {
  it(
    'ready 成功后返回安全的运行指标',
    async () => {
      const result = await verify('ready')
      expect(result.schemaVersion).toBe(1)
      expect(result.providerCount).toBeGreaterThan(0)
      expect(result.modelCount).toBeGreaterThan(0)
      expect(result.processTreeCleaned).toBe(true)
      expect(Number.isSafeInteger(result.readyMs)).toBe(true)
      expect(Number.isSafeInteger(result.apiReadyMs)).toBe(true)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'ready 前提前退出时失败',
    async () => {
      await expect(verify('early-exit')).rejects.toThrow('提前退出')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'ready 超时时失败',
    async () => {
      await expect(verify('timeout', { readyTimeoutMs: 40_000 })).rejects.toThrow('秒内未就绪')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'Provider/model 目录无效时失败',
    async () => {
      await expect(verify('bad-catalog')).rejects.toThrow('Provider 目录')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'Authenticode 非 Valid 状态被拒绝',
    async () => {
      // 用确定未签名的非 PE 文件验证拒绝路径，避免依赖本机/CI bun.exe 的签名状态。
      const directory = await mkdtemp(join(tmpdir(), 'pidex-authenticode-'))
      const dummy = join(directory, 'unsigned.txt')
      await writeFile(dummy, 'not a signed pe', 'utf8')
      try {
        await expect(assertAuthenticodeValid([dummy])).rejects.toThrow(
          'Windows Authenticode 验证失败',
        )
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
    TEST_TIMEOUT_MS,
  )

  it('安全错误不泄漏本地绝对路径', () => {
    const sanitized = sanitizeVerifierError('failed at C:\\Users\\secret\\x\\y')
    expect(sanitized).not.toContain('C:\\Users\\secret')
    expect(sanitized).toContain('[LOCAL_PATH]')
  })

  it('CLI 参数同时支持 --name value 与 --name=value 形式', () => {
    const spaced = [
      '--agent',
      'apps/x.exe',
      '--require-authenticode',
      '--authenticode-trust-anchor',
      'ABCD',
    ]
    expect(readCliArgument(spaced, '--agent')).toBe('apps/x.exe')
    expect(readCliArgument(spaced, '--authenticode-trust-anchor')).toBe('ABCD')
    const inline = ['--agent=apps/x.exe', '--authenticode-trust-anchor=ABCD']
    expect(readCliArgument(inline, '--agent')).toBe('apps/x.exe')
    expect(readCliArgument(inline, '--authenticode-trust-anchor')).toBe('ABCD')
    expect(readCliArgument(spaced, '--missing')).toBeUndefined()
    expect(readCliArgument(['--agent'], '--agent')).toBeUndefined()
  })
})
