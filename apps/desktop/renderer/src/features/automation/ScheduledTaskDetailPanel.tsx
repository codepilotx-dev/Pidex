import { useEffect, useId, useState } from 'react'
import type React from 'react'
import { ArrowLeft, AlertTriangle, CalendarClock, Play, Trash2, X } from 'lucide-react'
import type { AutomationSchedule, AutomationWeekday } from '@pidex/shared/automation'
import type { ScheduledTask, ScheduledTaskDefinition } from '@pidex/shared/scheduled-task'
import type { DesktopSessionListItem, DesktopWorkspace } from '../../../shared/Types.js'
import { Button } from '../../components/ui/Button.js'

import { Input } from '../../components/ui/Input.js'
import { Select } from '../../components/ui/Select.js'
import { Textarea } from '../../components/ui/Textarea.js'
import { APP_ICON_SIZE } from '../../components/ui/IconTokens.js'
import { calendarStatusLabel } from './CalendarDates.js'
import { desktopClient } from '../../services/desktop-client/index.js'
const errorMessage = (cause: unknown): string => rawErrorMessage(cause) || '操作失败'
import { errorMessageOf as rawErrorMessage } from '@pidex/shared/errors'

type ScheduleMode = 'once' | 'daily' | 'weekdays' | 'weekly' | 'hourly' | 'custom'

const SCHEDULE_MODE_OPTIONS = [
  { value: 'once', label: '仅一次（单次执行）' },
  { value: 'daily', label: '每天' },
  { value: 'weekdays', label: '工作日' },
  { value: 'weekly', label: '每周' },
  { value: 'hourly', label: '每小时' },
  { value: 'custom', label: '自定义 RRULE' },
] as const

const WEEKDAY_OPTIONS = [
  { value: 'MO', label: '周一' },
  { value: 'TU', label: '周二' },
  { value: 'WE', label: '周三' },
  { value: 'TH', label: '周四' },
  { value: 'FR', label: '周五' },
  { value: 'SA', label: '周六' },
  { value: 'SU', label: '周日' },
] as const

type Props = {
  creating: boolean
  task: ScheduledTask | null
  initialDraft: ScheduledTaskDefinition
  projects: readonly DesktopWorkspace[]
  sessions: readonly DesktopSessionListItem[]
  onClose: () => void
  exitPending: 'back' | 'close' | null
  onBack?: () => void
  onUnsavedChange: (unsaved: boolean) => void
  onChanged: (task: ScheduledTask) => void
  onAutomationCreated?: (id: string) => void
  onDeleted: () => void
  onOpenThread: (id: string) => void
}

export function ScheduledTaskDetailPanel(props: Props): React.ReactNode {
  const [draft, setDraft] = useState<ScheduledTaskDefinition>(props.initialDraft)
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('once')
  const [weeklyDay, setWeeklyDay] = useState<AutomationWeekday>('MO')
  const [hourlyInterval, setHourlyInterval] = useState(60)
  const [customRrule, setCustomRrule] = useState('')
  const [executionDate, setExecutionDate] = useState(() =>
    toLocalDateTime(props.initialDraft.scheduledFor).slice(0, 10),
  )
  const [executionTime, setExecutionTime] = useState(() =>
    toLocalDateTime(props.initialDraft.scheduledFor).slice(11, 16),
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsId = useId()
  useEffect(() => setSettingsOpen(false), [props.task?.id, props.creating])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editable =
    props.creating || props.task?.status === 'scheduled' || props.task?.status === 'paused'

  useEffect(() => {
    const nextDraft = props.task ? taskDefinition(props.task) : props.initialDraft
    setDraft(nextDraft)
    const local = toLocalDateTime(nextDraft.scheduledFor)
    setExecutionDate(local.slice(0, 10))
    setExecutionTime(local.slice(11, 16))
    setError(null)
  }, [props.initialDraft, props.task?.id, props.task?.revision])

  const update = (patch: Partial<ScheduledTaskDefinition>): void =>
    setDraft((current) => ({ ...current, ...patch }))
  function updateExecution(date: string, time: string): void {
    setExecutionDate(date)
    setExecutionTime(time)
    update({ scheduledFor: date && time ? new Date(`${date}T${time}`).getTime() : NaN })
  }
  const projectOptions = props.projects.flatMap((project) =>
    project.projectId ? [{ value: project.projectId, label: project.name }] : [],
  )
  if (draft.projectId && !projectOptions.some((project) => project.value === draft.projectId)) {
    projectOptions.push({ value: draft.projectId, label: '项目不可用' })
  }
  const sessionOptions = props.sessions.map((session) => ({
    value: session.id,
    label: session.customTitle ?? session.aiTitle ?? session.sessionName ?? '未命名聊天',
  }))
  if (
    draft.targetThreadId &&
    !sessionOptions.some((session) => session.value === draft.targetThreadId)
  ) {
    sessionOptions.push({ value: draft.targetThreadId, label: '聊天不可用' })
  }
  const validation =
    props.creating && scheduleMode !== 'once'
      ? validateAutomationDraft(draft, scheduleMode, customRrule)
      : validate(draft)
  const unsaved =
    props.creating ||
    Boolean(validation || error) ||
    Boolean(props.task && JSON.stringify(draft) !== JSON.stringify(taskDefinition(props.task)))
  useEffect(() => {
    props.onUnsavedChange(unsaved)
  }, [props.onUnsavedChange, unsaved])

  async function save(): Promise<void> {
    if (validation) return
    setSaving(true)
    setError(null)
    try {
      if (props.creating) {
        if (scheduleMode === 'once') {
          const result = await desktopClient.createScheduledTask(draft)
          props.onChanged(result.scheduledTask)
        } else {
          let schedule: AutomationSchedule
          if (scheduleMode === 'daily') {
            schedule = { mode: 'daily', time: executionTime || '09:00' }
          } else if (scheduleMode === 'weekdays') {
            schedule = { mode: 'weekdays', time: executionTime || '09:00' }
          } else if (scheduleMode === 'weekly') {
            schedule = { mode: 'weekly', weekdays: [weeklyDay], time: executionTime || '09:00' }
          } else if (scheduleMode === 'hourly') {
            schedule = { mode: 'hourly', intervalMinutes: hourlyInterval }
          } else {
            schedule = { mode: 'custom', rrule: customRrule.trim() || 'FREQ=DAILY;INTERVAL=1' }
          }
          const result = await desktopClient.createAutomation({
            kind: draft.kind,
            name: draft.name,
            prompt: draft.prompt,
            projectId: draft.projectId,
            targetThreadId: draft.targetThreadId,
            execution: draft.execution,
            model: draft.model,
            reasoningEffort: draft.reasoningEffort,
            permissionConfig: draft.permissionConfig,
            schedule,
            timeZone: draft.timeZone,
            notificationPolicy: draft.notificationPolicy,
          })
          props.onAutomationCreated?.(result.automation.id)
        }
      } else {
        const result = await desktopClient.updateScheduledTask({
          id: props.task!.id,
          expectedRevision: props.task!.revision,
          ...draft,
        })
        props.onChanged(result.scheduledTask)
      }
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  async function updateStatus(status: 'scheduled' | 'paused'): Promise<void> {
    if (!props.task) return
    setSaving(true)
    try {
      const result = await desktopClient.updateScheduledTask({
        id: props.task.id,
        expectedRevision: props.task.revision,
        status,
      })
      props.onChanged(result.scheduledTask)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      className="automation-detail tw:grid tw:min-h-0 tw:min-w-0 tw:max-h-[min(35rem,calc(100vh-60px),var(--popover-available-height))] tw:grid-cols-[minmax(0,1fr)] tw:grid-rows-[auto_minmax(0,1fr)_auto] tw:bg-transparent"
      aria-label={props.creating ? '创建任务' : '计划任务详情'}
    >
      <header className="automation-detail-header tw:flex tw:min-h-[calc(var(--cpx-sys-space-8)+var(--cpx-sys-space-3))] tw:items-center tw:justify-between tw:gap-2 tw:border-b tw:border-app-border-subtle tw:p-3">
        <div className="automation-detail-title-group tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-2">
          {props.onBack ? (
            <Button
              className="automation-detail-back-btn tw:shrink-0"
              color="ghostSecondary"
              size={props.exitPending === 'back' ? 'compact' : 'toolbar'}
              uniform={props.exitPending !== 'back'}
              title={props.exitPending === 'back' ? '再按一次返回' : '返回当日议程'}
              aria-label={props.exitPending === 'back' ? '再按一次返回' : '返回当日议程'}
              onClick={props.onBack}
            >
              <ArrowLeft aria-hidden="true" size={APP_ICON_SIZE} />
              {props.exitPending === 'back' ? '再按一次返回' : null}
            </Button>
          ) : null}
          <h2
            className="tw:m-0 tw:min-w-0 tw:flex-1 tw:truncate tw:type-title-md tw:text-app-text"
            title={props.creating ? '创建任务' : props.task?.name}
          >
            {props.creating ? '创建任务' : props.task?.name}
          </h2>
        </div>
        <div className="automation-detail-header-actions tw:flex tw:shrink-0 tw:items-center tw:gap-2">
          {!props.creating && props.task ? (
            <span className="automation-status-pill tw:whitespace-nowrap tw:rounded-full tw:border tw:border-app-border-subtle tw:bg-app-panel tw:px-2 tw:py-1 tw:type-caption tw:text-app-text-soft">
              {calendarStatusLabel(props.task.status)}
            </span>
          ) : null}
          <Button
            color="ghostSecondary"
            size={props.exitPending === 'close' ? 'toolbarLabel' : 'toolbar'}
            uniform={props.exitPending !== 'close'}
            aria-label={props.exitPending === 'close' ? '再按一次退出' : '关闭详情'}
            onClick={props.onClose}
          >
            {props.exitPending === 'close' ? (
              '再按一次退出'
            ) : (
              <X aria-hidden="true" size={APP_ICON_SIZE} />
            )}
          </Button>
        </div>
      </header>
      <div className="automation-detail-scroll tw:min-h-0 tw:overflow-auto">
        <section className="automation-form tw:grid tw:gap-2 tw:p-3" aria-label="计划任务设置">
          <Field label="名称">
            <Input
              readOnly={!editable}
              value={draft.name}
              onChange={(event) => update({ name: event.currentTarget.value })}
            />
          </Field>
          <Field label="任务说明">
            <Textarea
              readOnly={!editable}
              rows={3}
              value={draft.prompt}
              onChange={(event) => update({ prompt: event.currentTarget.value })}
            />
          </Field>
          {props.creating ? (
            <Field label="排期">
              <Select
                ariaLabel="排期"
                value={scheduleMode}
                options={SCHEDULE_MODE_OPTIONS}
                onValueChange={(mode) => setScheduleMode(mode as ScheduleMode)}
              />
            </Field>
          ) : null}
          {!props.creating || scheduleMode === 'once' ? (
            <div
              className="automation-field tw:[&_.ui-select-trigger]:w-full tw:grid tw:min-w-0 tw:content-start tw:gap-1"
              role="group"
              aria-label="执行时间"
            >
              <span className="automation-field-label tw:type-control tw:text-app-text">
                执行时间
              </span>
              <div className="automation-execution-inputs tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(0,7.5rem)] tw:gap-2">
                <Input
                  aria-label="执行日期"
                  readOnly={!editable}
                  type="date"
                  value={executionDate}
                  onChange={(event) => updateExecution(event.currentTarget.value, executionTime)}
                />
                <Input
                  aria-label="执行时刻"
                  readOnly={!editable}
                  type="time"
                  step={60}
                  value={executionTime}
                  onChange={(event) => updateExecution(executionDate, event.currentTarget.value)}
                />
              </div>
            </div>
          ) : scheduleMode === 'daily' || scheduleMode === 'weekdays' ? (
            <div
              className="automation-field tw:[&_.ui-select-trigger]:w-full tw:grid tw:min-w-0 tw:content-start tw:gap-1"
              role="group"
              aria-label="执行时间"
            >
              <span className="automation-field-label tw:type-control tw:text-app-text">
                执行时间
              </span>
              <div className="automation-execution-inputs tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(0,7.5rem)] tw:gap-2">
                <Input
                  aria-label="执行时刻"
                  readOnly={!editable}
                  type="time"
                  step={60}
                  value={executionTime}
                  onChange={(event) => updateExecution(executionDate, event.currentTarget.value)}
                />
              </div>
            </div>
          ) : scheduleMode === 'weekly' ? (
            <div className="automation-form-grid tw:grid tw:grid-cols-[minmax(0,1fr)] tw:gap-2">
              <Field label="每周执行日">
                <Select
                  ariaLabel="每周执行日"
                  value={weeklyDay}
                  options={WEEKDAY_OPTIONS}
                  onValueChange={(v) => setWeeklyDay(v as AutomationWeekday)}
                />
              </Field>
              <div
                className="automation-field tw:[&_.ui-select-trigger]:w-full tw:grid tw:min-w-0 tw:content-start tw:gap-1"
                role="group"
                aria-label="执行时间"
              >
                <span className="automation-field-label tw:type-control tw:text-app-text">
                  执行时间
                </span>
                <div className="automation-execution-inputs tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(0,7.5rem)] tw:gap-2">
                  <Input
                    aria-label="执行时刻"
                    readOnly={!editable}
                    type="time"
                    step={60}
                    value={executionTime}
                    onChange={(event) => updateExecution(executionDate, event.currentTarget.value)}
                  />
                </div>
              </div>
            </div>
          ) : scheduleMode === 'hourly' ? (
            <Field label="间隔（分钟）">
              <Input
                type="number"
                min={15}
                value={hourlyInterval}
                onChange={(event) =>
                  setHourlyInterval(Math.max(15, Number(event.currentTarget.value) || 15))
                }
              />
            </Field>
          ) : scheduleMode === 'custom' ? (
            <Field label="RFC 5545 RRULE">
              <Input
                value={customRrule}
                onChange={(event) => setCustomRrule(event.currentTarget.value)}
              />
            </Field>
          ) : null}
          {draft.kind === 'standalone' ? (
            <Field label="项目">
              <Select
                triggerClassName={
                  !editable
                    ? 'automation-readonly-control tw:disabled:cursor-default tw:disabled:text-app-text tw:disabled:opacity-100'
                    : undefined
                }
                ariaLabel="项目"
                disabled={!editable}
                searchable
                value={draft.projectId ?? ''}
                options={projectOptions}
                onValueChange={(projectId) => update({ projectId: projectId || null })}
              />
            </Field>
          ) : (
            <Field label="目标聊天">
              <Select
                triggerClassName={
                  !editable
                    ? 'automation-readonly-control tw:disabled:cursor-default tw:disabled:text-app-text tw:disabled:opacity-100'
                    : undefined
                }
                ariaLabel="目标聊天"
                disabled={!editable}
                searchable
                value={draft.targetThreadId ?? ''}
                options={sessionOptions}
                onValueChange={(targetThreadId) =>
                  update({ targetThreadId: targetThreadId || null })
                }
              />
            </Field>
          )}
          <div className="automation-more-settings tw:px-3 tw:py-2">
            <Button
              color="ghostTertiary"
              size="default"
              aria-expanded={settingsOpen}
              aria-controls={settingsId}
              onClick={() => setSettingsOpen((value) => !value)}
            >
              更多设置
            </Button>
            <div id={settingsId} className="tw:mt-2" hidden={!settingsOpen}>
              <div className="automation-form-grid tw:grid tw:grid-cols-[minmax(0,1fr)] tw:gap-2">
                <Field label="运行方式">
                  <Select
                    triggerClassName={
                      !editable
                        ? 'automation-readonly-control tw:disabled:cursor-default tw:disabled:text-app-text tw:disabled:opacity-100'
                        : undefined
                    }
                    ariaLabel="运行方式"
                    disabled={!editable}
                    value={draft.kind}
                    options={[
                      { value: 'standalone', label: '独立任务' },
                      { value: 'thread', label: '续接聊天' },
                    ]}
                    onValueChange={(kind) =>
                      update({
                        kind,
                        projectId:
                          kind === 'standalone'
                            ? (draft.projectId ?? props.projects[0]?.projectId ?? null)
                            : null,
                        targetThreadId:
                          kind === 'thread'
                            ? (draft.targetThreadId ?? props.sessions[0]?.id ?? null)
                            : null,
                        execution:
                          kind === 'standalone' ? (draft.execution ?? { kind: 'local' }) : null,
                      })
                    }
                  />
                </Field>

                <div className="automation-form-grid tw:grid tw:grid-cols-[minmax(0,1fr)] tw:gap-2">
                  <Field label="执行位置">
                    <Select
                      triggerClassName={
                        !editable
                          ? 'automation-readonly-control tw:disabled:cursor-default tw:disabled:text-app-text tw:disabled:opacity-100'
                          : undefined
                      }
                      ariaLabel="执行位置"
                      disabled={!editable || draft.kind === 'thread'}
                      value={draft.execution?.kind ?? 'local'}
                      options={[
                        { value: 'local', label: '主工作区' },
                        { value: 'new-worktree', label: '新 Worktree' },
                      ]}
                      onValueChange={(kind) =>
                        update({
                          execution: kind === 'local' ? { kind } : { kind, branchName: 'main' },
                        })
                      }
                    />
                  </Field>
                  {draft.execution?.kind === 'new-worktree' ? (
                    <Field label="基础分支">
                      <Input
                        readOnly={!editable}
                        value={draft.execution.branchName}
                        onChange={(event) =>
                          update({
                            execution: {
                              kind: 'new-worktree',
                              branchName: event.currentTarget.value,
                            },
                          })
                        }
                      />
                    </Field>
                  ) : null}
                  <Field label="通知">
                    <Select
                      triggerClassName={
                        !editable
                          ? 'automation-readonly-control tw:disabled:cursor-default tw:disabled:text-app-text tw:disabled:opacity-100'
                          : undefined
                      }
                      ariaLabel="通知策略"
                      disabled={!editable}
                      value={draft.notificationPolicy}
                      options={[
                        { value: 'all', label: '全部结果' },
                        { value: 'failures', label: '仅失败' },
                        { value: 'off', label: '关闭' },
                      ]}
                      onValueChange={(notificationPolicy) => update({ notificationPolicy })}
                    />
                  </Field>
                </div>
                <div className="automation-form-grid tw:grid tw:grid-cols-[minmax(0,1fr)] tw:gap-2">
                  <Field label="推理强度">
                    <Select
                      triggerClassName={
                        !editable
                          ? 'automation-readonly-control tw:disabled:cursor-default tw:disabled:text-app-text tw:disabled:opacity-100'
                          : undefined
                      }
                      ariaLabel="推理强度"
                      disabled={!editable}
                      value={draft.reasoningEffort ?? ''}
                      options={[
                        { value: '', label: '模型默认' },
                        { value: 'low', label: '低' },
                        { value: 'medium', label: '中' },
                        { value: 'high', label: '高' },
                        { value: 'xhigh', label: '极高' },
                      ]}
                      onValueChange={(value) => update({ reasoningEffort: value || null })}
                    />
                  </Field>
                  <Field label="文件访问范围">
                    <Select
                      triggerClassName={
                        !editable
                          ? 'automation-readonly-control tw:disabled:cursor-default tw:disabled:text-app-text tw:disabled:opacity-100'
                          : undefined
                      }
                      ariaLabel="文件访问范围"
                      disabled={!editable}
                      value={draft.permissionConfig.sandboxMode}
                      options={[
                        { value: 'read-only', label: '只读' },
                        { value: 'workspace-write', label: '工作区写入' },
                        { value: 'danger-full-access', label: '完全访问' },
                      ]}
                      onValueChange={(sandboxMode) =>
                        update({
                          permissionConfig: {
                            ...draft.permissionConfig,
                            sandboxMode,
                            approvalPolicy: 'never',
                          },
                        })
                      }
                    />
                  </Field>
                </div>
              </div>
            </div>
          </div>
          {draft.permissionConfig.sandboxMode === 'danger-full-access' ? (
            <div
              className="automation-risk tw:flex tw:items-start tw:gap-2 tw:rounded-container tw:border tw:border-app-warning-border tw:bg-app-warning-subtle tw:p-3 tw:type-body-sm tw:text-app-warning-fg"
              role="note"
            >
              <AlertTriangle
                className="tw:mt-1 tw:flex-none"
                aria-hidden="true"
                size={APP_ICON_SIZE}
              />
              <span>任务会在无人值守时获得完全访问权限。</span>
            </div>
          ) : null}
          {error || (editable && !Number.isFinite(draft.scheduledFor)) ? (
            <p
              className="automation-field-error tw:m-0 tw:type-caption tw:text-app-danger-fg"
              role="alert"
            >
              {error ?? '请选择执行时间。'}
            </p>
          ) : null}
        </section>
      </div>
      <footer className="automation-form-actions automation-detail-footer tw:flex tw:min-h-8 tw:flex-wrap tw:items-center tw:justify-end tw:gap-2 tw:border-t tw:border-app-border-subtle tw:px-3 tw:py-2">
        {!props.creating && props.task ? (
          <>
            {editable ? (
              <Button
                color="ghostSecondary"
                onClick={() =>
                  void updateStatus(props.task?.status === 'paused' ? 'scheduled' : 'paused')
                }
              >
                {props.task.status === 'paused' ? '恢复' : '暂停'}
              </Button>
            ) : null}
            {props.task.threadId ? (
              <Button color="secondary" onClick={() => props.onOpenThread(props.task!.threadId!)}>
                打开执行任务
              </Button>
            ) : null}
            {props.task.status === 'scheduled' || props.task.status === 'paused' ? (
              <Button
                color="secondary"
                onClick={() =>
                  void desktopClient
                    .runScheduledTask({ id: props.task!.id })
                    .then((result) => props.onChanged(result.scheduledTask))
                    .catch((cause) => setError(errorMessage(cause)))
                }
              >
                <Play aria-hidden="true" size={APP_ICON_SIZE} />
                立即运行
              </Button>
            ) : null}
            {editable ? (
              <Button
                color="primary"
                disabled={Boolean(validation)}
                loading={saving}
                onClick={() => void save()}
              >
                保存
              </Button>
            ) : null}
            {editable ? (
              <Button
                isIconOnly
                color="danger"
                size="toolbar"
                title="删除计划任务"
                onClick={() =>
                  void desktopClient
                    .deleteScheduledTask({
                      id: props.task!.id,
                      expectedRevision: props.task!.revision,
                    })
                    .then(props.onDeleted)
                    .catch((cause) => setError(errorMessage(cause)))
                }
              >
                <Trash2 aria-hidden="true" size={APP_ICON_SIZE} />
              </Button>
            ) : null}
          </>
        ) : (
          <Button
            color="primary"
            disabled={Boolean(validation)}
            loading={saving}
            onClick={() => void save()}
          >
            <CalendarClock aria-hidden="true" size={APP_ICON_SIZE} />
            创建任务
          </Button>
        )}
      </footer>
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.ReactNode {
  return (
    <label className="automation-field tw:[&_.ui-select-trigger]:w-full tw:grid tw:min-w-0 tw:content-start tw:gap-1">
      <span className="automation-field-label tw:type-control tw:text-app-text">{label}</span>
      {children}
      {hint ? (
        <span className="automation-field-hint tw:type-caption tw:text-app-text-meta">{hint}</span>
      ) : null}
    </label>
  )
}

export function taskDefinition(task: ScheduledTaskDefinition): ScheduledTaskDefinition {
  const {
    kind,
    name,
    prompt,
    projectId,
    targetThreadId,
    execution,
    model,
    reasoningEffort,
    permissionConfig,
    scheduledFor,
    timeZone,
    notificationPolicy,
  } = task
  return {
    kind,
    name,
    prompt,
    projectId,
    targetThreadId,
    execution,
    model,
    reasoningEffort,
    permissionConfig,
    scheduledFor,
    timeZone,
    notificationPolicy,
  }
}

function validateAutomationDraft(
  draft: ScheduledTaskDefinition,
  mode: ScheduleMode,
  rrule: string,
): string | null {
  if (!draft.name.trim()) return '请输入计划任务名称。'
  if (!draft.prompt.trim()) return '请输入要执行的任务。'
  if (draft.kind === 'standalone' && !draft.projectId) return '请选择项目。'
  if (draft.kind === 'thread' && !draft.targetThreadId) return '请选择目标聊天。'
  if (mode === 'custom' && !rrule.trim()) return '请输入 RRULE 规则。'
  return null
}

function validate(draft: ScheduledTaskDefinition): string | null {
  if (!draft.name.trim()) return '请输入计划任务名称。'
  if (!draft.prompt.trim()) return '请输入要执行的任务。'
  if (!Number.isFinite(draft.scheduledFor)) return '请选择执行时间。'
  if (draft.kind === 'standalone' && !draft.projectId) return '请选择项目。'
  if (draft.kind === 'thread' && !draft.targetThreadId) return '请选择目标聊天。'
  return null
}

function toLocalDateTime(value: number): string {
  if (!Number.isFinite(value)) return ''
  const date = new Date(value - new Date(value).getTimezoneOffset() * 60_000)
  return date.toISOString().slice(0, 16)
}
