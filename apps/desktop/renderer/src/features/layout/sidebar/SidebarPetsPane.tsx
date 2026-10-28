import { useShallow } from 'zustand/react/shallow'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Settings } from 'lucide-react'
import { Button } from '../../../components/ui/Button.js'
import { APP_ICON_SIZE } from '../../../components/ui/IconTokens.js'
import { ScrollArea } from '../../../components/ui/ScrollArea.js'
import { useLocale } from '../../i18n/LocaleProvider.js'
import { usePetCatalogController } from '../../pet/PetCatalogProvider.js'
import { PetSprite } from '../../pet/PetSprite.js'
import { SidebarEmptyRow, SidebarRow } from '../../../components/ui/SidebarRow.js'

export function SidebarPetsPane(): ReactNode {
  const { t } = useLocale()
  const navigate = useNavigate()
  const { busy, pets, selectPet, selectedPetId } = usePetCatalogController(
    useShallow((state) => ({
      busy: state.busy,
      pets: state.pets,
      selectPet: state.selectPet,
      selectedPetId: state.settings.selectedPetId,
    })),
  )
  return (
    <div className="sidebar-pets-pane tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:py-2">
      <header className="sidebar-pane-heading tw:flex tw:min-h-9 tw:shrink-0 tw:items-center tw:justify-between tw:px-3">
        <h2 className="tw:m-0 tw:text-app-text tw:type-title-sm">{t('宠物')}</h2>
        <Button
          color="ghostSecondary"
          isIconOnly
          size="toolbar"
          title={t('宠物设置')}
          onClick={() => navigate('/settings/pets')}
        >
          <Settings aria-hidden size={APP_ICON_SIZE} />
        </Button>
      </header>
      <h3 className="tw:m-0 tw:flex tw:min-h-[var(--sidebar-row-height)] tw:shrink-0 tw:items-center tw:px-4 tw:text-app-text-meta tw:type-body">
        {t('已安装')}
      </h3>
      <ScrollArea
        className="tw:min-h-0 tw:flex-1 tw:px-2 tw:pb-2 tw:pt-0"
        contentClassName="tw:flex tw:flex-col tw:sidebar-row-gap"
      >
        {pets.length === 0 ? (
          <SidebarEmptyRow role="status">
            {t(busy ? '正在载入已安装宠物…' : '还没有安装宠物')}
          </SidebarEmptyRow>
        ) : (
          pets.map((pet) => {
            const selected = pet.id === selectedPetId
            return (
              <SidebarRow
                active={selected}
                asChild
                key={pet.id}
                layout="flex"
                className="tw:min-h-18 tw:py-2"
                labelClassName="tw:min-w-0 tw:gap-3"
                leadingMode="none"
                trailing={
                  selected ? <Check aria-label={t('使用中')} size={APP_ICON_SIZE} /> : undefined
                }
              >
                <button
                  aria-pressed={selected}
                  type="button"
                  onClick={() => {
                    navigate('/pets')
                    void selectPet(pet.id)
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="tw:flex tw:w-12 tw:shrink-0 tw:items-center tw:justify-center"
                  >
                    <PetSprite
                      animation="idle"
                      size={48}
                      spritesheetUrl={pet.spritesheetUrl}
                      spriteVersionNumber={pet.spriteVersionNumber}
                    />
                  </span>
                  <span className="tw:flex tw:min-w-0 tw:flex-1 tw:flex-col tw:gap-1">
                    <span className="tw:truncate tw:type-row-title">{pet.displayName}</span>
                    {pet.description ? (
                      <span className="tw:line-clamp-2 tw:text-app-text-meta tw:type-body-sm">
                        {pet.description}
                      </span>
                    ) : null}
                  </span>
                </button>
              </SidebarRow>
            )
          })
        )}
      </ScrollArea>
    </div>
  )
}
