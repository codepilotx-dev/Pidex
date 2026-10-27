import { useShallow } from 'zustand/react/shallow'
import { useCallback, useEffect, useState } from 'react'
import type React from 'react'
import { useNavigate } from 'react-router-dom'
import type { PetCatalogResult, PetDescriptor } from '@pidex/agent-protocol'
import { RefreshCw, Settings } from 'lucide-react'
import { GlobalErrorModal } from '../../components/GlobalErrorModal.js'
import { Button } from '../../components/ui/Button.js'
import { SearchInput } from '../../components/ui/SearchInput.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { PrimaryPageLayout } from '../layout/primary-page/index.js'
import { SettingsDropdown } from '../settings/SettingsDropdown.js'
import { PetCatalogSection } from './PetCatalogSection.js'
import { usePetCatalogController } from './PetCatalogProvider.js'
import { useLocale } from '../i18n/LocaleProvider.js'
import type { PetCatalogVersionFilter } from './PetCatalogModel.js'

const EMPTY_CATALOG: PetCatalogResult = {
  pets: [],
  fetchedAt: null,
  cacheState: 'unavailable',
}

const CATALOG_REFRESH_INTERVAL_MS = 5 * 60 * 60 * 1_000

export function PetCatalogPage(): React.ReactNode {
  const navigate = useNavigate()
  const { t } = useLocale()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<PetCatalogResult>(EMPTY_CATALOG)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [version, setVersion] = useState<PetCatalogVersionFilter>('all')

  const { busy, pets, refreshPets, selectPet, setEnabled, enabled, selectedPetId } =
    usePetCatalogController(
      useShallow((state) => ({
        busy: state.busy,
        pets: state.pets,
        refreshPets: state.refreshPets,
        selectPet: state.selectPet,
        setEnabled: state.setEnabled,
        enabled: state.settings.enabled,
        selectedPetId: state.settings.selectedPetId,
      })),
    )

  const loadCatalog = useCallback(async (refresh = false): Promise<void> => {
    setLoading(true)
    try {
      setCatalog(await desktopClient.listPetCatalog(refresh))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCatalog()
    const timer = window.setInterval(() => void loadCatalog(true), CATALOG_REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [loadCatalog])

  const installAndSelect = async (installed: PetDescriptor): Promise<void> => {
    await refreshPets()
    await selectPet(installed.id)
  }

  const headerActions = (
    <div className="pet-catalog-header-actions tw:flex tw:min-w-0 tw:items-center tw:gap-2">
      <Button
        aria-busy={loading}
        disabled={loading}
        isIconOnly
        onClick={() => void loadCatalog(true)}
        shape="pill"
        size="md"
        title={t('刷新社区宠物目录')}
        variant="ghost"
      >
        <RefreshCw
          aria-hidden="true"
          className={loading ? 'tw:animate-spin' : undefined}
          size={APP_ICON_SIZE}
          strokeWidth={APP_ICON_STROKE_WIDTH}
        />
      </Button>
      <Button
        isIconOnly
        onClick={() => navigate('/settings/pets')}
        shape="pill"
        size="md"
        title={t('宠物设置')}
        variant="ghost"
      >
        <Settings aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      </Button>
    </div>
  )

  const headerSearch = (
    <div className="pet-catalog-filters tw:flex tw:items-center tw:gap-2">
      <div className="tw:flex-1 tw:min-w-0">
        <SearchInput
          aria-label="搜索社区宠物"
          onChange={setQuery}
          placeholder="搜索名称、作者或描述"
          shape="pill"
          size="md"
          value={query}
          variant="outlined"
        />
      </div>
      <SettingsDropdown
        ariaLabel="宠物图集版本"
        onChange={(val) => {
          setVersion(val === 'all' ? 'all' : (Number(val) as 1 | 2))
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
  )

  return (
    <>
      <GlobalErrorModal message={errorMessage} onDismiss={() => setErrorMessage(null)} />
      <GlobalErrorModal
        message={noticeMessage}
        onDismiss={() => setNoticeMessage(null)}
        tone="status"
      />
      <PrimaryPageLayout
        actions={headerActions}
        className="pet-catalog-primary-page tw:@container/pet-catalog-page"
        description="浏览并一键安装 awesome-codex-pet 社区中的桌面伙伴。"
        search={headerSearch}
        title={t('宠物')}
      >
        <PetCatalogSection
          catalog={catalog}
          catalogLoading={loading}
          installedPets={pets}
          installedPetsLoading={busy}
          onClearFilters={() => {
            setQuery('')
            setVersion('all')
          }}
          onEnableOverlay={() => setEnabled(true)}
          onError={setErrorMessage}
          onInstalled={installAndSelect}
          onNotice={setNoticeMessage}
          onRefreshCatalog={() => void loadCatalog(true)}
          onRefreshPets={refreshPets}
          onSelect={(id) => void selectPet(id)}
          onUpdateCatalog={setCatalog}
          overlayEnabled={enabled}
          query={query}
          selectedPetId={selectedPetId}
          version={version}
        />
      </PrimaryPageLayout>
    </>
  )
}
