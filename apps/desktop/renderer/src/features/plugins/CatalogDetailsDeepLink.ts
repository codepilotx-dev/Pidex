export type CatalogTab = 'plugins' | 'skills'

export type CatalogDetailsTarget =
  { kind: 'plugin'; id: string; tab: 'plugins' } | { kind: 'skill'; id: string; tab: 'skills' }

export type CatalogLocation = {
  tab: CatalogTab
  target: CatalogDetailsTarget | null
  invalid: boolean
}

export function parseCatalogLocation(params: URLSearchParams): CatalogLocation {
  const requestedTab = params.get('tab')
  const pluginId = params.get('plugin')?.trim() ?? ''
  const skillId = params.get('skill')?.trim() ?? ''
  const hasPluginParam = params.has('plugin')
  const hasSkillParam = params.has('skill')

  if (hasPluginParam && hasSkillParam) {
    return {
      tab: requestedTab === 'skills' ? 'skills' : 'plugins',
      target: null,
      invalid: true,
    }
  }

  if (hasPluginParam) {
    return {
      tab: 'plugins',
      target: pluginId ? { kind: 'plugin', id: pluginId, tab: 'plugins' } : null,
      invalid: !pluginId || (requestedTab !== null && requestedTab !== 'plugins'),
    }
  }

  if (hasSkillParam) {
    return {
      tab: 'skills',
      target: skillId ? { kind: 'skill', id: skillId, tab: 'skills' } : null,
      invalid: !skillId || (requestedTab !== null && requestedTab !== 'skills'),
    }
  }

  return {
    tab: requestedTab === 'skills' ? 'skills' : 'plugins',
    target: null,
    invalid: requestedTab !== null && requestedTab !== 'plugins' && requestedTab !== 'skills',
  }
}

export function catalogBrowseParams(current: URLSearchParams, tab: CatalogTab): URLSearchParams {
  const next = new URLSearchParams(current)
  next.set('tab', tab)
  next.delete('plugin')
  next.delete('skill')
  return next
}

export function catalogDetailsParams(
  current: URLSearchParams,
  target: CatalogDetailsTarget,
): URLSearchParams {
  const next = catalogBrowseParams(current, target.tab)
  next.set(target.kind, target.id)
  return next
}
