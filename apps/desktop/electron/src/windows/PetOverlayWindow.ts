import { join } from 'node:path'
import { BrowserWindow, screen, type WebContents } from 'electron'
import {
  PET_OVERLAY_CHANNELS,
  type DesktopPetOverlayWindowState,
  type DesktopPetPresentation,
} from '@pidex/shared/desktop-pet-overlay'
import type { DesktopLogger } from '../logging/DesktopLogger.js'
import { isAllowedApplicationUrl, normalizeOrigin } from '../security/Navigation.js'
import {
  clampPetOverlayBounds,
  type PetOverlayWindowStateV1,
  PetOverlayWindowStateStore,
} from './PetOverlayWindowState.js'
import {
  advancePetThrow,
  estimatePetThrowVelocity,
  PET_DRAG_THRESHOLD_PX,
  PET_THROW_SAMPLE_WINDOW_MS,
  PET_THROW_TICK_MS,
  type PetThrowSample,
  type PetThrowVelocity,
} from './PetOverlayThrow.js'

export class PetOverlayWindowController {
  #window?: BrowserWindow
  #applicationOrigin?: string
  #pendingLoad?: {
    target: string
    promise: Promise<void>
  }
  #dragStart?: {
    cursor: Electron.Point
    bounds: Electron.Rectangle
  }
  #dragSamples: PetThrowSample[] = []
  #dragActivated = false
  #throwTimer?: ReturnType<typeof setInterval>
  #throwVelocity: PetThrowVelocity = { x: 0, y: 0 }
  #lastThrowFrameAt = 0
  #throwStartedAt = 0

  constructor(
    private readonly logger: DesktopLogger,
    private readonly moduleDirectory: string,
    private readonly stateStore: PetOverlayWindowStateStore,
    private state: PetOverlayWindowStateV1,
  ) {}

  get overlayWindow(): BrowserWindow | undefined {
    return this.#window
  }

  setApplicationOrigin(origin: string): void {
    this.#applicationOrigin = normalizeOrigin(origin)
  }

  async open(): Promise<void> {
    if (!this.#applicationOrigin) throw new Error('Agent 尚未连接')
    const overlay = this.#ensureWindow()
    const target = `${this.#applicationOrigin}/#/pet-overlay`
    while (overlay.webContents.getURL() !== target) {
      const pending = this.#pendingLoad
      if (pending) {
        if (pending.target === target) await pending.promise
        else await pending.promise.catch(() => undefined)
        continue
      }
      const load = {
        target,
        promise: overlay.loadURL(target),
      }
      this.#pendingLoad = load
      try {
        await load.promise
      } finally {
        if (this.#pendingLoad === load) this.#pendingLoad = undefined
      }
    }
    overlay.showInactive()
  }

  hide(): void {
    this.#stopThrow(true)
    this.#window?.hide()
  }

  windowState(): DesktopPetOverlayWindowState {
    return {
      open: this.#window?.isVisible() ?? false,
      bounds: this.#window?.getBounds() ?? this.state.bounds,
    }
  }

  isOverlaySender(sender: WebContents): boolean {
    return this.#window?.webContents === sender
  }

  send(channel: string, ...args: unknown[]): void {
    const overlay = this.#window
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send(channel, ...args)
    }
  }

  previewPresentation(presentation: DesktopPetPresentation): void {
    this.send(PET_OVERLAY_CHANNELS.presentationPreview, presentation)
  }

  globalPointerPosition(): Electron.Point {
    return screen.getCursorScreenPoint()
  }

  beginDrag(): void {
    const overlay = this.#window
    if (!overlay || overlay.isDestroyed()) return
    this.#stopThrow(false)
    const cursor = screen.getCursorScreenPoint()
    this.#dragStart = {
      cursor,
      bounds: overlay.getBounds(),
    }
    this.#dragSamples = [sampleCursor(cursor)]
    this.#dragActivated = false
  }

  updateDrag(): void {
    const overlay = this.#window
    const start = this.#dragStart
    if (!overlay || overlay.isDestroyed() || !start) return
    const cursor = screen.getCursorScreenPoint()
    const sample = sampleCursor(cursor)
    this.#dragSamples.push(sample)
    this.#dragSamples = this.#dragSamples.filter(
      (item) => item.timestampMs >= sample.timestampMs - PET_THROW_SAMPLE_WINDOW_MS,
    )
    const deltaX = cursor.x - start.cursor.x
    const deltaY = cursor.y - start.cursor.y
    if (!this.#dragActivated && Math.hypot(deltaX, deltaY) < PET_DRAG_THRESHOLD_PX) {
      return
    }
    this.#dragActivated = true
    const candidate = {
      ...start.bounds,
      x: start.bounds.x + deltaX,
      y: start.bounds.y + deltaY,
    }
    const candidateCenter = {
      x: candidate.x + Math.round(candidate.width / 2),
      y: candidate.y + Math.round(candidate.height / 2),
    }
    const workArea = screen.getDisplayNearestPoint(candidateCenter).workArea
    const bounds = clampPetOverlayBounds(candidate, workArea)
    overlay.setBounds(bounds, false)
    this.state = { version: 1, bounds }
  }

  endDrag(): void {
    const wasDragging = this.#dragStart !== undefined && this.#dragActivated
    if (wasDragging) {
      this.#dragSamples.push(sampleCursor(screen.getCursorScreenPoint()))
    }
    this.#dragStart = undefined
    this.#dragActivated = false
    const overlay = this.#window
    if (!overlay || overlay.isDestroyed()) return
    this.state = { version: 1, bounds: overlay.getBounds() }
    const velocity = estimatePetThrowVelocity(this.#dragSamples)
    this.#dragSamples = []
    if (wasDragging && Math.hypot(velocity.x, velocity.y) > 0) {
      this.#startThrow(velocity)
    } else {
      this.stateStore.scheduleSave(this.state)
    }
  }

  setPointerPassthrough(passthrough: boolean): void {
    this.#window?.setIgnoreMouseEvents(passthrough, { forward: true })
  }

  requestKeyboardFocus(focused: boolean): void {
    const overlay = this.#window
    if (!overlay || overlay.isDestroyed()) return
    overlay.setFocusable(focused)
    overlay.setIgnoreMouseEvents(!focused, { forward: true })
    if (focused) {
      overlay.show()
      overlay.focus()
    }
  }

  async flushState(): Promise<void> {
    this.#dragStart = undefined
    this.#dragActivated = false
    this.#dragSamples = []
    this.#stopThrow(true)
    await this.stateStore.flush()
  }

  destroy(): void {
    this.#stopThrow(false)
    if (this.#window && !this.#window.isDestroyed()) this.#window.destroy()
    this.#window = undefined
  }

  #startThrow(velocity: PetThrowVelocity): void {
    this.#stopThrow(false)
    this.#throwVelocity = velocity
    this.#lastThrowFrameAt = Date.now()
    this.#throwStartedAt = this.#lastThrowFrameAt
    this.#throwTimer = setInterval(() => {
      const overlay = this.#window
      if (!overlay || overlay.isDestroyed()) {
        this.#stopThrow(false)
        return
      }
      const now = Date.now()
      const currentBounds = overlay.getBounds()
      const center = {
        x: currentBounds.x + Math.round(currentBounds.width / 2),
        y: currentBounds.y + Math.round(currentBounds.height / 2),
      }
      const workArea = screen.getDisplayNearestPoint(center).workArea
      const step = advancePetThrow(
        currentBounds,
        this.#throwVelocity,
        now - this.#lastThrowFrameAt,
        now - this.#throwStartedAt,
        workArea,
      )
      this.#lastThrowFrameAt = now
      this.#throwVelocity = step.velocity
      this.state = { version: 1, bounds: step.bounds }
      overlay.setBounds(step.bounds, false)
      if (step.stopped) this.#stopThrow(true)
    }, PET_THROW_TICK_MS)
    this.#throwTimer.unref()
  }

  #stopThrow(save: boolean): void {
    if (this.#throwTimer) clearInterval(this.#throwTimer)
    this.#throwTimer = undefined
    this.#throwVelocity = { x: 0, y: 0 }
    if (save) {
      const overlay = this.#window
      if (overlay && !overlay.isDestroyed()) {
        this.state = { version: 1, bounds: overlay.getBounds() }
      }
      this.stateStore.scheduleSave(this.state)
    }
  }

  #ensureWindow(): BrowserWindow {
    if (this.#window && !this.#window.isDestroyed()) return this.#window
    const overlay = new BrowserWindow({
      ...this.state.bounds,
      transparent: true,
      frame: false,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(this.moduleDirectory, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        devTools: true,
      },
    })
    this.#window = overlay
    overlay.setAlwaysOnTop(true, 'floating')
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    overlay.setIgnoreMouseEvents(true, { forward: true })
    overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    overlay.webContents.on('will-navigate', (event, url) => {
      if (!isAllowedApplicationUrl(url, this.#applicationOrigin)) {
        event.preventDefault()
      }
    })
    overlay.webContents.on('preload-error', (_event, _preloadPath, error) => {
      this.logger.error('pet-overlay.preload-error', {
        message: error.message,
      })
    })
    overlay.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
        this.logger.error('pet-overlay.did-fail-load', {
          errorCode,
          errorDescription,
          isMainFrame,
        })
      },
    )
    overlay.webContents.on('render-process-gone', (_event, details) => {
      this.logger.error('pet-overlay.render-process-gone', {
        reason: details.reason,
        exitCode: details.exitCode,
      })
    })
    overlay.on('unresponsive', () => {
      this.logger.warn('pet-overlay.unresponsive')
    })
    overlay.on('closed', () => {
      if (this.#window === overlay) this.#window = undefined
    })
    return overlay
  }
}

function sampleCursor(cursor: Electron.Point): PetThrowSample {
  return {
    x: cursor.x,
    y: cursor.y,
    timestampMs: Date.now(),
  }
}
