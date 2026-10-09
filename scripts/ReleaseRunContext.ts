/**
 * ReleaseRunContext.ts — 每个 self-hosted 发布 job 的唯一运行上下文。
 *
 * 在 RUNNER_TEMP 直接子目录创建本轮独立的 temp/appdata/localappdata/
 * user-data/data/logs/artifacts，写入不含 secret 的 ownership marker；
 * 清理时重新校验 repository、run ID、attempt、UUID 和 resolved path。
 * 不接受任意外部删除路径，不使用 --force worktree removal。
 *
 * CLI（在 GitHub Actions job 中使用）：
 *   bun scripts/ReleaseRunContext.ts create
 *   bun scripts/ReleaseRunContext.ts dispose
 */

import { existsSync } from 'node:fs'
import { appendFileSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, normalize, resolve } from 'node:path'

export const RELEASE_RUN_CONTEXT_SCHEMA_VERSION = 1 as const
export const RELEASE_RUN_REPOSITORY = 'codepilotx-dev/Pidex' as const
export const RELEASE_RUN_PREFIX = 'pidex-release' as const

const RETRYABLE_REMOVE_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY'])

export interface ReleaseRunContextV1 {
  schemaVersion: typeof RELEASE_RUN_CONTEXT_SCHEMA_VERSION
  repository: typeof RELEASE_RUN_REPOSITORY
  runId: string
  runAttempt: string
  root: string
  temp: string
  appData: string
  localAppData: string
  userData: string
  data: string
  logs: string
  artifacts: string
}

interface OwnershipMarker {
  schemaVersion: typeof RELEASE_RUN_CONTEXT_SCHEMA_VERSION
  repository: string
  runId: string
  runAttempt: string
  uuid: string
  createdAt: string
}

export interface ReleaseRunContextOptions {
  runId?: string
  runAttempt?: string
  runnerTemp?: string
  repository?: string
  now?: Date
}

export interface DisposeReleaseRunContextOptions {
  runId?: string
  runAttempt?: string
  runnerTemp?: string
  repository?: string
  /** 清理重试预算，默认 100 次 × 50ms。 */
  removeAttempts?: number
  removeDelayMs?: number
}

function environmentValue(name: string, provided?: string): string {
  const value = provided ?? process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(`无法确定发布机 ${name}`)
  }
  return value
}

function parseRunNumber(value: string, name: string): string {
  if (!/^\d+$/.test(value)) {
    throw new Error(`发布机 ${name} 无效：${value}`)
  }
  return value
}

async function normalizeRunnerTemp(runnerTemp: string): Promise<string> {
  const resolved = resolve(runnerTemp)
  let stats
  try {
    stats = await stat(resolved)
  } catch {
    throw new Error('RUNNER_TEMP 目录不存在')
  }
  if (!stats.isDirectory()) {
    throw new Error('RUNNER_TEMP 不是目录')
  }
  return normalize(resolved)
}

function isDirectChildOf(path: string, parent: string): boolean {
  const normalizedParent = normalize(parent)
  const expected = join(normalizedParent, basename(normalize(path)))
  const compare = (value: string) => (process.platform === 'win32' ? value.toLowerCase() : value)
  return compare(normalize(path)) === compare(expected)
}

function assertRepository(repository: string): void {
  if (repository !== RELEASE_RUN_REPOSITORY) {
    throw new Error('release run context 只允许 codepilotx-dev/Pidex')
  }
}

function markerPath(root: string): string {
  return join(root, '.pidex-release-ownership.json')
}

export function releaseRunRootName(runId: string, runAttempt: string, uuid: string): string {
  return `${RELEASE_RUN_PREFIX}-${runId}-${runAttempt}-${uuid}`
}

export async function createReleaseRunContext(
  options: ReleaseRunContextOptions = {},
): Promise<ReleaseRunContextV1> {
  const runId = parseRunNumber(environmentValue('GITHUB_RUN_ID', options.runId), 'GITHUB_RUN_ID')
  const runAttempt = parseRunNumber(
    environmentValue('GITHUB_RUN_ATTEMPT', options.runAttempt),
    'GITHUB_RUN_ATTEMPT',
  )
  const runnerTemp = await normalizeRunnerTemp(environmentValue('RUNNER_TEMP', options.runnerTemp))
  const repository = options.repository ?? RELEASE_RUN_REPOSITORY
  assertRepository(repository)

  const uuid = crypto.randomUUID()
  const root = join(runnerTemp, releaseRunRootName(runId, runAttempt, uuid))
  if (!isDirectChildOf(root, runnerTemp)) {
    throw new Error('拒绝在 RUNNER_TEMP 直接子目录之外创建 release run context')
  }
  if (existsSync(root)) {
    throw new Error('release run context 路径已存在，拒绝复用')
  }
  const context: ReleaseRunContextV1 = {
    schemaVersion: RELEASE_RUN_CONTEXT_SCHEMA_VERSION,
    repository,
    runId,
    runAttempt,
    root,
    temp: join(root, 'temp'),
    appData: join(root, 'appdata'),
    localAppData: join(root, 'localappdata'),
    userData: join(root, 'user-data'),
    data: join(root, 'data'),
    logs: join(root, 'logs'),
    artifacts: join(root, 'artifacts'),
  }
  const directories = [
    context.temp,
    context.appData,
    context.localAppData,
    context.userData,
    context.data,
    context.logs,
    context.artifacts,
  ]
  await Promise.all(directories.map((directory) => mkdir(directory, { recursive: true })))
  const marker: OwnershipMarker = {
    schemaVersion: RELEASE_RUN_CONTEXT_SCHEMA_VERSION,
    repository,
    runId,
    runAttempt,
    uuid,
    createdAt: (options.now ?? new Date()).toISOString(),
  }
  await writeFile(markerPath(root), `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
  return context
}

async function readOwnershipMarker(root: string): Promise<OwnershipMarker> {
  let payload: string
  try {
    payload = await readFile(markerPath(root), 'utf8')
  } catch (cause) {
    throw new Error('release run context ownership marker 缺失或无法读取', { cause })
  }
  let marker: unknown
  try {
    marker = JSON.parse(payload)
  } catch {
    throw new Error('release run context ownership marker 不是有效 JSON')
  }
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
    throw new Error('release run context ownership marker 结构无效')
  }
  const record = marker as Record<string, unknown>
  if (
    record.schemaVersion !== RELEASE_RUN_CONTEXT_SCHEMA_VERSION ||
    typeof record.repository !== 'string' ||
    typeof record.runId !== 'string' ||
    typeof record.runAttempt !== 'string' ||
    typeof record.uuid !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(record.uuid)
  ) {
    throw new Error('release run context ownership marker 字段无效')
  }
  return record as unknown as OwnershipMarker
}

export async function validateReleaseRunContext(
  root: string,
  options: DisposeReleaseRunContextOptions = {},
): Promise<OwnershipMarker> {
  const runId = parseRunNumber(environmentValue('GITHUB_RUN_ID', options.runId), 'GITHUB_RUN_ID')
  const runAttempt = parseRunNumber(
    environmentValue('GITHUB_RUN_ATTEMPT', options.runAttempt),
    'GITHUB_RUN_ATTEMPT',
  )
  const runnerTemp = await normalizeRunnerTemp(environmentValue('RUNNER_TEMP', options.runnerTemp))
  const repository = options.repository ?? RELEASE_RUN_REPOSITORY
  assertRepository(repository)

  const resolvedRoot = resolve(root)
  if (!isDirectChildOf(resolvedRoot, runnerTemp)) {
    throw new Error('拒绝清理不属于 RUNNER_TEMP 直接子目录的路径')
  }
  const marker = await readOwnershipMarker(resolvedRoot)
  if (marker.repository !== repository) {
    throw new Error('release run context repository 不匹配')
  }
  if (marker.runId !== runId) {
    throw new Error('release run context run ID 不匹配')
  }
  if (marker.runAttempt !== runAttempt) {
    throw new Error('release run context run attempt 不匹配')
  }
  const expectedName = releaseRunRootName(runId, runAttempt, marker.uuid)
  if (basename(resolvedRoot) !== expectedName) {
    throw new Error('release run context 目录名与 ownership marker 不匹配')
  }
  return marker
}

export async function disposeReleaseRunContext(
  root: string,
  options: DisposeReleaseRunContextOptions = {},
): Promise<void> {
  await validateReleaseRunContext(root, options)
  const attempts = options.removeAttempts ?? 100
  const delayMs = options.removeDelayMs ?? 50
  let lastCause: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rm(resolve(root), { recursive: true, force: true })
      return
    } catch (cause) {
      if (
        !(cause instanceof Error) ||
        !('code' in cause) ||
        !RETRYABLE_REMOVE_CODES.has(String(cause.code))
      ) {
        throw new Error(
          `release run context 清理失败（阶段=remove，错误=${String((cause as { code?: unknown })?.code ?? 'unknown')}）`,
          { cause },
        )
      }
      lastCause = cause
      if (attempt < attempts - 1) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs))
      }
    }
  }
  throw new Error(
    `release run context 清理失败（阶段=remove-timeout，错误=${String((lastCause as { code?: unknown })?.code ?? 'unknown')}）`,
    { cause: lastCause },
  )
}

function appendGithubEnvironment(lines: ReadonlyArray<[string, string]>): void {
  const output = process.env.GITHUB_ENV
  if (!output) return
  const payload = lines.map(([key, value]) => `${key}=${value}`).join('\n')
  appendFileSync(output, `${payload}\n`, 'utf8')
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? ''
  if (command === 'create') {
    const context = await createReleaseRunContext()
    // 隔离后续步骤的 TEMP/APPDATA/LOCALAPPDATA 与 Agent 数据目录，
    // 并显式清除继承的 PIDEX_AGENT_URL、旧测试端口和旧 smoke 数据目录。
    appendGithubEnvironment([
      ['PIDEX_RELEASE_RUN_ROOT', context.root],
      ['TEMP', context.temp],
      ['TMP', context.temp],
      ['APPDATA', context.appData],
      ['LOCALAPPDATA', context.localAppData],
      ['PIDEX_USER_DATA_DIR', context.userData],
      ['PIDEX_DATA_DIR', context.data],
      ['PIDEX_LOG_DIR', context.logs],
      ['PIDEX_AGENT_URL', ''],
      ['PIDEX_PORT', ''],
    ])
    console.log(JSON.stringify(context, null, 2))
    return
  }
  if (command === 'dispose') {
    const root = process.env.PIDEX_RELEASE_RUN_ROOT
    if (!root || !existsSync(resolve(root))) {
      console.log('[Pidex] No release run context to dispose')
      return
    }
    await disposeReleaseRunContext(root)
    console.log(`[Pidex] Release run context disposed: ${root}`)
    return
  }
  throw new Error('用法：bun scripts/ReleaseRunContext.ts <create|dispose>')
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
