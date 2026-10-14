import { useEffect, useState } from 'react'
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

export function PetCatalogPage(): React.ReactNode {
  const navigate = useNavigate()
  const { t } = useLocale()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<PetCatalogResult>(EMPTY_CATALOG)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [version, setVersion] = useState<PetCatalogVersionFilter>('all')

  const { busy, pets, refreshPets, selectPet, setEnabled, settings } = usePetCatalogController()

  const loadCatalog = async (refresh = false): Promise<void> => {
    setLoading(true)
    try {
      setCatalog(await desktopClient.listPetCatalog(refresh))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
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

  const installAndSelect = async (installed: PetDescriptor): Promise<void> => {
    await refreshPets()
    await selectPet(installed.id)
  }

  const headerActions = (
    <div className="pet-catalog-header-actions tw:flex tw:min-w-0 tw:items-center tw:gap-2">
      <Button
        isIconOnly
        aria-busy={loading}
        color="secondary"
        disabled={loading}
        onClick={() => void loadCatalog(true)}
        title={t('刷新社区宠物目录')}
      >
        <RefreshCw
          aria-hidden="true"
          size={APP_ICON_SIZE}
          strokeWidth={APP_ICON_STROKE_WIDTH}
        />
      </Button>
      <Button
        isIconOnly
        color="secondary"
        onClick={() => navigate('/settings/pets')}
        title={t('宠物设置')}
      >
        <Settings
          aria-hidden="true"
          size={APP_ICON_SIZE}
          strokeWidth={APP_ICON_STROKE_WIDTH}
        />
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
          value={query}
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
          overlayEnabled={settings.enabled}
          query={query}
          selectedPetId={settings.selectedPetId}
          version={version}
        />
      </PrimaryPageLayout>
    </>
  )
}
