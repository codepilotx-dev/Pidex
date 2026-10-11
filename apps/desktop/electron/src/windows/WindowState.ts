import { join } from 'node:path'
import {
  DebouncedAtomicJsonWriter,
  clamp,
  intersectionArea,
  isRecord,
  type DesktopWindowBounds,
  type StateLogger as WindowStateLogger,
} from './DebouncedAtomicJsonWriter.js'
import { DEFAULT_PAGE_ZOOM_PERCENT, normalizePageZoomPercent } from './PageZoom.js'

export const MAIN_WINDOW_MIN_WIDTH = 960
export const MAIN_WINDOW_MIN_HEIGHT = 640
const DEFAULT_WINDOW_WIDTH = 1440
const DEFAULT_WINDOW_HEIGHT = 920
const WINDOW_STATE_VERSION = 1
const WINDOW_STATE_WRITE_DELAY_MS = 250

export type { DesktopWindowBounds, WindowStateLogger }

export type DesktopWindowStateV1 = {
  version: 1
  bounds: DesktopWindowBounds
  maximized: boolean
  zoomPercent: number
}

export type DesktopDisplayWorkArea = DesktopWindowBounds

export class WindowStateStore {
  readonly #writer: DebouncedAtomicJsonWriter<DesktopWindowStateV1>

  constructor(
    userDataDirectory: string,
    logger?: WindowStateLogger,
    fileName = 'window-state.json',
  ) {
    this.#writer = new DebouncedAtomicJsonWriter<DesktopWindowStateV1>(
      join(userDataDirectory, fileName),
      WINDOW_STATE_WRITE_DELAY_MS,
      'window-state',
      logger,
    )
  }

  get filePath(): string {
    return this.#writer.filePath
  }

  async load(
    displays: readonly DesktopDisplayWorkArea[],
    primaryDisplay: DesktopDisplayWorkArea,
  ): Promise<DesktopWindowStateV1> {
    return this.#writer.load(
      () => createDefaultWindowState(primaryDisplay),
      (parsed) => normalizeWindowState(parsed, displays, primaryDisplay),
    )
  }

  scheduleSave(state: DesktopWindowStateV1): void {
    this.#writer.scheduleSave(state)
  }

  async flush(): Promise<void> {
    return this.#writer.flush()
  }
}

export function createDefaultWindowState(
  primaryDisplay: DesktopDisplayWorkArea,
): DesktopWindowStateV1 {
  const width = Math.min(DEFAULT_WINDOW_WIDTH, primaryDisplay.width)
  const height = Math.min(DEFAULT_WINDOW_HEIGHT, primaryDisplay.height)
  return {
    version: 1,
    bounds: {
      x: Math.round(primaryDisplay.x + (primaryDisplay.width - width) / 2),
      y: Math.round(primaryDisplay.y + (primaryDisplay.height - height) / 2),
      width,
      height,
    },
    maximized: false,
    zoomPercent: DEFAULT_PAGE_ZOOM_PERCENT,
  }
}

export function normalizeWindowState(
  value: unknown,
  displays: readonly DesktopDisplayWorkArea[],
  primaryDisplay: DesktopDisplayWorkArea,
): DesktopWindowStateV1 {
  if (!isWindowState(value)) return createDefaultWindowState(primaryDisplay)

  const availableDisplays = displays.length > 0 ? displays : [primaryDisplay]
  const targetDisplay = availableDisplays
    .map((display) => ({
      display,
      overlap: intersectionArea(value.bounds, display),
    }))
    .sort((left, right) => right.overlap - left.overlap)[0]

  if (!targetDisplay || targetDisplay.overlap === 0) {
    return {
      ...createDefaultWindowState(primaryDisplay),
      maximized: value.maximized,
      zoomPercent: normalizePageZoomPercent(value.zoomPercent),
    }
  }

  const workArea = targetDisplay.display
  const width = Math.min(
    Math.max(value.bounds.width, Math.min(MAIN_WINDOW_MIN_WIDTH, workArea.width)),
    workArea.width,
  )
  const height = Math.min(
    Math.max(value.bounds.height, Math.min(MAIN_WINDOW_MIN_HEIGHT, workArea.height)),
    workArea.height,
  )
  return {
    version: 1,
    bounds: {
      x: clamp(value.bounds.x, workArea.x, workArea.x + workArea.width - width),
      y: clamp(value.bounds.y, workArea.y, workArea.y + workArea.height - height),
      width,
      height,
    },
    maximized: value.maximized,
    zoomPercent: normalizePageZoomPercent(value.zoomPercent),
  }
}

function isWindowState(value: unknown): value is {
  version: 1
  bounds: DesktopWindowBounds
  maximized: boolean
  zoomPercent?: unknown
} {
  if (!isRecord(value) || value.version !== WINDOW_STATE_VERSION) return false
  if (typeof value.maximized !== 'boolean' || !isRecord(value.bounds)) return false
  const bounds = value.bounds
  return (
    ['x', 'y', 'width', 'height'].every(
      (key) => typeof bounds[key] === 'number' && Number.isFinite(bounds[key]),
    ) &&
    typeof bounds.width === 'number' &&
    typeof bounds.height === 'number' &&
    bounds.width > 0 &&
    bounds.height > 0
  )
}
