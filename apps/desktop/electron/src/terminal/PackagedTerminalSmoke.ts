import { spawn as spawnChild } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, relative, resolve } from 'node:path'
import { spawn as spawnPty, type IPty } from 'node-pty'
import { HostProcessTreeKiller } from './ProcessTree.js'

const FIXED_MARKER = 'PIDEX_CONPTY_SMOKE_OK'
const FIXED_EXIT_CODE = 23
// GitHub-hosted Windows runners can spend more than 10 seconds cold-starting
// PowerShell/ConPTY. Keep each phase bounded without treating that startup tail
// as a package failure.
const SMOKE_TIMEOUT_MS = 30_000

export async function runPackagedTerminalSmoke(resultPath: string): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Packaged terminal smoke 仅支持 Windows')
  const safeResultPath = requireTemporaryResultPath(resultPath)
  const powershell = resolve(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  )
  const fixed = spawnPty(
    powershell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `[Console]::Out.WriteLine('${FIXED_MARKER}'); exit ${FIXED_EXIT_CODE}`,
    ],
    ptyOptions(),
  )
  const fixedResult = await collectExit(fixed)
  if (!fixedResult.output.includes(FIXED_MARKER) || fixedResult.exitCode !== FIXED_EXIT_CODE) {
    throw new Error('Packaged node-pty 未返回固定 ConPTY 输出或 exit code')
  }

  const cleanup = spawnPty(
    powershell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$child=Start-Process -PassThru -WindowStyle Hidden -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 60'); [Console]::Out.WriteLine('CHILD_PID=' + $child.Id); Start-Sleep -Seconds 60",
    ],
    ptyOptions(),
  )
  const cleanupExit = waitForPtyExit(cleanup)
  let cleanupOutput = ''
  let childPid: number | undefined
  const childPidReady = new Promise<number>((resolvePid, rejectPid) => {
    const timeout = setTimeout(
      () => rejectPid(new Error('ConPTY 子进程 PID 未输出')),
      SMOKE_TIMEOUT_MS,
    )
    const subscription = cleanup.onData((data) => {
      cleanupOutput = `${cleanupOutput}${data}`.slice(-16_384)
      const match = cleanupOutput.match(/CHILD_PID=(\d+)/)
      if (!match) return
      childPid = Number(match[1])
      clearTimeout(timeout)
      subscription.dispose()
      resolvePid(childPid)
    })
  })
  try {
    const nestedPid = await childPidReady
    await withTimeout(new HostProcessTreeKiller().kill(cleanup.pid), SMOKE_TIMEOUT_MS)
    try {
      cleanup.kill()
    } catch {
      /* taskkill remains authoritative */
    }
    await withTimeout(cleanupExit, SMOKE_TIMEOUT_MS)
    await waitForProcessExit(nestedPid, SMOKE_TIMEOUT_MS)
  } finally {
    try {
      cleanup.kill()
    } catch {
      /* already stopped */
    }
    await new HostProcessTreeKiller().kill(cleanup.pid).catch(() => undefined)
    if (childPid && (await isProcessRunning(childPid))) {
      await new HostProcessTreeKiller().kill(childPid).catch(() => undefined)
    }
  }

  await writeFile(
    safeResultPath,
    JSON.stringify({
      ok: true,
      nodePtyLoaded: true,
      conptyOutput: true,
      exitCode: fixedResult.exitCode,
      processTreeCleaned: true,
    }),
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  )
}

function ptyOptions() {
  return {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: tmpdir(),
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
    useConpty: true,
    useConptyDll: false,
  } as const
}

async function collectExit(pty: IPty): Promise<{ output: string; exitCode: number }> {
  let output = ''
  const data = pty.onData((chunk) => {
    output = `${output}${chunk}`.slice(-16_384)
  })
  try {
    const exitCode = await withTimeout(waitForPtyExit(pty), SMOKE_TIMEOUT_MS)
    return { output, exitCode }
  } finally {
    data.dispose()
    try {
      pty.kill()
    } catch {
      /* already exited */
    }
  }
}

function waitForPtyExit(pty: IPty): Promise<number> {
  return new Promise((resolveExit) => {
    const subscription = pty.onExit((event) => {
      subscription.dispose()
      resolveExit(event.exitCode)
    })
  })
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await isProcessRunning(pid))) return
    await delay(50)
  }
  throw new Error('ConPTY 子进程树未在超时内清理')
}

async function isProcessRunning(pid: number): Promise<boolean> {
  const child = spawnChild('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  })
  let output = ''
  child.stdout?.on('data', (chunk) => {
    output += String(chunk)
  })
  await new Promise<void>((resolveExit) => {
    child.once('error', () => resolveExit())
    child.once('exit', () => resolveExit())
  })
  return new RegExp(`"[^"]*","${pid}"`).test(output)
}

function requireTemporaryResultPath(value: string): string {
  const candidate = resolve(value)
  const temporaryRoot = resolve(tmpdir())
  const relativePath = relative(temporaryRoot, candidate)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Packaged terminal smoke 结果路径必须位于系统临时目录')
  }
  return candidate
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Packaged terminal smoke 超时')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}
