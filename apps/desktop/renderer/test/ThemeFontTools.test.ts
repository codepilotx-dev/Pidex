import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_DARK_THEME,
  DEFAULT_DESKTOP_THEME_SETTINGS,
  normalizeDesktopThemeSettings,
} from '../shared/Theme.js'
import { mergeChromeThemeSeed } from '../src/features/theme/CodeThemeSeed.js'
import {
  escapeCssString,
  extractWeightFromFace,
  fontFamilyWithFace,
  generateThemeFontFaceCss,
  themeFontFaceAlias,
} from '../src/features/theme/ThemeFontFaces.js'
import {
  isMonospaceFamily,
  type FontMeasureContext,
} from '../src/features/theme/ThemeSystemFonts.js'
import {
  DEFAULT_FACE_VALUE,
  SYSTEM_DEFAULT_FAMILY_VALUE,
  buildFamilyOptions,
  buildStyleOptions,
  extractStyleNameFromFace,
  faceStyleLabel,
  fontPatchForSelection,
  styleLabel,
} from '../src/features/settings/ThemeFontPickerModel.js'
import { deriveThemeVariables } from '../src/features/theme/ThemeVariables.js'
import type { DesktopSystemFontFace } from '../shared/Types.js'

const SANS_FACES: readonly DesktopSystemFontFace[] = [
  {
    family: 'Inter',
    fullName: 'Inter Regular',
    postscriptName: 'Inter-Regular',
    style: 'Regular',
  },
  {
    family: 'Inter',
    fullName: 'Inter Bold',
    postscriptName: 'Inter-Bold',
    style: 'Bold',
  },
  {
    family: 'Inter',
    fullName: 'Inter Italic',
    postscriptName: 'Inter-Italic',
    style: 'Italic',
  },
  {
    family: 'PrettySans',
    fullName: 'PrettySans Regular',
    postscriptName: 'PrettySans-Regular',
    style: 'Regular',
  },
]

const MONO_FACES: readonly DesktopSystemFontFace[] = [
  {
    family: 'CodeMono',
    fullName: 'CodeMono Regular',
    postscriptName: 'CodeMono-Regular',
    style: 'Regular',
  },
  {
    family: 'CodeMono',
    fullName: 'CodeMono Bold',
    postscriptName: 'CodeMono-Bold',
    style: 'Bold',
  },
]

const ALL_FACES = [...SANS_FACES, ...MONO_FACES]

function monoContext(family: string): FontMeasureContext | null {
  return {
    font: family,
    measureText: (text) => ({ width: text.length * 8 }),
  }
}

function proportionalContext(family: string): FontMeasureContext | null {
  return {
    font: family,
    measureText: (text) => ({
      width: text.startsWith('m') ? text.length * 12 : text.length * 6,
    }),
  }
}

describe('theme font loading tool', () => {
  test('escapes CSS string special characters in alias sources', () => {
    expect(escapeCssString('plain')).toBe('plain')
    expect(escapeCssString('a"b\\c')).toBe('a\\"b\\\\c')
  })

  test('extracts weight axes accurately across named styles', () => {
    expect(
      extractWeightFromFace({ family: 'F', fullName: 'F Thin', postscriptName: 'F-Thin' }),
    ).toBe(100)
    expect(
      extractWeightFromFace({ family: 'F', fullName: 'F Light', postscriptName: 'F-Light' }),
    ).toBe(300)
    expect(
      extractWeightFromFace({ family: 'F', fullName: 'F Regular', postscriptName: 'F-Regular' }),
    ).toBe(400)
    expect(
      extractWeightFromFace({ family: 'F', fullName: 'F Medium', postscriptName: 'F-Medium' }),
    ).toBe(500)
    expect(
      extractWeightFromFace({ family: 'F', fullName: 'F SemiBold', postscriptName: 'F-SemiBold' }),
    ).toBe(600)
    expect(
      extractWeightFromFace({ family: 'F', fullName: 'F Bold', postscriptName: 'F-Bold' }),
    ).toBe(700)
    expect(
      extractWeightFromFace({ family: 'F', fullName: 'F Heavy', postscriptName: 'F-Heavy' }),
    ).toBe(900)
  })

  test('generates dynamic @font-face CSS with local sources and variation settings', () => {
    const face = {
      family: 'MiSans VF',
      fullName: 'MiSans VF Heavy',
      postscriptName: 'MiSans-VF-Heavy',
    }
    const css = generateThemeFontFaceCss('Pidex-Selected-Sans', face)
    expect(css).toContain('font-family: "Pidex-Selected-Sans"')
    expect(css).toContain('local("MiSans VF Heavy")')
    expect(css).toContain('local("MiSans-VF-Heavy")')
    expect(css).toContain('local("MiSans VF")')
    expect(css).toContain("font-variation-settings: 'wght' 900")
  })

  test('places the alias and face names before the fallback stack and falls back without a face', () => {
    const face = {
      family: 'JetBrains Mono',
      fullName: 'JetBrains Mono Regular',
      postscriptName: 'JetBrainsMono-Regular',
    }
    expect(fontFamilyWithFace(face, 'Inter, sans-serif', 'code')).toBe(
      '"Pidex-Selected-Mono", "JetBrains Mono Regular", "JetBrains Mono", Inter, sans-serif',
    )
    expect(fontFamilyWithFace(null, 'Inter, sans-serif')).toBe('Inter, sans-serif')
    expect(fontFamilyWithFace(undefined, 'Inter, sans-serif')).toBe('Inter, sans-serif')
  })

  test('deriveThemeVariables composes dynamic face aliases into font variables', () => {
    const variables = deriveThemeVariables({
      ...DEFAULT_DARK_THEME,
      theme: {
        ...DEFAULT_DARK_THEME.theme,
        fonts: {
          ui: 'Inter',
          uiFace: {
            family: 'Inter',
            fullName: 'Inter Bold',
            postscriptName: 'Inter-Bold',
          },
          code: 'CodeMono',
          codeFace: {
            family: 'CodeMono',
            fullName: 'CodeMono Regular',
            postscriptName: 'CodeMono-Regular',
          },
        },
      },
    })

    expect(variables['--cpx-sys-font-family-sans']).toBe(
      '"Pidex-Selected-Sans", "Inter Bold", "Inter", Inter',
    )
    expect(variables['--cpx-sys-font-family-mono']).toBe(
      '"Pidex-Selected-Mono", "CodeMono Regular", "CodeMono", CodeMono',
    )
  })

  test('mergeChromeThemeSeed clears stale faces when a family changes', () => {
    const current = {
      ...DEFAULT_DARK_THEME.theme,
      fonts: {
        ui: 'JetBrains Mono',
        uiFace: {
          family: 'JetBrains Mono',
          fullName: 'JetBrains Mono Bold',
          postscriptName: 'JetBrainsMono-Bold',
        },
        code: null,
        codeFace: null,
      },
    }
    const merged = mergeChromeThemeSeed(current, {
      surface: current.surface,
      ink: current.ink,
      accent: current.accent,
      fonts: { ui: 'Inter', code: null },
    })

    expect(merged.fonts.ui).toBe('Inter')
    expect(merged.fonts.uiFace).toBeNull()
    expect(merged.fonts.codeFace).toBeNull()
  })

  test('mergeChromeThemeSeed keeps faces when the family is unchanged', () => {
    const uiFace = {
      family: 'Inter',
      fullName: 'Inter Bold',
      postscriptName: 'Inter-Bold',
    }
    const current = {
      ...DEFAULT_DARK_THEME.theme,
      fonts: {
        ui: 'Inter',
        uiFace,
        code: null,
        codeFace: null,
      },
    }
    const merged = mergeChromeThemeSeed(current, {
      surface: current.surface,
      ink: current.ink,
      accent: current.accent,
      fonts: { ui: 'Inter', code: 'CodeMono' },
    })

    expect(merged.fonts.uiFace).toEqual(uiFace)
    expect(merged.fonts.codeFace).toBeNull()
  })
})

describe('system font enumeration helpers', () => {
  test('detects monospace families through canvas glyph widths', () => {
    expect(isMonospaceFamily('CodeMono', monoContext)).toBe(true)
    expect(isMonospaceFamily('PrettySans', proportionalContext)).toBe(false)
  })

  test('treats missing measurement contexts as unverifiable and shows all', () => {
    expect(isMonospaceFamily('Anything', () => null)).toBe(true)
  })
})

describe('theme font picker model', () => {
  test('style labels map the common face styles', () => {
    expect(styleLabel('Regular')).toBe('Regular')
    expect(styleLabel('normal')).toBe('Regular')
    expect(styleLabel('Bold')).toBe('Bold')
    expect(styleLabel('Italic')).toBe('Italic')
    expect(styleLabel('Bold Italic')).toBe('Bold Italic')
    expect(styleLabel('Medium')).toBe('Medium')
    expect(styleLabel('Semi Bold')).toBe('SemiBold')
    expect(styleLabel('Demibold')).toBe('Demibold')
    expect(styleLabel('ExtraLight')).toBe('ExtraLight')
    expect(styleLabel('Heavy')).toBe('Heavy')
    expect(styleLabel('Condensed')).toBe('Condensed')
  })

  test('family options start with system default and keep the current family', () => {
    const options = buildFamilyOptions({
      faces: ALL_FACES,
      kind: 'ui',
      currentFamily: null,
      isMonospace: (family) => family === 'CodeMono',
    })
    expect(options[0]).toEqual({
      value: SYSTEM_DEFAULT_FAMILY_VALUE,
      label: '系统默认',
    })
    expect(options.map((option) => option.label)).toEqual([
      '系统默认',
      'CodeMono',
      'Inter',
      'PrettySans',
    ])

    const custom = buildFamilyOptions({
      faces: ALL_FACES,
      kind: 'ui',
      currentFamily: 'Custom List, sans-serif',
      isMonospace: (family) => family === 'CodeMono',
    })
    expect(custom.map((option) => option.label)).toEqual([
      '系统默认',
      'CodeMono',
      'Inter',
      'PrettySans',
      'Custom List, sans-serif',
    ])
  })

  test('code font families are filtered to monospace ones but keep custom values', () => {
    const options = buildFamilyOptions({
      faces: ALL_FACES,
      kind: 'code',
      currentFamily: 'PrettySans',
      isMonospace: (family) => family === 'CodeMono',
    })
    expect(options.map((option) => option.label)).toEqual(['系统默认', 'CodeMono', 'PrettySans'])
  })

  test('style options use the regular face as the default option', () => {
    const options = buildStyleOptions({
      faces: SANS_FACES.filter((face) => face.family === 'Inter'),
      currentFace: null,
    })
    expect(options).toEqual([
      {
        value: 'Inter-Regular',
        label: 'Regular',
      },
      { value: 'Inter-Italic', label: 'Italic' },
      { value: 'Inter-Bold', label: 'Bold' },
    ])
  })

  test('style options fall back to the default marker without a regular face', () => {
    const options = buildStyleOptions({
      faces: [
        {
          family: 'OddFace',
          fullName: 'OddFace Bold',
          postscriptName: 'OddFace-Bold',
          style: 'Bold',
        },
      ],
      currentFace: null,
    })
    expect(options[0]).toEqual({ value: DEFAULT_FACE_VALUE, label: 'Regular' })
  })

  test('extracts style name and localized label from face metadata', () => {
    expect(
      extractStyleNameFromFace({
        family: 'JetBrains Mono',
        fullName: 'JetBrains Mono Medium',
        postscriptName: 'JetBrainsMono-Medium',
      }),
    ).toBe('Medium')
    expect(
      faceStyleLabel({
        family: 'JetBrains Mono',
        fullName: 'JetBrains Mono Medium',
        postscriptName: 'JetBrainsMono-Medium',
      }),
    ).toBe('Medium')

    expect(
      extractStyleNameFromFace({
        family: 'JetBrains Mono',
        fullName: 'JetBrains Mono SemiBold',
        postscriptName: 'JetBrainsMono-SemiBold',
      }),
    ).toBe('SemiBold')
    expect(
      faceStyleLabel({
        family: 'JetBrains Mono',
        fullName: 'JetBrains Mono SemiBold',
        postscriptName: 'JetBrainsMono-SemiBold',
      }),
    ).toBe('SemiBold')

    expect(
      extractStyleNameFromFace({
        family: 'MiSans VF',
        fullName: 'MiSans VF',
        postscriptName: 'MiSans-VF-Heavy',
      }),
    ).toBe('Heavy')
    expect(
      faceStyleLabel({
        family: 'MiSans VF',
        fullName: 'MiSans VF',
        postscriptName: 'MiSans-VF-Heavy',
      }),
    ).toBe('Heavy')

    expect(
      faceStyleLabel({
        family: 'Inter',
        fullName: 'Inter Bold Italic',
        postscriptName: 'Inter-BoldItalic',
      }),
    ).toBe('Bold Italic')
  })

  test('style options preserve a stored face missing from the enumeration and use localized style label', () => {
    const options = buildStyleOptions({
      faces: MONO_FACES,
      currentFace: {
        family: 'CodeMono',
        fullName: 'CodeMono Missing',
        postscriptName: 'CodeMono-Missing',
      },
    })
    expect(options.map((option) => option.value)).toEqual([
      'CodeMono-Regular',
      'CodeMono-Bold',
      'CodeMono-Missing',
    ])
    expect(options.find((opt) => opt.value === 'CodeMono-Missing')).toEqual({
      value: 'CodeMono-Missing',
      label: 'Missing',
    })
  })

  test('style options resolve localized variant name before system fonts are loaded', () => {
    const mediumOptions = buildStyleOptions({
      faces: [],
      currentFace: {
        family: 'JetBrains Mono',
        fullName: 'JetBrains Mono Medium',
        postscriptName: 'JetBrainsMono-Medium',
      },
    })
    expect(mediumOptions).toEqual([
      { value: DEFAULT_FACE_VALUE, label: 'Regular' },
      {
        value: 'JetBrainsMono-Medium',
        label: 'Medium',
      },
    ])

    const semiBoldOptions = buildStyleOptions({
      faces: [],
      currentFace: {
        family: 'JetBrains Mono',
        fullName: 'JetBrains Mono SemiBold',
        postscriptName: 'JetBrainsMono-SemiBold',
      },
    })
    expect(semiBoldOptions).toEqual([
      { value: DEFAULT_FACE_VALUE, label: 'Regular' },
      {
        value: 'JetBrainsMono-SemiBold',
        label: 'SemiBold',
      },
    ])
  })

  test('variable fonts with identical fullName resolve unique styles and full names', () => {
    const vfFaces: readonly DesktopSystemFontFace[] = [
      {
        family: 'MiSans VF',
        fullName: 'MiSans VF',
        postscriptName: 'MiSans-VF-Regular',
        style: 'Regular',
      },
      {
        family: 'MiSans VF',
        fullName: 'MiSans VF',
        postscriptName: 'MiSans-VF-Bold',
        style: 'Bold',
      },
      {
        family: 'MiSans VF',
        fullName: 'MiSans VF',
        postscriptName: 'MiSans-VF-Heavy',
        style: 'Heavy',
      },
    ]

    const options = buildStyleOptions({ faces: vfFaces, currentFace: null })
    expect(options.map((option) => option.value)).toEqual([
      'MiSans-VF-Regular',
      'MiSans-VF-Bold',
      'MiSans-VF-Heavy',
    ])
    expect(options.map((option) => option.label)).toEqual(['Regular', 'Bold', 'Heavy'])

    const heavyCommit = fontPatchForSelection({
      familyValue: 'MiSans VF',
      faceValue: 'MiSans-VF-Heavy',
      familyFaces: vfFaces,
      currentFace: null,
    })
    expect(heavyCommit).toEqual({
      family: 'MiSans VF',
      face: {
        family: 'MiSans VF',
        fullName: 'MiSans VF Heavy',
        postscriptName: 'MiSans-VF-Heavy',
      },
    })
    expect(fontFamilyWithFace(heavyCommit.face, 'MiSans VF')).toBe(
      '"Pidex-Selected-Sans", "MiSans VF Heavy", "MiSans VF", MiSans VF',
    )
  })

  test('variable font styles are sorted by weight and displayed in canonical English names', () => {
    const miSansFaces: readonly DesktopSystemFontFace[] = [
      {
        family: 'MiSans VF',
        fullName: 'MiSans VF Demibold',
        postscriptName: 'MiSans-VF-Demibold',
        style: 'Demibold',
      },
      {
        family: 'MiSans VF',
        fullName: 'MiSans VF ExtraLight',
        postscriptName: 'MiSans-VF-ExtraLight',
        style: 'ExtraLight',
      },
      {
        family: 'MiSans VF',
        fullName: 'MiSans VF Heavy',
        postscriptName: 'MiSans-VF-Heavy',
        style: 'Heavy',
      },
      {
        family: 'MiSans VF',
        fullName: 'MiSans VF Light',
        postscriptName: 'MiSans-VF-Light',
        style: 'Light',
      },
      {
        family: 'MiSans VF',
        fullName: 'MiSans VF Medium',
        postscriptName: 'MiSans-VF-Medium',
        style: 'Medium',
      },
      {
        family: 'MiSans VF',
        fullName: 'MiSans VF Regular',
        postscriptName: 'MiSans-VF-Regular',
        style: 'Regular',
      },
    ]

    const options = buildStyleOptions({ faces: miSansFaces, currentFace: null })
    expect(options).toEqual([
      { value: 'MiSans-VF-ExtraLight', label: 'ExtraLight' },
      { value: 'MiSans-VF-Light', label: 'Light' },
      { value: 'MiSans-VF-Regular', label: 'Regular' },
      { value: 'MiSans-VF-Medium', label: 'Medium' },
      { value: 'MiSans-VF-Demibold', label: 'Demibold' },
      { value: 'MiSans-VF-Heavy', label: 'Heavy' },
    ])
  })

  test('system default commits family null and face null', () => {
    expect(
      fontPatchForSelection({
        familyValue: SYSTEM_DEFAULT_FAMILY_VALUE,
        faceValue: DEFAULT_FACE_VALUE,
        familyFaces: MONO_FACES,
        currentFace: null,
      }),
    ).toEqual({ family: null, face: null })
  })

  test('the default face commits family-only and non-default faces save the face', () => {
    const regular = fontPatchForSelection({
      familyValue: 'CodeMono',
      faceValue: DEFAULT_FACE_VALUE,
      familyFaces: MONO_FACES,
      currentFace: null,
    })
    expect(regular).toEqual({ family: 'CodeMono', face: null })

    const boldByFullName = fontPatchForSelection({
      familyValue: 'CodeMono',
      faceValue: 'CodeMono Bold',
      familyFaces: MONO_FACES,
      currentFace: null,
    })
    expect(boldByFullName).toEqual({
      family: 'CodeMono',
      face: {
        family: 'CodeMono',
        fullName: 'CodeMono Bold',
        postscriptName: 'CodeMono-Bold',
      },
    })

    const boldByPostscriptName = fontPatchForSelection({
      familyValue: 'CodeMono',
      faceValue: 'CodeMono-Bold',
      familyFaces: MONO_FACES,
      currentFace: null,
    })
    expect(boldByPostscriptName).toEqual({
      family: 'CodeMono',
      face: {
        family: 'CodeMono',
        fullName: 'CodeMono Bold',
        postscriptName: 'CodeMono-Bold',
      },
    })

    const regularFaceOption = fontPatchForSelection({
      familyValue: 'CodeMono',
      faceValue: 'CodeMono Regular',
      familyFaces: MONO_FACES,
      currentFace: null,
    })
    expect(regularFaceOption).toEqual({ family: 'CodeMono', face: null })

    const regularFaceOptionLegacy = fontPatchForSelection({
      familyValue: 'CodeMono',
      faceValue: 'CodeMono-Regular',
      familyFaces: MONO_FACES,
      currentFace: null,
    })
    expect(regularFaceOptionLegacy).toEqual({ family: 'CodeMono', face: null })
  })

  test('an unenumerated stored face is preserved on commit', () => {
    const currentFace = {
      family: 'CodeMono',
      fullName: 'CodeMono Missing',
      postscriptName: 'CodeMono-Missing',
    }
    expect(
      fontPatchForSelection({
        familyValue: 'CodeMono',
        faceValue: 'CodeMono-Missing',
        familyFaces: MONO_FACES,
        currentFace,
      }),
    ).toEqual({ family: 'CodeMono', face: currentFace })
  })
})

describe('renderer V6 → V7 normalization', () => {
  test('preserves every V6 value and adds null faces', () => {
    const migrated = normalizeDesktopThemeSettings({
      version: 6,
      mode: 'dark',
      codeThemeIds: { light: 'github-light-default', dark: 'dracula' },
      chromeThemes: {
        light: {
          accent: '#abcdef',
          surface: '#fefefe',
          ink: '#111111',
          contrast: 42,
          fonts: { ui: 'Inter', code: 'JetBrains Mono' },
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
          fonts: { ui: null, code: null },
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
    })

    expect(migrated).toMatchObject({
      version: 7,
      mode: 'dark',
      codeThemeIds: { light: 'github-light-default', dark: 'dracula' },
      pointerCursorEnabled: true,
      reduceMotion: 'off',
      fontSmoothingEnabled: false,
      fontSizes: { ui: 15, code: 13 },
    })
    expect(migrated.chromeThemes.light).toMatchObject({
      accent: '#abcdef',
      surface: '#fefefe',
      ink: '#111111',
      contrast: 42,
    })
    expect(migrated.chromeThemes.light.fonts).toEqual({
      ui: 'Inter',
      uiFace: null,
      code: 'JetBrains Mono',
      codeFace: null,
    })
  })

  test('keeps valid faces and drops invalid or oversized ones', () => {
    const normalized = normalizeDesktopThemeSettings({
      ...DEFAULT_DESKTOP_THEME_SETTINGS,
      chromeThemes: {
        light: {
          ...DEFAULT_DESKTOP_THEME_SETTINGS.chromeThemes.light,
          fonts: {
            ui: 'Inter',
            uiFace: {
              family: 'Inter',
              fullName: 'Inter Bold',
              postscriptName: 'Inter-Bold',
            },
            codeFace: {
              family: 'X'.repeat(201),
              fullName: 'Y',
              postscriptName: 'Z',
            },
          },
        },
        dark: DEFAULT_DESKTOP_THEME_SETTINGS.chromeThemes.dark,
      },
    })

    expect(normalized.chromeThemes.light.fonts.uiFace).toEqual({
      family: 'Inter',
      fullName: 'Inter Bold',
      postscriptName: 'Inter-Bold',
    })
    expect(normalized.chromeThemes.light.fonts.codeFace).toBeNull()
    expect(normalized.chromeThemes.dark.fonts).toEqual({
      ui: null,
      uiFace: null,
      code: null,
      codeFace: null,
    })
  })

  test('drops a face when it does not match the selected family', () => {
    const normalized = normalizeDesktopThemeSettings({
      ...DEFAULT_DESKTOP_THEME_SETTINGS,
      chromeThemes: {
        ...DEFAULT_DESKTOP_THEME_SETTINGS.chromeThemes,
        dark: {
          ...DEFAULT_DESKTOP_THEME_SETTINGS.chromeThemes.dark,
          fonts: {
            ui: 'Inter',
            uiFace: {
              family: 'JetBrains Mono',
              fullName: 'JetBrains Mono Bold',
              postscriptName: 'JetBrainsMono-Bold',
            },
          },
        },
      },
    })

    expect(normalized.chromeThemes.dark.fonts.ui).toBe('Inter')
    expect(normalized.chromeThemes.dark.fonts.uiFace).toBeNull()
  })
})
