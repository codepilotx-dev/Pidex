import React, { memo, useMemo, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { Token, Tokens } from 'marked'
import {
  AlertCircle,
  AlertOctagon,
  AlertTriangle,
  Check,
  Code2,
  Copy,
  Download,
  FileText,
  FolderOpen,
  Info,
  Lightbulb,
  Maximize2,
  X,
} from 'lucide-react'
import type { DesktopExternalOpenTarget } from '../../../shared/Types.js'
import { AppContextMenu, type AppContextMenuAction } from '../../components/ui/AppContextMenu.js'
import { Button } from '../../components/ui/Button.js'
import { useDialogFocusRestore } from '../../components/ui/UseDialogFocusRestore.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import { OpenTargetIcon } from '../../components/ui/OpenTargetIcon.js'
import { desktopClient, desktopClipboard } from '../../services/desktop-client/index.js'
import {
  loadExternalOpenTargets,
  openPathWithExternalTarget,
  openPathWithPreferredExternalTarget,
  prefetchExternalOpenTargets,
} from '../../services/ExternalOpenTargetsStore.js'
import { cx } from '../../utils/Cx.js'
import { FileTypeIcon } from '../layout/FileTypeIcon.js'
import { CodeBlock } from '../syntax/index.js'
import { DEFAULT_MARKDOWN_DIRECTIVES, normalizeDirectiveName } from './Directives.js'
import { MathRenderer } from './MathRenderer.js'
import { MermaidRenderer } from './MermaidRenderer.js'
import { LazyRender } from './LazyRender.js'
import { buildMarkdownBlocks } from './Parser.js'
import { renderSafeHtml } from './SafeHtml.js'
import {
  classifyMarkdownTarget,
  isLikelyFileReference,
  isSafeHttpsMediaSource,
  mediaKindForUrl,
  parseMarkdownFileReference,
} from './SafeTargets.js'
import type {
  MarkdownDirectiveRegistry,
  MarkdownExternalResourcePolicy,
  MarkdownFileOpenOptions,
  MarkdownFileReference,
  MarkdownDirectiveToken,
  MarkdownMathToken,
  MarkdownStreamingCodeToken,
  MarkdownStreamingTextToken,
  MarkdownToken,
  MarkdownRenderBlock,
} from './Types.js'

export const MARKDOWN_THREAD_NAVIGATION_EVENT = 'pidex:markdown-thread-navigation'

export function handleMarkdownThreadLinkClick(
  event: { preventDefault: () => void },
  threadId: string,
): void {
  event.preventDefault()
  window.dispatchEvent(
    new CustomEvent<{ threadId: string }>(MARKDOWN_THREAD_NAVIGATION_EVENT, {
      detail: { threadId },
    }),
  )
}

export type MarkdownMessageProps = {
  presentation?: 'default' | 'conversation'
  allowBasicHtml?: boolean
  allowWideBlocks?: boolean
  cwd?: string | null
  directives?: MarkdownDirectiveRegistry
  directiveRegistry?: MarkdownDirectiveRegistry
  externalResourcePolicy?: MarkdownExternalResourcePolicy
  onOpenFileReference?: (reference: MarkdownFileReference, options: MarkdownFileOpenOptions) => void
  canCopyFileReferenceContents?: (reference: MarkdownFileReference) => boolean
  onCopyFileReferenceContents?: (reference: MarkdownFileReference) => void | Promise<void>
  streaming?: boolean
  streamingChunks?: readonly string[]
  text: string
}

type RenderContext = {
  presentation: 'default' | 'conversation'
  allowBasicHtml: boolean
  allowWideBlocks: boolean
  cwd: string | null
  directives: MarkdownDirectiveRegistry
  externalResourcePolicy: {
    allowExternalLinks: boolean
    allowExternalUrl: (url: string) => boolean
    allowRemoteMedia: boolean
  }
  onOpenFileReference:
    ((reference: MarkdownFileReference, options: MarkdownFileOpenOptions) => void) | undefined
  canCopyFileReferenceContents: ((reference: MarkdownFileReference) => boolean) | undefined
  onCopyFileReferenceContents:
    ((reference: MarkdownFileReference) => void | Promise<void>) | undefined
  streaming: boolean
  streamingFragment: string
}

export function MarkdownMessage({
  presentation = 'default',
  allowBasicHtml = false,
  allowWideBlocks = true,
  cwd = null,
  directives,
  directiveRegistry,
  externalResourcePolicy,
  canCopyFileReferenceContents,
  onCopyFileReferenceContents,
  onOpenFileReference,
  streaming = false,
  streamingChunks,
  text,
}: MarkdownMessageProps): React.ReactNode {
  const sourceText = streamingChunks?.join('') ?? text
  const priorRef = useRef<{ blocks: MarkdownRenderBlock[]; text: string }>({
    blocks: [],
    text: '',
  })
  const blocks = useMemo(() => {
    const next = buildMarkdownBlocks(
      sourceText,
      streaming,
      priorRef.current.blocks,
      priorRef.current.text,
    )
    priorRef.current = { blocks: next, text: sourceText }
    return next
  }, [sourceText, streaming])
  const context = useMemo<RenderContext>(
    () => ({
      presentation,
      allowBasicHtml,
      allowWideBlocks,
      cwd,
      directives: directives ?? directiveRegistry ?? DEFAULT_MARKDOWN_DIRECTIVES,
      externalResourcePolicy: {
        allowExternalLinks: externalResourcePolicy?.allowExternalLinks ?? true,
        allowExternalUrl: externalResourcePolicy?.allowExternalUrl ?? (() => true),
        allowRemoteMedia: externalResourcePolicy?.allowRemoteMedia ?? true,
      },
      canCopyFileReferenceContents,
      onCopyFileReferenceContents,
      onOpenFileReference,
      streaming,
      streamingFragment: '',
    }),
    [
      presentation,
      allowWideBlocks,
      allowBasicHtml,
      cwd,
      directiveRegistry,
      directives,
      externalResourcePolicy?.allowExternalLinks,
      externalResourcePolicy?.allowExternalUrl,
      externalResourcePolicy?.allowRemoteMedia,
      canCopyFileReferenceContents,
      onCopyFileReferenceContents,
      onOpenFileReference,
      streaming,
    ],
  )
  if (blocks.length === 0) return null
  return (
    <div
      className={cx(
        'md-body',
        presentation === 'conversation' && 'md-body--conversation',
        streaming && 'is-streaming',
      )}
    >
      {blocks.map((block) => (
        <MemoizedMarkdownBlock block={block} context={context} key={block.id} />
      ))}
    </div>
  )
}

const MemoizedMarkdownBlock = memo(function MemoizedMarkdownBlock({
  block,
  context,
}: {
  block: MarkdownRenderBlock
  context: RenderContext
}): React.ReactNode {
  const previousVisibleTextRef = useRef('')
  const previous = previousVisibleTextRef.current
  const prefixLength = commonPrefixLength(previous, block.visibleText)
  const fragment =
    block.state === 'pending' && context.streaming ? block.visibleText.slice(prefixLength) : ''
  previousVisibleTextRef.current = block.visibleText
  const blockContext = fragment ? { ...context, streamingFragment: fragment } : context
  return renderTokens(block.tokens, blockContext, block.id)
})

function commonPrefixLength(left: string, right: string): number {
  let index = 0
  const limit = Math.min(left.length, right.length)
  while (index < limit && left[index] === right[index]) index += 1
  return index
}

function renderTokens(
  tokens: MarkdownToken[],
  context: RenderContext,
  keyPrefix: string,
): React.ReactNode[] {
  const rendered: React.ReactNode[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const inlineHtml = findInlineHtmlGroup(tokens, index)
    const key = `${keyPrefix}-${stableTokenKey(tokens[index], index)}`
    if (inlineHtml) {
      const node = (
        <React.Fragment key={key}>
          {context.allowBasicHtml
            ? renderSafeHtml(inlineHtml.html, key, {
                openExternal: (url) => openExternal(context, url),
                openFile: (path) => openFile(context, path),
              })
            : inlineHtml.html}
        </React.Fragment>
      )
      rendered.push(node)
      index = inlineHtml.end
      continue
    }
    rendered.push(renderToken(tokens[index], context, key))
  }
  return rendered
}

type MarkdownAlertType = 'note' | 'tip' | 'important' | 'warning' | 'caution'

const ALERT_CONFIG: Record<
  MarkdownAlertType,
  {
    title: string
    icon: React.ComponentType<{
      className?: string
      size?: number
      strokeWidth?: number
      'aria-hidden'?: boolean | 'true' | 'false'
    }>
  }
> = {
  note: { title: 'Note', icon: Info },
  tip: { title: 'Tip', icon: Lightbulb },
  important: { title: 'Important', icon: AlertCircle },
  warning: { title: 'Warning', icon: AlertTriangle },
  caution: { title: 'Caution', icon: AlertOctagon },
}

function parseAlertBlockquote(tokens: Token[] | undefined): {
  alertType: MarkdownAlertType
  title: string
  contentTokens: Token[]
} | null {
  if (!tokens || tokens.length === 0) return null
  const first = tokens[0]
  if (!first || (first.type !== 'paragraph' && first.type !== 'text')) {
    return null
  }

  const rawText = first.raw ?? (first as { text?: string }).text ?? ''
  const alertMatch = rawText.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s*\n|\s*$)/i)
  if (!alertMatch) {
    const inlineMatch = rawText.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/im)
    if (!inlineMatch) return null
  }

  const typeStr = (
    alertMatch?.[1] ?? rawText.match(/\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i)?.[1]
  )?.toLowerCase() as MarkdownAlertType

  if (!typeStr || !ALERT_CONFIG[typeStr]) return null

  const remainingTokens = [...tokens]
  const p = { ...(first as Tokens.Paragraph) }
  const strippedRaw = p.raw.replace(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/i, '')

  if (!strippedRaw.trim()) {
    remainingTokens.shift()
  } else {
    p.raw = strippedRaw
    p.text = (p.text ?? '').replace(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/i, '')
    if (p.tokens && p.tokens.length > 0) {
      const childTokens = [...p.tokens]
      const firstChild = { ...childTokens[0] }
      if ('raw' in firstChild) {
        firstChild.raw = (firstChild.raw ?? '').replace(
          /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/i,
          '',
        )
      }
      if ('text' in firstChild) {
        ;(firstChild as { text: string }).text = (
          (firstChild as { text: string }).text ?? ''
        ).replace(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/i, '')
      }
      if (!firstChild.raw?.trim() && !(firstChild as { text?: string }).text?.trim()) {
        childTokens.shift()
      } else {
        childTokens[0] = firstChild
      }
      p.tokens = childTokens
    }
    remainingTokens[0] = p
  }

  return {
    alertType: typeStr,
    title: ALERT_CONFIG[typeStr].title,
    contentTokens: remainingTokens,
  }
}

function renderToken(token: MarkdownToken, context: RenderContext, key: string): React.ReactNode {
  if (token.type === 'math') {
    const math = token as MarkdownMathToken
    return <MathRenderer display={math.display} expression={math.text} key={key} />
  }
  if (token.type === 'directive') {
    return renderDirective(token as MarkdownDirectiveToken, context, key)
  }
  if (token.type === 'streaming_code') {
    const code = token as MarkdownStreamingCodeToken
    return renderCode(code.text, code.lang, true, context, key)
  }
  if (token.type === 'streaming_text') {
    const pending = token as MarkdownStreamingTextToken
    return (
      <React.Fragment key={key}>
        {pending.text.split(/\r?\n/u).map((line, index, lines) => (
          <React.Fragment key={index}>
            {line}
            {index < lines.length - 1 ? <br /> : null}
          </React.Fragment>
        ))}
      </React.Fragment>
    )
  }

  switch (token.type) {
    case 'space':
    case 'def':
      return null
    case 'hr':
      return <hr key={key} />
    case 'br':
      return <br key={key} />
    case 'code':
      return renderCode(token.text, token.lang, false, context, key)
    case 'blockquote': {
      const alert = parseAlertBlockquote(token.tokens)
      if (alert) {
        const IconComponent = ALERT_CONFIG[alert.alertType].icon
        return (
          <div className={cx('md-alert', `md-alert--${alert.alertType}`)} key={key}>
            <div className="md-alert__header">
              <IconComponent
                aria-hidden="true"
                className="md-alert__icon"
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
              <span className="md-alert__title">{alert.title}</span>
            </div>
            <div className="md-alert__content">
              {renderTokens(alert.contentTokens, context, `${key}-alert-body`)}
            </div>
          </div>
        )
      }
      return (
        <blockquote key={key}>{renderTokens(token.tokens, context, `${key}-quote`)}</blockquote>
      )
    }
    case 'heading': {
      const level = Math.max(1, Math.min(6, token.depth))
      return React.createElement(
        `h${level}`,
        { key },
        renderTokens(token.tokens, context, `${key}-heading`),
      )
    }
    case 'paragraph': {
      const media = renderMediaGrid(token.tokens, context, key)
      if (media) return media
      const leadDescription = splitLeadDescriptionTokens(token.tokens)
      if (leadDescription) {
        return (
          <p className="md-lead-description" key={key}>
            <span className="md-lead-description__title">
              {renderTokens(leadDescription.title, context, `${key}-paragraph-title`)}
            </span>
            <span className="md-lead-description__detail">
              {renderTokens(leadDescription.detail, context, `${key}-paragraph-detail`)}
            </span>
          </p>
        )
      }
      return <p key={key}>{renderTokens(token.tokens, context, `${key}-paragraph`)}</p>
    }
    case 'list': {
      const Tag = token.ordered ? 'ol' : 'ul'
      const start = token.ordered && typeof token.start === 'number' ? token.start : undefined
      return (
        <Tag key={key} start={start}>
          {token.items.map((item, index) => renderListItem(item, context, `${key}-item-${index}`))}
        </Tag>
      )
    }
    case 'table':
      return renderTable(token as Tokens.Table, context, key)
    case 'strong':
      return <strong key={key}>{renderTokens(token.tokens, context, `${key}-strong`)}</strong>
    case 'em':
      return <em key={key}>{renderTokens(token.tokens, context, `${key}-em`)}</em>
    case 'del':
      return <del key={key}>{renderTokens(token.tokens, context, `${key}-del`)}</del>
    case 'codespan':
      return renderCodeSpan(token.text, context, key)
    case 'link':
      return renderLink(token as Tokens.Link, context, key)
    case 'image':
      return renderImage(token as Tokens.Image, context, key)
    case 'html':
      return (
        <React.Fragment key={key}>
          {context.allowBasicHtml
            ? renderSafeHtml(token.text, key, {
                openExternal: (url) => openExternal(context, url),
                openFile: (path) => openFile(context, path),
              })
            : token.text}
        </React.Fragment>
      )
    case 'text':
    case 'escape':
      if ('tokens' in token && Array.isArray(token.tokens)) {
        return (
          <React.Fragment key={key}>
            {renderTokens(token.tokens, context, `${key}-text`)}
          </React.Fragment>
        )
      }
      return (
        <React.Fragment key={key}>{renderStreamingText(token.text, context, key)}</React.Fragment>
      )
    case 'checkbox':
      return (
        <input
          aria-label={token.checked ? '已完成' : '未完成'}
          checked={token.checked}
          key={key}
          readOnly
          type="checkbox"
        />
      )
    default:
      return renderGenericToken(token, context, key)
  }
}

function renderStreamingText(text: string, context: RenderContext, key: string): React.ReactNode {
  const fragment = context.streamingFragment
  if (!fragment || !text.endsWith(fragment)) {
    return renderTextWithFileReferences(text, context, key)
  }
  const stable = text.slice(0, -fragment.length)
  return (
    <>
      {renderTextWithFileReferences(stable, context, `${key}-stable`)}
      <span className="md-streaming-fragment">
        {renderTextWithFileReferences(fragment, context, `${key}-fragment`)}
      </span>
    </>
  )
}

function splitLeadDescriptionTokens(tokens: Token[]): { title: Token[]; detail: Token[] } | null {
  const firstVisibleToken = tokens.find(hasVisibleInlineContent)
  if (firstVisibleToken?.type !== 'strong') return null

  const breakIndex = tokens.findIndex((token) => token.type === 'br')
  if (breakIndex < 0) return null

  const title = tokens.slice(0, breakIndex)
  const detail = tokens.slice(breakIndex + 1)
  if (!title.some(hasVisibleInlineContent) || !detail.some(hasVisibleInlineContent)) {
    return null
  }

  return { title, detail }
}

function hasVisibleInlineContent(token: Token): boolean {
  return token.type !== 'br' && token.type !== 'space' && token.raw.trim().length > 0
}

function renderCode(
  code: string,
  language: string | null | undefined,
  streaming: boolean,
  context: RenderContext,
  key: string,
): React.ReactNode {
  const normalizedLanguage = language?.trim().split(/\s+/u)[0].toLowerCase()
  if (normalizedLanguage === 'mermaid') {
    return (
      <div className={context.allowWideBlocks ? 'md-wide-block' : undefined} key={key}>
        <MermaidRenderer definition={code} />
      </div>
    )
  }
  return (
    <LazyRender
      className={context.allowWideBlocks ? 'md-wide-block' : undefined}
      fallback={
        <pre className="md-code-placeholder">
          <code>{code}</code>
        </pre>
      }
      key={key}
    >
      <CodeBlock
        code={code}
        language={normalizedLanguage}
        streaming={streaming}
        showWrapControl={context.presentation === 'conversation'}
      />
    </LazyRender>
  )
}

function renderDirective(
  token: MarkdownDirectiveToken,
  context: RenderContext,
  key: string,
): React.ReactNode {
  const name = normalizeDirectiveName(token.name)
  if (name === 'code-comment') {
    return renderCodeCommentDirective(token, context, key)
  }
  const renderer = context.directives.get(name)
  const children = renderTokens(token.tokens, context, `${key}-body`)
  if (!renderer) {
    return (
      <pre className="md-directive md-directive-unknown" data-md-directive={name} key={key}>
        <code>{token.raw}</code>
      </pre>
    )
  }
  return (
    <React.Fragment key={key}>
      {renderer({
        argument: token.argument,
        attributes: token.attributes,
        children,
        name,
        rawText: token.text,
      })}
    </React.Fragment>
  )
}

function renderCodeCommentDirective(
  token: MarkdownDirectiveToken,
  context: RenderContext,
  key: string,
): React.ReactNode {
  const { attributes } = token
  const file = attributes.file?.trim()
  const start = positiveInteger(attributes.start)
  const end = positiveInteger(attributes.end)
  const title = attributes.title?.trim() || '代码审查发现'
  const body = attributes.body?.trim() || token.argument || token.text
  const priority = positiveInteger(attributes.priority)
  const open = (): void => {
    if (!file || !context.onOpenFileReference) return
    context.onOpenFileReference(
      {
        path: file,
        ...(start ? { line: start } : {}),
        ...(end ? { endLine: end } : {}),
      },
      { preview: false },
    )
  }
  return (
    <aside
      className="md-directive md-code-comment"
      data-md-directive="code-comment"
      data-priority={priority ?? undefined}
      key={key}
    >
      <button
        className="md-code-comment__target"
        disabled={!file || !context.onOpenFileReference}
        type="button"
        onClick={open}
      >
        <strong>{title}</strong>
        {file ? (
          <code>
            {file}
            {start ? `:${start}` : ''}
          </code>
        ) : null}
      </button>
      {body ? <p>{body}</p> : null}
    </aside>
  )
}

function positiveInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function renderListItem(
  item: Tokens.ListItem,
  context: RenderContext,
  key: string,
): React.ReactNode {
  return (
    <li key={key}>
      {item.task ? (
        <input
          aria-label={item.checked ? '已完成' : '未完成'}
          checked={Boolean(item.checked)}
          readOnly
          type="checkbox"
        />
      ) : null}
      {renderTokens(item.tokens, context, `${key}-content`)}
    </li>
  )
}

function renderTable(table: Tokens.Table, context: RenderContext, key: string): React.ReactNode {
  return <MarkdownTable context={context} key={key} source={table.raw} table={table} />
}

function MarkdownTable({
  context,
  source,
  table,
}: {
  context: RenderContext
  source: string
  table: Tokens.Table
}): React.ReactNode {
  const [copied, setCopied] = React.useState(false)
  const [downloadStatus, setDownloadStatus] = React.useState('')
  const [expanded, setExpanded] = React.useState(false)
  const [overflowing, setOverflowing] = React.useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const tableRef = useRef<HTMLTableElement | null>(null)
  const { onCloseAutoFocus } = useDialogFocusRestore(expanded)
  const html = tableToHtml(table)

  React.useEffect(() => {
    const scroll = scrollRef.current
    const content = tableRef.current
    if (!scroll || !content) return
    const measure = (): void => setOverflowing(scroll.scrollWidth > scroll.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroll)
    observer.observe(content)
    return () => observer.disconnect()
  }, [source])

  async function downloadTable(): Promise<void> {
    try {
      await saveMarkdownTableCsv(table)
      setDownloadStatus('已下载表格')
    } catch {
      setDownloadStatus('下载失败，请重试')
    }
  }

  async function copyTable(): Promise<void> {
    try {
      await desktopClipboard.writeRichText({ text: source, html })
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2_000)
    } catch {
      setCopied(false)
    }
  }

  const renderContent = (preview: boolean): React.ReactNode => (
    <table ref={preview ? undefined : tableRef}>
      <thead>
        <tr>
          {table.header.map((cell, index) =>
            renderTableCell(cell, context, `table-head-${index}`, true),
          )}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, rowIndex) => (
          <tr key={`table-row-${rowIndex}`}>
            {row.map((cell, cellIndex) =>
              renderTableCell(cell, context, `table-cell-${rowIndex}-${cellIndex}`, false),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <figure
      className={cx('md-table-block tw:group/table', context.allowWideBlocks && 'md-wide-block')}
    >
      <div className="md-table-actions tw:opacity-0 tw:transition-opacity tw:group-hover/table:opacity-100 tw:group-focus-within/table:opacity-100 tw:pointer-coarse:opacity-100">
        {context.presentation === 'conversation' ? (
          <Button
            isIconOnly
            variant="text"
            size={context.presentation === 'conversation' ? 'xs' : 'toolbar'}
            aria-label="下载 CSV"
            title="下载 CSV"
            type="button"
            onClick={() => void downloadTable()}
          >
            <Download aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </Button>
        ) : null}
        <Button
          isIconOnly
          className={cx(
            'md-table-copy',
            context.presentation === 'conversation' && 'tw:size-6',
            copied && 'is-copied',
          )}
          variant={context.presentation === 'conversation' ? 'text' : 'ghost'}
          size={context.presentation === 'conversation' ? 'xs' : 'toolbar'}
          title={copied ? '已复制' : '复制表格'}
          type="button"
          onClick={() => void copyTable()}
        >
          {copied ? (
            <Check aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          ) : (
            <Copy aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          )}
        </Button>
        {context.allowWideBlocks || overflowing ? (
          <Button
            isIconOnly
            variant="text"
            size="xs"
            aria-label="展开表格"
            title="展开表格"
            aria-haspopup="dialog"
            aria-expanded={expanded}
            onClick={() => setExpanded(true)}
          >
            <Maximize2 aria-hidden="true" size={APP_ICON_SIZE} />
          </Button>
        ) : null}
      </div>
      <div className="md-table-scroll" ref={scrollRef} tabIndex={0}>
        {renderContent(false)}
      </div>
      <Dialog.Root open={expanded} onOpenChange={setExpanded}>
        <Dialog.Portal>
          <Dialog.Overlay className="ui-dialog-backdrop tw:fixed tw:inset-0 tw:z-modal" />
          <Dialog.Content
            className="ui-dialog-surface ui-dialog-surface--centered tw:z-modal tw:flex tw:w-[calc(100vw-4rem)] tw:max-h-[calc(100vh-4rem)] tw:min-h-0 tw:flex-col tw:gap-3 tw:p-4 tw:text-app-text tw:outline-none"
            aria-describedby={undefined}
            onCloseAutoFocus={onCloseAutoFocus}
          >
            <header className="tw:flex tw:items-center tw:justify-between tw:gap-3">
              <Dialog.Title className="tw:m-0 tw:type-row-title">表格预览</Dialog.Title>
              <Dialog.Close asChild>
                <Button
                  isIconOnly
                  color="ghostSecondary"
                  size="xs"
                  aria-label="关闭表格预览"
                  title="关闭表格预览"
                >
                  <X aria-hidden="true" size={APP_ICON_SIZE} />
                </Button>
              </Dialog.Close>
            </header>
            <div
              className="md-body md-table-block tw:min-h-0 tw:overflow-auto"
              role="region"
              aria-label="可滚动表格"
              tabIndex={0}
            >
              {renderContent(true)}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {downloadStatus ? (
        <p className="md-table-status" role="status">
          {downloadStatus}
        </p>
      ) : null}
    </figure>
  )
}

function renderTableCell(
  cell: Tokens.TableCell,
  context: RenderContext,
  key: string,
  heading: boolean,
): React.ReactNode {
  const Tag = heading ? 'th' : 'td'
  return (
    <Tag
      key={key}
      scope={heading ? 'col' : undefined}
      style={cell.align ? { textAlign: cell.align } : undefined}
    >
      {renderTokens(cell.tokens, context, `${key}-content`)}
    </Tag>
  )
}

function renderLink(link: Tokens.Link, context: RenderContext, key: string): React.ReactNode {
  const children = renderTokens(link.tokens, context, `${key}-label`)
  const target = classifyMarkdownTarget(link.href)
  if (target.kind === 'thread') {
    return (
      <a
        href={link.href}
        key={key}
        onClick={(event) => {
          handleMarkdownThreadLinkClick(event, target.threadId)
        }}
        title={link.title ?? undefined}
      >
        {children}
      </a>
    )
  }
  if (target.kind === 'external') {
    if (
      !context.externalResourcePolicy.allowExternalLinks ||
      !context.externalResourcePolicy.allowExternalUrl(target.url)
    ) {
      return <React.Fragment key={key}>{children}</React.Fragment>
    }
    return (
      <a
        href={target.url}
        key={key}
        onClick={(event) => {
          event.preventDefault()
          openExternal(context, target.url)
        }}
        rel="noopener noreferrer"
        title={link.title ?? undefined}
      >
        {children}
      </a>
    )
  }
  if (target.kind === 'file') {
    return (
      <FileReferenceButton
        className="md-file-reference"
        context={context}
        key={key}
        reference={target}
        title={link.title ?? target.path}
      >
        {children}
      </FileReferenceButton>
    )
  }
  if (target.kind === 'anchor') {
    return (
      <a href={target.href} key={key} title={link.title ?? undefined}>
        {children}
      </a>
    )
  }
  return <React.Fragment key={key}>{children}</React.Fragment>
}

function renderImage(image: Tokens.Image, context: RenderContext, key: string): React.ReactNode {
  if (!context.externalResourcePolicy.allowRemoteMedia || !isSafeHttpsMediaSource(image.href)) {
    return <React.Fragment key={key}>{image.text}</React.Fragment>
  }
  return (
    <RemoteMedia
      alt={image.text}
      key={key}
      kind="image"
      src={image.href}
      title={image.title ?? undefined}
    />
  )
}

function renderCodeSpan(text: string, context: RenderContext, key: string): React.ReactNode {
  if (isWindowsWorkspaceRouteCodeSpan(text, context.cwd) || !isLikelyFileReference(text))
    return <code key={key}>{text}</code>
  const target = classifyMarkdownTarget(text)
  if (target.kind !== 'file') return <code key={key}>{text}</code>
  return (
    <FileReferenceButton
      className="md-file-reference md-file-reference-inline"
      context={context}
      key={key}
      reference={target}
      title={target.path}
    >
      {text}
    </FileReferenceButton>
  )
}

function isWindowsWorkspaceRouteCodeSpan(text: string, cwd: string | null): boolean {
  if (!cwd || !/^(?:[a-zA-Z]:[\\/]|\\\\)/u.test(cwd)) return false
  const value = text.trim()
  if (!/^\/(?!\/)/u.test(value)) return false
  if (/(?:#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?|:\d+(?::\d+)?)$/iu.test(value)) {
    return false
  }
  const pathname = value.split(/[?#]/u, 1)[0] ?? value
  return !/\.[a-zA-Z\d]{1,12}$/u.test(pathname)
}

function renderMediaGrid(
  tokens: Token[],
  context: RenderContext,
  key: string,
): React.ReactNode | null {
  const meaningful = tokens.filter((token) => !isMediaSeparator(token))
  if (
    !context.externalResourcePolicy.allowRemoteMedia ||
    meaningful.length === 0 ||
    !meaningful.every((token) => mediaSourceForToken(token) !== null)
  ) {
    return null
  }
  return (
    <div className={`md-media-grid${context.allowWideBlocks ? ' md-wide-block' : ''}`} key={key}>
      {meaningful.map((token, index) => renderMediaToken(token, context, `${key}-media-${index}`))}
    </div>
  )
}

function renderMediaToken(token: Token, context: RenderContext, key: string): React.ReactNode {
  const media = mediaSourceForToken(token)
  if (!media) return renderToken(token, context, key)
  if (media.kind === 'image') {
    const alt = token.type === 'image' ? token.text : ''
    return <RemoteMedia alt={alt} key={key} kind="image" src={media.source} />
  }
  if (media.kind === 'audio') {
    return <RemoteMedia key={key} kind="audio" src={media.source} />
  }
  return <RemoteMedia key={key} kind="video" src={media.source} />
}

function mediaSourceForToken(
  token: Token,
): { kind: 'audio' | 'image' | 'video'; source: string } | null {
  if (token.type === 'image') {
    if (!isSafeHttpsMediaSource(token.href)) return null
    return { kind: 'image', source: token.href }
  }
  if (token.type !== 'link') return null
  const kind = mediaKindForUrl(token.href)
  return kind ? { kind, source: token.href } : null
}

function isMediaSeparator(token: Token): boolean {
  return token.type === 'br' || (token.type === 'text' && token.text.trim().length === 0)
}

function renderGenericToken(
  token: MarkdownToken,
  context: RenderContext,
  key: string,
): React.ReactNode {
  if ('tokens' in token && Array.isArray(token.tokens)) {
    return (
      <React.Fragment key={key}>
        {renderTokens(token.tokens, context, `${key}-generic`)}
      </React.Fragment>
    )
  }
  if ('text' in token && typeof token.text === 'string') {
    return <React.Fragment key={key}>{token.text}</React.Fragment>
  }
  return null
}

function findInlineHtmlGroup(
  tokens: MarkdownToken[],
  start: number,
): { end: number; html: string } | null {
  const first = tokens[start]
  if (first?.type !== 'html' || first.block) return null
  const opening = /^<\s*([a-zA-Z][\w-]*)(?:\s[^>]*)?>$/u.exec(first.raw)
  if (!opening || first.raw.endsWith('/>')) return null
  const tag = opening[1].toLowerCase()
  let depth = 1
  for (let index = start + 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.type === 'html' && !token.block) {
      if (new RegExp(`^<\\s*${escapeRegExp(tag)}(?:\\s[^>]*)?>$`, 'iu').test(token.raw)) {
        depth += 1
      } else if (new RegExp(`^<\\s*\\/\\s*${escapeRegExp(tag)}\\s*>$`, 'iu').test(token.raw)) {
        depth -= 1
      }
    }
    if (depth === 0) {
      return {
        end: index,
        html: tokens
          .slice(start, index + 1)
          .map((part) => part.raw)
          .join(''),
      }
    }
  }
  return null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function stableTokenKey(token: MarkdownToken | undefined, index: number): string {
  if (!token) return String(index)
  return `${token.type}-${index}`
}

function renderTextWithFileReferences(
  text: string,
  context: RenderContext,
  key: string,
): React.ReactNode {
  const pattern = /【([^†】]+)†(L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)】/gu
  const parts: React.ReactNode[] = []
  let cursor = 0
  let matchIndex = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue
    if (match.index > cursor) {
      parts.push(text.slice(cursor, match.index))
    }
    const label = match[0]
    const reference = parseMarkdownFileReference(`${match[1]}#${match[2]}`)
    parts.push(
      <FileReferenceButton
        className="md-file-reference md-file-reference-inline"
        context={context}
        key={`${key}-file-${matchIndex}`}
        reference={reference}
        title={reference.path}
      >
        {label}
      </FileReferenceButton>,
    )
    cursor = match.index + label.length
    matchIndex += 1
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts.length > 0 ? parts : text
}

function tableToHtml(table: Tokens.Table): string {
  const header = table.header.map((cell) => `<th>${escapeHtml(tableCellText(cell))}</th>`).join('')
  const rows = table.rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(tableCellText(cell))}</td>`).join('')}</tr>`,
    )
    .join('')
  return `<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`
}

function tableCellText(cell: Tokens.TableCell): string {
  return cell.tokens.map(tokenText).join('')
}

export function markdownTableToCsv(table: Tokens.Table): string {
  const rows = [table.header, ...table.rows]
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((cell) => {
            const value = tableCellText(cell)
            // CSV 单元格会被 Excel 解释为公式；沿用 ZCode 的前缀保护，保留原 Markdown。
            const safeValue =
              /^[\t\r\n]/u.test(value) || /^[\s]*[=+\-@]/u.test(value) ? `'${value}` : value
            return /[",\r\n]/u.test(safeValue) ? `"${safeValue.replaceAll('"', '""')}"` : safeValue
          })
          .join(','),
      )
      .join('\r\n')
  )
}

export function saveMarkdownTableCsv(table: Tokens.Table) {
  return desktopClient.saveAttachmentToDownloads({
    kind: 'text',
    name: 'table.csv',
    mediaType: 'text/csv',
    encoding: 'utf8',
    data: markdownTableToCsv(table),
  })
}

function tokenText(token: Token): string {
  if ('tokens' in token && Array.isArray(token.tokens)) {
    return token.tokens.map(tokenText).join('')
  }
  return 'text' in token && typeof token.text === 'string' ? token.text : ''
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function RemoteMedia({
  alt = '',
  kind,
  src,
  title,
}: {
  alt?: string
  kind: 'audio' | 'image' | 'video'
  src: string
  title?: string
}): React.ReactNode {
  const [failed, setFailed] = React.useState(false)
  const fallback = (
    <span className="md-media-placeholder" role="status">
      {failed ? `无法加载媒体：${alt || src}` : alt || '正在加载媒体'}
    </span>
  )
  if (failed) return fallback
  return (
    <LazyRender fallback={fallback}>
      {kind === 'image' ? (
        <img alt={alt} loading="lazy" onError={() => setFailed(true)} src={src} title={title} />
      ) : kind === 'audio' ? (
        <audio controls onError={() => setFailed(true)} preload="metadata" src={src} />
      ) : (
        <video controls onError={() => setFailed(true)} preload="metadata" src={src} />
      )}
    </LazyRender>
  )
}

function resolveWorkspacePath(cwd: string | null, path: string): string | null {
  const value = path.trim()
  if (!value) return null
  if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/u.test(value)) return value
  if (!cwd?.trim()) return null
  const separator = cwd.includes('\\') ? '\\' : '/'
  return `${cwd.replace(/[\\/]+$/u, '')}${separator}${value.replace(/^[.][\\/]/u, '')}`
}

function openExternal(context: RenderContext, url: string): void {
  if (
    !context.externalResourcePolicy.allowExternalLinks ||
    !context.externalResourcePolicy.allowExternalUrl(url)
  )
    return
  void desktopClient.openExternalURL(url).catch(() => undefined)
}

function openFile(context: RenderContext, path: string): void {
  const target = resolveWorkspacePath(context.cwd, path)
  if (!target) return
  void openPathWithPreferredExternalTarget(target).catch(() => undefined)
}

/**
 * 文件引用的长路径在分隔符后给出换行机会，避免正文把文件名从中间硬断行（如 `CanonicalThreadVie` / `w.tsx`）。
 * 单个路径段仍超出可用宽度时，由 `overflow-wrap: anywhere` 作为最后手段兜底。
 */
function renderFileReferenceLabel(children: React.ReactNode): React.ReactNode {
  if (typeof children !== 'string') return children
  const segments = children.split(/([/\\])/u)
  if (segments.length < 2) return children
  return segments.flatMap((segment, index) =>
    // 带捕获组切分后，奇数下标必定是路径分隔符，其后才是可换行位置。
    index % 2 === 1 ? [segment, <wbr key={`path-break-${index}`} />] : [segment],
  )
}

function FileReferenceButton({
  children,
  className,
  context,
  reference,
  title,
}: {
  children: React.ReactNode
  className: string
  context: RenderContext
  reference: MarkdownFileReference
  title: string
}): React.ReactNode {
  const absolutePath = resolveWorkspacePath(context.cwd, reference.path)
  const [openTargets, setOpenTargets] = React.useState<DesktopExternalOpenTarget[]>([])
  const [loadingTargets, setLoadingTargets] = React.useState(false)
  const canCopyContents = context.canCopyFileReferenceContents?.(reference) ?? false

  const prefetch = (): void => {
    if (!absolutePath) return
    void prefetchExternalOpenTargets(absolutePath).catch(() => undefined)
  }
  const loadTargets = (): void => {
    if (!absolutePath) return
    setLoadingTargets(true)
    void loadExternalOpenTargets(absolutePath)
      .then(setOpenTargets)
      .catch(() => setOpenTargets([]))
      .finally(() => setLoadingTargets(false))
  }
  const open = (preview: boolean): void => {
    if (context.onOpenFileReference) {
      context.onOpenFileReference(reference, { preview })
      return
    }
    openFile(context, reference.path)
  }
  const openWithTarget = (targetId: string): void => {
    if (!absolutePath) return
    void openPathWithExternalTarget(absolutePath, targetId)
      .then((selected) => {
        setOpenTargets((current) =>
          current.map((target) => ({
            ...target,
            preferred: target.id === selected.id,
          })),
        )
      })
      .catch(() => undefined)
  }
  const preferredTarget = openTargets.find((target) => target.preferred) ?? openTargets[0]
  const targetActions: AppContextMenuAction[] =
    loadingTargets && openTargets.length === 0
      ? [
          {
            kind: 'item',
            label: '正在查找打开方式…',
            disabled: true,
            onSelect: () => undefined,
          },
        ]
      : openTargets.length > 0
        ? [
            {
              kind: 'item',
              label: `使用 ${preferredTarget?.label ?? '首选应用'} 打开`,
              icon: openTargetIcon(preferredTarget),
              onSelect: () => {
                if (preferredTarget) openWithTarget(preferredTarget.id)
              },
            },
            {
              kind: 'sub',
              label: '打开方式',
              layout: 'grid',
              icon: (
                <Code2
                  aria-hidden="true"
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              ),
              children: openTargets.map((target) => ({
                kind: 'item' as const,
                label: target.label,
                icon: openTargetIcon(target),
                onSelect: () => openWithTarget(target.id),
              })),
            },
          ]
        : [
            {
              kind: 'item',
              label: '没有可用的外部应用',
              disabled: true,
              onSelect: () => undefined,
            },
          ]
  const actions: AppContextMenuAction[] = [
    ...targetActions,
    { kind: 'separator' },
    {
      kind: 'item',
      label: '复制路径',
      icon: <Copy aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
      onSelect: () => {
        void desktopClipboard.writeText(absolutePath ?? reference.path).catch(() => undefined)
      },
    },
    {
      kind: 'item',
      label: '复制文件内容',
      disabled: !canCopyContents || !context.onCopyFileReferenceContents,
      icon: (
        <FileText aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      ),
      onSelect: () => {
        try {
          void Promise.resolve(context.onCopyFileReferenceContents?.(reference)).catch(
            () => undefined,
          )
        } catch {
          // The workspace handler reports copy failures through the app error UI.
        }
      },
    },
    { kind: 'separator' },
    {
      kind: 'item',
      label: '在文件资源管理器中显示',
      disabled: !absolutePath,
      icon: (
        <FolderOpen aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      ),
      onSelect: () => {
        if (!absolutePath) return
        void desktopClient.revealPathInFolder(absolutePath).catch(() => undefined)
      },
    },
  ]
  return (
    <AppContextMenu
      actions={actions}
      layout="grid"
      onOpenChange={(open) => {
        if (open) loadTargets()
      }}
      trigger={
        <button
          aria-label={`打开文件 ${reference.path}`}
          className={className}
          data-file-reference=""
          onClick={(event) => {
            if (event.detail > 1) return
            if (event.ctrlKey || event.altKey) {
              openFile(context, reference.path)
              return
            }
            open(true)
          }}
          onDoubleClick={(event) => {
            if (event.ctrlKey || event.altKey || !canCopyContents) return
            open(false)
          }}
          onFocus={prefetch}
          onMouseEnter={prefetch}
          onPointerDown={prefetch}
          type="button"
          title={title}
        >
          <span className="md-file-reference__content">
            <span aria-hidden="true" className="md-file-reference__icon">
              <FileTypeIcon
                path={reference.path}
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </span>
            <span className="md-file-reference__label">{renderFileReferenceLabel(children)}</span>
          </span>
        </button>
      }
      size="md"
    />
  )
}

function openTargetIcon(target: DesktopExternalOpenTarget | undefined): React.ReactNode {
  if (!target) return null
  return (
    <OpenTargetIcon
      className="md-file-reference__target-icon"
      kind={target.kind}
      targetId={target.id}
    />
  )
}
