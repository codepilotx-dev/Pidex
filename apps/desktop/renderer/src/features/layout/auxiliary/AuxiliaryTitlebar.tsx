import type React from 'react'
import { memo } from 'react'
import { ArrowDownToLine } from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/IconTokens.js'
import { Button } from '../../../components/ui/Button.js'

export interface AuxiliaryTitlebarProps {
  title: string
  icon?: React.ReactNode
  onDockBack: () => void
}

export const AuxiliaryTitlebar = memo(function AuxiliaryTitlebar({
  title,
  icon,
  onDockBack,
}: AuxiliaryTitlebarProps): React.ReactNode {
  return (
    <header className="auxiliary-titlebar tw:flex tw:h-chrome tw:w-full tw:items-center tw:justify-between tw:border-b-[0.5px] tw:border-b-app-border-subtle tw:bg-app-titlebar tw:px-3 tw:select-none">
      {/* 标题与图标区域 */}
      <div className="tw:flex tw:items-center tw:gap-2 tw:min-w-0">
        {icon && (
          <span className="tw:text-app-text-meta tw:flex tw:items-center tw:shrink-0">{icon}</span>
        )}
        <span className="tw:type-control tw:text-app-text tw:truncate">{title}</span>
      </div>

      {/* 操作按钮区域：右侧预留 Windows 原生控制按钮间隙 */}
      <div className="tw:flex tw:items-center tw:gap-1">
        <Button
          isIconOnly
          aria-label="停靠回主窗口"
          color="ghostSecondary"
          onClick={onDockBack}
          size="toolbar"
          title="停靠回主窗口"
        >
          <ArrowDownToLine size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
        </Button>
        <div
          aria-hidden="true"
          className="auxiliary-window-controls-spacer tw:h-full tw:w-[138px] tw:shrink-0 tw:pointer-events-none"
        />
      </div>
    </header>
  )
})
