import type React from 'react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Dropdown as DropdownMenu } from '../../../components/ui/floating/Dropdown.js'
import {
  ArrowUpRight,
  ChevronRight,
  CircleUser,
  Download,
  Egg,
  Gauge,
  HelpCircle,
  Keyboard,
  LogOut,
  Settings,
  Sparkles,
} from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import { buildPopoverSizingStyle } from '../../../components/ui/PopoverSizing.js'
import { Button } from '../../../components/ui/Button.js'
import { RemoteImage } from '../../../components/ui/RemoteImage.js'
import { ConfirmationDialog } from '../../../components/ui/ConfirmationDialog.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import type { DesktopUpdateStatus, ModelProviderID } from '../../../../shared/Types.js'
import { PopoverItem, PopoverSeparator } from '../../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import { SidebarRow } from './SidebarRow.js'
import { useLocale } from '../../i18n/LocaleProvider.js'
import {
  buildDesktopUpdateIndicatorModel,
  runDesktopUpdateIndicatorAction,
  startDesktopUpdateMonitoring,
} from './DesktopUpdateMenu.js'
import {
  allBalances,
  criticalQuotaWindows,
  formatAmount,
  formatQuotaValue,
  protocolProviderId,
  sourceForProvider,
  type ProviderUsageSource,
} from '../../../utils/UsageFormatters.js'
import { cx } from '../../../utils/Cx.js'
import { useDesktopSettings } from '../../settings/UseDesktopSettings.js'

type PopoverUsageRow = {
  id: string
  label: string
  usage: string
}

type ProviderUsageState = {
  providerID: ModelProviderID | null
  source: ProviderUsageSource | null
  loading: boolean
  error: string | null
}

const EMPTY_USAGE: ProviderUsageState = {
  providerID: null,
  source: null,
  loading: false,
  error: null,
}

type SidebarFooterProps = {
  compact?: boolean
  onNavigate?: () => void
  onOpenWhatsNew: (restoreFocusElement: HTMLElement | null) => void
  onReport: (message: string) => void
}

export const SidebarFooter = forwardRef<HTMLElement, SidebarFooterProps>(function SidebarFooter(
  { compact = false, onNavigate, onOpenWhatsNew, onReport },
  ref,
): React.ReactNode {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useLocale()
  const { draft, model, providerID: configuredProviderID } = useDesktopSettings()
  const [menuOpen, setMenuOpen] = useState(false)
  const accountMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [usage, setUsage] = useState<ProviderUsageState>(EMPTY_USAGE)
  const { auth: githubAuth } = useSyncExternalStore(
    desktopClient.onGithubAccountChange,
    desktopClient.getGithubAccountSnapshot,
    desktopClient.getGithubAccountSnapshot,
  )
  const [petToggleBusy, setPetToggleBusy] = useState(false)
  const settingsActive = location.pathname.startsWith('/settings/')
  const usageAvailable = Boolean(configuredProviderID && model)
  const petEnabled = draft.values.pet.enabled
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus | null>(null)
  const updateIndicator = buildDesktopUpdateIndicatorModel(updateStatus)

  useEffect(() => {
    return startDesktopUpdateMonitoring(desktopClient, setUpdateStatus)
  }, [])

  const refreshUsage = useCallback(async (): Promise<void> => {
    setUsage((previous) => ({ ...previous, loading: true, error: null }))
    try {
      const providerState = await desktopClient.getModelProviderState()
      const providerID = providerState.selectedProviderID
      if (!providerID || !providerState.apiKeyConfigured) {
        setUsage({
          providerID,
          source: null,
          loading: false,
          error: null,
        })
        return
      }
      const result = await desktopClient.queryProviderUsage({
        range: '7d',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
        providerIds: [protocolProviderId(providerID)],
      })
      const source = sourceForProvider(result.sources, providerID) ?? null
      setUsage({
        providerID,
        source,
        loading: false,
        error: source?.error?.message ?? null,
      })
    } catch (fetchError) {
      setUsage((previous) => ({
        ...previous,
        loading: false,
        error: fetchError instanceof Error ? fetchError.message : String(fetchError),
      }))
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    void refreshUsage()
  }, [menuOpen, refreshUsage])

  const refreshGithubAuth = useCallback(async (): Promise<void> => {
    try {
      await desktopClient.getGithubAuthStatus()
    } catch {
      // 保留已有账户信息，下一次打开菜单时重试。
    }
  }, [])

  useEffect(() => {
    void refreshGithubAuth()
  }, [refreshGithubAuth])

  useEffect(() => {
    if (menuOpen) void refreshGithubAuth()
  }, [menuOpen, refreshGithubAuth])

  const logoutGithub = useCallback(async (): Promise<void> => {
    setLogoutBusy(true)
    try {
      await desktopClient.logoutGithub()
    } catch (error) {
      onReport(error instanceof Error ? error.message : String(error))
    } finally {
      setLogoutBusy(false)
      setLogoutConfirmOpen(false)
    }
  }, [onReport])

  const togglePet = useCallback(async (): Promise<void> => {
    if (petToggleBusy) return
    const nextEnabled = !petEnabled
    setPetToggleBusy(true)
    try {
      const bridge = window.DesktopBridge
      if (nextEnabled) {
        if (typeof bridge?.openPetOverlay !== 'function') {
          throw new Error('宠物浮窗暂不可用')
        }
        await bridge.openPetOverlay()
      } else {
        if (typeof bridge?.hidePetOverlay !== 'function') {
          throw new Error('宠物浮窗暂不可用')
        }
        await bridge.hidePetOverlay()
      }
      draft.setValue('pet', (current) => ({
        ...current,
        enabled: nextEnabled,
      }))
      draft.autoSave()
    } catch (error) {
      onReport(error instanceof Error ? error.message : String(error))
    } finally {
      setPetToggleBusy(false)
    }
  }, [draft, onReport, petEnabled, petToggleBusy])

  const usageRows = useMemo<PopoverUsageRow[]>(() => buildUsageRows(usage), [usage])
  const githubAuthenticated = githubAuth?.authenticated === true
  const githubUser = githubAuthenticated ? githubAuth.user : null
  const accountName = githubUser?.name || githubUser?.login || t('个人资料')
  const accountTriggerName = compact || githubAuthenticated ? accountName : t('设置')
  const openSettings = (path: string): void => {
    setMenuOpen(false)
    onNavigate?.()
    navigate(path)
  }

  const accountAvatar = (
    <span
      className="sidebar-account-avatar tw:relative tw:inline-flex tw:size-6 tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-full tw:bg-app-hover tw:text-app-text tw:[&_.ui-remote-image-content]:object-cover"
      aria-hidden="true"
    >
      {!githubAuthenticated ? (
        compact ? (
          <CircleUser data-icon-kind="artwork" size={14} />
        ) : (
          <Settings data-icon-kind="artwork" size={14} />
        )
      ) : githubUser?.avatarUrl ? (
        <RemoteImage
          alt=""
          fallback={<CircleUser data-icon-kind="artwork" size={14} />}
          src={githubUser.avatarUrl}
        />
      ) : (
        <CircleUser data-icon-kind="artwork" size={14} />
      )}
      {!compact && updateIndicator.visible ? (
        <span
          className="sidebar-account-update-dot tw:absolute tw:right-0 tw:bottom-0 tw:size-2 tw:rounded-full tw:border tw:border-app-border tw:bg-app-success"
          aria-hidden="true"
        />
      ) : null}
    </span>
  )

  return (
    <footer
      className={cx(
        'sidebar-footer tw:flex tw:w-full tw:flex-none tw:min-w-0 tw:items-center tw:gap-1 tw:mt-1',
        compact
          ? 'sidebar-footer--rail tw:flex-col tw:border-t-0 tw:p-0'
          : 'tw:border-t tw:border-t-app-border-subtle tw:px-2 tw:pt-1',
      )}
      ref={ref}
    >
      {compact && updateIndicator.visible ? (
        <Button
          isIconOnly
          variant="ghost"
          size="md"
          aria-label={t(updateIndicator.ariaLabel)}
          title={t(updateIndicator.ariaLabel)}
          disabled={updateIndicator.disabled}
          onClick={() => {
            void runDesktopUpdateIndicatorAction(
              desktopClient,
              updateIndicator.action ?? 'check',
            ).catch(() => {
              setUpdateStatus({ phase: 'error', message: '更新操作失败，请稍后重试' })
            })
          }}
        >
          <Download size={APP_ICON_SIZE} />
        </Button>
      ) : null}
      <PopoverMenu
        className="popover-menu--grid"
        open={menuOpen}
        side={compact ? 'right' : 'top'}
        align="end"
        size="sm"

        trigger={
          compact ? (
            <Button
              isIconOnly
              variant="ghost"
              size="md"
              active={settingsActive || menuOpen}
              ref={accountMenuTriggerRef}
              aria-label={accountTriggerName}
              className="sidebar-settings-link tw:data-[active=true]:bg-app-selected tw:data-[active=true]:text-app-text"
            >
              {accountAvatar}
            </Button>
          ) : (
            <SidebarRow
              active={settingsActive || menuOpen}
              ref={accountMenuTriggerRef}
              asChild
              className={cx(
                'sidebar-settings-link tw:text-app-text tw:type-body tw:focus-visible:outline-2 tw:focus-visible:outline-offset-0 tw:focus-visible:outline-app-focus',
                'tw:min-h-[var(--sidebar-row-height)] tw:w-full tw:min-w-0 tw:grow tw:shrink tw:basis-auto',
              )}
              labelClassName={cx('sidebar-settings-label', 'tw:min-w-0')}
              layout="flex"
              leading={accountAvatar}
            >
              <button
                aria-label={
                  updateIndicator.visible
                    ? `${accountTriggerName}，${t(updateIndicator.ariaLabel)}`
                    : accountTriggerName
                }
                className="sidebar-footer-trigger tw:w-full tw:min-w-0 tw:overflow-hidden tw:border-0 tw:text-left tw:text-inherit tw:whitespace-nowrap tw:cursor-pointer tw:[font:inherit]"
                type="button"
              >
                <span>{accountTriggerName}</span>
              </button>
            </SidebarRow>
          )
        }
        onOpenChange={setMenuOpen}
      >
        <div className="popover-section">
          <PopoverItem
            icon={
              <span
                className="popover-account-avatar tw:relative tw:inline-flex tw:size-full tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-full tw:bg-app-hover tw:text-app-text tw:[&_.ui-remote-image-content]:object-cover"
                aria-hidden="true"
              >
                {githubUser?.avatarUrl ? (
                  <RemoteImage
                    alt=""
                    fallback={<CircleUser data-icon-kind="artwork" size={14} />}
                    src={githubUser.avatarUrl}
                  />
                ) : (
                  <CircleUser data-icon-kind="artwork" size={14} />
                )}
              </span>
            }
            description={
              githubAuthenticated
                ? githubUser?.name && githubUser.name !== githubUser.login
                  ? `@${githubUser.login}`
                  : t('GitHub 账户')
                : t('未登录')
            }
            onClick={() =>
              openSettings(githubAuthenticated ? '/settings/profile' : '/settings/git')
            }
          >
            {accountName}
          </PopoverItem>
        </div>
        <PopoverSeparator />
        <div className="popover-section">
          {usageAvailable ? (
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className="popover-item popover-sub-trigger" tabIndex={-1}>
                <span className="popover-item-leading">
                  <span className="popover-item-icon">
                    <Gauge size={APP_ICON_SIZE} />
                  </span>
                </span>
                <span className="popover-item-label">{t('剩余用量')}</span>
                <span className="popover-item-trailing">
                  <ChevronRight className="popover-item-arrow" size={APP_ICON_SIZES.sm} />
                </span>
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  size="sm"
                  data-theme-component="dropdown-surface"
                  aria-label={t('剩余用量详情')}
                  className="popover-surface popover popover-sub-content popover-usage-submenu tw:p-1 tw:[--popover-overflow-y:hidden]"
                  collisionPadding={6}
                  sideOffset={4}
                  style={buildPopoverSizingStyle({ size: 'sm' })}
                >
                  <div className="popover-usage-content tw:flex tw:min-w-0 tw:flex-col tw:gap-1">
                    {usage.loading ? (
                      <div
                        className="popover-usage-empty tw:min-w-0 tw:overflow-hidden tw:p-2 tw:text-center tw:text-app-text-meta tw:type-body-sm tw:whitespace-nowrap"
                        role="status"
                      >
                        {t('正在查询用量…')}
                      </div>
                    ) : usage.error ? (
                      <div
                        className="popover-usage-empty popover-usage-empty-error tw:min-w-0 tw:overflow-hidden tw:p-2 tw:text-center tw:text-app-text-soft tw:type-body-sm tw:whitespace-nowrap"
                        role="status"
                      >
                        {usage.error}
                      </div>
                    ) : usageRows.length > 0 ? (
                      <div
                        aria-label={t('额度明细')}
                        className="popover-usage-rows tw:flex tw:min-w-0 tw:flex-col"
                        role="group"
                      >
                        {usageRows.map((row) => (
                          <div
                            className="popover-usage-row tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-2 tw:rounded-md tw:px-2 tw:py-1 tw:text-app-text-soft tw:type-body"
                            key={row.id}
                          >
                            <span className="popover-usage-label tw:min-w-0 tw:overflow-hidden tw:text-app-text tw:type-weight-label tw:whitespace-nowrap">
                              {row.label}
                            </span>
                            <span className="popover-usage-value tw:flex tw:min-w-0 tw:shrink-0 tw:items-center tw:justify-end tw:gap-2 tw:text-right">
                              <span className="popover-usage-amount tw:text-app-text tw:type-label tw:tabular-nums tw:whitespace-nowrap">
                                {row.usage}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div
                        className="popover-usage-empty tw:min-w-0 tw:overflow-hidden tw:p-2 tw:text-center tw:text-app-text-meta tw:type-body-sm tw:whitespace-nowrap"
                        role="status"
                      >
                        {t('当前提供商未返回用量数据')}
                      </div>
                    )}
                    <div className="popover-usage-divider tw:mx-2 tw:my-1 tw:h-px tw:bg-app-border-subtle" />
                    <DropdownMenu.Item
                      className="popover-usage-action tw:flex tw:w-full tw:items-center tw:justify-between tw:gap-2 tw:rounded-md tw:border-0 tw:bg-transparent tw:px-2 tw:py-1 tw:text-left tw:text-app-text tw:type-body tw:cursor-pointer tw:transition-colors tw:duration-feedback tw:ease-out tw:hover:bg-app-hover tw:focus-visible:bg-app-hover tw:focus-visible:outline-none tw:data-[highlighted]:bg-app-hover tw:data-[highlighted]:outline-none"
                      tabIndex={-1}
                      onSelect={() => {
                        openSettings('/settings/billing')
                      }}
                    >
                      <span
                        className={cx(
                          'popover-usage-action-label',
                          'tw:flex-1',
                          'tw:min-w-0',
                          'tw:overflow-hidden tw:whitespace-nowrap',
                        )}
                      >
                        {t('了解更多')}
                      </span>
                      <ArrowUpRight
                        className="popover-usage-action-icon tw:size-[var(--inline-icon-size,1em)] tw:flex-none tw:text-app-text-meta"
                        size="var(--inline-icon-size, 1em)"
                      />
                    </DropdownMenu.Item>
                  </div>
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          ) : null}
          <PopoverItem
            disabled={petToggleBusy}
            icon={<Egg size={APP_ICON_SIZE} />}
            onClick={() => {
              void togglePet()
            }}
          >
            {t(petEnabled ? '隐藏宠物' : '显示宠物')}
          </PopoverItem>
          <PopoverItem
            active={settingsActive}
            icon={<Settings size={APP_ICON_SIZE} />}
            shortcut="Ctrl+,"
            onClick={() => openSettings('/settings/general')}
          >
            {t('设置')}
          </PopoverItem>
        </div>
        <PopoverSeparator />
        <div className="popover-section">
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="popover-item popover-sub-trigger" tabIndex={-1}>
              <span className="popover-item-leading">
                <span className="popover-item-icon">
                  <HelpCircle size={APP_ICON_SIZE} />
                </span>
              </span>
              <span className="popover-item-label">{t('帮助')}</span>
              <span className="popover-item-trailing">
                <ChevronRight className="popover-item-arrow" size={APP_ICON_SIZES.sm} />
              </span>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent
                size="sm"
                data-theme-component="dropdown-surface"
                aria-label={t('帮助')}
                className="popover-surface popover popover-sub-content popover-menu--grid"
                collisionPadding={6}
                sideOffset={4}
                style={buildPopoverSizingStyle({ size: 'sm' })}
              >
                <PopoverItem
                  icon={<Sparkles size={APP_ICON_SIZE} />}
                  onClick={() => {
                    setMenuOpen(false)
                    onOpenWhatsNew(accountMenuTriggerRef.current)
                  }}
                >
                  {t('新特性')}
                </PopoverItem>
                <PopoverItem
                  icon={<Keyboard size={APP_ICON_SIZE} />}
                  onClick={() => openSettings('/settings/shortcuts')}
                >
                  {t('键盘快捷键')}
                </PopoverItem>
                <PopoverItem
                  icon={<Download size={APP_ICON_SIZE} />}
                  description={updateIndicator.visible ? t(updateIndicator.ariaLabel) : undefined}
                  disabled={updateIndicator.disabled}
                  onClick={() => {
                    void runDesktopUpdateIndicatorAction(
                      desktopClient,
                      updateIndicator.action ?? 'check',
                    ).catch(() => {
                      setUpdateStatus({ phase: 'error', message: '更新操作失败，请稍后重试' })
                    })
                  }}
                >
                  {t(updateIndicator.visible ? updateIndicator.label : '检查更新')}
                </PopoverItem>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
          {githubAuthenticated ? (
            <PopoverItem
              icon={<LogOut size={APP_ICON_SIZE} />}
              onClick={() => {
                setMenuOpen(false)
                setLogoutConfirmOpen(true)
              }}
            >
              {t('退出登录')}
            </PopoverItem>
          ) : null}
        </div>
      </PopoverMenu>
      <span aria-atomic="true" aria-live="polite" className="tw:sr-only">
        {t(updateIndicator.announcement)}
      </span>
      <ConfirmationDialog
        open={logoutConfirmOpen}
        title={t('退出登录')}
        description={t('确定要退出 GitHub 登录吗？')}
        cancelLabel={t('取消')}
        actionLabel={t('退出登录')}
        tone="danger"
        actionDisabled={logoutBusy}
        onCancel={() => {
          if (!logoutBusy) setLogoutConfirmOpen(false)
        }}
        onAction={() => void logoutGithub()}
      />
    </footer>
  )
})

function buildUsageRows(usage: ProviderUsageState): PopoverUsageRow[] {
  const quotas = criticalQuotaWindows(usage.source, 3)
  if (quotas.length > 0) {
    return quotas.map((quota, index) => ({
      id: `${quota.id}-${index}`,
      label: quota.label,
      usage: formatQuotaValue(quota),
    }))
  }
  return allBalances(usage.source).map((balance, index) => ({
    id: `${balance.currency}-${index}`,
    label: balance.currency,
    usage: `余额 ${formatAmount(balance.currency, balance.total)}`,
  }))
}
