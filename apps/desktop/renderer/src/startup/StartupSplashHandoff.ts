import { swapStatusText } from './StatusTextSwap.js'

export const SPLASH_FADE_MS = 200
export const SPLASH_STALL_MS = 20_000
export const PET_OVERLAY_HASH_PREFIX = '#/pet-overlay'

let shell: ReturnType<typeof createStartupShell> | undefined
let retryConnection: (() => void) | undefined

export function createStartupShell(splash: HTMLElement) {
  let finished = false
  let ready = false
  let frame: number | undefined
  const loading = new Set<symbol>()
  const label = splash.querySelector<HTMLElement>('.full-screen-whale-loader__status')
  const actions = document.getElementById('startup-actions')
  const stalled = window.setTimeout(() => {
    if (finished) return
    if (actions) actions.hidden = false
    const detail = document.getElementById('startup-detail')
    if (detail) detail.textContent = '启动时间较长，可以继续等待或重新加载。'
  }, SPLASH_STALL_MS)
  const finishIfReady = () => {
    if (!ready || finished || loading.size || frame !== undefined) return
    frame = window.requestAnimationFrame(() => {
      frame = undefined
      if (!ready || finished || loading.size) return
      finished = true
      window.clearTimeout(stalled)
      splash.removeAttribute('aria-busy')
      const reduced = document.documentElement.dataset.reduceMotion
      if (
        reduced === 'on' ||
        (reduced !== 'off' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      ) {
        splash.remove()
      } else {
        splash.classList.add('full-screen-whale-loader--exiting')
        window.setTimeout(() => splash.remove(), SPLASH_FADE_MS + 40)
      }
      console.info('desktop.startup-surface-committed')
    })
  }
  return {
    active: () => !finished,
    label(text: string) {
      if (!finished && label) swapStatusText(label, text)
    },
    fail(text: string) {
      if (finished) return
      window.clearTimeout(stalled)
      if (label) swapStatusText(label, text)
      splash.setAttribute('role', 'alert')
      if (actions) actions.hidden = false
    },
    ready() {
      ready = true
      finishIfReady()
    },
    loading(text: string) {
      const token = Symbol()
      loading.add(token)
      if (!finished && label) swapStatusText(label, text)
      return () => {
        loading.delete(token)
        finishIfReady()
      }
    },
  }
}

export function installStartupSplashHandoff(): void {
  const splash = document.getElementById('startup-splash')
  if (!splash || shell) return
  if (window.location.hash.startsWith(PET_OVERLAY_HASH_PREFIX)) {
    splash.remove()
    return
  }
  shell = createStartupShell(splash)
  document.getElementById('startup-reload')?.addEventListener('click', (event) => {
    event.preventDefault()
    if (retryConnection) retryConnection()
    else window.location.reload()
  })
  document.getElementById('startup-logs')?.addEventListener('click', (event) => {
    event.preventDefault()
    void window.DesktopBridge?.openLogDirectory().catch(() => {})
  })
}

export const startupSplashActive = (): boolean => shell?.active() ?? false
export const reportStartupLoading = (label: string): (() => void) =>
  shell?.loading(label) ?? (() => {})
export function reportStartupLabel(label: string): void {
  retryConnection = undefined
  const action = document.getElementById('startup-reload')
  if (action) action.textContent = '重新加载'
  shell?.label(label)
}
export function reportStartupFailure(label: string, retry?: () => void): void {
  retryConnection = retry
  const action = document.getElementById('startup-reload')
  if (action) action.textContent = retry ? '重试连接' : '重新加载'
  shell?.fail(label)
}
export const reportStartupReady = (): void => shell?.ready()
export const startupSurfaceReadyRef = (element: HTMLElement | null): void => {
  if (element) reportStartupReady()
}
