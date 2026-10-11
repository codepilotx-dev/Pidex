import type { McpScope } from '@pidex/agent-protocol'
import type {
  OAuthDiscoveryState,
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@earendil-works/pi-mcp/oauth'
import { createHash } from 'node:crypto'
import { Effect } from 'effect'
import type { EncryptedCredentialRepository } from '../auth/EncryptedCredentialRepository'

export type StoredMcpOAuthCredential = {
  version: 1
  serverUrlHash: string
  tokens?: OAuthTokens
  clientInformation?: OAuthClientInformationMixed
  discoveryState?: OAuthDiscoveryState
}

export type McpOAuthCredentialIdentity = {
  integrationID: string
  serverUrlHash: string
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex')

export class McpOAuthCredentialRepository {
  constructor(private readonly credentials: EncryptedCredentialRepository) {}

  identity(input: {
    scope: McpScope
    workspaceHash?: string
    serverName: string
    serverUrl: string
  }): McpOAuthCredentialIdentity {
    const workspace = input.scope === 'local' ? (input.workspaceHash ?? '') : ''
    const name = input.serverName.trim().toLowerCase()
    return {
      integrationID: `mcp-oauth:${digest(`${input.scope}\0${workspace}\0${name}`)}`,
      serverUrlHash: digest(new URL(input.serverUrl).toString()),
    }
  }

  async get(identity: McpOAuthCredentialIdentity) {
    const stored = await Effect.runPromise(
      this.credentials.get<StoredMcpOAuthCredential>(identity.integrationID),
    )
    if (!stored) return null
    if (stored.value.version !== 1 || stored.value.serverUrlHash !== identity.serverUrlHash) {
      await this.remove(identity)
      return null
    }
    return stored.value
  }

  async set(identity: McpOAuthCredentialIdentity, value: StoredMcpOAuthCredential) {
    await Effect.runPromise(
      this.credentials.set({
        integrationID: identity.integrationID,
        methodID: 'mcp-oauth',
        label: 'MCP OAuth',
        value,
      }),
    )
  }

  async remove(identity: McpOAuthCredentialIdentity) {
    await Effect.runPromise(this.credentials.remove(identity.integrationID))
  }
}
