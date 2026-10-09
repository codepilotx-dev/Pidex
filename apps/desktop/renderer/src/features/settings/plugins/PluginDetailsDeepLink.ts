import type { DesktopInstalledSkill } from '../../../../shared/Types.js'
import { isBuiltinSkill } from '../../plugins/BuiltinSkillPresentation.js'
import type { PluginCatalogItem } from '../../plugins/PluginCatalog.js'

export type PluginDetailsDeepLink =
  | {
      kind: 'plugin'
      item: PluginCatalogItem
      from: string | null
    }
  | {
      kind: 'skill'
      skill: DesktopInstalledSkill
      from: string | null
    }

/**
 * Resolves a URL target from the live catalogs. Query values never become a
 * detail item by themselves: that prevents stale or forged deep links from
 * opening an object that is no longer available to this renderer.
 */
export function resolvePluginDetailsDeepLink(
  params: URLSearchParams,
  pluginItems: readonly PluginCatalogItem[],
  skills: readonly DesktopInstalledSkill[],
): PluginDetailsDeepLink | null {
  const pluginId = params.get('plugin')
  const skillPath = params.get('skill')
  if (Boolean(pluginId) === Boolean(skillPath)) return null

  const from = safeInternalRoute(params.get('from'))
  if (pluginId) {
    const item = pluginItems.find((candidate) => candidate.id === pluginId)
    return item ? { kind: 'plugin', item, from } : null
  }

  const skill = skills.find(
    (candidate) => candidate.path === skillPath && isBuiltinSkill(candidate),
  )
  return skill ? { kind: 'skill', skill, from } : null
}

export function clearPluginDetailsDeepLink(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  next.delete('plugin')
  next.delete('skill')
  next.delete('from')
  return next
}

/** Restrict return targets to same-app paths, never protocol-relative URLs. */
export function safeInternalRoute(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null
  if (value.includes('\\')) return null

  try {
    const parsed = new URL(value, 'https://pidex.invalid')
    if (parsed.origin !== 'https://pidex.invalid') return null
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return null
  }
}
