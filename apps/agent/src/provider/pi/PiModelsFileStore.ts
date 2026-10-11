import type { AnyModel, ModelsStore, ModelsStoreEntry } from '@earendil-works/pi-ai'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const OWNER = 'pidex'
const FORMAT_VERSION = 1

interface StoreDocument {
  readonly owner: typeof OWNER
  readonly formatVersion: typeof FORMAT_VERSION
  readonly providers: Readonly<Record<string, ModelsStoreEntry>>
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const validModel = (value: unknown): value is AnyModel =>
  isObject(value) &&
  typeof value.id === 'string' &&
  typeof value.provider === 'string' &&
  typeof value.api === 'string' &&
  typeof value.baseUrl === 'string'

const validEntry = (value: unknown): value is ModelsStoreEntry =>
  isObject(value) &&
  Array.isArray(value.models) &&
  value.models.every(validModel) &&
  (value.checkedAt === undefined || typeof value.checkedAt === 'number') &&
  (value.lastModified === undefined || typeof value.lastModified === 'number') &&
  (value.etag === undefined || typeof value.etag === 'string')

const emptyDocument = (): StoreDocument => ({
  owner: OWNER,
  formatVersion: FORMAT_VERSION,
  providers: {},
})

/** UTF-8, ownership-checked Pi model cache. Invalid or future files are never overwritten. */
export class PiModelsFileStore implements ModelsStore {
  private operation: Promise<unknown> = Promise.resolve()

  constructor(readonly path: string) {}

  async read(providerId: string): Promise<ModelsStoreEntry | undefined> {
    return this.serial(async () => {
      const document = await this.readDocument()
      const entry = document.providers[providerId]
      return entry ? structuredClone(entry) : undefined
    })
  }

  async write(providerId: string, entry: ModelsStoreEntry): Promise<void> {
    await this.serial(async () => {
      if (!validEntry(entry)) throw new Error('Invalid Pi models cache entry')
      const document = await this.readDocument()
      await this.writeDocument({
        ...document,
        providers: {
          ...document.providers,
          [providerId]: structuredClone(entry),
        },
      })
    })
  }

  async delete(providerId: string): Promise<void> {
    await this.serial(async () => {
      const document = await this.readDocument()
      if (!(providerId in document.providers)) return
      const providers = { ...document.providers }
      delete providers[providerId]
      await this.writeDocument({ ...document, providers })
    })
  }

  private async readDocument(): Promise<StoreDocument> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (cause) {
      if (
        typeof cause === 'object' &&
        cause !== null &&
        'code' in cause &&
        cause.code === 'ENOENT'
      ) {
        return emptyDocument()
      }
      throw cause
    }
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      throw new Error('Pi models cache is corrupt; refusing to overwrite it')
    }
    if (!isObject(value) || value.owner !== OWNER) {
      throw new Error('Pi models cache has unknown ownership; refusing to overwrite it')
    }
    if (value.formatVersion !== FORMAT_VERSION) {
      throw new Error('Pi models cache uses an unsupported format; refusing to overwrite it')
    }
    if (!isObject(value.providers)) {
      throw new Error('Pi models cache is corrupt; refusing to overwrite it')
    }
    for (const entry of Object.values(value.providers)) {
      if (!validEntry(entry)) {
        throw new Error('Pi models cache is corrupt; refusing to overwrite it')
      }
    }
    return structuredClone(value) as unknown as StoreDocument
  }

  private async writeDocument(document: StoreDocument) {
    await mkdir(dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
      await rename(temporaryPath, this.path)
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operation.then(operation, operation)
    this.operation = next.catch(() => undefined)
    return next
  }
}
