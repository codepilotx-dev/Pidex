import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { expectSourceContains, normalizeSource } from './SourceContract.js'

/*
 * Frozen contracts for the non-color design-token refactor.
 *
 * This suite intentionally describes the FUTURE state of the token system and
 * is allowed to fail against today's source. It statically reads the real
 * files with node:fs; there are no snapshots and no quantity baselines.
 *
 * Frozen semantics (do not weaken to make tests green):
 * - tokens.css defines semantic type roles, a corrected 4px spacing scale,
 *   semantic radius/motion/z-index roles, and no root --control-/--layout-/
 *   --app-icon-/--menu- geometry tokens.
 * - CheckStyleContracts.ts + style-contracts.json grow a featureTokenContract
 *   that governs non-color tokens across styles, TSX, inline styles, Tailwind
 *   arbitrary values and component geometry, with precise reasons and stale
 *   detection.
 * - base.css reduced-motion zeroes every system motion token.
 */

function read(relative: string): Promise<string> {
  return readFile(new URL(relative, import.meta.url), 'utf8')
}

function extractTokens(source: string): Map<string, string> {
  const tokens = new Map<string, string>()
  for (const match of source.matchAll(/(^|[\r\n])[ \t]*(--[\w-]+)[ \t]*:[ \t]*([^;]+);/g)) {
    // 值里的换行只是格式化折行，CSS 声明本身与空白无关。
    tokens.set(match[2], match[3].replace(/\s+/g, ' ').trim())
  }
  return tokens
}

function missingFrom(tokens: Map<string, string>, expected: string[]): string[] {
  return expected.filter((name) => !tokens.has(name))
}

function blockContent(source: string, openPattern: RegExp): string | undefined {
  const startMatch = source.match(openPattern)
  if (!startMatch) return undefined
  const start = startMatch.index! + startMatch[0].length
  let depth = 1
  let index = start
  for (; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  return depth === 0 ? source.slice(start, index) : undefined
}

describe('non-color design token contracts', () => {
  test('tokens.css defines the semantic type role tokens', async () => {
    const tokens = extractTokens(await read('../src/styles/design-system/tokens.css'))
    const roles = [
      'display',
      'caption',
      'label',
      'body-sm',
      'body',
      'body-lg',
      'reading',
      'row-title',
      'control',
      'heading-sm',
      'heading-md',
      'heading-lg',
      'heading-xl',
      'metric',
      'code',
    ].map((role) => `--cpx-sys-type-${role}`)

    const missing = missingFrom(tokens, roles)
    expect(
      missing,
      `tokens.css must define every type role as a --cpx-sys-type-* token; missing: ${missing.join(', ') || 'none'}`,
    ).toEqual([])
  })

  test('tokens.css locks the Codex typography sizes, weights, and role-specific line heights', async () => {
    const tokens = extractTokens(await read('../src/styles/design-system/tokens.css'))
    expect(normalizeSource(tokens.get('--cpx-sys-font-family-sans'))).toBe(
      normalizeSource(
        'MiSans, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
      ),
    )
    const expected: Record<string, string> = {
      '--cpx-sys-font-size-code': '13px',
      '--cpx-sys-font-size-xs': '12px',
      '--cpx-sys-font-size-sm': '13px',
      '--cpx-sys-font-size-md': '14px',
      '--cpx-sys-font-size-lg': '16px',
      '--cpx-sys-font-size-xl': '18px',
      '--cpx-sys-font-size-2xl': '20px',
      '--cpx-sys-font-size-3xl': '24px',
      '--cpx-sys-font-size-4xl': '28px',
      '--cpx-sys-font-weight-regular': '400',
      '--cpx-sys-font-weight-body': '400',
      '--cpx-sys-font-weight-medium': '500',
      '--cpx-sys-font-weight-bold': '600',
      '--cpx-sys-line-height-caption': '1.4',
      '--cpx-sys-line-height-label': '1.3',
      '--cpx-sys-line-height-body-sm': '1.45',
      '--cpx-sys-line-height-body': '1.5',
      '--cpx-sys-line-height-body-lg': '1.5',
      '--cpx-sys-line-height-heading-sm': '1.25',
      '--cpx-sys-line-height-heading-md': '1.25',
      '--cpx-sys-line-height-heading-lg': '1.2',
      '--cpx-sys-line-height-heading-xl': '1.14',
      '--cpx-sys-line-height-display': '1.14',
      '--cpx-sys-line-height-reading': 'var(--cpx-sys-line-height-body)',
      '--cpx-sys-line-height-code': '1.5',
    }
    const mismatched = Object.entries(expected).filter(
      ([name, value]) => tokens.get(name) !== value,
    )

    expect(
      mismatched,
      `Codex typography contract mismatch: ${mismatched.map(([name, value]) => `${name}=${tokens.get(name) ?? '(missing)'} (expected ${value})`).join(', ') || 'none'}`,
    ).toEqual([])

    const roles: Record<string, string> = {
      '--cpx-sys-type-display':
        'var(--cpx-sys-font-weight-bold) var(--cpx-sys-font-size-4xl) / var(--cpx-sys-line-height-display) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-caption':
        'var(--cpx-sys-font-weight-body) var(--cpx-sys-font-size-xs) / var(--cpx-sys-line-height-caption) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-label':
        'var(--cpx-sys-font-weight-medium) var(--cpx-sys-font-size-xs) / var(--cpx-sys-line-height-label) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-body-sm':
        'var(--cpx-sys-font-weight-body) var(--cpx-sys-font-size-sm) / var(--cpx-sys-line-height-body-sm) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-body':
        'var(--cpx-sys-font-weight-body) var(--cpx-sys-font-size-md) / var(--cpx-sys-line-height-body) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-body-lg':
        'var(--cpx-sys-font-weight-body) var(--cpx-sys-font-size-lg) / var(--cpx-sys-line-height-body-lg) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-reading':
        'var(--cpx-sys-font-weight-body) var(--cpx-sys-font-size-md) / var(--cpx-sys-line-height-reading) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-row-title':
        'var(--cpx-sys-font-weight-medium) var(--cpx-sys-font-size-md) / var(--cpx-sys-line-height-body) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-control':
        'var(--cpx-sys-font-weight-medium) var(--cpx-sys-font-size-sm) / var(--cpx-sys-line-height-control) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-heading-sm':
        'var(--cpx-sys-font-weight-bold) var(--cpx-sys-font-size-lg) / var(--cpx-sys-line-height-heading-sm) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-heading-md':
        'var(--cpx-sys-font-weight-bold) var(--cpx-sys-font-size-xl) / var(--cpx-sys-line-height-heading-md) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-heading-lg':
        'var(--cpx-sys-font-weight-bold) var(--cpx-sys-font-size-2xl) / var(--cpx-sys-line-height-heading-lg) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-heading-xl':
        'var(--cpx-sys-font-weight-bold) var(--cpx-sys-font-size-3xl) / var(--cpx-sys-line-height-heading-xl) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-metric':
        'var(--cpx-sys-font-weight-bold) var(--cpx-sys-font-size-2xl) / var(--cpx-sys-line-height-heading-lg) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-code':
        'var(--cpx-sys-font-weight-regular) var(--cpx-sys-font-size-code) / var(--cpx-sys-line-height-code) var(--cpx-sys-font-family-mono)',
    }
    expect(Object.entries(roles).filter(([name, value]) => tokens.get(name) !== value)).toEqual([])

    for (const [size, lineHeight] of [
      [16, 22],
      [18, 24],
      [20, 28],
      [24, 30],
    ]) {
      expect(lineHeight).toBeGreaterThanOrEqual(size)
    }
  })

  test('DesktopThemeProvider applies one UI-size delta to the complete scale including 4xl', async () => {
    const provider = await read('../src/features/theme/DesktopThemeProvider.tsx')
    const scaleBlock = provider.match(/const scale = \{([\s\S]*?)\n  \}/)?.[1]
    expect(scaleBlock, 'DesktopThemeProvider must declare its UI font scale').toBeDefined()

    const scale = new Map<string, number>()
    for (const match of scaleBlock!.matchAll(/'?([\w]+)'?\s*:\s*(\d+)/g)) {
      scale.set(match[1], Number(match[2]))
    }
    expect(Object.fromEntries(scale)).toEqual({
      xs: 12,
      sm: 13,
      md: 14,
      lg: 16,
      xl: 18,
      '2xl': 20,
      '3xl': 24,
      '4xl': 28,
    })
    expect(provider).toContain('const delta = uiFontSize - 14')
    expect(provider).toContain('`${base + delta}px`')
    expect(provider).toContain("'--cpx-sys-font-size-4xl'")

    for (const uiFontSize of [11, 14, 16]) {
      const delta = uiFontSize - 14
      const derived = [...scale.values()].map((base) => base + delta)
      expect(derived).toEqual([12, 13, 14, 16, 18, 20, 24, 28].map((base) => base + delta))
    }
  })

  test('base, utilities, and Tailwind consume the shared typography roles', async () => {
    const [base, tailwind] = await Promise.all([
      read('../src/styles/base.css'),
      read('../src/styles/tailwind.css'),
    ])

    expect(base).toMatch(/body\s*\{[\s\S]*?font:\s*var\(--cpx-sys-type-body\);/)
    // 迁移后 `u-type-*` 工具类由 `tailwind.css` 的 `@utility type-*` 承担，
    // 每个角色继续消费同名的系统排版 shorthand。
    const roleTokens: Record<string, string> = {
      display: 'display',
      label: 'label',
      'body-sm': 'body-sm',
      'body-lg': 'body-lg',
      reading: 'reading',
      'row-title': 'row-title',
      control: 'control',
      metric: 'metric',
      code: 'code',
      'title-xl': 'heading-xl',
    }
    for (const [role, token] of Object.entries(roleTokens)) {
      expect(tailwind).toMatch(
        new RegExp(`@utility type-${role} \\{\\s*font: var\\(--cpx-sys-type-${token}\\);`),
      )
    }
    // 单独字重角色：`font-body` 映射为 `type-weight-body`。
    expect(tailwind).toMatch(
      /@utility type-weight-body \{\s*font-weight: var\(--cpx-sys-font-weight-body\);/,
    )

    const mappings = {
      xs: 'xs',
      sm: 'sm',
      base: 'md',
      lg: 'lg',
      xl: 'xl',
      '2xl': '2xl',
      '3xl': '3xl',
      '4xl': '4xl',
    }
    for (const [tailwindName, tokenName] of Object.entries(mappings)) {
      expect(tailwind).toContain(`--text-${tailwindName}: var(--cpx-sys-font-size-${tokenName});`)
    }
  })

  test('representative components keep page, section, row, reading, control, metric, and meta responsibilities distinct', async () => {
    const [settings, session, markdown, button, settingsSection, generalSettings, conversation] =
      await Promise.all([
        read('../src/styles/primitives/settings.css'),
        read('../src/features/session/QuickChatView.tsx'),
        read('../src/styles/markdown.css'),
        read('../src/components/ui/Button.tsx'),
        read('../src/features/settings/SettingsSection.tsx'),
        read('../src/features/settings/GeneralSettings.tsx'),
        read('../src/styles/primitives/conversation.css'),
      ])

    // 页面/区块标题的排版角色随迁移落到 TSX：语义类名旁挂 `type-*` utility。
    expect(generalSettings).toMatch(/className="settings-page-title [^"]*tw:type-title-xl/)
    expect(settingsSection).toMatch(/className="settings-section-title [^"]*tw:type-title-sm/)
    expect(settings).toMatch(
      /\.settings-management-row-title\s*\{[^}]*font:\s*var\(--cpx-sys-type-row-title\);/s,
    )
    expect(session).toContain('tw:type-display')
    expect(markdown).toMatch(/\.md-body\s*\{[^}]*font:\s*var\(--cpx-sys-type-reading\);/s)
    expect(markdown).toMatch(/h2\s*\{[^}]*font:\s*var\(--cpx-sys-type-heading-lg\);/s)
    expect(button).toContain('tw:type-control')
    // 用量指标卡仍在共享设置样式里，metric 角色 + tabular-nums 不变。
    expect(settings).toMatch(
      /\.usage-metric-card strong\s*\{[^}]*font:\s*var\(--cpx-sys-type-metric\);[^}]*font-variant-numeric:\s*tabular-nums;/s,
    )
    expect(conversation).toMatch(/font:\s*var\(--cpx-sys-type-caption\);/)
  })

  test('tokens.css defines the corrected 4px spacing scale 1..8 = 4/8/12/16/20/24/28/32px', async () => {
    const tokens = extractTokens(await read('../src/styles/design-system/tokens.css'))
    const expected: Record<string, string> = {
      '--cpx-sys-space-1': '4px',
      '--cpx-sys-space-2': '8px',
      '--cpx-sys-space-3': '12px',
      '--cpx-sys-space-4': '16px',
      '--cpx-sys-space-5': '20px',
      '--cpx-sys-space-6': '24px',
      '--cpx-sys-space-7': '28px',
      '--cpx-sys-space-8': '32px',
    }
    const mismatched = Object.entries(expected).filter(
      ([name, value]) => tokens.get(name) !== value,
    )
    const details = mismatched
      .map(([name, value]) => `${name}=${tokens.get(name) ?? '(missing)'} (expected ${value})`)
      .join(', ')

    expect(
      details,
      `tokens.css space scale must be 4/8/12/16/20/24/28/32px: ${details || 'ok'}`,
    ).toBe('')
  })

  test('tokens.css defines semantic radius roles', async () => {
    const tokens = extractTokens(await read('../src/styles/design-system/tokens.css'))
    const roles = ['indicator', 'compact', 'control', 'container', 'floating', 'pill'].map(
      (role) => `--cpx-sys-radius-${role}`,
    )

    const missing = missingFrom(tokens, roles)
    expect(
      missing,
      `tokens.css must define every radius role as a --cpx-sys-radius-* token; missing: ${missing.join(', ') || 'none'}`,
    ).toEqual([])
  })

  test('tokens.css defines semantic motion roles', async () => {
    const tokens = extractTokens(await read('../src/styles/design-system/tokens.css'))
    const roles = ['instant', 'feedback', 'exit', 'state', 'enter', 'panel', 'loading'].map(
      (role) => `--cpx-sys-motion-${role}`,
    )

    const missing = missingFrom(tokens, roles)
    expect(
      missing,
      `tokens.css must define every motion role as a --cpx-sys-motion-* token; missing: ${missing.join(', ') || 'none'}`,
    ).toEqual([])
  })

  test('tokens.css defines semantic z-index roles', async () => {
    const tokens = extractTokens(await read('../src/styles/design-system/tokens.css'))
    const roles = [
      'local',
      'sticky',
      'dock',
      'composer',
      'modal',
      'popover',
      'tooltip',
      'toast',
    ].map((role) => `--cpx-sys-z-${role}`)

    const missing = missingFrom(tokens, roles)
    expect(
      missing,
      `tokens.css must define every z-index role as a --cpx-sys-z-* token; missing: ${missing.join(', ') || 'none'}`,
    ).toEqual([])
  })

  test('tokens.css no longer defines root geometry tokens --control-/--layout-/--app-icon-/--menu-', async () => {
    const tokens = extractTokens(await read('../src/styles/design-system/tokens.css'))
    const banned = [...tokens.keys()].filter((name) =>
      /^--(?:control|layout|app-icon|menu)-/.test(name),
    )

    expect(
      banned,
      `tokens.css must not define root geometry tokens: ${banned.join(', ') || 'none'}`,
    ).toEqual([])
  })

  test('CheckStyleContracts.ts implements the featureTokenContract', async () => {
    const checker = await read('../scripts/CheckStyleContracts.ts')

    expect(checker).toContain('featureTokenContract')

    // Coverage: styles + scripts/TSX + inline style + Tailwind arbitrary +
    // component geometry + every literal non-color dimension.
    for (const marker of [
      'feature styles must not use literal',
      'feature TSX must not use literal',
      'inline style',
      'Tailwind arbitrary',
      'semantic typography role',
      'component geometry',
      'literal typography',
      'literal radius',
      'literal motion',
      'literal shadow',
      'literal z-index',
      'literal spacing',
    ]) {
      expect(
        checker.includes(marker),
        `CheckStyleContracts.ts must enforce the non-color token contract for "${marker}"`,
      ).toBe(true)
    }

    // Precise reason + stale detection (mirrors the feature color contract).
    expect(checker).toContain('feature token exception needs a concrete reason')
    expect(checker).toContain('stale feature token exception')
  })

  test('style-contracts.json ships a precise, stale-detectable featureTokenContract', async () => {
    const manifest = JSON.parse(await read('../style-contracts.json')) as {
      featureTokenContract: {
        roots: string[]
        componentGeometryExceptions: Array<{
          file: string
          value?: string
          localProperty?: string
          reason: string
        }>
        inlineStyleExceptions: Array<{
          file: string
          value?: string
          localProperty?: string
          reason: string
        }>
        tailwindArbitraryExceptions: Array<{
          file: string
          value?: string
          localProperty?: string
          reason: string
        }>
        tailwindTypographyExceptions: Array<{
          file: string
          value?: string
          localProperty?: string
          reason: string
        }>
        literalTypographyExceptions: Array<{
          file: string
          value?: string
          localProperty?: string
          reason: string
        }>
        literalRadiusExceptions: Array<{
          file: string
          value?: string
          localProperty?: string
          reason: string
        }>
        literalMotionExceptions: Array<{
          file: string
          value?: string
          localProperty?: string
          reason: string
        }>
        literalShadowExceptions: Array<{
          file: string
          value?: string
          localProperty?: string
          reason: string
        }>
        literalZIndexExceptions: Array<{
          file: string
          value?: string
          localProperty?: string
          reason: string
        }>
        literalSpacingExceptions: Array<{
          file: string
          value?: string
          localProperty?: string
          reason: string
        }>
      }
    }

    expect(
      manifest.featureTokenContract,
      'style-contracts.json must contain featureTokenContract',
    ).toBeDefined()
    expect(manifest.featureTokenContract.roots).toEqual(['src/styles/features', 'src/styles/lazy'])

    for (const [category, exceptions] of Object.entries({
      componentGeometryExceptions: manifest.featureTokenContract.componentGeometryExceptions,
      inlineStyleExceptions: manifest.featureTokenContract.inlineStyleExceptions,
      tailwindArbitraryExceptions: manifest.featureTokenContract.tailwindArbitraryExceptions,
      tailwindTypographyExceptions: manifest.featureTokenContract.tailwindTypographyExceptions,
      literalTypographyExceptions: manifest.featureTokenContract.literalTypographyExceptions,
      literalRadiusExceptions: manifest.featureTokenContract.literalRadiusExceptions,
      literalMotionExceptions: manifest.featureTokenContract.literalMotionExceptions,
      literalShadowExceptions: manifest.featureTokenContract.literalShadowExceptions,
      literalZIndexExceptions: manifest.featureTokenContract.literalZIndexExceptions,
      literalSpacingExceptions: manifest.featureTokenContract.literalSpacingExceptions,
    })) {
      expect(
        Array.isArray(exceptions),
        `featureTokenContract.${category} must be an exception array`,
      ).toBe(true)
      for (const exception of exceptions) {
        expect(
          exception.file.length > 0 && !exception.file.includes('*'),
          `${category} exception must name one concrete file without wildcards: ${exception.file}`,
        ).toBe(true)
        expect(
          exception.reason.length > 15,
          `${category} exception needs a concrete reason (>15 chars): ${exception.file} -> ${exception.value ?? exception.localProperty ?? ''}`,
        ).toBe(true)
        expect(
          (exception.value ?? exception.localProperty ?? '').length > 0,
          `${category} exception must pin the exact value or local property: ${exception.file}`,
        ).toBe(true)
      }
    }
  })

  test('base.css reduced-motion zeroes every system motion token', async () => {
    const base = await read('../src/styles/base.css')
    const reduceMotion = blockContent(base, /\[data-reduce-motion=['"]on['"]\]\s*\{/)

    expect(
      reduceMotion,
      'base.css must contain a :root[data-reduce-motion="on"] block that resets motion tokens',
    ).toBeDefined()

    const motionTokens = [
      '--cpx-sys-motion-instant',
      '--cpx-sys-motion-feedback',
      '--cpx-sys-motion-exit',
      '--cpx-sys-motion-state',
      '--cpx-sys-motion-enter',
      '--cpx-sys-motion-panel',
      '--cpx-sys-motion-loading',
    ]
    const declarations = new Map<string, string>()
    for (const match of reduceMotion!.matchAll(/(--cpx-sys-motion-[\w-]+)[ \t]*:[ \t]*([^;]+);/g)) {
      declarations.set(match[1], match[2].trim())
    }

    const missing = motionTokens.filter((name) => !declarations.has(name))
    expect(
      missing,
      `reduced-motion must zero every system motion token; missing: ${missing.join(', ') || 'none'}`,
    ).toEqual([])

    for (const name of motionTokens) {
      const value = declarations.get(name)
      expect(
        value !== undefined && /^0(?:ms)?$/.test(value),
        `${name} must be zeroed under reduced-motion (got: ${value ?? '(missing)'})`,
      ).toBe(true)
    }

    // base.css must never reintroduce non-zero motion tokens (e.g. 1ms).
    const nonZero = [...declarations.entries()].filter(([, value]) => !/^0(?:ms)?$/.test(value))
    expect(
      nonZero,
      `base.css must not set non-zero motion tokens; offending: ${nonZero.map(([name, value]) => `${name}: ${value}`).join(', ') || 'none'}`,
    ).toEqual([])
  })

  test('tokens.css pins the shared page widths and the conversation width', async () => {
    const tokens = extractTokens(await read('../src/styles/design-system/tokens.css'))
    expect(tokens.get('--cpx-sys-layout-content-max-width')).toBe('1009px')
    expect(tokens.get('--cpx-sys-layout-wide-max-width')).toBe('1250px')
    // 会话正文上限是摘要三段判定的基准，必须与 threadSummaryState 的 736 一致。
    expect(tokens.get('--cpx-sys-layout-conversation-max-width')).toBe('736px')
    expect(tokens.has('--cpx-sys-layout-reading-max-width')).toBe(false)
  })

  test('页面宽度不再有手动档位：布局只读会话/一级页面两个固定上限', async () => {
    const desktopLayout = await read('../src/features/layout/shell/DesktopLayout.tsx')
    const conversationPage = await read('../src/features/session/conversation/ConversationPage.tsx')
    const workbench = await read('../src/styles/features/layout-workbench.css')
    const canonical = await read('../src/styles/primitives/conversation.css')

    expect(desktopLayout).not.toContain('data-page-width')
    expect(conversationPage).not.toContain('data-conversation-width')
    expect(workbench).not.toContain('data-page-width')
    expect(canonical).not.toContain('data-conversation-width')
    expect(workbench).toMatch(
      /\.desktop-main-route\s*\{\s*--page-content-max-width:\s*var\(--cpx-sys-layout-content-max-width\);/,
    )
    expect(canonical).toContain(
      '--page-content-max-width: var(--cpx-sys-layout-conversation-max-width);',
    )
  })

  test('canonical conversation lets the final agent response fill the page width', async () => {
    const conversation = await read('../src/styles/primitives/conversation.css')
    const markdown = await read('../src/styles/markdown.css')
    expect(conversation).toMatch(
      /\.canonical-turn\s*\{[\s\S]*?max-width:\s*var\(--page-content-max-width\)/,
    )
    expect(conversation).toMatch(/\.canonical-turn\s*\{[\s\S]*?container-type:\s*inline-size/)
    expect(conversation).not.toMatch(/--thread-reading-width/)
    expect(conversation).toMatch(
      /\.canonical-text-item--result\s*\{\s*width:\s*100%;\s*background:\s*transparent;\s*box-shadow:\s*none;\s*\}/,
    )
    expect(markdown).toMatch(
      /\.conversation-page \.md-wide-block\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%/,
    )
    expect(markdown).toMatch(
      /:is\(ul, ol\)[\s\S]*?\.md-wide-block\s*\{[\s\S]*?width:\s*100cqi;[\s\S]*?max-width:\s*100cqi;[\s\S]*?margin-inline-start:\s*calc\(100% - 100cqi\)/,
    )
  })

  test('reduced-motion consumers reuse the theme provider instead of installing observers', async () => {
    const hook = await read('../src/hooks/UsePrefersReducedMotion.ts')
    const provider = await read('../src/features/theme/DesktopThemeProvider.tsx')
    const context = await read('../src/features/theme/ThemeContext.ts')

    // hooks 不能放在 try/catch 里，改为直接读 context 并在无 Provider 时回退。
    expectSourceContains(hook, 'useContext(DesktopThemeContext)')
    expectSourceContains(hook, 'theme.reducedMotion')
    expect(hook).not.toContain('new MutationObserver')
    expect(hook).not.toContain("addEventListener('change'")
    expect(provider).toContain("draftSettings.reduceMotion === 'system'")
    expect(provider).toContain("draftSettings.reduceMotion === 'on'")
    expect(provider).toContain('reducedMotion,')
    expect(context).toContain('reducedMotion: boolean')
  })

  test('canonical conversation narrative content inherits one reading rhythm', async () => {
    const conversation = await read('../src/styles/primitives/conversation.css')
    const markdown = await read('../src/styles/markdown.css')
    expect(conversation).toMatch(
      /\.canonical-turn\s*\{[\s\S]*?font:\s*var\(--cpx-sys-type-reading\);/,
    )
    for (const selector of [
      '\\.canonical-turn__thinking,\\s*\\.canonical-turn__status',
      '\\.cpx-agent-activity',
      '\\.canonical-turn-activity',
      '\\.canonical-process-card',
      '\\.cpx-agent-activity__item',
      '\\.cpx-agent-activity__details',
      '\\.cpx-agent-activity__file-changes',
      '\\.canonical-lifecycle-tool',
      '\\.canonical-subagent-card',
    ]) {
      expect(conversation).toMatch(new RegExp(`${selector}\\s*\\{[\\s\\S]*?font:\\s*inherit;`))
    }
    const itemRenderer = await read('../src/features/session/timeline/CanonicalItemRenderer.tsx')
    expectSourceContains(
      itemRenderer,
      'canonical-text-item tw:min-w-0 tw:text-app-text tw:type-reading',
    )
    expect(markdown).toMatch(/\.md-body\s*\{[\s\S]*?font:\s*var\(--cpx-sys-type-reading\);/)
    expect(conversation).toMatch(
      /\.canonical-turn__process\s*\{\s*gap:\s*var\(--cpx-sys-space-4\);/,
    )
    expect(markdown).toMatch(
      /\.md-table-block table\s*\{[\s\S]*?font:\s*var\(--cpx-sys-type-body\);/,
    )
    expect(conversation).toMatch(/font:\s*var\(--cpx-sys-type-caption\);/)
    expect(conversation).toMatch(/font:\s*var\(--cpx-sys-type-code\);/)
    expect(markdown).toMatch(/line-height:\s*var\(--cpx-sys-line-height-code\);/)
  })

  test('Markdown code fallbacks use the shared code line-height token without a local floor', async () => {
    const markdown = await read('../src/styles/markdown.css')
    expect(markdown).not.toMatch(/line-height:\s*max\(20px,\s*var\(--cpx-sys-line-height-code\)\)/)
    expect(markdown).toMatch(
      /\.md-code-placeholder,[\s\S]*?\.md-math-fallback\s*\{[\s\S]*?line-height:\s*var\(--cpx-sys-line-height-code\)/,
    )
  })

  test('settings page content defaults to content max width', async () => {
    const settingsPage = await read('../src/features/settings/GeneralSettings.tsx')
    // 设置页内容宽度改由 TSX utility 承担：内容上限 + 两侧 space-5 内边距
    // （原 `_settings-core.scss` 的 max-width 公式）。
    expectSourceContains(
      settingsPage,
      'tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]',
    )
  })

  test('review diff preserves shared code rhythm with a 24px floor for line actions', async () => {
    const review = await read('../src/styles/primitives/review.css')
    expect(review).toContain('--review-diffs-line-height: max(24px, calc(1em * var(--cpx-sys-line-height-code)))')
    expect(review).toMatch(/line-height:\s*var\(--cpx-sys-line-height-code\)/)
  })

  test('conversation composer overhangs the reading column without shrinking the timeline twice', async () => {
    const conversation = await read('../src/styles/primitives/conversation.css')
    const threadComposerDock = await read(
      '../src/features/session/conversation/ThreadComposerDock.tsx',
    )
    const composerSurface = await read('../src/features/session/composer/ComposerSurface.tsx')
    const timeline = await read('../src/features/session/timeline/SessionTimelineView.tsx')
    const page = await read('../src/features/session/conversation/ConversationPage.tsx')

    expect(conversation).not.toContain('--conversation-shift-offset')
    expect(conversation).toMatch(
      /\.conversation-page \.workflow-page__composer-inner\s*\{[\s\S]*?width:\s*min\([\s\S]*?calc\(var\(--page-content-max-width\) \+ 2 \* var\(--conversation-composer-overhang\)\),[\s\S]*?calc\(100% - 2 \* var\(--conversation-inline-gutter\)\)[\s\S]*?margin-inline:\s*auto;/,
    )
    expect(conversation).toContain('container: conversation-panel / inline-size;')
    expect(conversation).toContain('@container conversation-panel (width < 53.5rem)')
    expect(conversation).toContain('--page-content-max-width: 40rem;')
    expect(conversation).toContain('--cpx-sys-layout-conversation-max-width: 48rem;')
    expect(conversation).toContain('--conversation-inline-gutter: var(--cpx-sys-space-4);')
    expect(conversation).toContain('--conversation-composer-overhang: var(--cpx-sys-space-6);')
    expect(conversation).toContain(
      '100% - 2 * (var(--conversation-inline-gutter) + var(--conversation-composer-overhang))',
    )
    expect(conversation).toContain('--session-timeline-width: 100%;')
    expect(timeline).toContain('tw:w-[var(--session-timeline-width,var(--session-content-w,100%))]')
    expect(conversation).not.toContain('--conversation-content-inline-start')
    expect(conversation).not.toContain('@media (max-width: 760px)')
    expect(conversation).toContain(
      'padding-inline: calc(var(--conversation-composer-overhang) - var(--cpx-sys-space-3) - 1px);',
    )
    expect(conversation).toMatch(
      /\.conversation-page \.workflow-main-scroll-footer \.chat-input__dropdown--suggestion\s*\{\s*width: 100%;\s*max-width: 100%;/,
    )
    expect(page).toContain(
      'subagent-timeline-summary tw:mx-auto tw:my-2 tw:flex tw:w-[min(var(--page-content-max-width),var(--session-content-w))]',
    )
    expect(conversation).toMatch(/\.right-dock-side-chat\s*\{\s*--session-content-w: 100%;/)
    expect(conversation).toMatch(
      /\.canonical-turn\s*\{[\s\S]*?width:\s*min\(var\(--page-content-max-width\),\s*var\(--session-content-w\)\);[\s\S]*?max-width:\s*var\(--page-content-max-width\);[\s\S]*?margin-inline:\s*auto;/,
    )
    expect(conversation).toMatch(
      /\.right-dock-side-chat \.canonical-model-switch-divider,[\s\S]*?\.right-dock-side-chat \.workflow-page__composer-inner\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%;[\s\S]*?margin-inline:\s*0;/,
    )
    expect(threadComposerDock).not.toMatch(/tw:w-\[min\(/)
    expect(threadComposerDock).not.toMatch(/tw:max-w-\[var\(/)
    expect(composerSurface).toContain("className?.includes('workflow-page__composer-inner')")
  })
})
