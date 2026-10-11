import { createContext, useContext, type Context } from 'react'
import type {
  DesktopThemeConfigV1,
  DesktopThemeMode,
  DesktopThemeSettings,
  DesktopThemeVariant,
} from '../../../shared/Types.js'

export type DesktopThemeDraft = {
  settings: DesktopThemeSettings
  resolvedVariant: DesktopThemeVariant
  dirty: boolean
  saving: boolean
  setSettings: (settings: DesktopThemeSettings) => void
  setMode: (mode: DesktopThemeMode) => void
  save: () => Promise<DesktopThemeSettings>
  reset: () => void
  autoSave: (settings?: DesktopThemeSettings) => void
  updateAndAutoSave: (
    updater: (current: DesktopThemeSettings) => DesktopThemeSettings,
  ) => Promise<void>
}

export type DesktopThemeContextValue = {
  settings: DesktopThemeSettings
  resolvedVariant: DesktopThemeVariant
  activeTheme: DesktopThemeConfigV1
  codeThemeId: string
  reducedMotion: boolean
  draft: DesktopThemeDraft
  setMode: (mode: DesktopThemeMode) => Promise<void>
  saveSettings: (settings: DesktopThemeSettings) => Promise<void>
  canRestorePreviousAppearance: () => Promise<boolean>
  restorePreviousAppearance: () => Promise<void>
  applyNewDesignTheme: () => Promise<void>
}

type DesktopThemeHotData = {
  desktopThemeContext?: Context<DesktopThemeContextValue | null>
}

const hotData = import.meta.hot?.data as DesktopThemeHotData | undefined

export const DesktopThemeContext =
  hotData?.desktopThemeContext ?? createContext<DesktopThemeContextValue | null>(null)

if (import.meta.hot) {
  const data = import.meta.hot.data as DesktopThemeHotData
  data.desktopThemeContext = DesktopThemeContext
}

export function useDesktopTheme(): DesktopThemeContextValue {
  const context = useContext(DesktopThemeContext)
  if (!context) {
    throw new Error('useDesktopTheme must be used inside DesktopThemeProvider.')
  }
  return context
}
