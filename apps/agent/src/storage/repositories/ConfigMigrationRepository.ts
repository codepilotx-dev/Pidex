import type { Database } from 'bun:sqlite'
import type { AgentDatabase } from '../database/AgentDatabase'

export type LegacyConfigSnapshot = {
  completed: boolean
  desktop: Record<string, unknown> | null
  defaultModel: Record<string, unknown> | null
  reviewerModel: Record<string, unknown> | null
  providerSettings: Array<{ providerID: string; payload: Record<string, unknown> }>
  projects: Array<{ rootPath: string; defaultModel: Record<string, unknown> | null }>
  mcp: Record<string, unknown> | null
  skills: Record<string, unknown> | null
}

const parseObject = (value: string | null | undefined) => {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export class ConfigMigrationRepository {
  private readonly sqlite: Database

  constructor(database: AgentDatabase) {
    this.sqlite = database.profileSqlite
  }

  read(): LegacyConfigSnapshot {
    const settings = new Map(
      (
        this.sqlite
          .query(
            "SELECT key, value FROM app_settings WHERE key IN ('config.json.migration.v1', 'config.toml.migration.v1', 'desktop.settings.v1', 'defaultModel', 'reviewerModel', 'mcp.settings.v2', 'skills.settings.v1')",
          )
          .all() as Array<{ key: string; value: string }>
      ).map((row) => [row.key, row.value]),
    )
    const providerSettings = (
      this.sqlite
        .query('SELECT provider_id, payload FROM provider_settings ORDER BY provider_id')
        .all() as Array<{ provider_id: string; payload: string }>
    ).flatMap((row) => {
      const payload = parseObject(row.payload)
      return payload ? [{ providerID: row.provider_id, payload }] : []
    })
    const projects = (
      this.sqlite
        .query(
          `
      SELECT pf.path AS root_path, ps.default_model
      FROM projects AS p
      INNER JOIN project_folders AS pf
        ON pf.project_id = p.id AND pf.role = 'primary'
      LEFT JOIN project_settings AS ps ON ps.project_id = p.id
    `,
        )
        .all() as Array<{ root_path: string; default_model: string | null }>
    ).map((row) => ({
      rootPath: row.root_path,
      defaultModel: parseObject(row.default_model),
    }))
    return {
      completed:
        parseObject(settings.get('config.json.migration.v1'))?.completed === true ||
        parseObject(settings.get('config.toml.migration.v1'))?.completed === true,
      desktop: parseObject(settings.get('desktop.settings.v1')),
      defaultModel: parseObject(settings.get('defaultModel')),
      reviewerModel: parseObject(settings.get('reviewerModel')),
      providerSettings,
      projects,
      mcp: parseObject(settings.get('mcp.settings.v2')),
      skills: parseObject(settings.get('skills.settings.v1')),
    }
  }

  recentNewThreadModelMigrated(): boolean {
    const row = this.sqlite
      .query('SELECT value FROM app_settings WHERE key = ?')
      .get('config.json.migration.recent_new_thread_model.v1') as { value: string } | null
    return parseObject(row?.value)?.migrated === true
  }

  markRecentNewThreadModelMigrated() {
    this.sqlite
      .query(
        'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      )
      .run(
        'config.json.migration.recent_new_thread_model.v1',
        JSON.stringify({ migrated: true, migratedAt: Date.now() }),
        Date.now(),
      )
  }

  specializedModelReferencesMigrated(): boolean {
    const row = this.sqlite
      .query('SELECT value FROM app_settings WHERE key = ?')
      .get('config.json.migration.specialized_model_refs.v1') as { value: string } | null
    return parseObject(row?.value)?.migrated === true
  }

  markSpecializedModelReferencesMigrated() {
    this.sqlite
      .query(
        'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      )
      .run(
        'config.json.migration.specialized_model_refs.v1',
        JSON.stringify({ migrated: true, migratedAt: Date.now() }),
        Date.now(),
      )
  }

  mergeDesktopRuntimeState(runtimeState: Record<string, unknown>) {
    if (Object.keys(runtimeState).length === 0) return
    this.sqlite.transaction(() => {
      const existing =
        parseObject(
          (
            this.sqlite
              .query('SELECT value FROM app_settings WHERE key = ?')
              .get('desktop.runtime-state.v1') as { value: string } | null
          )?.value,
        ) ?? {}
      this.sqlite
        .query(
          'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        )
        .run(
          'desktop.runtime-state.v1',
          JSON.stringify({ ...runtimeState, ...existing }),
          Date.now(),
        )
    })()
  }

  commit(
    runtimeState: Record<string, unknown>,
    mcpRuntime: Record<string, unknown> | null,
    skillRuntime: Record<string, unknown> | null,
  ) {
    this.sqlite.transaction(() => {
      this.sqlite
        .query(
          "DELETE FROM app_settings WHERE key IN ('desktop.settings.v1', 'defaultModel', 'reviewerModel', 'mcp.settings.v2', 'skills.settings.v1')",
        )
        .run()
      this.sqlite.query('DELETE FROM provider_settings').run()
      this.sqlite.query('UPDATE project_settings SET default_model = NULL').run()
      this.sqlite
        .query(
          'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        )
        .run('desktop.runtime-state.v1', JSON.stringify(runtimeState), Date.now())
      this.sqlite
        .query(
          'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        )
        .run(
          'mcp.runtime.v1',
          JSON.stringify(
            mcpRuntime ?? { version: 2, generation: 1, operations: [], user: {}, local: {} },
          ),
          Date.now(),
        )
      this.sqlite
        .query(
          'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        )
        .run(
          'skills.runtime.v1',
          JSON.stringify(
            skillRuntime ?? {
              version: 1,
              disabledPathHashes: [],
              generation: 1,
              updatedAt: 0,
              operations: [],
            },
          ),
          Date.now(),
        )
      this.sqlite
        .query(
          'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        )
        .run(
          'config.json.migration.v1',
          JSON.stringify({ completed: true, migratedAt: Date.now() }),
          Date.now(),
        )
    })()
  }
}
