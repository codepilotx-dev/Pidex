import type { DesktopWorkspace } from '../../../shared/Types.js'

export function sortEnvironmentProjects(projects: readonly DesktopWorkspace[]): DesktopWorkspace[] {
  return [...projects].sort((left, right) => {
    const recent = timestamp(right.lastOpenedAt) - timestamp(left.lastOpenedAt)
    if (recent !== 0) return recent
    return left.name.localeCompare(right.name, 'zh-CN')
  })
}

export function filterEnvironmentProjects(
  projects: readonly DesktopWorkspace[],
  query: string,
): DesktopWorkspace[] {
  const keyword = query.trim().toLocaleLowerCase()
  if (!keyword) return [...projects]
  return projects.filter((project) =>
    [
      project.name,
      project.path,
      ...(project.folders ?? []).flatMap((folder) => [folder.name, folder.path]),
    ]
      .join(' ')
      .toLocaleLowerCase()
      .includes(keyword),
  )
}

export function isProjectSettingsConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as {
    code?: unknown
    errorCode?: unknown
    data?: { code?: unknown }
  }
  return (
    value.errorCode === 'PROJECT_SETTINGS_CONFLICT' ||
    value.code === 'PROJECT_SETTINGS_CONFLICT' ||
    value.data?.code === 'PROJECT_SETTINGS_CONFLICT'
  )
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}
