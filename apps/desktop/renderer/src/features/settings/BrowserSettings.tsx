import { useMemo } from 'react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { desktopBrowserClient } from '../../services/desktop-client/DesktopBrowserClient.js'
import type { DesktopBrowserSitePermission } from '../../../shared/Types.js'
import {
  useDesktopSettingsField,
  useDesktopSettingsDraftActions,
  useDesktopSettingsDraftDirty,
  useDesktopSettingsDraftSaving,
} from './UseDesktopSettings.js'
import { APP_ICON_SIZE } from '../../components/ui/IconTokens.js'
import { SettingsSection } from './SettingsSection.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { Button } from '../../components/ui/Button.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { SettingsRow } from './SettingsRow.js'
import { desktopClient } from '../../services/desktop-client/index.js'

export function BrowserSettings(): React.ReactNode {
  const browserAllowedSites = useDesktopSettingsField((s) => s.browserAllowedSites)
  const setBrowserAllowedSites = useDesktopSettingsField((s) => s.setBrowserAllowedSites)
  const subscribedDraftActions = useDesktopSettingsDraftActions()
  const subscribedDraftDirty = useDesktopSettingsDraftDirty()
  const subscribedDraftSaving = useDesktopSettingsDraftSaving()
  const draft = useMemo(
    () => ({
      ...subscribedDraftActions,
      values: {},
      dirty: subscribedDraftDirty,
      saving: subscribedDraftSaving,
    }),
    [subscribedDraftActions, subscribedDraftDirty, subscribedDraftSaving],
  )
  const [sitePermissions, setSitePermissions] = useState<DesktopBrowserSitePermission[]>([])
  const [allowAllSites, setAllowAllSites] = useState(false)
  const [allSitesSaving, setAllSitesSaving] = useState(false)
  const [allSitesError, setAllSitesError] = useState('')
  useEffect(() => {
    void desktopClient
      .readConfig()
      .then((result) => {
        const desktop = result.config.desktop as Record<string, unknown> | undefined
        setAllowAllSites(desktop?.browserAllowAllSites === true)
      })
      .catch(() => {})
  }, [])
  const [downloadMode, setDownloadMode] = useState<'downloads' | 'ask'>('downloads')
  const [downloadLoaded, setDownloadLoaded] = useState(false)
  const [downloadSaving, setDownloadSaving] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  useEffect(() => {
    if (!desktopBrowserClient.available) return
    let disposed = false
    void desktopBrowserClient
      .data({ action: 'preferences' })
      .then((result) => {
        if (disposed) return
        if (result.preferences) {
          setDownloadMode(result.preferences.downloadSaveMode)
          setDownloadLoaded(true)
        }
      })
      .catch(() => {
        if (!disposed) setDownloadError('下载设置暂时不可用')
      })
    return () => {
      disposed = true
    }
  }, [])
  async function saveDownloadMode(ask: boolean): Promise<void> {
    setDownloadSaving(true)
    setDownloadError('')
    try {
      const result = await desktopBrowserClient.data({
        action: 'preferences',
        downloadSaveMode: ask ? 'ask' : 'downloads',
      })
      if (result.preferences) setDownloadMode(result.preferences.downloadSaveMode)
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : '下载设置未保存')
    } finally {
      setDownloadSaving(false)
    }
  }

  useEffect(() => {
    if (!desktopBrowserClient.available) return
    void desktopBrowserClient
      .getBrowserState()
      .then((state) => {
        setBrowserAllowedSites(state.allowedSites)
        setSitePermissions(state.sitePermissions)
      })
      .catch(() => undefined)
  }, [setBrowserAllowedSites])

  async function clearAllowedSites(): Promise<void> {
    const nextState = await desktopBrowserClient.clearBrowserAllowedSites()
    setBrowserAllowedSites(nextState.allowedSites)
    setSitePermissions(nextState.sitePermissions)
    draft.setValue('browserAllowedSites', nextState.allowedSites)
    draft.setValue('browserSitePermissions', nextState.sitePermissions)
    setAllowAllSites(false)
  }

  return (
    <SettingsContentArea className="">
      <div className="settings-content-inner tw:@container tw:w-full tw:min-w-0 tw:mx-auto tw:p-5 tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]">
        <div className="settings-page-header tw:mt-0 tw:mx-0 tw:mb-8 tw:grid tw:gap-2">
          <h2 className="settings-page-title tw:m-0 tw:type-title-xl tw:text-app-text tw:tracking-[-0.01em]">
            浏览器
          </h2>
          <p className="settings-page-desc tw:m-0 tw:max-w-[68ch] tw:text-app-text-soft tw:type-body-sm">
            在工作台管理多个网页，并让 Agent 在后台完成常用浏览器操作。
          </p>
        </div>

        <SettingsSection
          title="内置浏览器"
          description="浏览器内容在隔离的会话中运行，保留内置浏览器登录状态，不继承常规浏览器的 Cookie 或扩展。"
        >
          <div className="browser-settings-info tw:flex tw:flex-col tw:gap-2 tw:text-app-text-soft tw:text-[length:var(--cpx-sys-font-size-md)]">
            <span>支持 HTTP 和 HTTPS URL；本地文件继续使用文件预览。</span>
            <span>批注会先插入输入框，由你确认后再发送。</span>
            <span>在 AI 对话中指定网页即可让 Agent 接管标签；首次使用站点仍需授权。</span>
          </div>
        </SettingsSection>

        <SettingsSection
          title="站点权限"
          description={
            sitePermissions.length
              ? `已记录 ${sitePermissions.length} 个 Browser Use 站点权限。`
              : '暂无站点权限。'
          }
          actions={
            <Button
              color="danger"
              disabled={
                sitePermissions.length === 0 && browserAllowedSites.length === 0 && !allowAllSites
              }
              type="button"
              onClick={() => void clearAllowedSites()}
            >
              <Trash2 size={APP_ICON_SIZE} />
              <span>清空</span>
            </Button>
          }
        >
          <SettingsRow
            title="所有网站授权"
            description={
              allowAllSites ? '已允许所有网站；明确拒绝的站点仍被阻止。' : '所有网站授权未启用。'
            }
            control={
              <Button
                color="secondary"
                disabled={!allowAllSites || allSitesSaving}
                onClick={() => {
                  setAllSitesSaving(true)
                  setAllSitesError('')
                  void desktopClient
                    .writeConfigBatch({
                      target: { kind: 'user' },
                      edits: [{ keyPath: ['desktop', 'browserAllowAllSites'], value: false }],
                    })
                    .then(() => setAllowAllSites(false))
                    .catch(() => setAllSitesError('撤销所有网站授权失败，请重试。'))
                    .finally(() => setAllSitesSaving(false))
                }}
              >
                撤销所有网站授权
              </Button>
            }
          />
          {allSitesError ? <p role="alert">{allSitesError}</p> : null}
          {sitePermissions.length ? (
            <div className="browser-allowed-sites tw:flex tw:flex-wrap tw:gap-2">
              {sitePermissions.map((site) => (
                <span
                  className="settings-chip tw:inline-flex tw:items-center tw:rounded-full tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-3 tw:py-1 tw:type-label tw:whitespace-nowrap"
                  key={site.origin}
                >
                  {site.origin} · {site.decision === 'allow' ? '允许' : '拒绝'}
                  <Button
                    color="secondary"
                    onClick={() =>
                      void desktopBrowserClient
                        .setPermission(site.origin, 'remove')
                        .then(setSitePermissions)
                    }
                  >
                    撤销
                  </Button>
                </span>
              ))}
            </div>
          ) : (
            <p className="settings-empty-state tw:m-0 tw:p-5 tw:text-app-text-soft tw:type-body-sm">
              Browser Use 请求站点后会在这里记录权限。
            </p>
          )}
        </SettingsSection>
        <SettingsSection title="下载" description="默认保存到系统下载目录，重名文件自动编号。">
          <SettingsRow
            title="每次询问保存位置"
            description="开启后使用系统另存为窗口。"
            control={
              <ToggleSwitch
                ariaLabel="每次询问保存位置"
                checked={downloadMode === 'ask'}
                disabled={!downloadLoaded || downloadSaving}
                onChange={(ask) => void saveDownloadMode(ask)}
              />
            }
          />
          {downloadError ? <p role="status">{downloadError}</p> : null}
        </SettingsSection>
      </div>
    </SettingsContentArea>
  )
}
