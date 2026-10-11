import type React from 'react'
import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { SettingsPage } from './SettingsPage.js'
import { GlobalErrorModal } from '../../components/GlobalErrorModal.js'
import { useDesktopTheme } from '../theme/ThemeContext.js'
import { createSettingsSaveShortcutHandler, useDesktopSettings } from './UseDesktopSettings.js'
import { SETTINGS_ITEMS } from './SettingsRegistry.js'
import {
  resolveSettingsSectionVisibility,
  useSettingsCapabilityState,
} from './UseSettingsSectionVisibility.js'
import { NotFoundPage } from '../routing/NotFoundPage.js'
import { useDesktopLayoutOutletContext } from '../layout/shell/DesktopLayoutOutletContext.js'
import { useLocale } from '../i18n/LocaleProvider.js'

type Props = {
  activeTabOverride?: string
}

export function SettingsLayout({ activeTabOverride }: Props = {}): React.ReactNode {
  const { tab, projectId } = useParams<{
    tab?: string
    projectId?: string
  }>()
  const activeTab =
    activeTabOverride ?? (tab ? decodeURIComponent(tab) : projectId ? 'environment' : '')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)
  const settings = useDesktopSettings()
  const { t } = useLocale()
  const theme = useDesktopTheme()
  const { workspacePath, useSkill } = useDesktopLayoutOutletContext()
  const navigate = useNavigate()
  const location = useLocation()
  const capabilityState = useSettingsCapabilityState()
  const activeItem = SETTINGS_ITEMS.find((item) => item.routeId === activeTab)
  const visibility = resolveSettingsSectionVisibility(activeItem?.requires, {
    workspacePath,
    capabilityState,
  })

  useEffect(() => {
    setErrorMessage(null)
  }, [activeTab])

  useEffect(() => {
    if (activeItem == null || visibility.visible || visibility.pending) return
    navigate('/settings/general', { replace: true })
  }, [activeItem, navigate, visibility.pending, visibility.visible])

  useEffect(() => {
    const saveSettings = async (): Promise<void> => {
      await Promise.all([
        settings.draft.dirty ? settings.draft.save() : Promise.resolve(settings.draft.values),
        theme.draft.dirty ? theme.draft.save() : Promise.resolve(theme.draft.settings),
      ])
      setNoticeMessage(t('设置已保存'))
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      void createSettingsSaveShortcutHandler(saveSettings)(event).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        setErrorMessage(message)
      })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [settings.draft, theme.draft, t])

  if (activeTab === 'environment' || activeTab === 'local-environment') {
    const query = new URLSearchParams(location.search)
    query.set('tab', 'environments')
    if (projectId) query.set('projectId', projectId)
    return <Navigate replace to={`/settings/worktrees?${query}`} />
  }

  if (!SETTINGS_ITEMS.some((item) => item.routeId === activeTab)) {
    return <NotFoundPage />
  }

  return (
    <div className="settings-page tw:flex tw:h-full tw:min-h-0 tw:w-full tw:flex-col tw:overflow-hidden tw:bg-app-canvas tw:text-app-text">
      <GlobalErrorModal message={errorMessage} onDismiss={() => setErrorMessage(null)} />
      <GlobalErrorModal
        message={noticeMessage}
        onDismiss={() => setNoticeMessage(null)}
        tone="status"
      />
      <SettingsPage
        activeTab={activeTab}
        workspacePath={workspacePath}
        onUseSkill={useSkill}
        onError={setErrorMessage}
        onNotice={setNoticeMessage}
      />
    </div>
  )
}
