import type React from 'react'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { GitFork } from 'lucide-react'
import {
  desktopClipboard,
  desktopClient,
  startGithubLoginFlow,
} from '../../../services/desktop-client/index.js'
import type {
  DesktopGithubAuthMode,
  DesktopGithubAuthStatus,
  DesktopGithubLoginStatus,
} from '../../../../shared/Types.js'
import { APP_ICON_SIZE } from '../../../components/ui/IconTokens.js'
import { Button } from '../../../components/ui/Button.js'
import { cx } from '../../../utils/Cx.js'
import { useLocale } from '../../i18n/LocaleProvider.js'

/**
 * GitHub 登录的唯一实现。
 * 设置页、克隆弹窗和 Git 看板的 GitHub 仓库页都通过 `useGithubLogin()` 获取状态，
 * 用 `<GithubLoginPanel />` 渲染登录入口；禁止在调用方复制轮询、设备码或复制验证码逻辑。
 */

export const GITHUB_LOGIN_POLL_INTERVAL_MS = 2000

export type GithubLoginController = {
  /** 最近一次已知的账号状态；`null` 表示尚未读取过。 */
  auth: DesktopGithubAuthStatus | null
  /** 进行中的登录流程状态；`null` 表示当前没有登录流程。 */
  login: DesktopGithubLoginStatus | null
  authenticated: boolean
  busy: boolean
  /** 设备验证码登录正在等待用户在浏览器输入验证码。 */
  awaitingDeviceCode: boolean
  error: string | null
  start(mode: DesktopGithubAuthMode): Promise<void>
  copyUserCode(): Promise<void>
  openVerificationPage(): Promise<void>
}

/** 订阅 desktop client 的 GitHub 账号快照；登录/退出在任何入口都会同步到所有调用方。 */
export function useGithubAccount(
  refresh: boolean,
): ReturnType<typeof desktopClient.getGithubAccountSnapshot> {
  const { auth } = useSyncExternalStore(
    desktopClient.onGithubAccountChange,
    desktopClient.getGithubAccountSnapshot,
    desktopClient.getGithubAccountSnapshot,
  )
  useEffect(() => {
    if (!refresh) return
    // 账号快照有缓存；可见入口挂载时读取一次，确保首次打开就能拿到当前账号状态。
    void desktopClient.getGithubAuthStatus().catch(() => undefined)
  }, [refresh])
  return { auth } as ReturnType<typeof desktopClient.getGithubAccountSnapshot>
}

export function useGithubLogin({
  active,
  onError,
}: {
  /** 只有可见的入口才主动读取账号状态并发起轮询。 */
  active: boolean
  onError?: (message: string) => void
}): GithubLoginController {
  const { t } = useLocale()
  const { auth } = useGithubAccount(active)
  const [login, setLogin] = useState<DesktopGithubLoginStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const authenticated = auth?.authenticated === true

  const reportLogin = useCallback(
    (status: DesktopGithubLoginStatus | null): void => {
      setLogin(status)
      if (status?.state === 'failed' && status.error) onError?.(t(status.error))
    },
    [onError, t],
  )

  // 登录完成（勾选或侧栏退出）后清空流程状态，避免残留的失败提示继续展示。
  useEffect(() => {
    if (authenticated) setLogin(null)
  }, [authenticated])

  useEffect(() => {
    if (!active || !login || login.state !== 'awaiting_auth') return
    const timer = window.setInterval(() => {
      void desktopClient.pollGithubLogin().then(reportLogin, () => undefined)
    }, GITHUB_LOGIN_POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [active, login, reportLogin])

  const start = useCallback(
    async (mode: DesktopGithubAuthMode): Promise<void> => {
      setBusy(true)
      try {
        reportLogin(await startGithubLoginFlow(desktopClient, mode))
      } catch (error) {
        onError?.(t(errorMessage(error)))
      } finally {
        setBusy(false)
      }
    },
    [onError, reportLogin, t],
  )

  const copyUserCode = useCallback(async (): Promise<void> => {
    const code = login?.userCode
    if (!code) return
    try {
      await desktopClipboard.writeText(code)
    } catch (error) {
      onError?.(t(errorMessage(error)))
    }
  }, [login?.userCode, onError, t])

  const openVerificationPage = useCallback(async (): Promise<void> => {
    const url = login?.verificationUri
    if (!url) return
    try {
      await desktopClient.openExternalURL(url)
    } catch (error) {
      onError?.(t(errorMessage(error)))
    }
  }, [login?.verificationUri, onError, t])

  return useMemo(
    () => ({
      auth,
      login,
      authenticated,
      busy,
      awaitingDeviceCode:
        login?.mode === 'device' && login.state === 'awaiting_auth' && Boolean(login.userCode),
      error: login?.error ?? auth?.error ?? null,
      start,
      copyUserCode,
      openVerificationPage,
    }),
    [auth, login, authenticated, busy, start, copyUserCode, openVerificationPage],
  )
}

export function GithubLoginPanel({
  controller,
  variant = 'card',
  heading = '登录 GitHub',
  description,
}: {
  controller: GithubLoginController
  /** `card` 用于对话框/页面内的独立区块，`inline` 用于设置行右侧。 */
  variant?: 'card' | 'inline'
  heading?: string
  description?: string
}): React.ReactNode {
  const { t } = useLocale()
  const { login, busy, awaitingDeviceCode } = controller
  // 登录失败后（例如本机没有系统浏览器）额外提供设备验证码入口；
  // 登录进行中一开始也保留该入口，方便用户主动改用设备码。
  const canRetryWithDevice = login === null || login.state === 'failed'
  const message = controller.error
    ? t(controller.error)
    : awaitingDeviceCode
      ? `${t('请在打开的 GitHub 页面输入验证码')} ${login?.userCode ?? ''}`
      : (description ?? t('在系统浏览器中授权后，可列出并克隆私有仓库。'))
  const actions = (
    <>
      <Button
        color="primary"
        disabled={busy}
        onClick={() => void controller.start('browser')}
        size="md"
        type="button"
      >
        {t('登录 GitHub')}
      </Button>
      {canRetryWithDevice ? (
        <Button
          color="secondary"
          disabled={busy}
          onClick={() => void controller.start('device')}
          size="md"
          type="button"
        >
          {t('使用设备验证码')}
        </Button>
      ) : null}
    </>
  )

  const deviceCard = awaitingDeviceCode ? (
    <div className="github-device-code-card compact tw:flex tw:items-center tw:justify-between tw:gap-4 tw:bg-app-raised tw:[&_p]:mt-2 tw:[&_p]:mb-0 tw:[&_p]:text-app-text-soft tw:[&_p]:type-body-sm tw:[&_p]:leading-[var(--cpx-sys-line-height-tight)] tw:mt-3 tw:rounded-md tw:border tw:border-app-border-subtle tw:p-3">
      <div>
        <div className="github-device-code-label tw:mb-1 tw:text-app-text-soft tw:text-[length:var(--cpx-sys-font-size-xs)]">
          {t('GitHub 设备验证码')}
        </div>
        <div className="github-device-code-value tw:font-mono tw:text-[length:var(--cpx-sys-font-size-3xl)] tw:type-weight-heading tw:tracking-[0.08em] tw:text-app-text">
          {login?.userCode}
        </div>
        <p>{t('在 GitHub 设备登录页面输入这个验证码，不是 OAuth Client ID。')}</p>
      </div>
      <div className="github-device-code-actions tw:flex tw:shrink-0 tw:items-center tw:gap-2">
        <Button
          color="secondary"
          onClick={() => void controller.copyUserCode()}
          size="md"
          type="button"
        >
          {t('复制验证码')}
        </Button>
        <Button
          color="secondary"
          onClick={() => void controller.openVerificationPage()}
          size="md"
          type="button"
        >
          {t('打开验证页面')}
        </Button>
      </div>
    </div>
  ) : null

  if (variant === 'inline') {
    return (
      <div className="tw:flex tw:min-w-0 tw:flex-col tw:items-end tw:gap-2 tw:@max-[900px]:items-start">
        {message && controller.error ? (
          <p role="alert" className="tw:m-0 tw:text-app-danger tw:type-body-sm">
            {message}
          </p>
        ) : null}
        <div className="settings-inline-actions tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2 tw:max-[900px]:justify-start">
          {actions}
        </div>
        {deviceCard}
      </div>
    )
  }

  return (
    <div className="github-login-panel tw:grid tw:grid-cols-[auto_minmax(0,1fr)] tw:items-center tw:gap-3 tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-control tw:p-4">
      <GitFork aria-hidden="true" size={APP_ICON_SIZE} className="tw:text-app-text-soft" />
      <div className="tw:min-w-0">
        <h3 className="tw:m-0 tw:text-app-text tw:type-row-title">{t(heading)}</h3>
        <p
          className={cx(
            'tw:m-0 tw:mt-1 tw:type-body-sm',
            controller.error ? 'tw:text-app-danger' : 'tw:text-app-text-soft',
          )}
          role={controller.error ? 'alert' : undefined}
        >
          {message}
        </p>
      </div>
      <div className="tw:col-span-2 tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2">
        {actions}
      </div>
      {deviceCard ? <div className="tw:col-span-2">{deviceCard}</div> : null}
    </div>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
