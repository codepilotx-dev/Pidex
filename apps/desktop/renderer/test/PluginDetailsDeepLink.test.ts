import { describe, expect, test } from 'bun:test'
import {
  clearPluginDetailsDeepLink,
  resolvePluginDetailsDeepLink,
  safeInternalRoute,
} from '../src/features/settings/plugins/PluginDetailsDeepLink.js'
import type { PluginCatalogItem } from '../src/features/plugins/PluginCatalog.js'
import type { DesktopInstalledSkill } from '../shared/Types.js'

const plugin: PluginCatalogItem = {
  id: 'computer-use',
  name: 'Computer Use',
  description: 'Control Windows applications.',
  category: 'included',
  actionKind: 'none',
  iconName: 'computer-use',
  tone: 'pidex',
  status: 'included',
}

const builtinSkill: DesktopInstalledSkill = {
  name: 'builtin-helper',
  description: 'Run built-in helper.',
  path: 'builtin://builtin-helper/SKILL.md',
  scope: 'system',
  source: 'system',
  format: 'pidex',
  enabled: true,
}

describe('plugin and skill detail deep links', () => {
  test('opens only an exact current plugin and preserves a safe return path', () => {
    const result = resolvePluginDetailsDeepLink(
      new URLSearchParams({
        tab: 'plugins',
        plugin: 'computer-use',
        from: '/new?surface=working',
      }),
      [plugin],
      [],
    )

    expect(result).toEqual({
      kind: 'plugin',
      item: plugin,
      from: '/new?surface=working',
    })
  })

  test('allows a skill deep link only for the exact builtin identity', () => {
    const result = resolvePluginDetailsDeepLink(
      new URLSearchParams({
        tab: 'skills',
        skill: builtinSkill.path,
      }),
      [],
      [builtinSkill],
    )
    const workspaceSkill: DesktopInstalledSkill = {
      ...builtinSkill,
      path: 'F:\\workspace\\.agents\\skills\\builtin-helper\\SKILL.md',
      scope: 'repo',
      source: 'workspace',
    }

    expect(result).toMatchObject({ kind: 'skill', skill: builtinSkill })
    expect(
      resolvePluginDetailsDeepLink(
        new URLSearchParams({ tab: 'skills', skill: workspaceSkill.path }),
        [],
        [workspaceSkill],
      ),
    ).toBeNull()
  })

  test('rejects unsafe returns and clears stale or ambiguous target parameters', () => {
    expect(safeInternalRoute('https://example.com')).toBeNull()
    expect(safeInternalRoute('//example.com')).toBeNull()
    expect(safeInternalRoute('/\\example.com')).toBeNull()
    expect(safeInternalRoute('/session-groups?view=list#group-1')).toBe(
      '/session-groups?view=list#group-1',
    )
    expect(
      resolvePluginDetailsDeepLink(
        new URLSearchParams({
          plugin: plugin.id,
          skill: builtinSkill.path,
        }),
        [plugin],
        [builtinSkill],
      ),
    ).toBeNull()
    expect(
      clearPluginDetailsDeepLink(
        new URLSearchParams({
          tab: 'skills',
          skill: builtinSkill.path,
          from: 'https://example.com',
        }),
      ).toString(),
    ).toBe('tab=skills')
  })
})
