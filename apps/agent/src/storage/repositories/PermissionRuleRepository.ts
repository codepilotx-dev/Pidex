import type { Database } from 'bun:sqlite'
import type { PermissionRuleEffect, PermissionRuleMatch } from '@pidex/shared/thread'
import { AgentError } from '../../Domain'
import type { RepositoryDatabase } from './RepositoryDatabase'

/**
 * Additive permission-rule storage introduced after history schema 64.
 *
 * Chat rules and legacy chat-grant revocations live in their own tables so a
 * newer build can use them while older builds keep their user_version, unknown
 * tables and unknown rows untouched. Nothing here touches legacy
 * `approval_rules` or approval history.
 */
export const PERMISSION_RULES_SCHEMA = [
  `CREATE TABLE permission_chat_rules (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    effect TEXT NOT NULL CHECK(effect IN ('allow','ask','deny')),
    match TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE permission_grant_revocations (
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    rule_id TEXT NOT NULL,
    revoked_at INTEGER NOT NULL,
    PRIMARY KEY(thread_id, rule_id)
  )`,
  'CREATE INDEX permission_chat_rules_thread ON permission_chat_rules(thread_id, created_at)',
] as const

const CHAT_RULES_REQUIRED_COLUMNS = [
  'id',
  'thread_id',
  'effect',
  'match',
  'version',
  'created_at',
  'updated_at',
] as const

const REVOCATIONS_REQUIRED_COLUMNS = ['thread_id', 'rule_id', 'revoked_at'] as const

const tableColumns = (sqlite: Database, table: string): Set<string> =>
  new Set(
    (sqlite.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  )

const parse = <T>(value: string): T => JSON.parse(value) as T
const stringify = (value: unknown) => JSON.stringify(value)

export type StoredPermissionChatRule = {
  id: string
  threadID: string
  effect: PermissionRuleEffect
  match: PermissionRuleMatch
  version: number
  createdAt: number
  updatedAt: number
}

export type PermissionRuleRepositoryDatabase = Pick<RepositoryDatabase, 'sqlite' | 'transaction'>

/** Owns chat-scoped permission rules and legacy chat-grant revocation records. */
export class PermissionRuleRepository {
  constructor(
    private readonly db: PermissionRuleRepositoryDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  private hasTable(name: string): boolean {
    return Boolean(
      this.db.sqlite
        .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(name),
    )
  }

  /** Both additive tables must exist with the columns this build reads and writes. */
  available(): boolean {
    if (!this.hasTable('permission_chat_rules') || !this.hasTable('permission_grant_revocations'))
      return false
    const rules = tableColumns(this.db.sqlite, 'permission_chat_rules')
    const revocations = tableColumns(this.db.sqlite, 'permission_grant_revocations')
    return (
      CHAT_RULES_REQUIRED_COLUMNS.every((column) => rules.has(column)) &&
      REVOCATIONS_REQUIRED_COLUMNS.every((column) => revocations.has(column))
    )
  }

  availableTables(): { chatRules: boolean; revocations: boolean } {
    return {
      chatRules: this.hasTable('permission_chat_rules'),
      revocations: this.hasTable('permission_grant_revocations'),
    }
  }

  listChatRules(threadID: string): StoredPermissionChatRule[] {
    if (!this.hasTable('permission_chat_rules')) return []
    return (
      this.db.sqlite
        .query(
          'SELECT id, thread_id, effect, match, version, created_at, updated_at FROM permission_chat_rules WHERE thread_id = ? ORDER BY created_at, id',
        )
        .all(threadID) as Array<{
        id: string
        thread_id: string
        effect: PermissionRuleEffect
        match: string
        version: number
        created_at: number
        updated_at: number
      }>
    ).map((row) => ({
      id: row.id,
      threadID: row.thread_id,
      effect: row.effect,
      match: parse<PermissionRuleMatch>(row.match),
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  findChatRule(threadID: string, id: string): StoredPermissionChatRule | null {
    return this.listChatRules(threadID).find((rule) => rule.id === id) ?? null
  }

  upsertChatRule(input: {
    threadID: string
    id?: string
    effect: PermissionRuleEffect
    match: PermissionRuleMatch
    expectedVersion?: string
  }): StoredPermissionChatRule {
    if (!this.hasTable('permission_chat_rules'))
      throw new AgentError('CONFLICT', '当前数据库缺少聊天规则存储，请升级或刷新能力', 409)
    const timestamp = this.now()
    if (input.id) {
      const ruleID = input.id
      return this.db.transaction(() => {
        const current = this.db.sqlite
          .query(
            'SELECT id, effect, match, version, created_at, updated_at FROM permission_chat_rules WHERE thread_id = ? AND id = ?',
          )
          .get(input.threadID, ruleID) as {
          id: string
          effect: PermissionRuleEffect
          match: string
          version: number
          created_at: number
          updated_at: number
        } | null
        if (!current) throw new AgentError('CONFLICT', '规则已被删除，请刷新后重试', 409)
        if (input.expectedVersion && String(current.version) !== input.expectedVersion)
          throw new AgentError('CONFLICT', '规则版本已变化，请刷新后重试', 409)
        const nextVersion = current.version + 1
        this.db.sqlite
          .query(
            'UPDATE permission_chat_rules SET effect = ?, match = ?, version = ?, updated_at = ? WHERE thread_id = ? AND id = ?',
          )
          .run(input.effect, stringify(input.match), nextVersion, timestamp, input.threadID, ruleID)
        return {
          id: ruleID,
          threadID: input.threadID,
          effect: input.effect,
          match: input.match,
          version: nextVersion,
          createdAt: current.created_at,
          updatedAt: timestamp,
        }
      })
    }
    return this.db.transaction(() => {
      const id = `permission-rule:${crypto.randomUUID()}`
      this.db.sqlite
        .query(
          'INSERT INTO permission_chat_rules (id, thread_id, effect, match, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
        )
        .run(id, input.threadID, input.effect, stringify(input.match), timestamp, timestamp)
      return {
        id,
        threadID: input.threadID,
        effect: input.effect,
        match: input.match,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    })
  }

  revokeChatRule(threadID: string, id: string, expectedVersion?: string): boolean {
    if (!this.hasTable('permission_chat_rules')) return false
    return this.db.transaction(() => {
      const current = this.db.sqlite
        .query('SELECT version FROM permission_chat_rules WHERE thread_id = ? AND id = ?')
        .get(threadID, id) as { version: number } | null
      if (!current) return false
      if (expectedVersion && String(current.version) !== expectedVersion)
        throw new AgentError('CONFLICT', '规则版本已变化，请刷新后重试', 409)
      return (
        this.db.sqlite
          .query('DELETE FROM permission_chat_rules WHERE thread_id = ? AND id = ?')
          .run(threadID, id).changes > 0
      )
    })
  }

  revokeLegacyGrant(threadID: string, ruleId: string): void {
    if (!this.hasTable('permission_grant_revocations')) return
    this.db.sqlite
      .query(
        'INSERT INTO permission_grant_revocations (thread_id, rule_id, revoked_at) VALUES (?, ?, ?) ON CONFLICT(thread_id, rule_id) DO UPDATE SET revoked_at = excluded.revoked_at',
      )
      .run(threadID, ruleId, this.now())
  }

  /** A freshly approved legacy grant replaces an earlier revocation of the same rule. */
  restoreLegacyGrant(threadID: string, ruleId: string): void {
    if (!this.hasTable('permission_grant_revocations')) return
    this.db.sqlite
      .query('DELETE FROM permission_grant_revocations WHERE thread_id = ? AND rule_id = ?')
      .run(threadID, ruleId)
  }

  revokedLegacyGrantIDs(threadID: string): Set<string> {
    if (!this.hasTable('permission_grant_revocations')) return new Set()
    return new Set(
      (
        this.db.sqlite
          .query('SELECT rule_id FROM permission_grant_revocations WHERE thread_id = ?')
          .all(threadID) as Array<{ rule_id: string }>
      ).map((row) => row.rule_id),
    )
  }
}
