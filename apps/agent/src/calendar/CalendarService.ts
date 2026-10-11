import type { CalendarOccurrence, CalendarSourceKind } from '@pidex/shared/calendar'
import type { AutomationRun } from '@pidex/shared/automation'
import type { ScheduledTask } from '@pidex/shared/scheduled-task'
import { automationOccurrencesBetween } from '../automation/Schedule'
import { AgentError } from '../Domain'
import type { AutomationRepository } from '../storage/repositories/AutomationRepository'
import type { ScheduledTaskRepository } from '../storage/repositories/ScheduledTaskRepository'

const MAX_OCCURRENCES = 2_000

export type CalendarRangeInput = {
  from: number
  to: number
  timeZone: string
  query?: string | undefined
  sourceKinds?: readonly CalendarSourceKind[] | undefined
}

export class CalendarService {
  constructor(
    private readonly automations: AutomationRepository,
    private readonly scheduledTasks: ScheduledTaskRepository,
    private readonly now: () => number = Date.now,
  ) {}

  range(input: CalendarRangeInput): { occurrences: CalendarOccurrence[]; truncated: boolean } {
    this.validate(input)
    const sources = new Set(input.sourceKinds ?? ['scheduled-task', 'automation'])
    const occurrences: CalendarOccurrence[] = []
    let truncated = false

    if (sources.has('scheduled-task')) {
      const tasks = this.scheduledTasks.listRange({
        from: input.from,
        to: input.to,
        ...(input.query === undefined ? {} : { query: input.query }),
        limit: MAX_OCCURRENCES + 1,
      })
      truncated ||= tasks.length > MAX_OCCURRENCES
      for (const task of tasks.slice(0, MAX_OCCURRENCES)) {
        occurrences.push(this.taskOccurrence(task))
      }
    }

    if (sources.has('automation') && occurrences.length <= MAX_OCCURRENCES) {
      const definitions = this.automations.list({
        statuses: ['active', 'paused'],
        ...(input.query === undefined ? {} : { query: input.query }),
        limit: 500,
      })
      const byId = new Map(definitions.map((value) => [value.id, value]))
      const actualKeys = new Set<string>()
      const runs = this.automations.listRunsInRange(input.from, input.to, MAX_OCCURRENCES + 1)
      for (const run of runs) {
        const definition = byId.get(run.automationId)
        if (!definition) continue
        const key = this.automationKey(run.automationId, run.scheduledFor)
        actualKeys.add(key)
        occurrences.push(this.runOccurrence(definition.name, run))
        if (occurrences.length > MAX_OCCURRENCES) {
          truncated = true
          break
        }
      }

      const projectionFrom = Math.max(input.from, this.now())
      for (const definition of definitions) {
        const remaining = MAX_OCCURRENCES + 1 - occurrences.length
        if (remaining <= 0) {
          truncated = true
          break
        }
        const projected = automationOccurrencesBetween(
          definition.schedule,
          definition.timeZone,
          projectionFrom,
          input.to - 1,
          remaining,
        )
        if (projected.length === remaining) truncated = true
        for (const scheduledFor of projected) {
          if (actualKeys.has(this.automationKey(definition.id, scheduledFor))) continue
          occurrences.push({
            id: `calendar:automation:${definition.id}:${scheduledFor}`,
            source: { kind: 'automation', id: definition.id },
            definitionKind: 'recurring',
            title: definition.name,
            scheduledFor,
            status: definition.status === 'paused' ? 'paused' : 'scheduled',
            runId: null,
            threadId: definition.targetThreadId,
            proposalId: null,
          })
          if (occurrences.length > MAX_OCCURRENCES) {
            truncated = true
            break
          }
        }
        if (occurrences.length > MAX_OCCURRENCES) break
      }
    }

    occurrences.sort(
      (left, right) => left.scheduledFor - right.scheduledFor || left.id.localeCompare(right.id),
    )
    return { occurrences: occurrences.slice(0, MAX_OCCURRENCES), truncated }
  }

  private taskOccurrence(task: ScheduledTask): CalendarOccurrence {
    return {
      id: `calendar:scheduled-task:${task.id}`,
      source: { kind: 'scheduled-task', id: task.id },
      definitionKind: 'one-off',
      title: task.name,
      scheduledFor: task.scheduledFor,
      status: task.status === 'cancelled' ? 'interrupted' : task.status,
      runId: [
        'claimed',
        'preparing',
        'queued',
        'running',
        'completed',
        'failed',
        'interrupted',
      ].includes(task.status)
        ? task.id
        : null,
      threadId: task.threadId ?? task.targetThreadId,
      proposalId: this.scheduledTasks.proposalId(task.id),
    }
  }

  private runOccurrence(title: string, run: AutomationRun): CalendarOccurrence {
    return {
      id: `calendar:automation-run:${run.id}`,
      source: { kind: 'automation', id: run.automationId },
      definitionKind: 'recurring',
      title,
      scheduledFor: run.scheduledFor,
      status: run.status,
      runId: run.id,
      threadId: run.threadId,
      proposalId: null,
    }
  }

  private automationKey(id: string, scheduledFor: number) {
    return `${id}:${scheduledFor}`
  }

  private validate(input: CalendarRangeInput) {
    if (!Number.isFinite(input.from) || !Number.isFinite(input.to) || input.from >= input.to) {
      throw new AgentError('INVALID_REQUEST', '日历时间范围无效', 400)
    }
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: input.timeZone }).format(0)
    } catch {
      throw new AgentError('INVALID_REQUEST', '日历时区无效', 400)
    }
  }
}
