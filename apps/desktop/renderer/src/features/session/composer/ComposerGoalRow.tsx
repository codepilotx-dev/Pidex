import { useState } from 'react'
import type React from 'react'
import { Check, MoreHorizontal, Pause, Play, Target, X } from 'lucide-react'
import { ConfirmationDialog } from '../../../components/ui/ConfirmationDialog.js'
import { Textarea } from '../../../components/ui/Textarea.js'
import { Button } from '../../../components/ui/Button.js'
import { PopoverItem } from '../../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import {
  APP_ICON_SIZE,
  APP_ICON_SIZES,
  APP_ICON_STROKE_WIDTH,
} from '../../../components/ui/IconTokens.js'
import { cx } from '../../../utils/Cx.js'
import type { DesktopThreadGoal } from '../../../../shared/Types.js'

type Props = {
  onEdit?: (objective: string) => Promise<void>
  sessionBusy?: boolean
  goal: DesktopThreadGoal
  onPause?: () => void | Promise<void>
  onResume?: () => void | Promise<void>
  onComplete?: () => void | Promise<void>
  onClear?: () => void | Promise<void>
}

const STATUS_LABELS: Record<DesktopThreadGoal['status'], string> = {
  active: '进行中',
  paused: '已暂停',
  blocked: '受阻',
  'usage-limited': '用量受限',
  'budget-limited': '预算受限',
  complete: '已完成',
}

const ROW_CLASS =
  'composer-goal-row tw:flex tw:min-h-14 tw:w-full tw:min-w-0 tw:items-center tw:justify-between tw:gap-3 tw:px-3 tw:py-2'

export function ComposerGoalRow({
  goal,
  onEdit,
  sessionBusy,
  onPause,
  onResume,
  onComplete,
  onClear,
}: Props): React.ReactNode {
  const [menuOpen, setMenuOpen] = useState(false)

  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'edit' | 'resume' | null>(null)
  const [objective, setObjective] = useState(goal.objective)
  async function run(action?: () => void | Promise<void>) {
    if (!action || pending) return
    setPending(true)
    setError(null)
    try {
      await action()
      setDialog(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '目标操作失败')
    } finally {
      setPending(false)
    }
  }
  function editGoal() {
    setObjective(goal.objective)
    setError(null)
    setDialog('edit')
  }
  const compact = (value: number) =>
    new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  const overBudget = goal.tokenBudget !== null && goal.tokensUsed > goal.tokenBudget
  const metric =
    (goal.status === 'active' || goal.status === 'budget-limited') && goal.tokenBudget !== null
      ? `${compact(goal.tokensUsed)} / ${compact(goal.tokenBudget)} tokens${overBudget ? '（已超预算）' : ''}`
      : `${Math.floor(goal.timeUsedSeconds / 60)} 分 ${Math.floor(goal.timeUsedSeconds % 60)} 秒`

  if (goal.status === 'complete') return null

  const canResume =
    goal.status === 'paused' ||
    goal.status === 'blocked' ||
    goal.status === 'usage-limited' ||
    goal.status === 'budget-limited'

  return (
    <>
      <section aria-label="当前目标" className={ROW_CLASS} data-composer-utility-item="goal">
        <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-2.5">
          <span className="tw:inline-flex tw:shrink-0 tw:text-app-text-meta" aria-hidden="true">
            <Target size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </span>
          <div className="tw:min-w-0">
            <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-1.5 tw:text-app-text-meta tw:type-caption">
              <span className="tw:type-label">目标</span>
              <span aria-hidden="true">·</span>
              <span
                className={cx(
                  'tw:type-label',
                  goal.status === 'paused' && 'tw:text-app-warning',
                  goal.status !== 'active' && goal.status !== 'paused' && 'tw:text-app-danger',
                )}
              >
                {STATUS_LABELS[goal.status]}
              </span>
              <span aria-hidden="true">·</span>
              <span className="tw:min-w-0 tw:break-words tw:tabular-nums">{metric}</span>
            </div>
            <button
              type="button"
              disabled={!onEdit || pending}
              onClick={editGoal}
              className="tw:m-0 tw:block tw:max-w-full tw:truncate tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:text-app-text tw:type-secondary"
              title={goal.objective}
            >
              {goal.objective}
            </button>
          </div>
        </div>

        <div className="tw:flex tw:shrink-0 tw:items-center tw:gap-1">
          {goal.status === 'active' ? (
            <Button
              color="ghostSecondary"
              size="composerSm"
              disabled={pending || !onPause}
              onClick={() => void run(onPause)}
              title="暂停目标"
            >
              <Pause size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
              暂停
            </Button>
          ) : canResume ? (
            <Button
              color="ghostSecondary"
              size="composerSm"
              disabled={pending || !onResume}
              onClick={() => {
                setError(null)
                setDialog('resume')
              }}
              title="继续目标"
            >
              <Play size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
              继续
            </Button>
          ) : null}
          <PopoverMenu
            align="end"
            open={menuOpen}
            side="top"
            size="sm"
            onOpenChange={setMenuOpen}
            trigger={
              <Button
                isIconOnly
                aria-label="目标操作"
                color="ghostSecondary"
                size="composerSm"
                title="目标操作"
              >
                <MoreHorizontal size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
              </Button>
            }
          >
            <div className="popover-header">目标操作</div>
            <div className="popover-section">
              <PopoverItem
                disabled={pending || !onEdit}
                onClick={() => {
                  setMenuOpen(false)
                  editGoal()
                }}
              >
                编辑目标
              </PopoverItem>
              <PopoverItem
                disabled={pending || !onComplete}
                icon={<Check size={APP_ICON_SIZE} />}
                onClick={() => {
                  setMenuOpen(false)
                  void run(onComplete)
                }}
              >
                标记完成
              </PopoverItem>
              <PopoverItem
                disabled={pending || sessionBusy || !onClear}
                icon={<X size={APP_ICON_SIZE} />}
                onClick={() => {
                  setMenuOpen(false)
                  void run(onClear)
                }}
              >
                清除目标
              </PopoverItem>
            </div>
          </PopoverMenu>
        </div>
      </section>
      {error && !dialog ? (
        <p role="alert" className="tw:px-3 tw:text-app-danger tw:type-caption">
          {error}
        </p>
      ) : null}
      <ConfirmationDialog
        open={dialog !== null}
        title={dialog === 'edit' ? '编辑目标' : '恢复目标？'}
        description={
          dialog === 'edit' ? (
            <>
              <p>该输入开始执行时替换当前目标。</p>
              <Textarea
                aria-label="目标内容"
                value={objective}
                maxLength={4000}
                disabled={pending}
                onChange={(event) => setObjective(event.target.value)}
              />
              {error ? <p role="alert">{error}</p> : null}
            </>
          ) : (
            <>聊天空闲时会继续推进此目标。{error ? <p role="alert">{error}</p> : null}</>
          )
        }
        actionLabel={pending ? '处理中…' : dialog === 'edit' ? '确认提交' : '恢复'}
        actionDisabled={
          pending || (dialog === 'edit' && (!objective.trim() || objective.trim().length > 4000))
        }
        onCancel={() => {
          if (!pending) setDialog(null)
        }}
        onAction={() => void run(dialog === 'edit' ? () => onEdit?.(objective.trim()) : onResume)}
      />
    </>
  )
}
