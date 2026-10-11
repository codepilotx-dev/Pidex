import type { PetCatalogItem, PetDescriptor, PetLicenseKind } from '@pidex/agent-protocol'

export type PetCatalogVersionFilter = 'all' | 1 | 2
export type PetCatalogTab = 'installed' | 'available'
export const DEFAULT_PET_CATALOG_TAB: PetCatalogTab = 'available'

export type PetCatalogCardItem = {
  id: string
  displayName: string
  englishName?: string
  description?: string
  author?: string
  category: string
  categoryLabel: string
  spriteVersionNumber: 1 | 2
  source: 'community' | 'custom'
  installed: boolean
  license?: string
  licenseKind?: PetLicenseKind
  previewUrl?: string
  spritesheetUrl?: string
  catalogItem?: PetCatalogItem
}

export type PetCatalogGroups = {
  installed: PetCatalogCardItem[]
  available: PetCatalogCardItem[]
}

export type PetCatalogCategoryOption = {
  id: string
  label: string
}

export type PetCatalogFilters = {
  query: string
  category: string
  version: PetCatalogVersionFilter
}

export function buildPetCatalogGroups(
  catalogPets: readonly PetCatalogItem[],
  installedPets: readonly PetDescriptor[],
): PetCatalogGroups {
  const installedById = new Map<string, PetDescriptor>()
  for (const pet of installedPets) {
    if (!installedById.has(pet.id)) installedById.set(pet.id, pet)
  }

  const catalogIds = new Set<string>()
  const installed: PetCatalogCardItem[] = []
  const available: PetCatalogCardItem[] = []
  for (const pet of catalogPets) {
    if (catalogIds.has(pet.slug)) continue
    catalogIds.add(pet.slug)
    const localPet = installedById.get(pet.slug)
    const card = communityCard(pet, localPet)
    if (card.installed) installed.push(card)
    else available.push(card)
  }

  for (const pet of installedById.values()) {
    if (catalogIds.has(pet.id)) continue
    installed.push(customCard(pet))
  }

  return { installed, available }
}

export function filterPetCatalogCards(
  pets: readonly PetCatalogCardItem[],
  filters: PetCatalogFilters,
): PetCatalogCardItem[] {
  const query = filters.query.trim().toLocaleLowerCase()
  return pets.filter((pet) => {
    if (filters.category && pet.category !== filters.category) return false
    if (filters.version !== 'all' && pet.spriteVersionNumber !== filters.version) {
      return false
    }
    if (!query) return true
    return [pet.displayName, pet.englishName, pet.author, pet.description, pet.id].some((value) =>
      value?.toLocaleLowerCase().includes(query),
    )
  })
}

export function listPetCatalogCategories(
  pets: readonly PetCatalogCardItem[],
): PetCatalogCategoryOption[] {
  const labels = new Map<string, string>()
  for (const pet of pets) {
    if (!labels.has(pet.category)) {
      labels.set(pet.category, pet.categoryLabel)
    }
  }
  return [...labels]
    .map(([id, label]) => ({ id, label }))
    .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
}

export function petLicenseNeedsConfirmation(kind: PetLicenseKind): boolean {
  return kind === 'restricted' || kind === 'unknown'
}

export function petLicenseLabel(kind: PetLicenseKind): string {
  switch (kind) {
    case 'permissive':
      return '宽松许可'
    case 'attribution':
      return '需要署名'
    case 'restricted':
      return '限制使用'
    case 'unknown':
      return '许可未知'
  }
}

function communityCard(
  pet: PetCatalogItem,
  localPet: PetDescriptor | undefined,
): PetCatalogCardItem {
  return {
    id: pet.slug,
    displayName: pet.displayName,
    ...(pet.englishName ? { englishName: pet.englishName } : {}),
    ...(pet.description ? { description: pet.description } : {}),
    author: pet.author,
    category: pet.category,
    categoryLabel: pet.categoryLabel,
    spriteVersionNumber: pet.spriteVersionNumber,
    source: 'community',
    installed: Boolean(localPet) || pet.installed,
    license: pet.license,
    licenseKind: pet.licenseKind,
    previewUrl: pet.previewUrl,
    ...(localPet ? { spritesheetUrl: localPet.spritesheetUrl } : {}),
    catalogItem: pet,
  }
}

function customCard(pet: PetDescriptor): PetCatalogCardItem {
  return {
    id: pet.id,
    displayName: pet.displayName,
    ...(pet.description ? { description: pet.description } : {}),
    category: 'custom',
    categoryLabel: '自定义来源',
    spriteVersionNumber: pet.spriteVersionNumber,
    source: 'custom',
    installed: true,
    spritesheetUrl: pet.spritesheetUrl,
  }
}
