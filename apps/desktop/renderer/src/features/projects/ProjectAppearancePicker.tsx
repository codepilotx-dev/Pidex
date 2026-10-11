import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../components/ui/IconTokens.js'
import * as RadioGroup from '@radix-ui/react-radio-group'
import { Check } from 'lucide-react'
import { useState } from 'react'
import type React from 'react'
import type {
  ProjectAppearance,
  ProjectAppearanceColor,
  ProjectAppearanceIcon,
} from '../../../shared/Types.js'
import { Button } from '../../components/ui/Button.js'
import { AnchoredPopover } from '../../components/ui/AnchoredPopover.js'
import { cx } from '../../utils/Cx.js'
import {
  PROJECT_APPEARANCE_COLORS,
  PROJECT_APPEARANCE_COLOR_CLASS,
  PROJECT_APPEARANCE_ICONS,
  ProjectAppearanceGlyph,
} from './ProjectAppearance.js'

type Props = {
  appearance: ProjectAppearance
  disabled?: boolean
  glyphSize?: number
  onChange: (appearance: ProjectAppearance) => void
}

export function ProjectAppearancePicker({
  appearance,
  disabled = false,
  glyphSize = APP_ICON_SIZE,
  onChange,
}: Props): React.ReactNode {
  const [open, setOpen] = useState(false)

  function selectColor(color: ProjectAppearanceColor): void {
    onChange({ ...appearance, color })
  }

  function selectIcon(icon: ProjectAppearanceIcon): void {
    onChange({ ...appearance, icon })
  }

  return (
    <AnchoredPopover
      className="project-appearance-popover tw:z-popover tw:rounded-xl tw:border tw:border-app-border-subtle tw:bg-app-raised tw:p-2 tw:text-app-text tw:outline-none"
      contentLabel="项目图标和颜色"
      open={open}
      trigger={
        <button
          aria-label="选择项目图标和颜色"
          className="project-appearance-trigger tw:inline-flex tw:size-10 tw:shrink-0 tw:grow-0 tw:basis-10 tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-md tw:border-0 tw:bg-transparent tw:p-0 tw:text-app-text-soft tw:enabled:hover:bg-app-hover tw:enabled:hover:text-app-text"
          disabled={disabled}
          type="button"
        >
          <ProjectAppearanceGlyph appearance={appearance} size={glyphSize} />
        </button>
      }
      size="md"
      onOpenChange={setOpen}
    >
      <RadioGroup.Root
        aria-label="项目颜色"
        className="project-appearance-colors tw:grid tw:grid-cols-[repeat(6,1fr)] tw:gap-2 tw:border-b tw:border-app-border-subtle tw:px-1 tw:pt-1 tw:pb-3"
        value={appearance.color}
        onValueChange={(value) => selectColor(value as ProjectAppearanceColor)}
      >
        {PROJECT_APPEARANCE_COLORS.map((color) => (
          <RadioGroup.Item
            aria-label={colorLabel(color)}
            className={cx(
              'project-appearance-color tw:inline-flex tw:size-8 tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-full tw:bg-current tw:shadow-[var(--cpx-sys-focus-ring-inset)]',
              PROJECT_APPEARANCE_COLOR_CLASS[color] ?? 'tw:text-app-text-soft',
              appearance.color === color
                ? 'is-selected tw:border-3 tw:border-app-canvas tw:outline-2 tw:outline-current'
                : 'tw:border-3 tw:border-transparent',
            )}
            data-project-color={color}
            key={color}
            value={color}
          >
            <RadioGroup.Indicator>
              <Check aria-hidden="true" className="tw:text-app-canvas" size={APP_ICON_SIZES.sm} />
            </RadioGroup.Indicator>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
      <RadioGroup.Root
        aria-label="项目图标"
        className="project-appearance-icons tw:grid tw:grid-cols-[repeat(6,1fr)] tw:gap-1 tw:py-2"
        value={appearance.icon}
        onValueChange={(value) => selectIcon(value as ProjectAppearanceIcon)}
      >
        {PROJECT_APPEARANCE_ICONS.map((icon) => (
          <RadioGroup.Item
            aria-label={iconLabel(icon)}
            className={cx(
              'project-appearance-icon tw:inline-flex tw:size-8 tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-md tw:border-0 tw:bg-transparent tw:hover:bg-app-hover tw:hover:text-app-text',
              appearance.icon === icon
                ? 'is-selected tw:bg-app-hover tw:text-app-text'
                : 'tw:text-app-text-soft',
            )}
            key={icon}
            value={icon}
          >
            <ProjectAppearanceGlyph appearance={{ ...appearance, icon }} size={APP_ICON_SIZE} />
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
      <div className="project-appearance-footer tw:flex tw:justify-end">
        <Button color="primary" onClick={() => setOpen(false)}>
          完成
        </Button>
      </div>
    </AnchoredPopover>
  )
}

function colorLabel(color: ProjectAppearanceColor): string {
  return {
    default: '默认',
    red: '红色',
    orange: '橙色',
    yellow: '黄色',
    green: '绿色',
    blue: '蓝色',
    purple: '紫色',
    pink: '粉色',
  }[color]
}

function iconLabel(icon: ProjectAppearanceIcon): string {
  return {
    folder: '文件夹',
    dollar: '货币',
    book: '书本',
    graduation: '教育',
    edit: '编辑',
    writing: '写作',
    function: '函数',
    terminal: '终端',
    music: '音乐',
    popcorn: '影视',
    customize: '自定义',
    palette: '调色板',
    stethoscope: '听诊器',
    health: '健康',
    plant: '植物',
    suitcase: '公文包',
    chart: '图表',
    kettlebell: '壶铃',
    dumbbell: '哑铃',
    logs: '日志',
    scale: '天平',
    globe: '地球',
    wrench: '扳手',
    paw: '爪印',
    flask: '烧瓶',
    brain: '大脑',
    heart: '爱心',
    flower: '花朵',
    paintbrush: '画笔',
    plane: '飞机',
  }[icon]
}
