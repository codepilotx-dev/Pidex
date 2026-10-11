import type { Database } from 'bun:sqlite'

/**
 * 集中缓存 history 库中 `threads` 表的可选列能力。
 *
 * 设计目标：
 * - 仅做只读 PRAGMA 探测；不动 user_version、不 ALTER、不删字段。
 * - 同一 Database 实例上的结果按对象身份缓存，避免每次 SELECT/INSERT 都查 PRAGMA。
 * - 提供给 ThreadRepository、ThreadProjection、initialize 处理器复用，
 *   保证 list/snapshot/create 路径对缺失列采取兼容 SQL（`NULL AS ...` / 不写列）。
 */
export type ThreadsStorageCapabilities = {
  creationSurface: boolean
  projectlessOwner: boolean
}

export type ArtifactsStorageCapabilities = {
  itemArtifactsTable: boolean
}

export type RuntimeCompositionStorageCapabilities = {
  runtimeCompositionPlans: boolean
}

export type AutomationStorageCapabilities = {
  automations: boolean
  automationRuns: boolean
}

export type ScheduleCalendarStorageCapabilities = {
  scheduledTasks: boolean
  schedulePlanProposals: boolean
}

const cache = new WeakMap<Database, ThreadsStorageCapabilities>()

const artifactsCache = new WeakMap<Database, ArtifactsStorageCapabilities>()

const runtimeCompositionCache = new WeakMap<Database, RuntimeCompositionStorageCapabilities>()

const automationCache = new WeakMap<Database, AutomationStorageCapabilities>()

const scheduleCalendarCache = new WeakMap<Database, ScheduleCalendarStorageCapabilities>()

export function probeThreadsStorageCapabilities(sqlite: Database): ThreadsStorageCapabilities {
  const cached = cache.get(sqlite)
  if (cached) return cached
  const rows = sqlite.query('PRAGMA table_info(threads)').all() as Array<{ name: string }>
  const capabilities: ThreadsStorageCapabilities = {
    creationSurface: rows.some((column) => column.name === 'creation_surface'),
    projectlessOwner: rows.some((column) => column.name === 'workspace_owner_thread_id'),
  }
  cache.set(sqlite, capabilities)
  return capabilities
}

/**
 * Read-only probe for the additive `item_artifacts` table. Older stores without
 * the table keep their user_version and unknown rows untouched; the caller
 * downgrades the advertised artifact capability instead of altering storage.
 */
export function probeArtifactsStorageCapabilities(sqlite: Database): ArtifactsStorageCapabilities {
  const cached = artifactsCache.get(sqlite)
  if (cached) return cached
  const capabilities: ArtifactsStorageCapabilities = {
    itemArtifactsTable: Boolean(
      sqlite
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'item_artifacts'")
        .get(),
    ),
  }
  artifactsCache.set(sqlite, capabilities)
  return capabilities
}

/**
 * Read-only probe for the additive `runtime_composition_plans` table. Older
 * stores without the table fall back to ephemeral composition; the caller must
 * not migrate data into the table or assume the schema exists.
 */
export function probeRuntimeCompositionStorageCapabilities(
  sqlite: Database,
): RuntimeCompositionStorageCapabilities {
  const cached = runtimeCompositionCache.get(sqlite)
  if (cached) return cached
  const capabilities: RuntimeCompositionStorageCapabilities = {
    runtimeCompositionPlans: Boolean(
      sqlite
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runtime_composition_plans'",
        )
        .get(),
    ),
  }
  runtimeCompositionCache.set(sqlite, capabilities)
  return capabilities
}

/** Read-only probe for the additive schema 42 automation tables. */
export function probeAutomationStorageCapabilities(
  sqlite: Database,
): AutomationStorageCapabilities {
  const cached = automationCache.get(sqlite)
  if (cached) return cached
  const names = new Set(
    (
      sqlite
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('automations','automation_runs')",
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name),
  )
  const capabilities = {
    automations: names.has('automations'),
    automationRuns: names.has('automation_runs'),
  }
  automationCache.set(sqlite, capabilities)
  return capabilities
}

/** Read-only probe for the additive schema 43 schedule-calendar tables. */
export function probeScheduleCalendarStorageCapabilities(
  sqlite: Database,
): ScheduleCalendarStorageCapabilities {
  const cached = scheduleCalendarCache.get(sqlite)
  if (cached) return cached
  const names = new Set(
    (
      sqlite
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('scheduled_tasks','schedule_plan_proposals')",
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name),
  )
  const capabilities = {
    scheduledTasks: names.has('scheduled_tasks'),
    schedulePlanProposals: names.has('schedule_plan_proposals'),
  }
  scheduleCalendarCache.set(sqlite, capabilities)
  return capabilities
}
