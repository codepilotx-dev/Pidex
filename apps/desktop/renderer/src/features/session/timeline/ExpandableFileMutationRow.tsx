import { APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import React from 'react'
import { ChevronRight, Pencil } from 'lucide-react'
import type { Item } from '@pidex/shared/thread'
import type { RpcParams, RpcResult } from '@pidex/agent-protocol'
import type { DesktopDiffMarkerStyle } from '../../../../shared/Types.js'
import { DisclosureContent } from '../../../components/ui/DisclosureContent.js'
import { useDisclosureExpanded } from '../../../components/ui/KeyedDisclosureStore.js'
import { cx } from '../../../utils/Cx.js'

import type {
  CanonicalItemDisclosure,
  FileChangeDisplay,
  ReadThreadPatchDiff,
} from './CanonicalItemRenderer.js'
import { fileMutationLabel } from './CanonicalItemRenderer.js'
import {
  FileMutationDiffBody,
  FileMutationDiffError,
  FileMutationDiffLoading,
} from './FileMutationDiffBody.js'

type ToolItem = Extract<Item, { type: 'tool' }>
type Diff = RpcResult<'thread/patch/diff'>
type DiffLoadState = { status: 'loading' | 'error' } | { status: 'loaded'; diff: Diff }

export type ThreadPatchDiffLoader = {
  invalidate: (key: string) => void
  request: (
    key: string,
    params: RpcParams<'thread/patch/diff'>,
    publish: (state: DiffLoadState) => void,
  ) => () => void
}

export function createThreadPatchDiffLoader(
  readThreadPatchDiff: ReadThreadPatchDiff,
): ThreadPatchDiffLoader {
  const cache = new Map<string, Diff>()
  return {
    invalidate: (key) => cache.delete(key),
    request: (key, params, publish) => {
      const cached = cache.get(key)
      if (cached) {
        publish({ status: 'loaded', diff: cached })
        return () => undefined
      }
      let active = true
      publish({ status: 'loading' })
      void readThreadPatchDiff(params).then(
        (diff) => {
          if (!active) return
          cache.set(key, diff)
          publish({ status: 'loaded', diff })
        },
        () => {
          if (active) publish({ status: 'error' })
        },
      )
      return () => {
        active = false
      }
    },
  }
}

export function ExpandableFileMutationRow({
  diffMarkerStyle,
  disclosure,
  file,
  item,
  readThreadPatchDiff,
  threadId,
}: {
  diffMarkerStyle: DesktopDiffMarkerStyle
  disclosure: CanonicalItemDisclosure
  file: FileChangeDisplay
  item: ToolItem
  readThreadPatchDiff: ReadThreadPatchDiff
  threadId: string
}): React.ReactNode {
  const expanded = useDisclosureExpanded(disclosure.store, disclosure.id)
  const [attempt, setAttempt] = React.useState(0)
  const [loadState, setLoadState] = React.useState<DiffLoadState>({
    status: 'loading',
  })
  const loader = React.useMemo(
    () => createThreadPatchDiffLoader(readThreadPatchDiff),
    [readThreadPatchDiff],
  )
  const requestKey = `${threadId}:${item.callID}:${file.path}`
  const contentId = React.useId()

  React.useEffect(() => {
    if (!expanded) return
    return loader.request(
      requestKey,
      { threadId, toolCallId: item.callID, path: file.path },
      setLoadState,
    )
  }, [attempt, expanded, file.path, item.callID, loader, requestKey, threadId])

  return (
    <div
      className="cpx-agent-activity__item tw:min-w-0 tw:text-app-text-soft"
      data-expandable="true"
      data-expanded={expanded ? 'true' : 'false'}
    >
      <button
        aria-controls={contentId}
        aria-expanded={expanded}
        className="cpx-agent-activity__item-header"
        onClick={() => disclosure.store.setExpanded(disclosure.id, !expanded)}
        type="button"
      >
        <Pencil size={APP_ICON_SIZES.sm} className="cpx-agent-activity__icon" aria-hidden="true" />
        <span className="cpx-agent-activity__label" title={file.path}>
          {fileMutationLabel(item.state, file.path, file.operation)}
        </span>
        <span className="cpx-agent-activity__review-indicator">
          {file.additions !== null ? (
            <small className="canonical-diff-add">+{file.additions}</small>
          ) : null}
          {file.deletions !== null ? (
            <small className="canonical-diff-remove">-{file.deletions}</small>
          ) : null}
        </span>
        <ChevronRight
          size={APP_ICON_SIZES.sm}
          className="cpx-agent-activity__chevron"
          aria-hidden="true"
        />
      </button>
      <DisclosureContent
        contentClassName={cx(
          'cpx-agent-activity__details cpx-agent-activity__details--diff',
          'tw:mx-0 tw:my-1 tw:max-h-[420px] tw:overflow-auto tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-panel tw:mb-2',
        )}
        expanded={expanded}
        id={contentId}
        mountPolicy="until-exit"
      >
        {loadState.status === 'loaded' ? (
          <FileMutationDiffBody diff={loadState.diff} diffMarkerStyle={diffMarkerStyle} />
        ) : loadState.status === 'error' ? (
          <FileMutationDiffError
            onRetry={() => {
              loader.invalidate(requestKey)
              setAttempt((value) => value + 1)
            }}
          />
        ) : (
          <FileMutationDiffLoading />
        )}
      </DisclosureContent>
    </div>
  )
}
