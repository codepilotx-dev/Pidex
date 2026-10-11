import React, { Suspense, lazy } from 'react'
import type { DesktopInstalledSkill } from '../../../shared/Types.js'
import { SETTINGS_ITEMS, type SettingsTabId } from './SettingsRegistry.js'
import { SettingsPanelFallback } from './SettingsPanelFallback.js'

type Props = {
  activeTab: string
  workspacePath: string | null
  onUseSkill: (skill: DesktopInstalledSkill) => void
  onError: (message: string) => void
  onNotice?: (message: string) => void
}

type SettingsPanelProps = {
  workspacePath: string | null
  onUseSkill: (skill: DesktopInstalledSkill) => void
  onError: (message: string) => void
  onNotice: (message: string) => void
}

type SettingsPanel = React.ComponentType<SettingsPanelProps>

const SETTINGS_PANELS: Record<SettingsTabId, SettingsPanel> = {
  general: lazy(() => import('./GeneralSettings.js').then((m) => ({ default: m.GeneralSettings }))),
  voice: lazy(() => import('./VoiceSettings.js').then((m) => ({ default: m.VoiceSettings }))),
  profile: lazy(() => import('./ProfileSettings.js').then((m) => ({ default: m.ProfileSettings }))),
  appearance: lazy(() =>
    import('./AppearanceSettings.js').then((m) => ({ default: m.AppearanceSettings })),
  ),
  pets: lazy(() => import('./PetSettings.js').then((m) => ({ default: m.PetSettings }))),
  config: lazy(() => import('./ConfigSettings.js').then((m) => ({ default: m.ConfigSettings }))),
  personalization: lazy(() =>
    import('./PersonalizationSettings.js').then((m) => ({ default: m.PersonalizationSettings })),
  ),
  memory: lazy(() => import('./MemorySettings.js').then((m) => ({ default: m.MemorySettings }))),
  shortcuts: lazy(() =>
    import('./KeyboardShortcutsSettings.js').then((m) => ({
      default: m.KeyboardShortcutsSettings,
    })),
  ),
  billing: lazy(() =>
    import('./UsageBillingSettings.js').then((m) => ({ default: m.UsageBillingSettings })),
  ),
  providers: lazy(() =>
    import('../models/ModelCenterView.js').then((m) => ({ default: m.ProviderSettings })),
  ),
  plugins: lazy(() =>
    import('./plugins/PluginsSettingsPage.js').then((m) => ({ default: m.PluginsSettingsPage })),
  ),
  browser: lazy(() => import('./BrowserSettings.js').then((m) => ({ default: m.BrowserSettings }))),
  computer: lazy(() =>
    import('./ComputerSettings.js').then((m) => ({ default: m.ComputerSettings })),
  ),
  worktrees: lazy(() =>
    import('../worktree/WorktreeSettings.js').then((m) => ({ default: m.WorktreeSettings })),
  ),
  dependencies: lazy(() =>
    import('./WorkspaceDependenciesSettings.js').then((m) => ({
      default: m.WorkspaceDependenciesSettings,
    })),
  ),
  'code-review': lazy(() =>
    import('./CodeReviewSettings.js').then((m) => ({ default: m.CodeReviewSettings })),
  ),
  git: lazy(() => import('./GitSettings.js').then((m) => ({ default: m.GitSettings }))),
  archived: lazy(() =>
    import('./ArchivedConversationsSettings.js').then((m) => ({
      default: m.ArchivedConversationsSettings,
    })),
  ),
}

export function SettingsPage({
  activeTab,
  workspacePath,
  onUseSkill,
  onError,
  onNotice,
}: Props): React.ReactNode {
  const resolvedTab = SETTINGS_ITEMS.some((item) => item.routeId === activeTab)
    ? activeTab
    : 'general'
  const Panel = SETTINGS_PANELS[resolvedTab as SettingsTabId]
  const label = SETTINGS_ITEMS.find((item) => item.routeId === resolvedTab)?.label
  return (
    <Suspense fallback={<SettingsPanelFallback label={label} />}>
      <Panel
        key={resolvedTab === 'memory' ? (workspacePath ?? 'no-workspace') : undefined}
        workspacePath={workspacePath}
        onUseSkill={onUseSkill}
        onError={onError}
        onNotice={onNotice ?? (() => {})}
      />
    </Suspense>
  )
}
