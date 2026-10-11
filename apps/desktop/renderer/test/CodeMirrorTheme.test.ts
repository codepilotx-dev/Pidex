import { describe, expect, test } from 'bun:test'

import { loadCodeMirrorTheme } from '../src/features/editor/CodeMirrorTheme.js'

describe('CodeMirror theme loading', () => {
  test('loads and caches the selected full editor theme', async () => {
    const options = {
      codeThemeId: 'dracula',
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 12,
      variant: 'dark',
    } as const
    const first = loadCodeMirrorTheme(options)
    const second = loadCodeMirrorTheme(options)

    expect(second).toBe(first)
    expect(Array.isArray(await first)).toBeTrue()
  })

  test('keeps light and dark theme extensions isolated', async () => {
    const light = loadCodeMirrorTheme({
      codeThemeId: 'proof-light',
      fontFamily: 'ui-monospace, monospace',
      fontSize: 12,
      variant: 'light',
    })
    const dark = loadCodeMirrorTheme({
      codeThemeId: 'codex-dark',
      fontFamily: 'ui-monospace, monospace',
      fontSize: 12,
      variant: 'dark',
    })

    expect(light).not.toBe(dark)
    expect(Array.isArray(await light)).toBeTrue()
    expect(Array.isArray(await dark)).toBeTrue()
  })
})
