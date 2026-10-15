import React, { useMemo, useState } from 'react'
import type { PetCatalogItem, PetCatalogResult, PetDescriptor } from '@pidex/agent-protocol'
import { ArrowLeft, ChevronRight, Egg, SearchX } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'
import { SkeletonBlock, SkeletonRegion } from '../../components/ui/Skeleton.js'
import { APP_ICON_SIZE } from '../../components/ui/IconTokens.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { PetCatalogCard } from './PetCatalogCard.js'
import {
  buildPetCatalogCards,
  filterPetCatalogCards,
  groupPetsByCategory,
  petLicenseNeedsConfirmation,
  type PetCatalogCardItem,
  type PetCatalogVersionFilter,
} from './PetCatalogModel.js'

type Props = {
  catalog: PetCatalogResult
  catalogLoading: boolean
  query: string
  version: PetCatalogVersionFilter
  onClearFilters: () => void
  onRefreshCatalog: () => void
  onUpdateCatalog: React.Dispatch<React.SetStateAction<PetCatalogResult>>
  installedPets: readonly PetDescriptor[]
  installedPetsLoading: boolean
  selectedPetId: string | null
  overlayEnabled: boolean
  onEnableOverlay: () => Promise<void>
  onInstalled: (pet: PetDescriptor) => Promise<void>
  onRefreshPets?: () => Promise<readonly PetDescriptor[]>
  onSelect: (id: string) => void
  onError: (message: string) => void
  onNotice?: (message: string) => void
}

const PREVIEW_CARD_COUNT = 6

export function PetCatalogSection({
  catalog,
  catalogLoading,
  query,
  version,
  onClearFilters,
  onRefreshCatalog,
  onUpdateCatalog,
  installedPets,
  installedPetsLoading,
  selectedPetId,
  overlayEnabled,
  onEnableOverlay,
  onInstalled,
  onRefreshPets,
  onSelect,
  onError,
  onNotice,
}: Props): React.ReactNode {
  const [installingSlug, setInstallingSlug] = useState<string | null>(null)
  const [licensePet, setLicensePet] = useState<PetCatalogItem | null>(null)
  const [uninstallPet, setUninstallPet] = useState<PetCatalogCardItem | null>(null)
  const [showWakeAction, setShowWakeAction] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()

  const activeCategory = searchParams.get('category')

  const installedIds = useMemo(() => new Set(installedPets.map((pet) => pet.id)), [installedPets])

  const allCards = useMemo(
    () => buildPetCatalogCards(catalog.pets, installedPets),
    [catalog.pets, installedPets],
  )

  const filteredCards = useMemo(
    () => filterPetCatalogCards(allCards, { query, category: '', version }),
    [allCards, query, version],
  )

  const categoryGroups = useMemo(
    () => groupPetsByCategory(filteredCards),
    [filteredCards],
  )

  const activeCategoryGroup = useMemo(
    () => (activeCategory ? categoryGroups.find((g) => g.id === activeCategory) ?? null : null),
    [activeCategory, categoryGroups],
  )

  const hasFilters = Boolean(query.trim() || version !== 'all')
  const isSearchMode = Boolean(query.trim())

  const navigateToCategory = (categoryId: string): void => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('category', categoryId)
      return next
    })
  }

  const navigateBack = (): void => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('category')
      return next
    })
  }

  const installAndUse = async (
    pet: PetCatalogItem,
    acceptedRestrictedLicense = false,
  ): Promise<void> => {
    setLicensePet(null)
    setInstallingSlug(pet.slug)
    try {
      const installed = await desktopClient.installCatalogPet(pet.slug, acceptedRestrictedLicense)
      await onInstalled(installed)
      onUpdateCatalog((current) => ({
        ...current,
        pets: current.pets.map((item) =>
          item.slug === pet.slug ? { ...item, installed: true } : item,
        ),
      }))
      setShowWakeAction(!overlayEnabled)
      onNotice?.(`已安装并使用 ${installed.displayName}`)
    } catch (error) {
      onError(messageOf(error))
    } finally {
      setInstallingSlug(null)
    }
  }

  const choosePet = (pet: PetCatalogCardItem): void => {
    if (pet.installed || installedIds.has(pet.id)) {
      onSelect(pet.id)
      return
    }
    const catalogPet = pet.catalogItem
    if (!catalogPet) return
    if (petLicenseNeedsConfirmation(catalogPet.licenseKind)) {
      setLicensePet(catalogPet)
      return
    }
    void installAndUse(catalogPet)
  }

  const handleUninstall = async (pet: PetCatalogCardItem): Promise<void> => {
    const petId = pet.id
    const displayName = pet.displayName
    setUninstallPet(null)
    try {
      await desktopClient.removePet(petId)
      const remaining = await onRefreshPets?.()
      if (selectedPetId === petId) {
        const nextId = remaining?.[0]?.id ?? ''
        if (nextId) onSelect(nextId)
      }
      onUpdateCatalog((current) => ({
        ...current,
        pets: current.pets.map((item) =>
          item.slug === petId ? { ...item, installed: false } : item,
        ),
      }))
      onNotice?.(`已卸载 ${displayName}`)
    } catch (error) {
      onError(messageOf(error))
    }
  }

  return (
    <>
      <section aria-label="社区宠物目录" className="pet-catalog-browser tw:flex tw:min-w-0 tw:w-full tw:flex-col">
        {activeCategory ? (
          <div className="pet-catalog-drilldown-header tw:mb-4 tw:flex tw:items-center tw:justify-between tw:gap-3">
            <div className="tw:flex tw:items-center tw:gap-2">
              <Button color="secondary" onClick={navigateBack} type="button">
                <ArrowLeft aria-hidden="true" size={APP_ICON_SIZE} />
                <span>返回全部分类</span>
              </Button>
              {activeCategoryGroup ? (
                <h2 className="tw:m-0 tw:pl-2 tw:text-app-text tw:type-title-md">
                  {activeCategoryGroup.label}
                </h2>
              ) : null}
            </div>
          </div>
        ) : null}

        {catalog.cacheState === 'stale' ? (
          <p
            className="pet-catalog-status tw:m-0 tw:mb-4 tw:rounded-md tw:bg-app-hover tw:px-3 tw:py-2 tw:type-body-sm tw:text-app-text-meta"
            role="status"
          >
            当前显示上次成功获取的目录，联网后可手动刷新。
          </p>
        ) : null}

        {showWakeAction && !overlayEnabled ? (
          <div
            className="pet-catalog-wake tw:mb-4 tw:flex tw:items-center tw:justify-between tw:gap-3 tw:rounded-lg tw:border tw:border-app-border tw:bg-app-raised tw:p-3 tw:text-app-text tw:@max-[720px]/pet-catalog-page:flex-col tw:@max-[720px]/pet-catalog-page:items-start"
            role="status"
          >
            <span>新宠物已经准备好了。</span>
            <Button
              color="primary"
              onClick={() => {
                void onEnableOverlay().then(() => setShowWakeAction(false))
              }}
              type="button"
            >
              <Egg size={APP_ICON_SIZE} />
              立即唤醒
            </Button>
          </div>
        ) : null}

        <div
          aria-busy={catalogLoading || undefined}
          id="pet-catalog-panel"
          className="tw:min-w-0 tw:w-full"
        >
          {catalogLoading && !catalog.pets.length ? (
            <SkeletonRegion
              className="pet-catalog-skeleton-region tw:grid tw:min-w-0 tw:gap-6"
              label="正在载入社区宠物"
            >
              {Array.from({ length: 2 }).map((_, groupIndex) => (
                <div className="tw:grid tw:gap-3" key={groupIndex}>
                  <SkeletonBlock className="tw:h-5 tw:w-28 tw:rounded-md" />
                  <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:@max-[720px]/pet-catalog-page:grid-cols-1">
                    {Array.from({ length: 4 }).map((_, cardIndex) => (
                      <div
                        className="tw:flex tw:items-center tw:gap-3 tw:rounded-item tw:border-0 tw:bg-transparent tw:p-3"
                        key={cardIndex}
                      >
                        <SkeletonBlock className="tw:size-12 tw:shrink-0 tw:rounded-lg" />
                        <div className="tw:flex tw:flex-1 tw:flex-col tw:gap-2">
                          <SkeletonBlock className="tw:h-4 tw:w-1/3 tw:rounded-md" />
                          <SkeletonBlock className="tw:h-3 tw:w-3/4 tw:rounded-md" />
                        </div>
                        <SkeletonBlock className="tw:size-8 tw:shrink-0 tw:rounded-md" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </SkeletonRegion>
          ) : null}

          {!catalogLoading && catalog.cacheState === 'unavailable' ? (
            <div className="pet-catalog-empty tw:grid tw:justify-items-center tw:gap-2 tw:px-4 tw:py-12 tw:text-center tw:text-app-text-meta">
              <Egg size={APP_ICON_SIZE} />
              <strong className="tw:text-app-text">暂时无法获取社区目录</strong>
              <span>请检查网络连接；已安装的宠物仍可正常使用。</span>
              <Button color="secondary" onClick={onRefreshCatalog} type="button">
                重试
              </Button>
            </div>
          ) : null}

          {!catalogLoading && catalog.cacheState !== 'unavailable' && filteredCards.length === 0 ? (
            <div className="pet-catalog-empty tw:grid tw:justify-items-center tw:gap-2 tw:px-4 tw:py-12 tw:text-center tw:text-app-text-meta">
              <SearchX size={APP_ICON_SIZE} />
              <strong className="tw:text-app-text">没有匹配的宠物</strong>
              <span>尝试更换关键词或筛选条件。</span>
              {hasFilters ? (
                <Button color="secondary" onClick={onClearFilters} type="button">
                  清除筛选
                </Button>
              ) : null}
            </div>
          ) : null}

          {!catalogLoading && catalog.cacheState !== 'unavailable' && filteredCards.length > 0 ? (
            activeCategory ? (
              activeCategoryGroup ? (
                <div className="pet-catalog-category-drilldown tw:grid tw:gap-4">
                  <div className="pet-catalog-grid tw:grid tw:grid-cols-2 tw:gap-3 tw:@max-[720px]/pet-catalog-page:grid-cols-1">
                    {activeCategoryGroup.items.map((pet) => (
                      <PetCatalogCard
                        installed={pet.installed || installedIds.has(pet.id)}
                        installing={installingSlug === pet.id}
                        isSelected={selectedPetId === pet.id}
                        key={pet.id}
                        onInstall={choosePet}
                        onSelect={onSelect}
                        onUninstall={setUninstallPet}
                        pet={pet}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="pet-catalog-empty tw:grid tw:justify-items-center tw:gap-2 tw:px-4 tw:py-12 tw:text-center tw:text-app-text-meta">
                  <SearchX size={APP_ICON_SIZE} />
                  <strong className="tw:text-app-text">该分类下没有找到宠物</strong>
                  <Button color="secondary" onClick={navigateBack} type="button">
                    返回全部分类
                  </Button>
                </div>
              )
            ) : (
              <div className="pet-catalog-groups tw:grid tw:gap-6">
                {categoryGroups.map((group) => {
                  const displayItems = isSearchMode
                    ? group.items
                    : group.items.slice(0, PREVIEW_CARD_COUNT)
                  return (
                    <section
                      className="pet-catalog-group tw:grid tw:min-w-0 tw:gap-3"
                      key={group.id}
                    >
                      <header className="pet-catalog-group-header tw:flex tw:items-center tw:gap-3">
                        {!isSearchMode ? (
                          <button
                            className="tw:group tw:inline-flex tw:cursor-pointer tw:items-center tw:gap-1 tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:text-app-text tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus"
                            onClick={() => navigateToCategory(group.id)}
                            type="button"
                          >
                            <h2 className="tw:m-0 tw:type-title-sm">
                              {group.label}
                            </h2>
                            <ChevronRight
                              aria-hidden="true"
                              className="tw:text-app-text-meta tw:transition-transform tw:group-hover:translate-x-0.5"
                              size={16}
                              strokeWidth={2.2}
                            />
                          </button>
                        ) : (
                          <h2 className="tw:m-0 tw:text-app-text tw:type-title-sm">
                            {group.label}
                          </h2>
                        )}
                      </header>
                      <div className="pet-catalog-grid tw:grid tw:grid-cols-2 tw:gap-3 tw:@max-[720px]/pet-catalog-page:grid-cols-1">
                        {displayItems.map((pet) => (
                          <PetCatalogCard
                            installed={pet.installed || installedIds.has(pet.id)}
                            installing={installingSlug === pet.id}
                            isSelected={selectedPetId === pet.id}
                            key={pet.id}
                            onInstall={choosePet}
                            onSelect={onSelect}
                            onUninstall={setUninstallPet}
                            pet={pet}
                          />
                        ))}
                      </div>
                    </section>
                  )
                })}
              </div>
            )
          ) : null}
        </div>
      </section>

      <ConfirmationDialog
        actionDisabled={installingSlug !== null}
        actionLabel="我已了解，继续安装"
        description={
          licensePet ? (
            <span className="pet-license-confirmation tw:grid tw:gap-2">
              <span>
                “{licensePet.displayName}”由 {licensePet.author} 提供。
              </span>
              <span className="pet-license-confirmation-text tw:max-h-28 tw:overflow-auto tw:rounded-md tw:border tw:border-app-border tw:bg-app-raised tw:px-3 tw:py-2 tw:text-app-text tw:whitespace-pre-wrap">
                {licensePet.license}
              </span>
              <span>请仅在上述许可允许的范围内使用和分发。</span>
            </span>
          ) : undefined
        }
        onAction={() => {
          if (licensePet) void installAndUse(licensePet, true)
        }}
        onCancel={() => setLicensePet(null)}
        open={licensePet !== null}
        title={licensePet?.licenseKind === 'unknown' ? '确认未知许可证' : '确认使用限制'}
      />

      <ConfirmationDialog
        actionLabel="卸载"
        description="卸载后此宠物的本地文件将被删除，你可以随时重新安装。"
        onAction={() => {
          if (uninstallPet) void handleUninstall(uninstallPet)
        }}
        onCancel={() => setUninstallPet(null)}
        open={uninstallPet !== null}
        title={`卸载 ${uninstallPet?.displayName ?? '宠物'}？`}
        tone="danger"
      />
    </>
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
