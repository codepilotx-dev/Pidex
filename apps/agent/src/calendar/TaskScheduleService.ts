import { createHash, randomUUID } from 'node:crypto'
import type { RpcParams } from '@pidex/agent-protocol'
import {
  defaultTaskSchedule,
  type TaskSchedule,
  type TaskOccurrence,
} from '@pidex/shared/task-schedule'
import type { ScheduleAutomaticCheck } from '@pidex/shared/schedule-draft'
import type { ScheduledTask } from '@pidex/shared/scheduled-task'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import { AgentError } from '../Domain'
import { canonicalizeAutomationSchedule, nextAutomationOccurrence } from '../automation/Schedule'
import { prepareScheduledTaskDefinition } from './ScheduledTaskService'
import type { ScheduledTaskCoordinator } from './ScheduledTaskCoordinator'

type Options = {
  now?: () => number
  wake?: () => void | Promise<void>
  prepareExecution?: (task: TaskSchedule) => Promise<void>
  check?: (
    check: ScheduleAutomaticCheck,
    occurrence: TaskOccurrence,
    run: ScheduledTask | null,
  ) => Promise<boolean>
  feedback?: (occurrence: TaskOccurrence, content: string) => Promise<void>
}
const finished = new Set<TaskOccurrence['status']>([
  'completed',
  'rework',
  'failed',
  'skipped',
  'cancelled',
  'awaiting-acceptance',
])
const busy = new Set<TaskOccurrence['status']>(['dispatching', 'running', 'checking'])
function invalid(message: string): never {
  throw new AgentError('INVALID_REQUEST', message, 400)
}

export class TaskScheduleService {
  private readonly now: () => number
  private readonly repository
  private draining: Promise<void> | null = null
  constructor(
    private readonly db: AgentDatabase,
    private readonly coordinator: ScheduledTaskCoordinator,
    private readonly options: Options = {},
  ) {
    this.now = options.now ?? Date.now
    this.repository = db.repositories.taskSchedules
  }
  available() {
    return this.repository.available()
  }
  list() {
    return this.repository.list()
  }
  plans(threadId: string) {
    return this.repository.plans(threadId)
  }
  private mutate<T>(operationId: string, request: unknown, work: () => T): T {
    if (!this.available()) throw new AgentError('PERMISSION_DENIED', '当前存储不支持任务安排', 403)
    return this.repository.operation(operationId, request, work)
  }
  private updated(task: TaskSchedule, patch: Partial<TaskSchedule>) {
    return this.repository.putTask({
      ...task,
      ...patch,
      revision: task.revision + 1,
      updatedAt: this.now(),
    })
  }
  private changed(occurrence: TaskOccurrence, patch: Partial<TaskOccurrence>) {
    return this.repository.putOccurrence({
      ...occurrence,
      ...patch,
      revision: occurrence.revision + 1,
      updatedAt: this.now(),
    })
  }
  private ready(task: TaskSchedule) {
    return task.owner === 'agent' && !!task.plan && !!task.execution && task.autoExecute
  }
  private synchronizePending(task: TaskSchedule) {
    for (const occurrence of this.repository
      .occurrences()
      .filter(
        (o) => o.taskId === task.id && ['waiting', 'needs-plan', 'human'].includes(o.status),
      )) {
      const updated = this.changed(occurrence, { snapshot: task })
      if (occurrence.status === 'waiting' && occurrence.snapshot.autoExecute && !task.autoExecute)
        this.attention(updated, 'needs-plan')
    }
  }
  private cancelPendingSchedule(taskId: string) {
    for (const occurrence of this.repository
      .occurrences()
      .filter((o) => o.taskId === taskId && ['waiting', 'needs-plan', 'human'].includes(o.status)))
      this.changed(occurrence, {
        status: 'cancelled',
        attention: null,
        reminderAt: null,
        result: '已重新安排时间',
      })
  }
  save(input: RpcParams<'task-schedule/save'>) {
    const result = this.mutate(input.operationId, { method: 'save', ...input }, () => {
      const current = input.id ? this.repository.task(input.id) : null
      if (current) this.repository.checkRevision(current, input.expectedRevision ?? 0)
      const definition = input.definition ?? current ?? defaultTaskSchedule(input.name)
      let task: TaskSchedule = {
        ...definition,
        name: input.name.trim(),
        id: current?.id ?? `task:${randomUUID()}`,
        revision: (current?.revision ?? 0) + 1,
        readyAt: current?.readyAt ?? null,
        nextRunAt: current?.nextRunAt ?? null,
        createdAt: current?.createdAt ?? this.now(),
        updatedAt: this.now(),
      }
      if (task.plan) {
        if (task.plan.itemId && !task.plan.threadId) invalid('方案项必须关联来源会话')
        const content =
          task.plan.itemId && task.plan.threadId
            ? current?.plan?.itemId === task.plan.itemId &&
              current.plan.threadId === task.plan.threadId
              ? current.plan.content
              : this.repository.planContent(task.plan.threadId, task.plan.itemId)
            : task.plan.content
        task = { ...task, plan: { ...task.plan, content, contentHash: this.hash(content) } }
      }
      this.validate(task)
      const readinessChanged =
        !current ||
        JSON.stringify([current.plan, current.execution, current.autoExecute]) !==
          JSON.stringify([task.plan, task.execution, task.autoExecute])
      task = {
        ...task,
        readyAt: this.ready(task)
          ? readinessChanged
            ? this.now()
            : (current?.readyAt ?? this.now())
          : null,
      }
      if (current && JSON.stringify(current.trigger) !== JSON.stringify(task.trigger))
        this.cancelPendingSchedule(task.id)
      if (!current || JSON.stringify(current.trigger) !== JSON.stringify(task.trigger))
        task = { ...task, nextRunAt: this.firstTime(task) }
      if (task.status === 'cancelled') {
        for (const occurrence of this.repository
          .occurrences()
          .filter(
            (o) =>
              o.taskId === task.id &&
              (!finished.has(o.status) || o.attention !== null) &&
              !busy.has(o.status),
          ))
          this.changed(occurrence, { status: 'cancelled', attention: null, reminderAt: null })
      }
      const stored = this.repository.putTask(task)
      this.synchronizePending(stored)
      return stored
    })
    this.db.onTransactionCommit(() => {
      void this.options.wake?.()
    })
    return result
  }
  private hash(content: string) {
    return createHash('sha256').update(content).digest('hex')
  }
  private firstTime(task: TaskSchedule) {
    if (task.trigger?.kind === 'once') return task.trigger.at
    if (task.trigger?.kind === 'recurring')
      return nextAutomationOccurrence(task.trigger.schedule, task.trigger.timeZone, this.now())
    return null
  }
  private validate(task: TaskSchedule) {
    if (!task.name || task.name.length > 200) invalid('任务名称不能为空且不能超过 200 字符')
    if (task.plan && (!task.plan.content.trim() || task.plan.content.length > 100_000))
      invalid('方案正文不能为空且不能超过 100000 字符')
    const trigger = task.trigger
    if (trigger?.kind === 'once' || trigger?.kind === 'recurring') {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: trigger.timeZone }).format(0)
      } catch {
        invalid('时区无效')
      }
      if (trigger.kind === 'once' && !Number.isFinite(trigger.at)) invalid('执行时间无效')
      if (trigger.kind === 'recurring') canonicalizeAutomationSchedule(trigger.schedule)
    }
    for (const at of [task.conditions.notBefore, task.conditions.deadline])
      if (at !== null && !Number.isFinite(at)) invalid('时间窗口无效')
    if (
      task.conditions.notBefore !== null &&
      task.conditions.deadline !== null &&
      task.conditions.notBefore > task.conditions.deadline
    )
      invalid('执行窗口开始时间不能晚于截止时间')
    const dependencies = [
      ...task.conditions.dependsOn,
      ...(trigger?.kind === 'task-succeeded' || trigger?.kind === 'acceptance-passed'
        ? [trigger.taskId]
        : []),
    ]
    const tasks = new Map(this.repository.tasks().map((t) => [t.id, t]))
    const visit = (id: string, path: Set<string>) => {
      if (id === task.id || path.has(id)) invalid('任务不能循环依赖')
      const parent = tasks.get(id)
      if (!parent || parent.status === 'cancelled') invalid('前置任务不存在或已取消')
      const next = new Set(path).add(id)
      for (const dep of parent.conditions.dependsOn) visit(dep, next)
      if (parent.trigger?.kind === 'task-succeeded' || parent.trigger?.kind === 'acceptance-passed')
        visit(parent.trigger.taskId, next)
    }
    dependencies.forEach((id) => visit(id, new Set()))
    if (this.ready(task)) this.executionDefinition(task, this.now())
  }
  link(input: RpcParams<'task-schedule/link'>) {
    return this.mutate(input.operationId, { method: 'link', ...input }, () => {
      const task = this.repository.task(input.id)
      this.repository.checkRevision(task, input.expectedRevision)
      if (!this.db.repositories.automations.targetThreadAvailable(input.threadId))
        throw new AgentError('THREAD_NOT_FOUND', '会话不存在或已归档', 404)
      this.repository.link(task.id, input.threadId, input.role, this.now())
      return this.updated(task, {})
    })
  }
  plan(input: RpcParams<'task-schedule/plan'>) {
    const task = this.mutate(input.operationId, { method: 'plan', ...input }, () => {
      const task = this.repository.task(input.id)
      this.repository.checkRevision(task, input.expectedRevision)
      if (input.threadId && !this.db.repositories.automations.targetThreadAvailable(input.threadId))
        throw new AgentError('THREAD_NOT_FOUND', '关联会话不存在或已归档', 404)
      let content = input.content?.trim() ?? ''
      if (input.itemId) {
        if (!input.threadId) invalid('请选择方案所在会话')
        content = this.repository.planContent(input.threadId, input.itemId)
      }
      if (!content) invalid('请选择方案或填写正文')
      const triggerAt = task.trigger?.kind === 'once' ? task.trigger.at : task.nextRunAt
      const execution = input.execution ?? task.execution
      const updated: TaskSchedule = {
        ...task,
        plan: {
          content,
          contentHash: this.hash(content),
          threadId: input.threadId ?? null,
          itemId: input.itemId ?? null,
        },
        execution,
        autoExecute:
          input.autoExecute ?? (triggerAt !== null && triggerAt > this.now() && !!execution),
        readyAt: null,
      }
      this.validate(updated)
      if (input.threadId) this.repository.link(task.id, input.threadId, 'execution', this.now())
      const stored = this.updated(task, {
        ...updated,
        readyAt: this.ready(updated) ? this.now() : null,
      })
      this.synchronizePending(stored)
      return stored
    })
    this.db.onTransactionCommit(() => {
      void this.options.wake?.()
    })
    return task
  }
  private executionDefinition(task: TaskSchedule, at: number) {
    const execution = task.execution
    if (!execution || !task.plan) invalid('请先补充方案和执行设置')
    return prepareScheduledTaskDefinition(this.db.repositories.automations, {
      kind: execution.kind,
      name: task.name,
      prompt: `开始执行\n\n执行以下已选定的方案（SHA-256: ${task.plan.contentHash}）：\n${task.plan.content}`,
      projectId: execution.projectId,
      targetThreadId: execution.targetThreadId,
      execution: execution.environment,
      model: execution.model,
      reasoningEffort: execution.reasoningEffort,
      permissionConfig: execution.permissionConfig,
      scheduledFor: at,
      timeZone:
        task.trigger?.kind === 'once' || task.trigger?.kind === 'recurring'
          ? task.trigger.timeZone
          : 'Asia/Shanghai',
      notificationPolicy: task.notificationPolicy,
    })
  }
  private createOccurrence(task: TaskSchedule, id: string, at: number, manual = false) {
    const ready = this.ready(task) && task.readyAt !== null && task.readyAt <= at
    const status: TaskOccurrence['status'] =
      task.owner === 'human' ? 'human' : ready || manual ? 'waiting' : 'needs-plan'
    return this.repository.putOccurrence({
      id,
      taskId: task.id,
      revision: 1,
      scheduledFor: at,
      status,
      executionSucceeded: false,
      resultVersion: 1,
      result: '',
      feedback: '',
      snapshot: task,
      scheduledTaskId: null,
      threadId: null,
      attention: !manual && (status === 'needs-plan' || status === 'human') ? 'needs-plan' : null,
      reminderAt: !manual && (status === 'needs-plan' || status === 'human') ? this.now() : null,
      reminderVersion: 1,
      notifiedVersion: 0,
      createdAt: this.now(),
      updatedAt: this.now(),
    })
  }
  async start(input: RpcParams<'task-schedule/start'>) {
    const occurrence = this.mutate(input.operationId, { method: 'start', ...input }, () => {
      const task = this.repository.task(input.id)
      this.repository.checkRevision(task, input.expectedRevision)
      if (task.status !== 'active') invalid('请先恢复任务')
      if (this.repository.occurrences().some((o) => o.taskId === task.id && busy.has(o.status)))
        throw new AgentError('CONFLICT', '任务已经在运行', 409)
      if (task.owner === 'agent') this.executionDefinition(task, this.now())
      if (task.trigger?.kind === 'once' && task.nextRunAt !== null)
        this.updated(task, { nextRunAt: null })
      if (input.occurrenceId) {
        const occurrence = this.repository.occurrence(input.occurrenceId)
        if (
          occurrence.taskId !== task.id ||
          !['needs-plan', 'human', 'waiting', 'rework', 'failed'].includes(occurrence.status)
        )
          invalid('该运行不能启动')
        if (!['rework', 'failed'].includes(occurrence.status))
          return this.changed(occurrence, {
            snapshot: task,
            status: task.owner === 'human' ? 'human' : 'waiting',
            attention: null,
            reminderAt: null,
          })
      }
      return this.createOccurrence(task, `task-run:${input.operationId}`, this.now(), true)
    })
    await this.tick()
    return this.repository.occurrence(occurrence.id)
  }
  private attention(occurrence: TaskOccurrence, status: 'awaiting-acceptance' | 'needs-plan') {
    return this.changed(occurrence, {
      status,
      attention: status,
      reminderAt: this.now(),
      reminderVersion: occurrence.reminderVersion + 1,
    })
  }
  async submitResult(input: RpcParams<'task-schedule/result'>) {
    const occurrence = this.mutate(input.operationId, { method: 'result', ...input }, () => {
      const occurrence = this.repository.occurrence(input.id)
      this.repository.checkRevision(occurrence, input.expectedRevision)
      if (
        occurrence.resultVersion !== input.resultVersion ||
        occurrence.snapshot.owner !== 'human' ||
        !['human', 'rework', 'failed'].includes(occurrence.status)
      )
        invalid('该结果不能提交')
      return this.changed(occurrence, {
        status: 'checking',
        executionSucceeded: true,
        resultVersion: occurrence.resultVersion + 1,
        result: input.result,
        attention: null,
        reminderAt: null,
      })
    })
    await this.checkResult(occurrence)
    this.db.onTransactionCommit(() => {
      void this.options.wake?.()
    })
    return this.repository.occurrence(occurrence.id)
  }
  async accept(input: RpcParams<'task-schedule/accept'>) {
    const occurrence = this.mutate(input.operationId, { method: 'accept', ...input }, () => {
      const occurrence = this.repository.occurrence(input.id)
      this.repository.checkRevision(occurrence, input.expectedRevision)
      if (
        occurrence.status !== 'awaiting-acceptance' ||
        occurrence.resultVersion !== input.resultVersion
      )
        throw new AgentError('CONFLICT', '验收结果已变化，请刷新后重试', 409)
      if (input.decision === 'rework' && !input.feedback?.trim()) invalid('退回修改需要填写反馈')
      return this.changed(occurrence, {
        status: input.decision === 'pass' ? 'completed' : 'rework',
        feedback: input.feedback ?? '',
        attention: null,
        reminderAt: null,
      })
    })
    if (input.sendFeedback && input.decision === 'rework')
      await this.options.feedback?.(occurrence, occurrence.feedback)
    this.db.onTransactionCommit(() => {
      void this.options.wake?.()
    })
    return occurrence
  }
  snooze(input: RpcParams<'task-schedule/snooze'>) {
    return this.mutate(input.operationId, { method: 'snooze', ...input }, () => {
      const occurrence = this.repository.occurrence(input.id)
      this.repository.checkRevision(occurrence, input.expectedRevision)
      if (!occurrence.attention || !Number.isFinite(input.until) || input.until <= this.now())
        invalid('请为待处理任务选择未来提醒时间')
      return this.changed(occurrence, {
        reminderAt: input.until,
        reminderVersion: occurrence.reminderVersion + 1,
      })
    })
  }
  notify(input: RpcParams<'task-schedule/notify'>) {
    return this.db.transaction(() => {
      const occurrence = this.repository.occurrence(input.id)
      if (
        !occurrence.attention ||
        occurrence.reminderVersion !== input.reminderVersion ||
        occurrence.notifiedVersion >= input.reminderVersion ||
        occurrence.reminderAt === null ||
        occurrence.reminderAt > this.now()
      )
        throw new AgentError('CONFLICT', '提醒已处理或尚未到期', 409)
      return this.changed(occurrence, { notifiedVersion: input.reminderVersion })
    })
  }
  propose(input: RpcParams<'task-schedule/propose'>) {
    return this.mutate(input.operationId, { method: 'propose', ...input }, () => {
      const current = input.id ? this.repository.proposal(input.id) : null
      if (current) {
        this.repository.checkRevision(current, input.expectedRevision ?? 0)
        if (current.status !== 'pending') invalid('只能修改待确认的排程')
      }
      for (const item of input.items) {
        if ('taskId' in item)
          this.repository.checkRevision(this.repository.task(item.taskId), item.expectedRevision)
        if (!Number.isFinite(item.at)) invalid('安排时间无效')
      }
      const existing = input.items.filter((item) => 'taskId' in item)
      if (new Set(existing.map((i) => i.taskId)).size !== existing.length)
        invalid('排程不能重复安排同一任务')
      return this.repository.putProposal({
        id: current?.id ?? `task-proposal:${input.operationId}`,
        revision: (current?.revision ?? 0) + 1,
        status: 'pending',
        items: input.items,
        unscheduled: input.unscheduled,
        createdAt: this.now(),
      })
    })
  }
  arrange(input: RpcParams<'task-schedule/arrange'>) {
    const proposal = this.mutate(input.operationId, { method: 'arrange', ...input }, () => {
      const proposal = this.repository.proposal(input.id)
      this.repository.checkRevision(proposal, input.expectedRevision)
      if (proposal.status !== 'pending') invalid('排程已经确认')
      if (input.decision !== 'cancel')
        for (const item of proposal.unscheduled)
          if ('name' in item)
            this.save({
              name: item.name,
              operationId: `unscheduled-task:${input.operationId}:${proposal.unscheduled.indexOf(item)}`,
              definition: {
                ...defaultTaskSchedule(item.name),
                owner: item.owner,
                description: `未安排原因：${item.reason}`,
              },
            })
      if (input.decision === 'cancel')
        return this.repository.putProposal({
          ...proposal,
          revision: proposal.revision + 1,
          status: 'cancelled',
        })
      for (const item of proposal.items) {
        const task =
          'taskId' in item
            ? this.repository.task(item.taskId)
            : this.save({
                name: item.name,
                operationId: `arranged-task:${input.operationId}:${proposal.items.indexOf(item)}`,
                definition: { ...defaultTaskSchedule(item.name), owner: item.owner },
              })
        if ('taskId' in item) this.repository.checkRevision(task, item.expectedRevision)
        const zone =
          task.trigger?.kind === 'once' || task.trigger?.kind === 'recurring'
            ? task.trigger.timeZone
            : 'Asia/Shanghai'
        this.validate({ ...task, trigger: { kind: 'once', at: item.at, timeZone: zone } })
        this.cancelPendingSchedule(task.id)
        this.updated(task, {
          trigger: { kind: 'once', at: item.at, timeZone: zone },
          durationMinutes: item.durationMinutes,
          durationEstimated: task.durationEstimated,
          nextRunAt: item.at,
        })
      }
      return this.repository.putProposal({
        ...proposal,
        revision: proposal.revision + 1,
        status: 'committed',
      })
    })
    this.db.onTransactionCommit(() => {
      void this.options.wake?.()
    })
    return proposal
  }
  nextDeadline() {
    if (!this.available()) return null
    const deadlines = this.repository
      .tasks()
      .filter((t) => t.status === 'active')
      .flatMap((t) => (t.nextRunAt === null ? [] : [t.nextRunAt]))
    if (
      this.repository
        .occurrences()
        .some((o) => ['waiting', 'running', 'dispatching', 'checking'].includes(o.status))
    )
      deadlines.push(this.now() + 60_000)
    for (const occurrence of this.repository.occurrences())
      if (
        occurrence.attention &&
        occurrence.notifiedVersion < occurrence.reminderVersion &&
        occurrence.reminderAt !== null &&
        occurrence.reminderAt > this.now()
      )
        deadlines.push(occurrence.reminderAt)
    return deadlines.length ? Math.min(...deadlines) : null
  }
  tick(): Promise<void> {
    if (!this.available()) return Promise.resolve()
    if (this.draining) return this.draining
    this.draining = this.drain().finally(() => {
      this.draining = null
    })
    return this.draining
  }
  private async drain() {
    const now = this.now()
    this.db.transaction(() => {
      for (const task of this.repository.tasks().filter((t) => t.status === 'active')) {
        if (task.nextRunAt !== null && task.nextRunAt <= now) {
          const at = task.nextRunAt
          const id = `task-run:${task.id}:${at}`
          this.createOccurrence(task, id, at)
          this.updated(task, {
            nextRunAt:
              task.trigger?.kind === 'recurring'
                ? nextAutomationOccurrence(task.trigger.schedule, task.trigger.timeZone, now)
                : null,
          })
          if (task.missedRuns === 'skip' && now - at >= 60_000)
            this.changed(this.repository.occurrence(id), {
              status: 'skipped',
              attention: null,
              reminderAt: null,
            })
        }
        if (task.trigger?.kind === 'task-succeeded' || task.trigger?.kind === 'acceptance-passed') {
          const trigger = task.trigger
          for (const source of this.repository
            .occurrences()
            .filter(
              (o) =>
                o.taskId === trigger.taskId &&
                (trigger.kind === 'task-succeeded'
                  ? o.executionSucceeded
                  : o.status === 'completed') &&
                o.updatedAt >= task.createdAt,
            )) {
            const id = `task-event:${task.id}:${source.id}:${source.resultVersion}`
            if (!this.repository.occurrences().some((o) => o.id === id))
              this.createOccurrence(task, id, now)
          }
        }
      }
    })
    for (const occurrence of this.repository.occurrences()) {
      const task = this.repository.task(occurrence.taskId)
      if (occurrence.status === 'checking') {
        await this.checkResult(occurrence)
        continue
      }
      if (occurrence.scheduledTaskId && ['dispatching', 'running'].includes(occurrence.status)) {
        const run = this.db.repositories.scheduledTasks.read(occurrence.scheduledTaskId, true)
        if (!run) {
          this.db.transaction(() =>
            this.changed(occurrence, { status: 'failed', result: '执行记录不可用' }),
          )
          continue
        }
        if (run.status === 'completed') {
          const checking = this.db.transaction(() =>
            this.changed(occurrence, {
              status: 'checking',
              executionSucceeded: true,
              resultVersion: occurrence.resultVersion + 1,
              result: `执行会话：${run.threadId ?? ''}`,
              threadId: run.threadId,
            }),
          )
          await this.checkResult(checking)
        } else if (run.status === 'failed' || run.status === 'interrupted')
          this.db.transaction(() =>
            this.changed(occurrence, {
              status: 'failed',
              result: '执行失败或中断，请查看关联会话',
            }),
          )
        else if (run.status === 'claimed') await this.coordinator.startTask(run)
        else if (run.status === 'running' && occurrence.status !== 'running')
          this.db.transaction(() => this.changed(occurrence, { status: 'running' }))
        continue
      }
      if (task.status !== 'active' || occurrence.status !== 'waiting') continue
      const snapshot = occurrence.snapshot
      if (snapshot.conditions.deadline !== null && now > snapshot.conditions.deadline) {
        this.db.transaction(() =>
          this.changed(occurrence, { status: 'skipped', result: '已超过执行截止时间' }),
        )
        continue
      }
      const predecessors = this.repository.occurrences()
      const condition =
        (snapshot.conditions.notBefore === null || now >= snapshot.conditions.notBefore) &&
        snapshot.conditions.dependsOn.every((id) =>
          predecessors.some((o) => o.taskId === id && o.executionSucceeded),
        )
      if (!condition) {
        if (snapshot.conditionFallback === 'skip')
          this.db.transaction(() =>
            this.changed(occurrence, { status: 'skipped', result: '前置条件未满足' }),
          )
        continue
      }
      if (
        predecessors.some(
          (o) => o.taskId === task.id && o.id !== occurrence.id && busy.has(o.status),
        )
      )
        continue
      let definition
      try {
        definition = this.executionDefinition(snapshot, occurrence.scheduledFor)
        await this.options.prepareExecution?.(snapshot)
      } catch {
        if (snapshot.conditions.requireEnvironment && snapshot.conditionFallback === 'wait')
          continue
        this.db.transaction(() =>
          this.changed(occurrence, {
            status: snapshot.conditionFallback === 'skip' ? 'skipped' : 'failed',
            result: '执行目标、模型或权限不可用',
          }),
        )
        continue
      }
      const run = this.db.transaction(() => {
        const current = this.repository.occurrence(occurrence.id)
        if (
          current.status !== 'waiting' ||
          current.revision !== occurrence.revision ||
          this.repository.task(task.id).status !== 'active'
        )
          return null
        const created = this.db.repositories.scheduledTasks.create(
          {
            ...definition,
            id: `scheduled:${occurrence.id}`,
            operationId: `dispatch:${occurrence.id}`,
          },
          now,
        )
        const run = this.db.repositories.scheduledTasks.claimManual(
          created.id,
          `claim:${occurrence.id}`,
          now,
        )
        this.changed(current, {
          status: 'dispatching',
          scheduledTaskId: run.id,
          attention: null,
          reminderAt: null,
        })
        return run
      })
      if (run) await this.coordinator.startTask(run)
    }
  }
  private async checkResult(occurrence: TaskOccurrence) {
    const run = occurrence.scheduledTaskId
      ? this.db.repositories.scheduledTasks.read(occurrence.scheduledTaskId, true)
      : null
    let passed = true
    try {
      for (const check of occurrence.snapshot.checks)
        if (!(await this.options.check?.(check, occurrence, run))) {
          passed = false
          break
        }
    } catch {
      passed = false
    }
    this.db.transaction(() => {
      const current = this.repository.occurrence(occurrence.id)
      if (current.status !== 'checking' || current.resultVersion !== occurrence.resultVersion)
        return
      if (this.repository.task(current.taskId).status === 'cancelled') {
        this.changed(current, { status: 'cancelled', attention: null, reminderAt: null })
        return
      }
      if (!passed)
        this.changed(current, {
          status: 'failed',
          result: `${current.result}\n自动检查未通过，需要修正`,
        })
      else if (current.snapshot.requireManualAcceptance)
        this.attention(current, 'awaiting-acceptance')
      else this.changed(current, { status: 'completed', attention: null, reminderAt: null })
    })
  }
}
