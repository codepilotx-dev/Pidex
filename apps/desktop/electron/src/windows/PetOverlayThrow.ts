import type { DesktopPetOverlayBounds } from '@pidex/shared/desktop-pet-overlay'
import type { DesktopDisplayWorkArea } from './WindowState.js'
import { clampPetOverlayBounds } from './PetOverlayWindowState.js'

export const PET_DRAG_THRESHOLD_PX = 4
export const PET_THROW_SAMPLE_WINDOW_MS = 160
export const PET_THROW_RELEASE_THRESHOLD_PX_PER_SECOND = 320
export const PET_THROW_RAW_CAP_PX_PER_SECOND = 1_600
export const PET_THROW_MULTIPLIER = 3
export const PET_THROW_TICK_MS = 8
export const PET_THROW_MAX_FRAME_MS = 32
export const PET_THROW_FRICTION_PER_16_MS = 0.88
export const PET_THROW_BOUNCE_FACTOR = 0.7
export const PET_THROW_STOP_SPEED_PX_PER_SECOND = 65
export const PET_THROW_MAX_DURATION_MS = 900

export type PetThrowSample = {
  x: number
  y: number
  timestampMs: number
}

export type PetThrowVelocity = {
  x: number
  y: number
}

export type PetThrowStep = {
  bounds: DesktopPetOverlayBounds
  velocity: PetThrowVelocity
  stopped: boolean
}

export function estimatePetThrowVelocity(samples: readonly PetThrowSample[]): PetThrowVelocity {
  const valid = samples.filter(isValidSample)
  const last = valid.at(-1)
  if (!last) return stationary()
  const first = valid.find(
    (sample) =>
      sample !== last &&
      sample.timestampMs >= last.timestampMs - PET_THROW_SAMPLE_WINDOW_MS &&
      sample.timestampMs < last.timestampMs,
  )
  if (!first) return stationary()

  const elapsedMs = last.timestampMs - first.timestampMs
  const deltaX = last.x - first.x
  const deltaY = last.y - first.y
  if (Math.hypot(deltaX, deltaY) < PET_DRAG_THRESHOLD_PX) return stationary()

  const rawVelocity = {
    x: (deltaX / elapsedMs) * 1_000,
    y: (deltaY / elapsedMs) * 1_000,
  }
  const rawSpeed = Math.hypot(rawVelocity.x, rawVelocity.y)
  if (rawSpeed < PET_THROW_RELEASE_THRESHOLD_PX_PER_SECOND) {
    return stationary()
  }
  const scale =
    (Math.min(rawSpeed, PET_THROW_RAW_CAP_PX_PER_SECOND) / rawSpeed) * PET_THROW_MULTIPLIER
  return {
    x: rawVelocity.x * scale,
    y: rawVelocity.y * scale,
  }
}

export function advancePetThrow(
  bounds: DesktopPetOverlayBounds,
  velocity: PetThrowVelocity,
  frameElapsedMs: number,
  totalElapsedMs: number,
  workArea: DesktopDisplayWorkArea,
): PetThrowStep {
  const elapsedMs = Number.isFinite(frameElapsedMs)
    ? Math.min(PET_THROW_MAX_FRAME_MS, Math.max(0, frameElapsedMs))
    : 0
  const candidate = {
    ...bounds,
    x: bounds.x + (velocity.x * elapsedMs) / 1_000,
    y: bounds.y + (velocity.y * elapsedMs) / 1_000,
  }
  const clamped = clampPetOverlayBounds(candidate, workArea)
  const damping = PET_THROW_FRICTION_PER_16_MS ** (elapsedMs / 16)
  const hitHorizontalEdge = clamped.x !== Math.round(candidate.x)
  const hitVerticalEdge = clamped.y !== Math.round(candidate.y)
  const nextVelocity = {
    x: velocity.x * damping * (hitHorizontalEdge ? -PET_THROW_BOUNCE_FACTOR : 1),
    y: velocity.y * damping * (hitVerticalEdge ? -PET_THROW_BOUNCE_FACTOR : 1),
  }
  const stopped =
    Math.hypot(nextVelocity.x, nextVelocity.y) < PET_THROW_STOP_SPEED_PX_PER_SECOND ||
    totalElapsedMs >= PET_THROW_MAX_DURATION_MS
  return {
    bounds: clamped,
    velocity: stopped ? stationary() : nextVelocity,
    stopped,
  }
}

function stationary(): PetThrowVelocity {
  return { x: 0, y: 0 }
}

function isValidSample(sample: PetThrowSample): boolean {
  return (
    Number.isFinite(sample.x) && Number.isFinite(sample.y) && Number.isFinite(sample.timestampMs)
  )
}
