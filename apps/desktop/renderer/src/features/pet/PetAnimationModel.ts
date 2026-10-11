export type PetAnimationName =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review'

export type PetAnimationDefinition = {
  row: number
  durations: readonly number[]
  repeat: number | null
}

export const PET_ANIMATIONS: Record<PetAnimationName, PetAnimationDefinition> = {
  idle: {
    row: 0,
    durations: [1680, 660, 660, 840, 840, 1920],
    repeat: null,
  },
  'running-right': {
    row: 1,
    durations: [120, 120, 120, 120, 120, 120, 120, 220],
    repeat: 3,
  },
  'running-left': {
    row: 2,
    durations: [120, 120, 120, 120, 120, 120, 120, 220],
    repeat: 3,
  },
  waving: {
    row: 3,
    durations: [140, 140, 140, 280],
    repeat: 3,
  },
  jumping: {
    row: 4,
    durations: [140, 140, 140, 140, 280],
    repeat: 3,
  },
  failed: {
    row: 5,
    durations: [140, 140, 140, 140, 140, 140, 140, 240],
    repeat: 3,
  },
  waiting: {
    row: 6,
    durations: [150, 150, 150, 150, 150, 260],
    repeat: 3,
  },
  running: {
    row: 7,
    durations: [120, 120, 120, 120, 120, 220],
    repeat: 3,
  },
  review: {
    row: 8,
    durations: [150, 150, 150, 150, 150, 280],
    repeat: 3,
  },
}
