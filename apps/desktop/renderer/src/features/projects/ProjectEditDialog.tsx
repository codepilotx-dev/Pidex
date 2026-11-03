import * as Dialog from '@radix-ui/react-dialog'
import { Folder, FolderPlus, RefreshCw, Star, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import type {
  DesktopProjectFolder,
  DesktopWorkspace,
  ProjectAppearance,
} from '../../../shared/Types.js'
import { Button } from '../../components/ui/Button.js'

import { useDialogFocusRestore } from '../../components/ui/UseDialogFocusRestore.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import { cx } from '../../utils/Cx.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { ProjectAppearancePicker } from './ProjectAppearancePicker.js'
import { projectFolderPaths, type ProjectFolderSaveDraft } from './ProjectEditModel.js'
import { notifyProjectCatalogChanged } from './ProjectCatalogEvents.js'
import { errorMessageOf as errorMessage } from '@pidex/shared/errors'

type DraftFolder = DesktopProjectFolder & ProjectFolderSaveDraft

type Props = {
  appearance: ProjectAppearance
  open: boolean
  project: DesktopWorkspace
  onAppearanceChange: (appearance: ProjectAppearance) => void
  onOpenChange: (open: boolean) => void
  onProjectChange: (project: DesktopWorkspace) => void
  onReport: (message: string) => void
  onRequestRemove: () => void
}

export function ProjectEditDialog({
  appearance,
  open,
  project,
  onAppearanceChange,
  onOpenChange,
  onProjectChange,
  onReport,
  onRequestRemove,
}: Props): React.ReactNode {
  const [draftName, setDraftName] = useState(project.name)
  const [draftAppearance, setDraftAppearance] = useState(appearance)
  const [draftFolders, setDraftFolders] = useState<DraftFolder[]>(() => createFolderDraft(project))
  const [sourceCounts, setSourceCounts] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const projectId = project.projectId
  const { onCloseAutoFocus } = useDialogFocusRestore(open)

  useEffect(() => {
    if (!open) return
    setDraftName(project.name)
    setDraftFolders(createFolderDraft(project))
    setBusy(false)
  }, [open, project])

  useEffect(() => {
    if (!open) return
    setDraftAppearance(appearance)
  }, [appearance, open])

  useEffect(() => {
    if (!open) return
    if (!projectId) return
    void desktopClient
      .listProjectSources(projectId)
      .then((sources) => {
        const counts: Record<string, number> = {}
        for (const source of sources) {
          if (source.storage !== 'workspace-file') continue
          counts[source.folderId] = (counts[source.folderId] ?? 0) + 1
        }
        setSourceCounts(counts)
      })
      .catch((error) => onReport(errorMessage(error)))
  }, [open, projectId, onReport])

  async function addFolder(): Promise<void> {
    addPaths(await desktopClient.chooseProjectFolders())
  }

  function addPaths(paths: string[]): void {
    setDraftFolders((current) => {
      const next = [...current]
      for (const path of paths) {
        if (next.some((folder) => samePath(folder.path, path))) continue
        const folder = createNewDraftFolder(path, next.length)
        if (next.length === 0) folder.role = 'primary'
        next.push(folder)
      }
      return next
    })
  }

  async function reselectFolder(folder: DraftFolder): Promise<void> {
    const path = await desktopClient.chooseProjectFolder()
    if (!path) return
    if (
      draftFolders.some((candidate) => candidate.id !== folder.id && samePath(candidate.path, path))
    ) {
      onReport('该目录已经在项目中。')
      return
    }
    const affectedSources = folder.originalId ? (sourceCounts[folder.originalId] ?? 0) : 0
    if (
      affectedSources > 0 &&
      !window.confirm(`重新选择目录会移除原目录下的 ${affectedSources} 个路径来源，是否继续？`)
    ) {
      return
    }
    setDraftFolders((current) =>
      current.map((candidate) =>
        candidate.id === folder.id
          ? {
              ...createNewDraftFolder(path, candidate.order),
              role: candidate.role,
            }
          : candidate,
      ),
    )
  }

  function setPrimary(folderId: string): void {
    setDraftFolders((current) =>
      [
        ...current.filter((folder) => folder.id === folderId),
        ...current.filter((folder) => folder.id !== folderId),
      ].map((folder, order) => ({ ...folder, role: order === 0 ? 'primary' : 'secondary', order })),
    )
  }

  function removeFolder(folder: DraftFolder): void {
    const affectedSources = folder.originalId ? (sourceCounts[folder.originalId] ?? 0) : 0
    if (
      affectedSources > 0 &&
      !window.confirm(`移除此目录会同时移除 ${affectedSources} 个路径来源，是否继续？`)
    ) {
      return
    }
    setDraftFolders((current) =>
      current
        .filter((candidate) => candidate.id !== folder.id)
        .map((candidate, order) => ({
          ...candidate,
          role: order === 0 ? 'primary' : 'secondary',
          order,
        })),
    )
  }

  async function save(): Promise<void> {
    if (!projectId || busy || !draftName.trim()) return
    setBusy(true)
    try {
      const current = await desktopClient.editProject({
        projectId,
        name: draftName.trim(),
        paths: projectFolderPaths(draftFolders),
        expectedVersion: project.projectVersion ?? 0,
      })
      onProjectChange(current)
      notifyProjectCatalogChanged()
      onOpenChange(false)
      onReport('项目已保存。')
    } catch (error) {
      onReport(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen)
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop project-edit-backdrop tw:backdrop-blur-none" />
        <Dialog.Content
          aria-describedby={undefined}
          className="ui-dialog-surface ui-dialog-surface--centered project-edit-dialog tw:flex tw:flex-col tw:box-border tw:w-[min(32rem,calc(100vw-2rem))] tw:max-w-[calc(100vw-2rem)] tw:max-h-[calc(100vh-2rem)] tw:overflow-y-auto tw:gap-3 tw:p-5 tw:text-app-text tw:outline-none"
          onCloseAutoFocus={onCloseAutoFocus}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            const initialFocus = nameInputRef.current ?? closeButtonRef.current
            initialFocus?.focus()
            if (initialFocus === nameInputRef.current) {
              nameInputRef.current?.select()
            }
          }}
        >
          <header className="project-edit-header tw:flex tw:items-center tw:justify-between tw:gap-4">
            <Dialog.Title className="tw:m-0 tw:type-title-lg tw:text-app-text">
              编辑项目
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button
                isIconOnly
                className="project-edit-close"
                color="ghostSecondary"
                disabled={busy}
                ref={closeButtonRef}
                size="toolbar"
                title="关闭编辑项目"
              >
                <X size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              </Button>
            </Dialog.Close>
          </header>

          {!projectId ? (
            <p className="project-edit-empty tw:m-0 tw:type-body tw:text-app-text-meta">
              当前任务尚未关联稳定项目。
            </p>
          ) : (
            <>
              <div className="project-edit-name-field tw:flex tw:h-10 tw:min-h-10 tw:items-center tw:overflow-hidden tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-canvas tw:focus-within:border-app-border-strong tw:focus-within:shadow-[var(--cpx-sys-focus-ring-inset)]">
                <ProjectAppearancePicker
                  appearance={draftAppearance}
                  disabled={busy}
                  glyphSize={APP_ICON_SIZE}
                  onChange={(nextAppearance) => {
                    setDraftAppearance(nextAppearance)
                    onAppearanceChange(nextAppearance)
                  }}
                />
                <input
                  aria-label="项目名称"
                  className="project-edit-name-input tw:min-w-0 tw:flex-1 tw:h-full tw:border-0 tw:bg-transparent tw:px-1 tw:py-0 tw:text-app-text tw:type-body tw:outline-none"
                  maxLength={120}
                  ref={nameInputRef}
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void save()
                  }}
                />
              </div>

              <section className="project-edit-folders tw:flex tw:flex-col tw:gap-2">
                <h3 className="tw:m-0 tw:type-row-title tw:text-app-text">源文件夹</h3>
                <div
                  onDragOver={(event) => {
                    if (!busy) {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'copy'
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (!busy)
                      addPaths(
                        Array.from(event.dataTransfer.files)
                          .map((file) => desktopClient.getComposerFilePath(file))
                          .filter(Boolean),
                      )
                  }}
                  className="project-edit-folder-list tw:max-h-[15rem] tw:overflow-y-auto tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-canvas"
                >
                  {draftFolders.map((folder) => (
                    <div
                      className={cx(
                        'project-edit-folder-row tw:box-border tw:flex tw:h-12 tw:min-h-12 tw:w-full tw:items-center tw:gap-3 tw:border-0 tw:border-b tw:border-app-border-subtle tw:bg-transparent tw:px-3 tw:text-start',
                        folder.availability === 'missing'
                          ? 'is-missing tw:text-app-text-meta'
                          : 'tw:text-app-text',
                      )}
                      key={folder.id}
                    >
                      <Folder size="var(--inline-icon-size, 1em)" />
                      <span
                        className="project-edit-folder-name tw:min-w-0 tw:flex-1 tw:truncate tw:px-1 tw:type-body"
                        title={folder.path}
                      >
                        {folder.name}
                      </span>
                      {draftFolders.length > 1 && folder.role === 'primary' ? (
                        <span
                          title="新聊天使用主目录作为工作目录，并在这里查找 AGENTS.md、config.toml 和技能文件"
                          className="project-edit-primary-badge tw:shrink-0 tw:rounded-full tw:bg-app-hover tw:px-2 tw:py-1 tw:type-caption tw:text-app-text-soft"
                        >
                          主目录
                        </span>
                      ) : null}
                      {draftFolders.length > 1 && folder.role !== 'primary' ? (
                        <Button
                          isIconOnly
                          className="project-edit-folder-action tw:w-[1.875rem]"
                          color="ghostSecondary"
                          disabled={busy}
                          size="toolbar"
                          title={`将 ${folder.name} 设为主目录`}
                          type="button"
                          onClick={() => setPrimary(folder.id)}
                        >
                          <Star size={APP_ICON_SIZE} />
                        </Button>
                      ) : null}
                      {folder.availability === 'missing' ? (
                        <Button
                          isIconOnly
                          className="project-edit-folder-action tw:w-[1.875rem]"
                          color="ghostSecondary"
                          disabled={busy}
                          size="toolbar"
                          title={`重新选择目录 ${folder.name}`}
                          type="button"
                          onClick={() => void reselectFolder(folder)}
                        >
                          <RefreshCw size={APP_ICON_SIZE} />
                        </Button>
                      ) : null}
                      <Button
                        isIconOnly
                        className="project-edit-folder-action tw:w-[1.875rem]"
                        color="ghostSecondary"
                        disabled={busy}
                        size="toolbar"
                        title={`移除目录 ${folder.name}`}
                        type="button"
                        onClick={() => removeFolder(folder)}
                      >
                        <X size={APP_ICON_SIZE} />
                      </Button>
                    </div>
                  ))}
                  <button
                    className="project-edit-add-folder tw:box-border tw:flex tw:h-12 tw:min-h-12 tw:w-full tw:cursor-pointer tw:items-center tw:gap-3 tw:border-0 tw:bg-transparent tw:px-3 tw:text-start tw:text-app-text-soft tw:type-body tw:enabled:hover:bg-app-hover tw:enabled:hover:text-app-text"
                    disabled={busy}
                    type="button"
                    onClick={() => void addFolder()}
                  >
                    <FolderPlus size="var(--inline-icon-size, 1em)" />
                    <span className="tw:px-1">添加文件夹</span>
                  </button>
                </div>
              </section>
            </>
          )}

          <footer className="project-edit-footer tw:mt-2 tw:flex tw:items-center tw:justify-between tw:gap-3">
            <Button
              className="project-edit-delete tw:me-auto"
              color="danger"
              disabled={busy || !projectId}
              size="medium"
              onClick={onRequestRemove}
            >
              <Trash2 size={APP_ICON_SIZE} />
              移除本地项目
            </Button>
            <div className="project-edit-footer-actions tw:flex tw:items-center tw:gap-3">
              <Dialog.Close asChild>
                <Button color="secondary" disabled={busy} size="medium">
                  取消
                </Button>
              </Dialog.Close>
              <Button
                color="primary"
                disabled={busy || !projectId || !draftName.trim()}
                loading={busy}
                size="medium"
                onClick={() => void save()}
              >
                保存
              </Button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function createFolderDraft(project: DesktopWorkspace): DraftFolder[] {
  return (project.folders ?? []).map((folder) => ({
    ...folder,
    originalId: folder.id,
  }))
}

function createNewDraftFolder(path: string, order: number): DraftFolder {
  const normalized = path.replace(/[\\/]+$/, '')
  const segments = normalized.split(/[\\/]/)
  return {
    id: `draft:${crypto.randomUUID()}`,
    name: segments.at(-1) || normalized,
    path,
    role: 'secondary',
    availability: 'available',
    order,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    originalId: null,
  }
}

function samePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right)
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/, '').toLocaleLowerCase()
}
