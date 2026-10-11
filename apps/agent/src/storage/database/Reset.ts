import { Database } from 'bun:sqlite'
import { existsSync, renameSync, rmSync } from 'node:fs'
import { HISTORY_SCHEMA, initializeSchema, PROFILE_SCHEMA } from './SchemaInitializer'
import {
  HISTORY_APPLICATION_ID,
  LEGACY_HISTORY_APPLICATION_IDS,
  PROFILE_APPLICATION_ID,
  SCHEMA_VERSION,
} from './Schema'

export type StoragePaths = {
  legacyPath: string
  historyPath: string
  profilePath: string
}

const sidecars = (path: string) => [`${path}-wal`, `${path}-shm`] as const

const LOCKED_FILE_RETRY_LIMIT = 200

const configureTemporaryConnection = (database: Database) => {
  database.exec('PRAGMA journal_mode = DELETE')
  database.exec('PRAGMA foreign_keys = ON')
  database.exec('PRAGMA busy_timeout = 5000')
}

const queryOne = <T>(sqlite: Database, sql: string): T => {
  const statement = sqlite.prepare(sql)
  try {
    return statement.get() as T
  } finally {
    statement.finalize()
  }
}

const queryAll = <T>(sqlite: Database, sql: string): T[] => {
  const statement = sqlite.prepare(sql)
  try {
    return statement.all() as T[]
  } finally {
    statement.finalize()
  }
}

const retryLockedFile = (work: () => void) => {
  for (let attempt = 0; attempt < LOCKED_FILE_RETRY_LIMIT; attempt += 1) {
    try {
      work()
      return
    } catch (cause) {
      const locked =
        cause instanceof Error &&
        'code' in cause &&
        (cause.code === 'EBUSY' || cause.code === 'EPERM')
      if (!locked || attempt === LOCKED_FILE_RETRY_LIMIT - 1) throw cause
      Bun.gc(true)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    }
  }
}

const removeDatabaseSidecars = (path: string) => {
  for (const target of sidecars(path)) {
    retryLockedFile(() => rmSync(target, { force: true }))
  }
}

const removeTemporaryDatabase = (path: string) => {
  retryLockedFile(() => rmSync(path, { force: true }))
  removeDatabaseSidecars(path)
}

const removeTemporaryDatabaseAfterFailure = (path: string) => {
  try {
    removeTemporaryDatabase(path)
  } catch {
    // Preserve the migration error. A later startup retries stale temporary
    // file cleanup before creating a new migration database.
  }
}

const databaseMeta = (path: string) => {
  const sqlite = new Database(path, { create: false, strict: true })
  try {
    return {
      applicationID: queryOne<{ application_id: number }>(sqlite, 'PRAGMA application_id')
        .application_id,
      userVersion: queryOne<{ user_version: number }>(sqlite, 'PRAGMA user_version').user_version,
      userTableCount: queryOne<{ count: number }>(
        sqlite,
        `
        SELECT COUNT(*) AS count
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      `,
      ).count,
    }
  } finally {
    sqlite.close(true)
  }
}

const checkpoint = (path: string) => {
  const sqlite = new Database(path, { create: false, strict: true })
  try {
    sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } finally {
    sqlite.close(true)
  }
}

const tableNames = (schema: readonly string[]) =>
  schema.flatMap((statement) => {
    const match = statement.match(/^CREATE TABLE\s+(?:"([^"]+)"|([^\s(]+))/)
    const name = match?.[1] ?? match?.[2]
    return name ? [name] : []
  })

const columns = (sqlite: Database, schema: string, table: string) =>
  queryAll<{ name: string }>(
    sqlite,
    `PRAGMA ${schema}.table_info("${table.replaceAll('"', '""')}")`,
  ).map(({ name }) => name)

const copyRecognizedTables = (sourcePath: string, target: Database, schema: readonly string[]) => {
  target.exec('PRAGMA foreign_keys = OFF')
  const escapedSourcePath = sourcePath.replaceAll("'", "''")
  target.exec(`ATTACH DATABASE '${escapedSourcePath}' AS legacy`)
  try {
    const sourceTables = new Set(
      queryAll<{ name: string }>(
        target,
        "SELECT name FROM legacy.sqlite_master WHERE type = 'table'",
      ).map(({ name }) => name),
    )
    target.transaction(() => {
      for (const table of tableNames(schema)) {
        if (!sourceTables.has(table)) continue
        const targetColumns = new Set(columns(target, 'main', table))
        const shared = columns(target, 'legacy', table).filter((name) => targetColumns.has(name))
        if (shared.length === 0) continue
        const quoted = shared.map((name) => `"${name.replaceAll('"', '""')}"`).join(', ')
        const quotedTable = `"${table.replaceAll('"', '""')}"`
        const sourceCount = queryOne<{ count: number }>(
          target,
          `SELECT COUNT(*) AS count FROM legacy.${quotedTable}`,
        ).count
        target.exec(
          `INSERT OR REPLACE INTO main.${quotedTable} (${quoted}) SELECT ${quoted} FROM legacy.${quotedTable}`,
        )
        const targetCount = queryOne<{ count: number }>(
          target,
          `SELECT COUNT(*) AS count FROM main.${quotedTable}`,
        ).count
        if (targetCount !== sourceCount) {
          throw new Error(`${table} 迁移行数不一致 (${sourceCount} → ${targetCount})`)
        }
      }
    })()
  } finally {
    target.exec('DETACH DATABASE legacy')
    target.exec('PRAGMA foreign_keys = ON')
  }
}

const validateDatabase = (sqlite: Database, kind: 'history' | 'profile') => {
  const integrity = queryOne<{ integrity_check: string }>(sqlite, 'PRAGMA integrity_check')
  if (integrity.integrity_check !== 'ok') throw new Error(`${kind} 数据库完整性校验失败`)
  const foreignKeyFailure = queryOne<{ [key: string]: unknown }>(sqlite, 'PRAGMA foreign_key_check')
  if (foreignKeyFailure) throw new Error(`${kind} 数据库外键校验失败`)
  if (kind === 'profile') {
    const settings = queryAll<{ key: string; value: string }>(
      sqlite,
      'SELECT key, value FROM app_settings',
    )
    for (const setting of settings) {
      try {
        JSON.parse(setting.value)
      } catch {
        throw new Error(`用户设置 ${setting.key} 不是有效 JSON`)
      }
    }
  }
}

const buildMigratingDatabase = (
  legacyPath: string,
  targetPath: string,
  kind: 'history' | 'profile',
) => {
  const temporaryPath = `${targetPath}.migrating`
  removeTemporaryDatabase(temporaryPath)
  const sqlite = new Database(temporaryPath, { create: true, strict: true })
  try {
    configureTemporaryConnection(sqlite)
    initializeSchema(sqlite, kind)
    if (kind === 'history') {
      sqlite.exec(`PRAGMA application_id = ${HISTORY_APPLICATION_ID}`)
    }
    copyRecognizedTables(legacyPath, sqlite, kind === 'history' ? HISTORY_SCHEMA : PROFILE_SCHEMA)
    validateDatabase(sqlite, kind)
  } catch (cause) {
    sqlite.close(true)
    removeTemporaryDatabaseAfterFailure(temporaryPath)
    throw cause
  }
  sqlite.close(true)
  return temporaryPath
}

const migrateOne = (legacyPath: string, targetPath: string, kind: 'history' | 'profile') => {
  if (existsSync(targetPath)) return
  const temporaryPath = buildMigratingDatabase(legacyPath, targetPath, kind)
  retryLockedFile(() => renameSync(temporaryPath, targetPath))
}

const isKnownHistoryApplicationID = (applicationID: number) =>
  applicationID === HISTORY_APPLICATION_ID || LEGACY_HISTORY_APPLICATION_IDS.has(applicationID)

const prepareHistoryStorage = (path: string) => {
  if (!existsSync(path)) return
  const meta = databaseMeta(path)
  if (meta.applicationID === HISTORY_APPLICATION_ID) return
  if (meta.applicationID === 0 && meta.userVersion === 0 && meta.userTableCount === 0) return
  if (
    !LEGACY_HISTORY_APPLICATION_IDS.has(meta.applicationID) ||
    meta.userVersion < 17 ||
    meta.userVersion > SCHEMA_VERSION
  ) {
    throw new Error('history.sqlite 不属于受支持的 Pidex 数据代际，已保留原文件并拒绝覆盖')
  }
  checkpoint(path)
  const sqlite = new Database(path, { create: false, strict: true })
  try {
    sqlite.exec(`PRAGMA application_id = ${HISTORY_APPLICATION_ID}`)
  } finally {
    sqlite.close(true)
  }
}

const upgradeMixedHistoryV17 = (paths: StoragePaths) => {
  if (!existsSync(paths.historyPath)) return
  const meta = databaseMeta(paths.historyPath)
  if (!isKnownHistoryApplicationID(meta.applicationID) || meta.userVersion !== 17) return

  checkpoint(paths.historyPath)
  migrateOne(paths.historyPath, paths.profilePath, 'profile')
  const temporaryPath = `${paths.historyPath}.migrating`
  removeTemporaryDatabase(temporaryPath)
  const sqlite = new Database(temporaryPath, { create: true, strict: true })
  try {
    configureTemporaryConnection(sqlite)
    initializeSchema(sqlite, 'history')
    sqlite.exec(`PRAGMA application_id = ${HISTORY_APPLICATION_ID}`)
    copyRecognizedTables(paths.historyPath, sqlite, HISTORY_SCHEMA)
    validateDatabase(sqlite, 'history')
  } catch (cause) {
    sqlite.close(true)
    removeTemporaryDatabaseAfterFailure(temporaryPath)
    throw cause
  }
  sqlite.close(true)

  removeDatabaseSidecars(paths.historyPath)
  retryLockedFile(() => renameSync(temporaryPath, paths.historyPath))
}

const validateExistingProfile = (path: string) => {
  if (!existsSync(path)) return
  const meta = databaseMeta(path)
  if (meta.applicationID !== PROFILE_APPLICATION_ID) {
    throw new Error('profile.sqlite 不属于当前应用，已保留原文件并拒绝覆盖')
  }
}

/**
 * Prepares the two independent stores. A legacy monolithic database is copied
 * through validated temporary files; the source remains untouched.
 */
export const prepareStorage = (paths: StoragePaths) => {
  upgradeMixedHistoryV17(paths)
  prepareHistoryStorage(paths.historyPath)
  validateExistingProfile(paths.profilePath)

  if (!existsSync(paths.legacyPath)) return
  checkpoint(paths.legacyPath)
  if (!existsSync(paths.historyPath) && !existsSync(paths.profilePath)) {
    const historyTemporary = `${paths.historyPath}.migrating`
    const profileTemporary = `${paths.profilePath}.migrating`
    try {
      buildMigratingDatabase(paths.legacyPath, paths.historyPath, 'history')
      buildMigratingDatabase(paths.legacyPath, paths.profilePath, 'profile')
      retryLockedFile(() => renameSync(profileTemporary, paths.profilePath))
      retryLockedFile(() => renameSync(historyTemporary, paths.historyPath))
    } catch (cause) {
      removeTemporaryDatabaseAfterFailure(historyTemporary)
      removeTemporaryDatabaseAfterFailure(profileTemporary)
      throw cause
    }
  } else {
    // Resume an interrupted publication without importing into an existing
    // target, which keeps the operation idempotent.
    migrateOne(paths.legacyPath, paths.historyPath, 'history')
    migrateOne(paths.legacyPath, paths.profilePath, 'profile')
  }
}

/** Compatibility wrapper retained for callers outside the production bootstrap. */
export const prepareDatabase = (path: string) => prepareHistoryStorage(path)
