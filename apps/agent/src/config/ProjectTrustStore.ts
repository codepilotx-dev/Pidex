import { resolve } from 'node:path'
import type { ProjectTrustStore } from './ConfigService'

const SETTINGS_KEY = 'config.project-trust.v1'

type SettingsDatabase = {
  getSetting<T>(key: string): T | null
  setSetting(key: string, value: unknown): void
}

type ProjectTrustState = Record<string, 'trusted' | 'untrusted'>

const canonical = (projectRoot: string) => {
  const path = resolve(projectRoot)
  return process.platform === 'win32' ? path.toLowerCase() : path
}

const normalize = (value: unknown): ProjectTrustState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([projectRoot, trustLevel]) =>
      trustLevel === 'trusted' || trustLevel === 'untrusted'
        ? [[canonical(projectRoot), trustLevel]]
        : [],
    ),
  )
}

export class SqliteProjectTrustStore implements ProjectTrustStore {
  constructor(private readonly database: SettingsDatabase) {}

  private state() {
    return normalize(this.database.getSetting<unknown>(SETTINGS_KEY))
  }

  read(projectRoot: string) {
    return this.state()[canonical(projectRoot)] ?? null
  }

  write(projectRoot: string, trustLevel: 'trusted' | 'untrusted') {
    this.database.setSetting(SETTINGS_KEY, {
      ...this.state(),
      [canonical(projectRoot)]: trustLevel,
    })
  }

  import(entries: ProjectTrustState) {
    const existing = this.state()
    const imported = Object.fromEntries(
      Object.entries(entries).map(([projectRoot, trustLevel]) => [
        canonical(projectRoot),
        trustLevel,
      ]),
    )
    this.database.setSetting(SETTINGS_KEY, { ...imported, ...existing })
  }
}
