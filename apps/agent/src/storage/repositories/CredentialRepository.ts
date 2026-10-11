import type {
  CredentialErrorCategory,
  CredentialHealthStatus,
  StoredCredentialHealth,
  StoredEncryptedCredential,
} from './RepositoryCore'
import { now, parse, stringify } from './RepositoryCore'

import { SubagentRepositoryDatabase } from './SubagentRepository'

export abstract class CredentialRepositoryDatabase extends SubagentRepositoryDatabase {
  setProviderSettings(providerID: string, value: unknown) {
    this.profileSqlite
      .query(
        `INSERT INTO provider_settings (provider_id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(provider_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      )
      .run(providerID, stringify(value), now())
  }

  providerSettings<T = unknown>() {
    const rows = this.profileSqlite
      .query('SELECT provider_id, payload FROM provider_settings')
      .all() as Array<{ provider_id: string; payload: string }>
    return new Map(rows.map((row) => [row.provider_id, parse<T>(row.payload)]))
  }

  credentialCount() {
    const row = this.profileSqlite.query('SELECT COUNT(*) AS count FROM credentials').get() as {
      count: number
    }
    return row.count
  }

  listEncryptedCredentials(): StoredEncryptedCredential[] {
    const rows = this.profileSqlite
      .query(
        'SELECT id, integration_id, kind, method_id, label, key_suffix, fingerprint, enabled, priority, ciphertext, nonce, key_version, created_at, updated_at FROM credentials ORDER BY integration_id, priority, created_at, id',
      )
      .all() as Array<{
      id: string
      integration_id: string
      kind: 'api-key' | 'oauth'
      method_id: string | null
      label: string
      key_suffix: string | null
      fingerprint: string | null
      enabled: number
      priority: number
      ciphertext: string
      nonce: string
      key_version: number
      created_at: number
      updated_at: number
    }>
    return rows.map((row) => ({
      id: row.id,
      integrationID: row.integration_id,
      kind: row.kind,
      methodID: row.method_id,
      label: row.label,
      keySuffix: row.key_suffix,
      fingerprint: row.fingerprint,
      enabled: row.enabled === 1,
      priority: row.priority,
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      keyVersion: row.key_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  encryptedCredential(integrationID: string) {
    const binding = this.profileSqlite
      .query('SELECT credential_id FROM integration_credential_bindings WHERE integration_id = ?')
      .get(integrationID) as { credential_id: string } | null
    return binding ? this.encryptedCredentialByID(binding.credential_id) : null
  }

  encryptedCredentialByID(id: string) {
    return this.listEncryptedCredentials().find((item) => item.id === id) ?? null
  }

  upsertEncryptedCredential(input: Omit<StoredEncryptedCredential, 'createdAt' | 'updatedAt'>) {
    const timestamp = now()
    this.profileSqlite.transaction(() => {
      this.profileSqlite
        .query(
          `
          INSERT INTO credentials (id, integration_id, kind, method_id, label, key_suffix, fingerprint, enabled, priority, ciphertext, nonce, key_version, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            integration_id = excluded.integration_id,
            kind = excluded.kind,
            method_id = excluded.method_id,
            label = excluded.label,
            key_suffix = excluded.key_suffix,
            fingerprint = excluded.fingerprint,
            enabled = excluded.enabled,
            priority = excluded.priority,
            ciphertext = excluded.ciphertext,
            nonce = excluded.nonce,
            key_version = excluded.key_version,
            updated_at = excluded.updated_at
        `,
        )
        .run(
          input.id,
          input.integrationID,
          input.kind,
          input.methodID,
          input.label,
          input.keySuffix,
          input.fingerprint,
          input.enabled ? 1 : 0,
          input.priority,
          input.ciphertext,
          input.nonce,
          input.keyVersion,
          timestamp,
          timestamp,
        )
      this.profileSqlite
        .query(
          `INSERT INTO integration_credential_bindings (integration_id, credential_id, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(integration_id) DO UPDATE SET credential_id = excluded.credential_id, updated_at = excluded.updated_at`,
        )
        .run(input.integrationID, input.id, timestamp)
      if (input.kind === 'api-key')
        this.profileSqlite
          .query(
            `INSERT INTO credential_health (credential_id, status, updated_at) VALUES (?, 'untested', ?)
          ON CONFLICT(credential_id) DO NOTHING`,
          )
          .run(input.id, timestamp)
    })()
    return this.encryptedCredentialByID(input.id)!
  }

  removeEncryptedCredential(integrationID: string) {
    // Compatibility API: callers historically disconnected an integration in
    // one operation. Hub callers that delete one pool member use the ID-based
    // deleteEncryptedCredential method instead.
    return (
      this.profileSqlite
        .query('DELETE FROM credentials WHERE integration_id = ?')
        .run(integrationID).changes > 0
    )
  }

  setActiveEncryptedCredential(integrationID: string, credentialID: string) {
    const row = this.encryptedCredentialByID(credentialID)
    if (!row || row.integrationID !== integrationID || !row.enabled) return false
    this.profileSqlite
      .query(
        `INSERT INTO integration_credential_bindings (integration_id, credential_id, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(integration_id) DO UPDATE SET credential_id = excluded.credential_id, updated_at = excluded.updated_at`,
      )
      .run(integrationID, credentialID, now())
    return true
  }

  clearActiveEncryptedCredential(integrationID: string, expectedCredentialID?: string) {
    const result = expectedCredentialID
      ? this.profileSqlite
          .query(
            'DELETE FROM integration_credential_bindings WHERE integration_id = ? AND credential_id = ?',
          )
          .run(integrationID, expectedCredentialID)
      : this.profileSqlite
          .query('DELETE FROM integration_credential_bindings WHERE integration_id = ?')
          .run(integrationID)
    return result.changes > 0
  }

  compareAndSetActiveEncryptedCredential(
    integrationID: string,
    expectedCredentialID: string,
    credentialID: string,
  ) {
    const row = this.encryptedCredentialByID(credentialID)
    if (!row || row.integrationID !== integrationID || !row.enabled) return false
    return (
      this.profileSqlite
        .query(
          `UPDATE integration_credential_bindings
        SET credential_id = ?, updated_at = ?
        WHERE integration_id = ? AND credential_id = ?`,
        )
        .run(credentialID, now(), integrationID, expectedCredentialID).changes > 0
    )
  }

  updateEncryptedCredential(
    id: string,
    patch: Partial<
      Pick<
        StoredEncryptedCredential,
        'label' | 'keySuffix' | 'fingerprint' | 'enabled' | 'priority' | 'ciphertext' | 'nonce'
      >
    >,
  ) {
    const row = this.encryptedCredentialByID(id)
    if (!row) return null
    const next = { ...row, ...patch, updatedAt: now() }
    this.profileSqlite
      .query(
        `UPDATE credentials SET label = ?, key_suffix = ?, fingerprint = ?, enabled = ?, priority = ?, ciphertext = ?, nonce = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        next.label,
        next.keySuffix,
        next.fingerprint,
        next.enabled ? 1 : 0,
        next.priority,
        next.ciphertext,
        next.nonce,
        next.updatedAt,
        id,
      )
    return this.encryptedCredentialByID(id)
  }

  reorderEncryptedCredentials(integrationID: string, orderedIDs: readonly string[]) {
    const rows = this.listEncryptedCredentials().filter(
      (row) => row.integrationID === integrationID && row.kind === 'api-key',
    )
    if (
      rows.length !== orderedIDs.length ||
      new Set(orderedIDs).size !== orderedIDs.length ||
      orderedIDs.some((id) => !rows.some((row) => row.id === id))
    )
      return false
    this.profileSqlite.transaction(() =>
      orderedIDs.forEach((id, priority) => {
        this.profileSqlite
          .query('UPDATE credentials SET priority = ?, updated_at = ? WHERE id = ?')
          .run(priority, now(), id)
      }),
    )()
    return true
  }

  deleteEncryptedCredential(id: string) {
    const row = this.encryptedCredentialByID(id)
    if (!row) return false
    // The binding row is removed by ON DELETE CASCADE when the active
    // credential is deleted. Deliberately leave the provider unconfigured:
    // choosing another credential is always an explicit user action.
    this.profileSqlite.query('DELETE FROM credentials WHERE id = ?').run(id)
    return true
  }

  credentialHealth(credentialID: string): StoredCredentialHealth | null {
    const row = this.profileSqlite
      .query(
        `SELECT credential_id, status, last_tested_at, last_used_at, last_error_category, cooldown_until, updated_at
        FROM credential_health WHERE credential_id = ?`,
      )
      .get(credentialID) as {
      credential_id: string
      status: CredentialHealthStatus
      last_tested_at: number | null
      last_used_at: number | null
      last_error_category: CredentialErrorCategory | null
      cooldown_until: number | null
      updated_at: number
    } | null
    return row
      ? {
          credentialID: row.credential_id,
          status: row.status,
          lastTestedAt: row.last_tested_at,
          lastUsedAt: row.last_used_at,
          lastErrorCategory: row.last_error_category,
          cooldownUntil: row.cooldown_until,
          updatedAt: row.updated_at,
        }
      : null
  }

  updateCredentialHealth(
    credentialID: string,
    patch: Partial<Omit<StoredCredentialHealth, 'credentialID' | 'updatedAt'>>,
  ) {
    const previous = this.credentialHealth(credentialID) ?? {
      credentialID,
      status: 'untested' as const,
      lastTestedAt: null,
      lastUsedAt: null,
      lastErrorCategory: null,
      cooldownUntil: null,
      updatedAt: now(),
    }
    const next = { ...previous, ...patch, updatedAt: now() }
    this.profileSqlite
      .query(
        `INSERT INTO credential_health
        (credential_id, status, last_tested_at, last_used_at, last_error_category, cooldown_until, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(credential_id) DO UPDATE SET status = excluded.status, last_tested_at = excluded.last_tested_at,
        last_used_at = excluded.last_used_at, last_error_category = excluded.last_error_category,
        cooldown_until = excluded.cooldown_until, updated_at = excluded.updated_at`,
      )
      .run(
        credentialID,
        next.status,
        next.lastTestedAt,
        next.lastUsedAt,
        next.lastErrorCategory,
        next.cooldownUntil,
        next.updatedAt,
      )
    return this.credentialHealth(credentialID)!
  }
}

export const credentialRepositoryDatabase = (
  database: CredentialRepositoryDatabase,
): CredentialRepositoryDatabase => database
