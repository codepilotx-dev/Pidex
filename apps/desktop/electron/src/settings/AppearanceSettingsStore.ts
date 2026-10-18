import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AppearanceMigrationBackup,
  AppearanceMigrationRecord,
  DesktopChromeTheme,
  DesktopHexColor,
  DesktopThemeFontFace,
  DesktopThemeFonts,
  DesktopThemeSettingsV8,
  DesktopThemeVariant,
} from '@pidex/shared/desktop-theme'
import {
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_CHROME_THEMES,
  desktopThemeFontFaceMatchesFamily,
  normalizeDesktopAccentPreset,
  resolveSharedFontsFromVariants,
} from '@pidex/shared/desktop-theme'
import { writeJsonAtomically } from '../windows/DebouncedAtomicJsonWriter.js'

export type {
  AppearanceMigrationBackup,
  AppearanceMigrationRecord,
  DesktopChromeTheme,
  DesktopThemeSettingsV8,
} from '@pidex/shared/desktop-theme'
export { DEFAULT_APPEARANCE_SETTINGS, DEFAULT_CHROME_THEMES } from '@pidex/shared/desktop-theme'
import { isRecord } from '@pidex/shared/guards'

type HexColor = DesktopHexColor
type AppearanceVariant = DesktopThemeVariant

type RecordValue = Record<string, unknown>
const CURRENT_APPEARANCE_SETTINGS_VERSION = 8
const MIGRATION_RECORD_VERSION = 1
const MIGRATION_ID = 'ui-design-visual-theme'

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function colorOr(value: unknown, fallback: HexColor): HexColor {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
    ? (value.toLowerCase() as HexColor)
    : fallback
}

function numberInRange(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

function fontOr(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : null
}

function faceFieldOr(value: unknown, maximumLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= maximumLength ? trimmed : null
}

function fontFaceOr(value: unknown): DesktopThemeFontFace | null {
  if (value === null) return null
  if (!isRecord(value)) return null
  const family = faceFieldOr(value.family, 200)
  const fullName = faceFieldOr(value.fullName, 200)
  const postscriptName = faceFieldOr(value.postscriptName, 200)
  if (!family || !fullName || !postscriptName) return null
  return { family, fullName, postscriptName }
}

function codeThemeIdOr(value: unknown, fallback: string): string {
  if (value === 'auto') return fallback
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/i.test(value) ? value : fallback
}

function normalizeChromeTheme(
  value: unknown,
  fallback: DesktopChromeTheme,
  variant: DesktopThemeVariant,
): DesktopChromeTheme {
  const source = isRecord(value) ? value : {}
  const fonts = isRecord(source.fonts) ? source.fonts : {}
  const semanticColors = isRecord(source.semanticColors) ? source.semanticColors : {}
  const ui = fontOr(fonts.ui)
  const code = fontOr(fonts.code)
  const uiFace = fontFaceOr(fonts.uiFace)
  const codeFace = fontFaceOr(fonts.codeFace)
  const accent = colorOr(source.accent, fallback.accent)
  return {
    accent,
    accentPreset: normalizeDesktopAccentPreset(source.accentPreset, accent, variant),
    surface: colorOr(source.surface, fallback.surface),
    ink: colorOr(source.ink, fallback.ink),
    contrast: numberInRange(source.contrast, fallback.contrast, 0, 100),
    // Face keys are always persisted explicitly: clearing a face writes
    // `null` so Agent key-path edits can never leave stale face subkeys.
    fonts: {
      ui,
      uiFace: desktopThemeFontFaceMatchesFamily(ui, uiFace) ? uiFace : null,
      code,
      codeFace: desktopThemeFontFaceMatchesFamily(code, codeFace) ? codeFace : null,
    },
    semanticColors: {
      diffAdded: colorOr(semanticColors.diffAdded, fallback.semanticColors.diffAdded),
      diffRemoved: colorOr(semanticColors.diffRemoved, fallback.semanticColors.diffRemoved),
      skill: colorOr(semanticColors.skill, fallback.semanticColors.skill),
    },
  }
}

/**
 * Reads the shared V8 `fonts` value. V6/V7 documents store fonts per variant,
 * so their value is seeded from the current mode's variant to keep the visible
 * theme stable across the upgrade.
 */
function normalizeSharedFonts(
  value: unknown,
  mode: DesktopThemeSettingsV8['mode'],
  themes: Record<DesktopThemeVariant, DesktopChromeTheme>,
): DesktopThemeFonts {
  if (!isRecord(value)) return resolveSharedFontsFromVariants(themes, mode)
  const ui = fontOr(value.ui)
  const code = fontOr(value.code)
  const uiFace = fontFaceOr(value.uiFace)
  const codeFace = fontFaceOr(value.codeFace)
  return {
    ui,
    uiFace: desktopThemeFontFaceMatchesFamily(ui, uiFace) ? uiFace : null,
    code,
    codeFace: desktopThemeFontFaceMatchesFamily(code, codeFace) ? codeFace : null,
  }
}

/** Mirrors the shared fonts onto both variants for variant-shaped readers. */
function withSharedVariantFonts(
  themes: Record<DesktopThemeVariant, DesktopChromeTheme>,
  fonts: DesktopThemeFonts,
): Record<DesktopThemeVariant, DesktopChromeTheme> {
  const variantFonts = {
    ui: fonts.ui,
    uiFace: fonts.uiFace ?? null,
    code: fonts.code,
    codeFace: fonts.codeFace ?? null,
  }
  return {
    light: { ...themes.light, fonts: { ...variantFonts } },
    dark: { ...themes.dark, fonts: { ...variantFonts } },
  }
}

export function normalizeAppearanceSettings(value: unknown): DesktopThemeSettingsV8 {
  const source = isRecord(value) ? value : {}
  const mode =
    source.mode === 'light' || source.mode === 'dark' || source.mode === 'system'
      ? source.mode
      : DEFAULT_APPEARANCE_SETTINGS.mode
  const codeThemeIds = isRecord(source.codeThemeIds) ? source.codeThemeIds : {}
  const chromeThemes = isRecord(source.chromeThemes) ? source.chromeThemes : {}
  const fontSizes = isRecord(source.fontSizes) ? source.fontSizes : {}
  const normalizedThemes = {
    light: normalizeChromeTheme(chromeThemes.light, DEFAULT_CHROME_THEMES.light, 'light'),
    dark: normalizeChromeTheme(chromeThemes.dark, DEFAULT_CHROME_THEMES.dark, 'dark'),
  }
  const fonts = normalizeSharedFonts(source.fonts, mode, normalizedThemes)
  return {
    version: 8,
    mode,
    chromeThemes: withSharedVariantFonts(normalizedThemes, fonts),
    codeThemeIds: {
      light: codeThemeIdOr(codeThemeIds.light, 'codex-light'),
      dark: codeThemeIdOr(codeThemeIds.dark, 'codex-dark'),
    },
    fonts,
    pointerCursorEnabled: booleanOr(
      source.pointerCursorEnabled,
      DEFAULT_APPEARANCE_SETTINGS.pointerCursorEnabled,
    ),
    reduceMotion:
      source.reduceMotion === 'on' || source.reduceMotion === 'off'
        ? source.reduceMotion
        : 'system',
    fontSmoothingEnabled: booleanOr(
      source.fontSmoothingEnabled,
      DEFAULT_APPEARANCE_SETTINGS.fontSmoothingEnabled,
    ),
    fontSizes: {
      ui: numberInRange(fontSizes.ui, 14, 11, 16),
      code: numberInRange(fontSizes.code, 12, 8, 24),
    },
  }
}

/**
 * V8 hoists the fonts to the appearance level so light and dark share one UI
 * and one code font. Every existing mode, theme color, code theme, cursor,
 * motion, font-size, and font-smoothing value survives; the shared font value
 * is seeded from the current mode's variant so the visible theme does not change
 * during the upgrade, and it is mirrored back onto both variants for readers
 * that still read `chromeThemes[*].fonts`.
 *
 * V6 was an intentional solid-surface reset. Known V1-V5 documents are still
 * replaced with the new defaults instead of carrying old palette choices into
 * the semantic-token contract. Future documents remain protected from
 * downgrade.
 */
export function migrateAppearanceSettings(value: unknown): DesktopThemeSettingsV8 {
  if (!isRecord(value)) {
    throw new UnsupportedAppearanceSettingsVersionError(value)
  }

  const originalVersion = value.version
  if (
    typeof originalVersion !== 'number' ||
    !Number.isInteger(originalVersion) ||
    originalVersion < 1
  ) {
    throw new UnsupportedAppearanceSettingsVersionError(originalVersion)
  }
  if (originalVersion > CURRENT_APPEARANCE_SETTINGS_VERSION) {
    throw new NewerAppearanceSettingsVersionError(originalVersion)
  }

  if (originalVersion < 6) {
    return normalizeAppearanceSettings(DEFAULT_APPEARANCE_SETTINGS)
  }
  return normalizeAppearanceSettings(value)
}

export class UnsupportedAppearanceSettingsVersionError extends Error {
  constructor(readonly version: unknown) {
    super('无法识别外观设置版本，原设置文件已保留')
    this.name = 'UnsupportedAppearanceSettingsVersionError'
  }
}

export class NewerAppearanceSettingsVersionError extends Error {
  constructor(readonly version: number) {
    super(`外观设置版本 ${version} 高于当前支持的版本，原设置文件已保留`)
    this.name = 'NewerAppearanceSettingsVersionError'
  }
}

/**
 * 记录读取结果三态：只有文件确实不存在才允许重跑迁移。读取失败或内容无法
 * 识别时必须原样保留记录，重跑会以当前外观覆盖唯一备份，并把用户已调整的
 * 外观再次重置为默认主题。
 */
type MigrationRecordReadResult =
  | { status: 'missing' }
  | { status: 'record'; record: AppearanceMigrationRecord }
  | { status: 'unreadable'; reason: 'read-error' | 'invalid-json' | 'unknown-record' }

function migrationBackupOr(value: unknown): AppearanceMigrationBackup | null {
  if (!isRecord(value)) return null
  const chromeThemes = isRecord(value.chromeThemes) ? value.chromeThemes : null
  const fontSizes = isRecord(value.fontSizes) ? value.fontSizes : null
  if (!chromeThemes || !fontSizes) return null
  // 备份只由本迁移写入，字段缺失即视为无法识别，不做兜底猜测。
  if (typeof fontSizes.ui !== 'number' || !Number.isFinite(fontSizes.ui)) return null
  if (!isRecord(chromeThemes.light) || !isRecord(chromeThemes.dark)) return null
  const normalizedThemes = {
    light: normalizeChromeTheme(chromeThemes.light, DEFAULT_CHROME_THEMES.light, 'light'),
    dark: normalizeChromeTheme(chromeThemes.dark, DEFAULT_CHROME_THEMES.dark, 'dark'),
  }
  // 旧迁移备份没有预设字段；完成记账时保留原字段集合。
  for (const [variant, source] of [
    ['light', chromeThemes.light],
    ['dark', chromeThemes.dark],
  ] as const) {
    if (source.accentPreset === undefined) delete normalizedThemes[variant].accentPreset
  }
  return {
    chromeThemes: normalizedThemes,
    fontSizes: { ui: fontSizes.ui },
  }
}

function migrationRecordOr(value: unknown): AppearanceMigrationRecord | null {
  if (!isRecord(value)) return null
  if (value.version !== MIGRATION_RECORD_VERSION) return null
  if (value.migrationId !== MIGRATION_ID) return null
  if (value.state !== 'completed' && value.state !== 'pending') return null
  const backup =
    value.backup === undefined || value.backup === null ? null : migrationBackupOr(value.backup)
  if (value.backup !== undefined && value.backup !== null && !backup) return null
  // pending 记录必须带备份：缺少备份说明它不属于本次迁移，沿用它会丢失恢复点。
  if (value.state === 'pending' && !backup) return null
  return {
    version: MIGRATION_RECORD_VERSION,
    migrationId: MIGRATION_ID,
    state: value.state,
    backup,
  }
}

export class AppearanceSettingsStore {
  readonly #filePath: string
  readonly #migrationFilePath: string
  readonly #logger: AppearanceSettingsLogger | undefined
  #writeQueue: Promise<void> = Promise.resolve()
  #existingVersionChecked = false

  constructor(
    userDataDirectory: string,
    logger?: AppearanceSettingsLogger,
    fileName = 'appearance-settings.json',
    migrationFileName = 'appearance-migration.json',
  ) {
    this.#filePath = join(userDataDirectory, fileName)
    this.#migrationFilePath = join(userDataDirectory, migrationFileName)
    this.#logger = logger
  }

  get filePath(): string {
    return this.#filePath
  }

  get migrationFilePath(): string {
    return this.#migrationFilePath
  }

  async load(): Promise<DesktopThemeSettingsV8> {
    try {
      const source = await readFile(this.#filePath, 'utf8')
      let parsed: unknown
      try {
        parsed = JSON.parse(source)
      } catch (error) {
        if (error instanceof SyntaxError) {
          return this.#removeCorruptAndReset()
        }
        throw error
      }
      const normalized = migrateAppearanceSettings(parsed)
      const recordRead = await this.#readMigrationRecord()
      if (recordRead.status === 'unreadable') {
        // 记录不可读、格式损坏或不属于本次迁移时只能原样保留：既不能重跑迁移
        // 覆盖备份，也不能改写自己无法识别的记录。
        this.#logger?.info('appearance-settings.migration-record-preserved', {
          reason: recordRead.reason,
        })
        return normalized
      }
      const migrationRecord = recordRead.status === 'record' ? recordRead.record : null
      if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
        await this.save(normalized)
      }
      // 仅完成旧迁移的记账，默认配色更新不得覆盖当前外观或原备份。
      if (migrationRecord?.state === 'pending') {
        await this.#writeMigrationRecord({ ...migrationRecord, state: 'completed' })
      }
      return normalized
    } catch (error) {
      if (!isMissingFileError(error)) throw error
      const fallback = normalizeAppearanceSettings(DEFAULT_APPEARANCE_SETTINGS)
      await this.save(fallback)
      await this.#writeMigrationRecord({
        version: MIGRATION_RECORD_VERSION,
        migrationId: MIGRATION_ID,
        state: 'completed',
        backup: null,
      })
      return fallback
    }
  }

  async canRestorePreviousAppearance(): Promise<boolean> {
    const recordRead = await this.#readMigrationRecord()
    return (
      recordRead.status === 'record' &&
      recordRead.record.state === 'completed' &&
      Boolean(recordRead.record.backup)
    )
  }

  async restorePreviousAppearance(): Promise<DesktopThemeSettingsV8> {
    const recordRead = await this.#readMigrationRecord()
    const record = recordRead.status === 'record' ? recordRead.record : null
    if (!record?.backup) {
      throw new Error('无可用升级前外观备份')
    }
    const current = await this.load()
    const backup = record.backup
    // The backup keeps fonts per variant; the current mode's variant restores them.
    const restoredFonts: DesktopThemeFonts = normalizeSharedFonts(
      undefined,
      current.mode,
      backup.chromeThemes,
    )

    const restored: DesktopThemeSettingsV8 = {
      ...current,
      chromeThemes: {
        light: {
          ...current.chromeThemes.light,
          accent: backup.chromeThemes.light.accent,
          accentPreset: backup.chromeThemes.light.accentPreset ?? 'custom',
          surface: backup.chromeThemes.light.surface,
          ink: backup.chromeThemes.light.ink,
          contrast: backup.chromeThemes.light.contrast,
          semanticColors: { ...backup.chromeThemes.light.semanticColors },
        },
        dark: {
          ...current.chromeThemes.dark,
          accent: backup.chromeThemes.dark.accent,
          accentPreset: backup.chromeThemes.dark.accentPreset ?? 'custom',
          surface: backup.chromeThemes.dark.surface,
          ink: backup.chromeThemes.dark.ink,
          contrast: backup.chromeThemes.dark.contrast,
          semanticColors: { ...backup.chromeThemes.dark.semanticColors },
        },
      },
      fonts: restoredFonts,
      fontSizes: {
        ...current.fontSizes,
        ui: backup.fontSizes.ui,
      },
    }
    await this.save(restored)
    return this.load()
  }

  async applyNewDesignTheme(): Promise<DesktopThemeSettingsV8> {
    const current = await this.load()
    const next: DesktopThemeSettingsV8 = {
      ...current,
      chromeThemes: {
        light: { ...DEFAULT_CHROME_THEMES.light, fonts: { ...current.fonts } },
        dark: { ...DEFAULT_CHROME_THEMES.dark, fonts: { ...current.fonts } },
      },
    }
    await this.save(next)
    return next
  }

  save(value: unknown): Promise<void> {
    const normalized = migrateAppearanceSettings(value)
    const write = this.#writeQueue.then(async () => {
      await this.#assertExistingVersionWritable()
      await this.#writeAtomically(normalized)
    })
    this.#writeQueue = write.catch(() => undefined)
    return write
  }

  async #readMigrationRecord(): Promise<MigrationRecordReadResult> {
    let source: string
    try {
      source = await readFile(this.#migrationFilePath, 'utf8')
    } catch (error) {
      return isMissingFileError(error)
        ? { status: 'missing' }
        : { status: 'unreadable', reason: 'read-error' }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(source)
    } catch {
      return { status: 'unreadable', reason: 'invalid-json' }
    }
    const record = migrationRecordOr(parsed)
    return record
      ? { status: 'record', record }
      : { status: 'unreadable', reason: 'unknown-record' }
  }

  async #writeMigrationRecord(record: AppearanceMigrationRecord): Promise<void> {
    await writeJsonAtomically(this.#migrationFilePath, record)
  }

  async #assertExistingVersionWritable(): Promise<void> {
    if (this.#existingVersionChecked) return
    try {
      const existing = JSON.parse(await readFile(this.#filePath, 'utf8'))
      if (
        isRecord(existing) &&
        typeof existing.version === 'number' &&
        existing.version > CURRENT_APPEARANCE_SETTINGS_VERSION
      ) {
        throw new NewerAppearanceSettingsVersionError(existing.version)
      }
    } catch (error) {
      if (!isMissingFileError(error) && !(error instanceof SyntaxError)) throw error
    }
    this.#existingVersionChecked = true
  }

  async #removeCorruptAndReset(): Promise<DesktopThemeSettingsV8> {
    await rm(this.#filePath, { force: true })
    this.#logger?.info('appearance-settings.corrupt-reset', { reason: 'invalid-json' })
    const fallback = normalizeAppearanceSettings(DEFAULT_APPEARANCE_SETTINGS)
    await this.save(fallback)
    await this.#writeMigrationRecord({
      version: MIGRATION_RECORD_VERSION,
      migrationId: MIGRATION_ID,
      state: 'completed',
      backup: null,
    })
    return fallback
  }

  async #writeAtomically(settings: DesktopThemeSettingsV8): Promise<void> {
    await writeJsonAtomically(this.#filePath, settings)
  }
}

export interface AppearanceSettingsLogger {
  info(event: string, fields?: Record<string, unknown>): void
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}
