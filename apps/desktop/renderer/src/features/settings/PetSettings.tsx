import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PetInstallPreview } from '@pidex/agent-protocol'
import { PawPrint, RefreshCw, Trash2 } from 'lucide-react'
import { desktopClient } from '../../services/desktop-client/index.js'
import { Button } from '../../components/ui/Button.js'

import { Input } from '../../components/ui/Input.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../components/ui/IconTokens.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { usePetSettingsController } from '../pet/UsePetSettingsController.js'

type Props = {
  onError: (message: string) => void
  onNotice?: (message: string) => void
}

export function PetSettings({ onError, onNotice }: Props): React.ReactNode {
  const navigate = useNavigate()
  const [sourceUrl, setSourceUrl] = useState('')
  const [preview, setPreview] = useState<PetInstallPreview | null>(null)
  const [operationBusy, setOperationBusy] = useState(false)
  const {
    busy: petsBusy,
    flushPendingSize,
    pets,
    previewSize,
    refreshPets,
    selectPet,
    setEnabled,
    settings,
    updatePet,
  } = usePetSettingsController({ onError })
  const busy = petsBusy || operationBusy

  const loadPreview = async (): Promise<void> => {
    const url = sourceUrl.trim()
    if (!url) return
    setOperationBusy(true)
    try {
      setPreview(await desktopClient.previewPetInstall(url))
    } catch (error) {
      setPreview(null)
      onError(messageOf(error))
    } finally {
      setOperationBusy(false)
    }
  }

  const install = async (): Promise<void> => {
    const url = sourceUrl.trim()
    if (!url || !preview) return
    setOperationBusy(true)
    try {
      const installed = await desktopClient.installPet(url)
      await refreshPets()
      setPreview(null)
      setSourceUrl('')
      await selectPet(installed.id)
      onNotice?.(`已安装 ${installed.displayName}`)
    } catch (error) {
      onError(messageOf(error))
    } finally {
      setOperationBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    const id = settings.selectedPetId
    if (!id) return
    const pet = pets.find((item) => item.id === id)
    if (!window.confirm(`删除宠物 ${pet?.displayName ?? id}？`)) return
    setOperationBusy(true)
    try {
      await desktopClient.removePet(id)
      await refreshPets()
      onNotice?.('宠物已删除')
    } catch (error) {
      onError(messageOf(error))
    } finally {
      setOperationBusy(false)
    }
  }

  return (
    <SettingsContentArea className="pet-settings-page">
      <div className="settings-content-inner tw:@container tw:w-full tw:min-w-0 tw:mx-auto tw:p-5 tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]">
        <div className="settings-page-header tw:mt-0 tw:mx-0 tw:mb-8 tw:grid tw:gap-2">
          <h2 className="settings-page-title tw:m-0 tw:type-title-xl tw:text-app-text tw:tracking-[-0.01em]">
            宠物
          </h2>
          <p className="settings-page-desc tw:m-0 tw:max-w-[68ch] tw:text-app-text-soft tw:type-body-sm">
            桌面伙伴会跟随任务状态，并把需要你处理的事项带到最前面。
          </p>
        </div>

        <SettingsSection title="桌面伙伴">
          <SettingsRow
            title="唤醒宠物"
            description="在所有工作区上方显示透明宠物浮窗"
            autoSave
            control={
              <ToggleSwitch
                ariaLabel="唤醒宠物"
                checked={settings.enabled}
                onChange={(value) => void setEnabled(value)}
              />
            }
          />
          <SettingsRow
            title="选择宠物"
            description={pets.length ? '使用已安装的宠物包' : '尚未安装宠物'}
            autoSave
            control={
              <div className="pet-settings-inline tw:flex tw:items-center tw:gap-2">
                <SettingsDropdown
                  ariaLabel="选择宠物"
                  disabled={!pets.length}
                  onChange={(value) => void selectPet(value || null)}
                  triggerClassName="tw:min-w-45"
                  options={
                    pets.length
                      ? pets.map((pet) => ({
                          value: pet.id,
                          label: pet.displayName,
                        }))
                      : [{ value: '', label: '无可用宠物' }]
                  }
                  showSelectedIndicator
                  value={settings.selectedPetId ?? ''}
                  size="sm"
                />
                <Button
                  isIconOnly
                  color="ghostSecondary"
                  disabled={busy}
                  onClick={() => void refreshPets()}
                  size="toolbar"
                  title="刷新宠物"
                >
                  <RefreshCw size={APP_ICON_SIZE} />
                </Button>
                <Button
                  isIconOnly
                  color="ghostSecondary"
                  disabled={busy || !settings.selectedPetId}
                  onClick={() => void remove()}
                  size="iconMd"
                  title="删除当前宠物"
                >
                  <Trash2 size={APP_ICON_SIZES.sm} />
                </Button>
              </div>
            }
          />
          <SettingsRow
            title="宠物大小"
            description={`${settings.size} px（图集单元比例 192:208）`}
            autoSave
            control={
              <input
                aria-label="宠物大小"
                max={224}
                min={80}
                type="range"
                value={settings.size}
                onBlur={flushPendingSize}
                onChange={(event) => previewSize(Number(event.target.value))}
                onPointerUp={flushPendingSize}
              />
            }
          />
        </SettingsSection>

        <SettingsSection title="任务提醒">
          <SettingsRow
            title="需要处理"
            description="审批、问题和计划等待时保持提醒"
            autoSave
            control={
              <ToggleSwitch
                ariaLabel="需要处理提醒"
                checked={settings.notifyAttention}
                onChange={(value) => updatePet({ notifyAttention: value })}
              />
            }
          />
          <SettingsRow
            title="任务完成"
            description="任务完成后显示短时提醒"
            autoSave
            control={
              <ToggleSwitch
                ariaLabel="任务完成提醒"
                checked={settings.notifyCompletion}
                onChange={(value) => updatePet({ notifyCompletion: value })}
              />
            }
          />
          <SettingsRow
            title="任务失败"
            description="任务失败或中断时显示高优先级提醒"
            autoSave
            control={
              <ToggleSwitch
                ariaLabel="任务失败提醒"
                checked={settings.notifyFailure}
                onChange={(value) => updatePet({ notifyFailure: value })}
              />
            }
          />
        </SettingsSection>

        <SettingsSection title="社区宠物商店">
          <SettingsRow
            title="浏览社区宠物"
            description="搜索并一键安装社区提供的桌面伙伴"
            control={
              <Button color="secondary" onClick={() => navigate('/pets')} type="button">
                打开宠物商店
              </Button>
            }
          />
        </SettingsSection>

        <SettingsSection
          title="从链接安装"
          description="输入 pet.json 的 HTTPS 地址；localhost 开发地址可使用 HTTP。"
        >
          <div className="pet-settings-installer tw:flex tw:w-full tw:items-center tw:gap-2 tw:p-4">
            <Input
              className="tw:flex-1"
              value={sourceUrl}
              onChange={(event) => {
                setSourceUrl(event.target.value)
                setPreview(null)
              }}
              placeholder="https://example.com/my-pet/pet.json"
            />
            <Button
              color="secondary"
              disabled={busy || !sourceUrl.trim()}
              onClick={() => void loadPreview()}
              type="button"
            >
              预览
            </Button>
          </div>
          {preview ? (
            <div className="pet-settings-preview tw:mx-4 tw:mt-0 tw:mb-4 tw:flex tw:items-center tw:gap-2 tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-panel tw:p-3">
              <PawPrint size={APP_ICON_SIZE} />
              <div className="tw:flex-1">
                <strong>{preview.pet.displayName}</strong>
                <p className="tw:mt-1 tw:mb-0 tw:text-app-text-meta tw:type-body-sm">
                  {preview.pet.description || '无描述'} · v{preview.pet.spriteVersionNumber} ·{' '}
                  {(preview.sizeBytes / 1024).toFixed(1)} KiB
                </p>
              </div>
              <Button color="primary" disabled={busy} onClick={() => void install()} type="button">
                安装
              </Button>
            </div>
          ) : null}
        </SettingsSection>
      </div>
    </SettingsContentArea>
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
