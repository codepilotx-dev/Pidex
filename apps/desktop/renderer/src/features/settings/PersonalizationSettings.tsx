import React from 'react'
import { useDesktopSettings } from './UseDesktopSettings.js'
import type { DesktopPersonality } from '../../../shared/Types.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { Button } from '../../components/ui/Button.js'

const PERSONALITY_OPTIONS: Array<{
  value: DesktopPersonality
  label: string
}> = [
  { value: 'pragmatic', label: '务实' },
  { value: 'friendly', label: '友好' },
  { value: 'concise', label: '严谨' },
  { value: 'encouraging', label: '鼓励' },
]

type Props = {
  onError?: (message: string) => void
  onNotice?: (message: string) => void
}

export function PersonalizationSettings({ onError, onNotice }: Props = {}): React.ReactNode {
  const { draft } = useDesktopSettings()

  async function saveCustomInstructions(): Promise<void> {
    try {
      await draft.save()
      onNotice?.('设置已保存')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      onError?.(message)
    }
  }

  return (
    <SettingsContentArea className="">
      <div className="settings-content-inner tw:@container tw:w-full tw:min-w-0 tw:mx-auto tw:p-5 tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]">
        <div className="settings-page-header tw:mt-0 tw:mx-0 tw:mb-8 tw:grid tw:gap-2">
          <h2 className="settings-page-title tw:m-0 tw:type-title-xl tw:text-app-text tw:tracking-[-0.01em]">
            个性化
          </h2>
        </div>

        <SettingsSection>
          <SettingsRow
            title="个性"
            description="选择 Pidex 回复的默认语气"
            autoSave
            control={
              <SettingsDropdown
                size="md"
                ariaLabel="个性"
                value={draft.values.personality}
                options={PERSONALITY_OPTIONS}
                onChange={(value) => {
                  draft.setValue('personality', value as DesktopPersonality)
                  draft.autoSave()
                }}
              />
            }
          />
        </SettingsSection>

        <SettingsSection
          title="自定义指令"
          description={<>为此主机上的所有任务向 Pidex 提供额外说明和上下文。</>}
        >
          <div className="personalization-instructions-editor tw:grid tw:gap-3">
            <textarea
              className="settings-textarea settings-textarea-tall personalization-textarea tw:min-h-105 tw:w-full tw:font-mono tw:text-[length:var(--cpx-sys-font-size-code)] tw:[line-height:var(--cpx-sys-line-height-code)]"
              onChange={(event) => draft.setValue('customInstructions', event.target.value)}
              placeholder="1、用 utf-8 读取文件！&#10;2、不写测试"
              value={draft.values.customInstructions}
            />
            <div className="personalization-actions tw:flex tw:justify-end">
              <Button
                color="primary"
                disabled={draft.saving}
                onClick={() => void saveCustomInstructions()}
                type="button"
              >
                {draft.saving ? '保存中' : '保存'}
              </Button>
            </div>
          </div>
        </SettingsSection>
      </div>
    </SettingsContentArea>
  )
}
