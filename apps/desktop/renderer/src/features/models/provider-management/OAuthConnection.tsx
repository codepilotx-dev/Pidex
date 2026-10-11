import type React from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import type { DesktopAuthTarget } from '../../../../shared/Types.js'
import { Button } from '../../../components/ui/Button.js'
import { DisclosureController } from '../../../components/ui/DisclosureController.js'
import { Input } from '../../../components/ui/Input.js'
import { Spinner } from '../../../components/ui/Spinner.js'
import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { useLocale } from '../../i18n/LocaleProvider.js'
import { SettingsDropdown } from '../../settings/SettingsDropdown.js'
import { useAuthSession } from '../../provider-management/UseAuthSession.js'

export type OAuthConnectionProps = {
  connected: boolean
  description: string
  hideHeader?: boolean
  target: DesktopAuthTarget
  title: string
  onChanged: () => void | Promise<void>
}

export function OAuthConnection({
  connected,
  description,
  hideHeader = false,
  target,
  title,
  onChanged,
}: OAuthConnectionProps): React.ReactNode {
  const { t } = useLocale()
  const inputId = useId()
  const [error, setError] = useState<string | null>(null)
  const openedUrl = useRef<string | null>(null)
  const auth = useAuthSession({ target, onComplete: onChanged, onError: setError })
  const active = auth.session ? ['running', 'waiting'].includes(auth.session.status) : false
  const prompt = active ? auth.session?.prompt : undefined
  const notices = active ? (auth.session?.notices ?? []) : []
  const authUrlNotice = [...notices].reverse().find((notice) => notice.type === 'auth_url')
  const isChatGPT = target.kind === 'provider' && target.providerId === 'openai'
  const manualCallback = isChatGPT && prompt?.type === 'manual_code'
  const completing = active && (auth.busy || (isChatGPT && notices.at(-1)?.type === 'progress'))
  const visibleNotices = notices.filter((notice) =>
    notice.type === 'auth_url'
      ? !isChatGPT && notice === authUrlNotice && Boolean(notice.instructions)
      : !(isChatGPT && notice.type === 'progress'),
  )
  const status =
    auth.busy && !active
      ? '正在准备登录…'
      : active
        ? completing
          ? '正在完成登录…'
          : authUrlNotice
            ? '等待浏览器授权'
            : prompt
              ? '等待填写授权信息'
              : '正在完成登录…'
        : auth.session?.status === 'complete'
          ? '已连接'
          : null

  useEffect(() => {
    if (!authUrlNotice || authUrlNotice.url === openedUrl.current) return
    openedUrl.current = authUrlNotice.url
    void desktopClient.openExternalURL(authUrlNotice.url)
  }, [authUrlNotice])

  function start(): void {
    setError(null)
    openedUrl.current = null
    void auth.start()
  }

  const promptLabel = manualCallback ? t('回调链接') : (prompt?.message ?? '')
  const promptForm = prompt ? (
    <form
      className="model-center-oauth-form tw:grid tw:min-w-0 tw:gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (auth.value.trim() && !auth.busy) void auth.respond()
      }}
    >
      {manualCallback ? (
        <p className="tw:m-0 tw:text-app-text-soft tw:type-body-sm tw:wrap-anywhere">
          {t('粘贴浏览器最终跳转的完整链接，手动完成登录。')}
        </p>
      ) : null}
      <label
        className="tw:text-app-text-soft tw:type-label"
        htmlFor={prompt.type === 'select' ? undefined : inputId}
      >
        {promptLabel}
      </label>
      {prompt.type === 'select' ? (
        <SettingsDropdown
          ariaLabel={promptLabel}
          disabled={auth.busy}
          onChange={auth.setValue}
          options={(prompt.options ?? []).map((option) => ({
            value: option.id,
            label: option.label,
            detail: option.description,
          }))}
          value={auth.value}
          size="lg"
        />
      ) : (
        <Input
          className="tw:w-full tw:min-w-0"
          id={inputId}
          aria-label={promptLabel}
          autoComplete="off"
          disabled={auth.busy}
          onChange={(event) => auth.setValue(event.target.value)}
          placeholder={manualCallback ? t('粘贴完整回调链接') : prompt.placeholder}
          type={prompt.type === 'secret' ? 'password' : 'text'}
          value={auth.value}
        />
      )}
      <div className="model-center-oauth-actions tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Button color="primary" type="submit" disabled={!auth.value.trim()} loading={auth.busy}>
          {t(manualCallback ? '完成登录' : prompt.type === 'manual_code' ? '提交授权码' : '继续')}
        </Button>
      </div>
    </form>
  ) : null

  return (
    <section className="model-center-account-connection model-center-oauth-flow tw:grid tw:min-w-0 tw:gap-3 tw:p-4">
      {!hideHeader ? (
        <header className="tw:flex tw:min-w-0 tw:items-start tw:justify-between tw:gap-3">
          <div>
            <h4 className="tw:m-0 tw:text-app-text tw:[font-size:var(--cpx-sys-font-size-md)] tw:type-weight-label">
              {t(title)}
            </h4>
            <p className="tw:mt-1 tw:mb-0 tw:text-app-text-soft tw:[font-size:var(--cpx-sys-font-size-sm)] tw:[line-height:var(--cpx-sys-line-height-tight)]">
              {t(description)}
            </p>
          </div>
          {connected ? (
            <span
              className="tw:whitespace-nowrap tw:rounded-full tw:border tw:border-app-border-subtle tw:px-2 tw:py-1 tw:text-app-text-soft tw:[font-size:var(--cpx-sys-font-size-xs)] tw:data-[tone=success]:text-app-success"
              data-tone="success"
            >
              {t('已授权')}
            </span>
          ) : null}
        </header>
      ) : null}

      <div className="model-center-oauth-body tw:grid tw:min-w-0 tw:gap-4">
        {status ? (
          <div
            className="model-center-oauth-status tw:flex tw:items-start tw:gap-3 tw:text-app-text tw:[&>.ui-spinner]:mt-1 tw:[&>.ui-spinner]:shrink-0 tw:[&>svg]:mt-1 tw:[&>svg]:shrink-0"
            role="status"
          >
            {active || auth.busy ? <Spinner /> : <Check size={APP_ICON_SIZES.sm} aria-hidden />}
            <div>
              <strong className="tw:type-row-title">{t(status)}</strong>
              {active && authUrlNotice && !completing ? (
                <p className="tw:mt-1 tw:mb-0 tw:text-app-text-soft tw:type-body-sm">
                  {t('完成登录后，这里会自动更新。')}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {visibleNotices.length > 0 ? (
          <div className="model-center-oauth-notices tw:grid tw:min-w-0 tw:gap-3">
            {visibleNotices.map((notice, index) => {
              if (notice.type === 'auth_url') {
                return (
                  <p
                    className="tw:m-0 tw:text-app-text-soft tw:type-body-sm tw:wrap-anywhere"
                    key={index}
                  >
                    {notice.instructions}
                  </p>
                )
              }
              if (notice.type === 'device_code') {
                return (
                  <div
                    className="model-center-account-oauth tw:grid tw:gap-2 tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-raised tw:p-3"
                    key={index}
                  >
                    <p className="tw:m-0 tw:text-app-text-soft tw:[font-size:var(--cpx-sys-font-size-sm)] tw:[line-height:var(--cpx-sys-line-height-tight)]">
                      {t('设备码')}：<code>{notice.userCode}</code>
                    </p>
                    <Button
                      color="secondary"
                      onClick={() => void desktopClient.openExternalURL(notice.verificationUri)}
                    >
                      <ExternalLink size={APP_ICON_SIZE} aria-hidden />
                      {t('打开设备授权页面')}
                    </Button>
                  </div>
                )
              }
              const message =
                isChatGPT && notice.message.startsWith('Could not listen on ')
                  ? t('自动回调不可用，可展开下方入口手动完成登录。')
                  : notice.message
              return (
                <p
                  className="tw:m-0 tw:text-app-text-soft tw:type-body-sm tw:wrap-anywhere"
                  key={index}
                >
                  {message}
                </p>
              )
            })}
          </div>
        ) : null}

        <div className="model-center-oauth-actions tw:flex tw:flex-wrap tw:items-center tw:gap-2">
          {!active ? (
            <Button color="primary" loading={auth.busy} onClick={start}>
              {t(connected ? '重新授权' : '在浏览器登录')}
            </Button>
          ) : authUrlNotice ? (
            <Button
              color="primary"
              disabled={completing}
              onClick={() => void desktopClient.openExternalURL(authUrlNotice.url)}
            >
              <ExternalLink size={APP_ICON_SIZE} aria-hidden />
              {t('重新打开浏览器')}
            </Button>
          ) : null}
          {active ? (
            <Button
              color="secondary"
              onClick={() => {
                setError(null)
                void auth.cancel()
              }}
            >
              {t('取消登录')}
            </Button>
          ) : null}
        </div>

        {manualCallback ? (
          <div className="model-center-oauth-fallback tw:border-t tw:border-t-app-border-subtle tw:pt-3 tw:[&_form]:pt-3">
            <DisclosureController
              key={`${auth.session?.id}:${prompt?.id}`}
              mountPolicy="until-exit"
              renderTrigger={({ expanded, contentId, toggle }) => (
                <Button
                  color="ghostSecondary"
                  aria-controls={contentId}
                  aria-expanded={expanded}
                  onClick={toggle}
                >
                  {expanded ? (
                    <ChevronDown size={APP_ICON_SIZES.sm} aria-hidden />
                  ) : (
                    <ChevronRight size={APP_ICON_SIZES.sm} aria-hidden />
                  )}
                  {t('无法自动完成？')}
                </Button>
              )}
            >
              {promptForm}
            </DisclosureController>
          </div>
        ) : (
          promptForm
        )}
        {error ? (
          <p
            className="model-center-account-error tw:m-0 tw:text-app-danger tw:[font-size:var(--cpx-sys-font-size-sm)] tw:[line-height:var(--cpx-sys-line-height-tight)]"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    </section>
  )
}
