import { SkeletonBlock, SkeletonRegion } from '../../components/ui/Skeleton.js'
import { useLocale } from '../i18n/LocaleProvider.js'
import { PrimaryPageLayout } from '../layout/primary-page/index.js'

export function GitBoardRepositorySkeleton() {
  const { t } = useLocale()
  return (
    <SkeletonRegion
      label={t('正在加载 Git 工作区…')}
      shimmer
      className="tw:grid tw:gap-4 tw:px-2 tw:py-3"
    >
      {[0, 1, 2].map((section) => (
        <div key={section} className="tw:grid tw:gap-3">
          <SkeletonBlock className="tw:h-4 tw:w-24 tw:rounded-md" />
          {[0, 1, 2].map((row) => (
            <div key={row} className="tw:flex tw:items-center tw:gap-2">
              <SkeletonBlock className="tw:size-4 tw:shrink-0 tw:rounded-sm" />
              <SkeletonBlock className="tw:h-4 tw:w-3/4 tw:rounded-md" />
            </div>
          ))}
        </div>
      ))}
    </SkeletonRegion>
  )
}

export function GitBoardPageFallback() {
  const { t } = useLocale()
  return (
    <PrimaryPageLayout
      title={t('Git 看板')}
      className="tw:overflow-y-hidden tw:[--page-content-max-width:100%] tw:[&.primary-page-layout]:[scrollbar-gutter:auto]"
      bodyClassName="tw:min-h-0 tw:basis-0 tw:overflow-hidden tw:pb-2"
      actions={<SkeletonBlock className="tw:h-9 tw:w-40 tw:rounded-full" shimmer />}
    >
      <div className="tw:flex tw:min-h-0 tw:min-w-0 tw:flex-1 tw:overflow-hidden">
        <div className="tw:h-full tw:w-[360px] tw:min-w-[360px] tw:flex-none tw:overflow-hidden tw:border-r tw:border-app-border-subtle tw:pr-3">
          <GitBoardRepositorySkeleton />
        </div>
        <div className="tw:flex tw:h-full tw:min-w-[360px] tw:flex-1 tw:items-center tw:justify-center tw:overflow-hidden tw:bg-app-main tw:p-4">
          <SkeletonBlock className="tw:h-4 tw:w-64 tw:max-w-full tw:rounded-md" shimmer />
        </div>
      </div>
    </PrimaryPageLayout>
  )
}
