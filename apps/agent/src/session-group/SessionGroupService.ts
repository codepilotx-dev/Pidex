import { basename } from 'node:path'
import { Effect } from 'effect'
import { diffLines } from 'diff'
import { AgentError, type EventEnvelope, type TurnStatus } from '../Domain'
import type {
  SessionGroupChangedFile,
  SessionGroupContextChange,
  SessionGroup,
  SessionGroupStepStatus,
  SessionGroupValidation,
} from '@pidex/shared/session-group'
import { secretScrubber } from '../security/SecretScrubber'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { EventHub } from '../storage/events/EventHub'

const terminalOrPauseStatus = (status: TurnStatus): SessionGroupStepStatus | null => {
  if (
    status === 'waiting_permission' ||
    status === 'waiting_question' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'interrupted' ||
    status === 'cancelled'
  )
    return status
  return null
}

const lineChangeSummary = (before: string | null, after: string | null) => {
  let additions = 0
  let deletions = 0
  for (const part of diffLines(before ?? '', after ?? '')) {
    if (part.added) additions += part.count ?? 0
    if (part.removed) deletions += part.count ?? 0
  }
  return { additions, deletions }
}
const safeText = (value: string, limit: number) =>
  secretScrubber
    .scrubText(value)
    .replace(/[A-Za-z]:\\[^\s<>"']+/g, '[ABSOLUTE_PATH_REDACTED]')
    .slice(0, limit)

export class SessionGroupService {
  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
  ) {}

  private repository() {
    return this.db.repositories.sessionGroups
  }

  private requireGroup(groupId: string) {
    const group = this.repository().read(groupId)
    if (!group) throw new AgentError('SESSION_GROUP_NOT_FOUND', '会话组不存在', 404)
    return group
  }

  private changedEvent(
    groupId: string,
    reason: string,
    input: { threadId?: string; stepId?: string } = {},
  ) {
    const group = this.repository().read(groupId)
    return this.db.insertEvent(input.threadId ?? null, null, 'workflow/changed', {
      workflowId: groupId,
      reason,
      ...input,
      revision: group?.version ?? 0,
      changedAt: Date.now(),
    })
  }

  private async publishStored(events: readonly EventEnvelope[]) {
    for (const event of events) await Effect.runPromise(this.hub.publish(event))
  }

  private refreshDerivedContext(
    groupId: string,
    step: import('@pidex/shared/session-group').SessionGroupStep,
  ) {
    const recent = this.repository().listSteps(groupId, 10).reverse()
    const digest = recent
      .map((item) => {
        const files = item.changedFiles
          .slice(0, 8)
          .map((file) => `${file.workspaceLabel}:${file.path}`)
          .join('、')
        const validation = item.validations
          .slice(0, 4)
          .map((value) => `${value.name}:${value.status}`)
          .join('、')
        return `#${item.sequence} [${item.workspaceLabel}/${item.status}] ${item.summary}${files ? `；修改 ${files}` : ''}${validation ? `；验证 ${validation}` : ''}`
      })
      .join('\n')
      .slice(0, 6000)
    const timestamp = Date.now()
    this.db.sqlite
      .query(
        `
      UPDATE session_group_context_state
      SET digest = ?, summarized_through_sequence = ?, context_revision = context_revision + 1, updated_at = ?
      WHERE group_id = ?
    `,
      )
      .run(digest, step.sequence, timestamp, groupId)

    const entries: Array<{
      section: 'progress' | 'validation' | 'risk' | 'fix'
      title: string
      content: string
    }> = []
    if (step.status === 'failed' || step.status === 'interrupted' || step.status === 'cancelled') {
      entries.push({
        section: 'risk',
        title: `步骤 #${step.sequence} 未完成`,
        content: step.failure?.message ?? step.summary,
      })
    } else if (step.status === 'completed') {
      const priorFailure = this.db.sqlite
        .query(
          "SELECT 1 FROM session_group_steps WHERE group_id = ? AND sequence < ? AND status IN ('failed','interrupted') LIMIT 1",
        )
        .get(groupId, step.sequence)
      entries.push({
        section: priorFailure ? 'fix' : 'progress',
        title: `步骤 #${step.sequence} 已完成`,
        content: step.summary,
      })
    }
    if (step.validations.length > 0) {
      entries.push({
        section: 'validation',
        title: `步骤 #${step.sequence} 验证`,
        content: step.validations
          .map(
            (value) =>
              `${value.name}：${value.status}${value.summary ? `（${value.summary}）` : ''}`,
          )
          .join('；'),
      })
    }
    for (const entry of entries) {
      const id = `${step.id}:${entry.section}`
      this.db.sqlite
        .query(
          `
        INSERT INTO session_group_context_entries
          (id, group_id, section, title, content, status, source_thread_id, source_turn_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, content = excluded.content,
          status = 'active', version = session_group_context_entries.version + 1, updated_at = excluded.updated_at
      `,
        )
        .run(
          id,
          groupId,
          entry.section,
          safeText(entry.title, 120),
          safeText(entry.content, 2000),
          step.sourceThreadId,
          step.sourceTurnId,
          timestamp,
          timestamp,
        )
    }
  }

  list() {
    return { groups: this.repository().list(), nextCursor: null }
  }

  read(groupId: string) {
    const group = this.requireGroup(groupId)
    const members = this.repository().members(groupId) as Array<{
      threadId: string
      joinedAt: number
    }>
    return {
      group,
      memberships: members.map((member) => ({
        groupId,
        threadId: member.threadId,
        joinedAt: member.joinedAt,
      })),
    }
  }

  async create(input: {
    name: string
    description?: string
    operationId: string
  }): Promise<{ group: SessionGroup }> {
    const name = input.name.trim()
    const description = input.description?.trim() ?? ''
    if (!name || name.length > 120 || description.length > 4000)
      throw new AgentError('INVALID_REQUEST', '会话组名称或描述无效', 400)
    const request = { name, description }
    const replay = this.repository().completedOperation(
      input.operationId,
      'session-group/create',
      request,
    )
    if (replay) {
      if (!replay.matches)
        throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已用于其他请求', 409)
      return replay.result as { group: SessionGroup }
    }
    const { result, event } = this.db.transaction(() => {
      const group = this.repository().create(request)
      const value = { group }
      this.repository().recordOperation(input.operationId, 'session-group/create', request, value)
      return { result: value, event: this.changedEvent(group.id, 'created') }
    })
    await this.publishStored([event])
    return result
  }

  async update(input: {
    groupId: string
    expectedVersion: number
    name?: string
    description?: string
    operationId: string
  }) {
    this.requireGroup(input.groupId)
    const request = {
      groupId: input.groupId,
      expectedVersion: input.expectedVersion,
      name: input.name?.trim(),
      description: input.description?.trim(),
    }
    const replay = this.repository().completedOperation(
      input.operationId,
      'session-group/update',
      request,
    )
    if (replay) {
      if (!replay.matches)
        throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已用于其他请求', 409)
      return replay.result
    }
    const { result, event } = this.db.transaction(() => {
      const group = this.repository().update(input.groupId, {
        expectedVersion: input.expectedVersion,
        ...(request.name !== undefined ? { name: request.name } : {}),
        ...(request.description !== undefined ? { description: request.description } : {}),
      })
      if (!group) throw new AgentError('CONFLICT', '会话组已被更新，请刷新后重试', 409)
      const value = { group }
      this.repository().recordOperation(input.operationId, 'session-group/update', request, value)
      return { result: value, event: this.changedEvent(input.groupId, 'updated') }
    })
    await this.publishStored([event])
    return result
  }

  async delete(input: { groupId: string; expectedVersion?: number; operationId: string }) {
    const group = this.requireGroup(input.groupId)
    if (input.expectedVersion !== undefined && input.expectedVersion !== group.version)
      throw new AgentError('CONFLICT', '会话组已被更新，请刷新后重试', 409)
    const request = { groupId: input.groupId, expectedVersion: input.expectedVersion ?? null }
    const replay = this.repository().completedOperation(
      input.operationId,
      'session-group/delete',
      request,
    )
    if (replay) {
      if (!replay.matches)
        throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已用于其他请求', 409)
      return replay.result
    }
    const event = this.db.transaction(() => {
      const stored = this.db.insertEvent(null, null, 'workflow/changed', {
        workflowId: input.groupId,
        reason: 'deleted',
        revision: group.version + 1,
        changedAt: Date.now(),
      })
      this.repository().recordOperation(input.operationId, 'session-group/delete', request, {
        groupId: input.groupId,
        deletedAt: stored.createdAt,
      })
      this.repository().delete(input.groupId)
      return stored
    })
    await Effect.runPromise(this.hub.publish(event))
    return { groupId: input.groupId, deletedAt: event.createdAt }
  }

  async setMembership(input: { threadId: string; groupId: string | null; operationId: string }) {
    if (!this.db.getThread(input.threadId))
      throw new AgentError('THREAD_NOT_FOUND', '会话不存在', 404)
    if (input.groupId) this.requireGroup(input.groupId)
    const busy = this.db.sqlite
      .query(
        `
      SELECT 1 FROM turns WHERE thread_id = ? AND status IN ('queued','running','waiting_permission','waiting_question','waiting_subagents') LIMIT 1
    `,
      )
      .get(input.threadId)
    if (busy)
      throw new AgentError('SESSION_GROUP_THREAD_BUSY', '当前 Turn 结束后才可切换会话组', 409)
    const request = { threadId: input.threadId, groupId: input.groupId }
    const replay = this.repository().completedOperation(
      input.operationId,
      'session-group/membership/set',
      request,
    )
    if (replay) {
      if (!replay.matches)
        throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已用于其他请求', 409)
      return replay.result
    }
    const previous = this.repository().membership(input.threadId)?.group_id ?? null
    const { result, events } = this.db.transaction(() => {
      const membership = this.repository().setMembership(input.threadId, input.groupId)
      const value = { membership }
      this.repository().recordOperation(
        input.operationId,
        'session-group/membership/set',
        request,
        value,
      )
      const stored: EventEnvelope[] = []
      if (previous)
        stored.push(this.changedEvent(previous, 'membership_changed', { threadId: input.threadId }))
      if (input.groupId && input.groupId !== previous)
        stored.push(
          this.changedEvent(input.groupId, 'membership_changed', { threadId: input.threadId }),
        )
      return { result: value, events: stored }
    })
    await this.publishStored(events)
    return result
  }

  listSteps(groupId: string, limit?: number) {
    this.requireGroup(groupId)
    return {
      steps: this.repository().listSteps(groupId, Math.min(500, Math.max(1, limit ?? 200))),
      nextCursor: null,
    }
  }

  context(
    groupId: string,
    sections?: readonly import('@pidex/shared/session-group').SessionGroupContextSection[],
  ) {
    this.requireGroup(groupId)
    const context = this.repository().context(groupId)!
    return sections?.length
      ? { ...context, entries: context.entries.filter((entry) => sections.includes(entry.section)) }
      : context
  }

  async updateContext(input: {
    groupId: string
    digest?: string
    entries?: readonly {
      section: import('@pidex/shared/session-group').SessionGroupContextSection
      title: string
      content: string
    }[]
  }) {
    this.requireGroup(input.groupId)
    if (input.digest && input.digest.length > 6000)
      throw new AgentError('INVALID_REQUEST', '会话组摘要过长', 400)
    const { context, event } = this.db.transaction(() => ({
      context: this.repository().updateContext(input.groupId, input),
      event: this.changedEvent(input.groupId, 'context_changed'),
    }))
    await this.publishStored([event])
    return context!
  }

  async applyContextChanges(input: {
    groupId: string
    expectedContextRevision: number
    changes: readonly SessionGroupContextChange[]
    operationId: string
  }) {
    this.requireGroup(input.groupId)
    const request = {
      groupId: input.groupId,
      expectedContextRevision: input.expectedContextRevision,
      changes: input.changes,
    }
    const replay = this.repository().completedOperation(
      input.operationId,
      'session-group/context/update',
      request,
    )
    if (replay) {
      if (!replay.matches)
        throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已用于其他请求', 409)
      return replay.result
    }
    const { result, event } = this.db.transaction(() => {
      const current = this.repository().context(input.groupId)!
      if (current.state.contextRevision !== input.expectedContextRevision) {
        throw new AgentError(
          'SESSION_GROUP_CONTEXT_REVISION_CONFLICT',
          '会话组上下文已更新，请刷新后重试',
          409,
        )
      }
      const timestamp = Date.now()
      for (const change of input.changes) {
        if (change.op === 'add') {
          this.db.sqlite
            .query(
              `
            INSERT INTO session_group_context_entries
              (id, group_id, section, title, content, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
          `,
            )
            .run(
              crypto.randomUUID(),
              input.groupId,
              change.section,
              change.title,
              change.content,
              timestamp,
              timestamp,
            )
          continue
        }
        const entry = this.db.sqlite
          .query(
            'SELECT id, version, section FROM session_group_context_entries WHERE id = ? AND group_id = ?',
          )
          .get(change.entryId, input.groupId) as {
          id: string
          version: number
          section: string
        } | null
        if (!entry)
          throw new AgentError(
            'SESSION_GROUP_CONTEXT_ENTRY_NOT_FOUND',
            '会话组上下文条目不存在',
            404,
          )
        if (entry.version !== change.expectedEntryVersion)
          throw new AgentError('CONFLICT', '会话组上下文条目已更新', 409)
        if (change.op === 'retire') {
          this.db.sqlite
            .query(
              "UPDATE session_group_context_entries SET status = 'retired', version = version + 1, updated_at = ? WHERE id = ?",
            )
            .run(timestamp, entry.id)
          continue
        }
        const replacementId = crypto.randomUUID()
        this.db.sqlite
          .query(
            "UPDATE session_group_context_entries SET status = 'superseded', version = version + 1, updated_at = ? WHERE id = ?",
          )
          .run(timestamp, entry.id)
        this.db.sqlite
          .query(
            `
          INSERT INTO session_group_context_entries
            (id, group_id, section, title, content, status, supersedes_entry_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
        `,
          )
          .run(
            replacementId,
            input.groupId,
            entry.section,
            change.title,
            change.content,
            entry.id,
            timestamp,
            timestamp,
          )
      }
      this.db.sqlite
        .query(
          'UPDATE session_group_context_state SET context_revision = context_revision + 1, updated_at = ? WHERE group_id = ?',
        )
        .run(timestamp, input.groupId)
      const value = this.repository().context(input.groupId)!
      this.repository().recordOperation(
        input.operationId,
        'session-group/context/update',
        request,
        value,
      )
      return { result: value, event: this.changedEvent(input.groupId, 'context_changed') }
    })
    await this.publishStored([event])
    return result
  }

  diffSource(input: { groupId: string; stepId: string; path?: string }) {
    const step = this.repository().step(input.groupId, input.stepId)
    if (!step) throw new AgentError('SESSION_GROUP_STEP_NOT_FOUND', '会话组步骤不存在', 404)
    if (!step.sourceThreadId)
      throw new AgentError('CHECKPOINT_UNAVAILABLE', '来源会话已删除，无法显示精确 Diff', 409)
    const changed = input.path
      ? step.changedFiles.find((file) => file.path === input.path)
      : step.changedFiles[0]
    if (!changed) throw new AgentError('CHECKPOINT_UNAVAILABLE', '该步骤没有可显示的文件证据', 409)
    const batch = this.db.repositories.turnPatches
      .batches(step.sourceTurnId)
      .find((candidate) => candidate.files.some((file) => file.path === changed.path))
    if (!batch) throw new AgentError('CHECKPOINT_UNAVAILABLE', '该步骤缺少可显示的文件证据', 409)
    return {
      threadID: step.sourceThreadId,
      toolCallID: batch.toolCallID,
      path: changed.path,
      workspaceLabel: changed.workspaceLabel,
      step,
    }
  }

  promptForThread(threadId: string) {
    const membership = this.repository().membership(threadId)
    if (!membership) return null
    const group = this.repository().read(membership.group_id)
    const context = this.repository().context(membership.group_id)
    if (!group || !context) return null
    const all = this.repository().listSteps(membership.group_id, 11)
    const recent = all.slice(0, 10).reverse()
    const rawStepText = recent
      .map((step) => {
        const files = step.changedFiles
          .slice(0, 12)
          .map((file) => `${file.workspaceLabel}:${file.path}`)
          .join('、')
        return `- [${step.workspaceLabel}/${step.sourceThreadTitle}/${step.status}] ${step.summary}${files ? `\n  修改：${files}` : ''}${step.failure ? `\n  失败：${step.failure.message}` : ''}`
      })
      .join('\n')
    const prefix = `<session_group_context group_id="${group.id}" context_revision="${context.state.contextRevision}" latest_sequence="${all[0]?.sequence ?? 0}">\n会话组：${group.name}\n${group.description}\n`
    const suffix =
      '\n详细证据按需读取；精确文件差异使用 session_group_step_diff。\n</session_group_context>'
    const available = Math.max(0, 12_000 - prefix.length - suffix.length)
    const digest = context.state.digest.slice(0, Math.min(6_000, available))
    const stepBudget = Math.max(
      0,
      Math.min(6_000, available - digest.length - '\n最近步骤：\n'.length),
    )
    const stepText =
      rawStepText.length > stepBudget
        ? `${rawStepText.slice(0, Math.max(0, stepBudget - 18))}\n…更多步骤请按需读取。`
        : rawStepText
    return `${prefix}${digest}\n最近步骤：\n${stepText}${suffix}`
  }

  async recoverMissingSteps() {
    const rows = this.db.sqlite
      .query(
        `
      SELECT turns.thread_id AS threadId, turns.id AS turnId, turns.status
      FROM turns
      JOIN session_group_memberships memberships ON memberships.thread_id = turns.thread_id
      LEFT JOIN session_group_steps steps ON steps.source_turn_id = turns.id
      WHERE steps.id IS NULL
        AND turns.created_at >= memberships.joined_at
        AND turns.status IN ('waiting_permission','waiting_question','completed','failed','interrupted','cancelled')
      ORDER BY turns.created_at, turns.id
    `,
      )
      .all() as Array<{ threadId: string; turnId: string; status: TurnStatus }>
    for (const row of rows) await this.captureTurn(row).catch(() => undefined)
  }

  async captureTurn(input: {
    threadId: string
    turnId: string
    status: TurnStatus
    summary?: string
    failure?: string
  }) {
    const status = terminalOrPauseStatus(input.status)
    if (!status) return null
    const membership = this.repository().membership(input.threadId)
    if (!membership) return null
    const joinedBoundary = this.db.sqlite
      .query('SELECT created_at FROM turns WHERE id = ? AND thread_id = ?')
      .get(input.turnId, input.threadId) as { created_at: number } | null
    if (!joinedBoundary || joinedBoundary.created_at < membership.joined_at) return null
    const thread = this.db.sqlite
      .query('SELECT title, project_id, workspace_cwd FROM threads WHERE id = ?')
      .get(input.threadId) as {
      title: string
      project_id: string | null
      workspace_cwd: string
    } | null
    if (!thread) return null
    const workspaceLabel = thread.project_id
      ? (this.db.getProject(thread.project_id)?.name ?? basename(thread.workspace_cwd))
      : '无项目'
    const changedFiles: SessionGroupChangedFile[] = []
    for (const batch of this.db.repositories.turnPatches.batches(input.turnId)) {
      for (const file of batch.files)
        changedFiles.push({
          ...lineChangeSummary(file.beforeContent, file.afterContent),
          workspaceLabel,
          path: file.path,
          operation: file.operation,
          oldPath: null,
          evidence: 'turn_patch',
        })
    }
    const items = this.db.sqlite
      .query('SELECT type, status, data FROM items WHERE turn_id = ? ORDER BY ordinal, created_at')
      .all(input.turnId) as Array<{ type: string; status: string; data: string }>
    const toolItems = items.flatMap((item) => {
      if (item.type !== 'tool') return []
      try {
        const data = JSON.parse(item.data) as Record<string, unknown>
        const title =
          typeof data.title === 'string'
            ? data.title
            : typeof data.tool === 'string'
              ? data.tool
              : '工具步骤'
        return [{ title: safeText(title, 500), status: item.status }]
      } catch {
        return [{ title: '工具步骤', status: item.status }]
      }
    })
    const validations: SessionGroupValidation[] = toolItems.flatMap((item) => {
      const title = item.title
      if (!/(test|typecheck|build|lint|check|测试|构建|检查)/i.test(title)) return []
      return [
        {
          name: safeText(title, 500),
          status: item.status === 'completed' ? ('passed' as const) : ('failed' as const),
          summary: '',
        },
      ]
    })
    const checkpoints = toolItems.map((item, ordinal) => ({
      ordinal,
      kind: 'tool' as const,
      summary: item.title,
      status:
        item.status === 'completed'
          ? ('completed' as const)
          : item.status === 'failed'
            ? ('failed' as const)
            : ('pending' as const),
    }))
    if (
      checkpoints.length === 0 &&
      (status === 'waiting_permission' || status === 'waiting_question')
    ) {
      checkpoints.push({
        ordinal: 0,
        kind: 'tool',
        summary: '本轮正在等待用户处理。',
        status: 'pending',
      })
    }
    const failedTool = [...toolItems].reverse().find((item) => item.status === 'failed')
    const fallback =
      status === 'completed'
        ? '本轮已完成。'
        : status === 'failed'
          ? '本轮执行失败。'
          : status === 'interrupted'
            ? '本轮已中断。'
            : status === 'cancelled'
              ? '本轮已取消。'
              : '本轮正在等待用户处理。'
    const { step, event } = this.db.transaction(() => {
      const step = this.repository().upsertStep({
        groupId: membership.group_id,
        sourceThreadId: input.threadId,
        sourceThreadTitle: thread.title,
        sourceTurnId: input.turnId,
        projectId: thread.project_id,
        workspaceLabel,
        status,
        summary: safeText(input.summary?.trim() || fallback, 8000),
        checkpoints,
        changedFiles,
        validations,
        failure: input.failure
          ? {
              stage: failedTool?.title ?? 'turn',
              code: null,
              message: safeText(input.failure, 1000),
              retryable: false,
            }
          : null,
      })
      this.refreshDerivedContext(membership.group_id, step)
      return {
        step,
        event: this.changedEvent(membership.group_id, 'step_changed', {
          threadId: input.threadId,
          stepId: step.id,
        }),
      }
    })
    await this.publishStored([event])
    return step
  }
}
