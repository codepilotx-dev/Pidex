import { useState } from 'react'
import type React from 'react'
import { useNavigate } from 'react-router-dom'
import type { PetDescriptor } from '@pidex/agent-protocol'
import { PawPrint } from 'lucide-react'
import { GlobalErrorModal } from '../../components/GlobalErrorModal.js'
import { Button } from '../../components/ui/Button.js'
import { APP_ICON_SIZE } from '../../components/ui/IconTokens.js'
import { PrimaryPageLayout } from '../layout/primary-page/index.js'
import { WorkspaceHeaderItem } from '../layout/workspace-header/index.js'
import { PetCatalogSection } from './PetCatalogSection.js'
import { usePetSettingsController } from './UsePetSettingsController.js'

export function PetCatalogPage(): React.ReactNode {
  const navigate = useNavigate()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)
  const { busy, pets, refreshPets, selectPet, setEnabled, settings } = usePetSettingsController({
    onError: setErrorMessage,
  })

  const installAndSelect = async (installed: PetDescriptor): Promise<void> => {
    await refreshPets()
    await selectPet(installed.id)
  }

  return (
    <>
      <GlobalErrorModal message={errorMessage} onDismiss={() => setErrorMessage(null)} />
      <GlobalErrorModal
        message={noticeMessage}
        onDismiss={() => setNoticeMessage(null)}
        tone="status"
      />
      <WorkspaceHeaderItem align="end" id="pets.settings" order={90} slot="right">
        <Button
          color="ghostSecondary"
          onClick={() => navigate('/settings/pets')}
          size="toolbar"
          type="button"
        >
          <PawPrint size={APP_ICON_SIZE} />
          宠物设置
        </Button>
      </WorkspaceHeaderItem>
      <PrimaryPageLayout
        className="pet-catalog-primary-page tw:@container/pet-catalog-page"
        description="浏览并一键安装 awesome-codex-pet 社区中的桌面伙伴。"
        title="宠物商店"
      >
        <PetCatalogSection
          installedPets={pets}
          installedPetsLoading={busy}
          onEnableOverlay={() => setEnabled(true)}
          onError={setErrorMessage}
          onInstalled={installAndSelect}
          onNotice={setNoticeMessage}
          onSelect={(id) => void selectPet(id)}
          overlayEnabled={settings.enabled}
          selectedPetId={settings.selectedPetId}
        />
      </PrimaryPageLayout>
    </>
  )
}
