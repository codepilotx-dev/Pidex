import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_APPEARANCE_SETTINGS } from '../src/settings/AppearanceSettingsStore.js'
import { readStartupAppearanceConfig } from '../src/settings/StartupAppearanceConfig.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('startup appearance config', () => {
  test('Electron bundle 不保留 jsonc-parser 的未解析相对 require', async () => {
    const result = await Bun.build({
      entrypoints: [resolve(import.meta.dir, '../src/settings/StartupAppearanceConfig.ts')],
      format: 'esm',
      target: 'node',
    })
    expect(result.success).toBe(true)
    expect(result.outputs).toHaveLength(1)
    const bundled = await result.outputs[0]!.text()
    expect(bundled).not.toContain('require2("./impl/format")')
  })

  test('优先读取支持注释和尾逗号的 config.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-startup-theme-'))
    roots.push(root)
    const configPath = join(root, 'config.json')
    const legacyConfigPath = join(root, 'config.toml')
    const legacyPath = join(root, 'appearance-settings.json')
    await writeFile(
      configPath,
      [
        '{',
        '  // JSONC 注释必须被接受',
        '  "desktop": {',
        '    "appearance": {',
        '      "version": 6,',
        '      "mode": "dark",',
        '      "iconTheme": "system",',
        '      "codeTheme": "system",',
        '      "chromeTheme": "default",',
        '      "pointerCursorEnabled": true,',
        '      "fontSmoothingEnabled": true,',
        '    },',
        '  },',
        '}',
      ].join('\n'),
      'utf8',
    )
    await writeFile(
      legacyConfigPath,
      ['[desktop.appearance]', 'version = 6', 'mode = "light"'].join('\n'),
      'utf8',
    )
    await writeFile(
      legacyPath,
      JSON.stringify({ ...DEFAULT_APPEARANCE_SETTINGS, mode: 'light' }),
      'utf8',
    )
    expect(
      await readStartupAppearanceConfig(configPath, legacyConfigPath, legacyPath),
    ).toMatchObject({
      version: 7,
      mode: 'dark',
    })
  })

  test('config.json 不存在时回退读取 config.toml', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-startup-theme-'))
    roots.push(root)
    const configPath = join(root, 'config.json')
    const legacyConfigPath = join(root, 'config.toml')
    const legacyPath = join(root, 'appearance-settings.json')
    await writeFile(
      legacyConfigPath,
      [
        '[desktop.appearance]',
        'version = 6',
        'mode = "dark"',
        'iconTheme = "system"',
        'codeTheme = "system"',
        'chromeTheme = "default"',
        'pointerCursorEnabled = true',
        'fontSmoothingEnabled = true',
      ].join('\n'),
      'utf8',
    )
    await writeFile(
      legacyPath,
      JSON.stringify({ ...DEFAULT_APPEARANCE_SETTINGS, mode: 'light' }),
      'utf8',
    )
    expect(
      await readStartupAppearanceConfig(configPath, legacyConfigPath, legacyPath),
    ).toMatchObject({
      mode: 'dark',
    })
  })

  test('config.json 已存在但无效时不回退 config.toml', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-startup-theme-'))
    roots.push(root)
    const configPath = join(root, 'config.json')
    const legacyConfigPath = join(root, 'config.toml')
    const legacyPath = join(root, 'appearance-settings.json')
    await writeFile(configPath, '{"desktop":', 'utf8')
    await writeFile(
      legacyConfigPath,
      ['[desktop.appearance]', 'version = 6', 'mode = "dark"'].join('\n'),
      'utf8',
    )
    await writeFile(
      legacyPath,
      JSON.stringify({ ...DEFAULT_APPEARANCE_SETTINGS, mode: 'light' }),
      'utf8',
    )
    expect(
      await readStartupAppearanceConfig(configPath, legacyConfigPath, legacyPath),
    ).toMatchObject({
      mode: 'light',
    })
  })

  test('高版本 config.json 保持原文件且只使用安全回退值', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-startup-theme-'))
    roots.push(root)
    const configPath = join(root, 'config.json')
    const source = JSON.stringify({
      desktop: {
        appearance: {
          version: 8,
          mode: 'light',
          futureField: 'must-survive',
        },
      },
    })
    await writeFile(configPath, source, 'utf8')

    expect(await readStartupAppearanceConfig(configPath)).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    expect(await readFile(configPath, 'utf8')).toBe(source)
  })
})
