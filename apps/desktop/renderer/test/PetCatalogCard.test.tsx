import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PetCatalogCard } from '../src/features/pet/PetCatalogCard.js'
import type { PetCatalogCardItem } from '../src/features/pet/PetCatalogModel.js'

describe('PetCatalogCard', () => {
  const basePet: PetCatalogCardItem = {
    id: 'test-pet',
    displayName: '测试伙伴',
    description: '一只用于测试的桌面伙伴',
    category: 'games',
    categoryLabel: '游戏角色',
    spriteVersionNumber: 1,
    source: 'community',
    installed: false,
    licenseKind: 'permissive',
  }

  test('renders uninstalled card with add button and displayName', () => {
    const html = renderToStaticMarkup(
      <PetCatalogCard
        installed={false}
        installing={false}
        isSelected={false}
        onInstall={() => undefined}
        onSelect={() => undefined}
        onUninstall={() => undefined}
        pet={basePet}
      />,
    )
    expect(html).toContain('测试伙伴')
    expect(html).toContain('一只用于测试的桌面伙伴')
    expect(html).toContain('v1')
    expect(html).toContain('aria-label="安装 测试伙伴"')
  })

  test('renders installed card with more button', () => {
    const html = renderToStaticMarkup(
      <PetCatalogCard
        installed={true}
        installing={false}
        isSelected={false}
        onInstall={() => undefined}
        onSelect={() => undefined}
        onUninstall={() => undefined}
        pet={{ ...basePet, installed: true }}
      />,
    )
    expect(html).toContain('测试伙伴')
    expect(html).toContain('aria-label="管理 测试伙伴"')
  })

  test('renders warning indicator for restricted license', () => {
    const html = renderToStaticMarkup(
      <PetCatalogCard
        installed={false}
        installing={false}
        isSelected={false}
        onInstall={() => undefined}
        onSelect={() => undefined}
        onUninstall={() => undefined}
        pet={{ ...basePet, licenseKind: 'restricted' }}
      />,
    )
    expect(html).toContain('限制使用：限制使用')
  })
})
