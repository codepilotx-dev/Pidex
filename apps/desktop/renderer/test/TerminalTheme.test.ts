import { describe, expect, test } from 'bun:test'
import {
  parseTerminalFontSize,
  readTerminalFont,
  readTerminalTheme,
} from '../src/features/terminal/TerminalTheme.js'

describe('terminal theme', () => {
  test('parses the code font size with a 13px default and 8-24px bounds', () => {
    expect(parseTerminalFontSize('')).toBe(13)
    expect(parseTerminalFontSize('not-a-size')).toBe(13)
    expect(parseTerminalFontSize('7px')).toBe(8)
    expect(parseTerminalFontSize('13.5px')).toBe(13.5)
    expect(parseTerminalFontSize('30px')).toBe(24)
  })

  test('reads the appearance code font variables without a terminal-specific fallback', () => {
    const originalGetComputedStyle = globalThis.getComputedStyle
    Object.defineProperty(globalThis, 'getComputedStyle', {
      configurable: true,
      value: () => ({
        getPropertyValue: (name: string) =>
          name === '--cpx-sys-font-family-mono'
            ? 'JetBrains Mono'
            : name === '--cpx-sys-font-size-code'
              ? '15px'
              : '',
      }),
    })

    try {
      expect(readTerminalFont({} as Element)).toEqual({
        fontFamily: 'JetBrains Mono',
        fontSize: 15,
        lineHeight: 1.5,
      })
    } finally {
      if (originalGetComputedStyle) {
        Object.defineProperty(globalThis, 'getComputedStyle', {
          configurable: true,
          value: originalGetComputedStyle,
        })
      } else {
        Reflect.deleteProperty(globalThis, 'getComputedStyle')
      }
    }
  })

  test('reads terminal colors and handles raw strings when canvas is unavailable', () => {
    const originalGetComputedStyle = globalThis.getComputedStyle
    Object.defineProperty(globalThis, 'getComputedStyle', {
      configurable: true,
      value: () => ({
        getPropertyValue: (name: string) => {
          if (name === '--cpx-comp-terminal-bg') return '#111111'
          if (name === '--cpx-comp-terminal-fg') return '#eeeeee'
          if (name === '--cpx-sys-color-selected') return 'rgba(255, 255, 255, 0.1)'
          if (name === '--cpx-comp-terminal-ansi-red') return '#e02e2a'
          return ''
        },
      }),
    })

    try {
      const theme = readTerminalTheme({} as Element)
      expect(theme.background).toBe('#111111')
      expect(theme.foreground).toBe('#eeeeee')
      expect(theme.cursor).toBe('#eeeeee')
      expect(theme.selectionBackground).toBe('rgba(255, 255, 255, 0.1)')
      expect(theme.red).toBe('#e02e2a')
      expect(theme.green).toBe('')
    } finally {
      if (originalGetComputedStyle) {
        Object.defineProperty(globalThis, 'getComputedStyle', {
          configurable: true,
          value: originalGetComputedStyle,
        })
      } else {
        Reflect.deleteProperty(globalThis, 'getComputedStyle')
      }
    }
  })

  test('converts CSS colors to sRGB RGBA using canvas rasterization', () => {
    const originalGetComputedStyle = globalThis.getComputedStyle
    const originalDocument = globalThis.document

    let currentFillStyle = '#000000'
    const mockCtx = {
      clearRect: () => {},
      fillRect: () => {},
      get fillStyle() {
        return currentFillStyle
      },
      set fillStyle(val: string) {
        currentFillStyle = val
      },
      getImageData: () => ({
        data: new Uint8ClampedArray([1, 105, 204, 255]),
      }),
    }

    const mockCanvas = {
      width: 1,
      height: 1,
      getContext: () => mockCtx,
    }

    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement: (tag: string) => (tag === 'canvas' ? mockCanvas : null),
      },
    })

    Object.defineProperty(globalThis, 'getComputedStyle', {
      configurable: true,
      value: () => ({
        getPropertyValue: (name: string) => {
          if (name === '--cpx-comp-terminal-bg') return 'color(display-p3 0 0.2784 0.7255)'
          return ''
        },
      }),
    })

    try {
      const theme = readTerminalTheme({} as Element)
      expect(theme.background).toBe('rgba(1, 105, 204, 1)')
    } finally {
      if (originalGetComputedStyle) {
        Object.defineProperty(globalThis, 'getComputedStyle', {
          configurable: true,
          value: originalGetComputedStyle,
        })
      } else {
        Reflect.deleteProperty(globalThis, 'getComputedStyle')
      }

      if (originalDocument) {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: originalDocument,
        })
      } else {
        Reflect.deleteProperty(globalThis, 'document')
      }
    }
  })
})
