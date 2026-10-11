import { describe, expect, test } from 'bun:test'
import type { DesktopWorkspace } from '../shared/Types.js'
import {
  filterEnvironmentProjects,
  isProjectSettingsConflict,
  sortEnvironmentProjects,
} from '../src/features/settings/EnvironmentSettingsModel.js'

describe('environment settings model', () => {
  test('sorts projects by recent activity and then by name', () => {
    const projects = [
      workspace('later-name', '2026-01-01T00:00:00.000Z'),
      workspace('recent', '2026-02-01T00:00:00.000Z'),
      workspace('earlier-name', '2026-01-01T00:00:00.000Z'),
    ]

    expect(sortEnvironmentProjects(projects).map((project) => project.name)).toEqual([
      'recent',
      'earlier-name',
      'later-name',
    ])
    expect(projects.map((project) => project.name)).toEqual([
      'later-name',
      'recent',
      'earlier-name',
    ])
  })

  test('recognizes safe RPC conflict envelopes', () => {
    expect(
      isProjectSettingsConflict({
        errorCode: 'PROJECT_SETTINGS_CONFLICT',
      }),
    ).toBe(true)
    expect(
      isProjectSettingsConflict({
        data: { code: 'PROJECT_SETTINGS_CONFLICT' },
      }),
    ).toBe(true)
    expect(isProjectSettingsConflict(new Error('conflict'))).toBe(false)
  })

  test('filters projects by name, primary path, and folder paths without reordering', () => {
    const projects = [
      workspace('Alpha', '2026-02-01T00:00:00.000Z'),
      {
        ...workspace('Beta', '2026-01-01T00:00:00.000Z'),
        folders: [
          {
            id: 'docs',
            name: '文档',
            path: 'D:\\shared\\handbook',
            role: 'secondary' as const,
            availability: 'available' as const,
            order: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
    ]

    expect(filterEnvironmentProjects(projects, 'ALPHA').map((item) => item.name)).toEqual(['Alpha'])
    expect(filterEnvironmentProjects(projects, 'projects\\beta').map((item) => item.name)).toEqual([
      'Beta',
    ])
    expect(filterEnvironmentProjects(projects, 'handbook').map((item) => item.name)).toEqual([
      'Beta',
    ])
    expect(filterEnvironmentProjects(projects, '  ').map((item) => item.name)).toEqual([
      'Alpha',
      'Beta',
    ])
  })
})

function workspace(name: string, lastOpenedAt: string): DesktopWorkspace {
  return {
    name,
    path: `C:\\projects\\${name}`,
    lastOpenedAt,
  }
}
