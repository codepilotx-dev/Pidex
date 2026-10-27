import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_APPEARANCE_SETTINGS } from '../src/settings/AppearanceSettingsStore.js'
import {
  createRendererApplicationUrl,
  RENDERER_STARTUP_THEME_QUERY_PARAM,
  resolveStartupPageTheme,
} from '../src/windows/StartupPage.js'

describe('startup theme', () => {
  test('resolves explicit and system V7 theme variants', () => {
    expect(
      resolveStartupPageTheme({ ...DEFAULT_APPEARANCE_SETTINGS, mode: 'light' }, 'dark'),
    ).toEqual({
      variant: 'light',
      theme: {
        surface: '#ffffff',
        ink: '#1f1f1f',
        accent: '#0169cc',
        surfaceUnder: '#f6f6f6',
      },
    })
    expect(resolveStartupPageTheme(DEFAULT_APPEARANCE_SETTINGS, 'dark')).toEqual({
      variant: 'dark',
      theme: {
        surface: '#111111',
        ink: '#eeeeee',
        accent: '#0169cc',
        surfaceUnder: '#0f0f0f',
      },
    })
  })

  test('carries the resolved startup theme into the renderer URL', () => {
    const target = new URL(
      createRendererApplicationUrl('http://127.0.0.1:4210/?existing=kept', {
        variant: 'dark',
        theme: {
          surface: '#121725',
          ink: '#f4f6ff',
          accent: '#8db8ff',
          surfaceUnder: '#0f1420',
        },
      }),
    )

    expect(target.origin).toBe('http://127.0.0.1:4210')
    expect(target.searchParams.get('existing')).toBe('kept')
    expect(
      JSON.parse(target.searchParams.get(RENDERER_STARTUP_THEME_QUERY_PARAM) ?? 'null'),
    ).toEqual({
      version: 1,
      variant: 'dark',
      surface: '#121725',
      ink: '#f4f6ff',
    })
  })

  test('pidex-mark-green.svg contains the transparent Pidex brand mark', () => {
    const svg = readFileSync(
      resolve(import.meta.dirname, '../../build/pidex-mark-green.svg'),
      'utf-8',
    )

    expect(svg).toContain('Pidex 启卷')
    expect(svg).toContain('viewBox="0 0 1024 1024"')
    expect(svg).toContain('fill="#164B40"')
    expect(svg).not.toContain('<rect')
    expect(svg).not.toMatch(/openai/i)
    expect(svg).not.toMatch(/blossom/i)
  })
})
