import { join } from 'node:path'
import type { DesktopPetOverlayBounds } from '@pidex/shared/desktop-pet-overlay'
import type { DesktopDisplayWorkArea } from './WindowState.js'
import {
  DebouncedAtomicJsonWriter,
  clamp,
  intersectionArea,
  isRecord,
  type StateLogger as Logger,
} from './DebouncedAtomicJsonWriter.js'

export const PET_OVERLAY_WIDTH = 356
export const PET_OVERLAY_HEIGHT = 320
const PET_OVERLAY_MARGIN = 24
const WRITE_DELAY_MS = 250

export type PetOverlayWindowStateV1 = {
  version: 1
  bounds: DesktopPetOverlayBounds
}

export class PetOverlayWindowStateStore {
  readonly #writer: DebouncedAtomicJsonWriter<PetOverlayWindowStateV1>

  constructor(userDataDirectory: string, logger?: Logger) {
    this.#writer = new DebouncedAtomicJsonWriter<PetOverlayWindowStateV1>(
      join(userDataDirectory, 'pet-overlay-window-state.json'),
      WRITE_DELAY_MS,
      'pet-overlay-state',
      logger,
    )
  }

  get filePath(): string {
    return this.#writer.filePath
  }

  async load(
    displays: readonly DesktopDisplayWorkArea[],
    primaryDisplay: DesktopDisplayWorkArea,
  ): Promise<PetOverlayWindowStateV1> {
    return this.#writer.load(
      () => createDefaultPetOverlayWindowState(primaryDisplay),
      (parsed) => normalizePetOverlayWindowState(parsed, displays, primaryDisplay),
    )
  }

  scheduleSave(state: PetOverlayWindowStateV1): void {
    this.#writer.scheduleSave(state)
  }

  async flush(): Promise<void> {
    return this.#writer.flush()
  }
}

export function createDefaultPetOverlayWindowState(
  workArea: DesktopDisplayWorkArea,
): PetOverlayWindowStateV1 {
  return {
    version: 1,
    bounds: {
      x: Math.round(workArea.x + workArea.width - PET_OVERLAY_WIDTH - PET_OVERLAY_MARGIN),
      y: Math.round(workArea.y + workArea.height - PET_OVERLAY_HEIGHT - PET_OVERLAY_MARGIN),
      width: PET_OVERLAY_WIDTH,
      height: PET_OVERLAY_HEIGHT,
    },
  }
}

export function normalizePetOverlayWindowState(
  value: unknown,
  displays: readonly DesktopDisplayWorkArea[],
  primaryDisplay: DesktopDisplayWorkArea,
): PetOverlayWindowStateV1 {
  if (!isState(value)) return createDefaultPetOverlayWindowState(primaryDisplay)
  const available = displays.length ? displays : [primaryDisplay]
  const target = available
    .map((display) => ({ display, overlap: intersectionArea(value.bounds, display) }))
    .sort((left, right) => right.overlap - left.overlap)[0]
  if (!target || target.overlap === 0) {
    return createDefaultPetOverlayWindowState(primaryDisplay)
  }
  return {
    version: 1,
    bounds: clampBounds(value.bounds, target.display),
  }
}

export function clampPetOverlayBounds(
  bounds: DesktopPetOverlayBounds,
  workArea: DesktopDisplayWorkArea,
): DesktopPetOverlayBounds {
  return clampBounds(bounds, workArea)
}

function clampBounds(
  bounds: DesktopPetOverlayBounds,
  workArea: DesktopDisplayWorkArea,
): DesktopPetOverlayBounds {
  const width = Math.min(PET_OVERLAY_WIDTH, workArea.width)
  const height = Math.min(PET_OVERLAY_HEIGHT, workArea.height)
  return {
    x: clamp(bounds.x, workArea.x, workArea.x + workArea.width - width),
    y: clamp(bounds.y, workArea.y, workArea.y + workArea.height - height),
    width,
    height,
  }
}

function isState(value: unknown): value is PetOverlayWindowStateV1 {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.bounds)) {
    return false
  }
  const bounds = value.bounds
  return ['x', 'y', 'width', 'height'].every(
    (key) => typeof bounds[key] === 'number' && Number.isFinite(bounds[key]),
  )
}
