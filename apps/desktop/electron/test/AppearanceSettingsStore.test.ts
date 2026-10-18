import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getDesktopAccentPresetColor, type DesktopAccentPreset } from '@pidex/shared/desktop-theme'
import {
  AppearanceSettingsStore,
  DEFAULT_APPEARANCE_SETTINGS,
  NewerAppearanceSettingsVersionError,
  migrateAppearanceSettings,
  normalizeAppearanceSettings,
} from '../src/settings/AppearanceSettingsStore'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function temporaryRoot(): string {
  const root = join(import.meta.dir, `.appearance-${crypto.randomUUID()}`)
  roots.push(root)
  return root
}

describe('Electron 外观设置存储', () => {
  test('强调色预设区分默认与黑白，保存重载并保留旧版或不匹配的实际颜色', async () => {
    const root = temporaryRoot()
    const store = new AppearanceSettingsStore(root)
    const current = await store.load()
    const presets: DesktopAccentPreset[] = [
      'default',
      'blue',
      'green',
      'yellow',
      'pink',
      'orange',
      'purple',
      'black',
      'custom',
    ]
    for (const preset of presets) {
      const chromeThemes = { ...current.chromeThemes }
      for (const variant of ['light', 'dark'] as const) {
        chromeThemes[variant] = {
          ...chromeThemes[variant],
          accent: getDesktopAccentPresetColor(preset, variant) ?? '#123abc',
          accentPreset: preset,
        }
      }
      await store.save({ ...current, chromeThemes })
      const reloaded = await new AppearanceSettingsStore(root).load()
      for (const variant of ['light', 'dark'] as const) {
        expect(reloaded.chromeThemes[variant]).toEqual({
          ...chromeThemes[variant],
          accent: chromeThemes[variant].accent.toLowerCase(),
        })
      }
    }
    for (const version of [6, 7]) {
      for (const accentPreset of [undefined, 'unknown', 'blue', 'default', 'black']) {
        const normalized = normalizeAppearanceSettings({
          ...current,
          version,
          chromeThemes: {
            light: { ...current.chromeThemes.light, accent: '#fa70ab', accentPreset },
            dark: { ...current.chromeThemes.dark, accent: '#fa70ab', accentPreset },
          },
        })
        expect(normalized.chromeThemes.light.accentPreset).toBe('custom')
        expect(normalized.chromeThemes.dark.accentPreset).toBe('custom')
        expect(normalized.chromeThemes.light.accent).toBe('#fa70ab')
        expect(normalized.chromeThemes.dark.accent).toBe('#fa70ab')
      }
    }
  })
  test('首次读取创建当前代际的设置文件与 completed 迁移记录（无备份）', async () => {
    const root = temporaryRoot()
    const store = new AppearanceSettingsStore(root)

    expect(await store.load()).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    expect(JSON.parse(await readFile(store.filePath, 'utf8'))).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    expect(JSON.parse(await readFile(store.migrationFilePath, 'utf8'))).toEqual({
      version: 1,
      migrationId: 'ui-design-visual-theme',
      state: 'completed',
      backup: null,
    })
    expect(await store.canRestorePreviousAppearance()).toBe(false)
    await expect(store.restorePreviousAppearance()).rejects.toThrow('无可用升级前外观备份')
  })

  test('Codex(new) 主题选择保存后可重新读取', async () => {
    const root = temporaryRoot()
    const store = new AppearanceSettingsStore(root)
    const current = await store.load()
    const codeThemeIds = { light: 'codex-new-light', dark: 'codex-new-dark' }
    await store.save({ ...current, codeThemeIds })
    expect((await new AppearanceSettingsStore(root).load()).codeThemeIds).toEqual(codeThemeIds)
  })

  test('损坏 JSON 删除旧文件、记录无敏感信息的事件并恢复默认值', async () => {
    const root = temporaryRoot()
    const records: Array<{ event: string; fields?: Record<string, unknown> }> = []
    const store = new AppearanceSettingsStore(root, {
      info: (event, fields) => records.push({ event, fields }),
    })
    await mkdir(root, { recursive: true })
    await writeFile(store.filePath, '{not-json', 'utf8')

    expect(await store.load()).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    expect(JSON.parse(await readFile(store.filePath, 'utf8'))).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    expect((await readdir(root)).sort()).toEqual([
      'appearance-migration.json',
      'appearance-settings.json',
    ])
    expect(records).toEqual([
      {
        event: 'appearance-settings.corrupt-reset',
        fields: { reason: 'invalid-json' },
      },
    ])
    expect(JSON.stringify(records)).not.toContain(root)
    expect(JSON.stringify(records)).not.toContain('not-json')
  })

  test('保存当前代际时规范化字段并限制数值、颜色和字体 face', () => {
    const normalized = normalizeAppearanceSettings({
      version: 7,
      mode: 'dark',
      codeThemeIds: { light: 'auto', dark: 'linear-dark' },
      pointerCursorEnabled: true,
      reduceMotion: 'on',
      fontSizes: { ui: 999, code: 1 },
      chromeThemes: {
        light: {
          fonts: {
            ui: 'Inter',
            uiFace: {
              family: 'Inter',
              fullName: 'Inter Regular',
              postscriptName: 'Inter-Regular',
            },
            codeFace: {
              family: 'JetBrains Mono',
              fullName: 'JetBrains Mono Regular',
              postscriptName: 'JetBrainsMono-Regular',
            },
          },
        },
      },
    })

    expect(normalized).toMatchObject({
      version: 8,
      mode: 'dark',
      codeThemeIds: { light: 'codex-light', dark: 'linear-dark' },
      pointerCursorEnabled: true,
      reduceMotion: 'on',
      fontSizes: { ui: 16, code: 8 },
    })
    // The mode's variant seeds the shared fonts; both variants mirror them.
    expect(normalized.fonts).toEqual({
      ui: 'Inter',
      uiFace: {
        family: 'Inter',
        fullName: 'Inter Regular',
        postscriptName: 'Inter-Regular',
      },
      code: null,
      codeFace: null,
    })
    for (const variant of ['light', 'dark'] as const) {
      expect(normalized.chromeThemes[variant].fonts).toEqual(normalized.fonts)
    }
    expect(normalized.chromeThemes.light).not.toHaveProperty('opaqueWindows')
    expect(normalized.chromeThemes.dark).not.toHaveProperty('opaqueWindows')
  })

  test('非法、过长或不匹配的字体 face 回退为 null 并显式持久化', () => {
    const normalized = normalizeAppearanceSettings({
      version: 7,
      chromeThemes: {
        dark: {
          fonts: {
            ui: 'Inter',
            uiFace: {
              family: 'JetBrains Mono',
              fullName: 'JetBrains Mono Bold',
              postscriptName: 'JetBrainsMono-Bold',
            },
            code: 'CodeMono',
            codeFace: {
              family: 'A'.repeat(201),
              fullName: 'B',
              postscriptName: 'C',
            },
          },
        },
      },
    })

    expect(normalized.fonts.uiFace).toBeNull()
    expect(normalized.fonts.codeFace).toBeNull()
    expect(normalized.fonts).toHaveProperty('uiFace', null)
    expect(normalized.fonts).toHaveProperty('codeFace', null)
    expect(normalized.fonts).toEqual({
      ui: 'Inter',
      uiFace: null,
      code: 'CodeMono',
      codeFace: null,
    })
    expect(normalized.chromeThemes.light.fonts).toEqual(normalized.fonts)
  })

  test('读取 V6 设置时保留式升级到 V8 并把字体提升为全外观共用', async () => {
    const root = temporaryRoot()
    const records: Array<{ event: string; fields?: Record<string, unknown> }> = []
    const store = new AppearanceSettingsStore(root, {
      info: (event, fields) => records.push({ event, fields }),
    })
    const v6 = {
      version: 6,
      mode: 'light',
      codeThemeIds: { light: 'github-light-default', dark: 'codex-dark' },
      chromeThemes: {
        light: {
          accent: '#ABCDEF',
          surface: '#fefefe',
          ink: '#111111',
          contrast: 42,
          fonts: { ui: '  Inter  ', code: 'JetBrains Mono' },
          semanticColors: {
            diffAdded: '#00a240',
            diffRemoved: '#ba2623',
            skill: '#924ff7',
          },
        },
        dark: {
          accent: '#339cff',
          surface: '#181818',
          ink: '#ffffff',
          contrast: 60,
          fonts: { ui: null, code: 'Cascadia Code' },
          semanticColors: {
            diffAdded: '#40c977',
            diffRemoved: '#fa423e',
            skill: '#ad7bf9',
          },
        },
      },
      pointerCursorEnabled: true,
      reduceMotion: 'off',
      fontSmoothingEnabled: false,
      fontSizes: { ui: 15, code: 13 },
    }
    await mkdir(root, { recursive: true })
    await writeFile(store.filePath, JSON.stringify(v6), 'utf8')

    const loaded = await store.load()

    expect(loaded).toMatchObject({
      version: 8,
      mode: 'light',
      codeThemeIds: { light: 'github-light-default', dark: 'codex-dark' },
      pointerCursorEnabled: true,
      reduceMotion: 'off',
      fontSmoothingEnabled: false,
      fontSizes: { ui: 15, code: 13 },
    })
    expect(loaded.chromeThemes.light.accent).toBe('#abcdef')
    expect(loaded.chromeThemes.light.surface).toBe('#fefefe')
    // The light variant owns the shared fonts because it is the active mode;
    // both variants mirror the result so the V9 code font is gone from here.
    expect(loaded.fonts).toEqual({
      ui: 'Inter',
      uiFace: null,
      code: 'JetBrains Mono',
      codeFace: null,
    })
    expect(loaded.chromeThemes.light.fonts).toEqual(loaded.fonts)
    expect(loaded.chromeThemes.dark.fonts).toEqual(loaded.fonts)
    expect(records).toEqual([])
    expect(await store.canRestorePreviousAppearance()).toBe(false)
    expect(JSON.parse(await readFile(store.filePath, 'utf8'))).toEqual(loaded)
    expect(await new AppearanceSettingsStore(root).load()).toEqual(loaded)

    const reapplied = await store.applyNewDesignTheme()
    expect(reapplied.chromeThemes.light.accent).toBe('#0169cc')
    expect(reapplied.chromeThemes.light.surface).toBe('#ffffff')
    expect(reapplied.fontSizes.ui).toBe(15)
    expect(reapplied.fonts.ui).toBe('Inter')
    expect(reapplied.fonts.code).toBe('JetBrains Mono')
    expect(JSON.parse(await readFile(store.filePath, 'utf8'))).toEqual(reapplied)
    expect(await store.canRestorePreviousAppearance()).toBe(false)
  })

  test('V7 缺少迁移记录时保留已保存配色、字体和字号，重启仍一致', async () => {
    const root = temporaryRoot()
    const store = new AppearanceSettingsStore(root)
    // A genuine V7 document: fonts still live on the variants and no shared
    // onts key exists yet.
    const { fonts: _v7AbsentSharedFonts, ...v7Defaults } = DEFAULT_APPEARANCE_SETTINGS
    const current = normalizeAppearanceSettings({
      ...v7Defaults,
      version: 7,
      chromeThemes: {
        light: {
          ...DEFAULT_APPEARANCE_SETTINGS.chromeThemes.light,
          accent: '#0066cc',
          ink: '#1d1d1f',
          fonts: { ui: 'Inter', uiFace: null, code: 'Cascadia Code', codeFace: null },
        },
        dark: DEFAULT_APPEARANCE_SETTINGS.chromeThemes.dark,
      },
      fontSizes: { ui: 16, code: 14 },
    })
    expect(current.version).toBe(8)
    expect(current.fonts.ui).toBe('Inter')
    await mkdir(root, { recursive: true })
    await writeFile(store.filePath, JSON.stringify(current), 'utf8')
    expect(await store.load()).toEqual(current)
    expect(await new AppearanceSettingsStore(root).load()).toEqual(current)
    expect(JSON.parse(await readFile(store.filePath, 'utf8'))).toEqual(current)
    expect(await readdir(root)).toEqual(['appearance-settings.json'])
  })

  test('重复启动幂等性：已有 completed 迁移记录时不重新覆盖用户外观设置', async () => {
    const root = temporaryRoot()
    const store1 = new AppearanceSettingsStore(root)
    const initial = await store1.load()
    expect(initial.chromeThemes.light.accent).toBe('#0169cc')

    const custom = {
      ...initial,
      chromeThemes: {
        ...initial.chromeThemes,
        light: {
          ...initial.chromeThemes.light,
          accent: '#ff0077',
        },
      },
    }
    await store1.save(custom)

    const store2 = new AppearanceSettingsStore(root)
    const reloaded = await store2.load()
    expect(reloaded.chromeThemes.light.accent).toBe('#ff0077')
  })

  test('迁移中断恢复：pending 仅完成记账，保留当前外观和原 backup', async () => {
    const root = temporaryRoot()
    const store = new AppearanceSettingsStore(root)
    await mkdir(root, { recursive: true })

    const customBackup = {
      chromeThemes: {
        light: {
          accent: '#112233',
          surface: '#fafafa',
          ink: '#222222',
          contrast: 50,
          semanticColors: { diffAdded: '#11aa22', diffRemoved: '#bb2211', skill: '#8833cc' },
          fonts: { ui: 'Consolas', uiFace: null, code: 'Courier', codeFace: null },
        },
        dark: {
          accent: '#445566',
          surface: '#111111',
          ink: '#eeeeee',
          contrast: 50,
          semanticColors: { diffAdded: '#11aa22', diffRemoved: '#bb2211', skill: '#8833cc' },
          fonts: { ui: null, uiFace: null, code: 'Courier', codeFace: null },
        },
      },
      fontSizes: { ui: 16 },
    }

    await writeFile(
      store.migrationFilePath,
      JSON.stringify({
        version: 1,
        migrationId: 'ui-design-visual-theme',
        state: 'pending',
        backup: customBackup,
      }),
      'utf8',
    )
    const current = normalizeAppearanceSettings({
      ...DEFAULT_APPEARANCE_SETTINGS,
      chromeThemes: customBackup.chromeThemes,
      fontSizes: { ui: 15, code: 16 },
    })
    await writeFile(store.filePath, JSON.stringify(current), 'utf8')

    const loaded = await store.load()
    expect(loaded).toEqual(current)
    expect(await new AppearanceSettingsStore(root).load()).toEqual(current)

    const migrationRecord = JSON.parse(await readFile(store.migrationFilePath, 'utf8'))
    expect(migrationRecord.state).toBe('completed')
    expect(migrationRecord.backup).toEqual(customBackup)

    expect(await store.canRestorePreviousAppearance()).toBe(true)
    const restored = await store.restorePreviousAppearance()
    expect(restored.chromeThemes.light.accent).toBe('#112233')
    expect(restored.fontSizes.ui).toBe(16)
  })

  test('迁移记录读取失败时保留原设置与记录，不重跑迁移', async () => {
    const root = temporaryRoot()
    const records: Array<{ event: string; fields?: Record<string, unknown> }> = []
    const store = new AppearanceSettingsStore(root, {
      info: (event, fields) => records.push({ event, fields }),
    })
    await mkdir(root, { recursive: true })
    const customized = {
      ...DEFAULT_APPEARANCE_SETTINGS,
      chromeThemes: {
        ...DEFAULT_APPEARANCE_SETTINGS.chromeThemes,
        light: {
          ...DEFAULT_APPEARANCE_SETTINGS.chromeThemes.light,
          accent: '#ff0077' as const,
        },
      },
    }
    await writeFile(store.filePath, JSON.stringify(customized), 'utf8')
    // 目录占位使 readFile 抛出非 ENOENT 错误，模拟瞬时读取失败。
    await mkdir(store.migrationFilePath, { recursive: true })

    const loaded = await store.load()

    expect(loaded.chromeThemes.light.accent).toBe('#ff0077')
    expect(JSON.parse(await readFile(store.filePath, 'utf8'))).toEqual(customized)
    expect(records).toEqual([
      {
        event: 'appearance-settings.migration-record-preserved',
        fields: { reason: 'read-error' },
      },
    ])
    expect(JSON.stringify(records)).not.toContain(root)
    expect(await store.canRestorePreviousAppearance()).toBe(false)
  })

  test('记录版本、迁移 ID 或备份不可识别时保留记录并跳过迁移', async () => {
    const foreignBackup = {
      chromeThemes: { light: { accent: '#112233' }, dark: null },
      fontSizes: {},
    }
    const candidates: Array<Record<string, unknown>> = [
      {
        version: 2,
        migrationId: 'ui-design-visual-theme',
        state: 'pending',
        backup: foreignBackup,
        futureField: true,
      },
      {
        version: 1,
        migrationId: 'some-other-migration',
        state: 'pending',
        backup: foreignBackup,
      },
      { version: 1, migrationId: 'ui-design-visual-theme', state: 'pending' },
      {
        version: 1,
        migrationId: 'ui-design-visual-theme',
        state: 'completed',
        backup: foreignBackup,
      },
    ]

    for (const candidate of candidates) {
      const root = temporaryRoot()
      const records: Array<{ event: string; fields?: Record<string, unknown> }> = []
      const store = new AppearanceSettingsStore(root, {
        info: (event, fields) => records.push({ event, fields }),
      })
      await mkdir(root, { recursive: true })
      const customized = {
        ...DEFAULT_APPEARANCE_SETTINGS,
        chromeThemes: {
          ...DEFAULT_APPEARANCE_SETTINGS.chromeThemes,
          light: {
            ...DEFAULT_APPEARANCE_SETTINGS.chromeThemes.light,
            accent: '#ff0077' as const,
          },
        },
      }
      await writeFile(store.filePath, JSON.stringify(customized), 'utf8')
      const source = JSON.stringify(candidate, null, 2)
      await writeFile(store.migrationFilePath, source, 'utf8')

      const loaded = await store.load()

      expect(loaded.chromeThemes.light.accent).toBe('#ff0077')
      expect(JSON.parse(await readFile(store.filePath, 'utf8'))).toEqual(customized)
      expect(await readFile(store.migrationFilePath, 'utf8')).toBe(source)
      expect(records).toEqual([
        {
          event: 'appearance-settings.migration-record-preserved',
          fields: { reason: 'unknown-record' },
        },
      ])
      expect(JSON.stringify(records)).not.toContain(root)
      expect(await store.canRestorePreviousAppearance()).toBe(false)
      await expect(store.restorePreviousAppearance()).rejects.toThrow('无可用升级前外观备份')
    }
  })

  test('迁移记录为损坏 JSON 时不重跑迁移并保留记录文件', async () => {
    const root = temporaryRoot()
    const records: Array<{ event: string; fields?: Record<string, unknown> }> = []
    const store = new AppearanceSettingsStore(root, {
      info: (event, fields) => records.push({ event, fields }),
    })
    await mkdir(root, { recursive: true })
    await writeFile(store.filePath, JSON.stringify(DEFAULT_APPEARANCE_SETTINGS), 'utf8')
    await writeFile(store.migrationFilePath, '{not-json', 'utf8')

    await store.load()

    expect(await readFile(store.migrationFilePath, 'utf8')).toBe('{not-json')
    expect(records).toEqual([
      {
        event: 'appearance-settings.migration-record-preserved',
        fields: { reason: 'invalid-json' },
      },
    ])
    expect(JSON.stringify(records)).not.toContain('{not-json')
  })

  test('读取旧设置时直接覆盖为当前默认值', async () => {
    const root = temporaryRoot()
    const records: Array<{ event: string; fields?: Record<string, unknown> }> = []
    const store = new AppearanceSettingsStore(root, {
      info: (event, fields) => records.push({ event, fields }),
    })
    await mkdir(root, { recursive: true })
    await writeFile(
      store.filePath,
      JSON.stringify({
        version: 2,
        mode: 'light',
        codeThemeIds: { light: 'auto', dark: 'codex-dark' },
        chromeThemes: {
          light: {
            accent: '#ABCDEF',
            fonts: { ui: '  Inter  ', code: 'JetBrains Mono' },
          },
        },
        reduceMotion: 'on',
        fontSizes: { ui: 13, code: 11 },
      }),
      'utf8',
    )

    const loaded = await store.load()

    expect(loaded).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    expect(JSON.parse(await readFile(store.filePath, 'utf8'))).toEqual(loaded)
    expect(records).toEqual([])
  })

  test('所有已知旧版本都重置为当前默认值', () => {
    for (const version of [1, 2, 3, 4, 5]) {
      expect(
        migrateAppearanceSettings({
          version,
          mode: 'dark',
          pointerCursorEnabled: true,
        }),
      ).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    }
  })

  test('读取更新版本时保留原文件并拒绝覆盖', async () => {
    const root = temporaryRoot()
    const store = new AppearanceSettingsStore(root)
    const futureSettings = JSON.stringify({
      version: 9,
      mode: 'light',
      futureField: 'must-survive',
    })
    await mkdir(root, { recursive: true })
    await writeFile(store.filePath, futureSettings, 'utf8')

    await expect(store.load()).rejects.toBeInstanceOf(NewerAppearanceSettingsVersionError)
    expect(await readFile(store.filePath, 'utf8')).toBe(futureSettings)
  })

  test('未先 load 时也拒绝用当前版本覆盖更新版本文件', async () => {
    const root = temporaryRoot()
    const store = new AppearanceSettingsStore(root)
    const futureSettings = JSON.stringify({
      version: 9,
      mode: 'light',
      futureField: 'must-survive',
    })
    await mkdir(root, { recursive: true })
    await writeFile(store.filePath, futureSettings, 'utf8')

    await expect(store.save(DEFAULT_APPEARANCE_SETTINGS)).rejects.toBeInstanceOf(
      NewerAppearanceSettingsVersionError,
    )
    expect(await readFile(store.filePath, 'utf8')).toBe(futureSettings)
  })

  test('并发保存按调用顺序串行，文件始终是完整 JSON', async () => {
    const root = temporaryRoot()
    const store = new AppearanceSettingsStore(root)
    const first = normalizeAppearanceSettings({
      ...DEFAULT_APPEARANCE_SETTINGS,
      mode: 'light',
    })
    const second = normalizeAppearanceSettings({
      ...DEFAULT_APPEARANCE_SETTINGS,
      mode: 'dark',
    })

    await Promise.all([store.save(first), store.save(second)])

    const restartedStore = new AppearanceSettingsStore(root)
    expect(await restartedStore.load()).toEqual(second)
  })
})
