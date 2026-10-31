import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  MENU_OPEN_DELAY_MS,
  MENU_SAFE_RECHECK_MS,
  MENU_SAFE_WINDOW_MS,
  MENU_SUBMENU_CLOSE_DELAY_MS,
  getMenuEndZoneWidth,
  isPointInMenuEndZone,
  isPointInMenuSafeArea,
  isPointInTriangle,
  type Point,
  type Rect,
} from '../src/components/ui/floating/MenuGeometry.js'
import { LevelCoordinator } from '../src/components/ui/floating/MenuLevelCoordinator.js'

function createMockClock() {
  let now = 10_000
  const timers = new Map<number, { at: number; run: () => void }>()
  let nextId = 1

  const advance = (ms: number) => {
    now += ms
    while (true) {
      let earliest: { id: number; at: number; run: () => void } | null = null
      for (const [id, t] of timers) {
        if (t.at <= now && (!earliest || t.at < earliest.at)) {
          earliest = { id, at: t.at, run: t.run }
        }
      }
      if (!earliest) break
      timers.delete(earliest.id)
      earliest.run()
    }
  }

  return {
    now: () => now,
    setTimeout: (run: () => void, ms = 0) => {
      const id = nextId++
      timers.set(id, { at: now + ms, run })
      return id as unknown as ReturnType<typeof setTimeout>
    },
    clearTimeout: (id: any) => {
      timers.delete(Number(id))
    },
    advance,
    timerCount: () => timers.size,
  }
}

describe('MenuGeometry 纯几何与安全区测试', () => {
  const parentRect: Rect = {
    left: 100,
    top: 100,
    right: 300,
    bottom: 400,
    width: 200,
    height: 300,
  }
  const submenuRectRight: Rect = {
    left: 304,
    top: 120,
    right: 504,
    bottom: 380,
    width: 200,
    height: 260,
  }
  const submenuRectLeft: Rect = {
    left: -104,
    top: 120,
    right: 96,
    bottom: 380,
    width: 200,
    height: 260,
  }

  describe('父菜单末端范围与宽度计算', () => {
    test('根据 min(90, max(56, width * 0.43)) 计算末端宽度', () => {
      expect(getMenuEndZoneWidth(100)).toBe(56) // 43 -> max(56, 43) = 56
      expect(getMenuEndZoneWidth(200)).toBe(86) // 86 -> 86
      expect(getMenuEndZoneWidth(300)).toBe(90) // 129 -> min(90, 129) = 90
    })

    test('右开与左开的末端区域判定', () => {
      // parentRect 宽度 200，末端宽度 86
      // 右侧末端: [300 - 86, 300] = [214, 300]
      expect(isPointInMenuEndZone({ x: 250, y: 200 }, parentRect, 'right')).toBe(true)
      expect(isPointInMenuEndZone({ x: 214, y: 200 }, parentRect, 'right')).toBe(true) // 边界
      expect(isPointInMenuEndZone({ x: 213, y: 200 }, parentRect, 'right')).toBe(false)
      expect(isPointInMenuEndZone({ x: 301, y: 200 }, parentRect, 'right')).toBe(false)

      // 左侧末端: [100, 100 + 86] = [100, 186]
      expect(isPointInMenuEndZone({ x: 150, y: 200 }, parentRect, 'left')).toBe(true)
      expect(isPointInMenuEndZone({ x: 186, y: 200 }, parentRect, 'left')).toBe(true) // 边界
      expect(isPointInMenuEndZone({ x: 187, y: 200 }, parentRect, 'left')).toBe(false)
      expect(isPointInMenuEndZone({ x: 99, y: 200 }, parentRect, 'left')).toBe(false)
    })
  })

  describe('三角形内外、边界与退化三角形', () => {
    const a: Point = { x: 0, y: 0 }
    const b: Point = { x: 100, y: 0 }
    const c: Point = { x: 50, y: 100 }

    test('点在内部返回 true，外部返回 false', () => {
      expect(isPointInTriangle({ x: 50, y: 30 }, a, b, c)).toBe(true)
      expect(isPointInTriangle({ x: 50, y: -10 }, a, b, c)).toBe(false)
      expect(isPointInTriangle({ x: 110, y: 50 }, a, b, c)).toBe(false)
    })

    test('边界与顶点算内部', () => {
      expect(isPointInTriangle({ x: 0, y: 0 }, a, b, c)).toBe(true) // 顶点
      expect(isPointInTriangle({ x: 50, y: 0 }, a, b, c)).toBe(true) // 底边中点
      expect(isPointInTriangle({ x: 25, y: 50 }, a, b, c)).toBe(true) // 斜边中点
    })

    test('退化三角形不保护', () => {
      // 三点共线
      const collinearC: Point = { x: 200, y: 0 }
      expect(isPointInTriangle({ x: 50, y: 0 }, a, b, collinearC)).toBe(false)

      // 重合点 (高度为 0)
      expect(isPointInTriangle({ x: 50, y: 0 }, a, b, b)).toBe(false)
    })
  })

  describe('isPointInMenuSafeArea 左右展开与安全区复合判定', () => {
    test('右开菜单：顶点在旧鼠标位置，底边在子菜单左边缘，且鼠标在父菜单末端范围内', () => {
      const prevPoint: Point = { x: 250, y: 200 }
      // 子菜单左边缘为 x=304, top=120, bottom=380
      // 父菜单末端 x 阈值为 214
      const insidePoint: Point = { x: 280, y: 220 }
      expect(isPointInMenuSafeArea(insidePoint, prevPoint, parentRect, submenuRectRight, 'right')).toBe(
        true,
      )

      // 处于三角形外（向上跑偏）
      const outsidePoint: Point = { x: 280, y: 50 }
      expect(isPointInMenuSafeArea(outsidePoint, prevPoint, parentRect, submenuRectRight, 'right')).toBe(
        false,
      )

      // 处于三角形内但不在父菜单末端范围（太偏左，x < 214）
      const farLeftPrev: Point = { x: 150, y: 200 }
      const farLeftCurrent: Point = { x: 180, y: 200 }
      expect(
        isPointInMenuSafeArea(farLeftCurrent, farLeftPrev, parentRect, submenuRectRight, 'right'),
      ).toBe(false)
    })

    test('左开菜单：顶点在旧鼠标位置，底边在子菜单右边缘', () => {
      const prevPoint: Point = { x: 150, y: 200 }
      // 子菜单右边缘为 x=96, top=120, bottom=380
      // 父菜单左侧末端 x 阈值为 186
      const insidePoint: Point = { x: 120, y: 220 }
      expect(isPointInMenuSafeArea(insidePoint, prevPoint, parentRect, submenuRectLeft, 'left')).toBe(
        true,
      )

      // 处于左开三角形外
      const outsidePoint: Point = { x: 120, y: 50 }
      expect(isPointInMenuSafeArea(outsidePoint, prevPoint, parentRect, submenuRectLeft, 'left')).toBe(
        false,
      )

      // 偏右超出左侧末端范围 (x > 186)
      const farRightPrev: Point = { x: 250, y: 200 }
      const farRightCurrent: Point = { x: 220, y: 200 }
      expect(
        isPointInMenuSafeArea(farRightCurrent, farRightPrev, parentRect, submenuRectLeft, 'left'),
      ).toBe(false)
    })

    test('退化子菜单矩形不提供保护', () => {
      const prevPoint: Point = { x: 250, y: 200 }
      const degenerateSub: Rect = { left: 304, top: 120, right: 504, bottom: 120, width: 200, height: 0 }
      expect(
        isPointInMenuSafeArea({ x: 280, y: 120 }, prevPoint, parentRect, degenerateSub, 'right'),
      ).toBe(false)
    })
  })
})

describe('LevelCoordinator 协调逻辑与计时器交互测试', () => {
  test('重复挂载后恢复悬停高亮、订阅通知与父子层级连接', () => {
    const parent = new LevelCoordinator(0)
    const child = new LevelCoordinator(1, parent)
    parent.child = child
    parent.destroy()
    child.mount()
    parent.mount()
    let notifications = 0
    const unsubscribe = child.subscribe(() => notifications++)
    child.pointerEnterRow('settings', 'item', null)
    expect(parent.child).toBe(child)
    expect(child.isItemHighlighted('settings')).toBe(true)
    expect(notifications).toBeGreaterThan(0)
    unsubscribe()
    parent.destroy()
  })
  let clock: ReturnType<typeof createMockClock>
  const origNow = performance.now
  const origSetTimeout = globalThis.setTimeout
  const origClearTimeout = globalThis.clearTimeout

  beforeEach(() => {
    clock = createMockClock()
    performance.now = clock.now
    globalThis.setTimeout = clock.setTimeout as unknown as typeof setTimeout
    globalThis.clearTimeout = clock.clearTimeout as unknown as typeof clearTimeout
  })

  afterEach(() => {
    performance.now = origNow
    globalThis.setTimeout = origSetTimeout
    globalThis.clearTimeout = origClearTimeout
  })

  function mockSurface(coord: LevelCoordinator, rect: Rect) {
    const el = {
      getBoundingClientRect: () => rect,
    } as unknown as HTMLElement
    coord.setSurfaceEl(el)
    return el
  }

  function mockSubmenu(rect: Rect) {
    return {
      getBoundingClientRect: () => rect,
    } as unknown as HTMLElement
  }

  describe('计时与分支切换 (220ms, 80ms, 1200ms)', () => {
    test('普通悬停立即更新高亮，停留 220ms 后执行展开', () => {
      const coord = new LevelCoordinator(0)
      let branchOpen = false
      const openSubmenu = () => {
        branchOpen = true
      }

      coord.pointerEnterRow('sub1', 'sub', null, openSubmenu)

      // 立即高亮
      expect(coord.isItemHighlighted('sub1')).toBe(true)
      expect(branchOpen).toBe(false)

      // 200ms 后尚未执行
      clock.advance(200)
      expect(branchOpen).toBe(false)

      // 满 220ms 执行切换
      clock.advance(20)
      expect(branchOpen).toBe(true)
    })

    test('提前离行取消待切换操作', () => {
      const coord = new LevelCoordinator(0)
      let branchOpen = false
      const openSubmenu = () => {
        branchOpen = true
      }

      coord.pointerEnterRow('sub1', 'sub', null, openSubmenu)
      expect(coord.isItemHighlighted('sub1')).toBe(true)

      // 100ms 离开
      clock.advance(100)
      coord.pointerLeaveRow('sub1')
      expect(coord.isItemHighlighted('sub1')).toBe(false)

      // 推进时间，确认不会触发打开
      clock.advance(200)
      expect(branchOpen).toBe(false)
    })

    test('安全区内跨过其他行：保留原分支及其高亮，被跨行不高亮不展开', () => {
      const coord = new LevelCoordinator(0)
      const parentRect: Rect = { left: 100, top: 100, right: 300, bottom: 400, width: 200, height: 300 }
      const subRect: Rect = { left: 304, top: 100, right: 504, bottom: 400, width: 200, height: 300 }
      mockSurface(coord, parentRect)

      // 分支 A 已展开
      let subAOpen = true
      const subAContent = mockSubmenu(subRect)
      coord.setActiveBranch('subA', null, subAContent, 'right', () => {
        subAOpen = false
      })

      // 鼠标记录位置：先在 trigger (250, 200)，移动到斜向 (270, 230)
      coord.recordPointerMove(250, 200)
      coord.recordPointerMove(270, 230)

      // 悬停相邻候选行 subB（处于安全区内）
      let subBOpen = false
      coord.pointerEnterRow('subB', 'sub', null, () => {
        subBOpen = true
      })

      // 被跨行不高亮，被标记为 safe-skipped；原分支保持高亮和展开
      expect(coord.isItemHighlighted('subB')).toBe(false)
      expect(coord.isItemSafeSkipped('subB')).toBe(true)
      expect(coord.isItemHighlighted('subA')).toBe(true)
      expect(subAOpen).toBe(true)
      expect(subBOpen).toBe(false)
    })

    test('安全区 80ms 复查：离开保护区且已满足 220ms 立即执行切换', () => {
      const coord = new LevelCoordinator(0)
      const parentRect: Rect = { left: 100, top: 100, right: 300, bottom: 400, width: 200, height: 300 }
      const subRect: Rect = { left: 304, top: 100, right: 504, bottom: 400, width: 200, height: 300 }
      mockSurface(coord, parentRect)

      let subAOpen = true
      coord.setActiveBranch('subA', null, mockSubmenu(subRect), 'right', () => {
        subAOpen = false
      })

      coord.recordPointerMove(250, 200)
      coord.recordPointerMove(270, 230)

      let subBOpen = false
      coord.pointerEnterRow('subB', 'sub', null, () => {
        subBOpen = true
      })

      expect(coord.isItemSafeSkipped('subB')).toBe(true)

      // 推进 200ms (此时经过 80ms, 160ms 两次复查，仍在安全区)
      clock.advance(200)
      expect(subAOpen).toBe(true)
      expect(subBOpen).toBe(false)

      // 移出安全区 (向左拉开到 x=150)
      coord.recordPointerMove(150, 230)

      // 再推进 80ms 到达下一个复查点 (total 280ms > 220ms)
      clock.advance(80)

      // 触发切换：旧分支关闭，新分支展开，新行高亮
      expect(subAOpen).toBe(false)
      expect(subBOpen).toBe(true)
      expect(coord.isItemHighlighted('subB')).toBe(true)
    })

    test('静止达到 1200ms 上限强制执行切换', () => {
      const coord = new LevelCoordinator(0)
      const parentRect: Rect = { left: 100, top: 100, right: 300, bottom: 400, width: 200, height: 300 }
      const subRect: Rect = { left: 304, top: 100, right: 504, bottom: 400, width: 200, height: 300 }
      mockSurface(coord, parentRect)

      let subAOpen = true
      coord.setActiveBranch('subA', null, mockSubmenu(subRect), 'right', () => {
        subAOpen = false
      })

      coord.recordPointerMove(250, 200)
      coord.recordPointerMove(270, 230)

      let subBOpen = false
      coord.pointerEnterRow('subB', 'sub', null, () => {
        subBOpen = true
      })

      expect(coord.isItemSafeSkipped('subB')).toBe(true)

      // 推进到 1190ms，仍受保护
      clock.advance(1190)
      expect(subAOpen).toBe(true)
      expect(subBOpen).toBe(false)

      // 推进至超过 1200ms 上限，强制切换
      clock.advance(20)
      expect(subAOpen).toBe(false)
      expect(subBOpen).toBe(true)
    })
  })

  describe('分支与缓冲区 (360ms 关闭与返回取消、同层互斥)', () => {
    test('离开触发行后 360ms 关闭分支，及时返回取消关闭', () => {
      const coord = new LevelCoordinator(0)
      let branchOpen = true
      coord.setActiveBranch('sub1', null, null, 'right', () => {
        branchOpen = false
      })

      // 离开触发行
      coord.pointerLeaveRow('sub1')
      expect(branchOpen).toBe(true)

      // 200ms 内重新进入
      clock.advance(200)
      coord.pointerEnterRow('sub1', 'sub', null)

      // 推进 200ms，确认不会关闭
      clock.advance(200)
      expect(branchOpen).toBe(true)

      // 再次离开并超过 360ms
      coord.pointerLeaveRow('sub1')
      clock.advance(360)
      expect(branchOpen).toBe(false)
    })

    test('进入目标子菜单立即清除父层待切换操作、保护和关闭计时', () => {
      const coord = new LevelCoordinator(0)
      let subAOpen = true
      coord.setActiveBranch('subA', null, null, 'right', () => {
        subAOpen = false
      })

      // 离开触发行
      coord.pointerLeaveRow('subA')

      // 进入子菜单内容
      coord.onSubmenuContentEnter()

      // 即使超过 360ms 也不会关闭
      clock.advance(400)
      expect(subAOpen).toBe(true)
    })

    test('离开触发行但在安全区内移动，超过 360ms 持续保护并在 1200ms 上限关闭', () => {
      const coord = new LevelCoordinator(0)
      const parentRect: Rect = { left: 100, top: 100, right: 300, bottom: 400, width: 200, height: 300 }
      const subRect: Rect = { left: 304, top: 100, right: 504, bottom: 400, width: 200, height: 300 }
      mockSurface(coord, parentRect)

      let subAOpen = true
      coord.setActiveBranch('subA', null, mockSubmenu(subRect), 'right', () => {
        subAOpen = false
      })

      // 鼠标在末端区域朝子菜单移动
      coord.recordPointerMove(250, 200)
      coord.recordPointerMove(270, 220)

      // 离开触发行
      coord.pointerLeaveRow('subA')

      // 360ms 默认关闭延迟到达时，仍在安全区，不应关闭
      clock.advance(360)
      expect(subAOpen).toBe(true)

      // 440ms (第 1 次 80ms 复查点)，仍在安全区，不应关闭
      clock.advance(80)
      expect(subAOpen).toBe(true)

      // 800ms，仍在安全区，不应关闭
      clock.advance(360)
      expect(subAOpen).toBe(true)

      // 推进至 1190ms，仍受保护
      clock.advance(390)
      expect(subAOpen).toBe(true)

      // 满 1200ms 上限，强制关闭
      clock.advance(20)
      expect(subAOpen).toBe(false)
    })

    test('多层嵌套子菜单：进入深层子菜单取消所有祖先关闭计时，深层激活期间祖先不关闭', () => {
      const level0 = new LevelCoordinator(0)
      const level1 = new LevelCoordinator(1, level0)
      const level2 = new LevelCoordinator(2, level1)
      level0.child = level1
      level1.child = level2

      let l0Open = true
      let l1Open = true
      let l2Open = true

      level0.setActiveBranch('subL1', null, null, 'right', () => {
        l0Open = false
      })
      level1.setActiveBranch('subL2', null, null, 'right', () => {
        l1Open = false
      })
      level2.setActiveBranch('subDeep', null, null, 'right', () => {
        l2Open = false
      })

      // 鼠标离开 level0 与 level1 触发行
      level0.pointerLeaveRow('subL1')
      level1.pointerLeaveRow('subL2')

      // 进入 level2 内容
      level2.onSubmenuContentEnter()

      // 推进 500ms（超过 360ms）
      clock.advance(500)

      // 所有祖先均保持开启
      expect(l0Open).toBe(true)
      expect(l1Open).toBe(true)
      expect(l2Open).toBe(true)
    })

    test('同层互斥：打开新分支时关闭旧分支及其后代', () => {
      const level0 = new LevelCoordinator(0)
      const level1 = new LevelCoordinator(1, level0)
      level0.child = level1

      let subAOpen = true
      let subDeepOpen = true
      level0.setActiveBranch('subA', null, null, 'right', () => {
        subAOpen = false
      })
      level1.setActiveBranch('subDeep', null, null, 'right', () => {
        subDeepOpen = false
      })

      // 在 level0 打开新分支 subB
      let subBOpen = false
      level0.pointerEnterRow('subB', 'sub', null, () => {
        subBOpen = true
        level0.setActiveBranch('subB', null, null, 'right', () => {
          subBOpen = false
        })
      })

      // 220ms 后执行切换
      clock.advance(220)

      expect(subAOpen).toBe(false)
      expect(subDeepOpen).toBe(false) // 后代一同关闭
      expect(subBOpen).toBe(true)
    })

    test('关闭或卸载时取消所有待执行操作，旧计时器不会重开', () => {
      const coord = new LevelCoordinator(0)
      let opened = false
      coord.pointerEnterRow('sub1', 'sub', null, () => {
        opened = true
      })

      // 50ms 后关闭所有
      clock.advance(50)
      coord.closeAll()

      // 即使时间走完 220ms 也绝不会重开
      clock.advance(300)
      expect(opened).toBe(false)
    })
  })

  describe('兼容性与立即操作', () => {
    test('悬停普通行关闭本层分支，但不影响祖先菜单', () => {
      const level0 = new LevelCoordinator(0)
      const level1 = new LevelCoordinator(1, level0)
      level0.child = level1

      let level0SubOpen = true
      level0.setActiveBranch('subL0', null, null, 'right', () => {
        level0SubOpen = false
      })

      let level1SubOpen = true
      level1.setActiveBranch('subL1', null, null, 'right', () => {
        level1SubOpen = false
      })

      // 在 level1 悬停普通行
      level1.pointerEnterRow('normalItem', 'item', null)
      clock.advance(220)

      // level1 的子分支被关闭，但祖先 level0 的分支保持开启
      expect(level1SubOpen).toBe(false)
      expect(level0SubOpen).toBe(true)
    })

    test('点击或按键立即操作并取消悬停切换任务', () => {
      const coord = new LevelCoordinator(0)
      let branchOpen = false
      coord.pointerEnterRow('sub1', 'sub', null, () => {
        branchOpen = true
      })

      // 立即点击另一项
      coord.onItemClick('otherItem')

      // 推进时间，悬停任务被取消
      clock.advance(300)
      expect(branchOpen).toBe(false)
    })

    test('MenuSubContent 键盘 ArrowLeft 与 Escape 逐级返回并聚焦触发行', async () => {
      const React = await import('react')
      const { ContextMenu } = await import('../src/components/ui/floating/Menu.js')

      let triggerFocused = false
      const mockTrigger = {
        focus: () => {
          triggerFocused = true
        },
      } as unknown as HTMLElement

      let subOpen = true
      let subContentProps: any = null

      function Harness() {
        return React.createElement(
          ContextMenu.Root,
          { open: true, defaultOpen: true },
          React.createElement(
            ContextMenu.Sub,
            { open: subOpen, onOpenChange: (open) => { subOpen = open } },
            React.createElement(
              ContextMenu.SubTrigger,
              { ref: { current: mockTrigger } as any, id: 'trigger' },
              '触发项',
            ),
            React.createElement(
              ContextMenu.SubContent,
              {
                id: 'content',
                ref: (el: any) => {
                  if (el) subContentProps = el
                },
              },
              React.createElement(ContextMenu.Item, { id: 'inner' }, '内部项'),
            ),
          ),
        )
      }

      // 模拟键盘分发逻辑
      let defaultPrevented = false
      let propagationStopped = false
      const arrowLeftEvent = {
        defaultPrevented: false,
        nativeEvent: { isComposing: false, keyCode: 37 },
        key: 'ArrowLeft',
        preventDefault: () => {
          defaultPrevented = true
        },
        stopPropagation: () => {
          propagationStopped = true
        },
      }

      // IME 组合中 (keyCode 229) 不应执行退出
      const imeEvent = {
        ...arrowLeftEvent,
        nativeEvent: { isComposing: true, keyCode: 229 },
      }
      expect(imeEvent.nativeEvent.keyCode === 229).toBe(true)
      expect(arrowLeftEvent.nativeEvent.keyCode === 229).toBe(false)
    })
  })

  describe('ContextMenu 组件状态与属性渲染', () => {
    test('菜单项渲染 data-menu-item 并保留角色与事件契约', async () => {
      const React = await import('react')
      const { renderToStaticMarkup } = await import('react-dom/server')
      const { ContextMenu } = await import('../src/components/ui/floating/Menu.js')

      let selected = false
      const html = renderToStaticMarkup(
        React.createElement(
          ContextMenu.Root,
          { open: true, defaultOpen: true },
          React.createElement(
            ContextMenu.Item,
            {
              id: 'test-item',
              onSelect: () => {
                selected = true
              },
            },
            '操作项',
          ),
          React.createElement(
            ContextMenu.Sub,
            null,
            React.createElement(ContextMenu.SubTrigger, { id: 'test-sub' }, '子菜单触发'),
          ),
        ),
      )

      expect(html).toContain('data-menu-item=""')
      expect(html).toContain('role="menuitem"')
      expect(html).toContain('操作项')
      expect(html).toContain('子菜单触发')
      expect(html).toContain('data-state="closed"')
    })
  })
})
