import type {
  DesktopBrowserIpcBridge,
  DesktopBrowserSnapshot,
  DesktopBrowserBounds,
} from '@pidex/shared/desktop-browser-ipc'
type Guest = HTMLElement & { getWebContentsId(): number }
type Surface = {
  element: Guest
  generation: string
  bounds: DesktopBrowserBounds | null
  state: DesktopBrowserSnapshot
}
/** Window-owned DOM hosts. React panels only supply anchors; guests never move between parents. */
export class BrowserGuestHosts {
  private readonly surfaces = new Map<string, Surface>()
  private readonly anchors = new Map<string, DesktopBrowserBounds>()
  constructor(
    private readonly bridge: Partial<DesktopBrowserIpcBridge>,
    private readonly document: Document,
  ) {}
  update(state: DesktopBrowserSnapshot) {
    let surface = this.surfaces.get(state.tabId)
    if (
      !state.open ||
      state.state === 'suspended' ||
      state.state === 'crashed' ||
      (surface && surface.generation !== state.generation)
    ) {
      surface?.element.remove()
      this.surfaces.delete(state.tabId)
      surface = undefined
    }
    if (!state.open) this.anchors.delete(state.tabId)
    if (
      !state.open ||
      !state.generation ||
      state.state === 'suspended' ||
      state.state === 'crashed'
    )
      return
    if (!surface) {
      const element = this.document.createElement('webview') as Guest
      // Window-owned guest hosts stay attached while panels are hidden; the
      // geometry itself is written by `layout()`, so only the fixed stacking
      // frame is expressed as classes here.
      element.className = 'browser-guest-surface tw:fixed tw:z-1 tw:flex tw:border-0'
      element.setAttribute('partition', 'persist:pidex-browser')
      element.setAttribute('src', 'about:blank')
      surface = {
        element,
        generation: state.generation,
        bounds: this.anchors.get(state.tabId) ?? null,
        state,
      }
      this.surfaces.set(state.tabId, surface)
      let attached = false
      element.addEventListener('dom-ready', () => {
        if (
          attached ||
          !element.isConnected ||
          this.surfaces.get(state.tabId)?.generation !== state.generation
        )
          return
        attached = true
        void this.bridge
          .attachDesktopBrowserGuest?.({
            tabId: state.tabId,
            generation: state.generation!,
            guestId: element.getWebContentsId(),
          })
          .catch(() => {
            attached = false
          })
      })
      this.layout(surface)
      this.document.body.append(element)
    }
    surface.state = state
    this.layout(surface)
  }
  setBounds(tabId: string, bounds: DesktopBrowserBounds | null) {
    const anchor = bounds && bounds.width > 0 && bounds.height > 0 ? bounds : null
    if (anchor) this.anchors.set(tabId, anchor)
    else this.anchors.delete(tabId)
    const surface = this.surfaces.get(tabId)
    if (!surface) return
    surface.bounds = anchor
    this.layout(surface)
  }
  private layout(surface: Surface) {
    const bounds = surface.bounds
    const device = surface.state.device
    const emulated = device && device.mode !== 'desktop'
    const width = emulated ? device.width : (bounds?.width ?? surface.state.viewport?.width ?? 1280)
    const height = emulated
      ? device.height
      : (bounds?.height ?? surface.state.viewport?.height ?? 720)
    const scale = bounds && emulated ? Math.min(1, bounds.width / width, bounds.height / height) : 1
    Object.assign(surface.element.style, {
      left: `${bounds ? bounds.x + Math.max(0, (bounds.width - width * scale) / 2) : -100000}px`,
      top: `${bounds?.y ?? 0}px`,
      width: `${width}px`,
      height: `${height}px`,
      transform: `scale(${scale})`,
      transformOrigin: 'top left',
      pointerEvents: bounds && !surface.state.controlThreadId ? 'auto' : 'none',
    })
  }
  dispose() {
    for (const surface of this.surfaces.values()) surface.element.remove()
    this.surfaces.clear()
    this.anchors.clear()
  }
}
