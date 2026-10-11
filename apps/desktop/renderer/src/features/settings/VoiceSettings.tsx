import React, { useCallback, useEffect, useState } from 'react'
import { desktopClient } from '../../services/desktop-client/index.js'
import { Button } from '../../components/ui/Button.js'
import { useSpeechStatus } from '../speech/UseSpeechStatus.js'
import { useLocale } from '../i18n/LocaleProvider.js'
import { useDesktopSettings } from './UseDesktopSettings.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'

function speechStatusLabel(
  status: import('../../services/desktop-client/index.js').DesktopSpeechStatus | null,
  loading: boolean,
): string {
  if (loading && !status) return '检查中…'
  if (!status) return '不可用'
  if (status.state === 'unsupported') return '不支持'
  if (status.state === 'not-installed') return '未安装'
  if (status.state === 'downloading') return '下载中'
  if (status.state === 'installing') return '安装中'
  if (status.state === 'ready') return '已就绪'
  if (status.state === 'transcribing') return '转写中'
  return '出错'
}

function speechStatusDescription(
  status: import('../../services/desktop-client/index.js').DesktopSpeechStatus | null,
  error: string | null,
): string {
  const message = status?.error?.message ?? error
  if (message) return message
  const progress = status?.progress
  if (progress) {
    if (progress.totalBytes) {
      return `SenseVoice 本地运行时 · ${Math.round((progress.receivedBytes / progress.totalBytes) * 100)}%`
    }
    return `SenseVoice 本地运行时 · 已接收 ${Math.round(progress.receivedBytes / 1_048_576)} MB`
  }
  return 'SenseVoice Small 在本机离线转写，音频不会发送到云端。'
}

export function VoiceSettings({ onNotice }: { onNotice?: (message: string) => void }) {
  const { t } = useLocale()
  const { draft } = useDesktopSettings()
  const preferredInputDeviceId = draft.values['desktop.voice.preferredInputDeviceId']
  const speech = useSpeechStatus()
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([])
  const refreshAudioInputs = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const devices = await navigator.mediaDevices.enumerateDevices()
    setAudioInputs(devices.filter((device) => device.kind === 'audioinput'))
  }, [])
  useEffect(() => {
    void refreshAudioInputs().catch(() => {})
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshAudioInputs)
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshAudioInputs)
    }
  }, [refreshAudioInputs])
  const setPreferredInputDeviceId = useCallback(
    (value: string) => {
      draft.setValue('desktop.voice.preferredInputDeviceId', value)
      draft.autoSave()
    },
    [draft],
  )

  return (
    <SettingsContentArea>
      <div className="settings-content-inner tw:@container tw:w-full tw:min-w-0 tw:mx-auto tw:p-5 tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]">
        <div className="settings-page-header tw:mt-0 tw:mx-0 tw:mb-8 tw:grid tw:gap-2">
          <h2 className="settings-page-title tw:m-0 tw:type-title-xl tw:text-app-text tw:tracking-[-0.01em]">
            {t('语音')}
          </h2>
        </div>

        <SettingsSection>
          <SettingsRow
            title="本地语音模型"
            description={speechStatusDescription(speech.status, speech.error)}
            control={
              <>
                <span className="settings-row-status">
                  {speechStatusLabel(speech.status, speech.loading)}
                </span>
                {speech.status?.state === 'error' || speech.status?.state === 'not-installed' ? (
                  <Button
                    disabled={speech.loading}
                    onClick={() => void speech.install(true)}
                    type="button"
                  >
                    重试
                  </Button>
                ) : null}
              </>
            }
          />
          <SettingsRow
            title="输入设备"
            description="录音时优先使用的麦克风；不可用时自动回退到系统默认设备。"
            control={
              <SettingsDropdown
                size="md"
                value={preferredInputDeviceId}
                options={[
                  { value: '', label: '系统默认麦克风' },
                  ...audioInputs.map((device, index) => ({
                    value: device.deviceId,
                    label: device.label || `麦克风 ${index + 1}`,
                  })),
                ]}
                onChange={setPreferredInputDeviceId}
                ariaLabel="听写输入设备"
              />
            }
          />
          <SettingsRow
            title="听写快捷键"
            description="在当前消息输入框中开始或停止听写。"
            control={<span className="settings-row-status">Ctrl+Shift+D</span>}
          />
          <SettingsRow
            title="麦克风隐私设置"
            description="打开 Windows 麦克风权限页面，允许 Pidex 使用输入设备。"
            control={
              <Button
                onClick={() => {
                  void desktopClient.openMicrophonePrivacySettings().catch((error) => {
                    onNotice?.(error instanceof Error ? error.message : String(error))
                  })
                }}
                type="button"
              >
                打开设置
              </Button>
            }
          />
        </SettingsSection>
      </div>
    </SettingsContentArea>
  )
}
