import { expect, test } from 'bun:test'
import {
  providerManagementRouteId,
  scopedProviderManagementTab,
} from '../src/features/models/provider-management/ProviderManagementPanelState.js'
import { BUILTIN_COMPOSITE_VIEWS } from '../src/features/layout/dock/CompositeViews.js'

test('供应商设置只跟随详情路由，保持区域并排除编辑、新建和聊天路由', () => {
  const tab = {
    id: 'provider-management',
    kind: 'provider-management',
    providerId: 'magpie',
    section: 'request',
  } as const
  expect(
    scopedProviderManagementTab(tab, '/providers', '?provider=deepseek&section=models'),
  ).toEqual({ ...tab, providerId: 'deepseek' })
  for (const [path, search] of [
    ['/providers', ''],
    ['/providers', '?newProvider=1'],
    ['/providers', '?provider=magpie&edit=1'],
    ['/chat', '?provider=magpie'],
  ]) {
    expect(providerManagementRouteId(path!, search!)).toBeNull()
    expect(scopedProviderManagementTab(tab, path!, search!)).toBeNull()
  }
  expect(scopedProviderManagementTab(null, '/providers', '?provider=magpie')).toBeNull()
  expect(BUILTIN_COMPOSITE_VIEWS['provider-management']).toMatchObject({
    allowedLocations: ['right'],
    canMove: false,
    canFloat: false,
    canClose: true,
  })
})
