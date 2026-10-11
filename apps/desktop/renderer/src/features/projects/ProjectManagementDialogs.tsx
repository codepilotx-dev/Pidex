import type React from 'react'
import { lazy, Suspense, useState } from 'react'
import type { DesktopWorkspace } from '../../../shared/Types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { useEverOpened } from '../../hooks/UsePresenceRetention.js'
import { useDesktopSettings } from '../settings/UseDesktopSettings.js'
import { DEFAULT_PROJECT_APPEARANCE } from './ProjectAppearance.js'
import { notifyProjectCatalogChanged, notifyProjectRemoved } from './ProjectCatalogEvents.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'

const ProjectEditDialog = lazy(async () => {
  const module = await import('./ProjectEditDialog.js')
  return { default: module.ProjectEditDialog }
})

type Props = {
  project: DesktopWorkspace
  managerOpen: boolean
  confirmRemoveOpen: boolean
  busy?: boolean
  setManagerOpen: (open: boolean) => void
  setConfirmRemoveOpen: (open: boolean) => void
  onProjectChange: (project: DesktopWorkspace) => void
  onArchiveSessions: () => Promise<boolean>
  onRemoveWorkspace: (project: DesktopWorkspace) => void
  onReport: (message: string) => void
}

export function ProjectManagementDialogs({
  project,
  managerOpen,
  confirmRemoveOpen,
  busy = false,
  setManagerOpen,
  setConfirmRemoveOpen,
  onProjectChange,
  onRemoveWorkspace,
  onReport,
}: Props): React.ReactNode {
  const confirmationDialogMounted = useEverOpened(confirmRemoveOpen)
  const managerDialogMounted = useEverOpened(managerOpen)
  const [processingAction, setProcessingAction] = useState<'remove' | null>(null)
  const { projectAppearances, setProjectAppearances } = useDesktopSettings()
  const appearance = project.projectId
    ? (projectAppearances[project.projectId] ?? DEFAULT_PROJECT_APPEARANCE)
    : DEFAULT_PROJECT_APPEARANCE
  return (
    <>
      {confirmationDialogMounted ? (
        <Suspense fallback={null}>
          <ConfirmationDialog
            actionDisabled={busy || processingAction !== null}
            actionLabel={processingAction === 'remove' ? '处理中…' : '移除'}
            description="这只会从应用中移除项目。磁盘文件和现有聊天会保留，聊天将移出项目并继续使用原工作目录。"
            open={confirmRemoveOpen}
            title={`移除 ${project.name}?`}
            tone="danger"
            onAction={() => {
              if (busy || processingAction) return
              setProcessingAction('remove')
              void (
                project.projectId
                  ? desktopClient.removeProject(project.projectId).then((result) => {
                      if (result.removalOperationId && result.undoExpiresAt)
                        notifyProjectRemoved({
                          project,
                          removalOperationId: result.removalOperationId,
                          undoExpiresAt: result.undoExpiresAt,
                        })
                      return true
                    })
                  : Promise.resolve(true)
              )
                .then((success) => {
                  if (!success) return
                  setConfirmRemoveOpen(false)
                  onRemoveWorkspace(project)
                  notifyProjectCatalogChanged()
                })
                .catch((error) => onReport(error instanceof Error ? error.message : String(error)))
                .finally(() => setProcessingAction(null))
            }}
            onCancel={() => setConfirmRemoveOpen(false)}
          />
        </Suspense>
      ) : null}

      {managerDialogMounted ? (
        <Suspense fallback={null}>
          <ProjectEditDialog
            appearance={appearance}
            open={managerOpen}
            project={project}
            onAppearanceChange={(nextAppearance) => {
              if (!project.projectId) return
              setProjectAppearances((current) => ({
                ...current,
                [project.projectId as string]: nextAppearance,
              }))
            }}
            onOpenChange={setManagerOpen}
            onProjectChange={onProjectChange}
            onReport={onReport}
            onRequestRemove={() => {
              setManagerOpen(false)
              setConfirmRemoveOpen(true)
            }}
          />
        </Suspense>
      ) : null}
    </>
  )
}
