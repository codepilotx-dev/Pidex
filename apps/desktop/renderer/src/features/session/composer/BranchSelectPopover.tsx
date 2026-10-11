import React from 'react'
import { Check, GitBranch, Plus } from 'lucide-react'
import {
  SearchablePopoverAction,
  SearchablePopoverContent,
} from '../../../components/ui/SearchablePopoverContent.js'
import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import type { PopoverSizingProps } from '../../../components/ui/PopoverSizing.js'

type BranchSelectPopoverProps = {
  align?: 'start' | 'center' | 'end'
  branchSearch: string
  branches: string[]
  className: string
  currentBranchDetail?: string
  currentBranchName: string
  open: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  trigger: React.ReactElement
  onBranchSearchChange: (value: string) => void
  onBranchSelect: (branch: string) => void | Promise<void>
  onCreateBranch: () => void
  onOpenChange: (open: boolean) => void
} & PopoverSizingProps

export function BranchSelectPopover({
  align,
  branchSearch,
  branches,
  className,
  currentBranchDetail,
  currentBranchName,
  open,
  side,
  sideOffset,
  trigger,
  size,
  onBranchSearchChange,
  onBranchSelect,
  onCreateBranch,
  onOpenChange,
}: BranchSelectPopoverProps): React.ReactNode {
  const visibleBranches = React.useMemo(() => {
    const branchSet = new Set(branches)
    if (
      currentBranchName &&
      currentBranchName !== '无项目' &&
      currentBranchName !== '未检测到 Git 分支'
    ) {
      branchSet.add(currentBranchName)
    }
    return [...branchSet]
  }, [branches, currentBranchName])
  const options = React.useMemo(
    () => visibleBranches.map((branch) => ({ value: branch })),
    [visibleBranches],
  )

  return (
    <SearchablePopoverContent
      align={align}
      className={className}
      contentLabel="切换 Git 分支"
      emptyLabel="无匹配分支"
      footer={
        <SearchablePopoverAction
          icon={<Plus size={APP_ICON_SIZE} />}
          onClick={() => {
            onCreateBranch()
            onOpenChange(false)
          }}
        >
          创建并检出新分支...
        </SearchablePopoverAction>
      }
      listClassName="branch-popover-list-scroll"
      listLabel="Git 分支"
      open={open}
      options={options}
      renderOption={(option, selected) => (
        <>
          <span className="popover-item-leading">
            <span className="popover-item-icon">
              <GitBranch size={APP_ICON_SIZE} />
            </span>
          </span>
          <span className="popover-item-label">
            {currentBranchDetail && selected ? (
              <span className="environment-branch-label tw:flex tw:min-w-0 tw:flex-col tw:gap-1">
                <span
                  className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap"
                  title={option.value}
                >
                  {option.value}
                </span>
                <small className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-app-text-soft tw:type-caption">
                  {currentBranchDetail}
                </small>
              </span>
            ) : (
              <span title={option.value}>{option.value}</span>
            )}
          </span>
          <span className="popover-item-trailing">
            {selected ? <Check size={APP_ICON_SIZES.sm} /> : null}
          </span>
        </>
      )}
      search={branchSearch}
      searchLabel="搜索分支"
      searchPlaceholder="搜索分支"
      selectedValue={currentBranchName}
      side={side}
      sideOffset={sideOffset}
      trigger={trigger}
      size={size}

      onOpenChange={onOpenChange}
      onSearchChange={onBranchSearchChange}
      onSelect={(option) => {
        void onBranchSelect(option.value)
        onOpenChange(false)
      }}
    />
  )
}
