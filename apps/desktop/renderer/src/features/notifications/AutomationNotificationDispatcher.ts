import type { Automation, AutomationRun } from '@pidex/shared/automation'
import type { EventEnvelope } from '@pidex/agent-protocol'
import type { DesktopAutomationApi } from '../../services/desktop-client/Types.js'
import type { TaskNotificationSender } from './TaskNotificationDispatcher.js'
import { TaskNotificationDispatcher } from './TaskNotificationDispatcher.js'

const terminal = (run: AutomationRun) =>
  run.status === 'completed' || run.status === 'failed' || run.status === 'interrupted'
const active = (run: AutomationRun) =>
  run.status === 'claimed' ||
  run.status === 'preparing' ||
  run.status === 'queued' ||
  run.status === 'running'

export class AutomationNotificationDispatcher {
  #automations = new Map<string, Automation>()
  #observed = new Set<string>()
  #queue = Promise.resolve()

  constructor(
    private readonly api: DesktopAutomationApi,
    private readonly taskNotifications: TaskNotificationDispatcher,
    private readonly send: TaskNotificationSender,
  ) {}

  async initialize(): Promise<void> {
    const [automations, runs] = await Promise.all([
      this.api.listAutomations({ statuses: ['active', 'paused'] }),
      this.api.listAutomationRuns({ limit: 500 }),
    ])
    this.#automations = new Map(automations.automations.map((value) => [value.id, value]))
    for (const run of runs.runs) {
      if (active(run) && run.threadId)
        this.taskNotifications.trackAutomationRun(run.id, run.threadId)
      if (terminal(run)) this.#observed.add(this.id(run))
    }
  }

  ingest(events: readonly EventEnvelope[]): Promise<void> {
    const changes = events.filter((event) => event.type === 'automation/runChanged')
    if (!changes.length) return this.#queue
    this.#queue = this.#queue
      .then(async () => {
        for (const event of changes) {
          await this.reconcile(event.payload as { automationId: string; runId: string })
        }
      })
      .catch(() => undefined)
    return this.#queue
  }

  private async reconcile(change: { automationId: string; runId: string }): Promise<void> {
    const result = await this.api.listAutomationRuns({
      automationId: change.automationId,
      limit: 200,
    })
    const run = result.runs.find((value) => value.id === change.runId)
    if (!run) return
    if (active(run)) {
      if (run.threadId) this.taskNotifications.trackAutomationRun(run.id, run.threadId)
      return
    }
    if (!terminal(run)) return
    const notificationId = this.id(run)
    if (!this.#observed.has(notificationId) && run.threadId) {
      const automation = await this.automation(change.automationId)
      const notify =
        automation.notificationPolicy === 'all' ||
        (automation.notificationPolicy === 'failures' && run.status !== 'completed')
      if (notify)
        this.send({
          notificationId,
          threadId: run.threadId,
          kind: run.status === 'completed' ? 'completed' : 'failed',
          body: automation.name.slice(0, 200),
          visibility: 'unfocused',
        })
    }
    this.#observed.add(notificationId)
    this.taskNotifications.releaseAutomationRun(run.id)
  }

  private async automation(id: string): Promise<Automation> {
    const cached = this.#automations.get(id)
    if (cached) return cached
    const result = await this.api.readAutomation({ automationId: id })
    this.#automations.set(id, result.automation)
    return result.automation
  }

  private id(run: AutomationRun): string {
    return `automation:${run.id}:${run.status}`
  }
}
