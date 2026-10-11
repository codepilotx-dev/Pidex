import type { WorkbenchTabId } from '../dock/RightDockState.js'
import { syncStylesheets } from './CloneStylesheets.js'

export interface AuxiliaryWindowEntry {
  readonly tabId: WorkbenchTabId
  readonly window: Window
  readonly container: HTMLElement
  readonly dispose: () => void
}

export type AuxiliaryWindowListener = () => void

export class AuxiliaryWindowService {
  private readonly windows = new Map<WorkbenchTabId, AuxiliaryWindowEntry>()
  private readonly listeners = new Set<AuxiliaryWindowListener>()
  private onDockBackRequested?: (tabId: WorkbenchTabId) => void

  constructor() {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('beforeunload', () => {
        this.closeAll()
      })
    }
  }

  setDockBackHandler(handler: (tabId: WorkbenchTabId) => void): void {
    this.onDockBackRequested = handler
  }

  isFloating(tabId: WorkbenchTabId): boolean {
    return this.windows.has(tabId)
  }

  getFloatingTabIds(): WorkbenchTabId[] {
    return Array.from(this.windows.keys())
  }

  getEntry(tabId: WorkbenchTabId): AuxiliaryWindowEntry | undefined {
    return this.windows.get(tabId)
  }

  open(
    tabId: WorkbenchTabId,
    title: string,
    dimensions: { width?: number; height?: number } = {},
  ): AuxiliaryWindowEntry | null {
    if (this.windows.has(tabId)) {
      const existing = this.windows.get(tabId)!
      try {
        existing.window.focus()
      } catch {
        // ignore focus error
      }
      return existing
    }

    const width = Math.max(dimensions.width ?? 960, 480)
    const height = Math.max(dimensions.height ?? 680, 360)
    const left = Math.max(window.screenX + Math.round((window.outerWidth - width) / 2), 0)
    const top = Math.max(window.screenY + Math.round((window.outerHeight - height) / 2), 0)

    const features = `width=${width},height=${height},left=${left},top=${top}`
    const frameName = `auxiliary:${encodeURIComponent(tabId)}`

    let childWindow: Window | null = null
    try {
      childWindow = window.open('about:blank', frameName, features)
    } catch (error) {
      console.error('Failed to open auxiliary window:', error)
      return null
    }

    if (!childWindow || !childWindow.document) {
      console.warn('Auxiliary window could not be created or accessed.')
      return null
    }

    // 设置子窗口标题
    childWindow.document.title = `${title} — Pidex Desktop`

    // 深克隆样式表与主题 Class
    const cleanupStyles = syncStylesheets(childWindow.document)

    // 配置基础 DOM 容器结构
    const doc = childWindow.document
    doc.body.style.margin = '0'
    doc.body.style.padding = '0'
    doc.body.style.overflow = 'hidden'
    doc.body.style.height = '100vh'
    doc.body.style.width = '100vw'
    doc.body.style.display = 'flex'
    doc.body.style.flexDirection = 'column'

    const container = doc.createElement('div')
    container.id = 'auxiliary-root'
    container.style.display = 'flex'
    container.style.flexDirection = 'column'
    container.style.flex = '1'
    container.style.minHeight = '0'
    container.style.overflow = 'hidden'
    doc.body.appendChild(container)

    let isDisposed = false

    const dispose = () => {
      if (isDisposed) return
      isDisposed = true
      cleanupStyles()
      childWindow.removeEventListener('unload', onUnload)
      if (!childWindow.closed) {
        try {
          childWindow.close()
        } catch {
          // ignore
        }
      }
      this.windows.delete(tabId)
      this.notifyListeners()
    }

    const onUnload = () => {
      if (isDisposed) return
      isDisposed = true
      cleanupStyles()
      this.windows.delete(tabId)
      this.notifyListeners()
      // 原生子窗口关闭时通知宿主执行安全归并
      this.onDockBackRequested?.(tabId)
    }

    childWindow.addEventListener('unload', onUnload)

    const entry: AuxiliaryWindowEntry = {
      tabId,
      window: childWindow,
      container,
      dispose,
    }

    this.windows.set(tabId, entry)
    this.notifyListeners()
    return entry
  }

  close(tabId: WorkbenchTabId): void {
    const entry = this.windows.get(tabId)
    if (entry) {
      entry.dispose()
    }
  }

  closeAll(): void {
    for (const entry of Array.from(this.windows.values())) {
      entry.dispose()
    }
  }

  subscribe(listener: AuxiliaryWindowListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error('Error in auxiliary window listener:', error)
      }
    }
  }
}

export const auxiliaryWindowService = new AuxiliaryWindowService()
