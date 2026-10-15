import React, { useState } from 'react'
import { AlertTriangle, Check, Egg, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import { PopoverItem } from '../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../components/ui/PopoverMenu.js'
import { RemoteImage } from '../../components/ui/RemoteImage.js'
import { Tooltip } from '../../components/ui/Tooltip.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import { PetSprite } from './PetSprite.js'
import {
  petLicenseLabel,
  petLicenseNeedsConfirmation,
  type PetCatalogCardItem,
} from './PetCatalogModel.js'

type Props = {
  pet: PetCatalogCardItem
  installed: boolean
  isSelected: boolean
  installing: boolean
  onInstall: (pet: PetCatalogCardItem) => void
  onSelect: (id: string) => void
  onUninstall: (pet: PetCatalogCardItem) => void
}

export function PetCatalogCard({
  pet,
  installed,
  isSelected,
  installing,
  onInstall,
  onSelect,
  onUninstall,
}: Props): React.ReactNode {
  const [menuOpen, setMenuOpen] = useState(false)
  const isRestricted = pet.licenseKind ? petLicenseNeedsConfirmation(pet.licenseKind) : false

  return (
    <article
      className="pet-catalog-card tw:flex tw:min-w-0 tw:items-center tw:gap-3 tw:rounded-item tw:border-0 tw:bg-transparent tw:p-3 tw:shadow-none tw:transition-[background-color] tw:duration-state tw:ease-standard tw:hover:bg-app-hover tw:active:bg-app-active"
      data-pet-id={pet.id}
      data-pet-installed={installed}
    >
      <div className="pet-catalog-card__art tw:flex tw:size-12 tw:shrink-0 tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-editor tw:p-1 tw:text-app-text">
        {installed && pet.spritesheetUrl ? (
          <PetSprite
            animation="idle"
            size={44}
            spriteVersionNumber={pet.spriteVersionNumber}
            spritesheetUrl={pet.spritesheetUrl}
          />
        ) : pet.previewUrl ? (
          <RemoteImage
            alt=""
            className="tw:flex tw:size-full tw:items-center tw:justify-center"
            decoding="async"
            fallback={<Egg aria-hidden="true" size={APP_ICON_SIZE} />}
            imageClassName="tw:block tw:m-auto tw:h-auto tw:max-h-full tw:w-auto tw:max-w-full tw:object-scale-down"
            loading="lazy"
            src={pet.previewUrl}
          />
        ) : (
          <Egg aria-hidden="true" size={APP_ICON_SIZE} />
        )}
      </div>

      <div className="pet-catalog-card__body tw:flex tw:min-w-0 tw:flex-1 tw:flex-col tw:justify-center tw:gap-0.5">
        <div className="pet-catalog-card__heading tw:flex tw:items-center tw:gap-1.5">
          <strong
            className="tw:truncate tw:type-row-title tw:text-app-text"
            title={pet.displayName}
          >
            {pet.displayName}
          </strong>
          {isRestricted && pet.licenseKind ? (
            <Tooltip content={`限制使用：${petLicenseLabel(pet.licenseKind)}`}>
              <span
                aria-label={`限制使用：${petLicenseLabel(pet.licenseKind)}`}
                className="tw:inline-flex tw:shrink-0 tw:text-amber-500 dark:tw:text-amber-400"
              >
                <AlertTriangle aria-hidden="true" size={14} strokeWidth={2.2} />
              </span>
            </Tooltip>
          ) : null}
          <span className="tw:shrink-0 tw:type-caption tw:text-app-text-meta">
            v{pet.spriteVersionNumber}
          </span>
        </div>
        <p
          className="tw:m-0 tw:line-clamp-2 tw:type-body-sm tw:text-app-text-meta"
          title={pet.description}
        >
          {pet.description || '这个宠物还没有介绍。'}
        </p>
      </div>

      <div className="pet-catalog-card__actions tw:flex tw:shrink-0 tw:items-center tw:justify-end">
        {installed ? (
          <span data-state={menuOpen ? 'open' : 'closed'} className="tw:inline-flex">
            <PopoverMenu
              align="end"
              open={menuOpen}
              onOpenChange={setMenuOpen}
              size="md"
              trigger={
                <Button
                  aria-label={`管理 ${pet.displayName}`}
                  color="ghostSecondary"
                  disabled={installing}
                  isIconOnly
                  size="toolbar"
                  title={`管理 ${pet.displayName}`}
                >
                  <MoreHorizontal
                    aria-hidden="true"
                    size={APP_ICON_SIZE}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                </Button>
              }
            >
              <PopoverItem
                disabled={isSelected}
                icon={isSelected ? <Check size={APP_ICON_SIZE} /> : undefined}
                onClick={() => {
                  setMenuOpen(false)
                  onSelect(pet.id)
                }}
              >
                {isSelected ? '当前使用中' : '设为当前伙伴'}
              </PopoverItem>
              <PopoverItem
                icon={<Trash2 className="tw:text-app-danger" size={APP_ICON_SIZE} />}
                onClick={() => {
                  setMenuOpen(false)
                  onUninstall(pet)
                }}
              >
                <span className="tw:text-app-danger">卸载宠物</span>
              </PopoverItem>
            </PopoverMenu>
          </span>
        ) : (
          <Tooltip content={installing ? '正在安装…' : `安装 ${pet.displayName}`}>
            <span className="tw:inline-flex">
              <Button
                aria-label={`安装 ${pet.displayName}`}
                color="ghostSecondary"
                disabled={installing}
                isIconOnly
                loading={installing}
                onClick={() => onInstall(pet)}
                size="toolbar"
                title={`安装 ${pet.displayName}`}
              >
                <Plus
                  aria-hidden="true"
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              </Button>
            </span>
          </Tooltip>
        )}
      </div>
    </article>
  )
}
