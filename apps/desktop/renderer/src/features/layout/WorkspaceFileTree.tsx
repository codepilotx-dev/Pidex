import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { ChevronRight, LoaderCircle, RotateCcw } from 'lucide-react'
import type { DesktopFileEntry, DesktopWorkspace } from '../../../shared/Types.js'
import { createWorkspaceFileTabId } from './tabs/WorkspaceFileTabId.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../components/ui/IconTokens.js'
import { AppContextMenu } from '../../components/ui/AppContextMenu.js'
import { Button } from '../../components/ui/Button.js'
import { SearchInput } from '../../components/ui/SearchInput.js'
import { VList, type VListHandle } from 'virtua'
import { desktopClient } from '../../services/desktop-client/index.js'
import { cx } from '../../utils/Cx.js'
import { normalizePathForComparison } from '../../utils/PathUtils.js'
import { FileTypeIcon } from './FileTypeIcon.js'

export type WorkspaceFileOpenOptions = {
  preview: boolean
}

export type WorkspaceFileTreeProps = {
  activePath?: string | null
  autoFocusSearch?: boolean
  className?: string
  files: DesktopFileEntry[]
  revealToken?: number
  rootPath?: string | null
  searchable?: boolean
  workspace: DesktopWorkspace | null
  folderId?: string
  onAddComposerFiles?: (filePaths: string[]) => void
  onEscape?: () => void
  onOpenFile: (file: DesktopFileEntry, options: WorkspaceFileOpenOptions) => void
}

type FileTreeRow = { kind: 'entry'; file: DesktopFileEntry }

const FILE_TREE_ROW_HEIGHT = 28

export function WorkspaceFileTree(props: WorkspaceFileTreeProps): React.ReactNode {
  const projectFolders = props.workspace?.folders ?? []
  if (!props.folderId && projectFolders.length > 1) {
    return (
      <div
        className={cx(
          'workspace-file-tree-groups tw:flex tw:h-full tw:min-h-0 tw:grow tw:shrink tw:basis-auto tw:flex-col tw:overflow-hidden',
          props.className,
        )}
      >
        {projectFolders.map((folder) => (
          <section
            className="workspace-file-tree-group tw:flex tw:min-h-20 tw:flex-1 tw:flex-col tw:overflow-hidden tw:border-b tw:border-app-border"
            data-folder-availability={folder.availability}
            key={folder.id}
          >
            <header className="workspace-file-tree-group-header tw:sticky tw:top-0 tw:z-local tw:flex tw:h-8 tw:items-center tw:gap-2 tw:bg-app-dock tw:px-3 tw:text-app-text tw:type-label">
              <ChevronRight
                aria-hidden="true"
                className="right-dock-tree-chevron tw:inline-flex tw:size-icon-sm tw:shrink-0 tw:items-center tw:justify-center tw:text-app-text-meta tw:transition-transform tw:duration-state tw:ease-out"
                size={APP_ICON_SIZES.sm}
              />
              <span className="tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                {folder.name}
              </span>
              {folder.role === 'primary' ? (
                <em className="tw:rounded-full tw:bg-app-panel tw:px-2 tw:py-1 tw:text-app-accent tw:type-meta tw:not-italic">
                  主目录
                </em>
              ) : null}
            </header>
            {folder.availability === 'missing' ? (
              <div className="right-dock-tree-empty tw:px-2 tw:py-5 tw:text-app-text-meta tw:type-body-sm">
                目录当前不可用。
              </div>
            ) : (
              <WorkspaceFileTreeContent
                {...props}
                autoFocusSearch={false}
                files={folder.role === 'primary' ? props.files : []}
                folderId={folder.id}
                grouped
                rootPath="."
                searchable={false}
                workspace={{
                  ...props.workspace!,
                  path: folder.path,
                  folders: undefined,
                }}
                onOpenFile={(file, options) =>
                  props.onOpenFile(
                    {
                      ...file,
                      folderId: folder.id,
                      folderName: folder.name,
                      rootPath: folder.path,
                    },
                    options,
                  )
                }
              />
            )}
          </section>
        ))}
      </div>
    )
  }
  return <WorkspaceFileTreeContent {...props} />
}

function WorkspaceFileTreeContent({
  activePath,
  autoFocusSearch = false,
  className,
  files,
  grouped = false,
  revealToken,
  rootPath = null,
  searchable = true,
  workspace,
  folderId,
  onAddComposerFiles,
  onEscape,
  onOpenFile,
}: WorkspaceFileTreeProps & {
  /** Grouped trees fill their `workspace-file-tree-group` section instead of the pane. */
  grouped?: boolean
}): React.ReactNode {
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<DesktopFileEntry[]>(() =>
    rootPath ? [] : normalizeRootEntries(files),
  )
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => new Set())
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(() => new Set())
  const [directoryErrors, setDirectoryErrors] = useState<Set<string>>(() => new Set())
  const entriesRef = useRef(entries)
  const loadedDirectoriesRef = useRef(new Set<string>())
  const loadingPromisesRef = useRef(new Map<string, Promise<void>>())
  const generationRef = useRef(0)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const listRef = useRef<VListHandle | null>(null)
  const previewTimerRef = useRef<number | null>(null)

  const replaceEntries = useCallback((next: DesktopFileEntry[]): void => {
    entriesRef.current = next
    setEntries(next)
  }, [])

  const loadDirectory = useCallback(
    (
      directoryPath: string,
      parentDepth: number,
      options: { expandOnSuccess?: boolean; replaceRoot?: boolean } = {},
    ): Promise<void> => {
      const workspacePath = workspace?.path
      if (!workspacePath) return Promise.reject(new Error('未打开工作区。'))
      const key = normalizePath(directoryPath)
      if (loadedDirectoriesRef.current.has(key)) return Promise.resolve()
      const existing = loadingPromisesRef.current.get(key)
      if (existing) return existing

      const generation = generationRef.current
      setLoadingDirectories((current) => addSetValue(current, key))
      setDirectoryErrors((current) => removeSetValue(current, key))
      const request = desktopClient
        .listWorkspaceFiles(workspacePath, directoryPath, folderId, workspace?.projectId)
        .then((children) => {
          if (generationRef.current !== generation) return
          const normalizedChildren = children.map((child) => ({
            ...child,
            depth: options.replaceRoot ? 0 : parentDepth + 1,
          }))
          const next = options.replaceRoot
            ? dedupeEntries(normalizedChildren)
            : insertDirectoryChildren(entriesRef.current, directoryPath, normalizedChildren)
          replaceEntries(next)
          loadedDirectoriesRef.current.add(key)
          if (options.expandOnSuccess) {
            setExpandedDirectories((current) => addSetValue(current, key))
          }
        })
        .catch((error) => {
          if (generationRef.current === generation) {
            setDirectoryErrors((current) => addSetValue(current, key))
          }
          throw error
        })
        .finally(() => {
          loadingPromisesRef.current.delete(key)
          if (generationRef.current === generation) {
            setLoadingDirectories((current) => removeSetValue(current, key))
          }
        })
      loadingPromisesRef.current.set(key, request)
      return request
    },
    [folderId, replaceEntries, workspace?.path, workspace?.projectId],
  )

  useEffect(() => {
    generationRef.current += 1
    loadingPromisesRef.current.clear()
    loadedDirectoriesRef.current.clear()
    setExpandedDirectories(new Set())
    setLoadingDirectories(new Set())
    setDirectoryErrors(new Set())
    setQuery('')
    if (rootPath && workspace) {
      replaceEntries([])
      void loadDirectory(rootPath, -1, { replaceRoot: true }).catch(() => undefined)
    } else {
      replaceEntries(normalizeRootEntries(files))
    }
  }, [files, loadDirectory, replaceEntries, rootPath, workspace?.path])

  useEffect(() => {
    if (!activePath || !workspace) return
    let cancelled = false
    const revealActivePath = async (): Promise<void> => {
      const pathsToExpand: string[] = []
      const ancestors = ancestorDirectoryPaths(activePath).filter((path) =>
        isWithinRoot(path, rootPath),
      )
      if (rootPath) {
        await loadDirectory(rootPath, -1, { replaceRoot: true })
      }
      for (const directoryPath of ancestors) {
        if (cancelled) return
        const directory = entriesRef.current.find(
          (entry) =>
            entry.type === 'directory' &&
            normalizePath(entry.path) === normalizePath(directoryPath),
        )
        if (!directory) return
        pathsToExpand.push(normalizePath(directory.path))
        await loadDirectory(directory.path, directory.depth)
      }
      if (cancelled) return
      // If activePath itself is a directory, expand and load it too
      const targetEntry = entriesRef.current.find(
        (entry) =>
          entry.type === 'directory' && normalizePath(entry.path) === normalizePath(activePath),
      )
      if (targetEntry) {
        pathsToExpand.push(normalizePath(targetEntry.path))
        await loadDirectory(targetEntry.path, targetEntry.depth)
      }
      if (cancelled || pathsToExpand.length === 0) return
      setExpandedDirectories((current) => {
        const next = new Set(current)
        for (const path of pathsToExpand) next.add(path)
        return next
      })
    }
    void revealActivePath().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [activePath, loadDirectory, revealToken, rootPath, workspace?.path])

  const visibleRows = useMemo(
    () => buildVisibleRows(entries, query, expandedDirectories),
    [entries, expandedDirectories, query],
  )

  useEffect(() => {
    if (!activePath) return
    const index = visibleRows.findIndex(
      (row) => row.kind === 'entry' && normalizePath(row.file.path) === normalizePath(activePath),
    )
    if (index < 0) return
    listRef.current?.scrollToIndex(index, { align: 'nearest' })
    requestAnimationFrame(() => {
      rowRefs.current.get(normalizePath(activePath))?.scrollIntoView({
        block: 'nearest',
      })
    })
  }, [activePath, revealToken, visibleRows])

  useEffect(
    () => () => {
      generationRef.current += 1
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current)
      }
    },
    [],
  )

  function openPreviewSoon(file: DesktopFileEntry): void {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current)
    }
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null
      onOpenFile(file, { preview: true })
    }, 250)
  }

  function openPinned(file: DesktopFileEntry): void {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current)
      previewTimerRef.current = null
    }
    onOpenFile(file, { preview: false })
  }

  function toggleDirectory(file: DesktopFileEntry): void {
    const key = normalizePath(file.path)
    if (loadingDirectories.has(key)) return
    if (directoryErrors.has(key)) {
      void loadDirectory(file.path, file.depth, { expandOnSuccess: true }).catch(() => undefined)
      return
    }
    if (expandedDirectories.has(key)) {
      setExpandedDirectories((current) => removeSetValue(current, key))
      return
    }
    if (loadedDirectoriesRef.current.has(key)) {
      setExpandedDirectories((current) => addSetValue(current, key))
      return
    }
    void loadDirectory(file.path, file.depth, { expandOnSuccess: true }).catch(() => undefined)
  }

  function focusVisibleEntry(startIndex: number, direction: 1 | -1): void {
    let index = startIndex
    while (index >= 0 && index < visibleRows.length) {
      const row = visibleRows[index]
      if (row?.kind === 'entry') {
        listRef.current?.scrollToIndex(index, { align: 'nearest' })
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            rowRefs.current.get(normalizePath(row.file.path))?.focus({ preventScroll: true })
          })
        })
        return
      }
      index += direction
    }
  }

  const renderRow = (row: FileTreeRow): React.ReactElement => {
    const file = row.file
    const key = normalizePath(file.path)
    const sendablePath = getSendableFilePath({
      workspacePath: workspace?.path ?? null,
      file,
    })
    const treeItem = (
      <button
        ref={(element) => {
          if (element) rowRefs.current.set(key, element)
          else rowRefs.current.delete(key)
        }}
        aria-expanded={file.type === 'directory' ? expandedDirectories.has(key) : undefined}
        aria-level={file.depth + 1}
        aria-selected={
          file.type === 'file' && activePath != null ? normalizePath(activePath) === key : undefined
        }
        className={cx(
          'right-dock-tree-row tw:flex tw:h-6.5 tw:min-h-6.5 tw:w-full tw:items-center tw:gap-2 tw:rounded-md tw:border-0 tw:bg-transparent tw:py-0 tw:pr-2 tw:pl-2 tw:text-left tw:text-app-text tw:cursor-pointer tw:select-none tw:type-secondary tw:transition-[background-color,border-color,box-shadow,color] tw:duration-state tw:ease-out tw:hover:bg-app-hover',
          activePath != null && normalizePath(activePath) === key && 'active tw:bg-app-selected',
        )}
        role="treeitem"
        style={{ paddingLeft: `${4 + file.depth * 14}px` }}
        title={file.path}
        type="button"
        onClick={(event) => {
          if (file.type === 'directory') {
            if (event.detail <= 1) toggleDirectory(file)
            return
          }
          if (event.detail <= 1) openPreviewSoon(file)
        }}
        onDoubleClick={() => {
          if (file.type === 'file') openPinned(file)
        }}
        onKeyDown={(event) => {
          const rowIndex = visibleRows.findIndex(
            (candidate) => candidate.kind === 'entry' && normalizePath(candidate.file.path) === key,
          )
          if (event.key === 'Escape') {
            event.preventDefault()
            onEscape?.()
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            focusVisibleEntry(rowIndex + 1, 1)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            focusVisibleEntry(rowIndex - 1, -1)
          } else if (event.key === 'Home') {
            event.preventDefault()
            focusVisibleEntry(0, 1)
          } else if (event.key === 'End') {
            event.preventDefault()
            focusVisibleEntry(visibleRows.length - 1, -1)
          } else if (event.key === 'ArrowRight' && file.type === 'directory') {
            event.preventDefault()
            if (!expandedDirectories.has(key)) toggleDirectory(file)
            else focusVisibleEntry(rowIndex + 1, 1)
          } else if (
            event.key === 'ArrowLeft' &&
            file.type === 'directory' &&
            expandedDirectories.has(key)
          ) {
            event.preventDefault()
            setExpandedDirectories((current) => removeSetValue(current, key))
          } else if (event.key === 'ArrowLeft') {
            const parentPath = parentDirectoryPath(file.path)
            if (!parentPath) return
            const parentIndex = visibleRows.findIndex(
              (candidate) =>
                candidate.kind === 'entry' &&
                normalizePath(candidate.file.path) === normalizePath(parentPath),
            )
            if (parentIndex < 0) return
            event.preventDefault()
            focusVisibleEntry(parentIndex, -1)
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (file.type === 'directory') toggleDirectory(file)
            else onOpenFile(file, { preview: true })
          }
        }}
      >
        {file.type === 'directory' && loadingDirectories.has(key) ? (
          <LoaderCircle
            aria-hidden="true"
            className="right-dock-tree-chevron is-spinning tw:inline-flex tw:size-icon-sm tw:shrink-0 tw:items-center tw:justify-center tw:text-app-text-meta"
            size={APP_ICON_SIZE}
          />
        ) : file.type === 'directory' && directoryErrors.has(key) ? (
          <RotateCcw
            aria-hidden="true"
            className="right-dock-tree-chevron tw:inline-flex tw:size-icon-sm tw:shrink-0 tw:items-center tw:justify-center tw:text-app-text-meta"
            size={APP_ICON_SIZE}
          />
        ) : file.type === 'directory' ? (
          <ChevronRight
            aria-hidden="true"
            className={cx(
              'right-dock-tree-chevron tw:inline-flex tw:size-icon-sm tw:shrink-0 tw:items-center tw:justify-center tw:text-app-text-meta tw:transition-transform tw:duration-state tw:ease-out',
              expandedDirectories.has(key) && 'is-expanded tw:rotate-90',
            )}
            size={APP_ICON_SIZES.sm}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
        ) : (
          <FileTypeIcon
            aria-hidden="true"
            className="right-dock-tree-file-icon tw:inline-flex tw:shrink-0 tw:items-center tw:justify-center"
            path={file.path}
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
        )}
        <span className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
          {file.name}
        </span>
      </button>
    )
    if (!sendablePath) return treeItem
    return (
      <AppContextMenu
        actions={[
          {
            kind: 'item',
            label: '发送到对话框',
            onSelect: () => onAddComposerFiles?.([sendablePath]),
          },
        ]}
        layout="flex"
        trigger={treeItem}
        size="sm"
      />
    )
  }

  return (
    <div
      className={cx(
        'workspace-file-tree right-dock-file-tree tw:flex tw:min-h-0 tw:min-w-0 tw:flex-col tw:overflow-hidden tw:px-1 tw:py-2',
        grouped ? 'tw:h-auto tw:min-h-12 tw:max-h-none' : 'tw:h-full',
        className,
      )}
    >
      {searchable ? (
        <SearchInput
          aria-label="筛选文件"
          autoFocus={autoFocusSearch}
          className="right-dock-search tw:mb-1 tw:h-7 tw:min-h-7 tw:shrink-0 tw:text-app-text-meta tw:shadow-none"
          onChange={setQuery}
          onEscapeEmpty={onEscape}
          placeholder="筛选文件..."
          value={query}
          variant="compact"
        />
      ) : null}
      {visibleRows.length > 0 ? (
        <VList
          ref={listRef}
          className="right-dock-tree-scroll-area right-dock-tree-vlist tw:min-h-0 tw:grow tw:shrink tw:basis-auto tw:overflow-x-hidden tw:overflow-y-auto"
          data={visibleRows}
          data-file-tree-virtualized-scroll="true"
          itemSize={FILE_TREE_ROW_HEIGHT}
          role="tree"
        >
          {(row) => <Fragment key={fileTreeRowKey(row)}>{renderRow(row)}</Fragment>}
        </VList>
      ) : (
        <div className="right-dock-tree-empty tw:px-2 tw:py-5 tw:text-app-text-meta tw:type-body-sm">
          {workspace && rootPath && directoryErrors.has(normalizePath(rootPath)) ? (
            <Button
              color="secondary"
              onClick={() => {
                void loadDirectory(rootPath, -1, { replaceRoot: true }).catch(() => undefined)
              }}
            >
              <RotateCcw aria-hidden="true" size={APP_ICON_SIZE} />
              目录加载失败，点击重试
            </Button>
          ) : workspace ? (
            query ? (
              '没有匹配的文件。'
            ) : (
              '此目录为空。'
            )
          ) : (
            '未打开工作区。'
          )}
        </div>
      )}
    </div>
  )
}

export function getSendableFilePath({
  workspacePath,
  file,
}: {
  workspacePath: string | null
  file: DesktopFileEntry
}): string | null {
  if (!workspacePath || file.type !== 'file') return null
  return `${workspacePath.replace(/[\\/]$/, '')}/${file.path.replace(/^[\\/]/, '')}`
}

export { createWorkspaceFileTabId }

function normalizeRootEntries(files: DesktopFileEntry[]): DesktopFileEntry[] {
  return dedupeEntries(files.map((file) => ({ ...file, depth: 0 })))
}

function dedupeEntries(entries: DesktopFileEntry[]): DesktopFileEntry[] {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    const key = normalizePath(entry.path)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function insertDirectoryChildren(
  entries: DesktopFileEntry[],
  directoryPath: string,
  children: DesktopFileEntry[],
): DesktopFileEntry[] {
  const parentIndex = entries.findIndex(
    (entry) => normalizePath(entry.path) === normalizePath(directoryPath),
  )
  if (parentIndex < 0) return entries
  const existing = new Set(entries.map((entry) => normalizePath(entry.path)))
  const uniqueChildren = children.filter((child) => !existing.has(normalizePath(child.path)))
  if (uniqueChildren.length === 0) return entries
  return [
    ...entries.slice(0, parentIndex + 1),
    ...uniqueChildren,
    ...entries.slice(parentIndex + 1),
  ]
}

function buildVisibleRows(
  entries: DesktopFileEntry[],
  query: string,
  expandedDirectories: Set<string>,
): FileTreeRow[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery) {
    return entries
      .filter((entry) => entry.path.toLowerCase().includes(normalizedQuery))
      .map((file) => ({ kind: 'entry' as const, file }))
  }

  const rows: FileTreeRow[] = []
  const hiddenDirectories: string[] = []
  for (const file of entries) {
    while (
      hiddenDirectories.length > 0 &&
      !isDescendantOf(file.path, hiddenDirectories.at(-1) ?? '')
    ) {
      hiddenDirectories.pop()
    }
    if (hiddenDirectories.length > 0) continue
    rows.push({ kind: 'entry', file })
    if (file.type !== 'directory') continue
    const key = normalizePath(file.path)
    if (!expandedDirectories.has(key)) {
      hiddenDirectories.push(file.path)
      continue
    }
  }
  return rows
}

function ancestorDirectoryPaths(path: string): string[] {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'))
}

function parentDirectoryPath(path: string): string | null {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return segments.length > 1 ? segments.slice(0, -1).join('/') : null
}

function isWithinRoot(path: string, rootPath: string | null): boolean {
  if (!rootPath) return true
  const key = normalizePath(path)
  const rootKey = normalizePath(rootPath)
  return key !== rootKey && key.startsWith(`${rootKey}/`)
}

function fileTreeRowKey(row: FileTreeRow): string {
  return `entry:${normalizePath(row.file.path)}`
}

function addSetValue(current: Set<string>, value: string): Set<string> {
  if (current.has(value)) return current
  const next = new Set(current)
  next.add(value)
  return next
}

function removeSetValue(current: Set<string>, value: string): Set<string> {
  if (!current.has(value)) return current
  const next = new Set(current)
  next.delete(value)
  return next
}

function normalizePath(path: string): string {
  return normalizePathForComparison(path)
}

function isDescendantOf(path: string, directoryPath: string): boolean {
  const normalizedPath = normalizePath(path)
  const normalizedDirectory = normalizePath(directoryPath)
  return normalizedPath.startsWith(`${normalizedDirectory}/`)
}
