import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { RpcResult } from '@pidex/agent-protocol'
import {
  type TaskSchedule,
  type TaskOccurrence,
} from '@pidex/shared/task-schedule'
import type { ScheduleExecution, ScheduleTrigger } from '@pidex/shared/schedule-draft'
import type { ModelRef } from '@pidex/shared/model'
import type { DesktopSessionSnapshot, DesktopWorkspace } from '../../../shared/Types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { Button } from '../../components/ui/Button.js'
import { Input } from '../../components/ui/Input.js'
import { Textarea } from '../../components/ui/Textarea.js'
import { Select } from '../../components/ui/Select.js'
import { Checkbox } from '../../components/ui/Checkbox.js'
import { composerDraftStore } from '../session/composer/ComposerDraftStore.js'
import { resolveRecentNewThreadModel } from '../models/RecentNewThreadModel.js'
import { TaskArrangementCard } from './TaskArrangementCard.js'

type Data = RpcResult<'task-schedule/list'>
const occurrenceLabels: Record<TaskOccurrence['status'], string> = {
  waiting: '等待规则满足',
  'needs-plan': '待补方案',
  human: '人工处理',
  dispatching: '正在准备',
  running: '正在执行',
  checking: '正在检查',
  'awaiting-acceptance': '待验收',
  completed: '已完成',
  rework: '需要修改',
  failed: '执行或检查失败',
  skipped: '已跳过',
  cancelled: '已取消',
}
const datetime = (at: number | null) =>
  at === null
    ? ''
    : new Date(at - new Date(at).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
const fieldClass = 'tw:grid tw:gap-2 tw:type-body-sm'
const sectionClass = 'tw:grid tw:gap-3 tw:border-b tw:border-app-border-subtle tw:p-4'

export function TaskSchedulePanel({ query = '' }: { query?: string }) {
  const [params, setParams] = useSearchParams()
  const [supported, setSupported] = useState(false)
  const [data, setData] = useState<Data>({ tasks: [], occurrences: [], links: [], proposals: [] })
  const [sessions, setSessions] = useState<DesktopSessionSnapshot[]>([])
  const [projects, setProjects] = useState<DesktopWorkspace[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const refresh = useCallback(async () => {
    if (!(await desktopClient.getRuntimeCapabilities()).includes('task.schedule.v1')) return false
    setSupported(true)
    setData(await desktopClient.taskSchedule('task-schedule/list', {}))
    return true
  }, [])
  useEffect(() => {
    let disposed = false
    void refresh()
      .then(async (available) => {
        if (!available || disposed) return
        const [sessions, projects] = await Promise.all([
          desktopClient.listSessions(),
          desktopClient.listProjects(),
        ])
        if (!disposed) {
          setSessions(sessions)
          setProjects(projects)
        }
      })
      .catch((cause) => {
        if (!disposed) setError(String(cause))
      })
    const unsubscribe = desktopClient.subscribeAgentEventEnvelopes(
      { liveEventTypes: [] },
      (events) => {
        if (events.some((event) => event.type === 'task-schedule/changed'))
          void refresh().catch((cause) => {
            if (!disposed) setError(String(cause))
          })
      },
    )
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [refresh])
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await work()
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '任务操作失败')
    } finally {
      setBusy(false)
    }
  }
  if (!supported) return null
  const select = (id: string, occurrenceId?: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('automationId')
      next.delete('automationMode')
      next.delete('scheduledTaskId')
      next.delete('scheduledTaskMode')
      next.set('taskId', id)
      if (occurrenceId) next.set('occurrenceId', occurrenceId)
      else next.delete('occurrenceId')
      return next
    })
  const selected = data.tasks.find((task) => task.id === params.get('taskId'))
  const attention = data.occurrences.filter((o) => o.attention)
  return (
    <section aria-label="任务与待处理" className="tw:grid tw:shrink-0 tw:gap-2">
      <div className={sectionClass}>
        <form
          className="tw:flex tw:gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void act(async () => {
              const { task } = await desktopClient.taskSchedule('task-schedule/save', {
                name,
                operationId: crypto.randomUUID(),
              })
              setName('')
              select(task.id)
            })
          }}
        >
          <Input
            aria-label="新任务名称"
            placeholder="先记下任务，方案以后补"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <Button type="submit" color="primary" disabled={busy || !name.trim()}>
            创建任务
          </Button>
          <Button
            type="button"
            color="secondary"
            onClick={() => {
              composerDraftStore.prefillTextIfEmpty(
                'home',
                '请帮我安排任务时间。先通过 task_schedule_view 和日历读取现有任务与安排，保留已有安排；结合我的可用时间、任务预计时长、优先级、截止时间和依赖生成 task_schedule_propose 草案，无法安排的任务说明原因，不要求先写执行方案。',
              )
              navigate('/new')
            }}
          >
            帮我排时间
          </Button>
        </form>
        {error ? (
          <p role="alert" className="tw:text-app-text">
            {error}
          </p>
        ) : null}
        {attention.length ? (
          <div
            role="status"
            aria-label="高优先级待处理"
            className="tw:grid tw:gap-2 tw:rounded-lg tw:border tw:border-app-border-subtle tw:p-3"
          >
            <strong>需要你处理 · {attention.length}</strong>
            {attention.map((o) => (
              <Button key={o.id} color="secondary" onClick={() => select(o.taskId, o.id)}>
                {o.snapshot.name} ·{' '}
                {o.attention === 'awaiting-acceptance'
                  ? '等待人工验收'
                  : o.snapshot.owner === 'human'
                    ? '到时间了，请开始处理'
                    : o.snapshot.plan
                      ? '到时间了，待手动开始'
                      : '到时间了，请补方案'}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="tw:flex tw:flex-wrap tw:gap-2" aria-label="任务列表">
          {data.tasks
            .filter((t) => !query || t.name.includes(query))
            .map((task) => {
              const runs = data.occurrences.filter((o) => o.taskId === task.id)
              const last = runs.at(-1)
              const planning = data.links.some((link) => link.taskId === task.id)
              const status =
                task.status === 'paused'
                  ? '已暂停'
                  : task.status === 'cancelled'
                    ? '已取消'
                    : last
                      ? occurrenceLabels[last.status]
                      : planning
                        ? '执行中 · 正在规划'
                        : '待办'
              return (
                <Button
                  key={task.id}
                  color={selected?.id === task.id ? 'primary' : 'secondary'}
                  onClick={() => select(task.id)}
                >
                  {task.name} · {status}
                </Button>
              )
            })}
        </div>
        {data.proposals
          .filter((p) => p.status === 'pending')
          .map((proposal) => (
            <TaskArrangementCard key={proposal.id} initial={proposal} />
          ))}
      </div>
      {selected ? (
        <TaskScheduleEditor
          key={`${selected.id}:${selected.revision}`}
          task={selected}
          data={data}
          sessions={sessions}
          projects={projects}
          busy={busy}
          act={act}
        />
      ) : null}
    </section>
  )
}

function TaskScheduleEditor({
  task,
  data,
  sessions,
  projects,
  busy,
  act,
}: {
  task: TaskSchedule
  data: Data
  sessions: DesktopSessionSnapshot[]
  projects: DesktopWorkspace[]
  busy: boolean
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  const [draft, setDraft] = useState(task)
  const [content, setContent] = useState(task.plan?.content ?? '')
  const [threadId, setThreadId] = useState(
    task.execution?.targetThreadId ?? task.plan?.threadId ?? '',
  )
  const [projectId, setProjectId] = useState('')
  const [plans, setPlans] = useState<RpcResult<'task-schedule/plans'>['plans']>([])
  const [itemId, setItemId] = useState(task.plan?.itemId ?? '')
  const [planError, setPlanError] = useState('')
  const navigate = useNavigate()
  const patch = (patch: Partial<TaskSchedule>) => setDraft((current) => ({ ...current, ...patch }))
  useEffect(() => {
    let current = true
    setPlans([])
    setPlanError('')
    if (threadId)
      void desktopClient
        .taskSchedule('task-schedule/plans', { threadId })
        .then((result) => {
          if (current) setPlans(result.plans)
        })
        .catch((cause) => {
          if (current) setPlanError(String(cause))
        })
    return () => {
      current = false
    }
  }, [threadId])
  const inputTrigger = (kind: string): ScheduleTrigger | null =>
    kind === 'once'
      ? {
          kind: 'once',
          at: Date.now() + 3_600_000,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }
      : kind === 'recurring'
        ? {
            kind: 'recurring',
            schedule: { mode: 'daily', time: '09:00' },
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }
        : kind === 'task-succeeded' || kind === 'acceptance-passed'
          ? { kind, taskId: data.tasks.find((t) => t.id !== task.id)?.id ?? '' }
          : null
  const settingsForThread = async (): Promise<ScheduleExecution> => {
    if (!threadId) throw new Error('请选择执行会话，或先开始规划')
    const session = await desktopClient.getSession(threadId)
    if (!session) throw new Error('执行会话不可用')
    const recent = await resolveRecentNewThreadModel()
    const model =
      session.settings.model && session.settings.providerID
        ? ({ providerID: session.settings.providerID, id: session.settings.model } as ModelRef)
        : (recent as ModelRef | null)
    if (!model) throw new Error('请先配置模型')
    return {
      kind: 'thread',
      projectId: null,
      targetThreadId: threadId,
      environment: null,
      model,
      reasoningEffort: session.settings.effort ?? null,
      permissionConfig: session.settings.permissionConfig,
    }
  }
  const save = async () => {
    const { id, revision, readyAt: _readyAt, nextRunAt: _nextRunAt, createdAt: _createdAt, updatedAt: _updatedAt, ...definition } = draft
    await desktopClient.taskSchedule('task-schedule/save', {
      id,
      expectedRevision: revision,
      operationId: crypto.randomUUID(),
      name: definition.name,
      definition,
    })
  }
  const savePlan = async () => {
    await desktopClient.taskSchedule('task-schedule/plan', {
      id: task.id,
      expectedRevision: task.revision,
      operationId: crypto.randomUUID(),
      ...(itemId ? { itemId } : { content }),
      ...(threadId ? { threadId } : {}),
      ...(threadId ? { execution: await settingsForThread() } : {}),
    })
  }
  const runs = data.occurrences
    .filter((o) => o.taskId === task.id)
    .sort((a, b) => b.createdAt - a.createdAt)
  const linked = data.links.filter((link) => link.taskId === task.id)
  return (
    <div className={sectionClass} aria-label="任务详情">
      <h3 className="tw:type-heading-sm">{task.name}</h3>
      <div className="tw:grid tw:gap-3 tw:md:grid-cols-2">
        <label className={fieldClass}>
          任务名称
          <Input value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
        </label>
        <label className={fieldClass}>
          任务说明
          <Textarea
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </label>
        <Select
          ariaLabel="执行方式"
          value={draft.owner}
          options={[
            { value: 'agent', label: 'AI 执行' },
            { value: 'human', label: '人工处理' },
          ]}
          onValueChange={(owner) =>
            patch({ owner, ...(owner === 'human' ? { autoExecute: false } : {}) })
          }
        />
        <Select
          ariaLabel="任务状态"
          value={draft.status}
          options={[
            { value: 'active', label: '启用' },
            { value: 'paused', label: '暂停' },
            { value: 'cancelled', label: '取消' },
          ]}
          onValueChange={(status) => patch({ status })}
        />
        <label className={fieldClass}>
          预计时长（分钟）
          <Input
            type="number"
            min={1}
            value={draft.durationMinutes}
            onChange={(e) =>
              patch({ durationMinutes: Number(e.target.value), durationEstimated: false })
            }
          />
          {draft.durationEstimated ? <span>尚未估算，暂按 30 分钟占位</span> : null}
        </label>
        <Select
          ariaLabel="优先级"
          value={draft.priority}
          options={[
            { value: 'low', label: '低' },
            { value: 'normal', label: '普通' },
            { value: 'high', label: '高' },
          ]}
          onValueChange={(priority) => patch({ priority })}
        />
        <Select
          ariaLabel="触发方式"
          value={draft.trigger?.kind ?? 'none'}
          options={[
            { value: 'none', label: '暂不安排' },
            { value: 'once', label: '一次性时间' },
            { value: 'recurring', label: '周期时间' },
            { value: 'task-succeeded', label: '前置任务执行成功' },
            { value: 'acceptance-passed', label: '前置任务验收通过' },
          ]}
          onValueChange={(value) => patch({ trigger: inputTrigger(value) })}
        />
        {draft.trigger?.kind === 'once' ? (
          <label className={fieldClass}>
            执行时间
            <Input
              type="datetime-local"
              value={datetime(draft.trigger.at)}
              onChange={(e) =>
                patch({
                  trigger: {
                    kind: 'once',
                    at: new Date(e.target.value).getTime(),
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  },
                })
              }
            />
          </label>
        ) : null}
        {draft.trigger?.kind === 'recurring' ? (
          <label className={fieldClass}>
            周期规则（RRULE）
            <Input
              value={
                draft.trigger.schedule.mode === 'custom'
                  ? draft.trigger.schedule.rrule
                  : `FREQ=DAILY;BYHOUR=${Number(draft.trigger.schedule.mode === 'daily' ? draft.trigger.schedule.time.split(':')[0] : 9)};BYMINUTE=0`
              }
              onChange={(e) =>
                patch({
                  trigger: {
                    kind: 'recurring',
                    schedule: { mode: 'custom', rrule: e.target.value },
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  },
                })
              }
            />
          </label>
        ) : null}
        {draft.trigger?.kind === 'task-succeeded' || draft.trigger?.kind === 'acceptance-passed' ? (
          <Select
            ariaLabel="前置触发任务"
            value={draft.trigger.taskId}
            options={data.tasks
              .filter((t) => t.id !== task.id)
              .map((t) => ({ value: t.id, label: t.name }))}
            onValueChange={(taskId) =>
              patch({
                trigger: {
                  kind:
                    draft.trigger?.kind === 'acceptance-passed'
                      ? 'acceptance-passed'
                      : 'task-succeeded',
                  taskId,
                },
              })
            }
          />
        ) : null}
        <label className={fieldClass}>
          最早启动时间
          <Input
            type="datetime-local"
            value={datetime(draft.conditions.notBefore)}
            onChange={(e) =>
              patch({
                conditions: {
                  ...draft.conditions,
                  notBefore: e.target.value ? new Date(e.target.value).getTime() : null,
                },
              })
            }
          />
        </label>
        <label className={fieldClass}>
          执行截止时间
          <Input
            type="datetime-local"
            value={datetime(draft.conditions.deadline)}
            onChange={(e) =>
              patch({
                conditions: {
                  ...draft.conditions,
                  deadline: e.target.value ? new Date(e.target.value).getTime() : null,
                },
              })
            }
          />
        </label>
        <Select
          ariaLabel="条件未满足时"
          value={draft.conditionFallback}
          options={[
            { value: 'wait', label: '等待并重查' },
            { value: 'skip', label: '跳过本次' },
          ]}
          onValueChange={(conditionFallback) => patch({ conditionFallback })}
        />
        <Select
          ariaLabel="错过执行时间"
          value={draft.missedRuns}
          options={[
            { value: 'catch-up', label: '准备好的任务补跑一次' },
            { value: 'skip', label: '跳过错过的执行' },
          ]}
          onValueChange={(missedRuns) => patch({ missedRuns })}
        />
        <Select
          ariaLabel="普通执行通知"
          value={draft.notificationPolicy}
          options={[
            { value: 'all', label: '通知执行结果' },
            { value: 'failures', label: '仅通知失败' },
            { value: 'off', label: '关闭普通执行通知' },
          ]}
          onValueChange={(notificationPolicy) => patch({ notificationPolicy })}
        />
        <Checkbox
          checked={draft.conditions.requireEnvironment}
          onCheckedChange={(value) =>
            patch({ conditions: { ...draft.conditions, requireEnvironment: value === true } })
          }
        >
          需要执行环境就绪
        </Checkbox>
        <Checkbox
          checked={draft.requireManualAcceptance}
          onCheckedChange={(value) => patch({ requireManualAcceptance: value === true })}
        >
          需要人工验收
        </Checkbox>
        <Checkbox
          disabled={draft.owner === 'human' || !draft.plan || !draft.execution}
          checked={draft.autoExecute}
          onCheckedChange={(value) => patch({ autoExecute: value === true })}
        >
          按安排自动执行（关闭则仅提醒）
        </Checkbox>
      </div>
      <div className="tw:flex tw:flex-wrap tw:gap-3">
        {data.tasks
          .filter((t) => t.id !== task.id && t.status !== 'cancelled')
          .map((dep) => (
            <Checkbox
              key={dep.id}
              checked={draft.conditions.dependsOn.includes(dep.id)}
              onCheckedChange={(value) =>
                patch({
                  conditions: {
                    ...draft.conditions,
                    dependsOn:
                      value === true
                        ? [...draft.conditions.dependsOn, dep.id]
                        : draft.conditions.dependsOn.filter((id) => id !== dep.id),
                  },
                })
              }
            >
              执行成功依赖：{dep.name}
            </Checkbox>
          ))}
      </div>
      <div className="tw:grid tw:gap-2" aria-label="自动验收检查">
        {draft.checks.map((check, index) => (
          <div key={index} className="tw:flex tw:gap-2">
            <Select
              ariaLabel="检查类型"
              value={check.kind}
              options={[
                { value: 'file-exists', label: '非空文件' },
                { value: 'document-section', label: 'Markdown 章节' },
                { value: 'command-exit-code', label: '命令退出码' },
              ]}
              onValueChange={(kind) =>
                patch({
                  checks: draft.checks.map((c, i) =>
                    i !== index
                      ? c
                      : kind === 'command-exit-code'
                        ? { kind, command: '', expectedExitCode: 0 }
                        : kind === 'document-section'
                          ? { kind, path: '', section: '' }
                          : { kind, path: '' },
                  ),
                })
              }
            />
            <Input
              aria-label={check.kind === 'command-exit-code' ? '检查命令' : '检查路径'}
              value={check.kind === 'command-exit-code' ? check.command : check.path}
              onChange={(e) =>
                patch({
                  checks: draft.checks.map((c, i) =>
                    i !== index
                      ? c
                      : c.kind === 'command-exit-code'
                        ? { ...c, command: e.target.value }
                        : { ...c, path: e.target.value },
                  ),
                })
              }
            />
            {check.kind === 'document-section' ? (
              <Input
                aria-label="章节标题"
                value={check.section}
                onChange={(e) =>
                  patch({
                    checks: draft.checks.map((c, i) =>
                      i === index && c.kind === 'document-section'
                        ? { ...c, section: e.target.value }
                        : c,
                    ),
                  })
                }
              />
            ) : null}
            {check.kind === 'command-exit-code' ? (
              <Input
                aria-label="预期退出码"
                type="number"
                value={check.expectedExitCode}
                onChange={(e) =>
                  patch({
                    checks: draft.checks.map((c, i) =>
                      i === index && c.kind === 'command-exit-code'
                        ? { ...c, expectedExitCode: Number(e.target.value) }
                        : c,
                    ),
                  })
                }
              />
            ) : null}
            <Button
              color="secondary"
              onClick={() => patch({ checks: draft.checks.filter((_, i) => i !== index) })}
            >
              移除
            </Button>
          </div>
        ))}
        <Button
          color="secondary"
          onClick={() => patch({ checks: [...draft.checks, { kind: 'file-exists', path: '' }] })}
        >
          添加自动检查
        </Button>
      </div>
      <Button color="primary" disabled={busy} onClick={() => void act(save)}>
        保存任务设置
      </Button>
      <div className="tw:grid tw:gap-2" aria-label="方案与会话">
        <Select
          ariaLabel="规划项目"
          value={projectId}
          options={[
            { value: '', label: '无项目会话' },
            ...projects.map((p) => ({ value: p.projectId ?? p.id, label: p.name })),
          ]}
          onValueChange={setProjectId}
        />
        <Button
          color="secondary"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const result = await desktopClient.createSession({
                sessionName: `${task.name} · 规划`,
                projectlessPrompt: task.name,
                ...(projectId ? { projectId } : {}),
                planModeActive: true,
                creationSurface: 'working',
              })
              await desktopClient.taskSchedule('task-schedule/link', {
                id: task.id,
                expectedRevision: task.revision,
                operationId: crypto.randomUUID(),
                threadId: result.sessionId,
                role: 'planning',
              })
              composerDraftStore.prefillTextIfEmpty(
                `session:${result.sessionId}`,
                `请规划任务“${task.name}”的执行方案。${task.description}\n当前仅规划，完成后我会把选中的方案归入任务。`,
              )
              navigate(`/threads/${encodeURIComponent(result.sessionId)}`)
            })
          }
        >
          开始规划，打开新会话
        </Button>
        <Select
          ariaLabel="关联或执行会话"
          value={threadId}
          options={[
            { value: '', label: '选择已有会话' },
            ...sessions.map((s) => ({
              value: s.appServerThreadId ?? s.item.id,
              label: s.item.sessionName ?? s.item.id,
            })),
          ]}
          onValueChange={(id) => {
            setThreadId(id)
            setItemId('')
          }}
        />
        <Button
          color="secondary"
          disabled={busy || !threadId}
          onClick={() =>
            void act(() =>
              desktopClient.taskSchedule('task-schedule/link', {
                id: task.id,
                expectedRevision: task.revision,
                operationId: crypto.randomUUID(),
                threadId,
                role: 'planning',
              }),
            )
          }
        >
          归入任务，仅关联不执行
        </Button>
        {linked.map((link) => (
          <Button
            key={link.threadId}
            color="secondary"
            onClick={() => navigate(`/threads/${encodeURIComponent(link.threadId)}`)}
          >
            打开{link.role === 'planning' ? '规划' : '执行'}会话 ·{' '}
            {sessions.find((s) => s.item.id === link.threadId)?.item.sessionName ?? link.threadId}
          </Button>
        ))}
        {planError ? <p role="alert">{planError}</p> : null}
        <Select
          ariaLabel="选定的方案"
          value={itemId}
          options={[
            { value: '', label: '直接填写方案' },
            ...plans.map((p) => ({ value: p.itemId, label: p.title })),
          ]}
          onValueChange={(id) => {
            setItemId(id)
            if (id) setContent(plans.find((p) => p.itemId === id)?.content ?? '')
          }}
        />
        <Textarea
          aria-label="方案正文"
          value={content}
          readOnly={!!itemId}
          onChange={(e) => setContent(e.target.value)}
        />
        <p className="tw:type-body-sm tw:text-app-text-meta">
          方案会保存固定快照。时间前补全默认到点执行；时间后补全默认仅保存。执行沿用所选会话的模型与权限，需要新增授权时仍会阻止。
        </p>
        <Button
          color="primary"
          disabled={busy || !content.trim()}
          onClick={() => void act(savePlan)}
        >
          保存选定方案与会话
        </Button>
      </div>
      <Button
        color="secondary"
        disabled={busy || task.status !== 'active'}
        onClick={() =>
          void act(() =>
            desktopClient.taskSchedule('task-schedule/start', {
              id: task.id,
              expectedRevision: task.revision,
              operationId: crypto.randomUUID(),
            }),
          )
        }
      >
        {task.owner === 'human' ? '开始人工处理' : '立即开始执行'}
      </Button>
      <div className="tw:grid tw:gap-3" aria-label="任务运行与验收">
        {runs.map((occurrence) => (
          <TaskOccurrenceActions
            key={occurrence.id}
            occurrence={occurrence}
            task={task}
            busy={busy}
            act={act}
          />
        ))}
      </div>
    </div>
  )
}

function TaskOccurrenceActions({
  occurrence,
  task,
  busy,
  act,
}: {
  occurrence: TaskOccurrence
  task: TaskSchedule
  busy: boolean
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [sendFeedback, setSendFeedback] = useState(false)
  const navigate = useNavigate()
  const versioned = {
    id: occurrence.id,
    expectedRevision: occurrence.revision,
    operationId: crypto.randomUUID(),
  }
  return (
    <article className="tw:grid tw:gap-2 tw:rounded-lg tw:border tw:border-app-border-subtle tw:p-3">
      <strong>
        {new Date(occurrence.scheduledFor).toLocaleString()} · {occurrenceLabels[occurrence.status]}
      </strong>
      <p className="tw:type-body-sm tw:whitespace-pre-wrap">
        {occurrence.result || occurrence.feedback}
      </p>
      {(occurrence.threadId ?? occurrence.snapshot.plan?.threadId) ? (
        <Button
          color="secondary"
          onClick={() =>
            navigate(
              `/threads/${encodeURIComponent((occurrence.threadId ?? occurrence.snapshot.plan?.threadId)!)}`,
            )
          }
        >
          查看方案与会话结果
        </Button>
      ) : null}
      {occurrence.attention ? (
        <Button
          color="secondary"
          disabled={busy}
          onClick={() =>
            void act(() =>
              desktopClient.taskSchedule('task-schedule/snooze', {
                ...versioned,
                until: Date.now() + 10 * 60_000,
              }),
            )
          }
        >
          十分钟后再提醒
        </Button>
      ) : null}
      {['needs-plan', 'human', 'rework', 'failed'].includes(occurrence.status) ? (
        <>
          {task.owner === 'human' ? (
            <>
              <Textarea
                aria-label="人工完成结果"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <Button
                color="primary"
                disabled={busy || !text.trim()}
                onClick={() =>
                  void act(() =>
                    desktopClient.taskSchedule('task-schedule/result', {
                      ...versioned,
                      resultVersion: occurrence.resultVersion,
                      result: text,
                    }),
                  )
                }
              >
                提交完成结果
              </Button>
            </>
          ) : (
            <Button
              color="secondary"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  desktopClient.taskSchedule('task-schedule/start', {
                    id: task.id,
                    expectedRevision: task.revision,
                    occurrenceId: occurrence.id,
                    operationId: crypto.randomUUID(),
                  }),
                )
              }
            >
              开始执行选定方案
            </Button>
          )}
        </>
      ) : null}
      {occurrence.status === 'awaiting-acceptance' ? (
        <>
          <Textarea
            aria-label="验收反馈"
            placeholder="退回修改时填写反馈"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Checkbox
            checked={sendFeedback}
            onCheckedChange={(value) => setSendFeedback(value === true)}
          >
            退回时把反馈发送到执行会话进行规划
          </Checkbox>
          <div className="tw:flex tw:gap-2">
            <Button
              color="primary"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  desktopClient.taskSchedule('task-schedule/accept', {
                    ...versioned,
                    resultVersion: occurrence.resultVersion,
                    decision: 'pass',
                  }),
                )
              }
            >
              验收通过，完成任务
            </Button>
            <Button
              color="secondary"
              disabled={busy || !text.trim()}
              onClick={() =>
                void act(() =>
                  desktopClient.taskSchedule('task-schedule/accept', {
                    ...versioned,
                    resultVersion: occurrence.resultVersion,
                    decision: 'rework',
                    feedback: text,
                    sendFeedback,
                  }),
                )
              }
            >
              退回修改
            </Button>
          </div>
        </>
      ) : null}
    </article>
  )
}
