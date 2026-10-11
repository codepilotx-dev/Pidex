import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ComposerDraftKey } from '../session/composer/ComposerTypes.js'
import { useBrowserAnnotations } from './UseBrowserAnnotations.js'
import {
  ArrowLeft,
  ArrowRight,
  Globe2,
  MessageSquarePlus,
  Plus,
  RefreshCw,
  Square,
} from 'lucide-react'
import type { DesktopBrowserState } from '../../../shared/Types.js'
import type { DesktopBrowserClient } from '../../services/desktop-client/DesktopBrowserClient.js'
import { formatBrowserDisplayURL } from './BrowserDisplayURL.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../components/ui/IconTokens.js'
import { Button } from '../../components/ui/Button.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'

import { cx } from '../../utils/Cx.js'
import { BrowserManagementControls } from './BrowserManagementControls.js'

type Props = {
  client: DesktopBrowserClient
  threadId?: string | null
  onNewTab?: () => void
  state: DesktopBrowserState
  draftKey: ComposerDraftKey
  onStateChange: (state: DesktopBrowserState) => void
  onOpenSettings?: () => void
  onAppendImage?: (image: { data: string; mimeType: 'image/png' }) => void
}

type BrowserBounds = {
  x: number
  y: number
  width: number
  height: number
}

export function DesktopBrowserPanel({
  state,
  client,
  onNewTab,
  draftKey,
  onStateChange,
  onOpenSettings,
  onAppendImage,
}: Props): React.ReactNode {
  const [barsHost, setBarsHost] = useState<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [address, setAddress] = useState(state.url)
  const [addressFocused, setAddressFocused] = useState(false)
  const annotation = useBrowserAnnotations(client, state, draftKey)
  const lastBoundsRef = useRef<BrowserBounds | null>(null)
  const syncBrowserBoundsRef = useRef<() => Promise<void>>(async () => undefined)

  useEffect(() => {
    if (!addressFocused) setAddress(state.url)
  }, [addressFocused, state.url])

  useEffect(() => client.onBrowserStateChange(onStateChange), [client, onStateChange])

  useEffect(() => {
    if (!client.available || !state.open) return
    void client
      .setBrowserVisible(true)
      .then(onStateChange)
      .catch(() => undefined)
  }, [client, onStateChange, state.open])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !state.open) return

    let animationFrame = 0
    const setBounds = async (bounds: BrowserBounds): Promise<void> => {
      const previous = lastBoundsRef.current
      if (previous && sameBrowserBounds(previous, bounds)) {
        return
      }

      lastBoundsRef.current = bounds
      try {
        const next = await client.setBrowserBounds(bounds)
        onStateChange(next)
      } catch {
        // Bounds synchronization is retried by the next resize or visibility change.
      }
    }

    const syncBounds = async (): Promise<void> => {
      if (!state.url) {
        await setBounds({ x: 0, y: 0, width: 0, height: 0 })
        return
      }
      const rect = viewport.getBoundingClientRect()
      await setBounds({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      })
    }
    syncBrowserBoundsRef.current = syncBounds

    const scheduleSyncBounds = (): void => {
      if (animationFrame) return
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0
        void syncBounds()
      })
    }

    void syncBounds()
    const resizeObserver = new ResizeObserver(scheduleSyncBounds)
    resizeObserver.observe(viewport)
    window.addEventListener('resize', scheduleSyncBounds)
    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
      }
      syncBrowserBoundsRef.current = async () => undefined
      void setBounds({ x: 0, y: 0, width: 0, height: 0 })
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleSyncBounds)
    }
  }, [client, onStateChange, state.open, state.url])

  async function runBrowserAction(action: () => Promise<DesktopBrowserState>): Promise<void> {
    try {
      const next = await action()
      onStateChange(next)
    } catch (error) {
      onStateChange({
        ...state,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function handleNavigate(): void {
    void runBrowserAction(() => client.navigateBrowser(address))
  }

  const compactAddress =
    !addressFocused && address === state.url ? formatBrowserDisplayURL(address) : address
  const addressStatus = state.error
    ? state.error
    : state.loading
      ? '加载中...'
      : state.title || state.url || '未打开页面'

  return (
    <section className="right-dock-browser" aria-label="内置浏览器">
      <div className="browser-commandbar tw:grid tw:h-12 tw:min-h-12 tw:min-w-0 tw:shrink-0 tw:grid-cols-[auto_minmax(0,1fr)_auto] tw:items-center tw:gap-2 tw:border-b tw:border-app-border-subtle tw:bg-app-dock tw:p-2 tw:@max-[440px]:gap-1 tw:@max-[440px]:px-1">
        <div className="browser-navigation tw:flex tw:min-w-0 tw:shrink-0 tw:items-center tw:justify-self-start tw:gap-1 tw:@max-[440px]:gap-0">
          <Button
            isIconOnly
            color="ghostSecondary"
            disabled={!state.canGoBack}
            size="toolbar"
            title="后退"
            onClick={() => void runBrowserAction(client.goBackBrowser)}
          >
            <ArrowLeft size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </Button>
          <Button
            isIconOnly
            color="ghostSecondary"
            disabled={!state.canGoForward}
            size="toolbar"
            title="前进"
            onClick={() => void runBrowserAction(client.goForwardBrowser)}
          >
            <ArrowRight size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </Button>
          <Button
            isIconOnly
            className="tw:shrink-0"
            color="ghostSecondary"
            size="toolbar"
            title={state.loading ? '停止加载' : '重新加载'}
            onClick={() =>
              void runBrowserAction(state.loading ? client.stopBrowser : client.reloadBrowser)
            }
          >
            <span className="tw:inline-flex">
              {state.loading ? (
                <Square size={APP_ICON_SIZES.sm} />
              ) : (
                <RefreshCw size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              )}
            </span>
          </Button>
        </div>
        <form
          className="browser-address-form tw:relative tw:flex tw:h-7 tw:w-full tw:max-w-[770px] tw:min-w-0 tw:items-center tw:justify-self-center tw:rounded-md tw:border-0 tw:bg-transparent tw:p-0"
          title={addressStatus}
          onSubmit={(event) => {
            event.preventDefault()
            handleNavigate()
          }}
        >
          <input
            aria-label="浏览器地址"
            className="tw:min-w-0 tw:flex-auto tw:rounded-md tw:border-0 tw:bg-transparent tw:px-4 tw:py-1 tw:text-center tw:text-app-text tw:type-body tw:outline-none tw:focus:bg-app-raised tw:focus:shadow-[var(--cpx-sys-focus-ring-inset)] tw:@max-[440px]:px-2 tw:@max-[440px]:text-left"
            placeholder="输入 URL"
            value={compactAddress}
            onBlur={() => setAddressFocused(false)}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => {
              setAddressFocused(true)
              event.currentTarget.select()
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                if (event.key === 'Enter') event.preventDefault()
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setAddress(state.url)
                event.currentTarget.blur()
              }
            }}
          />
          {state.loading ? (
            <span className="browser-address-state tw:absolute tw:top-1/2 tw:right-0.5 tw:-translate-y-1/2 tw:translate-x-full tw:whitespace-nowrap tw:type-caption tw:text-app-text-meta tw:@max-[440px]:hidden">
              加载中
            </span>
          ) : null}
          {state.error ? (
            <span className="browser-address-error tw:absolute tw:top-1/2 tw:right-0.5 tw:inline-grid tw:size-4.5 tw:-translate-y-1/2 tw:translate-x-full tw:place-items-center tw:rounded-full tw:bg-[color-mix(in_srgb,var(--cpx-sys-color-danger)_12%,transparent)] tw:whitespace-nowrap tw:type-caption tw:text-app-danger tw:@max-[440px]:hidden">
              !
            </span>
          ) : null}
        </form>
        <div className="browser-toolbar-actions tw:flex tw:min-w-0 tw:items-center tw:justify-self-end tw:gap-2 tw:@max-[440px]:gap-0">
          {state.controlThreadId ? (
            <Button
              color="secondary"
              title="停止 Agent 操作，由你控制此标签"
              onClick={() => void runBrowserAction(() => client.control(null))}
            >
              接管
            </Button>
          ) : null}
          {state.busy ? (
            <span
              className={cx(
                'browser-address-state tw:absolute tw:top-1/2 tw:right-0.5 tw:-translate-y-1/2 tw:translate-x-full tw:whitespace-nowrap tw:type-caption tw:text-app-text-meta',
                state.controlThreadId && 'tw:@max-[440px]:hidden',
              )}
            >
              Agent 操作中
            </span>
          ) : null}
          <Button
            isIconOnly
            color="ghostSecondary"
            size="toolbar"
            title={annotation.active ? '退出批注' : '选择网页目标并添加批注'}
            className="browser-annotation-trigger"
            disabled={!state.features?.annotations || !state.documentId}
            aria-pressed={annotation.active}
            onClick={annotation.toggle}
          >
            <MessageSquarePlus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </Button>
          <Button
            isIconOnly
            className="tw:@max-[440px]:hidden"
            color="ghostSecondary"
            size="toolbar"
            title="新标签页"
            onClick={onNewTab}
          >
            <Plus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </Button>
          <BrowserManagementControls
            client={client}
            state={state}
            barsHost={barsHost}
            onOpenSettings={onOpenSettings}
            onAppendImage={onAppendImage}
          />
        </div>
      </div>
      <div ref={setBarsHost} className="browser-utility-bars" />
      {annotation.active ? (
        <div
          className="browser-annotation-tools tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:border-b tw:border-app-border-subtle tw:p-2 tw:type-body-sm tw:text-app-text-soft"
          role="toolbar"
          aria-label="批注选择模式"
        >
          <SegmentedControl
            value={annotation.mode}
            onChange={annotation.changeMode}
            ariaLabel="选择目标类型"
            options={[
              { value: 'element', label: '元素' },
              { value: 'text', label: '文本' },
              { value: 'region', label: '区域' },
            ]}
          />
          <span className="tw:min-w-0 tw:flex-1">
            {annotation.invalid.length
              ? `${annotation.invalid.length} 条目标已失效，反馈仍可发送`
              : '选择目标后填写反馈；Shift 多选；Esc 取消或退出'}
          </span>
          <Button color="secondary" onClick={annotation.toggle}>
            完成标注
          </Button>
        </div>
      ) : null}
      {annotation.error ? (
        <div
          className="browser-status-row tw:flex tw:items-center tw:justify-between tw:gap-2 tw:border-b tw:border-app-border-subtle tw:px-4 tw:py-2 tw:type-caption tw:text-app-text-meta tw:@max-[440px]:items-start tw:@max-[440px]:px-2"
          role="alert"
        >
          {annotation.error}
        </div>
      ) : null}

      {state.error ? (
        <div
          className="browser-status-row tw:flex tw:items-center tw:justify-between tw:gap-2 tw:border-b tw:border-app-border-subtle tw:px-4 tw:py-2 tw:type-caption tw:text-app-text-meta tw:@max-[440px]:items-start tw:@max-[440px]:px-2"
          role="alert"
        >
          <span className="tw:min-w-0 tw:truncate tw:@max-[440px]:whitespace-normal tw:@max-[440px]:wrap-anywhere">
            {state.error}
          </span>
          <Button
            className="tw:shrink-0"
            color="secondary"
            disabled={!state.url && !address.trim()}
            type="button"
            onClick={() =>
              void runBrowserAction(
                state.url ? client.reloadBrowser : () => client.navigateBrowser(address),
              )
            }
          >
            重试
          </Button>
        </div>
      ) : null}

      <div
        className="browser-viewport tw:relative tw:min-h-0 tw:min-w-0 tw:flex-auto tw:overflow-hidden tw:bg-app-canvas"
        ref={viewportRef}
        onPointerDown={() => {
          if (client.available) {
            void client.focusBrowser().catch(() => undefined)
          }
        }}
      >
        {!state.url ? (
          <div className="browser-empty-state tw:grid tw:size-full tw:min-h-0 tw:min-w-0 tw:content-center tw:items-center tw:justify-center tw:justify-items-center tw:gap-[clamp(var(--cpx-sys-space-2),2vh,var(--cpx-sys-space-5))] tw:p-[clamp(var(--cpx-sys-space-3),4vh,var(--cpx-sys-space-6))] tw:text-center tw:text-app-text-meta">
            <Globe2 size={APP_ICON_SIZES.lg} strokeWidth={APP_ICON_STROKE_WIDTH} />
            <strong className="tw:type-title-sm tw:text-app-text">开始浏览</strong>
            <span className="tw:type-body-sm tw:text-app-text-soft">输入 URL 以打开页面</span>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function sameBrowserBounds(a: BrowserBounds, b: BrowserBounds): boolean {
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  )
}
