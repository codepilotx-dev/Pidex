import { useEffect, useState } from 'react'
import type React from 'react'
import { CirclePlay, Maximize2, Pause, Target, Trash2 } from 'lucide-react'
import { Button } from '../../../components/ui/Button.js'
import { APP_ICON_SIZES, APP_ICON_STROKE_WIDTH } from '../../../components/ui/IconTokens.js'
import type { DesktopThreadGoal } from '../../../../shared/Types.js'

type Props = {
  onOpenGoalPanel?: () => void
  sessionBusy?: boolean
  goal: DesktopThreadGoal
  onPause?: () => void | Promise<void>
  onResume?: () => void | Promise<void>
  onComplete?: () => void | Promise<void>
  onClear?: () => void | Promise<void>
}

export const GOAL_STATUS_LABELS: Record<DesktopThreadGoal['status'], string> = {
  active: '进行中的目标',
  paused: '已暂停的目标',
  blocked: '目标已停滞',
  'usage-limited': '目标使用受限',
  'budget-limited': '目标预算受限',
  complete: '已达成目标',
}

export function formatGoalDurationCompact(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    const remainder = seconds % 60
    return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`
  }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
}

const compactNumber = (value: number) =>
  new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)

/** Compact tabular token count shared by the goal row and the goal editor. */
export const compactTokenCount = compactNumber

const ROW_CLASS =
  'composer-goal-row tw:flex tw:w-full tw:min-w-0 tw:items-center tw:justify-between tw:gap-2 tw:px-2 tw:py-0.5'

export function ComposerGoalRow({
  goal,
  onOpenGoalPanel,
  sessionBusy,
  onPause,
  onResume,
  onClear,
}: Props): React.ReactNode {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setNow(Date.now())
    if (goal.status !== 'active' || !sessionBusy) return
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [goal.status, goal.updatedAt, sessionBusy])

  async function run(action?: () => void | Promise<void>) {
    if (!action || pending) return
    setPending(true)
    setError(null)
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '目标操作失败')
    } finally {
      setPending(false)
    }
  }

  if (goal.status === 'complete') return null

  const liveElapsedSeconds =
    goal.status === 'active' && sessionBusy
      ? goal.timeUsedSeconds + Math.max(0, Math.floor((now - goal.updatedAt) / 1000))
      : goal.timeUsedSeconds
  const metric =
    (goal.status === 'active' || goal.status === 'budget-limited') && goal.tokenBudget !== null
      ? `${compactNumber(goal.tokensUsed)} / ${compactNumber(goal.tokenBudget)}`
      : formatGoalDurationCompact(liveElapsedSeconds)

  const canResume =
    goal.status === 'paused' || goal.status === 'blocked' || goal.status === 'usage-limited'
  const canEdit = Boolean(onOpenGoalPanel)

  return (
    <>
      <section aria-label="当前目标" className={ROW_CLASS} data-composer-utility-item="goal">
        <button
          type="button"
          disabled={!canEdit || pending}
          onClick={onOpenGoalPanel}
          className="tw:m-0 tw:flex tw:min-w-0 tw:flex-1 tw:cursor-pointer tw:items-center tw:gap-1.5 tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:type-caption tw:disabled:cursor-default"
          title={goal.objective}
        >
          <span className="tw:inline-flex tw:shrink-0 tw:text-app-text-meta" aria-hidden="true">
            <Target size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </span>
          <span className="tw:shrink-0 tw:type-label tw:text-app-text">
            {GOAL_STATUS_LABELS[goal.status]}
          </span>
          <span className="tw:min-w-0 tw:truncate tw:text-app-text-soft">{goal.objective} •</span>
          <span
            title={
              goal.tokenBudget === null ||
              goal.status === 'paused' ||
              goal.status === 'blocked' ||
              goal.status === 'usage-limited'
                ? '目标累计执行时间'
                : '目标累计用量 / 预算上限'
            }
            className="tw:shrink-0 tw:whitespace-nowrap tw:tabular-nums tw:text-app-text-soft"
          >
            {metric}
          </span>
        </button>

        <div className="tw:flex tw:shrink-0 tw:items-center tw:gap-0.5">
          <Button
            isIconOnly
            aria-label="清除目标"
            color="ghostSecondary"
            size="xs"
            disabled={pending || !onClear}
            onClick={() => void run(onClear)}
            title="清除目标"
          >
            <Trash2 size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </Button>
          {goal.status === 'active' ? (
            <Button
              isIconOnly
              aria-label="暂停目标"
              color="ghostSecondary"
              size="xs"
              disabled={pending || !onPause}
              onClick={() => void run(onPause)}
              title="暂停目标"
            >
              <Pause size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </Button>
          ) : canResume ? (
            <Button
              isIconOnly
              aria-label="恢复目标"
              color="ghostSecondary"
              size="xs"
              disabled={pending || !onResume}
              onClick={() => void run(onResume)}
              title="恢复目标"
            >
              <CirclePlay size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </Button>
          ) : null}
          <Button
            isIconOnly
            aria-label="编辑目标"
            color="ghostSecondary"
            size="xs"
            disabled={pending || !canEdit}
            onClick={onOpenGoalPanel}
            title="编辑目标"
          >
            <Maximize2 size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </Button>
        </div>
      </section>
      {error ? (
        <p role="alert" className="tw:px-2 tw:text-app-danger tw:type-caption">
          {error}
        </p>
      ) : null}
    </>
  )
}
