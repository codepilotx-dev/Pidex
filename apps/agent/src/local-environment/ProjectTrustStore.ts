import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Execution trust is deliberately keyed by a configuration hash. Implementors
 * persist only that digest, never script or command text.
 */
export interface ProjectTrustStore {
  isExecutionTrusted(projectIdentity: string, configHash: string): Promise<boolean>
  trustExecution(projectIdentity: string, configHash: string): Promise<void>
  revokeExecution(projectIdentity: string): Promise<void>
}

export class MemoryProjectTrustStore implements ProjectTrustStore {
  private readonly trustedHashes = new Map<string, string>()

  async isExecutionTrusted(projectRoot: string, configHash: string) {
    return this.trustedHashes.get(projectRoot) === configHash
  }

  async trustExecution(projectRoot: string, configHash: string) {
    this.trustedHashes.set(projectRoot, configHash)
  }

  async revokeExecution(projectRoot: string) {
    this.trustedHashes.delete(projectRoot)
  }
}

type StoredTrust = { version: 1; projects: Record<string, string> }
const EMPTY: StoredTrust = { version: 1, projects: {} }
const digestIdentity = (identity: string) =>
  createHash('sha256').update(identity, 'utf8').digest('hex')
const isHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

/** Machine-local persistence containing only opaque project/config digests. */
export class FileProjectTrustStore implements ProjectTrustStore {
  private readonly path: string
  private writes: Promise<void> = Promise.resolve()

  constructor(dataDirectory: string) {
    this.path = join(dataDirectory, 'local-environment', 'execution-trust.json')
  }

  async isExecutionTrusted(projectIdentity: string, configHash: string) {
    const stored = await this.read()
    return stored.projects[digestIdentity(projectIdentity)] === configHash
  }

  async trustExecution(projectIdentity: string, configHash: string) {
    if (!isHash(configHash)) throw new Error('本地环境信任摘要无效')
    await this.mutate((stored) => {
      stored.projects[digestIdentity(projectIdentity)] = configHash
    })
  }

  async revokeExecution(projectIdentity: string) {
    await this.mutate((stored) => {
      delete stored.projects[digestIdentity(projectIdentity)]
    })
  }

  private async read(): Promise<StoredTrust> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as Partial<StoredTrust>
      if (value.version !== 1 || typeof value.projects !== 'object' || value.projects === null)
        throw new Error()
      const projects = Object.fromEntries(
        Object.entries(value.projects).filter(([key, hash]) => isHash(key) && isHash(hash)),
      )
      return { version: 1, projects }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(EMPTY)
      throw new Error('无法读取本地环境执行信任')
    }
  }

  private async mutate(change: (stored: StoredTrust) => void) {
    const operation = this.writes.then(async () => {
      const stored = await this.read()
      change(stored)
      const directory = dirname(this.path)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await chmod(directory, 0o700).catch(() => undefined)
      const temporary = `${this.path}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, `${JSON.stringify(stored)}\n`, { encoding: 'utf8', mode: 0o600 })
        await chmod(temporary, 0o600).catch(() => undefined)
        await rename(temporary, this.path)
        await chmod(this.path, 0o600).catch(() => undefined)
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined)
      }
    })
    this.writes = operation.catch(() => undefined)
    return operation
  }
}
