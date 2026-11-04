import type { CSSProperties, ReactNode } from 'react'
import React, { useContext, useEffect, useRef, useState } from 'react'
import { Check, Copy, Pencil, WrapText } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'

import { APP_ICON_SIZES, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import { cx } from '../../utils/Cx.js'
import { desktopClipboard } from '../../services/desktop-client/index.js'
import { DesktopThemeContext } from '../theme/ThemeContext.js'
import type { DesktopThemeVariant } from '../../../shared/Types.js'
import { formatSyntaxLanguageLabel, normalizeSyntaxLanguage } from './Language.js'
import type { SyntaxHighlightResult, SyntaxToken } from './Types.js'
import { resolveThemeId } from './Theme.js'
import { useHighlightedCode } from './UseHighlightedCode.js'
import { useCodeWrapPreference } from './WrapPreference.js'

const COPY_FEEDBACK_DURATION_MS = 2_000

export type CodeBlockProps = {
  showWrapControl?: boolean
  collapsible?: boolean
  surface?: 'standalone' | 'embedded'
  ariaLabel?: string
  headerLabel?: string | null
  copyLabel?: string
  wrapContent?: (content: ReactNode) => ReactNode
  className?: string
  code: string
  language?: string | null
  streaming?: boolean
  onChangeCode?: (code: string) => void
  onChangeLanguage?: (language: string) => void
}

export function CodeBlock({
  showWrapControl = false,
  collapsible = false,
  surface = 'standalone',
  ariaLabel,
  headerLabel,
  copyLabel = '复制代码',
  wrapContent,
  className,
  code,
  language,
  streaming = false,
  onChangeCode,
  onChangeLanguage,
}: CodeBlockProps): ReactNode {
  const [wrapPreference, setWrapPreference] = useCodeWrapPreference()
  const wrapped = showWrapControl && wrapPreference
  const themeContext = useContext(DesktopThemeContext)
  const variant: DesktopThemeVariant =
    themeContext?.activeTheme.variant ??
    (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light'
      ? 'light'
      : 'dark')
  const codeThemeId =
    themeContext?.codeThemeId ??
    (typeof document !== 'undefined'
      ? (document.documentElement.dataset.codeThemeId ?? 'codex-dark')
      : 'codex-dark')
  const resolvedTheme = resolveThemeId(codeThemeId, variant)
  const presentation = useHighlightedCode({
    code,
    language,
    streaming,
    theme: resolvedTheme,
  })
  const [copied, setCopied] = useState(false)
  const [isEditingLang, setIsEditingLang] = useState(false)
  const [editLangValue, setEditLangValue] = useState(language ?? '')
  const [isEditingCode, setIsEditingCode] = useState(false)
  const [editCodeValue, setEditCodeValue] = useState(code)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const copyFeedbackTimerRef = useRef<number | null>(null)
  const highlightedLanguage =
    presentation.highlighted?.language ?? normalizeSyntaxLanguage(language)
  const languageLabel = formatSyntaxLanguageLabel(highlightedLanguage)

  useEffect(() => {
    setEditCodeValue(code)
  }, [code])

  useEffect(() => {
    if (isEditingCode && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isEditingCode])

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }
    }
  }, [])

  function commitLanguageChange(): void {
    setIsEditingLang(false)
    const trimmed = editLangValue.trim()
    if (trimmed !== (language ?? '').trim()) {
      onChangeLanguage?.(trimmed)
    }
  }

  async function handleCopy(): Promise<void> {
    try {
      await copyCodeText(code)
      setCopied(true)
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }
      copyFeedbackTimerRef.current = window.setTimeout(() => {
        copyFeedbackTimerRef.current = null
        setCopied(false)
      }, COPY_FEEDBACK_DURATION_MS)
    } catch {
      setCopied(false)
    }
  }

  const codeStyle: CSSProperties = {}
  if (presentation.highlighted?.foreground) {
    codeStyle.color = presentation.highlighted.foreground
  }

  const codeContent = (
    <code className="md-code-content" style={codeStyle}>
      <HighlightedTokens result={presentation.highlighted} />
      {presentation.plainText}
    </code>
  )

  const content = (
    <pre
      tabIndex={wrapContent ? undefined : 0}
      className={cx(
        'md-code-pre',
        'tw:m-0',
        'tw:max-w-full',
        'tw:font-mono',
        !wrapContent && 'tw:overflow-x-auto',
        wrapped ? 'tw:whitespace-pre-wrap' : 'tw:whitespace-pre',
        onChangeCode && !isEditingCode && 'tw:cursor-text',
      )}
    >
      {isEditingCode ? (
        <textarea
          ref={textareaRef}
          aria-label="编辑代码内容"
          className="md-code-editor-textarea tw:m-0 tw:w-full tw:resize-y tw:border-0 tw:bg-transparent tw:p-0 tw:font-mono tw:text-inherit tw:text-app-text tw:whitespace-pre tw:overflow-x-auto"
          style={{
            ...codeStyle,
            minHeight: `${Math.max(2, editCodeValue.split('\n').length) * 1.5}em`,
            fontFamily: 'inherit',
            fontSize: 'inherit',
            lineHeight: 'inherit',
          }}
          value={editCodeValue}
          onBlur={() => {
            setIsEditingCode(false)
            if (editCodeValue !== code) {
              onChangeCode?.(editCodeValue)
            }
          }}
          onChange={(e) => {
            setEditCodeValue(e.target.value)
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') {
              e.preventDefault()
              setIsEditingCode(false)
              setEditCodeValue(code)
            } else if (e.key === 'Tab') {
              e.preventDefault()
              const target = e.currentTarget
              const start = target.selectionStart
              const end = target.selectionEnd
              const val = target.value
              const nextVal = `${val.substring(0, start)}  ${val.substring(end)}`
              setEditCodeValue(nextVal)
              queueMicrotask(() => {
                target.selectionStart = target.selectionEnd = start + 2
              })
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        codeContent
      )}
    </pre>
  )

  return (
    <figure
      data-wrapped={wrapped}
      data-surface={surface}
      aria-label={ariaLabel ?? `${languageLabel} 代码块`}
      className={cx(
        'md-code-block',
        surface === 'standalone' && 'md-code-surface',
        'tw:mx-0',
        'tw:w-full',
        'tw:max-w-full',
        'tw:overflow-hidden',
        className,
      )}
    >
      {headerLabel !== null ? (
        <figcaption className="md-code-header tw:flex tw:h-8 tw:items-center tw:justify-between tw:type-caption tw:text-app-text-soft">
          {isEditingLang ? (
            <input
              autoFocus
              aria-label="输入代码语言"
              className="md-code-lang-input tw:h-6 tw:w-28 tw:border tw:border-app-accent tw:bg-app-raised tw:px-1.5 tw:font-mono tw:text-app-text tw:outline-none"
              placeholder="语言 (如 ts, json)"
              value={editLangValue}
              onBlur={commitLanguageChange}
              onChange={(e) => setEditLangValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitLanguageChange()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setIsEditingLang(false)
                  setEditLangValue(language ?? '')
                }
              }}
              onPointerDown={(e) => e.stopPropagation()}
            />
          ) : onChangeLanguage ? (
            <button
              aria-label={`修改代码语言：当前为 ${languageLabel}`}
              className="md-code-lang md-code-lang--interactive tw:inline-flex tw:h-6 tw:items-center tw:px-1 tw:font-mono tw:text-app-text-soft tw:transition-colors tw:duration-[var(--cpx-sys-motion-exit)] tw:hover:bg-app-raised tw:hover:text-app-text tw:focus-visible:ring-1 tw:focus-visible:ring-app-accent"
              title="点击直接修改代码语言"
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setEditLangValue(language ?? '')
                setIsEditingLang(true)
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span>{languageLabel}</span>
            </button>
          ) : (
            <span className="md-code-lang tw:font-mono">{headerLabel ?? languageLabel}</span>
          )}
        </figcaption>
      ) : null}
      <span className="md-code-actions tw:flex tw:items-center">
        {showWrapControl ? (
          <button
            className="md-code-wrap tw:inline-flex tw:size-6 tw:items-center tw:justify-center tw:rounded-control tw:border-0 tw:text-app-text-soft tw:cursor-pointer tw:focus-visible:ring-1 tw:focus-visible:ring-app-accent"
            type="button"
            aria-label="代码自动换行"
            title="代码自动换行"
            aria-pressed={wrapped}
            onClick={() => setWrapPreference(!wrapPreference)}
          >
            <WrapText
              aria-hidden="true"
              size={APP_ICON_SIZES.sm}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
          </button>
        ) : null}
        {onChangeCode && !isEditingCode ? (
          <Button
            isIconOnly
            color="ghostSecondary"
            size="xs"
            title="编辑代码"
            type="button"
            onClick={() => {
              setEditCodeValue(code)
              setIsEditingCode(true)
            }}
          >
            <Pencil
              aria-hidden="true"
              size={APP_ICON_SIZES.sm}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
          </Button>
        ) : null}
        <Button
          isIconOnly
          className="md-code-copy tw:transition-colors tw:duration-exit"
          variant="ghost"
          size="xs"
          aria-label={copied ? '已复制代码' : copyLabel}
          title={copied ? '已复制代码' : copyLabel}
          type="button"
          onClick={() => void handleCopy()}
        >
          {copied ? (
            <Check
              aria-hidden="true"
              size={APP_ICON_SIZES.sm}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
          ) : (
            <Copy aria-hidden="true" size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
          )}
        </Button>
      </span>
      {collapsible ? (
        <details className="md-code-disclosure">
          <summary className="md-code-summary">{codeContent}</summary>
        </details>
      ) : wrapContent ? (
        wrapContent(content)
      ) : (
        content
      )}
    </figure>
  )
}

function HighlightedTokens({ result }: { result: SyntaxHighlightResult | null }): ReactNode {
  if (!result) return null

  return result.tokens.map((line, lineIndex) => (
    <React.Fragment key={lineIndex}>
      {line.map((token, tokenIndex) => (
        <span key={`${lineIndex}:${tokenIndex}`} style={syntaxTokenStyle(token)}>
          {token.content}
        </span>
      ))}
      {lineIndex < result.tokens.length - 1 ? '\n' : null}
    </React.Fragment>
  ))
}

export function syntaxTokenStyle(token: SyntaxToken): CSSProperties {
  const style: CSSProperties = {}
  if (token.color) style.color = token.color
  if (token.backgroundColor) style.backgroundColor = token.backgroundColor
  if (token.fontStyle !== undefined && token.fontStyle > 0) {
    if ((token.fontStyle & 1) !== 0) style.fontStyle = 'italic'
    if ((token.fontStyle & 2) !== 0) style.fontWeight = 700
    if ((token.fontStyle & 4) !== 0) style.textDecoration = 'underline'
  }
  return style
}

export async function copyCodeText(code: string): Promise<void> {
  await desktopClipboard.writeText(code)
}
