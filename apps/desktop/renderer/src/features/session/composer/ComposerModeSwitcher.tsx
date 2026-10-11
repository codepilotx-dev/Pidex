import type React from 'react'
import { useState } from 'react'
import { Dropdown } from '../../../components/ui/floating/Dropdown.js'
import { Briefcase, Code2, MessageSquare } from 'lucide-react'
import { APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import type { SidebarProductMode } from '../../../../shared/Types.js'
import { useLocale } from '../../i18n/LocaleProvider.js'
import { cx } from '../../../utils/Cx.js'

export type ComposerModeSwitcherProps = {
  mode?: SidebarProductMode
  onModeChange?: (mode: SidebarProductMode) => void
  disabled?: boolean
  className?: string
  side?: 'top' | 'bottom' | 'right' | 'left'
  sideOffset?: number
}

type ModeConfig = {
  value: SidebarProductMode
  label: string
  description: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  iconColorClass: string
}

const MODE_CONFIGS: ModeConfig[] = [
  {
    value: 'chat',
    label: 'Chat',
    description: '创建、学习和探索',
    icon: MessageSquare,
    iconColorClass: 'tw:text-purple-400',
  },
  {
    value: 'coding',
    label: 'Coding',
    description: '构建、调试并发布',
    icon: Code2,
    iconColorClass: 'tw:text-blue-400',
  },
  {
    value: 'working',
    label: 'Working',
    description: '写作、分析和协作',
    icon: Briefcase,
    iconColorClass: 'tw:text-emerald-400',
  },
]

/*
 * Silhouette shared by the composer toolbar chip triggers (mode switcher and
 * permission select): no visible border or background at rest, hover and open
 * surfaces from `--cpx-sys-color-*`, and the leading glyph pinned to the shared
 * icon slot. Exported so the permission trigger in `ComposerCard` renders an
 * identical chip instead of a second copy of these utilities.
 */
export const COMPOSER_CHIP_TRIGGER_CLASS = cx(
  'tw:min-w-0 tw:border tw:border-transparent tw:bg-transparent',
  'tw:transition-[background,border-color,color] tw:duration-feedback tw:ease-standard',
  'tw:hover:bg-app-hover tw:hover:border-transparent',
  'tw:data-[state=open]:bg-app-selected tw:data-[state=open]:border-transparent',
  'tw:[&>svg:first-child]:block tw:[&>svg:first-child]:size-icon tw:[&>svg:first-child]:shrink-0',
)

export function ComposerModeSwitcher({
  mode = 'coding',
  onModeChange,
  disabled = false,
  className,
  side = 'bottom',
  sideOffset = 6,
}: ComposerModeSwitcherProps): React.ReactNode {
  const [open, setOpen] = useState(false)
  const { t } = useLocale()

  const currentConfig = MODE_CONFIGS.find((item) => item.value === mode) ?? MODE_CONFIGS[1]!
  const CurrentIcon = currentConfig.icon

  return (
    <Dropdown.Root value={mode} disabled={disabled} open={open} onOpenChange={setOpen}>
      <Dropdown.Trigger asChild>
        <button
          aria-expanded={open}
          aria-label={`${t('切换工作模式，当前为')} ${currentConfig.label}`}
          className={cx(
            'composer-mode-trigger chip-button tw:shrink-0 tw:text-app-text',
            COMPOSER_CHIP_TRIGGER_CLASS,
            disabled && 'tw:pointer-events-none tw:opacity-60',
            className,
          )}
          data-state={open ? 'open' : 'closed'}
          disabled={disabled}
          type="button"
        >
          <CurrentIcon className={cx('tw:shrink-0', currentConfig.iconColorClass)} size={13} />
          <span className="composer-mode-trigger-label tw:min-w-0 tw:truncate">
            {currentConfig.label}
          </span>
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          size="md"
          listLabel={t('工作模式')}
          align="start"
          collisionPadding={8}
          side={side}
          sideOffset={sideOffset}
          className="composer-mode-menu-content tw:p-1.5 tw:outline-none"
        >
          {MODE_CONFIGS.map((item) => {
            const ItemIcon = item.icon
            return (
              <Dropdown.Item
                key={item.value}
                value={item.value}
                onSelect={() => onModeChange?.(item.value)}
                description={t(item.description)}
                icon={<ItemIcon size={APP_ICON_SIZES.sm} />}
              >
                {item.label}
              </Dropdown.Item>
            )
          })}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}
