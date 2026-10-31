import type { Database } from 'bun:sqlite'
import type { ModelRuntimePreference } from '@pidex/shared'
import { probeModelRuntimePreferencesStorageCapabilities } from '../database/StorageCapabilities'

export const MODEL_RUNTIME_PREFERENCE_SCHEMA = [
  `CREATE TABLE model_runtime_preferences (
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    variant TEXT,
    max_context_tokens INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (provider_id, model_id)
  )`,
] as const

export type ModelRuntimePreferenceRow = {
  provider_id: string
  model_id: string
  variant: string | null
  max_context_tokens: number | null
  updated_at: number
}

export type ModelRuntimePreferenceDatabase = {
  sqlite: Database
}

export class ModelRuntimePreferenceRepository {
  constructor(private readonly db: ModelRuntimePreferenceDatabase) {}

  private get sqlite(): Database {
    return this.db.sqlite
  }

  available(): boolean {
    return probeModelRuntimePreferencesStorageCapabilities(this.sqlite).modelRuntimePreferences
  }

  get(providerId: string, modelId: string): ModelRuntimePreference | null {
    if (!this.available()) return null
    const row = this.sqlite
      .query(
        'SELECT provider_id, model_id, variant, max_context_tokens, updated_at FROM model_runtime_preferences WHERE provider_id = ? AND model_id = ?',
      )
      .get(providerId, modelId) as ModelRuntimePreferenceRow | null
    return row ? this.fromRow(row) : null
  }

  list(): ModelRuntimePreference[] {
    if (!this.available()) return []
    const rows = this.sqlite
      .query(
        'SELECT provider_id, model_id, variant, max_context_tokens, updated_at FROM model_runtime_preferences ORDER BY updated_at DESC',
      )
      .all() as ModelRuntimePreferenceRow[]
    return rows.map((row) => this.fromRow(row))
  }

  set(input: {
    providerId: string
    modelId: string
    variant?: string | null
    maxContextTokens?: number | null
  }): ModelRuntimePreference {
    if (!this.available()) {
      throw new Error('model_runtime_preferences table is not available')
    }
    const updatedAt = Date.now()
    const existing = this.get(input.providerId, input.modelId)
    const variant = input.variant !== undefined ? input.variant : (existing?.variant ?? null)
    const maxContextTokens =
      input.maxContextTokens !== undefined
        ? input.maxContextTokens
        : (existing?.maxContextTokens ?? null)

    this.sqlite
      .query(
        `INSERT INTO model_runtime_preferences (provider_id, model_id, variant, max_context_tokens, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(provider_id, model_id) DO UPDATE SET
           variant = excluded.variant,
           max_context_tokens = excluded.max_context_tokens,
           updated_at = excluded.updated_at`,
      )
      .run(input.providerId, input.modelId, variant, maxContextTokens, updatedAt)

    return {
      providerId: input.providerId as ModelRuntimePreference['providerId'],
      modelId: input.modelId as ModelRuntimePreference['modelId'],
      variant,
      maxContextTokens,
      updatedAt,
    }
  }

  private fromRow(row: ModelRuntimePreferenceRow): ModelRuntimePreference {
    return {
      providerId: row.provider_id as ModelRuntimePreference['providerId'],
      modelId: row.model_id as ModelRuntimePreference['modelId'],
      variant: row.variant,
      maxContextTokens: row.max_context_tokens,
      updatedAt: row.updated_at,
    }
  }
}
