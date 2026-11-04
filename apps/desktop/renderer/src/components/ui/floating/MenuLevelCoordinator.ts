import {
  MENU_OPEN_DELAY_MS,
  MENU_SAFE_RECHECK_MS,
  MENU_SAFE_WINDOW_MS,
  MENU_SUBMENU_CLOSE_DELAY_MS,
  isPointInMenuSafeArea,
  type Point,
  type Rect,
} from './MenuGeometry.js'

export type CandidateKind = 'item' | 'sub'

export interface ActiveBranch {
  id: string
  triggerEl: HTMLElement | null
  contentEl: HTMLElement | null
  side: 'left' | 'right'
  closeTimer: ReturnType<typeof setTimeout> | null
  closeCallback: () => void
  leaveTime: number | null
}

export interface Candidate {
  id: string
  kind: CandidateKind
  startTime: number
  timer: ReturnType<typeof setTimeout> | null
  isSafeSkipped: boolean
  openSubmenu?: () => void
}

export class LevelCoordinator {
  readonly level: number
  parent: LevelCoordinator | null = null
  child: LevelCoordinator | null = null
  surfaceEl: HTMLElement | null = null

  prevPoint: Point | null = null
  currentPoint: Point | null = null

  activeBranch: ActiveBranch | null = null
  candidate: Candidate | null = null

  focusedId: string | null = null
  hoveredId: string | null = null

  private listeners = new Set<() => void>()
  private destroyed = false

  constructor(level: number, parent: LevelCoordinator | null = null) {
    this.level = level
    this.parent = parent
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  mount(): void {
    this.destroyed = false
    if (this.parent) this.parent.child = this
  }

  notify(): void {
    if (this.destroyed) return
    for (const listener of this.listeners) {
      listener()
    }
  }

  setSurfaceEl(el: HTMLElement | null): void {
    this.surfaceEl = el
  }

  recordPointerMove(x: number, y: number): void {
    if (this.destroyed) return
    if (!this.currentPoint) {
      this.currentPoint = { x, y }
      this.prevPoint = { x, y }
    } else if (this.currentPoint.x !== x || this.currentPoint.y !== y) {
      this.prevPoint = this.currentPoint
      this.currentPoint = { x, y }
    }
  }

  hasActiveDescendant(): boolean {
    let curr = this.child
    while (curr) {
      if (curr.activeBranch || curr.hoveredId !== null) {
        return true
      }
      curr = curr.child
    }
    return false
  }

  checkPointInSafeArea(): boolean {
    if (!this.activeBranch || !this.surfaceEl || !this.activeBranch.contentEl) {
      return false
    }
    if (!this.currentPoint || !this.prevPoint) {
      return false
    }
    if (this.currentPoint.x === this.prevPoint.x && this.currentPoint.y === this.prevPoint.y) {
      return false
    }

    const parentRect: Rect = this.surfaceEl.getBoundingClientRect()
    const submenuRect: Rect = this.activeBranch.contentEl.getBoundingClientRect()

    return isPointInMenuSafeArea(
      this.currentPoint,
      this.prevPoint,
      parentRect,
      submenuRect,
      this.activeBranch.side,
    )
  }

  setActiveBranch(
    id: string,
    triggerEl: HTMLElement | null,
    contentEl: HTMLElement | null,
    side: 'left' | 'right',
    closeCallback: () => void,
  ): void {
    if (this.destroyed) return
    if (this.activeBranch && this.activeBranch.id === id) {
      this.activeBranch.triggerEl = triggerEl
      this.activeBranch.contentEl = contentEl
      this.activeBranch.side = side
      this.activeBranch.closeCallback = closeCallback
      return
    }

    // 关闭已有同层分支及其后代
    if (this.activeBranch && this.activeBranch.id !== id) {
      this.closeActiveBranch()
    }

    this.activeBranch = {
      id,
      triggerEl,
      contentEl,
      side,
      closeTimer: null,
      closeCallback,
      leaveTime: null,
    }
    this.hoveredId = id
    this.notify()
  }

  setActiveBranchContent(id: string, contentEl: HTMLElement | null, side: 'left' | 'right'): void {
    if (this.activeBranch && this.activeBranch.id === id) {
      this.activeBranch.contentEl = contentEl
      this.activeBranch.side = side
    }
  }

  clearActiveBranch(id: string): void {
    if (this.activeBranch && this.activeBranch.id === id) {
      this.cancelBranchCloseTimer()
      if (this.child) {
        this.child.closeAll()
      }
      this.activeBranch = null
      if (this.hoveredId === id) {
        this.hoveredId = null
      }
      this.notify()
    }
  }

  closeActiveBranch(): void {
    if (!this.activeBranch) return
    this.cancelBranchCloseTimer()
    const cb = this.activeBranch.closeCallback
    const id = this.activeBranch.id
    if (this.child) {
      this.child.closeAll()
    }
    this.activeBranch = null
    if (this.hoveredId === id) {
      this.hoveredId = null
    }
    cb()
    this.notify()
  }

  cancelBranchCloseTimer(): void {
    if (this.activeBranch?.closeTimer) {
      clearTimeout(this.activeBranch.closeTimer)
      this.activeBranch.closeTimer = null
    }
    if (this.activeBranch) {
      this.activeBranch.leaveTime = null
    }
  }

  startBranchCloseTimer(): void {
    if (!this.activeBranch || this.destroyed) return
    if (this.hasActiveDescendant()) return
    this.cancelBranchCloseTimer()
    this.activeBranch.leaveTime = performance.now()

    this.activeBranch.closeTimer = setTimeout(() => {
      this.onBranchCloseTick()
    }, MENU_SUBMENU_CLOSE_DELAY_MS)
  }

  private onBranchCloseTick(): void {
    if (this.destroyed || !this.activeBranch) return
    if (this.hasActiveDescendant()) return
    const now = performance.now()
    const leaveElapsed = now - (this.activeBranch.leaveTime ?? now)

    // 若仍在安全区且未超过 1200ms 上限，继续按 80ms 复查，否则关闭
    if (this.checkPointInSafeArea() && leaveElapsed < MENU_SAFE_WINDOW_MS) {
      const nextInterval = Math.min(MENU_SAFE_RECHECK_MS, MENU_SAFE_WINDOW_MS - leaveElapsed)
      this.activeBranch.closeTimer = setTimeout(() => {
        this.onBranchCloseTick()
      }, nextInterval)
      return
    }

    this.closeActiveBranch()
  }

  pointerEnterRow(
    id: string,
    kind: CandidateKind,
    triggerEl: HTMLElement | null,
    openSubmenu?: () => void,
  ): void {
    if (this.destroyed) return
    this.focusedId = null

    // 若正好是当前已展开分支的触发行，直接保留并不执行切换
    if (this.activeBranch && this.activeBranch.id === id) {
      this.cancelBranchCloseTimer()
      this.clearCandidate()
      this.hoveredId = id
      this.notify()
      return
    }

    // 若当前同层有展开分支，检查安全区保护
    if (this.activeBranch) {
      if (this.checkPointInSafeArea()) {
        // 在安全区内跨过其他行，保留原分支及其高亮，被跨行不高亮、不展开
        this.clearCandidate()
        const now = performance.now()
        this.candidate = {
          id,
          kind,
          startTime: now,
          timer: null,
          isSafeSkipped: true,
          openSubmenu,
        }
        this.hoveredId = this.activeBranch.id
        this.scheduleSafeRecheck()
        this.notify()
        return
      }
    }

    // 普通悬停立即更新行高亮，停留 220ms 后切换分支
    this.clearCandidate()
    const now = performance.now()
    this.candidate = {
      id,
      kind,
      startTime: now,
      timer: null,
      isSafeSkipped: false,
      openSubmenu,
    }
    this.hoveredId = id

    if (kind === 'sub') {
      this.candidate.timer = setTimeout(() => {
        this.executeCandidate()
      }, MENU_OPEN_DELAY_MS)
    } else if (this.activeBranch) {
      // 悬停普通行时停留 220ms 后关闭该层分支
      this.candidate.timer = setTimeout(() => {
        this.executeCandidate()
      }, MENU_OPEN_DELAY_MS)
    }

    this.notify()
  }

  private scheduleSafeRecheck(): void {
    if (!this.candidate || this.destroyed) return
    if (this.candidate.timer) {
      clearTimeout(this.candidate.timer)
      this.candidate.timer = null
    }

    this.candidate.timer = setTimeout(() => {
      this.onSafeRecheckTick()
    }, MENU_SAFE_RECHECK_MS)
  }

  private onSafeRecheckTick(): void {
    if (!this.candidate || this.destroyed) return
    const now = performance.now()
    const elapsed = now - this.candidate.startTime

    // 1. 达到 1200ms 上限时，执行切换
    if (elapsed >= MENU_SAFE_WINDOW_MS) {
      this.executeCandidate()
      return
    }

    // 2. 检查是否仍在安全区
    if (this.checkPointInSafeArea()) {
      const nextInterval = Math.min(MENU_SAFE_RECHECK_MS, MENU_SAFE_WINDOW_MS - elapsed)
      this.candidate.timer = setTimeout(() => {
        this.onSafeRecheckTick()
      }, nextInterval)
    } else {
      // 离开保护区：若已满足 220ms，立即切换；否则等待剩余时间
      if (elapsed >= MENU_OPEN_DELAY_MS) {
        this.executeCandidate()
      } else {
        this.candidate.isSafeSkipped = false
        this.hoveredId = this.candidate.id
        const remaining = MENU_OPEN_DELAY_MS - elapsed
        this.candidate.timer = setTimeout(() => {
          this.executeCandidate()
        }, remaining)
        this.notify()
      }
    }
  }

  executeCandidate(): void {
    if (!this.candidate || this.destroyed) return
    this.cancelBranchCloseTimer()
    const { id, kind, openSubmenu } = this.candidate
    this.clearCandidate()

    this.hoveredId = id
    if (kind === 'sub') {
      if (this.activeBranch && this.activeBranch.id !== id) {
        this.closeActiveBranch()
      }
      openSubmenu?.()
    } else if (kind === 'item') {
      if (this.activeBranch) {
        this.closeActiveBranch()
      }
    }
    this.notify()
  }

  pointerLeaveRow(id: string): void {
    if (this.destroyed) return
    // 候选行提前离行取消
    if (this.candidate && this.candidate.id === id) {
      this.clearCandidate()
      if (this.hoveredId === id) {
        this.hoveredId = this.activeBranch ? this.activeBranch.id : null
      }
      this.notify()
      return
    }

    // 离开已打开分支的触发行，开启关闭缓冲计时
    if (this.activeBranch && this.activeBranch.id === id) {
      this.startBranchCloseTimer()
    }
  }

  onSubmenuContentEnter(): void {
    // 进入目标子菜单立即清除父层及所有祖先的待切换操作、保护和关闭计时
    this.cancelBranchCloseTimer()
    this.clearCandidate()
    if (this.activeBranch) {
      this.hoveredId = this.activeBranch.id
    }
    let p = this.parent
    while (p) {
      p.cancelBranchCloseTimer()
      p.clearCandidate()
      p = p.parent
    }
    this.notify()
  }

  onSubmenuContentLeave(): void {
    // 离开目标子菜单开启关闭缓冲计时
    this.startBranchCloseTimer()
  }

  clearCandidate(): void {
    if (this.candidate?.timer) {
      clearTimeout(this.candidate.timer)
    }
    this.candidate = null
  }

  onItemClick(_id: string): void {
    this.clearCandidate()
    this.cancelBranchCloseTimer()
  }

  onKeyDown(_event: React.KeyboardEvent): void {
    this.clearCandidate()
    this.cancelBranchCloseTimer()
  }

  onSubTriggerClick(id: string, _open: boolean, toggle: () => void): void {
    this.clearCandidate()
    this.cancelBranchCloseTimer()
    toggle()
  }

  onItemFocus(id: string): void {
    this.clearCandidate()
    this.focusedId = id
    this.hoveredId = null
    this.notify()
  }

  onItemBlur(id: string): void {
    if (this.focusedId === id) {
      this.focusedId = null
      this.notify()
    }
  }

  isItemHighlighted(id: string): boolean {
    if (this.focusedId === id) return true
    if (this.candidate && this.candidate.id === id) {
      return !this.candidate.isSafeSkipped
    }
    if (this.activeBranch && this.activeBranch.id === id) {
      return true
    }
    return this.hoveredId === id
  }

  isItemSafeSkipped(id: string): boolean {
    return Boolean(this.candidate && this.candidate.id === id && this.candidate.isSafeSkipped)
  }

  closeAll(): void {
    this.clearCandidate()
    this.cancelBranchCloseTimer()
    if (this.activeBranch) {
      const cb = this.activeBranch.closeCallback
      this.activeBranch = null
      cb()
    }
    if (this.child) {
      this.child.closeAll()
    }
    this.focusedId = null
    this.hoveredId = null
    this.notify()
  }

  destroy(): void {
    this.destroyed = true
    this.clearCandidate()
    this.cancelBranchCloseTimer()
    if (this.parent && this.parent.child === this) {
      this.parent.child = null
    }
    if (this.child) {
      this.child.destroy()
      this.child = null
    }
    this.listeners.clear()
  }
}
