import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { MoreHorizontal, X, ChevronUp, ChevronDown, RotateCw, Minus, Plus } from 'lucide-react'
import type { DesktopBrowserState } from '../../../shared/Types.js'
import type { DesktopBrowserClient } from '../../services/desktop-client/DesktopBrowserClient.js'
import type {
  DesktopBrowserDataCategory,
  DesktopBrowserDataResult,
  DesktopBrowserDevice,
  DesktopBrowserDownload,
  DesktopBrowserUtility,
  DesktopBrowserVisit,
} from '@pidex/shared/desktop-browser-ipc'
import { Button } from '../../components/ui/Button.js'

import { PopoverMenu } from '../../components/ui/PopoverMenu.js'
import { PopoverItem } from '../../components/ui/PopoverItem.js'
import { Checkbox } from '../../components/ui/Checkbox.js'
import { APP_ICON_SIZE } from '../../components/ui/IconTokens.js'
import { useDialogFocusRestore } from '../../components/ui/UseDialogFocusRestore.js'

type Props = {
  client: DesktopBrowserClient
  state: DesktopBrowserState
  barsHost: HTMLElement | null
  onOpenSettings?: () => void
  onAppendImage?: (image: { data: string; mimeType: 'image/png' }) => void
}
const categoryNames: Record<DesktopBrowserDataCategory, string> = {
  history: '浏览历史',
  downloads: '下载记录',
  cache: '缓存',
  siteData: 'Cookie 与站点数据',
}
const downloadStates = {
  progressing: '下载中',
  paused: '已暂停',
  completed: '已完成',
  cancelled: '已取消',
  interrupted: '已中断',
}
export function BrowserManagementControls({
  client,
  state,
  barsHost,
  onOpenSettings,
  onAppendImage,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [findResult, setFindResult] = useState({ matches: 0, activeMatchOrdinal: 0 })
  const requestId = useRef<number | null>(null)
  const [deviceOpen, setDeviceOpen] = useState(false)
  const device = state.device ?? { mode: 'desktop', width: 1280, height: 720 }
  const [dimensions, setDimensions] = useState({ width: device.width, height: device.height })
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<'history' | 'downloads' | 'clear' | null>(null)
  const [historyQuery, setHistoryQuery] = useState('')
  const [visits, setVisits] = useState<readonly DesktopBrowserVisit[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [downloads, setDownloads] = useState<readonly DesktopBrowserDownload[]>([])
  const [selected, setSelected] = useState<DesktopBrowserDataCategory[]>(['cache'])
  const [clearResult, setClearResult] = useState<DesktopBrowserDataResult['cleared']>([])
  const [loading, setLoading] = useState(false)
  const findInput = useRef<HTMLInputElement>(null)
  const sequence = useRef(0)
  const { onCloseAutoFocus } = useDialogFocusRestore(view !== null)
  const utilities = state.features?.utilities === true
  const data = state.features?.data === true

  useEffect(() => {
    setDimensions({ width: device.width, height: device.height })
    if (device.mode !== 'desktop') setDeviceOpen(true)
  }, [device.mode, device.width, device.height])
  useEffect(() => {
    if (findOpen) findInput.current?.focus()
  }, [findOpen])
  useEffect(
    () =>
      client.onUtilityEvent((event) => {
        if (event.kind === 'find-open') {
          setFindOpen(true)
          findInput.current?.focus()
        } else if (event.kind === 'find-close') setFindOpen(false)
        else setFindResult({ matches: event.matches, activeMatchOrdinal: event.activeMatchOrdinal })
      }),
    [client],
  )
  useEffect(() => {
    requestId.current = null
    setQuery('')
    setFindResult({ matches: 0, activeMatchOrdinal: 0 })
  }, [state.generation])
  const run = useCallback(
    async (operation: DesktopBrowserUtility) => {
      setMessage('')
      setBusy(true)
      try {
        const result = await client.utility(operation)
        if (result.image) {
          onAppendImage?.(result.image)
          setMessage('截图已复制并添加到聊天草稿')
        } else if (result.message) setMessage(result.message)
        return result
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '操作未完成')
        return undefined
      } finally {
        setBusy(false)
      }
    },
    [client, onAppendImage],
  )
  const find = useCallback(
    async (text: string, forward = true, findNext = false) => {
      if (!text) {
        if (requestId.current !== null) await client.utility({ action: 'stopFind' }).catch(() => {})
        requestId.current = null
        setFindResult({ matches: 0, activeMatchOrdinal: 0 })
        findInput.current?.focus()
        return
      }
      try {
        requestId.current =
          (await client.utility({ action: 'find', text, forward, findNext })).requestId ?? null
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '查找未完成')
      }
    },
    [client],
  )
  useEffect(() => {
    if (!findOpen) return
    const timer = window.setTimeout(() => {
      void find(query)
    }, 150)
    return () => window.clearTimeout(timer)
  }, [findOpen, query, find])
  function closeFind() {
    setFindOpen(false)
    void client.utility({ action: 'stopFind' }).catch(() => {})
  }
  async function applyDevice(next: DesktopBrowserDevice) {
    await run({ action: 'device', device: next })
  }
  const load = useCallback(
    async (append = false, after?: string) => {
      if (view !== 'history' && view !== 'downloads') return
      const current = ++sequence.current
      setLoading(true)
      try {
        const result = await client.data(
          view === 'history'
            ? { action: 'history', query: historyQuery, ...(after ? { cursor: after } : {}) }
            : { action: 'downloads' },
        )
        if (current !== sequence.current) return
        if (view === 'history') {
          setVisits((previous) =>
            append ? [...previous, ...(result.visits ?? [])] : (result.visits ?? []),
          )
          setCursor(result.nextCursor ?? null)
        } else setDownloads(result.downloads ?? [])
      } catch (error) {
        if (current === sequence.current)
          setMessage(error instanceof Error ? error.message : '读取未完成')
      } finally {
        if (current === sequence.current) setLoading(false)
      }
    },
    [client, view, historyQuery],
  )
  useEffect(() => {
    setMessage('')
    void load()
    return () => {
      sequence.current++
    }
  }, [load])
  useEffect(
    () =>
      client.onDataChange(() => {
        if (view === 'downloads' || view === 'history') void load()
      }),
    [client, view, load],
  )
  async function dataAction(request: Parameters<DesktopBrowserClient['data']>[0]) {
    setBusy(true)
    setMessage('')
    try {
      const result = await client.data(request)
      if (result.cleared) {
        const updated = result.cleared
        setClearResult((previous) => [
          ...(previous ?? []).filter(
            (item) => !updated.some((next) => next.category === item.category),
          ),
          ...updated,
        ])
      } else await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作未完成')
    } finally {
      setBusy(false)
    }
  }
  function openView(next: 'history' | 'downloads' | 'clear') {
    setMessage('')
    setView(next)
    if (next === 'clear') {
      setSelected(['cache'])
      setClearResult([])
    }
  }
  const bars = (
    <>
      {findOpen ? (
        <form
          className="browser-find-bar tw:flex tw:items-center tw:gap-1 tw:border-b tw:border-app-border-subtle tw:px-2 tw:py-1 tw:type-body-sm tw:text-app-text-soft"
          onSubmit={(event) => {
            event.preventDefault()
            void find(query, true, true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              closeFind()
            } else if (event.key === 'Enter' && event.shiftKey) {
              event.preventDefault()
              void find(query, false, true)
            }
          }}
        >
          <input
            className="browser-find-input tw:min-w-0 tw:flex-auto tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-2 tw:py-1 tw:text-app-text tw:type-body tw:focus-visible:shadow-[var(--cpx-sys-focus-ring-inset)] tw:focus-visible:outline-none"
            ref={findInput}
            aria-label="在页面中查找"
            maxLength={1000}
            placeholder="在页面中查找"
            value={query}
            onChange={(event) => {
              requestId.current = null
              setQuery(event.target.value)
            }}
          />
          <span aria-live="polite">
            {findResult.activeMatchOrdinal}/{findResult.matches}
          </span>
          <Button
            isIconOnly
            color="ghostSecondary"
            size="toolbar"
            title="上一项"
            disabled={!query}
            onClick={() => void find(query, false, true)}
          >
            <ChevronUp size={APP_ICON_SIZE} />
          </Button>
          <Button
            isIconOnly
            color="ghostSecondary"
            size="toolbar"
            title="下一项"
            disabled={!query}
            onClick={() => void find(query, true, true)}
          >
            <ChevronDown size={APP_ICON_SIZE} />
          </Button>
          <Button
            isIconOnly
            color="ghostSecondary"
            size="toolbar"
            title="关闭查找"
            onClick={closeFind}
          >
            <X size={APP_ICON_SIZE} />
          </Button>
        </form>
      ) : null}
      {deviceOpen ? (
        <div className="browser-device-bar tw:flex tw:flex-wrap tw:items-center tw:gap-1 tw:border-b tw:border-app-border-subtle tw:px-2 tw:py-1 tw:type-body-sm tw:text-app-text-soft">
          <select
            className="tw:min-w-0 tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-2 tw:py-1 tw:text-app-text tw:type-body tw:focus-visible:shadow-[var(--cpx-sys-focus-ring-inset)] tw:focus-visible:outline-none"
            aria-label="模拟设备"
            value={device.mode}
            disabled={busy}
            onChange={(event) => {
              const mode = event.target.value as DesktopBrowserDevice['mode']
              const size =
                mode === 'mobile'
                  ? { width: 390, height: 844 }
                  : mode === 'tablet'
                    ? { width: 768, height: 1024 }
                    : mode === 'desktop'
                      ? { width: 1280, height: 720 }
                      : dimensions
              void applyDevice({ mode, ...size })
            }}
          >
            <option value="desktop">桌面自适应</option>
            <option value="mobile">手机</option>
            <option value="tablet">平板</option>
            <option value="custom">自定义</option>
          </select>
          <form
            className="tw:flex tw:items-center tw:gap-1"
            onSubmit={(event) => {
              event.preventDefault()
              void applyDevice({
                mode: device.mode === 'desktop' ? 'custom' : device.mode,
                ...dimensions,
              })
            }}
          >
            <input
              className="tw:min-w-0 tw:w-16 tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-2 tw:py-1 tw:text-app-text tw:type-body tw:focus-visible:shadow-[var(--cpx-sys-focus-ring-inset)] tw:focus-visible:outline-none"
              aria-label="视口宽度"
              type="number"
              min={320}
              max={3840}
              value={dimensions.width}
              onChange={(event) =>
                setDimensions((previous) => ({ ...previous, width: Number(event.target.value) }))
              }
            />
            <span>×</span>
            <input
              className="tw:min-w-0 tw:w-16 tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-2 tw:py-1 tw:text-app-text tw:type-body tw:focus-visible:shadow-[var(--cpx-sys-focus-ring-inset)] tw:focus-visible:outline-none"
              aria-label="视口高度"
              type="number"
              min={200}
              max={2160}
              value={dimensions.height}
              onChange={(event) =>
                setDimensions((previous) => ({ ...previous, height: Number(event.target.value) }))
              }
            />
            <Button type="submit" color="secondary" disabled={busy}>
              应用
            </Button>
          </form>
          <Button
            isIconOnly
            color="ghostSecondary"
            size="toolbar"
            title="切换横竖屏"
            disabled={busy}
            onClick={() =>
              void applyDevice({
                ...device,
                mode: device.mode === 'desktop' ? 'custom' : device.mode,
                width: device.height,
                height: device.width,
              })
            }
          >
            <RotateCw size={APP_ICON_SIZE} />
          </Button>
          <Button
            isIconOnly
            color="ghostSecondary"
            size="toolbar"
            title="关闭设备工具栏"
            onClick={() => {
              setDeviceOpen(false)
              void applyDevice({ mode: 'desktop', width: 1280, height: 720 })
            }}
          >
            <X size={APP_ICON_SIZE} />
          </Button>
        </div>
      ) : null}
      {message && view === null ? (
        <div
          className="browser-management-message tw:p-2 tw:type-body-sm tw:text-app-text-soft"
          role="status"
        >
          {message}
        </div>
      ) : null}
    </>
  )
  return (
    <>
      <PopoverMenu
        className="popover-menu--text-only browser-more-menu"
        size="md"
        open={menuOpen}
        onOpenChange={setMenuOpen}
        align="end"
        trigger={
          <Button
            isIconOnly
            className="browser-more-trigger"
            color="ghostSecondary"
            size="toolbar"
            title="浏览器更多操作"
          >
            <MoreHorizontal size={APP_ICON_SIZE} />
          </Button>
        }
      >
        <PopoverItem disabled={!utilities} shortcut="Ctrl+F" onClick={() => setFindOpen(true)}>
          在页面中查找
        </PopoverItem>
        <PopoverItem
          disabled={!utilities || busy}
          onClick={() => void run({ action: 'print', pdf: false })}
        >
          打印
        </PopoverItem>
        <PopoverItem
          disabled={!utilities || busy}
          onClick={() => void run({ action: 'print', pdf: true })}
        >
          另存为 PDF
        </PopoverItem>
        <div
          className="browser-menu-zoom tw:flex tw:items-center tw:gap-1 tw:px-2 tw:py-1 tw:type-body-sm tw:text-app-text-soft"
          role="group"
          aria-label="网页缩放"
        >
          <span className="tw:flex-1">缩放</span>
          <Button
            isIconOnly
            color="ghostSecondary"
            size="toolbar"
            title="缩小网页"
            disabled={!utilities || busy}
            onClick={() => void run({ action: 'zoom', direction: 'out' })}
          >
            <Minus size={APP_ICON_SIZE} />
          </Button>
          <button
            className="browser-zoom-reset tw:rounded-md tw:border-0 tw:bg-transparent tw:px-2 tw:py-1 tw:text-inherit tw:type-body tw:hover:bg-app-hover tw:focus-visible:shadow-[var(--cpx-sys-focus-ring-inset)] tw:focus-visible:outline-none"
            disabled={!utilities || busy}
            title="恢复 100%"
            onClick={() => void run({ action: 'zoom', direction: 'reset' })}
          >
            {Math.round((state.zoomFactor ?? 1) * 100)}%
          </button>
          <Button
            isIconOnly
            color="ghostSecondary"
            size="toolbar"
            title="放大网页"
            disabled={!utilities || busy}
            onClick={() => void run({ action: 'zoom', direction: 'in' })}
          >
            <Plus size={APP_ICON_SIZE} />
          </Button>
        </div>
        <PopoverItem
          disabled={!utilities}
          onClick={() => {
            if (deviceOpen) void applyDevice({ mode: 'desktop', width: 1280, height: 720 })
            setDeviceOpen(!deviceOpen)
          }}
        >
          {deviceOpen ? '隐藏设备工具栏' : '显示设备工具栏'}
        </PopoverItem>
        <PopoverItem
          disabled={!utilities || busy}
          onClick={() =>
            void run({
              action: 'screenshot',
              destination: onAppendImage ? 'composer' : 'copy',
            })
          }
        >
          获取屏幕截图
        </PopoverItem>
        <PopoverItem disabled={!data} onClick={() => openView('downloads')}>
          下载
        </PopoverItem>
        <PopoverItem disabled={!data} onClick={() => openView('history')}>
          历史记录
        </PopoverItem>
        <PopoverItem disabled={!utilities} onClick={() => openView('clear')}>
          清除浏览数据
        </PopoverItem>
        <PopoverItem disabled={!onOpenSettings} onClick={onOpenSettings}>
          浏览器设置
        </PopoverItem>
      </PopoverMenu>
      {barsHost ? createPortal(bars, barsHost) : null}
      <Dialog.Root
        open={view !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setView(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
          <Dialog.Content
            className="ui-dialog-surface ui-dialog-surface--centered browser-management-dialog tw:flex tw:w-[min(42rem,calc(100vw-var(--cpx-sys-space-8)))] tw:max-h-[80vh] tw:flex-col tw:gap-3 tw:p-4 tw:[&>footer]:flex tw:[&>footer]:items-center tw:[&>footer]:justify-between tw:[&>footer]:gap-2 tw:[&>header]:flex tw:[&>header]:items-center tw:[&>header]:justify-between tw:[&>header]:gap-2"
            onCloseAutoFocus={onCloseAutoFocus}
          >
            <header>
              <Dialog.Title className="tw:m-0 tw:type-title-sm">
                {view === 'history' ? '浏览历史' : view === 'downloads' ? '下载' : '清除浏览数据'}
              </Dialog.Title>
              <Button
                isIconOnly
                color="ghostSecondary"
                size="toolbar"
                title="关闭"
                disabled={busy}
                onClick={() => setView(null)}
              >
                <X size={APP_ICON_SIZE} />
              </Button>
            </header>
            <Dialog.Description className="tw:m-0 tw:type-body-sm tw:text-app-text-soft">
              {view === 'history'
                ? '所有项目、聊天和窗口的浏览历史。'
                : view === 'downloads'
                  ? '移除记录不会删除已下载的文件。'
                  : '清理所选类别的全部时间。网页数据仅影响当前桌面实例的内置浏览器；浏览历史跨项目共享。'}
            </Dialog.Description>
            {view === 'history' ? (
              <>
                <input
                  aria-label="搜索浏览历史"
                  className="tw:min-w-0 tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-2 tw:py-1 tw:text-app-text tw:type-body tw:focus-visible:shadow-[var(--cpx-sys-focus-ring-inset)] tw:focus-visible:outline-none"
                  maxLength={500}
                  placeholder="搜索标题或网址"
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.target.value)}
                />
                <div className="browser-management-list tw:min-h-0 tw:overflow-auto">
                  {visits.map((visit, index) => (
                    <div key={visit.id}>
                      {index === 0 ||
                      new Date(visits[index - 1]!.visitedAt).toDateString() !==
                        new Date(visit.visitedAt).toDateString() ? (
                        <h4 className="tw:m-0 tw:p-2 tw:type-body-sm">
                          {new Date(visit.visitedAt).toLocaleDateString()}
                        </h4>
                      ) : null}
                      <div className="browser-history-row tw:flex tw:items-center tw:gap-2 tw:p-2">
                        <button
                          className="browser-history-link tw:flex tw:min-w-0 tw:flex-1 tw:flex-col tw:items-start tw:rounded-md tw:border-0 tw:bg-transparent tw:p-2 tw:text-left tw:type-body-sm tw:text-app-text tw:hover:bg-app-hover tw:focus-visible:shadow-[var(--cpx-sys-focus-ring-inset)] tw:focus-visible:outline-none"
                          onClick={() => {
                            void client
                              .createTab(null, visit.url)
                              .then(() => setView(null))
                              .catch((error) => setMessage(String(error)))
                          }}
                        >
                          <strong className="tw:max-w-full tw:truncate">
                            {visit.title || visit.url}
                          </strong>
                          <span className="tw:max-w-full tw:truncate tw:text-app-text-soft">
                            {visit.url}
                          </span>
                          <time className="tw:text-app-text-soft">
                            {new Date(visit.visitedAt).toLocaleTimeString()}
                          </time>
                        </button>
                        <Button
                          color="secondary"
                          disabled={busy}
                          onClick={() => void dataAction({ action: 'removeHistory', id: visit.id })}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  ))}
                  {!loading && visits.length === 0 ? (
                    <p className="tw:m-0 tw:type-body-sm tw:text-app-text-soft">暂无浏览历史</p>
                  ) : null}
                </div>
                {cursor ? (
                  <Button
                    color="secondary"
                    disabled={loading}
                    onClick={() => void load(true, cursor)}
                  >
                    加载更多
                  </Button>
                ) : null}
                <Button
                  color="secondary"
                  onClick={() => {
                    openView('clear')
                    setSelected(['history'])
                  }}
                >
                  清空浏览历史
                </Button>
              </>
            ) : view === 'downloads' ? (
              <div className="browser-management-list tw:min-h-0 tw:overflow-auto">
                {downloads.map((download) => (
                  <div
                    className="browser-download-row tw:flex tw:flex-col tw:gap-2 tw:border-b tw:border-app-border-subtle tw:p-3 tw:type-body-sm tw:wrap-anywhere"
                    key={download.id}
                  >
                    <strong>{download.fileName}</strong>
                    <span>
                      {downloadStates[download.state]} · {formatBytes(download.receivedBytes)}
                      {download.totalBytes > 0 ? ` / ${formatBytes(download.totalBytes)}` : ''}
                    </span>
                    {['progressing', 'paused'].includes(download.state) ? (
                      <progress
                        aria-label={`${download.fileName} 下载进度`}
                        max={Math.max(1, download.totalBytes)}
                        value={download.totalBytes > 0 ? download.receivedBytes : undefined}
                      />
                    ) : null}
                    <div className="browser-download-actions tw:flex tw:flex-wrap tw:gap-2">
                      {download.controllable ? (
                        <>
                          {download.state === 'progressing' ? (
                            <Button
                              color="secondary"
                              disabled={busy}
                              onClick={() =>
                                void dataAction({
                                  action: 'downloadAction',
                                  id: download.id,
                                  command: 'pause',
                                })
                              }
                            >
                              暂停
                            </Button>
                          ) : (
                            <Button
                              color="secondary"
                              disabled={busy || !download.resumable}
                              onClick={() =>
                                void dataAction({
                                  action: 'downloadAction',
                                  id: download.id,
                                  command: 'resume',
                                })
                              }
                            >
                              继续
                            </Button>
                          )}
                          <Button
                            color="secondary"
                            disabled={busy}
                            onClick={() =>
                              void dataAction({
                                action: 'downloadAction',
                                id: download.id,
                                command: 'cancel',
                              })
                            }
                          >
                            取消
                          </Button>
                        </>
                      ) : null}
                      {download.state === 'completed' ? (
                        <>
                          <Button
                            color="secondary"
                            disabled={busy}
                            onClick={() =>
                              void dataAction({
                                action: 'downloadAction',
                                id: download.id,
                                command: 'open',
                              })
                            }
                          >
                            打开文件
                          </Button>
                          <Button
                            color="secondary"
                            disabled={busy}
                            onClick={() =>
                              void dataAction({
                                action: 'downloadAction',
                                id: download.id,
                                command: 'reveal',
                              })
                            }
                          >
                            打开所在目录
                          </Button>
                        </>
                      ) : null}
                      {!download.controllable &&
                      ['completed', 'cancelled', 'interrupted'].includes(download.state) ? (
                        <Button
                          color="secondary"
                          disabled={busy}
                          onClick={() =>
                            void dataAction({
                              action: 'downloadAction',
                              id: download.id,
                              command: 'remove',
                            })
                          }
                        >
                          移除记录
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
                {!loading && downloads.length === 0 ? (
                  <p className="tw:m-0 tw:type-body-sm tw:text-app-text-soft">暂无下载记录</p>
                ) : null}
                <Button
                  color="secondary"
                  onClick={() => {
                    openView('clear')
                    setSelected(['downloads'])
                  }}
                >
                  清空已结束的下载记录
                </Button>
              </div>
            ) : view === 'clear' ? (
              <>
                <div className="browser-clear-options tw:flex tw:flex-col tw:gap-2">
                  {(Object.keys(categoryNames) as DesktopBrowserDataCategory[]).map((category) => (
                    <Checkbox
                      key={category}
                      checked={selected.includes(category)}
                      disabled={busy || (!data && ['history', 'downloads'].includes(category))}
                      onCheckedChange={(checked) => {
                        setClearResult([])
                        setSelected((previous) =>
                          checked
                            ? [...previous, category]
                            : previous.filter((value) => value !== category),
                        )
                      }}
                    >
                      {categoryNames[category]}
                    </Checkbox>
                  ))}
                </div>
                {selected.includes('siteData') ? (
                  <p className="tw:m-0 tw:type-body-sm tw:text-app-text-soft">
                    网页可能退出登录，正在进行的 Agent 网页操作将停止；站点授权保持不变。
                  </p>
                ) : null}
                {clearResult?.map((result) => (
                  <p
                    className="tw:m-0 tw:type-body-sm tw:text-app-text-soft"
                    role="status"
                    key={result.category}
                  >
                    {categoryNames[result.category]}：
                    {result.ok ? (result.message ?? '已清理') : result.message}
                  </p>
                ))}
                <footer>
                  <Button color="secondary" disabled={busy} onClick={() => setView(null)}>
                    关闭
                  </Button>
                  <Button
                    color="danger"
                    disabled={busy || selected.length === 0}
                    onClick={() =>
                      void dataAction({
                        action: 'clear',
                        categories: clearResult?.some((result) => !result.ok)
                          ? clearResult
                              .filter((result) => !result.ok)
                              .map((result) => result.category)
                          : selected,
                      })
                    }
                  >
                    {busy
                      ? '清理中…'
                      : clearResult?.some((result) => !result.ok)
                        ? '重试失败项'
                        : '清除所选数据'}
                  </Button>
                </footer>
              </>
            ) : null}
            {loading ? (
              <p className="tw:m-0 tw:type-body-sm tw:text-app-text-soft" role="status">
                正在读取…
              </p>
            ) : null}
            {message ? (
              <p className="tw:m-0 tw:type-body-sm tw:text-app-text-soft" role="status">
                {message}
              </p>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
function formatBytes(bytes: number) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
