import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { lstat, mkdir, open, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { writeJsonAtomically } from '../windows/DebouncedAtomicJsonWriter.js'
import type { SidecarCommand } from './Command.js'
import { matchesExpectedInstanceToken, sleep } from './Readiness.js'

type RuntimeRecord = {
  version: 1
  encryptedToken: string
  instanceToken: string
  port: number
  pid: number | null
  starting?: boolean
}

export interface BackgroundRuntimeConnection {
  origin: string
  instanceToken: string
}

export interface BackgroundRuntime {
  connect(command: SidecarCommand, env: NodeJS.ProcessEnv): Promise<BackgroundRuntimeConnection>
  shutdown(): Promise<void>
}

type TokenEncryption = {
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

/** The descriptor belongs to the data directory, not an Electron window or installation. */
export class LocalBackgroundRuntime implements BackgroundRuntime {
  private record: RuntimeRecord | undefined
  private token = ''
  private readonly file: string
  private readonly lock: string

  constructor(private readonly directory: string, private readonly encryption: TokenEncryption) {
    this.file = join(directory, 'desktop-agent.json')
    this.lock = join(directory, 'desktop-agent.lock')
  }

  async initialize(): Promise<string> {
    await this.exclusive(async () => {
      this.record = await this.read()
      if (!this.record) {
        const token = randomBytes(32).toString('base64url')
        this.record = {
          version: 1,
          encryptedToken: this.encryption.encryptString(token).toString('base64'),
          instanceToken: randomBytes(32).toString('base64url'),
          port: await availablePort(),
          pid: null,
        }
        await writeJsonAtomically(this.file, this.record)
      }
      this.token = this.encryption.decryptString(Buffer.from(this.record.encryptedToken, 'base64'))
      if (this.token.length < 16) throw new Error('后台 Agent 认证信息无效')
    })
    return this.token
  }

  async connect(command: SidecarCommand, env: NodeJS.ProcessEnv): Promise<BackgroundRuntimeConnection> {
    return this.exclusive(async () => {
      const record = await this.read()
      if (!record || record.encryptedToken !== this.record?.encryptedToken)
        throw new Error('后台 Agent 连接信息已变化，请重新打开桌面端')
      this.record = record
      const connection = { origin: `http://127.0.0.1:${record.port}`, instanceToken: record.instanceToken }
      try {
        await this.probe(record)
        return connection
      } catch {
        const free = await availablePort(record.port).then(() => true, (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE') return false
          throw error
        })
        if (!free) {
          await this.waitReady()
          return connection
        }
      }

      // The Agent claims this port before bootstrap, including races after a launcher crash.
      record.pid = process.pid
      record.starting = true
      await writeJsonAtomically(this.file, record)
      let child
      try {
        child = spawn(command.executable, command.args, {
          cwd: command.cwd,
          detached: true,
          windowsHide: true,
          stdio: 'ignore',
          env: {
            ...env,
            PIDEX_AUTH_TOKEN: this.token,
            PIDEX_PORT: String(record.port),
            PIDEX_SIDECAR_INSTANCE_TOKEN: record.instanceToken,
            PIDEX_BACKGROUND_AGENT: '1',
          },
        })
        await new Promise<void>((resolve, reject) => {
          child!.once('spawn', resolve)
          child!.once('error', reject)
        })
      } catch (error) {
        record.pid = null
        record.starting = false
        await writeJsonAtomically(this.file, record)
        throw error
      }
      record.pid = child.pid!
      record.starting = false
      await writeJsonAtomically(this.file, record)
      child.unref()
      await this.waitReady()
      return connection
    })
  }

  async shutdown(): Promise<void> {
    await this.exclusive(async () => {
      const record = await this.read()
      if (!record || record.encryptedToken !== this.record?.encryptedToken)
        throw new Error('后台 Agent 连接信息已变化')
      if (record.pid === null) return
      if (!record.starting && !isProcessAlive(record.pid)) return
      const origin = `http://127.0.0.1:${record.port}`
      await this.probe(record)
      const response = await fetch(`${origin}/api/shutdown`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(4_000),
      })
      if (!response.ok) throw new Error('后台 Agent 拒绝停止请求')
      const deadline = Date.now() + 15_000
      while (isProcessAlive(record.pid)) {
        if (Date.now() >= deadline) throw new Error('尚未确认后台 Agent 已停止，请稍后重试')
        await sleep(100)
      }
      record.pid = null
      await writeJsonAtomically(this.file, record)
    })
  }

  private async waitReady() {
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      try {
        await this.probe(this.record!)
        return
      } catch {
        if (!this.record?.starting && this.record?.pid && !isProcessAlive(this.record.pid))
          throw new Error('后台 Agent 在就绪前退出，请查看 Agent 日志')
      }
      await sleep(200)
    }
    throw new Error('后台 Agent 暂时不可用，保留进程并等待重新连接')
  }

  private async probe(record: RuntimeRecord) {
    const response = await fetch(`http://127.0.0.1:${record.port}/api/ready`, {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(1_500),
    })
    const body = await response.json() as { ok?: boolean; instanceToken?: string; pid?: number }
    if (!response.ok || body.ok !== true || !matchesExpectedInstanceToken(body.instanceToken, record.instanceToken) ||
        !Number.isSafeInteger(body.pid) || Number(body.pid) <= 0) throw new Error('后台 Agent 身份验证失败')
    if (record.starting || body.pid !== record.pid) {
      record.pid = body.pid!
      record.starting = false
      await writeJsonAtomically(this.file, record)
    }
  }

  private async read(): Promise<RuntimeRecord | undefined> {
    try {
      const info = await lstat(this.file)
      if (!info.isFile() || info.isSymbolicLink() || info.size > 8_192) throw new Error()
      const value = JSON.parse(await readFile(this.file, 'utf8')) as RuntimeRecord
      if (value.version !== 1 || typeof value.encryptedToken !== 'string' ||
          typeof value.instanceToken !== 'string' || value.instanceToken.length < 16 ||
          (value.starting !== undefined && typeof value.starting !== 'boolean') ||
          !Number.isInteger(value.port) || value.port < 1 || value.port > 65_535 ||
          (value.pid !== null && (!Number.isSafeInteger(value.pid) || value.pid <= 0))) throw new Error()
      return value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new Error('后台 Agent 连接文件无法读取，已保留原文件')
    }
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    for (let attempt = 0; attempt < 2; attempt++) {
      let handle
      try {
        handle = await open(this.lock, 'wx', 0o600)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const owner = JSON.parse(await readFile(this.lock, 'utf8')) as { version?: number; pid?: number }
        if (owner.version !== 1 || !Number.isSafeInteger(owner.pid) || Number(owner.pid) <= 0 || isProcessAlive(owner.pid!))
          throw new Error('另一个桌面端正在管理后台 Agent，请稍后重试')
        await rm(this.lock)
        continue
      }
      try {
        await handle.writeFile(JSON.stringify({ version: 1, pid: process.pid }), 'utf8')
        return await operation()
      } finally {
        await handle.close()
        await rm(this.lock)
      }
    }
    throw new Error('无法获取后台 Agent 启动锁')
  }
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' }
}

function availablePort(port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return server.close(() => reject(new Error('无法分配后台端口')))
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}
