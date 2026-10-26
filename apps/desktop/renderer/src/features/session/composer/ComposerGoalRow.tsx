import { useState } from 'react'
import type React from 'react'
import { Check, MoreHorizontal, Pause, Play, Target, X } from 'lucide-react'
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
  goal: DesktopThreadGoal
  onPause?: () => void
  onResume?: () => void
  onComplete?: () => void
  onClear?: () => void
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
  onPause,
  onResume,
  onComplete,
  onClear,
}: Props): React.ReactNode {
  const [menuOpen, setMenuOpen] = useState(false)

  if (goal.status === 'complete') return null

  const canResume =
    goal.status === 'paused' ||
    goal.status === 'blocked' ||
    goal.status === 'usage-limited' ||
    goal.status === 'budget-limited'

  return (
    <section aria-label="当前目标" className={ROW_CLASS} data-composer-utility-item="goal">
      <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-2.5">
        <span className="tw:inline-flex tw:shrink-0 tw:text-app-text-meta" aria-hidden="true">
          <Target size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
        </span>
        <div className="tw:min-w-0">
          <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-1.5 tw:text-app-text-meta tw:type-caption">
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
            <span className="tw:shrink-0 tw:tabular-nums">
              {goal.tokensUsed}
              {goal.tokenBudget === null ? ' tokens' : ` / ${goal.tokenBudget} tokens`}
            </span>
            {goal.timeUsedSeconds > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="tw:shrink-0 tw:tabular-nums">
                  {Math.round(goal.timeUsedSeconds / 60)} 分
                </span>
              </>
            ) : null}
          </div>
          <p
            className="tw:m-0 tw:truncate tw:text-app-text tw:type-secondary"
            title={goal.objective}
          >
            {goal.objective}
          </p>
        </div>
      </div>

      <div className="tw:flex tw:shrink-0 tw:items-center tw:gap-1">
        {goal.status === 'active' ? (
          <Button
            color="ghostSecondary"
            size="composerSm"
            disabled={!onPause}
            onClick={onPause}
            title="暂停目标"
          >
            <Pause size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
            暂停
          </Button>
        ) : canResume ? (
          <Button
            color="ghostSecondary"
            size="composerSm"
            disabled={!onResume}
            onClick={onResume}
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
              disabled={!onComplete}
              icon={<Check size={APP_ICON_SIZE} />}
              onClick={() => {
                setMenuOpen(false)
                onComplete?.()
              }}
            >
              标记完成
            </PopoverItem>
            <PopoverItem
              disabled={goal.status === 'active' || !onClear}
              icon={<X size={APP_ICON_SIZE} />}
              onClick={() => {
                setMenuOpen(false)
                onClear?.()
              }}
            >
              清除目标
            </PopoverItem>
          </div>
        </PopoverMenu>
      </div>
    </section>
  )
}
