import { createHash } from 'node:crypto'
import { constants, realpathSync } from 'node:fs'
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, normalize, resolve } from 'node:path'

export const agentDataDir = resolve(process.env.PIDEX_DATA_DIR?.trim() || join(homedir(), '.pidex'))
export const runtimeDir = join(agentDataDir, 'runtime')
export const runtimeFile = join(runtimeDir, 'dev-agent-v2.json')
export const legacyRuntimeFile = join(runtimeDir, 'dev-agent-v1.json')
export const lockFile = join(runtimeDir, 'dev-agent.lock')

const runtimeKeys = [
  'agentPid',
  'authToken',
  'instanceToken',
  'origin',
  'ownerPid',
  'schemaVersion',
] as const
const legacyRuntimeKeys = [...runtimeKeys, 'rendererDevUrl']

export type DevAgentRuntimeV2 = {
  schemaVersion: 2
  ownerPid: number
  agentPid: number
  origin: string
  authToken: string
  instanceToken: string
}

export type DevAgentRuntimeV1 = Omit<DevAgentRuntimeV2, 'schemaVersion'> & {
  schemaVersion: 1
  rendererDevUrl: 'http://127.0.0.1:7788'
}

export type DevAgentLaunchConnection = {
  port: number | undefined
  authToken: string
  reused: boolean
}

type VerifiableRuntime = Pick<DevAgentRuntimeV2, 'origin' | 'authToken' | 'instanceToken'>
type DevAgentLockV1 = { schemaVersion: 1; ownerPid: number; instanceToken: string }

function isPid(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && value.length <= 512
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function validateRuntimeIdentity(record: Record<string, unknown>) {
  if (
    !isPid(record.ownerPid) ||
    !isPid(record.agentPid) ||
    !isToken(record.authToken) ||
    !isToken(record.instanceToken)
  ) {
    throw new Error('invalid runtime descriptor')
  }
  if (typeof record.origin !== 'string' || record.origin.length > 128)
    throw new Error('invalid runtime descriptor')
  const origin = new URL(record.origin)
  const port = Number(origin.port)
  if (
    origin.protocol !== 'http:' ||
    origin.hostname !== '127.0.0.1' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  )
    throw new Error('invalid runtime descriptor')
}

function parseRuntimeObject(text: string) {
  if (text.length > 4_096) throw new Error('invalid runtime descriptor')
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid runtime descriptor')
  return value as Record<string, unknown>
}

export function parseDevAgentRuntime(text: string): DevAgentRuntimeV2 {
  const record = parseRuntimeObject(text)
  if (!hasExactKeys(record, runtimeKeys) || record.schemaVersion !== 2)
    throw new Error('invalid runtime descriptor')
  validateRuntimeIdentity(record)
  return record as DevAgentRuntimeV2
}

export function parseLegacyDevAgentRuntime(text: string): DevAgentRuntimeV1 {
  const record = parseRuntimeObject(text)
  if (
    !hasExactKeys(record, legacyRuntimeKeys) ||
    record.schemaVersion !== 1 ||
    record.rendererDevUrl !== 'http://127.0.0.1:7788'
  ) {
    throw new Error('invalid runtime descriptor')
  }
  validateRuntimeIdentity(record)
  return record as DevAgentRuntimeV1
}

export function resolveDevAgentLaunchConnection(
  previous: DevAgentRuntimeV2 | undefined,
  configuredPort: number | undefined,
  createAuthToken: () => string,
): DevAgentLaunchConnection {
  const previousPort = previous ? Number(new URL(previous.origin).port) : undefined
  if (configuredPort !== undefined && configuredPort !== previousPort) {
    return {
      port: configuredPort,
      authToken: createAuthToken(),
      reused: false,
    }
  }
  if (previous) {
    return {
      port: previousPort,
      authToken: previous.authToken,
      reused: true,
    }
  }
  return {
    port: configuredPort,
    authToken: createAuthToken(),
    reused: false,
  }
}

async function readRegularFile(path: string) {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid runtime file')
  return await readFile(path, 'utf8')
}

export async function readDevAgentRuntime() {
  return parseDevAgentRuntime(await readRegularFile(runtimeFile))
}

export async function readLegacyDevAgentRuntime() {
  return parseLegacyDevAgentRuntime(await readRegularFile(legacyRuntimeFile))
}

export function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function isRuntimeOwnerAlive(pid: number, path: string) {
  if (!isProcessAlive(pid)) return false
  if (process.platform !== 'win32') return true
  const { mtimeMs } = await lstat(path)
  const result = Bun.spawnSync(
    [
      join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe',
      ),
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `[Console]::Write((Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString("o"))`,
    ],
    { stdout: 'pipe', stderr: 'ignore' },
  )
  if (result.exitCode !== 0) return isProcessAlive(pid)
  const startedAt = Date.parse(new TextDecoder().decode(result.stdout).trim())
  // Windows 会复用 PID；文件写入之后才启动的进程不拥有这个锁。
  return !Number.isFinite(startedAt) || startedAt <= mtimeMs
}

export async function verifyDevAgent(runtime: VerifiableRuntime, timeout = 1_000) {
  try {
    const response = await fetch(`${runtime.origin}/api/ready`, {
      headers: { Authorization: `Bearer ${runtime.authToken}` },
      signal: AbortSignal.timeout(timeout),
    })
    if (!response.ok) return false
    const body = (await response.json()) as { instanceToken?: unknown }
    return body.instanceToken === runtime.instanceToken
  } catch {
    return false
  }
}

async function readLock() {
  try {
    const value: unknown = JSON.parse(await readRegularFile(lockFile))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const lock = value as Partial<DevAgentLockV1>
    if (lock.schemaVersion !== 1 || !isPid(lock.ownerPid) || !isToken(lock.instanceToken))
      return undefined
    return lock as DevAgentLockV1
  } catch {
    return undefined
  }
}

async function readReusableDevAgentRuntime() {
  try {
    return await readDevAgentRuntime()
  } catch {
    return undefined
  }
}

async function inspectExistingRuntime() {
  try {
    const runtime = await readDevAgentRuntime()
    if (await verifyDevAgent(runtime)) throw new Error('AGENT_ALREADY_RUNNING')
  } catch (error) {
    if (error instanceof Error && error.message === 'AGENT_ALREADY_RUNNING') throw error
  }

  try {
    const legacy = await readLegacyDevAgentRuntime()
    if (await verifyDevAgent(legacy)) throw new Error('LEGACY_AGENT_RUNNING')
    if (await isRuntimeOwnerAlive(legacy.ownerPid, legacyRuntimeFile))
      throw new Error('AGENT_LOCKED')
    const lock = await readLock()
    await rm(legacyRuntimeFile, { force: true })
    if (lock?.ownerPid === legacy.ownerPid && lock.instanceToken === legacy.instanceToken)
      await rm(lockFile, { force: true })
  } catch (error) {
    if (error instanceof Error && ['LEGACY_AGENT_RUNNING', 'AGENT_LOCKED'].includes(error.message))
      throw error
  }
}

export async function acquireDevAgentLock(
  instanceToken: string,
): Promise<DevAgentRuntimeV2 | undefined> {
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 })
  await inspectExistingRuntime()
  const lock: DevAgentLockV1 = { schemaVersion: 1, ownerPid: process.pid, instanceToken }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(
        lockFile,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      )
      try {
        await handle.writeFile(JSON.stringify(lock), 'utf8')
      } finally {
        await handle.close()
      }
      return await readReusableDevAgentRuntime()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      for (let wait = 0; wait < 20; wait += 1) {
        await inspectExistingRuntime()
        await Bun.sleep(100)
      }
      const existing = await readLock()
      if (!existing || (await isRuntimeOwnerAlive(existing.ownerPid, lockFile)))
        throw new Error('AGENT_LOCKED')
      await rm(lockFile, { force: true })
    }
  }
  throw new Error('AGENT_LOCKED')
}

export async function publishDevAgentRuntime(runtime: DevAgentRuntimeV2) {
  const temporary = join(runtimeDir, `.dev-agent-${process.pid}-${crypto.randomUUID()}.tmp`)
  const handle = await open(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  )
  try {
    await handle.writeFile(JSON.stringify(runtime), 'utf8')
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, runtimeFile)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

export async function cleanupDevAgentRuntime(instanceToken: string) {
  // 保留最后一次连接描述供仍在运行的 Desktop 重连；在线状态始终由
  // verifyDevAgent 判定，lock 只表示当前启动器的进程所有权。
  const lock = await readLock()
  if (lock?.instanceToken === instanceToken && lock.ownerPid === process.pid)
    await rm(lockFile, { force: true })
}

export function normalizeWorktreePath(path: string) {
  const resolved = resolve(path)
  let canonical = resolved
  try {
    canonical = realpathSync.native(resolved)
  } catch {
    /* tests and callers may describe a path before creating it */
  }
  const normalized = normalize(canonical).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

export function createWorktreeInstance(path: string, dataDir = agentDataDir) {
  const id = createHash('sha256').update(normalizeWorktreePath(path), 'utf8').digest('hex')
  const directory = join(dataDir, 'runtime', 'dev-desktops', id)
  return {
    id,
    shortId: id.slice(0, 8),
    directory,
    userDataDir: join(directory, 'user-data'),
    logDir: join(directory, 'logs'),
  }
}

export function configuredRendererPort(value = process.env.PIDEX_DEV_RENDERER_PORT) {
  const configured = value?.trim()
  if (!configured) return undefined
  const port = Number(configured)
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error('invalid configured renderer port')
  return port
}

export async function allocateLoopbackPort(configured?: number) {
  const { createServer } = await import('node:net')
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: configured ?? 0 }, () => {
      const address = server.address()
      if (!address || typeof address === 'string')
        return server.close(() => reject(new Error('port allocation failed')))
      server.close((error) => (error ? reject(error) : resolvePort(address.port)))
    })
  })
}

export function localNoProxy(value: string | undefined) {
  const entries = new Set(
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  entries.add('127.0.0.1')
  entries.add('localhost')
  entries.add('::1')
  return [...entries].join(',')
}

export function terminateProcessTree(child: ReturnType<typeof Bun.spawn>) {
  try {
    if (process.platform === 'win32') {
      Bun.spawnSync(['taskkill.exe', '/PID', String(child.pid), '/T', '/F'], {
        stdout: 'ignore',
        stderr: 'ignore',
      })
    } else child.kill()
  } catch {
    /* process tree already exited */
  }
}
