import { useEffect, useId, useState } from 'react'
import { ArrowLeft, AlertTriangle, Check, Play, RotateCcw, X } from 'lucide-react'
import type React from 'react'
import type { AutomationRun } from '@pidex/shared/automation'
import type { RpcResult } from '@pidex/agent-protocol'
import { environmentDomainClient } from '../../services/desktop-client/EnvironmentDomainClient.js'
import { Button } from '../../components/ui/Button.js'
import { Input } from '../../components/ui/Input.js'
import { Select } from '../../components/ui/Select.js'
import { Textarea } from '../../components/ui/Textarea.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../components/ui/IconTokens.js'
import type { AutomationController } from './UseAutomationController.js'
import {
  automationScheduleSummary,
  formatAutomationTime,
  runStatusLabel,
  runTriggerLabel,
  type AutomationDraft,
} from './AutomationModel.js'

type Props = {
  creating: boolean
  controller: Pick<
    AutomationController,
    | 'selected'
    | 'runs'
    | 'draft'
    | 'setDraft'
    | 'scheduleError'
    | 'scheduleSummary'
    | 'projects'
    | 'sessions'
    | 'error'
    | 'saveState'
    | 'draftError'
    | 'create'
    | 'retrySave'
    | 'markAllRunsRead'
    | 'markRunRead'
  >
  onClose: () => void
  exitPending: 'back' | 'close' | null
  onBack?: () => void
  onCreated: (id: string) => void
  onOpenThread: (id: string) => void
}

const SCHEDULE_OPTIONS = [
  { value: 'hourly', label: '每小时' },
  { value: 'daily', label: '每天' },
  { value: 'weekdays', label: '工作日' },
  { value: 'weekly', label: '每周' },
  { value: 'custom', label: '自定义 RRULE' },
] as const

export function AutomationDetailPanel({
  creating,
  controller,
  onClose,
  exitPending,
  onBack,
  onCreated,
  onOpenThread,
}: Props): React.ReactNode {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [watch, setWatch] = useState<RpcResult<'github/watch/read'> | null>(null)
  useEffect(() => {
    let active = true
    setWatch(null)
    if (controller.selected)
      void environmentDomainClient()
        .listPrWatches()
        .then((result) => {
          if (active)
            setWatch(
              result.watches.find((item) => item.automation.id === controller.selected?.id) ?? null,
            )
        })
        .catch(() => undefined)
    return () => {
      active = false
    }
  }, [controller.selected?.id, controller.selected?.updatedAt, controller.runs])
  const settingsId = useId()
  useEffect(() => setSettingsOpen(false), [controller.selected?.id, creating])
  const draft = controller.draft

  if (!draft) return null
  const update = (patch: Partial<AutomationDraft>): void =>
    controller.setDraft({ ...draft, ...patch })
  const runs = controller.selected
    ? controller.runs.filter((run) => run.automationId === controller.selected?.id)
    : []

  return (
    <section
      className="automation-detail tw:grid tw:min-h-0 tw:min-w-0 tw:max-h-[min(35rem,calc(100vh-60px),var(--popover-available-height))] tw:grid-cols-[minmax(0,1fr)] tw:grid-rows-[auto_minmax(0,1fr)_auto] tw:bg-transparent"
      aria-label={creating ? '创建自动化' : '自动化详情'}
    >
      <header className="automation-detail-header tw:flex tw:min-h-[calc(var(--cpx-sys-space-8)+var(--cpx-sys-space-3))] tw:items-center tw:justify-between tw:gap-2 tw:border-b tw:border-app-border-subtle tw:p-3">
        <div className="automation-detail-title-group tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-2">
          {onBack ? (
            <Button
              className="automation-detail-back-btn tw:shrink-0"
              color="ghostSecondary"
              size={exitPending === 'back' ? 'compact' : 'toolbar'}
              uniform={exitPending !== 'back'}
              title={exitPending === 'back' ? '再按一次返回' : '返回当日议程'}
              aria-label={exitPending === 'back' ? '再按一次返回' : '返回当日议程'}
              onClick={onBack}
            >
              <ArrowLeft aria-hidden="true" size={APP_ICON_SIZE} />
              {exitPending === 'back' ? '再按一次返回' : null}
            </Button>
          ) : null}
          <h2
            className="tw:m-0 tw:min-w-0 tw:flex-1 tw:truncate tw:type-title-md tw:text-app-text"
            title={creating ? '创建自动化' : controller.selected?.name}
          >
            {creating ? '创建自动化' : controller.selected?.name}
          </h2>
        </div>
        <div className="automation-detail-header-actions tw:flex tw:shrink-0 tw:items-center tw:gap-2">
          {!creating && controller.selected ? (
            <span className="automation-status-pill tw:whitespace-nowrap tw:rounded-full tw:border tw:border-app-border-subtle tw:bg-app-panel tw:px-2 tw:py-1 tw:type-caption tw:text-app-text-soft">
              {
                {
                  active: '已开启',
                  paused: '已暂停',
                  deleted: '已删除',
                }[controller.selected.status]
              }
            </span>
          ) : null}
          <Button
            color="ghostSecondary"
            size={exitPending === 'close' ? 'toolbarLabel' : 'toolbar'}
            uniform={exitPending !== 'close'}
            aria-label={exitPending === 'close' ? '再按一次退出' : '关闭详情'}
            onClick={onClose}
          >
            {exitPending === 'close' ? (
              '再按一次退出'
            ) : (
              <X aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            )}
          </Button>
        </div>
      </header>

      <div className="automation-detail-scroll tw:min-h-0 tw:overflow-auto">
        <section className="automation-form tw:grid tw:gap-2 tw:p-3" aria-label="自动化设置">
          <FormField label="名称">
            <Input
              value={draft.name}
              onChange={(event) => update({ name: event.currentTarget.value })}
            />
          </FormField>
          {watch && (
            <div className="tw:grid tw:gap-2 tw:rounded-control tw:border tw:border-app-border-subtle tw:bg-app-panel tw:p-3">
              <span className="tw:type-row-title">PR 监控</span>
              <span className="tw:type-caption tw:break-all tw:text-app-text-soft">
                {watch.url}
              </span>
              {watch.reason && (
                <p className="tw:m-0 tw:type-caption tw:text-app-text-soft">{watch.reason}</p>
              )}
              <Button color="secondary" onClick={() => onOpenThread(watch.threadId)}>
                打开关联修复聊天
              </Button>
            </div>
          )}
          <FormField label="任务说明">
            <Textarea
              rows={3}
              disabled={watch !== null}
              value={draft.prompt}
              onChange={(event) => update({ prompt: event.currentTarget.value })}
            />
          </FormField>
          <div className="automation-form-grid tw:grid tw:grid-cols-[minmax(0,1fr)] tw:gap-2">
            <FormField label="排期">
              <Select
                ariaLabel="排期"
                value={draft.schedule.mode}
                options={SCHEDULE_OPTIONS}
                onValueChange={(mode) => update({ schedule: defaultSchedule(mode) })}
              />
            </FormField>
            {draft.schedule.mode === 'hourly' ? (
              <FormField label="间隔（分钟）">
                <Input
                  type="number"
                  min={watch ? 5 : 15}
                  value={draft.schedule.intervalMinutes}
                  onChange={(event) =>
                    update({
                      schedule: {
                        mode: 'hourly',
                        intervalMinutes: Math.max(
                          watch ? 5 : 15,
                          Number(event.currentTarget.value) || (watch ? 5 : 15),
                        ),
                      },
                    })
                  }
                />
              </FormField>
            ) : draft.schedule.mode !== 'custom' ? (
              <FormField label="执行时间">
                <Input
                  type="time"
                  value={draft.schedule.time}
                  onChange={(event) =>
                    update({
                      schedule: withScheduleTime(draft.schedule, event.currentTarget.value),
                    })
                  }
                />
              </FormField>
            ) : null}
          </div>

          {draft.schedule.mode === 'weekly' ? (
            <FormField label="星期">
              <Select
                ariaLabel="每周执行日"
                value={draft.schedule.weekdays[0] ?? 'MO'}
                options={[
                  { value: 'MO', label: '周一' },
                  { value: 'TU', label: '周二' },
                  { value: 'WE', label: '周三' },
                  { value: 'TH', label: '周四' },
                  { value: 'FR', label: '周五' },
                  { value: 'SA', label: '周六' },
                  { value: 'SU', label: '周日' },
                ]}
                onValueChange={(weekday) =>
                  update({
                    schedule: {
                      mode: 'weekly',
                      weekdays: [weekday],
                      time: draft.schedule.mode === 'weekly' ? draft.schedule.time : '09:00',
                    },
                  })
                }
              />
            </FormField>
          ) : null}

          {draft.schedule.mode === 'custom' ? (
            <FormField label="RFC 5545 RRULE" hint="例如 FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=9">
              <Input
                aria-describedby="automation-rrule-error"
                invalid={Boolean(draft.schedule.rrule.trim() && controller.scheduleError)}
                value={draft.schedule.rrule}
                onChange={(event) =>
                  update({
                    schedule: {
                      mode: 'custom',
                      rrule: event.currentTarget.value,
                    },
                  })
                }
              />
              {draft.schedule.rrule.trim() && controller.scheduleError ? (
                <span id="automation-rrule-error" className="automation-field-error" role="alert">
                  {controller.scheduleError}
                </span>
              ) : null}
            </FormField>
          ) : null}

          <span className="automation-field-hint">
            {controller.scheduleSummary ?? automationScheduleSummary(draft.schedule)}
          </span>

          {draft.kind === 'standalone' ? (
            <FormField label="项目">
              <Select
                ariaLabel="项目"
                searchable
                value={draft.projectId ?? ''}
                options={controller.projects.flatMap((project) =>
                  project.projectId ? [{ value: project.projectId, label: project.name }] : [],
                )}
                onValueChange={(projectId) => update({ projectId: projectId || null })}
              />
            </FormField>
          ) : (
            <FormField label="目标聊天">
              <Select
                ariaLabel="目标聊天"
                searchable
                value={draft.targetThreadId ?? ''}
                options={controller.sessions.map((session) => ({
                  value: session.id,
                  label:
                    session.customTitle ?? session.aiTitle ?? session.sessionName ?? '未命名聊天',
                  detail: session.workspaceName,
                }))}
                onValueChange={(targetThreadId) =>
                  update({ targetThreadId: targetThreadId || null })
                }
              />
            </FormField>
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
                <FormField label="运行方式">
                  <Select
                    ariaLabel="运行方式"
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
                            ? (draft.projectId ?? controller.projects[0]?.projectId ?? null)
                            : null,
                        targetThreadId:
                          kind === 'thread'
                            ? (draft.targetThreadId ?? controller.sessions[0]?.id ?? null)
                            : null,
                        execution:
                          kind === 'standalone' ? (draft.execution ?? { kind: 'local' }) : null,
                      })
                    }
                  />
                </FormField>
                {draft.kind === 'standalone' ? (
                  <>
                    <FormField label="执行位置">
                      <Select
                        ariaLabel="执行位置"
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
                    </FormField>
                    {draft.execution?.kind === 'new-worktree' ? (
                      <FormField label="基础分支">
                        <Input
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
                      </FormField>
                    ) : null}
                  </>
                ) : null}

                <FormField label="时区">
                  <Input
                    value={draft.timeZone}
                    onChange={(event) => update({ timeZone: event.currentTarget.value })}
                  />
                </FormField>
                <FormField label="通知">
                  <Select
                    ariaLabel="通知策略"
                    value={draft.notificationPolicy}
                    options={[
                      { value: 'all', label: '全部结果' },
                      { value: 'failures', label: '仅失败' },
                      { value: 'off', label: '关闭' },
                    ]}
                    onValueChange={(notificationPolicy) => update({ notificationPolicy })}
                  />
                </FormField>

                <FormField label="推理强度">
                  <Select
                    ariaLabel="推理强度"
                    value={draft.reasoningEffort ?? ''}
                    options={[
                      { value: '', label: '模型默认' },
                      { value: 'low', label: '低' },
                      { value: 'medium', label: '中' },
                      { value: 'high', label: '高' },
                      { value: 'xhigh', label: '极高' },
                    ]}
                    onValueChange={(reasoningEffort) =>
                      update({ reasoningEffort: reasoningEffort || null })
                    }
                  />
                </FormField>
                <FormField label="文件访问范围">
                  <Select
                    ariaLabel="文件访问范围"
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
                </FormField>
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
              <span>任务会在无人值守时获得完全访问权限。请只对可信项目和明确任务使用。</span>
            </div>
          ) : null}

          {controller.error &&
          (controller.saveState === 'failed' || controller.saveState === 'conflict') ? (
            <p className="automation-field-error" role="alert">
              {controller.error}
            </p>
          ) : null}
        </section>

        {!creating && controller.selected ? (
          <details
            className="automation-more-settings tw:px-3 tw:py-2"
            key={controller.selected.id}
          >
            <summary className="tw:cursor-pointer tw:type-control">
              执行记录（{runs.length}）
            </summary>
            <RunHistory runs={runs} controller={controller} onOpenThread={onOpenThread} />
          </details>
        ) : null}
      </div>
      <footer className="automation-form-actions automation-detail-footer tw:flex tw:min-h-8 tw:flex-wrap tw:items-center tw:justify-end tw:gap-2 tw:border-t tw:border-app-border-subtle tw:px-3 tw:py-2">
        {creating ? (
          <Button
            color="primary"
            disabled={Boolean(controller.draftError)}
            loading={controller.saveState === 'saving'}
            onClick={() =>
              void controller.create().then((id) => {
                if (id) onCreated(id)
              })
            }
          >
            创建自动化
          </Button>
        ) : (
          <SaveIndicator controller={controller} />
        )}
      </footer>
    </section>
  )
}

function FormField({
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

function SaveIndicator({
  controller,
}: {
  controller: Pick<
    AutomationController,
    | 'selected'
    | 'runs'
    | 'draft'
    | 'setDraft'
    | 'scheduleError'
    | 'scheduleSummary'
    | 'projects'
    | 'sessions'
    | 'error'
    | 'saveState'
    | 'draftError'
    | 'create'
    | 'retrySave'
    | 'markAllRunsRead'
    | 'markRunRead'
  >
}): React.ReactNode {
  if (controller.saveState === 'saving')
    return (
      <span className="automation-save-state tw:inline-flex tw:items-center tw:gap-1">
        <RotateCcw
          className="tw:size-[var(--inline-icon-size,1em)]"
          size="var(--inline-icon-size, 1em)"
          aria-hidden="true"
        />
        正在保存…
      </span>
    )
  if (controller.saveState === 'failed' || controller.saveState === 'conflict') {
    return (
      <div className="automation-save-retry tw:flex tw:w-full tw:items-center tw:justify-between tw:gap-2 tw:type-caption tw:text-app-danger-fg">
        <span>
          {controller.saveState === 'conflict'
            ? '已有更新，草稿尚未覆盖。'
            : '保存失败，草稿已保留。'}
        </span>
        <Button color="secondary" size="compact" onClick={controller.retrySave}>
          重试保存
        </Button>
      </div>
    )
  }
  if (controller.saveState === 'saved')
    return (
      <span className="automation-save-state tw:inline-flex tw:items-center tw:gap-1">
        <Check
          className="tw:size-[var(--inline-icon-size,1em)]"
          size="var(--inline-icon-size, 1em)"
          aria-hidden="true"
        />
        已保存
      </span>
    )
  return (
    <span className="automation-save-state tw:inline-flex tw:items-center tw:gap-1">
      修改后自动保存
    </span>
  )
}

function RunHistory({
  runs,
  controller,
  onOpenThread,
}: {
  runs: readonly AutomationRun[]
  controller: Pick<
    AutomationController,
    | 'selected'
    | 'runs'
    | 'draft'
    | 'setDraft'
    | 'scheduleError'
    | 'scheduleSummary'
    | 'projects'
    | 'sessions'
    | 'error'
    | 'saveState'
    | 'draftError'
    | 'create'
    | 'retrySave'
    | 'markAllRunsRead'
    | 'markRunRead'
  >
  onOpenThread: (id: string) => void
}): React.ReactNode {
  return (
    <section
      className="automation-runs tw:mt-2 tw:grid tw:gap-3 tw:border-t tw:border-app-border-subtle tw:p-3"
      aria-labelledby="automation-runs-title"
    >
      <header className="tw:flex tw:items-center tw:justify-between tw:gap-3">
        <div className="tw:grid tw:gap-1">
          <span className="automation-eyebrow tw:uppercase tw:tracking-[0.08em] tw:type-caption tw:text-app-text-meta">
            收件箱
          </span>
          <h3 className="tw:m-0 tw:type-title-sm tw:text-app-text" id="automation-runs-title">
            运行记录
          </h3>
        </div>
        {runs.some((run) => !run.readAt) ? (
          <Button
            color="ghostSecondary"
            size="compact"
            onClick={() => void controller.markAllRunsRead()}
          >
            全部标为已读
          </Button>
        ) : null}
      </header>
      {runs.length ? (
        <ol className="tw:m-0 tw:grid tw:list-none tw:gap-2 tw:p-0">
          {runs.map((run) => (
            <li
              className="tw:group"
              key={run.id}
              data-status={run.status}
              data-unread={!run.readAt || undefined}
            >
              <button
                type="button"
                className="tw:grid tw:w-full tw:cursor-pointer tw:grid-cols-[minmax(0,1fr)_auto] tw:gap-x-3 tw:gap-y-1 tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-transparent tw:p-3 tw:text-left tw:text-app-text tw:hover:bg-app-hover tw:disabled:cursor-default"
                disabled={!run.threadId}
                onClick={() => {
                  if (run.threadId) onOpenThread(run.threadId)
                  if (!run.readAt) void controller.markRunRead(run.id)
                }}
              >
                <span className="automation-run-status tw:inline-flex tw:items-center tw:gap-2 tw:type-label">
                  <span className="automation-status-dot tw:size-2 tw:rounded-full tw:bg-app-info tw:group-data-[status=completed]:bg-app-success tw:group-data-[status=failed]:bg-app-danger tw:group-data-[status=interrupted]:bg-app-danger" />
                  {runStatusLabel(run.status)}
                </span>
                <span className="automation-run-trigger tw:type-caption tw:text-app-text-meta">
                  {runTriggerLabel(run.trigger)}
                </span>
                <time className="tw:col-start-2 tw:row-start-1 tw:type-caption tw:text-app-text-meta">
                  {formatAutomationTime(run.completedAt ?? run.startedAt ?? run.createdAt)}
                </time>
                {run.status === 'running' || run.status === 'queued' ? (
                  <Play
                    className="tw:col-start-2 tw:text-app-info-fg"
                    aria-hidden="true"
                    size={APP_ICON_SIZE}
                  />
                ) : null}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="automation-runs-empty tw:m-0 tw:type-caption tw:text-app-text-meta">
          首次运行后，结果会显示在这里。
        </p>
      )}
    </section>
  )
}

function defaultSchedule(
  mode: (typeof SCHEDULE_OPTIONS)[number]['value'],
): AutomationDraft['schedule'] {
  if (mode === 'hourly') return { mode, intervalMinutes: 60 }
  if (mode === 'daily') return { mode, time: '09:00' }
  if (mode === 'weekdays') return { mode, time: '09:00' }
  if (mode === 'weekly') return { mode, weekdays: ['MO'], time: '09:00' }
  return { mode, rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0' }
}

function withScheduleTime(
  schedule: AutomationDraft['schedule'],
  time: string,
): AutomationDraft['schedule'] {
  if (schedule.mode === 'daily') return { mode: 'daily', time }
  if (schedule.mode === 'weekdays') return { mode: 'weekdays', time }
  if (schedule.mode === 'weekly') return { mode: 'weekly', weekdays: schedule.weekdays, time }
  return schedule
}
