import type { ProviderManagementTab } from '../../layout/dock/RightDockState.js'

export function providerManagementRouteId(pathname: string, search: string): string | null {
  const params = new URLSearchParams(search)
  if (pathname !== '/providers' || params.get('newProvider') === '1' || params.get('edit') === '1')
    return null
  return params.get('provider') || null
}

export function scopedProviderManagementTab(
  tab: ProviderManagementTab | null,
  pathname: string,
  search: string,
): ProviderManagementTab | null {
  const providerId = providerManagementRouteId(pathname, search)
  return tab && providerId ? { ...tab, providerId } : null
}
