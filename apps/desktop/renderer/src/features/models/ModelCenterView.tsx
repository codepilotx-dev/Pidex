import type React from 'react'

import { ModelCenterWorkbench } from './ModelCenterWorkbench.js'

export function ProvidersPage({
  onError,
  onNotice,
}: {
  onError: (message: string) => void
  onNotice: (message: string) => void
}): React.ReactNode {
  return (
    <div className="model-center-page tw:flex tw:h-full tw:w-full tw:min-h-0 tw:flex-col tw:overflow-hidden tw:bg-app-canvas tw:text-app-text">
      <ModelCenterWorkbench onError={onError} onNotice={onNotice} />
    </div>
  )
}
