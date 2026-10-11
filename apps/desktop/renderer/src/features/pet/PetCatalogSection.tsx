import React, { useEffect, useMemo, useState } from 'react'
import type { PetCatalogItem, PetCatalogResult, PetDescriptor } from '@pidex/agent-protocol'
import { Download, PawPrint, RefreshCw, SearchX } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'

import { SearchInput } from '../../components/ui/SearchInput.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { RemoteImage } from '../../components/ui/RemoteImage.js'
import { SkeletonBlock, SkeletonRegion } from '../../components/ui/Skeleton.js'
import { Spinner } from '../../components/ui/Spinner.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { WorkspaceHeaderItem } from '../layout/workspace-header/index.js'
import { SettingsDropdown } from '../settings/SettingsDropdown.js'
import { PetSprite } from './PetSprite.js'
import {
  buildPetCatalogGroups,
  DEFAULT_PET_CATALOG_TAB,
  filterPetCatalogCards,
  listPetCatalogCategories,
  petLicenseLabel,
  petLicenseNeedsConfirmation,
  type PetCatalogCardItem,
  type PetCatalogTab,
  type PetCatalogVersionFilter,
} from './PetCatalogModel.js'

type Props = {
  installedPets: readonly PetDescriptor[]
  installedPetsLoading: boolean
  selectedPetId: string | null
  overlayEnabled: boolean
  onEnableOverlay: () => Promise<void>
  onInstalled: (pet: PetDescriptor) => Promise<void>
  onSelect: (id: string) => void
  onError: (message: string) => void
  onNotice?: (message: string) => void
}

const EMPTY_CATALOG: PetCatalogResult = {
  pets: [],
  fetchedAt: null,
  cacheState: 'unavailable',
}

export function PetCatalogSection({
  installedPets,
  installedPetsLoading,
  selectedPetId,
  overlayEnabled,
  onEnableOverlay,
  onInstalled,
  onSelect,
  onError,
  onNotice,
}: Props): React.ReactNode {
  const [catalog, setCatalog] = useState<PetCatalogResult>(EMPTY_CATALOG)
  const [loading, setLoading] = useState(true)
  const [installingSlug, setInstallingSlug] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [version, setVersion] = useState<PetCatalogVersionFilter>('all')
  const [tab, setTab] = useState<PetCatalogTab>(DEFAULT_PET_CATALOG_TAB)
  const [licensePet, setLicensePet] = useState<PetCatalogItem | null>(null)
  const [showWakeAction, setShowWakeAction] = useState(false)

  const installedIds = useMemo(() => new Set(installedPets.map((pet) => pet.id)), [installedPets])
  const groups = useMemo(
    () => buildPetCatalogGroups(catalog.pets, installedPets),
    [catalog.pets, installedPets],
  )
  const categories = useMemo(
    () => listPetCatalogCategories([...groups.installed, ...groups.available]),
    [groups],
  )
  const activePets = tab === 'installed' ? groups.installed : groups.available
  const visiblePets = useMemo(
    () => filterPetCatalogCards(activePets, { query, category, version }),
    [activePets, category, query, version],
  )
  const hasFilters = Boolean(query.trim() || category || version !== 'all')
  const clearFilters = (): void => {
    setQuery('')
    setCategory('')
    setVersion('all')
  }

  const loadCatalog = async (refresh = false): Promise<void> => {
    setLoading(true)
    try {
      setCatalog(await desktopClient.listPetCatalog(refresh))
    } catch (error) {
      onError(messageOf(error))
      if (!catalog.pets.length) setCatalog(EMPTY_CATALOG)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadCatalog()
    // The catalog loads once when the standalone page mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const installAndUse = async (
    pet: PetCatalogItem,
    acceptedRestrictedLicense = false,
  ): Promise<void> => {
    setLicensePet(null)
    setInstallingSlug(pet.slug)
    try {
      const installed = await desktopClient.installCatalogPet(pet.slug, acceptedRestrictedLicense)
      await onInstalled(installed)
      setCatalog((current) => ({
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

  return (
    <>
      <WorkspaceHeaderItem align="start" id="pets.tabs" order={0} slot="left">
        <SegmentedControl<PetCatalogTab>
          ariaLabel="宠物商店分组"
          className="pet-catalog-workspace-tabs tw:[&_.segmented-control-item_span]:type-caption tw:[&_.segmented-control-item_span]:text-app-text-meta"
          getPanelId={() => 'pet-catalog-panel'}
          getTabId={(value) => `pet-catalog-${value}-tab`}
          onChange={setTab}
          options={[
            {
              value: 'available',
              label: (
                <>
                  未安装 <span>{groups.available.length}</span>
                </>
              ),
            },
            {
              value: 'installed',
              label: (
                <>
                  已安装 <span>{groups.installed.length}</span>
                </>
              ),
            },
          ]}
          overflowMode="fit"
          semantics="tabs"
          value={tab}
        />
      </WorkspaceHeaderItem>
      <WorkspaceHeaderItem align="end" id="pets.refresh" order={100} slot="right">
        <Button
          isIconOnly
          aria-busy={loading}
          color="ghostSecondary"
          disabled={loading}
          onClick={() => void loadCatalog(true)}
          size="toolbar"
          title="刷新社区宠物目录"
        >
          <RefreshCw aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
        </Button>
      </WorkspaceHeaderItem>

      <section aria-label="社区宠物目录" className="pet-catalog-browser tw:min-w-0">
        <div className="pet-catalog-panel tw:rounded-xl tw:border tw:border-app-border tw:bg-app-panel tw:p-4 tw:shadow-none">
          <div className="pet-catalog-filters tw:grid tw:grid-cols-[minmax(220px,1fr)_minmax(140px,auto)_minmax(140px,auto)] tw:items-center tw:gap-2 tw:[&_.settings-dropdown]:w-full tw:[&_.settings-dropdown]:min-w-0 tw:[&_.settings-dropdown]:bg-app-raised tw:@max-[720px]/pet-catalog-page:grid-cols-1">
            <SearchInput
              aria-label="搜索社区宠物"
              onChange={setQuery}
              placeholder="搜索名称、作者或描述"
              value={query}
            />
            <SettingsDropdown
              ariaLabel="宠物分类"
              onChange={setCategory}
              options={[
                { value: '', label: '全部分类' },
                ...categories.map((item) => ({
                  value: item.id,
                  label: item.label,
                })),
              ]}
              showSelectedIndicator
              value={category}
              size="sm"
            />
            <SettingsDropdown
              ariaLabel="宠物图集版本"
              onChange={(value) => {
                setVersion(value === 'all' ? 'all' : (Number(value) as 1 | 2))
              }}
              options={[
                { value: 'all', label: '全部版本' },
                { value: '1', label: 'v1 动画' },
                { value: '2', label: 'v2 · 16 方位' },
              ]}
              showSelectedIndicator
              value={String(version)}
              size="sm"
            />
          </div>

          {catalog.cacheState === 'stale' ? (
            <p
              className="pet-catalog-status tw:m-0 tw:mt-3 tw:rounded-md tw:bg-app-hover tw:px-3 tw:py-2 tw:type-body-sm tw:text-app-text-meta"
              role="status"
            >
              当前显示上次成功获取的目录，联网后可手动刷新。
            </p>
          ) : null}
          {showWakeAction && !overlayEnabled ? (
            <div
              className="pet-catalog-wake tw:mt-3 tw:flex tw:items-center tw:justify-between tw:gap-3 tw:rounded-lg tw:border tw:border-app-border tw:bg-app-raised tw:p-3 tw:text-app-text tw:@max-[720px]/pet-catalog-page:flex-col tw:@max-[720px]/pet-catalog-page:items-start"
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
                <PawPrint size={APP_ICON_SIZE} />
                立即唤醒
              </Button>
            </div>
          ) : null}

          <div
            aria-labelledby={`pet-catalog-${tab}-tab`}
            aria-busy={(tab === 'available' ? loading : installedPetsLoading) || undefined}
            id="pet-catalog-panel"
            role="tabpanel"
          >
            {tab === 'available' && loading && !catalog.pets.length ? (
              <SkeletonRegion
                className="pet-catalog-grid pet-catalog-skeleton-grid tw:mt-4 tw:grid tw:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] tw:gap-3"
                label="正在载入社区宠物"
              >
                {Array.from({ length: 6 }).map((_, index) => (
                  <article
                    aria-hidden="true"
                    className="pet-catalog-card tw:grid tw:min-w-0 tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border tw:bg-app-raised tw:shadow-none pet-catalog-skeleton-card tw:pointer-events-none"
                    key={index}
                  >
                    <SkeletonBlock className="pet-catalog-skeleton-art tw:h-33 tw:rounded-none" />
                    <div className="pet-catalog-card-body tw:grid tw:min-w-0 tw:grid-rows-[auto_auto_minmax(3.5em,1fr)_auto_auto] tw:gap-2 tw:p-3">
                      <SkeletonBlock className="pet-catalog-skeleton-title tw:h-4.5 tw:w-[62%] tw:rounded-md" />
                      <SkeletonBlock className="pet-catalog-skeleton-author tw:h-3.5 tw:w-[44%] tw:rounded-md" />
                      <SkeletonBlock className="pet-catalog-skeleton-description tw:h-[3.5em] tw:w-full tw:rounded-lg" />
                      <div className="pet-catalog-skeleton-tags tw:flex tw:gap-2 tw:[&>*]:h-[22px] tw:[&>*]:w-[58px] tw:[&>*]:rounded-full">
                        <SkeletonBlock />
                        <SkeletonBlock />
                      </div>
                      <SkeletonBlock className="pet-catalog-skeleton-action tw:h-7 tw:w-full tw:rounded-md" />
                    </div>
                  </article>
                ))}
              </SkeletonRegion>
            ) : null}
            {tab === 'installed' && installedPetsLoading && !groups.installed.length ? (
              <div
                className="pet-catalog-empty tw:grid tw:justify-items-center tw:gap-2 tw:px-4 tw:py-12 tw:text-center tw:text-app-text-meta"
                role="status"
              >
                <Spinner size="medium" />
                正在载入已安装宠物…
              </div>
            ) : null}
            {tab === 'available' && !loading && catalog.cacheState === 'unavailable' ? (
              <div className="pet-catalog-empty tw:grid tw:justify-items-center tw:gap-2 tw:px-4 tw:py-12 tw:text-center tw:text-app-text-meta">
                <PawPrint size={APP_ICON_SIZE} />
                <strong className="tw:text-app-text">暂时无法获取社区目录</strong>
                <span>请检查网络连接；已安装的宠物仍可正常使用。</span>
                <Button color="secondary" onClick={() => void loadCatalog(true)} type="button">
                  重试
                </Button>
              </div>
            ) : null}
            {!loading &&
            !(tab === 'available' && catalog.cacheState === 'unavailable') &&
            hasFilters &&
            !visiblePets.length ? (
              <div className="pet-catalog-empty tw:grid tw:justify-items-center tw:gap-2 tw:px-4 tw:py-12 tw:text-center tw:text-app-text-meta">
                <SearchX size={APP_ICON_SIZE} />
                <strong className="tw:text-app-text">没有匹配的宠物</strong>
                <span>尝试更换关键词或筛选条件。</span>
                <Button color="secondary" onClick={clearFilters} type="button">
                  清除筛选
                </Button>
              </div>
            ) : null}
            {!loading &&
            !hasFilters &&
            tab === 'installed' &&
            !installedPetsLoading &&
            !activePets.length ? (
              <div className="pet-catalog-empty tw:grid tw:justify-items-center tw:gap-2 tw:px-4 tw:py-12 tw:text-center tw:text-app-text-meta">
                <PawPrint size={APP_ICON_SIZE} />
                <strong className="tw:text-app-text">还没有安装宠物</strong>
                <span>前往“未安装”挑选一个桌面伙伴。</span>
                <Button color="secondary" onClick={() => setTab('available')} type="button">
                  浏览未安装
                </Button>
              </div>
            ) : null}
            {!loading &&
            !hasFilters &&
            tab === 'available' &&
            catalog.cacheState !== 'unavailable' &&
            !activePets.length ? (
              <div className="pet-catalog-empty tw:grid tw:justify-items-center tw:gap-2 tw:px-4 tw:py-12 tw:text-center tw:text-app-text-meta">
                <PawPrint size={APP_ICON_SIZE} />
                <strong className="tw:text-app-text">社区宠物均已安装</strong>
                <span>可以前往“已安装”切换当前使用的宠物。</span>
                <Button color="secondary" onClick={() => setTab('installed')} type="button">
                  查看已安装
                </Button>
              </div>
            ) : null}

            {visiblePets.length ? (
              <div className="pet-catalog-grid tw:mt-4 tw:grid tw:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] tw:gap-3">
                {visiblePets.map((pet) => {
                  const installed = pet.installed || installedIds.has(pet.id)
                  const selected = selectedPetId === pet.id
                  const installing = installingSlug === pet.id
                  return (
                    <article
                      className="pet-catalog-card tw:grid tw:min-w-0 tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border tw:bg-app-raised tw:shadow-none"
                      key={pet.id}
                    >
                      <div className="pet-catalog-art tw:flex tw:h-33 tw:items-center tw:justify-center tw:overflow-hidden tw:bg-app-editor tw:p-3 tw:text-app-text tw:[&_.pet-sprite]:flex-none tw:[&_.pet-sprite]:bg-no-repeat">
                        {installed && pet.spritesheetUrl ? (
                          <PetSprite
                            animation="idle"
                            size={100}
                            spriteVersionNumber={pet.spriteVersionNumber}
                            spritesheetUrl={pet.spritesheetUrl}
                          />
                        ) : pet.previewUrl ? (
                          <RemoteImage
                            alt=""
                            className="pet-catalog-preview tw:flex tw:size-full tw:items-center tw:justify-center tw:[&_.ui-skeleton-block]:rounded-lg"
                            decoding="async"
                            fallback={
                              <PawPrint
                                data-icon-kind="artwork"
                                aria-hidden="true"
                                size={APP_ICON_SIZE}
                              />
                            }
                            imageClassName="pet-catalog-preview__image tw:block tw:m-auto tw:h-auto tw:max-h-full tw:w-auto tw:max-w-full tw:object-scale-down"
                            loading="lazy"
                            src={pet.previewUrl}
                          />
                        ) : (
                          <PawPrint aria-hidden="true" size={APP_ICON_SIZE} />
                        )}
                      </div>
                      <div className="pet-catalog-card-body tw:grid tw:min-w-0 tw:grid-rows-[auto_auto_minmax(3.5em,1fr)_auto_auto] tw:gap-2 tw:p-3">
                        <div className="pet-catalog-card-heading tw:flex tw:items-center tw:justify-between tw:gap-2 tw:text-app-text">
                          <strong>{pet.displayName}</strong>
                          <span className="tw:shrink-0 tw:type-caption tw:text-app-text-meta">
                            v{pet.spriteVersionNumber}
                          </span>
                        </div>
                        {pet.author ? (
                          <p className="pet-catalog-author tw:m-0 tw:type-body-sm tw:text-app-text-meta">
                            作者：{pet.author}
                          </p>
                        ) : (
                          <p className="pet-catalog-author tw:m-0 tw:type-body-sm tw:text-app-text-meta">
                            自定义来源
                          </p>
                        )}
                        <p className="pet-catalog-description tw:m-0 tw:line-clamp-3 tw:type-body-sm tw:text-app-text-meta">
                          {pet.description || '这个宠物还没有介绍。'}
                        </p>
                        <div className="pet-catalog-tags tw:flex tw:flex-wrap tw:gap-2">
                          <span className="tw:rounded-full tw:bg-app-hover tw:px-2 tw:py-1 tw:type-caption tw:text-app-text-meta">
                            {pet.categoryLabel}
                          </span>
                          {pet.licenseKind ? (
                            <span
                              className="tw:rounded-full tw:bg-app-hover tw:px-2 tw:py-1 tw:type-caption tw:text-app-text-meta tw:data-[license=restricted]:text-app-warning tw:data-[license=unknown]:text-app-warning"
                              data-license={pet.licenseKind}
                            >
                              {petLicenseLabel(pet.licenseKind)}
                            </span>
                          ) : null}
                        </div>
                        <Button
                          color="primary"
                          disabled={selected || installing}
                          loading={installing}
                          onClick={() => choosePet(pet)}
                          type="button"
                        >
                          {!installing && !installed ? <Download size={APP_ICON_SIZE} /> : null}
                          {installing
                            ? '安装中'
                            : selected
                              ? '使用中'
                              : installed
                                ? '使用'
                                : '安装并使用'}
                        </Button>
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : null}
          </div>
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
    </>
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
