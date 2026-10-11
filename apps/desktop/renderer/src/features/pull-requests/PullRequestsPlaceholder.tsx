import type React from 'react'
import { GitPullRequest } from 'lucide-react'
import { Link } from 'react-router-dom'
import { APP_ICON_STROKE_WIDTH, APP_ICON_SIZES } from '../../components/ui/IconTokens.js'
import { PrimaryPageLayout } from '../layout/primary-page/index.js'

/*
 * The grid/typography ramp replaces the deleted `pull-requests.scss` feature
 * rules. `primary-page-layout__body` gets `tw:mt-0` here, which is the utility
 * equivalent of the old `.pull-requests-placeholder .primary-page-layout__body`
 * override (utilities win in the same cascade position).
 */
export function PullRequestsPlaceholder(): React.ReactNode {
  return (
    <PrimaryPageLayout
      bodyClassName="pull-requests-placeholder__body tw:mt-0 tw:grid tw:min-h-0 tw:flex-auto tw:content-center tw:justify-items-center tw:gap-3"
      className="pull-requests-placeholder"
      description="集中查看和处理当前工作区的拉取请求。"
      title="拉取请求"
    >
      <section
        aria-labelledby="pull-requests-empty-title"
        className="pull-requests-placeholder__empty tw:grid tw:min-h-0 tw:w-full tw:flex-auto tw:content-center tw:justify-items-center tw:gap-3 tw:px-6 tw:py-8 tw:text-center"
      >
        <span
          aria-hidden="true"
          className="pull-requests-placeholder__icon tw:mb-3 tw:inline-flex tw:size-12 tw:items-center tw:justify-center tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-raised tw:text-app-text-meta tw:forced-colors:border-[color:ButtonText]"
        >
          <GitPullRequest size={APP_ICON_SIZES.lg} strokeWidth={APP_ICON_STROKE_WIDTH} />
        </span>
        <h2 className="tw:m-0 tw:text-app-text tw:type-row-title" id="pull-requests-empty-title">
          拉取请求收件箱正在开发中
        </h2>
        <p className="tw:m-0 tw:max-w-[440px] tw:text-app-text-soft tw:type-body-sm">
          你仍然可以新建对话来检查、修改或评审当前工作区的代码。
        </p>
        <Link
          className="pull-requests-placeholder__action tw:mt-3 tw:inline-flex tw:items-center tw:justify-center tw:border tw:border-app-control tw:rounded-md tw:bg-app-control tw:px-4 tw:py-1 tw:text-app-text tw:no-underline tw:type-control tw:transition-[background-color,border-color,color,transform] tw:duration-feedback tw:ease-out tw:hover:bg-app-hover tw:focus-visible:outline tw:focus-visible:outline-offset-2 tw:focus-visible:outline-app-focus tw:forced-colors:border-[color:ButtonText]"
          to="/new"
        >
          新建对话
        </Link>
      </section>
    </PrimaryPageLayout>
  )
}
