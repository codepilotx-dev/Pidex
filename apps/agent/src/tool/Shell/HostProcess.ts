import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { AgentError } from '../../Domain'

const MAX_OUTPUT_BYTES = 1024 * 1024
const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000

export type CapturedChild = ChildProcessByStdio<null, Readable, Readable>

export interface ProcessResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  truncated: boolean
}

export interface CommandShell {
  exe: string
  args: readonly string[]
}

export function mergeProcessEnvironment(
  base: NodeJS.ProcessEnv,
  additions?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  if (!additions) return { ...base }
  const merged = { ...base }
  for (const [key, value] of Object.entries(additions)) {
    const normalized = key.toLowerCase()
    for (const existing of Object.keys(merged)) {
      if (existing.toLowerCase() === normalized) delete merged[existing]
    }
    merged[key] = value
  }
  return merged
}

function findExecutable(names: readonly string[]) {
  const pathEntries = (process.env.PATH ?? '').split(';').filter(Boolean)
  for (const name of names) {
    for (const directory of pathEntries) {
      const candidate = join(directory, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

const systemWindowsPowerShell = (): CommandShell => ({
  exe: process.env.SystemRoot
    ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe',
  args: ['-NoProfile', '-NonInteractive', '-Command'],
})

export function preferredShell(): CommandShell {
  const pwsh = findExecutable(['pwsh.exe', 'pwsh'])
  if (pwsh) return { exe: pwsh, args: ['-NoProfile', '-NonInteractive', '-Command'] }
  return systemWindowsPowerShell()
}

export function preferredSandboxShell(): CommandShell {
  return process.platform === 'win32' ? systemWindowsPowerShell() : preferredShell()
}

export function killProcessTree(child: {
  pid?: number | undefined
  kill(signal?: NodeJS.Signals): boolean
}) {
  if (child.pid === undefined) {
    child.kill('SIGTERM')
    return
  }
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
  } else {
    child.kill('SIGTERM')
  }
}

export function boundedTimeout(timeoutMs: number | undefined) {
  if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new AgentError('INVALID_TIMEOUT', 'Shell 超时时间必须是正数', 400)
  }
  return Math.min(Math.floor(timeoutMs), MAX_TIMEOUT_MS)
}

export async function collectProcess(
  child: CapturedChild,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  let stdout = ''
  let stderr = ''
  let stdoutBytes = 0
  let stderrBytes = 0
  let truncated = false
  let timedOut = false
  let terminating = false

  const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
    const currentBytes = target === 'stdout' ? stdoutBytes : stderrBytes
    if (currentBytes >= MAX_OUTPUT_BYTES) {
      truncated = true
      return
    }
    const remaining = MAX_OUTPUT_BYTES - currentBytes
    const accepted = chunk.subarray(0, remaining)
    if (target === 'stdout') stdoutBytes += accepted.byteLength
    else stderrBytes += accepted.byteLength
    if (accepted.byteLength < chunk.byteLength) truncated = true
    if (target === 'stdout') stdout += accepted.toString('utf8')
    else stderr += accepted.toString('utf8')
  }

  child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk))
  child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk))

  const terminate = () => {
    if (terminating) return
    terminating = true
    killProcessTree(child)
  }
  const abort = () => terminate()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) terminate()
  const timer = setTimeout(() => {
    timedOut = true
    terminate()
  }, timeoutMs)

  const [exitCode, exitSignal] = await new Promise<[number | null, NodeJS.Signals | null]>(
    (resolveExit, rejectExit) => {
      child.once('error', rejectExit)
      child.once('exit', (code, exitSignal) => resolveExit([code, exitSignal]))
    },
  ).finally(() => {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  })
  if (signal?.aborted) throw new AgentError('RUN_ABORTED', '任务已停止', 499)
  return { exitCode, signal: exitSignal, stdout, stderr, timedOut, truncated }
}

export async function runHostCommand(
  command: string,
  cwd: string,
  timeoutMs?: number,
  signal?: AbortSignal,
  env?: NodeJS.ProcessEnv,
): Promise<ProcessResult> {
  const shell = preferredShell()
  const child = spawn(shell.exe, [...shell.args, command], {
    cwd,
    env: mergeProcessEnvironment(process.env, env),
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return collectProcess(child, boundedTimeout(timeoutMs), signal)
}
