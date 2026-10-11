import { getEffectiveReducedMotion } from '../hooks/UsePrefersReducedMotion.js'
import { swapStatusText } from './StatusTextSwap.js'

// 静态启动遮罩 handoff：只有真实的可输入 ProseMirror 编辑器
// （contenteditable + combobox）或显式 `data-startup-surface-ready` 标记才
// 判定页面就绪；路由地址本身不再作为就绪证据。遮罩存在期间把 React 整窗
// loader 的 `data-loading-label` 镜像到静态状态窗，冷启动全程只看到一个
// 鲸鱼和连续滑动的真实阶段。20 秒 fail-safe 兜底 lazy chunk 或初始化异常。
export const COMPOSER_READY_SELECTOR =
  '.composer-editor-content[contenteditable="true"][role="combobox"]'
export const SURFACE_READY_SELECTOR = '[data-startup-surface-ready="true"]'
export const FULL_SCREEN_LOADING_SELECTOR = '[data-full-screen-loading="true"]'
export const STATIC_STATUS_SELECTOR = '.full-screen-whale-loader__status'
export const SPLASH_FADE_MS = 200
export const SPLASH_FAILSAFE_MS = 20_000
export const PET_OVERLAY_HASH_PREFIX = '#/pet-overlay'

export type SplashDisposition =
  | { kind: 'finish' }
  | { kind: 'remove-immediately' }
  | { kind: 'mirror'; label: string | null }
  | { kind: 'wait' }

export function resolveSplashDisposition(input: {
  hash: string
  composerReady: boolean
  surfaceReady: boolean
  loaderPresent: boolean
  loaderLabel: string | null
}): SplashDisposition {
  // 宠物窗口是透明独立窗口，明确排除不透明的整窗鲸鱼。
  if (input.hash.startsWith(PET_OVERLAY_HASH_PREFIX)) {
    return { kind: 'remove-immediately' }
  }
  if (input.composerReady || input.surfaceReady) {
    return { kind: 'finish' }
  }
  if (input.loaderPresent) {
    return { kind: 'mirror', label: input.loaderLabel }
  }
  return { kind: 'wait' }
}

export function installStartupSplashHandoff(): void {
  const splash = document.getElementById('startup-splash')
  if (!splash) return

  let finished = false
  let failsafeTimer: number | null = null

  const stopWatching = (): void => {
    observer.disconnect()
    window.removeEventListener('hashchange', onDomChanged)
    if (failsafeTimer !== null) {
      window.clearTimeout(failsafeTimer)
      failsafeTimer = null
    }
  }

  // 正常模式 200ms 淡出；reduced-motion 下直接移除。幂等。
  const finish = (): void => {
    if (finished) return
    finished = true
    splash.removeAttribute('aria-busy')
    stopWatching()
    if (getEffectiveReducedMotion()) {
      splash.remove()
      return
    }
    splash.classList.add('full-screen-whale-loader--exiting')
    window.setTimeout(() => splash.remove(), SPLASH_FADE_MS + 40)
  }

  // /pet-overlay 透明窗口例外：立即撤下，不经过淡出。
  const removeImmediately = (): void => {
    if (finished) return
    finished = true
    stopWatching()
    splash.remove()
  }

  const onDomChanged = (): void => {
    if (finished) return
    const loader = document.querySelector(FULL_SCREEN_LOADING_SELECTOR)
    const disposition = resolveSplashDisposition({
      hash: window.location.hash,
      composerReady: document.querySelector(COMPOSER_READY_SELECTOR) !== null,
      surfaceReady: document.querySelector(SURFACE_READY_SELECTOR) !== null,
      loaderPresent: loader !== null,
      loaderLabel: loader?.getAttribute('data-loading-label') ?? null,
    })
    if (disposition.kind === 'finish') {
      finish()
      return
    }
    if (disposition.kind === 'remove-immediately') {
      removeImmediately()
      return
    }
    if (disposition.kind === 'mirror') {
      // React 整窗 loader 挂载后，静态 splash 从无障碍树隐藏，由 React 的
      // role="status" 负责播报，避免重复朗读；静态鲸鱼视觉上保持到 ready。
      if (!splash.hasAttribute('aria-hidden')) {
        splash.setAttribute('aria-hidden', 'true')
      }
      const status = splash.querySelector(STATIC_STATUS_SELECTOR)
      if (status && typeof status.textContent === 'string') {
        swapStatusText(status as HTMLElement, disposition.label ?? '')
      }
    }
  }

  // 除 childList/subtree 外监听相关 attribute，确保 data-loading-label 与
  // ready marker 的变化能被捕获（路由切换经由 history.pushState 重渲染 DOM，
  // 也会触发 childList 变更）。
  const observer = new MutationObserver(onDomChanged)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-loading-label', 'data-startup-surface-ready'],
  })
  window.addEventListener('hashchange', onDomChanged)
  failsafeTimer = window.setTimeout(finish, SPLASH_FAILSAFE_MS)
  onDomChanged()
}
