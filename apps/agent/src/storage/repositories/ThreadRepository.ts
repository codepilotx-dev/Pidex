import { resolve } from 'node:path'
import {
  DEFAULT_PERMISSION_CONFIG,
  decodeApprovalPolicy,
  encodeApprovalPolicy,
  type ThreadCreationSurface,
  type ThreadSettings,
  type ThreadSettingsPatch,
} from '@pidex/shared/thread'
import { AgentError } from '../../Domain'
import { probeThreadsStorageCapabilities } from '../database/StorageCapabilities'
import type {
  EventEnvelope,
  Item,
  PermissionConfig,
  TaskMode,
  ThreadSnapshot,
  TurnStatus,
} from '../../Domain'

/** Shared by list and detail projections; the outer threads table uses alias t. */
export const THREAD_ORIGIN_PROJECTION_SQL = `
  COALESCE(t.create_operation_id GLOB 'automation-run:*:thread', 0) AS is_scheduled_session,
  (EXISTS (SELECT 1 FROM scheduled_tasks WHERE thread_id = t.id)
    OR EXISTS (SELECT 1 FROM automation_runs WHERE thread_id = t.id)) AS has_scheduled_run,
  (EXISTS (SELECT 1 FROM thread_message_forks WHERE target_thread_id = t.id)
    OR EXISTS (SELECT 1 FROM thread_forks WHERE target_thread_id = t.id)) AS is_fork
`

export type StoredThreadWorkspace =
  | {
      kind: 'project'
      projectID: string
      cwd: string
      runtimeWorkspaceRoots: Array<{
        folderId: string
        path: string
        role: 'primary' | 'secondary'
      }>
      instructionSources: string[]
      outputDirectory: null
    }
  | {
      kind: 'projectless'
      projectID: null
      workspaceRoot: string
      cwd: string
      outputDirectory: string
    }

export type CreateThreadInput = {
  id?: string
  title?: string | undefined
  creationSurface?: ThreadCreationSurface | undefined
  settings?: ThreadSettings | undefined
  workspace?:
    | { kind: 'project'; projectID: string }
    | { kind: 'projectless'; workspaceRoot: string; cwd: string; outputDirectory: string }
    | null
  operationID?: string | undefined
  requestHash?: string | undefined
}

export type CreatedThreadRecord = {
  id: string
  title: string
  projectID: string | null
  gitBranch: string | null
  creationSurface?: ThreadCreationSurface
  workspace: StoredThreadWorkspace | null
  settings: ThreadSettings
  createdAt: number
  updatedAt: number
  event: EventEnvelope
}

export type AutomaticTitleCandidate = {
  title: string
  kind: string
  messageCount: number
  projectID: string | null
}

export type ThreadTitleTurnContext = {
  turnID: string
  userContent: string
  assistantContent: string
}

export type ThreadTitleRegenerationContext = AutomaticTitleCandidate & {
  latestTurnID: string | null
  latestTurnStatus: TurnStatus | null
  firstUserContent: string
  recentCompletedTurns: ThreadTitleTurnContext[]
}

type PermissionColumns = {
  sandbox_mode: PermissionConfig['sandboxMode']
  approval_policy: string
  approvals_reviewer: PermissionConfig['approvalsReviewer']
}

type ThreadSettingsColumns = PermissionColumns & {
  task_mode: TaskMode
}

const permissionConfigFromRow = (row: PermissionColumns): PermissionConfig => ({
  sandboxMode: row.sandbox_mode,
  approvalPolicy: decodeApprovalPolicy(row.approval_policy),
  approvalsReviewer: row.approvals_reviewer,
})

const threadSettingsFromRow = (row: ThreadSettingsColumns): ThreadSettings => ({
  taskMode: row.task_mode,
  permissionConfig: permissionConfigFromRow(row),
})

const defaultThreadSettings = (): ThreadSettings => ({
  taskMode: 'chat',
  permissionConfig: { ...DEFAULT_PERMISSION_CONFIG },
})

import { RepositoryCore, containedPath, now, parse, stringify } from './RepositoryCore'

export abstract class ThreadRepositoryDatabase extends RepositoryCore {
  markThreadUnread(threadID: string, unreadAt: number) {
    this.sqlite
      .query(
        `
        INSERT INTO thread_read_state (thread_id, read_at, unread_at, updated_at)
        VALUES (?, 0, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          unread_at = MAX(COALESCE(thread_read_state.unread_at, 0), excluded.unread_at),
          updated_at = MAX(thread_read_state.updated_at, excluded.updated_at)
      `,
      )
      .run(threadID, unreadAt, unreadAt)
  }

  markThreadReadThrough(threadID: string, readThroughAt: number) {
    this.sqlite
      .query(
        `
        INSERT INTO thread_read_state (thread_id, read_at, unread_at, updated_at)
        VALUES (?, ?, NULL, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          read_at = MAX(thread_read_state.read_at, excluded.read_at),
          unread_at = CASE
            WHEN thread_read_state.unread_at <= excluded.read_at THEN NULL
            ELSE thread_read_state.unread_at
          END,
          updated_at = MAX(thread_read_state.updated_at, excluded.updated_at)
      `,
      )
      .run(threadID, readThroughAt, readThroughAt)
  }

  getThreadSettings(threadID: string): ThreadSettings | null {
    const row = this.sqlite
      .query(
        'SELECT task_mode, sandbox_mode, approval_policy, approvals_reviewer FROM threads WHERE id = ?',
      )
      .get(threadID) as ThreadSettingsColumns | null
    return row ? threadSettingsFromRow(row) : null
  }

  protected syncThreadSettings(threadID: string, patch: ThreadSettingsPatch) {
    const existing = this.getThreadSettings(threadID)
    if (!existing) throw new Error('Thread not found')
    const settings: ThreadSettings = {
      taskMode: patch.taskMode ?? existing.taskMode,
      permissionConfig: patch.permissionConfig ?? existing.permissionConfig,
    }
    const unchanged =
      settings.taskMode === existing.taskMode &&
      settings.permissionConfig.sandboxMode === existing.permissionConfig.sandboxMode &&
      encodeApprovalPolicy(settings.permissionConfig.approvalPolicy) ===
        encodeApprovalPolicy(existing.permissionConfig.approvalPolicy) &&
      settings.permissionConfig.approvalsReviewer === existing.permissionConfig.approvalsReviewer
    if (unchanged) return { settings, event: null }
    this.sqlite
      .query(
        `
        UPDATE threads
        SET task_mode = ?, sandbox_mode = ?, approval_policy = ?, approvals_reviewer = ?
        WHERE id = ?
      `,
      )
      .run(
        settings.taskMode,
        settings.permissionConfig.sandboxMode,
        encodeApprovalPolicy(settings.permissionConfig.approvalPolicy),
        settings.permissionConfig.approvalsReviewer,
        threadID,
      )
    const event = this.insertEvent(threadID, null, 'thread/settings/updated', {
      threadId: threadID,
      settings,
    })
    return { settings, event }
  }

  updateThreadSettings(threadID: string, patch: ThreadSettingsPatch) {
    return this.transaction(() => {
      const result = this.syncThreadSettings(threadID, patch)
      const thread = this.getThread(threadID)
      if (!thread) throw new Error('Thread not found')
      return { ...result, version: thread.updatedAt }
    })
  }

  getThreadPromptSettings<T extends Record<string, unknown> = Record<string, unknown>>(
    threadID: string,
  ): T | null {
    const row = this.sqlite
      .query('SELECT prompt_settings FROM threads WHERE id = ?')
      .get(threadID) as { prompt_settings: string } | null
    return row ? parse<T>(row.prompt_settings) : null
  }

  saveThreadPromptSettings<T extends Record<string, unknown>>(threadID: string, settings: T) {
    return this.transaction(() => {
      const timestamp = now()
      const updated = this.sqlite
        .query('UPDATE threads SET prompt_settings = ?, updated_at = ? WHERE id = ?')
        .run(stringify(settings), timestamp, threadID)
      if (!updated.changes) throw new Error(`Thread ${threadID} 不存在`)
      const event = this.insertEvent(threadID, null, 'thread/prompt-settings/updated', {
        threadId: threadID,
        updatedAt: timestamp,
      })
      return { settings, event }
    })
  }

  createThread(input: CreateThreadInput): CreatedThreadRecord

  createThread(
    title?: string,
    projectID?: string,
    initialSettings?: ThreadSettings,
  ): CreatedThreadRecord

  createThread(
    inputOrTitle: CreateThreadInput | string = '新对话',
    legacyProjectID?: string,
    legacySettings?: ThreadSettings,
  ) {
    const input: CreateThreadInput | null = typeof inputOrTitle === 'object' ? inputOrTitle : null
    const id = input?.id ?? crypto.randomUUID()
    const title = input?.title ?? (typeof inputOrTitle === 'string' ? inputOrTitle : '新对话')
    const initialSettings = input?.settings ?? legacySettings
    const workspace =
      input?.workspace ??
      (legacyProjectID ? { kind: 'project' as const, projectID: legacyProjectID } : null)
    return this.insertThread({
      id,
      title,
      workspace,
      ...(input?.creationSurface ? { creationSurface: input.creationSurface } : {}),
      ...(initialSettings ? { initialSettings } : {}),
      ...(input?.operationID ? { operationID: input.operationID } : {}),
      ...(input?.requestHash ? { requestHash: input.requestHash } : {}),
    })
  }

  private insertThread(input: {
    id: string
    title: string
    creationSurface?: ThreadCreationSurface
    initialSettings?: ThreadSettings
    workspace: CreateThreadInput['workspace'] | null
    operationID?: string
    requestHash?: string
  }): CreatedThreadRecord {
    const { id, title, creationSurface, initialSettings } = input
    const timestamp = now()
    const settings = initialSettings ?? defaultThreadSettings()
    let projectID: string | null = null
    let workspaceKind: 'project' | 'projectless' | 'legacy' = 'legacy'
    let workspaceRoot: string | null = null
    let workspaceCwd: string | null = null
    let workspaceRoots: string | null = null
    let instructionSources: string | null = null
    let outputDirectory: string | null = null
    if (input.workspace?.kind === 'project') {
      const project = this.requireProject(input.workspace.projectID)
      projectID = input.workspace.projectID
      workspaceKind = 'project'
      workspaceCwd = project.rootPath
      workspaceRoots = stringify(
        project.folders.map(({ id: folderId, path, role }) => ({
          folderId,
          path,
          role,
        })),
      )
      instructionSources = '[]'
    } else if (input.workspace?.kind === 'projectless') {
      workspaceRoot = resolve(input.workspace.workspaceRoot)
      workspaceCwd = resolve(input.workspace.cwd)
      outputDirectory = resolve(input.workspace.outputDirectory)
      if (
        !containedPath(workspaceRoot, workspaceCwd) ||
        !containedPath(workspaceRoot, outputDirectory)
      ) {
        throw new AgentError(
          'WORKSPACE_INVALID',
          '无项目会话的 cwd 和输出目录必须位于工作区根目录内',
          400,
        )
      }
      workspaceKind = 'projectless'
    }
    return this.transaction(() => {
      const { creationSurface: columnExists } = probeThreadsStorageCapabilities(this.sqlite)
      // 列缺失时实际可持久化的 creationSurface 必须为 undefined，
      // 避免 INSERT、event payload、返回值投影出未持久化来源。
      const persistedCreationSurface = columnExists ? creationSurface : undefined
      if (columnExists) {
        this.sqlite
          .query(
            `INSERT INTO threads (
            id, title, project_id, workspace_kind, workspace_root, workspace_cwd,
            workspace_roots, instruction_sources, output_directory,
            create_operation_id, create_request_hash,
            task_mode, sandbox_mode, approval_policy, approvals_reviewer, created_at, updated_at, creation_surface
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            title,
            projectID,
            workspaceKind,
            workspaceRoot,
            workspaceCwd,
            workspaceRoots,
            instructionSources,
            outputDirectory,
            input.operationID ?? null,
            input.requestHash ?? null,
            settings.taskMode,
            settings.permissionConfig.sandboxMode,
            encodeApprovalPolicy(settings.permissionConfig.approvalPolicy),
            settings.permissionConfig.approvalsReviewer,
            timestamp,
            timestamp,
            persistedCreationSurface ?? null,
          )
      } else {
        // 历史库缺可选列时仍走原 17 列 INSERT，避免在更高 schema 下写入不存在的列。
        // 防御性边界：即便旧客户端或异常路径把 creationSurface 透传过来，
        // 这里也会在 INSERT / event payload / 返回值三处统一剔除持久化来源，
        // 而不是依赖上层 capability gate。
        this.sqlite
          .query(
            `INSERT INTO threads (
            id, title, project_id, workspace_kind, workspace_root, workspace_cwd,
            workspace_roots, instruction_sources, output_directory,
            create_operation_id, create_request_hash,
            task_mode, sandbox_mode, approval_policy, approvals_reviewer, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            title,
            projectID,
            workspaceKind,
            workspaceRoot,
            workspaceCwd,
            workspaceRoots,
            instructionSources,
            outputDirectory,
            input.operationID ?? null,
            input.requestHash ?? null,
            settings.taskMode,
            settings.permissionConfig.sandboxMode,
            encodeApprovalPolicy(settings.permissionConfig.approvalPolicy),
            settings.permissionConfig.approvalsReviewer,
            timestamp,
            timestamp,
          )
      }
      const persistedWorkspace = this.threadWorkspace(id)
      const event = this.insertEvent(id, null, 'thread/created', {
        thread: {
          id,
          title,
          projectID,
          gitBranch: null,
          ...(persistedCreationSurface ? { creationSurface: persistedCreationSurface } : {}),
          ...(persistedWorkspace ? { workspace: persistedWorkspace } : {}),
          settings,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      })
      return {
        id,
        title,
        projectID,
        gitBranch: null,
        ...(persistedCreationSurface ? { creationSurface: persistedCreationSurface } : {}),
        workspace: persistedWorkspace,
        settings,
        createdAt: timestamp,
        updatedAt: timestamp,
        event,
      }
    })
  }

  getThread(threadID: string): ThreadSnapshot | null {
    const thread = this.sqlite
      .query(
        'SELECT id, title, git_branch, task_mode, sandbox_mode, approval_policy, approvals_reviewer, created_at, updated_at FROM threads WHERE id = ?',
      )
      .get(threadID) as
      | ({
          id: string
          title: string
          git_branch: string | null
          created_at: number
          updated_at: number
        } & ThreadSettingsColumns)
      | null
    if (!thread) return null
    const turns = this.sqlite
      .query(
        'SELECT id, root_agent_id, status, mode, started_at, finished_at FROM turns WHERE thread_id = ? ORDER BY created_at',
      )
      .all(threadID) as Array<{
      id: string
      root_agent_id: string
      status: TurnStatus
      mode: TaskMode
      started_at: number | null
      finished_at: number | null
    }>
    const items = this.sqlite
      .query(
        'SELECT id, turn_id, agent_id, type, status, data, created_at, updated_at FROM items WHERE thread_id = ? ORDER BY created_at',
      )
      .all(threadID) as Array<{
      id: string
      turn_id: string
      agent_id: string
      type: Item['type']
      status: Item['status']
      data: string
      created_at: number
      updated_at: number
    }>
    return {
      id: thread.id,
      title: thread.title,
      gitBranch: thread.git_branch,
      settings: threadSettingsFromRow(thread),
      createdAt: thread.created_at,
      updatedAt: thread.updated_at,
      turns: turns.map((turn) => ({
        id: turn.id,
        rootAgentID: turn.root_agent_id,
        status: turn.status,
        mode: turn.mode,
        startedAt: turn.started_at,
        finishedAt: turn.finished_at,
        items: items
          .filter((item) => item.turn_id === turn.id)
          .map((item) => ({
            id: item.id,
            turnID: item.turn_id,
            agentID: item.agent_id,
            type: item.type,
            status: item.status,
            data: parse<Record<string, unknown>>(item.data),
            createdAt: item.created_at,
            updatedAt: item.updated_at,
          })),
      })),
      agents: turns.flatMap((turn) => {
        const agent = this.getAgentExecution(turn.root_agent_id)
        return agent ? [agent] : []
      }),
    }
  }

  updateThreadGitBranch(threadID: string, gitBranch: string): boolean {
    const normalized = gitBranch.trim()
    if (!normalized) return false
    const result = this.sqlite
      .query(
        `
        UPDATE threads
        SET git_branch = ?
        WHERE id = ? AND (git_branch IS NULL OR git_branch <> ?)
      `,
      )
      .run(normalized, threadID, normalized)
    return result.changes > 0
  }

  automaticTitleCandidate(threadID: string): AutomaticTitleCandidate | null {
    const row = this.sqlite
      .query(
        `
        SELECT title, kind, message_count, project_id
        FROM threads
        WHERE id = ?
      `,
      )
      .get(threadID) as {
      title: string
      kind: string
      message_count: number
      project_id: string | null
    } | null
    return row
      ? {
          title: row.title,
          kind: row.kind,
          messageCount: row.message_count,
          projectID: this.projectMembership(threadID),
        }
      : null
  }

  threadTitleRegenerationContext(
    threadID: string,
    recentTurnLimit = 6,
  ): ThreadTitleRegenerationContext | null {
    const thread = this.automaticTitleCandidate(threadID)
    if (!thread) return null
    const firstUser = this.sqlite
      .query(
        `
        SELECT first_user_message
        FROM threads
        WHERE id = ?
      `,
      )
      .get(threadID) as { first_user_message: string | null } | null
    const latestTurn = this.sqlite
      .query(
        `
        SELECT id, root_agent_id, status
        FROM turns
        WHERE thread_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
      )
      .get(threadID) as {
      id: string
      root_agent_id: string | null
      status: TurnStatus
    } | null
    if (!latestTurn) {
      return {
        ...thread,
        latestTurnID: null,
        latestTurnStatus: null,
        firstUserContent: firstUser?.first_user_message?.trim() ?? '',
        recentCompletedTurns: [],
      }
    }
    const completedTurns = (
      this.sqlite
        .query(
          `
        SELECT id, root_agent_id
        FROM turns
        WHERE thread_id = ? AND status = 'completed'
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `,
        )
        .all(threadID, recentTurnLimit) as Array<{
        id: string
        root_agent_id: string | null
      }>
    ).reverse()
    if (!completedTurns.length) {
      return {
        ...thread,
        latestTurnID: latestTurn.id,
        latestTurnStatus: latestTurn.status,
        firstUserContent: firstUser?.first_user_message?.trim() ?? '',
        recentCompletedTurns: [],
      }
    }
    const turnIDs = completedTurns.map((turn) => turn.id)
    const placeholders = turnIDs.map(() => '?').join(', ')
    const inputs = this.sqlite
      .query(
        `
        SELECT turn_id, content
        FROM inputs
        WHERE thread_id = ? AND turn_id IN (${placeholders})
        ORDER BY turn_id, created_at, id
      `,
      )
      .all(threadID, ...turnIDs) as Array<{ turn_id: string; content: string }>
    const textItems = this.sqlite
      .query(
        `
        SELECT items.turn_id, items.data
        FROM items
        JOIN turns ON turns.id = items.turn_id
        WHERE items.thread_id = ?
          AND items.turn_id IN (${placeholders})
          AND items.agent_id = turns.root_agent_id
          AND items.type = 'text'
          AND items.status = 'completed'
        ORDER BY items.turn_id, items.ordinal, items.created_at, items.id
      `,
      )
      .all(threadID, ...turnIDs) as Array<{ turn_id: string; data: string }>
    const inputsByTurn = new Map<string, string[]>()
    for (const input of inputs) {
      const content = input.content.trim()
      if (!content) continue
      const values = inputsByTurn.get(input.turn_id) ?? []
      values.push(content)
      inputsByTurn.set(input.turn_id, values)
    }
    const resultsByTurn = new Map<string, string[]>()
    for (const item of textItems) {
      try {
        const data = parse<Record<string, unknown>>(item.data)
        if (data.placement !== 'result' || typeof data.text !== 'string' || !data.text.trim()) {
          continue
        }
        const values = resultsByTurn.get(item.turn_id) ?? []
        values.push(data.text.trim())
        resultsByTurn.set(item.turn_id, values)
      } catch {
        continue
      }
    }
    return {
      ...thread,
      latestTurnID: latestTurn.id,
      latestTurnStatus: latestTurn.status,
      firstUserContent: firstUser?.first_user_message?.trim() ?? '',
      recentCompletedTurns: completedTurns.map((turn) => ({
        turnID: turn.id,
        userContent: (inputsByTurn.get(turn.id) ?? []).join('\n\n'),
        assistantContent: (resultsByTurn.get(turn.id) ?? []).join('\n\n'),
      })),
    }
  }

  updateThreadTitleIfCurrent(input: {
    threadID: string
    expectedTitle: string
    nextTitle: string
  }): boolean {
    const result = this.sqlite
      .query(
        `
        UPDATE threads
        SET title = ?
        WHERE id = ? AND title = ?
      `,
      )
      .run(input.nextTitle, input.threadID, input.expectedTitle)
    return result.changes > 0
  }

  activeTurn(threadID: string) {
    return this.sqlite
      .query(
        `SELECT id, status, mode, sandbox_mode, approval_policy, approvals_reviewer, model_ref FROM turns WHERE thread_id = ? AND status IN ('running', 'waiting_permission', 'waiting_question', 'waiting_subagents') ORDER BY created_at DESC LIMIT 1`,
      )
      .get(threadID) as
      | ({ id: string; status: TurnStatus; mode: TaskMode; model_ref: string } & PermissionColumns)
      | null
  }
}

export type ThreadRepository = ThreadRepositoryDatabase
export const threadRepository = (database: ThreadRepositoryDatabase): ThreadRepository => database
