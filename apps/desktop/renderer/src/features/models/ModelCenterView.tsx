import type React from 'react'

import { ModelCenterWorkbench } from './ModelCenterWorkbench.js'

export function ProviderSettings({
  onError,
  onNotice,
}: {
  onError: (message: string) => void
  onNotice: (message: string) => void
}): React.ReactNode {
  return (
    <div className="model-center-page tw:h-full tw:w-full tw:min-h-0 tw:overflow-x-hidden tw:overflow-y-auto tw:bg-app-canvas tw:text-app-text">
      <ModelCenterWorkbench onError={onError} onNotice={onNotice} />
    </div>
  )
}
