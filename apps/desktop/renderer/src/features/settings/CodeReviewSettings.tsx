import { useState } from 'react'
import { SettingsContentArea } from './SettingsContentArea.js'
import { SettingsSection } from './SettingsSection.js'
import { SettingsRow } from './SettingsRow.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { useDesktopSettings } from './UseDesktopSettings.js'
import { PrWatchSettings } from './PrWatchSettings.js'

export function CodeReviewSettings() {
  const { draft } = useDesktopSettings()
  const [error, setError] = useState<string | null>(null)
  return (
    <SettingsContentArea>
      <div className="settings-content-inner tw:grid tw:gap-6 tw:w-full tw:min-w-0 tw:mx-auto tw:p-5 tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]">
        <header className="tw:grid tw:gap-2">
          <h1 className="tw:m-0 tw:type-title-xl tw:text-app-text">代码审查</h1>
          <p className="tw:m-0 tw:type-body-sm tw:text-app-text-soft">
            管理本地 AI 审查的呈现方式，以及 Pull Request 的持续监控和修复。
          </p>
        </header>
        <SettingsSection
          title="AI 代码审查"
          description="从聊天或 Git 操作中启动审查。项目审查指引沿用仓库中的 AGENTS.md。"
        >
          <SettingsRow
            title="审查结果呈现方式"
            description="在当前聊天中审查，或创建单独的审查聊天。"
            control={
              <SegmentedControl<'inline' | 'detached'>
                ariaLabel="审查结果呈现方式"
                value={draft.values.reviewDelivery}
                options={[
                  { value: 'inline', label: '内联' },
                  { value: 'detached', label: '单独' },
                ]}
                onChange={(value) => {
                  draft.setValue('reviewDelivery', value)
                  void draft
                    .saveFields(['reviewDelivery'])
                    .catch((cause) => setError(cause instanceof Error ? cause.message : '保存失败'))
                }}
              />
            }
          />
          {error ? (
            <p role="alert" className="tw:p-3 tw:type-caption tw:text-app-danger">
              {error}
            </p>
          ) : null}
        </SettingsSection>
        <PrWatchSettings />
      </div>
    </SettingsContentArea>
  )
}
