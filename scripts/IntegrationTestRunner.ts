import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { errorMessageOf as errorMessage } from '@pidex/shared/errors'

export const repositoryRoot = resolve(import.meta.dir, '..')

export function killProcessTree(child: ChildProcess): void {
  const pid = child.pid
  if (!pid || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
  } else {
    child.kill('SIGTERM')
  }
}

export async function runBun(
  args: string[],
  activeChildren: Set<ChildProcess>,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const child = spawn(process.execPath, args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  })
  activeChildren.add(child)
  const code = await new Promise<number | null>((resolveCode, reject) => {
    child.once('error', reject)
    child.once('exit', resolveCode)
  }).finally(() => activeChildren.delete(child))
  if (code !== 0) {
    throw new Error(`命令执行失败 (${code ?? 'signal'})：bun ${args.join(' ')}`)
  }
}

export function startAgentProcess(
  scriptPath: string,
  activeChildren: Set<ChildProcess>,
  environment: NodeJS.ProcessEnv,
): ChildProcess {
  const child = spawn(process.execPath, [scriptPath], {
    cwd: repositoryRoot,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  activeChildren.add(child)
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(chunk)
  })
  return child
}

export function startChildProcess(
  args: string[],
  activeChildren: Set<ChildProcess>,
  environment: NodeJS.ProcessEnv,
): ChildProcess {
  const child = spawn(process.execPath, args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  })
  activeChildren.add(child)
  child.once('exit', () => activeChildren.delete(child))
  return child
}

export async function waitForAgentReady(
  child: ChildProcess,
  readyType: string,
  activeChildren: Set<ChildProcess>,
  label = 'Agent',
  timeoutMs = 60_000,
): Promise<string> {
  if (!child.stdout) throw new Error(`无法读取 ${label} 启动输出`)
  const lines = createInterface({ input: child.stdout })
  return new Promise<string>((resolveReady, rejectReady) => {
    let settled = false
    const timeout = setTimeout(() => {
      finish(new Error(`${label} 在 ${Math.round(timeoutMs / 1000)} 秒内未就绪`))
    }, timeoutMs)
    const finish = (result: string | Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      lines.close()
      if (result instanceof Error) rejectReady(result)
      else resolveReady(result)
    }
    lines.on('line', (line) => {
      let message: { type?: string; origin?: string } | null = null
      try {
        message = JSON.parse(line) as typeof message
      } catch {
        process.stdout.write(`${line}\n`)
      }
      if (message?.type === readyType && typeof message.origin === 'string') {
        finish(message.origin)
      }
    })
    child.once('error', (cause) => finish(new Error(`${label} 启动失败：${errorMessage(cause)}`)))
    child.once('exit', (code) => {
      activeChildren.delete(child)
      finish(new Error(`${label} 提前退出 (${code ?? 'signal'})`))
    })
  })
}

export async function waitForHttpReady(
  origin: string,
  child: ChildProcess,
  label: string,
  timeoutMs = 60_000,
): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`${label} 提前退出`)
    }
    try {
      const response = await fetch(origin, {
        signal: AbortSignal.timeout(1_000),
      })
      if (response.ok) return
    } catch {
      // Continue until the bounded startup timeout.
    }
    await Bun.sleep(100)
  }
  throw new Error(`${label} 在 ${Math.round(timeoutMs / 1000)} 秒内未就绪`)
}

export function createCleanupHandler(
  activeChildren: Set<ChildProcess>,
  getState: () => { isolatedRoot: string; succeeded: boolean },
): () => Promise<void> {
  let cleaning = false
  return async function cleanup(): Promise<void> {
    if (cleaning) return
    cleaning = true
    for (const child of [...activeChildren]) {
      killProcessTree(child)
    }
    activeChildren.clear()
    const { isolatedRoot, succeeded } = getState()
    if (succeeded && isolatedRoot) {
      await rm(isolatedRoot, { recursive: true, force: true })
    }
  }
}
