import * as Dialog from '@radix-ui/react-dialog'
import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import type { RpcResult } from '@pidex/agent-protocol'
import { ExternalLink, RefreshCw, Sparkles, X } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'

import { ScrollArea } from '../../components/ui/ScrollArea.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import { MarkdownMessage } from '../markdown/MarkdownMessage.js'
import type { MarkdownDirectiveRegistry } from '../markdown/Types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import {
  loadReleaseNotes,
  releaseNotesErrorMessage,
  releaseNotesViewError,
  type ReleaseNotesViewError,
} from './ReleaseNotesModel.js'

const DISABLED_DIRECTIVES: MarkdownDirectiveRegistry = new Map()

type Props = {
  open: boolean
  restoreFocusElement?: HTMLElement | null
  onOpenChange: (open: boolean) => void
}

export function WhatsNewDialog({
  open,
  restoreFocusElement,
  onOpenChange,
}: Props): React.ReactNode {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [result, setResult] = useState<RpcResult<'release-notes/list'> | null>(null)
  const [error, setError] = useState<ReleaseNotesViewError | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const request = useCallback(async (refresh = false): Promise<void> => {
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      setResult(await loadReleaseNotes(desktopClient, refresh))
    } catch (requestError) {
      if (!refresh) setResult(null)
      setError(releaseNotesViewError(requestError))
    } finally {
      if (refresh) setRefreshing(false)
      else setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    void loadReleaseNotes(desktopClient)
      .then((next) => {
        if (!active) return
        setResult(next)
        setError(null)
      })
      .catch((requestError) => {
        if (!active) return
        setResult(null)
        setError(releaseNotesViewError(requestError))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop whats-new-dialog-backdrop tw:overflow-hidden" />
        <Dialog.Content
          className="ui-dialog-surface ui-dialog-surface--centered whats-new-dialog tw:grid tw:w-[min(1040px,calc(100vw-var(--cpx-sys-space-8)))] tw:h-[min(80vh,760px)] tw:min-h-0 tw:min-w-0 tw:grid-rows-[auto_minmax(0,1fr)] tw:overflow-hidden tw:rounded-xl tw:border tw:border-app-border-subtle tw:bg-app-underlay tw:shadow-lg tw:text-app-text"
          onCloseAutoFocus={(event) => {
            if (!restoreFocusElement?.isConnected) return
            event.preventDefault()
            restoreFocusElement.focus()
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            closeButtonRef.current?.focus()
          }}
        >
          <header className="whats-new-dialog-header tw:grid tw:grid-cols-[auto_minmax(0,1fr)_auto] tw:items-start tw:gap-3 tw:border-b tw:border-app-border-subtle tw:px-6 tw:py-5">
            <span
              aria-hidden="true"
              className="whats-new-heading-icon tw:inline-flex tw:size-9.5 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-lg tw:border tw:border-app-border tw:bg-app-underlay tw:text-app-text tw:[&>svg]:size-icon-lg"
            >
              <Sparkles size={APP_ICON_SIZE} />
            </span>
            <div className="whats-new-dialog-heading tw:grid tw:min-w-0 tw:gap-1">
              <Dialog.Title className="whats-new-dialog-title tw:m-0 tw:type-weight-label tw:text-app-text tw:text-[length:var(--cpx-sys-font-size-xl)] tw:[line-height:var(--cpx-sys-line-height-relaxed)]">
                新特性
              </Dialog.Title>
              <Dialog.Description className="whats-new-dialog-description tw:m-0 tw:text-app-text-meta tw:text-[length:var(--cpx-sys-font-size-sm)] tw:[line-height:var(--cpx-sys-line-height-tight)]">
                查看 Pidex 当前版本及历史版本的 GitHub 更新记录。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button
                isIconOnly
                color="ghostSecondary"
                ref={closeButtonRef}
                size="toolbar"
                title="关闭新特性"
              >
                <X aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              </Button>
            </Dialog.Close>
          </header>

          <div className="whats-new-dialog-body tw:min-h-0 tw:overflow-hidden">
            {loading ? <ReleaseNotesSkeleton /> : null}
            {!loading && error && !result ? (
              <ReleaseNotesError error={error} onRetry={() => void request(true)} />
            ) : null}
            {!loading && result ? (
              <ReleaseNotesContent
                refreshing={refreshing}
                result={result}
                onRefresh={() => void request(true)}
              />
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ReleaseNotesContent({
  refreshing,
  result,
  onRefresh,
}: {
  refreshing: boolean
  result: RpcResult<'release-notes/list'>
  onRefresh: () => void
}): React.ReactNode {
  const [selectedTagName, setSelectedTagName] = useState(result.releases[0]?.tagName ?? '')
  const detailScrollRef = useRef<HTMLDivElement>(null)

  if (!result.currentReleaseFound) {
    return (
      <ReleaseNotesEmpty
        description={`GitHub Releases 中暂时没有与当前安装版本 v${result.currentVersion} 对应的记录。`}
        title="尚未发布当前版本的更新日志"
      />
    )
  }
  if (result.releases.length === 0) {
    return (
      <ReleaseNotesEmpty
        description="GitHub Releases 目前没有可显示的更新记录。"
        title="暂无更新日志"
      />
    )
  }

  const currentTagName = result.releases[0]?.tagName
  const selectedRelease =
    result.releases.find((release) => release.tagName === selectedTagName) ?? result.releases[0]

  if (!selectedRelease) return null

  return (
    <section
      aria-label="版本更新记录"
      className="whats-new-release-browser tw:grid tw:h-full tw:min-h-0 tw:grid-cols-[minmax(220px,260px)_minmax(0,1fr)]"
    >
      <ScrollArea
        aria-label="版本列表"
        className="whats-new-version-scroll tw:min-h-0 tw:overscroll-contain tw:border-r tw:border-app-border-subtle tw:bg-app-panel"
        contentClassName="whats-new-version-scroll-content tw:p-3"
      >
        {result.source === 'bundled-changelog' ? (
          <div className="whats-new-notice whats-new-fallback-notice tw:m-0 tw:mb-3 tw:grid tw:gap-3 tw:rounded-lg tw:bg-app-hover tw:p-3 tw:text-[length:var(--cpx-sys-font-size-xs)] tw:text-app-text-meta">
            <p className="tw:m-0 tw:[line-height:var(--cpx-sys-line-height-tight)]">
              当前仅显示随应用提供的版本记录，在线历史版本暂时不可用。
            </p>
            <Button
              size="md"
              className="whats-new-fallback-action tw:justify-self-start"
              color="primary"
              loading={refreshing}
              onClick={onRefresh}
            >
              {refreshing ? null : <RefreshCw size={APP_ICON_SIZE} />}
              {refreshing ? '正在重试…' : '重试加载历史版本'}
            </Button>
          </div>
        ) : null}
        {result.truncated ? (
          <p className="whats-new-notice tw:m-0 tw:mb-3 tw:rounded-lg tw:bg-app-hover tw:p-3 tw:text-[length:var(--cpx-sys-font-size-xs)] tw:text-app-text-meta">
            更新记录较多，当前仅显示最近的一部分历史版本。
          </p>
        ) : null}
        <ul className="whats-new-version-list tw:m-0 tw:grid tw:list-none tw:gap-1 tw:p-0">
          {result.releases.map((release, index) => {
            const current = index === 0
            const selected = release.tagName === selectedRelease.tagName
            return (
              <li key={release.tagName}>
                <button
                  aria-current={current ? 'true' : undefined}
                  className="whats-new-version-item tw:grid tw:w-full tw:min-w-0 tw:cursor-pointer tw:gap-2 tw:rounded-md tw:border tw:border-transparent tw:bg-transparent tw:p-3 tw:text-left tw:text-inherit tw:type-body tw:hover:bg-app-hover tw:data-[selected=true]:border-app-border-subtle tw:data-[selected=true]:bg-app-hover tw:focus-visible:shadow-[var(--cpx-sys-focus-ring-inset)] tw:focus-visible:outline-none tw:forced-colors:focus-visible:shadow-none tw:forced-colors:focus-visible:outline-offset-[-2px] tw:forced-colors:focus-visible:[outline:2px_solid_Highlight]"
                  data-selected={selected || undefined}
                  type="button"
                  onClick={() => {
                    setSelectedTagName(release.tagName)
                    detailScrollRef.current?.scrollTo({ top: 0 })
                  }}
                >
                  <span className="whats-new-release-heading tw:flex tw:items-start tw:justify-between tw:gap-4">
                    <strong className="tw:min-w-0 tw:wrap-anywhere tw:text-[length:var(--cpx-sys-font-size-sm)] tw:[line-height:var(--cpx-sys-line-height-tight)]">
                      {release.name.trim() || release.tagName}
                    </strong>
                    <ReleaseBadges current={current} prerelease={release.prerelease} />
                  </span>
                  <ReleaseMeta release={release} />
                </button>
              </li>
            )
          })}
        </ul>
      </ScrollArea>

      <ScrollArea
        aria-label="版本更新内容"
        className="whats-new-detail-scroll tw:min-h-0 tw:overscroll-contain"
        contentClassName="whats-new-detail-scroll-content tw:p-6"
        viewportRef={detailScrollRef}
      >
        <ReleaseDetails
          current={selectedRelease.tagName === currentTagName}
          fetchedAt={result.fetchedAt}
          release={selectedRelease}
          source={result.source}
        />
      </ScrollArea>
    </section>
  )
}

function ReleaseDetails({
  current,
  fetchedAt,
  release,
  source,
}: {
  current: boolean
  fetchedAt: string
  release: RpcResult<'release-notes/list'>['releases'][number]
  source: RpcResult<'release-notes/list'>['source']
}): React.ReactNode {
  const canOpenRelease = isSafeHttpsUrl(release.htmlUrl)

  return (
    <article className="whats-new-release-details tw:min-w-0">
      <header className="whats-new-release-details-header tw:mb-5 tw:grid tw:gap-2 tw:border-b tw:border-app-border-subtle tw:pb-4">
        <span className="whats-new-release-heading tw:flex tw:items-center tw:justify-between tw:gap-4">
          <strong className="tw:min-w-0 tw:text-[length:var(--cpx-sys-font-size-md)]">
            {release.name.trim() || release.tagName}
          </strong>
          <ReleaseBadges current={current} prerelease={release.prerelease} />
        </span>
        <ReleaseMeta release={release} />
      </header>
      <div className="whats-new-release-body tw:p-0 tw:[&>.md-body]:max-w-none">
        {release.body.trim() ? (
          <MarkdownMessage
            allowBasicHtml={false}
            directives={DISABLED_DIRECTIVES}
            externalResourcePolicy={{
              allowExternalLinks: true,
              allowExternalUrl: isSafeHttpsUrl,
              allowRemoteMedia: false,
            }}
            text={release.body}
          />
        ) : (
          <p className="whats-new-empty-body tw:m-0 tw:text-[length:var(--cpx-sys-font-size-sm)] tw:text-app-text-meta">
            此版本没有填写更新说明。
          </p>
        )}
        {canOpenRelease ? (
          <div className="whats-new-release-actions tw:mt-5 tw:flex tw:justify-end">
            <Button
              size="md"
              color="secondary"
              onClick={() => {
                void desktopClient.openExternalURL(release.htmlUrl)
              }}
            >
              <ExternalLink size={APP_ICON_SIZE} />在 GitHub 查看
            </Button>
          </div>
        ) : null}
      </div>
      <p className="whats-new-source tw:mt-6 tw:mb-0 tw:text-left tw:text-[length:var(--cpx-sys-font-size-sm)] tw:text-app-text-meta">
        {source === 'bundled-changelog'
          ? '随 Pidex 安装包提供'
          : `数据来自 GitHub Releases · 最近获取于 ${formatDateTime(fetchedAt)}`}
      </p>
    </article>
  )
}

function ReleaseBadges({
  current,
  prerelease,
}: {
  current: boolean
  prerelease: boolean
}): React.ReactNode {
  if (!current && !prerelease) return null

  return (
    <span className="whats-new-release-badges tw:flex tw:shrink-0 tw:flex-wrap tw:items-center tw:justify-end tw:gap-2">
      {current ? (
        <span
          className="tw:rounded-full tw:bg-app-hover tw:px-2 tw:py-1 tw:text-app-text-meta tw:data-[kind=current]:text-app-accent-fg tw:text-[length:var(--cpx-sys-font-size-xs)]"
          data-kind="current"
        >
          当前版本
        </span>
      ) : null}
      {prerelease ? (
        <span className="tw:rounded-full tw:bg-app-hover tw:px-2 tw:py-1 tw:text-app-text-meta tw:text-[length:var(--cpx-sys-font-size-xs)]">
          预发布
        </span>
      ) : null}
    </span>
  )
}

function ReleaseMeta({
  release,
}: {
  release: RpcResult<'release-notes/list'>['releases'][number]
}): React.ReactNode {
  return (
    <span className="whats-new-release-meta tw:flex tw:items-center tw:gap-3 tw:text-app-text-meta tw:text-[length:var(--cpx-sys-font-size-xs)]">
      <code className="tw:font-mono">{release.tagName}</code>
      {release.publishedAt ? (
        <time dateTime={release.publishedAt}>{formatDate(release.publishedAt)}</time>
      ) : null}
    </span>
  )
}

function ReleaseNotesError({
  error,
  onRetry,
}: {
  error: ReleaseNotesViewError
  onRetry: () => void
}): React.ReactNode {
  const message = releaseNotesErrorMessage(error)
  return (
    <section
      aria-live="polite"
      className="whats-new-state tw:m-6 tw:grid tw:justify-items-start tw:gap-2 tw:rounded-lg tw:border tw:border-app-border tw:bg-app-underlay tw:p-7"
    >
      <strong>{message.title}</strong>
      <p className="tw:m-0 tw:mb-2 tw:max-w-[620px] tw:text-app-text-meta tw:[line-height:var(--cpx-sys-line-height-normal)]">
        {message.description}
      </p>
      <Button size="md" color="secondary" onClick={onRetry}>
        <RefreshCw size={APP_ICON_SIZE} />
        重试
      </Button>
    </section>
  )
}

function ReleaseNotesEmpty({
  description,
  title,
}: {
  description: string
  title: string
}): React.ReactNode {
  return (
    <section className="whats-new-state tw:m-6 tw:grid tw:justify-items-start tw:gap-2 tw:rounded-lg tw:border tw:border-app-border tw:bg-app-underlay tw:p-7">
      <strong>{title}</strong>
      <p className="tw:m-0 tw:mb-2 tw:max-w-[620px] tw:text-app-text-meta tw:[line-height:var(--cpx-sys-line-height-normal)]">
        {description}
      </p>
    </section>
  )
}

function ReleaseNotesSkeleton(): React.ReactNode {
  return (
    <section
      aria-label="正在获取更新日志"
      aria-live="polite"
      className="whats-new-skeleton tw:m-6 tw:grid tw:gap-3"
    >
      {[0, 1, 2].map((index) => (
        <div
          className="whats-new-skeleton-card tw:grid tw:gap-3 tw:rounded-lg tw:border tw:border-app-border tw:p-4"
          key={index}
        >
          <span className="tw:block tw:h-4.5 tw:w-[38%] tw:rounded-full tw:bg-app-hover" />
          <span className="tw:block tw:h-3.25 tw:w-full tw:rounded-full tw:bg-app-hover" />
          <span className="tw:block tw:h-3.25 tw:w-[72%] tw:rounded-full tw:bg-app-hover" />
        </div>
      ))}
    </section>
  )
}

function isSafeHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function formatDate(value: string): string {
  return formatDateValue(value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatDateTime(value: string): string {
  return formatDateValue(value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDateValue(value: string, options: Intl.DateTimeFormatOptions): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '未知时间'
  return new Intl.DateTimeFormat('zh-CN', options).format(timestamp)
}
