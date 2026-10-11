import type React from 'react'
import { useMemo, useState } from 'react'
import { Check, Folder, FolderPlus, FolderX, GitFork } from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import {
  SearchablePopoverAction,
  SearchablePopoverContent,
} from '../../../components/ui/SearchablePopoverContent.js'
import type { PopoverSizingProps } from '../../../components/ui/PopoverSizing.js'
import type { DesktopWorkspace } from '../../../../shared/Types.js'

type Props = {
  recentWorkspaces: DesktopWorkspace[]
  workspace: DesktopWorkspace | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenWorkspace: (workspace: DesktopWorkspace) => void
  onChooseWorkspace: () => void
  onCloneGithub?: () => void
  onClearWorkspace: () => void
  trigger: React.ReactElement
  className?: string
  side?: 'top' | 'bottom' | 'right' | 'left'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
} & PopoverSizingProps

export function ProjectSwitcherPopover({
  recentWorkspaces,
  workspace,
  open,
  onOpenChange,
  onOpenWorkspace,
  onChooseWorkspace,
  onCloneGithub,
  onClearWorkspace,
  trigger,
  className = 'popover-project',
  side,
  align,
  sideOffset,
  size,
}: Props): React.ReactNode {
  const [search, setSearch] = useState('')
  const options = useMemo(
    () => [
      ...recentWorkspaces.map((item) => ({
        value: item.path,
        workspace: item,
        textValue: [item.name, item.path, item.branchName ?? ''].join(' '),
      })),
      { value: '__no_workspace__', workspace: null, filter: false },
    ],
    [recentWorkspaces],
  )

  return (
    <SearchablePopoverContent
      align={align}
      className={className}
      contentLabel="切换项目"
      emptyLabel="无匹配项目"
      footer={
        <>
          <SearchablePopoverAction
            icon={<FolderPlus size={APP_ICON_SIZE} />}
            withArrow
            onClick={() => {
              onChooseWorkspace()
              onOpenChange(false)
            }}
          >
            添加新项目
          </SearchablePopoverAction>
          {onCloneGithub ? (
            <SearchablePopoverAction
              icon={<GitFork size={APP_ICON_SIZE} />}
              withArrow
              onClick={() => {
                onCloneGithub()
                onOpenChange(false)
              }}
            >
              从 GitHub 克隆
            </SearchablePopoverAction>
          ) : null}
        </>
      }
      listLabel="最近项目"
      open={open}
      options={options}
      renderOption={(option, selected) => (
        <>
          <span className="popover-item-leading">
            <span className="popover-item-icon">
              {option.workspace ? (
                <Folder size={APP_ICON_SIZE} />
              ) : (
                <FolderX size={APP_ICON_SIZE} />
              )}
            </span>
          </span>
          <span className="popover-item-label">{option.workspace?.name ?? '不使用项目'}</span>
          <span className="popover-item-trailing">
            {selected ? <Check size={APP_ICON_SIZES.sm} /> : null}
          </span>
        </>
      )}
      search={search}
      searchLabel="搜索项目"
      searchPlaceholder="搜索项目"
      selectedValue={workspace?.path ?? '__no_workspace__'}
      side={side}
      sideOffset={sideOffset}
      trigger={trigger}
      size={size}

      onOpenChange={onOpenChange}
      onSearchChange={setSearch}
      onSelect={(option) => {
        if (option.workspace) onOpenWorkspace(option.workspace)
        else onClearWorkspace()
        onOpenChange(false)
      }}
    />
  )
}
