import { readFile } from 'node:fs/promises'
import { parse as parseJsonc } from 'jsonc-parser/lib/esm/main.js'
import { parse } from 'smol-toml'
import {
  DEFAULT_APPEARANCE_SETTINGS,
  migrateAppearanceSettings,
  normalizeAppearanceSettings,
  type DesktopThemeSettingsV7,
} from './AppearanceSettingsStore.js'

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export async function readStartupAppearanceConfig(
  configJsonPath: string,
  legacyConfigTomlPath?: string,
  legacyAppearancePath?: string,
): Promise<DesktopThemeSettingsV7> {
  let configJsonMissing = false
  try {
    const source = (await readFile(configJsonPath, 'utf8')).replace(/^\uFEFF/, '')
    const parsed = parseJsonc(source, undefined, { allowTrailingComma: true })
    const desktop = isObject(parsed.desktop) ? parsed.desktop : null
    if (desktop && isObject(desktop.appearance)) {
      return migrateAppearanceSettings(desktop.appearance)
    }
  } catch (error) {
    configJsonMissing = isFileMissingError(error)
  }
  if (configJsonMissing && legacyConfigTomlPath) {
    try {
      const parsed = parse(await readFile(legacyConfigTomlPath, 'utf8'))
      const desktop = isObject(parsed.desktop) ? parsed.desktop : null
      if (desktop && isObject(desktop.appearance)) {
        return migrateAppearanceSettings(desktop.appearance)
      }
    } catch {}
  }
  if (legacyAppearancePath) {
    try {
      return migrateAppearanceSettings(JSON.parse(await readFile(legacyAppearancePath, 'utf8')))
    } catch {}
  }
  return normalizeAppearanceSettings(DEFAULT_APPEARANCE_SETTINGS)
}

const isFileMissingError = (error: unknown): boolean => isObject(error) && error.code === 'ENOENT'
