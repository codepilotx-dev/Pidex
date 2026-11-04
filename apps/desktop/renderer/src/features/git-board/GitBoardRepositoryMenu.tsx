import { useState, type ReactNode } from 'react'
import type { ProtocolCapability } from '@pidex/agent-protocol'
import {
  ArrowUpFromDot,
  CloudDownload,
  Download,
  Ellipsis,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
} from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import { PopoverMenu } from '../../components/ui/PopoverMenu.js'
import { DropdownActions } from '../../components/ui/DropdownActions.js'
import type { AppContextMenuAction } from '../../components/ui/AppContextMenu.js'
import { Tooltip } from '../../components/ui/Tooltip.js'
import { APP_ICON_SIZE } from '../../components/ui/IconTokens.js'
import { useLocale } from '../i18n/LocaleProvider.js'

export type GitBoardAction =
  'commit' | 'push' | 'createBranch' | 'checkoutBranch' | 'fetch' | 'pull'

export const GIT_BOARD_ACTION_ORDER: readonly GitBoardAction[] = [
  'commit',
  'push',
  'createBranch',
  'checkoutBranch',
  'fetch',
  'pull',
]

export const GIT_BOARD_ACTION_CAPABILITY = {
  commit: 'git.review.v1',
  push: 'github.pullRequests.v1',
  createBranch: 'git.workspace.v1',
  checkoutBranch: 'git.workspace.v1',
  fetch: 'git.sync.v1',
  pull: 'git.sync.v1',
} as const satisfies Record<GitBoardAction, ProtocolCapability>

export const GIT_BOARD_ACTION_LABEL: Record<GitBoardAction, string> = {
  commit: '提交',
  push: '推送',
  createBranch: '创建分支',
  checkoutBranch: '签出分支',
  fetch: 'Fetch',
  pull: 'Pull',
}

export type GitBoardActionAvailability = {
  /** 当前仓库状态不可用（尚未加载或加载失败）。 */
  unavailable: boolean
  /** 当前服务缺少的 capability 对应的动作。 */
  missing: GitBoardAction[]
  /** 任一写操作进行中（本列）。 */
  busy: boolean
  isDisabled: (action: GitBoardAction) => boolean
}

export function gitBoardActionAvailability({
  capabilities,
  available,
  busy,
}: {
  capabilities: readonly ProtocolCapability[]
  available: boolean
  busy: boolean
}): GitBoardActionAvailability {
  const missing = GIT_BOARD_ACTION_ORDER.filter(
    (action) => !capabilities.includes(GIT_BOARD_ACTION_CAPABILITY[action]),
  )
  return {
    unavailable: !available,
    missing,
    busy,
    isDisabled: (action) => !available || busy || missing.includes(action),
  }
}

const ACTION_ICON: Record<GitBoardAction, ReactNode> = {
  commit: <GitCommitHorizontal size={APP_ICON_SIZE} />,
  push: <ArrowUpFromDot size={APP_ICON_SIZE} />,
  createBranch: <GitBranch size={APP_ICON_SIZE} />,
  checkoutBranch: <GitFork size={APP_ICON_SIZE} />,
  fetch: <CloudDownload size={APP_ICON_SIZE} />,
  pull: <Download size={APP_ICON_SIZE} />,
}

export function GitBoardRepositoryMenu({
  projectName,
  capabilities,
  available,
  busy,
  onAction,
}: {
  projectName: string
  capabilities: readonly ProtocolCapability[]
  available: boolean
  busy: boolean
  onAction: (action: GitBoardAction) => void
}) {
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  const availability = gitBoardActionAvailability({ capabilities, available, busy })
  const item = (action: GitBoardAction): AppContextMenuAction => ({
    kind: 'item',
    label: t(GIT_BOARD_ACTION_LABEL[action]),
    icon: ACTION_ICON[action],
    disabled: availability.isDisabled(action),
    onSelect: () => onAction(action),
  })
  const actions: AppContextMenuAction[] = [
    item('commit'),
    item('push'),
    { kind: 'separator' },
    item('createBranch'),
    item('checkoutBranch'),
    { kind: 'separator' },
    item('fetch'),
    item('pull'),
  ]
  const triggerLabel = `${projectName}：${t('仓库操作')}`
  const reason = !available
    ? t('仓库状态不可用，仓库操作已禁用')
    : availability.missing.length
      ? `${t('当前服务不支持')}：${availability.missing
          .map((action) => t(GIT_BOARD_ACTION_LABEL[action]))
          .join('、')}`
      : busy
        ? t('正在执行仓库操作')
        : t('仓库操作')
  return (
    <Tooltip.Root open={open ? false : undefined}>
      <PopoverMenu
        className="popover-menu--grid"
        open={open}
        side="bottom"
        size="sm"
        trigger={
          <Tooltip.Trigger asChild>
            <Button
              nativeTitle={false}
              isIconOnly
              variant="text"
              color="text"
              iconSize="md"
              size="compact"
              title={triggerLabel}
              aria-label={triggerLabel}
              aria-haspopup="menu"
            >
              <Ellipsis size={APP_ICON_SIZE} />
            </Button>
          </Tooltip.Trigger>
        }
        onOpenChange={setOpen}
      >
        <DropdownActions actions={actions} />
      </PopoverMenu>
      <Tooltip.Portal>
        <Tooltip.Content>{reason}</Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
