import { APP_ICON_SIZES, APP_ICON_STROKE_WIDTH } from '../../../components/ui/IconTokens.js'
import React from 'react'
import { LoaderCircle } from 'lucide-react'
import type { RpcResult } from '@pidex/agent-protocol'
import type { DesktopDiffMarkerStyle } from '../../../../shared/Types.js'

import { Button } from '../../../components/ui/Button.js'

export type ThreadPatchDiff = RpcResult<'thread/patch/diff'>

const LazyFileMutationDiffContent = React.lazy(async () => {
  const module = await import('./FileMutationDiffContent.js')
  return { default: module.FileMutationDiffContent }
})

export const FileMutationDiffBody = React.memo(function FileMutationDiffBody({
  diff,
  diffMarkerStyle,
}: {
  diff: ThreadPatchDiff
  diffMarkerStyle: DesktopDiffMarkerStyle
}): React.ReactNode {
  return (
    <React.Suspense fallback={<FileMutationDiffLoading />}>
      <LazyFileMutationDiffContent diff={diff} diffMarkerStyle={diffMarkerStyle} />
    </React.Suspense>
  )
})

export function FileMutationDiffLoading(): React.ReactNode {
  return (
    <div
      className="canonical-file-mutation__message tw:flex tw:min-h-[72px] tw:items-center tw:justify-center tw:gap-2 tw:p-3 tw:text-app-text-soft"
      role="status"
    >
      <LoaderCircle
        size={APP_ICON_SIZES.sm}
        className="canonical-spin tw:flex-none"
        strokeWidth={APP_ICON_STROKE_WIDTH}
        aria-hidden="true"
      />
      正在加载差异
    </div>
  )
}

export function FileMutationDiffError({ onRetry }: { onRetry: () => void }): React.ReactNode {
  return (
    <div
      className="canonical-file-mutation__message tw:flex tw:min-h-[72px] tw:items-center tw:justify-center tw:gap-2 tw:p-3 tw:text-app-text-soft"
      role="alert"
    >
      <span>无法加载本次文件差异</span>
      <Button color="secondary" onClick={onRetry}>
        重试
      </Button>
    </div>
  )
}
