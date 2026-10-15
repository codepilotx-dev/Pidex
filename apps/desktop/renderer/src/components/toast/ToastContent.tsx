import type React from 'react'
import { toUserErrorMessage } from '../../utils/Errors.js'

export function ToastContent({
  message,
  isError,
}: {
  message: React.ReactNode
  isError: boolean
}): React.ReactNode {
  const summary = isError && typeof message === 'string' ? toUserErrorMessage(message) : message
  const hasDetails = typeof message === 'string' && (
    summary !== message || message.includes('\n') || message.length > 80
  )

  return (
    <div className="toast-content tw:min-w-0 tw:flex-1 tw:text-left tw:type-body-sm">
      {typeof summary === 'string' ? (
        <div className={`tw:whitespace-pre-wrap tw:wrap-anywhere ${hasDetails ? 'tw:line-clamp-2' : ''}`}>{summary}</div>
      ) : summary}
      {hasDetails ? (
        <details className="tw:mt-1">
          <summary className="tw:w-fit tw:cursor-pointer tw:rounded-sm tw:type-caption tw:text-app-text-soft tw:hover:text-app-text tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus">
            查看详情
          </summary>
          <pre className="tw:mt-2 tw:mb-0 tw:max-h-[min(30vh,14rem)] tw:overflow-y-auto tw:rounded-md tw:bg-app-control tw:p-2 tw:type-code tw:text-app-text-soft tw:whitespace-pre-wrap tw:wrap-anywhere">
            {message}
          </pre>
        </details>
      ) : null}
    </div>
  )
}
