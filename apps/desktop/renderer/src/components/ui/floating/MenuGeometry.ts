export const MENU_OPEN_DELAY_MS = 220
export const MENU_SAFE_RECHECK_MS = 80
export const MENU_SAFE_WINDOW_MS = 1200
export const MENU_SUBMENU_CLOSE_DELAY_MS = 360

export type Point = { x: number; y: number }
export type Rect = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/**
 * 父菜单末端靠近子菜单一侧的保护区域宽度：
 * min(90px, max(56px, 父菜单宽度 × 43%))
 */
export function getMenuEndZoneWidth(parentWidth: number): number {
  return Math.min(90, Math.max(56, parentWidth * 0.43))
}

/**
 * 使用三条边叉积的符号判断点是否位于三角形内；
 * 边界算内部，退化三角形不保护（面积为 0 或共线点直接返回 false）。
 */
export function isPointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  // area2 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const area2 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  if (Math.abs(area2) <= 1e-7) {
    return false
  }

  const c1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
  const c2 = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x)
  const c3 = (a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x)

  // 边界算内部：允许叉积为 0
  const hasNegative = c1 < -1e-7 || c2 < -1e-7 || c3 < -1e-7
  const hasPositive = c1 > 1e-7 || c2 > 1e-7 || c3 > 1e-7

  return !(hasNegative && hasPositive)
}

/**
 * 校验点是否位于父菜单靠近子菜单一侧的末端区域
 */
export function isPointInMenuEndZone(
  point: Point,
  parentRect: Rect,
  side: 'left' | 'right' = 'right',
): boolean {
  const width = getMenuEndZoneWidth(parentRect.width)
  if (side === 'right') {
    return (
      point.x >= parentRect.right - width &&
      point.x <= parentRect.right &&
      point.y >= parentRect.top &&
      point.y <= parentRect.bottom
    )
  }
  return (
    point.x >= parentRect.left &&
    point.x <= parentRect.left + width &&
    point.y >= parentRect.top &&
    point.y <= parentRect.bottom
  )
}

/**
 * 安全区几何判定：
 * 1. 记录最近两个鼠标位置，使用较旧位置作为三角形顶点，目标为已打开子菜单近侧边缘的上下角。
 * 2. 使用三条边叉积的符号判断点是否位于三角形内；边界算内部，退化三角形不保护。
 * 3. 同时要求鼠标位于父菜单靠近子菜单一侧的末端区域（包含向子菜单过渡的区域）。
 * 4. 使用实际定位方向：右开取子菜单左边缘，左开取右边缘。
 */
export function isPointInMenuSafeArea(
  currentPoint: Point,
  prevPoint: Point,
  parentRect: Rect,
  submenuRect: Rect,
  side: 'left' | 'right' = 'right',
): boolean {
  if (
    parentRect.width <= 0 ||
    parentRect.height <= 0 ||
    submenuRect.width <= 0 ||
    submenuRect.height <= 0
  ) {
    return false
  }

  // 右开取子菜单左边缘，左开取右边缘
  const nearX = side === 'right' ? submenuRect.left : submenuRect.right
  const cornerTop: Point = { x: nearX, y: submenuRect.top }
  const cornerBottom: Point = { x: nearX, y: submenuRect.bottom }

  if (!isPointInTriangle(currentPoint, prevPoint, cornerTop, cornerBottom)) {
    return false
  }

  const endZoneWidth = getMenuEndZoneWidth(parentRect.width)
  if (side === 'right') {
    // 鼠标位于父菜单靠近子菜单一侧的末端区域（宽度为 min(90px, max(56px, 父菜单宽度 × 43%))）
    if (currentPoint.x < parentRect.right - endZoneWidth) {
      return false
    }
  } else {
    if (currentPoint.x > parentRect.left + endZoneWidth) {
      return false
    }
  }

  return true
}
