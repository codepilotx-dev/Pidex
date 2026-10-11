import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { ChevronDown, ChevronRight, FolderOpen } from 'lucide-react'
import type { DesktopExternalOpenTarget, DesktopWorkspace } from '../../../../shared/Types.js'
import { Button } from '../../../components/ui/Button.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../../components/ui/IconTokens.js'
import {
  PopoverItem,
  PopoverRadioGroup,
  PopoverRadioItem,
  PopoverSeparator,
} from '../../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import { SegmentedControl } from '../../../components/ui/SegmentedControl.js'
import { OpenTargetIcon } from '../../../components/ui/OpenTargetIcon.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import {
  loadExternalOpenTargets,
  openPathWithExternalTarget,
} from '../../../services/ExternalOpenTargetsStore.js'
import type { MarkdownFileViewMode } from '../dock/RightDockState.js'

export type FileBreadcrumbToolbarProps = {
  path: string
  readonly?: boolean
  treeAvailable: boolean
  treeToggleRef?: React.Ref<HTMLButtonElement>
  treeVisible: boolean
  markdownViewMode?: MarkdownFileViewMode
  switching?: boolean
  workspace: DesktopWorkspace | null
  workspacePath: string
  onToggleTree: () => void
  onToggleMarkdownViewMode?: (mode: MarkdownFileViewMode) => void
}

export function FileBreadcrumbToolbar({
  path,
  readonly = false,
  treeAvailable,
  treeToggleRef,
  treeVisible,
  markdownViewMode,
  switching = false,
  workspace,
  workspacePath,
  onToggleTree,
  onToggleMarkdownViewMode,
}: FileBreadcrumbToolbarProps): React.ReactNode {
  const [openTargetMenu, setOpenTargetMenu] = useState(false)
  const [openTargets, setOpenTargets] = useState<DesktopExternalOpenTarget[]>([])
  const segments = useMemo(
    () => buildBreadcrumbSegments(path, workspace, workspacePath),
    [path, workspace, workspacePath],
  )
  const absolutePath = useMemo(
    () => resolveAbsolutePath(workspacePath, path),
    [path, workspacePath],
  )
  const preferredOpenTarget = openTargets.find((target) => target.preferred) ?? openTargets[0]

  function rememberPreferredTarget(target: DesktopExternalOpenTarget): void {
    const next = openTargets.map((candidate) => ({
      ...candidate,
      preferred: candidate.id === target.id,
    }))
    setOpenTargets(next)
  }

  function openWithTarget(target: DesktopExternalOpenTarget): void {
    if (!absolutePath) return
    rememberPreferredTarget(target)
    void openPathWithExternalTarget(absolutePath, target.id)
  }

  useEffect(() => {
    if (!absolutePath) {
      setOpenTargets([])
      return
    }
    let active = true
    void loadExternalOpenTargets(absolutePath)
      .then((targets) => {
        if (active) setOpenTargets(targets)
      })
      .catch(() => {
        if (active) setOpenTargets([])
      })
    return () => {
      active = false
    }
  }, [absolutePath])

  return (
    <header className="file-breadcrumb-toolbar tw:flex tw:h-10 tw:min-h-10 tw:shrink-0 tw:min-w-0 tw:items-center tw:justify-between tw:gap-2 tw:border-b tw:border-app-border-subtle tw:bg-app-dock tw:px-2">
      <div
        aria-label={`文件路径：${path}`}
        className="file-breadcrumb-toolbar__path tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:overflow-hidden tw:type-control"
      >
        {segments.map((segment, index) => {
          return (
            <span className="file-breadcrumb-toolbar__segment" key={segment.key}>
              {index > 0 ? (
                <ChevronRight
                  aria-hidden="true"
                  className="file-breadcrumb-toolbar__separator"
                  size={APP_ICON_SIZES.sm}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              ) : null}
              {segment.file ? (
                <span className="file-breadcrumb-toolbar__filename" title={path}>
                  <strong>{segment.label}</strong>
                </span>
              ) : (
                <span className="file-breadcrumb-toolbar__directory" title={segment.title}>
                  {segment.label}
                </span>
              )}
            </span>
          )
        })}
      </div>
      <div className="file-breadcrumb-toolbar__actions tw:flex tw:shrink-0 tw:items-center tw:gap-1">
        {markdownViewMode && onToggleMarkdownViewMode ? (
          <SegmentedControl<MarkdownFileViewMode>
            ariaLabel="Markdown 查看模式"
            className="file-breadcrumb-toolbar__view-mode"
            onChange={onToggleMarkdownViewMode}
            options={[
              { value: 'rich', label: '预览', disabled: switching },
              { value: 'source', label: '源码', disabled: switching },
            ]}
            overflowMode="fit"
            value={markdownViewMode}
          />
        ) : null}
        {readonly ? <small>只读</small> : null}
        <Button
          isIconOnly
          ref={treeToggleRef}
          aria-pressed={treeVisible}
          className="file-breadcrumb-toolbar__action"
          color="ghostSecondary"
          disabled={!treeAvailable}
          size="toolbar"
          title={treeVisible ? '隐藏文件树' : '显示文件树'}
          type="button"
          onClick={onToggleTree}
        >
          <FolderOpen aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
        </Button>
        <div className="file-breadcrumb-toolbar__open-group">
          <Button
            isIconOnly
            color="ghostSecondary"
            size="toolbar"
            className="file-breadcrumb-toolbar__open"
            disabled={!absolutePath || !preferredOpenTarget}
            title={
              preferredOpenTarget ? `使用 ${preferredOpenTarget.label} 打开` : '没有可用的外部应用'
            }
            type="button"
            onClick={() => {
              if (!absolutePath || !preferredOpenTarget) return
              openWithTarget(preferredOpenTarget)
            }}
          >
            {preferredOpenTarget ? (
              <OpenTargetIcon
                className="file-breadcrumb-open-target-icon"
                kind={preferredOpenTarget.kind}
                targetId={preferredOpenTarget.id}
              />
            ) : null}
          </Button>
          <PopoverMenu
            align="end"
            className="file-breadcrumb-open-popover popover-menu--grid"
            open={openTargetMenu}
            side="bottom"
            sideOffset={4}
            size="sm"
            trigger={
              <Button
                isIconOnly
                className="file-breadcrumb-toolbar__open-menu"
                color="ghostSecondary"
                disabled={!absolutePath || openTargets.length === 0}
                size="toolbar"
                title="选择外部打开方式"
                type="button"
              >
                <ChevronDown
                  aria-hidden="true"
                  size={APP_ICON_SIZES.sm}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              </Button>
            }
            onOpenChange={setOpenTargetMenu}
          >
            <PopoverRadioGroup
              value={preferredOpenTarget?.id ?? ''}
              onValueChange={(targetId) => {
                const target = openTargets.find((item) => item.id === targetId)
                if (!target || !absolutePath) return
                openWithTarget(target)
                setOpenTargetMenu(false)
              }}
            >
              {openTargets.map((target) => (
                <PopoverRadioItem
                  icon={
                    <OpenTargetIcon
                      className="file-breadcrumb-open-target-icon"
                      kind={target.kind}
                      targetId={target.id}
                    />
                  }
                  key={target.id}
                  value={target.id}
                >
                  {target.label}
                </PopoverRadioItem>
              ))}
            </PopoverRadioGroup>
            <PopoverSeparator />
            <PopoverItem
              icon={
                <FolderOpen
                  aria-hidden="true"
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              }
              onClick={() => {
                if (!absolutePath) return
                void desktopClient.revealPathInFolder(absolutePath)
                setOpenTargetMenu(false)
              }}
            >
              在文件资源管理器中显示
            </PopoverItem>
          </PopoverMenu>
        </div>
      </div>
    </header>
  )
}

type BreadcrumbSegment = {
  directoryPath: string | null
  file: boolean
  key: string
  label: string
  title: string
}

function buildBreadcrumbSegments(
  path: string,
  workspace: DesktopWorkspace | null,
  workspacePath: string,
): BreadcrumbSegment[] {
  const relativeSegments = path.replace(/\\/g, '/').split('/').filter(Boolean)
  const workspaceLabel =
    workspace?.name?.trim() ||
    workspacePath.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ||
    '工作区'
  const segments: BreadcrumbSegment[] = [
    {
      directoryPath: null,
      file: false,
      key: 'workspace-root',
      label: workspaceLabel,
      title: workspacePath,
    },
  ]
  for (let index = 0; index < relativeSegments.length; index += 1) {
    const label = relativeSegments[index] ?? ''
    const directoryPath = relativeSegments.slice(0, index + 1).join('/')
    const file = index === relativeSegments.length - 1
    segments.push({
      directoryPath: file ? null : directoryPath,
      file,
      key: file ? `file:${directoryPath}` : `directory:${directoryPath}`,
      label,
      title: file ? path : directoryPath,
    })
  }
  return segments
}

function resolveAbsolutePath(workspacePath: string | null, relativePath: string): string | null {
  const value = relativePath.trim()
  if (!value) return null
  if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/u.test(value)) return value
  if (!workspacePath?.trim()) return null
  const separator = workspacePath.includes('\\') ? '\\' : '/'
  return `${workspacePath.replace(/[\\/]+$/u, '')}${separator}${value.replace(/^[\\/]+/u, '')}`
}
