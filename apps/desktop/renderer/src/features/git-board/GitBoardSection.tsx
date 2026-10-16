import { useId, useState, type ReactNode } from 'react'
import { ChevronDown, Ellipsis, SquareArrowOutUpRight } from 'lucide-react'
import { Tooltip } from '../../components/ui/Tooltip.js'
import { Button } from '../../components/ui/Button.js'
import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../components/ui/IconTokens.js'
import { DisclosureContent } from '../../components/ui/DisclosureContent.js'
import { PopoverMenu } from '../../components/ui/PopoverMenu.js'
import { DropdownActions } from '../../components/ui/DropdownActions.js'
import type { AppContextMenuAction } from '../../components/ui/AppContextMenu.js'
import { useLocale } from '../i18n/LocaleProvider.js'
import { cx } from '../../utils/Cx.js'

const SECTION_HEADER_CLASS =
  'sidebar-section-header tw:sticky tw:top-0 tw:z-local tw:grid tw:min-h-[var(--sidebar-row-height)] tw:w-full tw:grid-cols-[minmax(0,1fr)_var(--sidebar-trailing-width)] tw:items-center tw:gap-x-2 tw:rounded-md tw:px-2 tw:select-none tw:focus-within:outline-none tw:group'
const SECTION_TITLE_CLASS =
  'sidebar-section-title tw:flex tw:min-w-0 tw:items-center tw:type-body tw:normal-case tw:text-app-text-meta'
const SECTION_TOGGLE_CLASS =
  'sidebar-section-toggle tw:grid tw:w-full tw:min-w-0 tw:grid-cols-[auto_minmax(0,1fr)] tw:items-center tw:gap-x-2 tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:text-inherit'
const SECTION_ACTIONS_CLASS =
  'sidebar-section-actions tw:flex tw:w-full tw:items-center tw:justify-end tw:gap-1 tw:opacity-0 tw:pointer-events-none tw:transition-opacity tw:duration-feedback tw:ease-out tw:group-hover:opacity-100 tw:group-hover:pointer-events-auto tw:group-has-[:focus-visible]:opacity-100 tw:group-has-[:focus-visible]:pointer-events-auto tw:has-[[data-state=open]]:opacity-100 tw:has-[[data-state=open]]:pointer-events-auto'
const SECTION_CHEVRON_CLASS =
  'sidebar-section-chevron tw:inline-flex tw:flex-none tw:items-center tw:text-app-text-meta tw:opacity-0 tw:pointer-events-none tw:group-hover:opacity-100 tw:[transition:opacity_var(--cpx-sys-motion-feedback)_var(--cpx-sys-ease-out),color_var(--cpx-sys-motion-feedback)_var(--cpx-sys-ease-out),transform_var(--cpx-sys-motion-disclosure)_var(--cpx-sys-ease-disclosure)]'
const SECTION_LABEL_CLASS =
  'sidebar-section-label tw:min-w-0 tw:overflow-hidden tw:whitespace-nowrap tw:text-app-text-meta'
const SECTION_TRAILING_CLASS =
  'sidebar-section-trailing tw:flex tw:min-h-4 tw:min-w-0 tw:items-center tw:justify-end'
const SECTION_CONTENT_CLASS =
  'sidebar-section-content tw:grid tw:min-w-0 tw:sidebar-row-gap tw:overflow-hidden tw:pt-0'

export function GitBoardSection({
  title,
  collapsed,
  onToggle,
  onOpen,
  actions,
  children,
}: {
  title: string
  collapsed: boolean
  onToggle: () => void
  onOpen?: () => void
  actions?: AppContextMenuAction[]
  children: ReactNode
}) {
  const { t } = useLocale()
  const contentId = useId()
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <section className="sidebar-section tw:grid">
      <div className={SECTION_HEADER_CLASS}>
        <h2 className={cx(SECTION_TITLE_CLASS, 'tw:m-0')}>
          <button
            type="button"
            className={SECTION_TOGGLE_CLASS}
            aria-controls={contentId}
            aria-expanded={!collapsed}
            onClick={onToggle}
          >
            <span className={SECTION_LABEL_CLASS}>{title}</span>
            <span className="sidebar-section-main tw:flex tw:min-w-0 tw:items-center">
              <span
                aria-hidden="true"
                className={cx(SECTION_CHEVRON_CLASS, collapsed && 'tw:-rotate-90')}
              >
                <ChevronDown size={APP_ICON_SIZES.sm} />
              </span>
            </span>
          </button>
        </h2>
        <div className={SECTION_TRAILING_CLASS}>
          <div className={SECTION_ACTIONS_CLASS}>
            {actions?.length ? (
              <Tooltip.Root open={menuOpen ? false : undefined}>
                <PopoverMenu
                  className="popover-sidebar-organize popover-menu--grid"
                  open={menuOpen}
                  onOpenChange={setMenuOpen}
                  side="bottom"
                  size="sm"
                  trigger={
                    <Tooltip.Trigger asChild>
                      <Button
                        nativeTitle={false}
                        isIconOnly
                        variant="text"
                        color="text"
                        iconSize="md"
                        size="compact"
                        title={`${title}：${t('更多')}`}
                        aria-label={`${title}：${t('更多')}`}
                      >
                        <Ellipsis size={APP_ICON_SIZE} />
                      </Button>
                    </Tooltip.Trigger>
                  }
                >
                  <DropdownActions actions={actions} />
                </PopoverMenu>
                <Tooltip.Portal>
                  <Tooltip.Content>{`${title}：${t('更多')}`}</Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            ) : null}
            {onOpen && (
              <Tooltip content={t('在右侧面板中打开')}>
                <Button
                  nativeTitle={false}
                  isIconOnly
                  variant="text"
                  color="text"
                  iconSize="md"
                  size="compact"
                  title={t('在右侧面板中打开')}
                  aria-label={t('在右侧面板中打开')}
                  onClick={onOpen}
                >
                  <SquareArrowOutUpRight size={APP_ICON_SIZE} />
                </Button>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
      <DisclosureContent
        expanded={!collapsed}
        id={contentId}
        mountPolicy="always"
        className="sidebar-section-disclosure"
        contentClassName={SECTION_CONTENT_CLASS}
      >
        {children}
      </DisclosureContent>
    </section>
  )
}
