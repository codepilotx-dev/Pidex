import * as Dialog from '@radix-ui/react-dialog'
import { FileCode2, FolderOpen, Play, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { DesktopInstalledSkill } from '../../../../shared/Types.js'
import { Button } from '../../../components/ui/Button.js'

import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/IconTokens.js'
import { readRuntimeSkill } from './SkillClientAdapter.js'
import { useLastNonNull } from '../../../hooks/UsePresenceRetention.js'
import {
  BuiltinSkillIcon,
  getBuiltinSkillPresentation,
  isBuiltinSkill,
  skillScopeLabel,
} from '../../plugins/BuiltinSkillPresentation.js'
import { errorMessageOr as errorMessageOf } from '@pidex/shared/errors'

type Props = {
  workspacePath: string | null
  skill: DesktopInstalledSkill | null
  open: boolean
  restoreFocusElement?: HTMLElement | null
  onOpenChange: (open: boolean) => void
  onOpenSkill: (skill: DesktopInstalledSkill) => void
  onUseSkill: (skill: DesktopInstalledSkill) => void
  onError: (message: string) => void
}

export function SkillDetailsDialog({
  workspacePath,
  skill: currentSkill,
  open,
  restoreFocusElement,
  onOpenChange,
  onOpenSkill,
  onUseSkill,
  onError,
}: Props): React.ReactNode {
  const retainedSkill = useLastNonNull(currentSkill)
  const skill = open ? currentSkill : retainedSkill
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const onErrorRef = useRef(onError)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
    if (!open || !skill) return
    let cancelled = false
    setLoading(true)
    setContent('')
    setError(null)
    readRuntimeSkill(workspacePath, skill.path)
      .then((result) => {
        if (!cancelled) setContent(result.content)
      })
      .catch((readError) => {
        if (cancelled) return
        const message = errorMessageOf(readError, '技能详情读取失败。')
        setError(message)
        onErrorRef.current(message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, skill, workspacePath])

  if (!skill) return null
  const presentation = getBuiltinSkillPresentation(skill)
  const builtin = isBuiltinSkill(skill)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
        <Dialog.Content
          className="ui-dialog-surface ui-dialog-surface--centered settings-management-dialog tw:flex tw:max-h-[min(42rem,calc(100vh-3rem))] tw:w-[min(48rem,calc(100vw-3rem))] tw:flex-col tw:overflow-hidden tw:p-0 tw:text-app-text"
          data-dialog-size="detail"
          onCloseAutoFocus={(event) => {
            if (!restoreFocusElement?.isConnected) return
            event.preventDefault()
            restoreFocusElement.focus()
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            closeRef.current?.focus()
          }}
        >
          <header className="settings-management-dialog-header tw:flex tw:items-start tw:gap-3">
            <span
              aria-hidden="true"
              className="tw:flex tw:size-10 tw:shrink-0 tw:items-center tw:justify-center tw:border tw:border-app-border tw:bg-app-canvas tw:text-app-text-soft"
            >
              {presentation ? (
                <BuiltinSkillIcon className="" size={14} skill={skill} />
              ) : (
                <FileCode2 size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              )}
            </span>
            <span className="settings-management-dialog-heading tw:min-w-0 tw:flex-1">
              <Dialog.Title className="tw:type-title-sm tw:m-0">{skill.name}</Dialog.Title>
              <Dialog.Description className="tw:type-body-sm tw:mt-1 tw:mb-0 tw:text-app-text-soft">
                {skill.description || '未提供技能说明。'}
              </Dialog.Description>
            </span>
            <Dialog.Close asChild>
              <Button
                isIconOnly
                color="ghostSecondary"
                ref={closeRef}
                size="toolbar"
                title="关闭技能详情"
              >
                <X aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              </Button>
            </Dialog.Close>
          </header>

          <div className="settings-management-dialog-body tw:min-h-0 tw:flex-1 tw:overflow-auto">
            <dl className="tw:type-body-sm tw:mb-4 tw:grid tw:grid-cols-[auto_minmax(0,1fr)] tw:gap-x-4 tw:gap-y-2">
              <dt className="tw:text-app-text-soft">来源</dt>
              <dd className="tw:m-0">{skillScopeLabel(skill.scope)}</dd>
              <dt className="tw:text-app-text-soft">状态</dt>
              <dd className="tw:m-0">{skill.enabled ? '已启用' : '已禁用'}</dd>
            </dl>
            {loading ? (
              <p className="tw:type-body-sm tw:m-0 tw:text-app-text-soft" role="status">
                正在读取 SKILL.md…
              </p>
            ) : error ? (
              <div
                className="tw:type-body-sm tw:border tw:border-app-danger tw:bg-app-panel tw:p-3 tw:text-app-danger"
                role="alert"
              >
                {error}
              </div>
            ) : (
              <pre className="plugin-details-code tw:m-0 tw:overflow-auto tw:whitespace-pre-wrap tw:break-words tw:border tw:border-app-border tw:bg-app-canvas tw:p-4 tw:text-app-text tw:type-code">
                {content}
              </pre>
            )}
          </div>

          <footer className="settings-management-dialog-footer tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2">
            {!builtin ? (
              <Button color="secondary" onClick={() => onOpenSkill(skill)}>
                <FolderOpen
                  aria-hidden="true"
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
                打开
              </Button>
            ) : null}
            <Button color="primary" disabled={!skill.enabled} onClick={() => onUseSkill(skill)}>
              <Play aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              立即使用
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
