import type { Database } from 'bun:sqlite'

export const DEFAULT_SQLITE_CACHE_SIZE_KIB = -4000

export const configureConnection = (database: Database) => {
  database.exec('PRAGMA journal_mode = WAL')
  database.exec('PRAGMA foreign_keys = ON')
  database.exec('PRAGMA busy_timeout = 5000')
  database.exec(`PRAGMA cache_size = ${DEFAULT_SQLITE_CACHE_SIZE_KIB}`)
}

export const shrinkDatabaseMemory = (database: Database): void => {
  try {
    database.exec('PRAGMA shrink_memory')
  } catch {}
  try {
    database.exec('PRAGMA wal_checkpoint(PASSIVE)')
  } catch {}
}
