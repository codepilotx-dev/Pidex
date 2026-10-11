import type React from 'react'
import { cx } from '../../../utils/Cx.js'

export type PrimaryPageLayoutProps = {
  title: React.ReactNode
  description: React.ReactNode
  search?: React.ReactNode
  navigation?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  scrollContainerRef?: React.Ref<HTMLElement>
}

export function PrimaryPageLayout({
  title,
  description,
  search,
  navigation,
  children,
  className,
  bodyClassName,
  scrollContainerRef,
}: PrimaryPageLayoutProps): React.ReactNode {
  return (
    <section
      className={cx(
        'primary-page-layout tw:flex tw:h-full tw:min-h-0 tw:w-full tw:min-w-0 tw:flex-auto tw:flex-col tw:overflow-x-hidden tw:overflow-y-auto tw:p-5 tw:text-app-text tw:scrollbar-gutter-stable',
        className,
      )}
      ref={scrollContainerRef}
    >
      <header className="primary-page-layout__header tw:flex tw:w-[min(var(--page-content-max-width),100%)] tw:min-w-0 tw:flex-none tw:flex-col tw:mx-auto">
        <h1 className="primary-page-layout__title tw:text-app-text tw:type-title-xl">{title}</h1>
        <p className="primary-page-layout__description tw:mt-2 tw:max-w-[68ch] tw:text-app-text-soft tw:type-body tw:[&_a]:ml-1 tw:[&_a]:text-app-text tw:[&_a]:underline tw:[&_a]:underline-offset-2">
          {description}
        </p>
        {search ? (
          <div className="primary-page-layout__search tw:mt-6 tw:w-full tw:min-w-0 tw:[&_.search-input]:w-full">
            {search}
          </div>
        ) : null}
        {navigation ? (
          <nav className="primary-page-layout__navigation tw:mt-5 tw:min-w-0">{navigation}</nav>
        ) : null}
      </header>
      {/* body 的 margin-top 留在 _primary-page.scss：pull-requests 在 features 层覆盖它。 */}
      <div
        className={cx(
          'primary-page-layout__body tw:flex tw:w-[min(var(--page-content-max-width),100%)] tw:min-w-0 tw:min-h-0 tw:flex-auto tw:flex-col tw:mx-auto',
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  )
}
