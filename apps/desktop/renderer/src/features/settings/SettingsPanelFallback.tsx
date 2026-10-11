import type React from 'react'
import { SkeletonBlock, SkeletonRegion } from '../../components/ui/Skeleton.js'
import { useLocale } from '../i18n/LocaleProvider.js'
import { SettingsContentArea } from './SettingsContentArea.js'

type Props = {
  label?: string
}

const FALLBACK_ROW_COUNT = 3

export function SettingsPanelFallback({ label }: Props = {}): React.ReactNode {
  const { t } = useLocale()
  return (
    <SettingsContentArea>
      <div className="settings-content-inner tw:@container tw:w-full tw:min-w-0 tw:mx-auto tw:p-5 tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]">
        <SkeletonRegion
          label={t('设置加载中')}
          className="settings-panel-fallback tw:grid tw:gap-8"
        >
          {label == null ? null : (
            <div className="settings-page-header tw:mt-0 tw:mx-0 tw:mb-0 tw:grid tw:gap-2">
              <h2 className="settings-page-title tw:m-0 tw:type-title-xl tw:text-app-text tw:tracking-[-0.01em]">
                {t(label)}
              </h2>
            </div>
          )}
          <section className="settings-section tw:min-w-0">
            <div className="settings-section-content settings-card tw:grid tw:min-w-0 tw:overflow-hidden tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-panel tw:shadow-none">
              {Array.from({ length: FALLBACK_ROW_COUNT }, (_, index) => (
                <div
                  className="settings-panel-fallback-row tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-4 tw:px-4 tw:py-3"
                  key={index}
                >
                  <div className="tw:grid tw:gap-2">
                    <SkeletonBlock className="tw:h-4 tw:w-36" />
                    <SkeletonBlock className="tw:h-3 tw:w-64" />
                  </div>
                  <SkeletonBlock className="tw:h-6 tw:w-10 tw:rounded-full" />
                </div>
              ))}
            </div>
          </section>
        </SkeletonRegion>
      </div>
    </SettingsContentArea>
  )
}
