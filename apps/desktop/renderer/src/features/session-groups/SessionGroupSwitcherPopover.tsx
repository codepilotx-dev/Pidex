import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Check, MessagesSquare, Plus, Unlink } from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../components/ui/IconTokens.js'
import {
  SearchablePopoverAction,
  SearchablePopoverContent,
} from '../../components/ui/SearchablePopoverContent.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import type { DesktopSessionGroup } from '../../services/desktop-client/Types.js'

type Props = {
  value: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (group: DesktopSessionGroup | null) => void | Promise<void>
  onCreate?: () => void
  trigger: React.ReactElement
  disabled?: boolean
  side?: 'top' | 'bottom' | 'left' | 'right'
}

export function SessionGroupSwitcherPopover({
  value,
  open,
  onOpenChange,
  onChange,
  onCreate,
  trigger,
  disabled,
  side = 'top',
}: Props): React.ReactNode {
  const [groups, setGroups] = useState<DesktopSessionGroup[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open || disabled) return
    let active = true
    void desktopClient
      .listSessionGroups()
      .then((items) => {
        if (active) setGroups(items)
      })
      .catch(() => {
        if (active) setGroups([])
      })
    return () => {
      active = false
    }
  }, [disabled, open])

  const options = useMemo(() => {
    return [
      { value: '__none__', group: null, filter: false },
      ...groups.map((group) => ({
        value: group.id,
        group,
        textValue: group.name + ' ' + group.description,
      })),
    ]
  }, [groups])

  return (
    <SearchablePopoverContent
      className="popover-session-group"
      contentLabel="选择工作流"
      emptyLabel="没有匹配的工作流"
      footer={
        onCreate ? (
          <SearchablePopoverAction
            icon={<Plus size={APP_ICON_SIZE} />}
            withArrow
            onClick={() => {
              onCreate()
              onOpenChange(false)
            }}
          >
            新建工作流
          </SearchablePopoverAction>
        ) : undefined
      }
      listLabel="工作流"
      open={open && !disabled}
      options={options}
      renderOption={(option, selected) => (
        <>
          <span className="popover-item-leading">
            <span className="popover-item-icon">
              {option.group ? (
                <MessagesSquare size={APP_ICON_SIZE} />
              ) : (
                <Unlink size={APP_ICON_SIZE} />
              )}
            </span>
          </span>
          {option.group ? (
            <span className="popover-item-label popover-item-label--rich">
              <span className="popover-item-title">{option.group.name}</span>
              <span className="popover-item-description">
                {option.group.memberCount} 个任务 · {option.group.projectLabels.length} 个项目
              </span>
            </span>
          ) : (
            <span className="popover-item-label">不使用工作流</span>
          )}
          <span className="popover-item-trailing">
            {selected ? <Check size={APP_ICON_SIZES.sm} /> : null}
          </span>
        </>
      )}
      search={search}
      searchLabel="搜索工作流"
      searchPlaceholder="搜索工作流"
      selectedValue={value ?? '__none__'}
      side={side}
      trigger={trigger}
      size="md"
      onOpenChange={onOpenChange}
      onSearchChange={setSearch}
      onSelect={async (option) => {
        await onChange(option.group)
        onOpenChange(false)
      }}
    />
  )
}
