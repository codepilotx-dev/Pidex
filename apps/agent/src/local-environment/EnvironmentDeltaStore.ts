import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EnvironmentDelta } from './Types'

const ENVIRONMENT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/
const isInternalControlKey = (key: string) => key.toLocaleUpperCase().startsWith('PIDEX_')

const validate = (value: unknown): EnvironmentDelta => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('环境增量文件无效')
  const candidate = value as Partial<EnvironmentDelta>
  if (!Number.isSafeInteger(candidate.revision) || (candidate.revision ?? -1) < 0)
    throw new Error('环境增量版本无效')
  if (typeof candidate.set !== 'object' || candidate.set === null || Array.isArray(candidate.set))
    throw new Error('环境增量 set 无效')
  if (!Array.isArray(candidate.unset)) throw new Error('环境增量 unset 无效')
  const set: Record<string, string> = {}
  for (const [key, item] of Object.entries(candidate.set)) {
    if (!ENVIRONMENT_KEY.test(key) || isInternalControlKey(key) || typeof item !== 'string')
      throw new Error('环境增量变量无效')
    set[key] = item
  }
  const unset = candidate.unset.map((key) => {
    if (typeof key !== 'string' || !ENVIRONMENT_KEY.test(key) || isInternalControlKey(key))
      throw new Error('环境增量变量无效')
    return key
  })
  return { revision: candidate.revision!, set, unset }
}

export class EnvironmentDeltaStore {
  private readonly root: string

  constructor(dataDirectory: string) {
    this.root = join(dataDirectory, 'local-environment')
  }

  private path(bindingId: string) {
    const digest = createHash('sha256').update(bindingId, 'utf8').digest('hex')
    return join(this.root, `${digest}.environment.json`)
  }

  async read(bindingId: string): Promise<EnvironmentDelta> {
    try {
      return validate(JSON.parse(await readFile(this.path(bindingId), 'utf8')))
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT')
        return { revision: 0, set: {}, unset: [] }
      throw new Error('无法读取本地环境增量')
    }
  }

  async replace(
    bindingId: string,
    input: Omit<EnvironmentDelta, 'revision'>,
  ): Promise<EnvironmentDelta> {
    const current = await this.read(bindingId)
    const next = validate({ ...input, revision: current.revision + 1 })
    return this.write(bindingId, next)
  }

  async copy(
    sourceBindingId: string,
    targetBindingId: string,
    expectedRevision?: number,
  ): Promise<EnvironmentDelta> {
    const source = await this.read(sourceBindingId)
    if (expectedRevision !== undefined && source.revision !== expectedRevision) {
      throw new Error('环境增量版本与执行绑定不一致')
    }
    return this.write(targetBindingId, source)
  }

  async remove(bindingId: string): Promise<void> {
    await rm(this.path(bindingId), { force: true })
  }

  private async write(bindingId: string, value: EnvironmentDelta): Promise<EnvironmentDelta> {
    const next = validate(value)
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await chmod(this.root, 0o700).catch(() => undefined)
    const target = this.path(bindingId)
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(next)}\n`, { encoding: 'utf8', mode: 0o600 })
      await chmod(temporary, 0o600).catch(() => undefined)
      await rename(temporary, target)
      await chmod(target, 0o600).catch(() => undefined)
      return next
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }
}

export const environmentDelta = (
  before: Readonly<Record<string, string | undefined>>,
  after: Readonly<Record<string, string | undefined>>,
) => {
  const caseInsensitive = process.platform === 'win32'
  const keyOf = (key: string) => (caseInsensitive ? key.toLocaleLowerCase() : key)
  const beforeByKey = new Map(
    Object.entries(before).map(([key, value]) => [keyOf(key), { key, value }]),
  )
  const afterByKey = new Map(
    Object.entries(after).map(([key, value]) => [keyOf(key), { key, value }]),
  )
  const set: Record<string, string> = {}
  const unset: string[] = []
  for (const [normalized, entry] of afterByKey) {
    if (isInternalControlKey(entry.key)) continue
    if (entry.value !== undefined && beforeByKey.get(normalized)?.value !== entry.value)
      set[entry.key] = entry.value
  }
  for (const [normalized, entry] of beforeByKey) {
    if (isInternalControlKey(entry.key)) continue
    if (!afterByKey.has(normalized)) unset.push(entry.key)
  }
  return { set, unset }
}
