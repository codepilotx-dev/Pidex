import type {
  Credential as PiCredential,
  CredentialInfo,
  CredentialStore,
} from '@earendil-works/pi-ai'
import { Credential } from '@pidex/model-schema'
import { Effect } from 'effect'
import type { ProviderCredentialRepository } from '../../auth/ProviderCredentialRepository'

type CredentialRepository = Pick<
  ProviderCredentialRepository,
  | 'list'
  | 'get'
  | 'set'
  | 'createApiKey'
  | 'setProviderCredentialActive'
  | 'upsertOAuth'
  | 'deleteCredentialByID'
>

export interface EncryptedCredentialStoreOptions {
  /** Maps a Pi provider id to Pidex's integration id. */
  readonly integrationID?: (providerID: string) => string
  /** Maps a persisted integration id back to a Pi provider id for metadata listing. */
  readonly providerID?: (integrationID: string) => string | undefined
  /** Used when Pi creates a new OAuth credential without Pidex method metadata. */
  readonly oauthMethodID?: (providerID: string) => string
}

const metadataEnv = (metadata: Readonly<Record<string, unknown>> | undefined) => {
  const value = metadata?.env
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  )
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

const toPiCredential = (value: Credential.Value): PiCredential => {
  if (value.type === 'key') {
    const env = metadataEnv(value.metadata)
    return { type: 'api_key', key: value.key, ...(env ? { env } : {}) }
  }
  return {
    ...value.metadata,
    type: 'oauth',
    refresh: value.refresh,
    access: value.access,
    expires: value.expires,
    methodID: String(value.methodID),
  }
}

const toStoredCredential = (
  providerID: string,
  value: PiCredential,
  current: Credential.Value | undefined,
  oauthMethodID: (providerID: string) => string,
): Credential.Value => {
  if (value.type === 'api_key') {
    const key = value.key ?? (current?.type === 'key' ? current.key : undefined)
    if (!key) {
      throw new Error('Pi API key credential cannot be persisted without key material')
    }
    return Credential.Value.make({
      type: 'key',
      key,
      ...(value.env ? { metadata: { env: value.env } } : {}),
    })
  }

  const { type: _type, refresh, access, expires, methodID, ...metadata } = value
  const previousMethodID = current?.type === 'oauth' ? String(current.methodID) : undefined
  return Credential.Value.make({
    type: 'oauth',
    methodID: Credential.MethodID.make(
      typeof methodID === 'string' ? methodID : (previousMethodID ?? oauthMethodID(providerID)),
    ),
    refresh,
    access,
    expires,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  })
}

/**
 * Pi credential storage backed by Pidex's selected Provider repository.
 *
 * The adapter never reads or writes Pi's auth.json. Writes are serialized per
 * provider so OAuth refreshes cannot overwrite each other inside the Agent
 * process. Pi never discovers or writes its own auth file.
 */
export class EncryptedCredentialStore implements CredentialStore {
  private readonly chains = new Map<string, Promise<void>>()
  private readonly toIntegrationID: (providerID: string) => string
  private readonly toProviderID: (integrationID: string) => string | undefined
  private readonly oauthMethodID: (providerID: string) => string

  constructor(
    private readonly repository: CredentialRepository,
    options: EncryptedCredentialStoreOptions = {},
  ) {
    this.toIntegrationID = options.integrationID ?? ((providerID) => providerID)
    this.toProviderID = options.providerID ?? ((integrationID) => integrationID)
    this.oauthMethodID = options.oauthMethodID ?? ((providerID) => `${providerID}:oauth`)
  }

  async read(providerID: string): Promise<PiCredential | undefined> {
    const stored = await Effect.runPromise(
      this.repository.get<Credential.Value>(this.toIntegrationID(providerID)),
    )
    return stored ? toPiCredential(stored.value) : undefined
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return this.repository.list().flatMap((summary) => {
      const providerID = this.toProviderID(summary.integrationID)
      if (!providerID) return []
      return [
        {
          providerId: providerID,
          type: summary.methodID ? ('oauth' as const) : ('api_key' as const),
        },
      ]
    })
  }

  modify(
    providerID: string,
    fn: (current: PiCredential | undefined) => Promise<PiCredential | undefined>,
  ): Promise<PiCredential | undefined> {
    return this.enqueue(providerID, async () => {
      const integrationID = this.toIntegrationID(providerID)
      const stored = await Effect.runPromise(this.repository.get<Credential.Value>(integrationID))
      const next = await fn(stored ? toPiCredential(stored.value) : undefined)
      if (!next) return stored ? toPiCredential(stored.value) : undefined
      const value = toStoredCredential(providerID, next, stored?.value, this.oauthMethodID)
      if (value.type === 'oauth') {
        await Effect.runPromise(
          this.repository.upsertOAuth({
            providerID: integrationID,
            methodID: String(value.methodID),
            label: stored?.kind === 'oauth' ? stored.label : 'OAuth',
            value,
          }),
        )
      } else if (stored?.kind === 'api-key') {
        await Effect.runPromise(
          this.repository.set({
            integrationID,
            label: stored.label,
            value,
          }),
        )
      } else {
        const created = await Effect.runPromise(
          this.repository.createApiKey({
            integrationID,
            label: 'default',
            key: value.key,
          }),
        )
        await Effect.runPromise(
          this.repository.setProviderCredentialActive(integrationID, created.id),
        )
      }
      return next
    })
  }

  async delete(providerID: string): Promise<void> {
    await this.enqueue(providerID, async () => {
      const stored = await Effect.runPromise(this.repository.get(this.toIntegrationID(providerID)))
      if (stored) {
        await Effect.runPromise(this.repository.deleteCredentialByID(stored.id))
      }
    })
  }

  private enqueue<T>(providerID: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(providerID) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(task)
    const settled = result.then(
      () => undefined,
      () => undefined,
    )
    this.chains.set(providerID, settled)
    void settled.finally(() => {
      if (this.chains.get(providerID) === settled) this.chains.delete(providerID)
    })
    return result
  }
}
