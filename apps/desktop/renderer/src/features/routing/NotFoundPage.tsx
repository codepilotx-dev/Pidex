import type React from 'react'
import { Link } from 'react-router-dom'

export function NotFoundPage(): React.ReactNode {
  return (
    <main className="not-found-page tw:grid tw:w-full tw:min-w-0 tw:min-h-full tw:content-center tw:justify-items-center tw:gap-3 tw:p-5 tw:bg-app-canvas tw:text-center tw:text-app-text">
      <span className="tw:text-app-text-meta tw:type-title-xl">404</span>
      <h1 className="tw:m-0 tw:text-app-text tw:type-title-sm">这个页面不存在</h1>
      <p className="tw:m-0 tw:max-w-[440px] tw:text-app-text-soft tw:type-body-sm">
        旧版路由已经停止支持，请从新的工作区入口继续。
      </p>
      <Link
        className="tw:mt-3 tw:inline-flex tw:items-center tw:justify-center tw:border tw:border-app-control tw:rounded-md tw:bg-app-control tw:px-4 tw:py-1 tw:text-app-text tw:no-underline tw:type-control tw:transition-[background-color,border-color,color,transform] tw:duration-feedback tw:ease-out tw:hover:bg-app-hover tw:focus-visible:outline tw:focus-visible:outline-offset-2 tw:focus-visible:outline-app-focus tw:forced-colors:border-[color:ButtonText]"
        to="/new"
      >
        返回新建会话
      </Link>
    </main>
  )
}
