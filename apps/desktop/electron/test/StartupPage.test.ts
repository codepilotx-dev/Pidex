import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_APPEARANCE_SETTINGS } from '../src/settings/AppearanceSettingsStore.js'
import {
  createRendererApplicationUrl,
  RENDERER_STARTUP_THEME_QUERY_PARAM,
  renderStartupPage,
  resolveStartupPageTheme,
} from '../src/windows/StartupPage.js'

const SVG_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  readFileSync(resolve(import.meta.dirname, '../../build/pidex-mark-green.svg'), 'utf-8'),
)}`
const LIGHT_OPTIONS = {
  logoDataUrl: SVG_DATA_URL,
  variant: 'light' as const,
  theme: {
    surface: '#ffffff' as const,
    ink: '#1a1c1f' as const,
    accent: '#339cff' as const,
  },
}

describe('startup page', () => {
  test('renders the Pidex SVG logo with the Codex-style motion contract', () => {
    const html = renderStartupPage(LIGHT_OPTIONS)

    expect(html).toContain(`src="${SVG_DATA_URL}"`)
    expect(html).toContain('image/svg+xml')
    expect(html).toContain('width: 56px')
    expect(html).toContain('animation: startup-logo-fade-in 180ms ease-out 60ms forwards')
    expect(html).toContain('animation: startup-logo-shimmer 2200ms')
    expect(html).toContain('cubic-bezier(0.4, 0, 0.2, 1) infinite')
    expect(html).toContain('background-position: 140% 0')
    expect(html).toContain('background-position: -105% 0')
    expect(html.toLowerCase()).not.toContain('openai')
    expect(html.toLowerCase()).not.toContain('blossom')
  })

  test('delays diagnostics, reveals terminal errors, and preserves actions', () => {
    const html = renderStartupPage(LIGHT_OPTIONS)

    expect(html).toContain('visibility: hidden')
    expect(html).toContain('window.setTimeout(revealDiagnostics, 8000)')
    expect(html).toContain('kind === "terminal-error"')
    expect(html).toContain('openLogDirectory()')
    expect(html).toContain('quitDuringStartup()')
  })

  test('shows a single-line status window below the brand mark at all times', () => {
    const html = renderStartupPage(LIGHT_OPTIONS)

    expect(html).toContain('class="startup-status-window"')
    expect(html).toContain('<p id="status" class="startup-status">正在启动…</p>')
    expect(html).toContain('height: 21px')
    expect(html).toContain('overflow: hidden')
    expect(html).toContain('white-space: nowrap')
    expect(html).toContain('text-overflow: ellipsis')
  })

  test('status updates swap text vertically instead of a timed carousel', () => {
    const html = renderStartupPage(LIGHT_OPTIONS)

    expect(html).toContain('duration: 180')
    expect(html).toContain('duration: 280')
    expect(html).toContain('cubic-bezier(0.23, 1, 0.32, 1)')
    expect(html).toContain('translateY(-4px)')
    expect(html).toContain('translateY(4px)')
    expect(html).not.toContain('setInterval')
  })

  test('progress keeps busy; terminal errors clear busy and reveal diagnostics', () => {
    const html = renderStartupPage(LIGHT_OPTIONS)

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('loaderElement?.setAttribute("aria-busy", "false")')
    expect(html).toContain('(prefers-reduced-motion: reduce)')
    // busy 清除只发生在 terminal-error 分支内，普通 progress 保持 busy。
    const errorBranch = html.indexOf('kind === "terminal-error"')
    const busyClear = html.indexOf('loaderElement?.setAttribute("aria-busy", "false")')
    expect(errorBranch).toBeGreaterThan(-1)
    expect(busyClear).toBeGreaterThan(errorBranch)
  })

  test('uses the resolved light theme', () => {
    const html = renderStartupPage(LIGHT_OPTIONS)

    expect(html).toContain('--startup-background: #ffffff')
    expect(html).toContain('--startup-foreground: #1a1c1f')
    expect(html).toContain('--startup-accent: #339cff')
    expect(html).toContain('--startup-logo-base-opacity: 0.24')
    expect(html).toContain('data-theme="light"')
    expect(html).toContain('color-scheme" content="light"')
    expect(html).not.toContain('--startup-background: #181818')
    expect(html).not.toContain('invert(1)')
    expect(html).toContain('@media (prefers-reduced-motion: reduce)')
    expect(html).toContain('animation: none')
  })

  test('uses custom dark colors for the startup background and controls', () => {
    const html = renderStartupPage({
      logoDataUrl: SVG_DATA_URL,
      variant: 'dark',
      theme: {
        surface: '#121725',
        ink: '#f4f6ff',
        accent: '#8db8ff',
      },
    })

    expect(html).toContain('--startup-background: #121725')
    expect(html).toContain('--startup-foreground: #f4f6ff')
    expect(html).toContain('--startup-accent: #8db8ff')
    expect(html).toContain('color-mix(in srgb, #f4f6ff 62%, transparent)')
    expect(html).toContain('grayscale(1) brightness(0) invert(1)')
    expect(html).toContain('data-theme="dark"')
    expect(html).toContain('color-scheme" content="dark"')
    expect(html).toContain('outline: 2px solid var(--startup-accent)')
  })

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
