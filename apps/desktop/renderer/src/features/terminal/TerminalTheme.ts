import type { ITheme } from '@xterm/xterm'

export type TerminalFont = {
  fontFamily: string
  fontSize: number
  lineHeight: number
}

const DEFAULT_TERMINAL_FONT_SIZE = 13
const MIN_TERMINAL_FONT_SIZE = 8
const MAX_TERMINAL_FONT_SIZE = 24

let colorCanvasCtx: CanvasRenderingContext2D | null = null

function normalizeColor(rawColor: string): string {
  const trimmed = rawColor.trim()
  if (!trimmed) return trimmed
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return trimmed
  }
  try {
    if (!colorCanvasCtx) {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      colorCanvasCtx = canvas.getContext('2d', { willReadFrequently: true })
    }
    if (!colorCanvasCtx) return trimmed
    colorCanvasCtx.clearRect(0, 0, 1, 1)
    // Sentinel check: if assigning trimmed fails, canvas ignores the assignment.
    colorCanvasCtx.fillStyle = '#010203'
    colorCanvasCtx.fillStyle = trimmed
    if (colorCanvasCtx.fillStyle === '#010203' && trimmed !== '#010203') {
      return trimmed
    }
    colorCanvasCtx.fillRect(0, 0, 1, 1)
    if (typeof colorCanvasCtx.getImageData === 'function') {
      const pixel = colorCanvasCtx.getImageData(0, 0, 1, 1).data
      const alpha = Number((pixel[3] / 255).toFixed(3))
      return `rgba(${pixel[0]}, ${pixel[1]}, ${pixel[2]}, ${alpha})`
    }
    return colorCanvasCtx.fillStyle
  } catch {
    return trimmed
  }
}

function cssColor(styles: CSSStyleDeclaration, name: string): string {
  return normalizeColor(styles.getPropertyValue(name))
}

export function readTerminalTheme(element: Element): ITheme {
  const styles = getComputedStyle(element)
  return {
    background: cssColor(styles, '--cpx-comp-terminal-bg'),
    foreground: cssColor(styles, '--cpx-comp-terminal-fg'),
    cursor: cssColor(styles, '--cpx-comp-terminal-fg'),
    selectionBackground: cssColor(styles, '--cpx-sys-color-selected'),
    black: cssColor(styles, '--cpx-comp-terminal-ansi-black'),
    red: cssColor(styles, '--cpx-comp-terminal-ansi-red'),
    green: cssColor(styles, '--cpx-comp-terminal-ansi-green'),
    yellow: cssColor(styles, '--cpx-comp-terminal-ansi-yellow'),
    blue: cssColor(styles, '--cpx-comp-terminal-ansi-blue'),
    magenta: cssColor(styles, '--cpx-comp-terminal-ansi-magenta'),
    cyan: cssColor(styles, '--cpx-comp-terminal-ansi-cyan'),
    white: cssColor(styles, '--cpx-comp-terminal-ansi-white'),
    brightBlack: cssColor(styles, '--cpx-comp-terminal-ansi-bright-black'),
    brightRed: cssColor(styles, '--cpx-comp-terminal-ansi-bright-red'),
    brightGreen: cssColor(styles, '--cpx-comp-terminal-ansi-bright-green'),
    brightYellow: cssColor(styles, '--cpx-comp-terminal-ansi-bright-yellow'),
    brightBlue: cssColor(styles, '--cpx-comp-terminal-ansi-bright-blue'),
    brightMagenta: cssColor(styles, '--cpx-comp-terminal-ansi-bright-magenta'),
    brightCyan: cssColor(styles, '--cpx-comp-terminal-ansi-bright-cyan'),
    brightWhite: cssColor(styles, '--cpx-comp-terminal-ansi-bright-white'),
  }
}

export function readTerminalFont(element: Element): TerminalFont {
  const styles = getComputedStyle(element)
  const fontSize = parseTerminalFontSize(styles.getPropertyValue('--cpx-sys-font-size-code').trim())
  const rawLineHeight = styles.getPropertyValue('--cpx-sys-line-height-code').trim()
  const parsedLineHeight = Number.parseFloat(rawLineHeight)
  const lineHeight =
    Number.isFinite(parsedLineHeight) && parsedLineHeight > 0 ? parsedLineHeight : 1.5
  return {
    fontFamily: styles.getPropertyValue('--cpx-sys-font-family-mono').trim(),
    fontSize,
    lineHeight,
  }
}

export function parseTerminalFontSize(value: string): number {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return DEFAULT_TERMINAL_FONT_SIZE
  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, parsed))
}
