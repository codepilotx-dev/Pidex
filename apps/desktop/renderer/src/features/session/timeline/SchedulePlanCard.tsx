import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { CalendarCheck2, ExternalLink, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type {
  SchedulePlanExecutionDefaults,
  SchedulePlanItemDraft,
  SchedulePlanProposal,
} from '@pidex/shared/schedule-plan'
import type { AutomationSchedule } from '@pidex/shared/automation'
import type { Item } from '@pidex/shared/thread'
import { Button } from '../../../components/ui/Button.js'
import { Input } from '../../../components/ui/Input.js'
import { Select } from '../../../components/ui/Select.js'
import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import { desktopClient } from '../../../services/desktop-client/index.js'

type ToolItem = Extract<Item, { type: 'tool' }>

export function isSchedulePlanTool(item: ToolItem): boolean {
  return (
    (item.tool === 'schedule_plan.propose' || item.tool === 'schedule_plan_propose') &&
    proposalFromTool(item) !== null
  )
}

export function SchedulePlanCard({ item }: { item: ToolItem }): React.ReactNode {
  const navigate = useNavigate()
  const initial = useMemo(() => proposalFromTool(item), [item])
  const [proposal, setProposal] = useState<SchedulePlanProposal | null>(initial)
  const [items, setItems] = useState<SchedulePlanItemDraft[]>(initial ? [...initial.items] : [])
  const [defaults, setDefaults] = useState<SchedulePlanExecutionDefaults | null>(
    initial?.defaults ?? null,
  )
  const [projects, setProjects] = useState<Array<{ projectId: string; name: string }>>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const id = initial?.id
    if (!id) return
    void desktopClient
      .readSchedulePlan({ id })
      .then((result) => {
        setProposal(result.proposal)
        setItems([...result.proposal.items])
        setDefaults(result.proposal.defaults)
      })
      .catch(() => undefined)
  }, [initial?.id])
  useEffect(() => {
    void desktopClient
      .listProjects()
      .then((values) =>
        setProjects(
          values.flatMap((project) =>
            project.projectId ? [{ projectId: project.projectId, name: project.name }] : [],
          ),
        ),
      )
      .catch(() => undefined)
  }, [])

  if (!proposal || !defaults) return null
  const committed = proposal.status === 'committed'
  const enabledCount = items.filter((candidate) => candidate.enabled).length

  function patchItem(key: string, patch: Partial<SchedulePlanItemDraft>): void {
    setItems((current) =>
      current.map((candidate) =>
        candidate.key === key ? ({ ...candidate, ...patch } as SchedulePlanItemDraft) : candidate,
      ),
    )
  }

  function changeKind(candidate: SchedulePlanItemDraft, kind: SchedulePlanItemDraft['kind']): void {
    if (candidate.kind === kind) return
    patchItem(
      candidate.key,
      kind === 'one-off'
        ? { kind, scheduledFor: Date.now() + 60 * 60_000 }
        : {
            kind,
            schedule: { mode: 'daily', time: localTime(Date.now() + 60 * 60_000) },
            timeZone: defaults!.timeZone,
          },
    )
  }

  async function commit(): Promise<void> {
    setBusy(true)
    setMessage(null)
    try {
      const result = await desktopClient.commitSchedulePlan({
        id: proposal!.id,
        expectedRevision: proposal!.revision,
        defaults: defaults!,
        items,
      })
      setProposal(result.proposal)
      setMessage('日程已创建')
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : '确认失败'
      if (text.includes('CONFLICT') || text.includes('冲突')) {
        const result = await desktopClient.readSchedulePlan({ id: proposal!.id })
        setProposal(result.proposal)
        setMessage('草案已被更新；你的本地编辑已保留，请重新确认。')
      } else setMessage(text)
    } finally {
      setBusy(false)
    }
  }

  function openCalendar(): void {
    const earliest = items
      .filter((candidate) => candidate.enabled)
      .reduce<number | null>((value, candidate) => {
        const time = candidate.kind === 'one-off' ? candidate.scheduledFor : Date.now()
        return value === null ? time : Math.min(value, time)
      }, null)
    navigate(
      `/automations?date=${localDate(earliest ?? Date.now())}&proposalId=${encodeURIComponent(proposal!.id)}`,
    )
  }

  return (
    <article
      className="schedule-plan-card tw:grid tw:overflow-hidden tw:rounded-container tw:border tw:border-app-border tw:bg-app-panel tw:text-app-text"
      data-state={proposal.status}
    >
      <header className="tw:flex tw:items-center tw:gap-2 tw:border-b tw:border-app-border-subtle tw:p-3">
        <span
          className="schedule-plan-card__icon tw:grid tw:size-6 tw:place-items-center tw:rounded-container tw:border tw:border-app-info-border tw:bg-app-info-subtle tw:text-app-info-fg"
          aria-hidden="true"
        >
          <CalendarCheck2 className="tw:size-[var(--inline-icon-size,1em)]" size={APP_ICON_SIZES.sm} />
        </span>
        <div className="tw:grid tw:min-w-0 tw:flex-1 tw:gap-1">
          <strong>{committed ? '日程已创建' : '确认任务规划'}</strong>
          <span className="tw:type-caption tw:text-app-text-meta">
            {horizonLabel(proposal.horizon)} · {enabledCount}/{items.length} 项已启用
          </span>
        </div>
        {committed ? (
          <Button color="secondary" size="compact" onClick={openCalendar}>
            打开
            <ExternalLink aria-hidden="true" size={APP_ICON_SIZES.sm} />
          </Button>
        ) : null}
      </header>
      <ol className="schedule-plan-card__items tw:m-0 tw:grid tw:max-h-104 tw:list-none tw:overflow-auto tw:p-0">
        {items.map((candidate) => (
          <li
            className="tw:grid tw:grid-cols-[auto_minmax(0,1fr)] tw:items-start tw:gap-2 tw:border-b tw:border-app-border-subtle tw:p-3 tw:opacity-62 tw:data-[enabled]:opacity-100"
            key={candidate.key}
            data-enabled={candidate.enabled || undefined}
          >
            <input
              className="tw:mt-2"
              aria-label={`${candidate.name} 启用`}
              checked={candidate.enabled}
              disabled={committed}
              type="checkbox"
              onChange={(event) =>
                patchItem(candidate.key, { enabled: event.currentTarget.checked })
              }
            />
            <div className="schedule-plan-card__item-body tw:grid tw:min-w-0 tw:gap-2">
              <Input
                aria-label="任务名称"
                disabled={committed}
                value={candidate.name}
                onChange={(event) => patchItem(candidate.key, { name: event.currentTarget.value })}
              />
              <span className="tw:type-caption tw:text-app-text-meta">{candidate.prompt}</span>
              <div className="schedule-plan-card__item-controls tw:grid tw:grid-cols-4 tw:gap-2 tw:max-[48rem]:grid-cols-1">
                <Select
                  ariaLabel="任务类型"
                  disabled={committed}
                  value={candidate.kind}
                  options={[
                    { value: 'one-off', label: '一次性' },
                    { value: 'recurring', label: '重复' },
                  ]}
                  onValueChange={(kind) => changeKind(candidate, kind)}
                />
                {candidate.kind === 'one-off' ? (
                  <Input
                    aria-label="执行时间"
                    className="tw:col-span-3 tw:max-[48rem]:col-span-1"
                    disabled={committed}
                    type="datetime-local"
                    value={localDateTime(candidate.scheduledFor)}
                    onChange={(event) =>
                      patchItem(candidate.key, {
                        scheduledFor: new Date(event.currentTarget.value).getTime(),
                      })
                    }
                  />
                ) : (
                  <>
                    <Select
                      ariaLabel="重复频率"
                      disabled={committed}
                      value={candidate.schedule.mode}
                      options={[
                        { value: 'hourly', label: '每小时' },
                        { value: 'daily', label: '每天' },
                        { value: 'weekdays', label: '工作日' },
                        { value: 'weekly', label: '每周' },
                        { value: 'custom', label: '自定义' },
                      ]}
                      onValueChange={(mode) =>
                        patchItem(candidate.key, { schedule: scheduleForMode(mode) })
                      }
                    />
                    {candidate.schedule.mode === 'hourly' ? (
                      <Input
                        aria-label="间隔分钟"
                        disabled={committed}
                        min={1}
                        type="number"
                        value={candidate.schedule.intervalMinutes}
                        onChange={(event) =>
                          patchItem(candidate.key, {
                            schedule: {
                              mode: 'hourly',
                              intervalMinutes: Math.max(1, Number(event.currentTarget.value) || 1),
                            },
                          })
                        }
                      />
                    ) : candidate.schedule.mode === 'custom' ? (
                      <Input
                        aria-label="RRULE"
                        disabled={committed}
                        value={candidate.schedule.rrule}
                        onChange={(event) =>
                          patchItem(candidate.key, {
                            schedule: { mode: 'custom', rrule: event.currentTarget.value },
                          })
                        }
                      />
                    ) : (
                      <Input
                        aria-label="执行时间"
                        disabled={committed}
                        type="time"
                        value={candidate.schedule.time}
                        onChange={(event) =>
                          patchItem(candidate.key, {
                            schedule: withScheduleTime(
                              candidate.schedule,
                              event.currentTarget.value,
                            ),
                          })
                        }
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
      {!committed ? (
        <section
          className="schedule-plan-card__defaults tw:grid tw:grid-cols-4 tw:items-center tw:gap-2 tw:border-b tw:border-app-border-subtle tw:p-3 tw:max-[48rem]:grid-cols-1"
          aria-label="整批运行设置"
        >
          <strong className="tw:col-span-full tw:type-label">整批运行设置</strong>
          {defaults.kind === 'standalone' ? (
            <Select
              ariaLabel="项目"
              disabled={busy}
              searchable
              value={defaults.projectId ?? ''}
              options={projects.map((project) => ({
                value: project.projectId,
                label: project.name,
              }))}
              onValueChange={(projectId) =>
                setDefaults((current) =>
                  current ? { ...current, projectId: projectId || null } : current,
                )
              }
            />
          ) : (
            <span className="tw:type-caption tw:text-app-text-meta">续接当前聊天</span>
          )}
          {defaults.kind === 'standalone' ? (
            <Select
              ariaLabel="执行位置"
              disabled={busy}
              value={defaults.execution?.kind ?? 'local'}
              options={[
                { value: 'local', label: '主工作区' },
                { value: 'new-worktree', label: '新 Worktree' },
              ]}
              onValueChange={(kind) =>
                setDefaults((current) =>
                  current
                    ? {
                        ...current,
                        execution: kind === 'local' ? { kind } : { kind, branchName: 'main' },
                      }
                    : current,
                )
              }
            />
          ) : null}
          <Select
            ariaLabel="文件访问范围"
            disabled={busy}
            value={defaults.permissionConfig.sandboxMode}
            options={[
              { value: 'read-only', label: '只读' },
              { value: 'workspace-write', label: '工作区写入' },
              { value: 'danger-full-access', label: '完全访问' },
            ]}
            onValueChange={(sandboxMode) =>
              setDefaults((current) =>
                current
                  ? {
                      ...current,
                      permissionConfig: {
                        ...current.permissionConfig,
                        sandboxMode,
                        approvalPolicy: 'never',
                      },
                    }
                  : current,
              )
            }
          />
          <Select
            ariaLabel="通知策略"
            disabled={busy}
            value={defaults.notificationPolicy}
            options={[
              { value: 'all', label: '全部结果' },
              { value: 'failures', label: '仅失败' },
              { value: 'off', label: '关闭' },
            ]}
            onValueChange={(notificationPolicy) =>
              setDefaults((current) => (current ? { ...current, notificationPolicy } : current))
            }
          />
        </section>
      ) : null}
      <footer className="tw:flex tw:items-center tw:justify-between tw:gap-2 tw:p-3">
        {message ? (
          <span className="tw:type-caption tw:text-app-text-meta" role="status">
            {message}
          </span>
        ) : (
          <span className="tw:type-caption tw:text-app-text-meta">确认前不会创建或执行任务。</span>
        )}
        {!committed ? (
          <Button
            color="primary"
            disabled={!enabledCount}
            loading={busy}
            onClick={() => void commit()}
          >
            <RefreshCw aria-hidden="true" size={APP_ICON_SIZE} />
            确认创建
          </Button>
        ) : null}
      </footer>
    </article>
  )
}

function proposalFromTool(item: ToolItem): SchedulePlanProposal | null {
  if (!item.output) return null
  try {
    const parsed = JSON.parse(item.output) as { proposal?: SchedulePlanProposal }
    return parsed.proposal ?? null
  } catch {
    return null
  }
}

function scheduleForMode(mode: 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom') {
  if (mode === 'hourly') return { mode, intervalMinutes: 60 } as const
  if (mode === 'custom') return { mode, rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0' } as const
  if (mode === 'weekly') return { mode, weekdays: ['MO'] as ['MO'], time: '09:00' } as const
  return { mode, time: '09:00' } as const
}

function withScheduleTime(schedule: AutomationSchedule, time: string): AutomationSchedule {
  if (schedule.mode === 'weekly') return { ...schedule, time }
  if (schedule.mode === 'daily' || schedule.mode === 'weekdays') return { ...schedule, time }
  return schedule
}

function localDate(value: number): string {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localTime(value: number): string {
  const date = new Date(value)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function localDateTime(value: number): string {
  return `${localDate(value)}T${localTime(value)}`
}

function horizonLabel(value: SchedulePlanProposal['horizon']): string {
  return { day: '一天规划', week: '一周规划', month: '一月规划', year: '一年规划' }[value]
}
