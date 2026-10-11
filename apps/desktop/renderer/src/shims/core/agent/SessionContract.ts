export type CollaborationModeKind = 'default' | 'plan'

export type CollaborationModeSettings = {
  reasoningEffort?: string | null
  developerInstructions?: string | null
}

export type CollaborationMode = {
  mode: CollaborationModeKind
  settings?: CollaborationModeSettings
}

export const DEFAULT_COLLABORATION_MODE: CollaborationMode = {
  mode: 'default',
}

export const PLAN_PIDEX_COLLABORATION_MODE: CollaborationMode = {
  mode: 'plan',
}

export function normalizeCollaborationMode(value: unknown): CollaborationMode {
  if (!value || typeof value !== 'object') return DEFAULT_COLLABORATION_MODE
  const mode = (value as { mode?: unknown }).mode
  return mode === 'plan' ? PLAN_PIDEX_COLLABORATION_MODE : DEFAULT_COLLABORATION_MODE
}

export function planModeActiveFromCollaborationMode(value: unknown): boolean {
  return normalizeCollaborationMode(value).mode === 'plan'
}

export function collaborationModeFromPlanModeActive(
  planModeActive: boolean | undefined,
): CollaborationMode {
  return planModeActive === true ? PLAN_PIDEX_COLLABORATION_MODE : DEFAULT_COLLABORATION_MODE
}

export function resolveCollaborationMode(params: {
  collaborationMode?: unknown
  planModeActive?: boolean
}): CollaborationMode {
  if (params.collaborationMode !== undefined) {
    return normalizeCollaborationMode(params.collaborationMode)
  }
  return collaborationModeFromPlanModeActive(params.planModeActive)
}
