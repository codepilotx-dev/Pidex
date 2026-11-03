import type React from 'react'

export function ToastContent({ message }: { message: React.ReactNode }): React.ReactNode {
  return (
    <span className="toast-content tw:block tw:min-w-0 tw:flex-1 tw:truncate tw:text-left tw:type-row-title">
      {message}
    </span>
  )
}
