import type { PetAnimationName } from './PetAnimationModel.js'

export type PetScreenPoint = {
  x: number
  y: number
}

export type PetScreenRect = {
  left: number
  top: number
  width: number
  height: number
}

export type PetLookFrame = {
  columnIndex: number
  rowIndex: 9 | 10
}

const PET_LOOK_SECTOR_DEGREES = 22.5
const PET_LOOK_SECTOR_COUNT = 16
const PET_LOOK_COLUMNS = 8
const PET_LOOK_START_ROW = 9
const PET_LOOK_DEAD_ZONE_PX = 1
const PET_DRAG_DIRECTION_THRESHOLD_PX = 4

export function resolvePetLookFrame(
  mascot: PetScreenRect,
  pointer: PetScreenPoint,
  spriteVersionNumber: 1 | 2,
): PetLookFrame | null {
  if (spriteVersionNumber !== 2) return null
  const deltaX = pointer.x - (mascot.left + mascot.width / 2)
  const deltaY = pointer.y - (mascot.top + mascot.height / 2)
  if (Math.hypot(deltaX, deltaY) <= PET_LOOK_DEAD_ZONE_PX) return null

  const clockwiseDegrees = (Math.atan2(deltaX, -deltaY) * (180 / Math.PI) + 360) % 360
  const sector = Math.round(clockwiseDegrees / PET_LOOK_SECTOR_DEGREES) % PET_LOOK_SECTOR_COUNT

  return {
    columnIndex: sector % PET_LOOK_COLUMNS,
    rowIndex: (PET_LOOK_START_ROW + Math.floor(sector / PET_LOOK_COLUMNS)) as 9 | 10,
  }
}

export function resolvePetDragAnimation(
  current: PetAnimationName,
  deltaX: number,
): PetAnimationName {
  if (deltaX >= PET_DRAG_DIRECTION_THRESHOLD_PX) return 'running-right'
  if (deltaX <= -PET_DRAG_DIRECTION_THRESHOLD_PX) return 'running-left'
  return current
}
