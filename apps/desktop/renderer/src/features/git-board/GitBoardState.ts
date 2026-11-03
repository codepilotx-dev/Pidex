import { isRecord } from '@pidex/shared/guards'

export const GIT_BOARD_STORAGE_KEY = 'pidex.desktop.gitBoard.v1'
export type GitBoardGroup = { id: string; name: string; projectIds: string[]; collapsed: boolean }
export type GitBoardState = {
  quickProjectIds: string[]
  quickCollapsed: boolean
  groups: GitBoardGroup[]
}

export function defaultGitBoardState(): GitBoardState {
  return { quickProjectIds: [], quickCollapsed: false, groups: [] }
}

function projectIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))]
    : []
}

export function parseGitBoardState(raw: string | null): GitBoardState {
  if (!raw) return defaultGitBoardState()
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || !Array.isArray(value.groups)) return defaultGitBoardState()
    const groups: GitBoardGroup[] = []
    for (const group of value.groups) {
      if (
        !isRecord(group) ||
        typeof group.id !== 'string' ||
        !group.id ||
        typeof group.name !== 'string' ||
        !group.name.trim() ||
        !Array.isArray(group.projectIds) ||
        groups.some((existing) => existing.id === group.id)
      )
        continue
      groups.push({
        id: group.id,
        name: group.name,
        projectIds: projectIds(group.projectIds),
        collapsed: group.collapsed === true,
      })
    }
    const legacy = !Array.isArray(value.quickProjectIds)
    const previous =
      groups.find((group) => group.id === 'default') ??
      groups.find((group) => group.id === value.activeGroupId)
    return {
      quickProjectIds: legacy ? (previous?.projectIds ?? []) : projectIds(value.quickProjectIds),
      quickCollapsed: value.quickCollapsed === true,
      groups: legacy ? groups.filter((group) => group.id !== 'default') : groups,
    }
  } catch {
    return defaultGitBoardState()
  }
}

export function toggleGitBoardQuickView(state: GitBoardState, projectId: string): GitBoardState {
  return {
    ...state,
    quickProjectIds: state.quickProjectIds.includes(projectId)
      ? state.quickProjectIds.filter((id) => id !== projectId)
      : [...state.quickProjectIds, projectId],
  }
}

export function toggleGitBoardGroupProject(
  state: GitBoardState,
  groupId: string,
  projectId: string,
): GitBoardState {
  return {
    ...state,
    groups: state.groups.map((group) =>
      group.id !== groupId
        ? group
        : {
            ...group,
            projectIds: group.projectIds.includes(projectId)
              ? group.projectIds.filter((id) => id !== projectId)
              : [...group.projectIds, projectId],
          },
    ),
  }
}

export function addGitBoardGroup(
  state: GitBoardState,
  id: string,
  name: string,
  projectId?: string,
): GitBoardState {
  return {
    ...state,
    groups: [
      ...state.groups,
      { id, name, projectIds: projectId ? [projectId] : [], collapsed: false },
    ],
  }
}

export function deleteGitBoardGroup(state: GitBoardState, id: string): GitBoardState {
  return { ...state, groups: state.groups.filter((group) => group.id !== id) }
}

export function gitBoardView(state: GitBoardState, activeGroupId: string | null) {
  return (
    state.groups.find((group) => group.id === activeGroupId) ?? {
      id: null,
      name: '速览',
      projectIds: state.quickProjectIds,
    }
  )
}
