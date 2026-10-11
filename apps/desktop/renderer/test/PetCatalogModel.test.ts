import { describe, expect, test } from 'bun:test'
import type { PetCatalogItem, PetDescriptor } from '@pidex/agent-protocol'
import {
  buildPetCatalogGroups,
  DEFAULT_PET_CATALOG_TAB,
  filterPetCatalogCards,
  listPetCatalogCategories,
  petLicenseNeedsConfirmation,
} from '../src/features/pet/PetCatalogModel.js'

const PETS: PetCatalogItem[] = [
  pet({
    slug: 'firefly--lingxiaotian',
    displayName: '流萤',
    englishName: 'Firefly',
    author: 'Lingxiaotian',
    category: 'games',
    categoryLabel: '游戏',
    spriteVersionNumber: 1,
  }),
  pet({
    slug: 'hami--tat',
    displayName: '哈米',
    englishName: 'Hami',
    author: 'Tat',
    category: 'original',
    categoryLabel: '原创',
    spriteVersionNumber: 2,
  }),
]

describe('pet catalog filters', () => {
  const groups = buildPetCatalogGroups(PETS, [])

  test('searches localized names and authors before applying category and version', () => {
    expect(
      filterPetCatalogCards(groups.available, {
        query: 'firefly',
        category: '',
        version: 'all',
      }).map((item) => item.id),
    ).toEqual(['firefly--lingxiaotian'])

    expect(
      filterPetCatalogCards(groups.available, {
        query: 'tat',
        category: 'original',
        version: 2,
      }).map((item) => item.id),
    ).toEqual(['hami--tat'])

    expect(
      filterPetCatalogCards(groups.available, {
        query: '',
        category: 'games',
        version: 2,
      }),
    ).toEqual([])
  })

  test('builds a unique localized category list', () => {
    expect(listPetCatalogCategories([...groups.available, groups.available[0]!])).toEqual([
      { id: 'games', label: '游戏' },
      { id: 'original', label: '原创' },
    ])
  })
})

describe('pet catalog groups', () => {
  test('opens the store on the available tab by default', () => {
    expect(DEFAULT_PET_CATALOG_TAB).toBe('available')
  })

  test('merges installed community and custom pets without duplicate ids', () => {
    const firefly = descriptor({
      id: 'firefly--lingxiaotian',
      displayName: '本地流萤',
    })
    const custom = descriptor({
      id: 'private-pet',
      displayName: '私有宠物',
      description: '本地安装的伙伴',
      spriteVersionNumber: 2,
    })
    const groups = buildPetCatalogGroups(PETS, [
      firefly,
      custom,
      { ...custom, displayName: '重复项' },
    ])

    expect(groups.installed.map((item) => item.id)).toEqual([
      'firefly--lingxiaotian',
      'private-pet',
    ])
    expect(groups.available.map((item) => item.id)).toEqual(['hami--tat'])
    expect(groups.installed[0]).toMatchObject({
      source: 'community',
      displayName: '流萤',
      spritesheetUrl: '/api/pets/firefly--lingxiaotian/spritesheet',
    })
    expect(groups.installed[1]).toMatchObject({
      source: 'custom',
      category: 'custom',
      categoryLabel: '自定义来源',
      description: '本地安装的伙伴',
    })
  })

  test('honors the catalog installed marker while local pets are loading', () => {
    const groups = buildPetCatalogGroups([pet({ slug: 'catalog-installed', installed: true })], [])

    expect(groups.installed.map((item) => item.id)).toEqual(['catalog-installed'])
    expect(groups.available).toEqual([])
  })

  test('filters custom pets by source, version, description and id', () => {
    const groups = buildPetCatalogGroups(
      [],
      [
        descriptor({
          id: 'private-pet',
          displayName: '私有宠物',
          description: '离线伙伴',
          spriteVersionNumber: 2,
        }),
      ],
    )

    expect(
      filterPetCatalogCards(groups.installed, {
        query: '离线',
        category: 'custom',
        version: 2,
      }).map((item) => item.id),
    ).toEqual(['private-pet'])
    expect(
      filterPetCatalogCards(groups.installed, {
        query: 'private-pet',
        category: '',
        version: 'all',
      }).map((item) => item.id),
    ).toEqual(['private-pet'])
    expect(listPetCatalogCategories(groups.installed)).toEqual([
      { id: 'custom', label: '自定义来源' },
    ])
  })
})

describe('pet catalog licenses', () => {
  test('only requires confirmation for restricted or unknown licenses', () => {
    expect(petLicenseNeedsConfirmation('permissive')).toBe(false)
    expect(petLicenseNeedsConfirmation('attribution')).toBe(false)
    expect(petLicenseNeedsConfirmation('restricted')).toBe(true)
    expect(petLicenseNeedsConfirmation('unknown')).toBe(true)
  })
})

function pet(patch: Partial<PetCatalogItem> & Pick<PetCatalogItem, 'slug'>): PetCatalogItem {
  return {
    slug: patch.slug,
    displayName: patch.displayName ?? patch.slug,
    author: patch.author ?? 'Author',
    category: patch.category ?? 'other',
    categoryLabel: patch.categoryLabel ?? '其他',
    spriteVersionNumber: patch.spriteVersionNumber ?? 1,
    license: patch.license ?? 'MIT',
    licenseKind: patch.licenseKind ?? 'permissive',
    previewUrl: patch.previewUrl ?? `/api/pets/catalog/${patch.slug}/preview`,
    installed: patch.installed ?? false,
    ...(patch.englishName === undefined ? {} : { englishName: patch.englishName }),
    ...(patch.description === undefined ? {} : { description: patch.description }),
  }
}

function descriptor(patch: Partial<PetDescriptor> & Pick<PetDescriptor, 'id'>): PetDescriptor {
  return {
    id: patch.id,
    displayName: patch.displayName ?? patch.id,
    spriteVersionNumber: patch.spriteVersionNumber ?? 1,
    spritesheetPath: patch.spritesheetPath ?? 'spritesheet.png',
    spritesheetUrl: patch.spritesheetUrl ?? `/api/pets/${patch.id}/spritesheet`,
    installed: patch.installed ?? true,
    ...(patch.description === undefined ? {} : { description: patch.description }),
  }
}
