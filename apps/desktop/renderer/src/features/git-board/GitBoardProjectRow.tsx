import { useShallow } from 'zustand/react/shallow'
import type { DesktopWorkspace } from '../../../shared/Types.js'
import { APP_ICON_SIZE } from '../../components/ui/IconTokens.js'
import { cx } from '../../utils/Cx.js'
import { useDesktopSettingsField } from '../settings/UseDesktopSettings.js'
import {
  DEFAULT_PROJECT_APPEARANCE,
  PROJECT_APPEARANCE_COLOR_CLASS,
  PROJECT_APPEARANCE_MARKER_CLASS,
  ProjectAppearanceGlyph,
} from '../projects/ProjectAppearance.js'
import { SidebarRow } from '../layout/sidebar/SidebarRow.js'
import { useGitBoard } from './GitBoardContext.js'

export function GitBoardProjectRow({ project }: { project: DesktopWorkspace }) {
  const { repositories, selectedProjectId, view, remoteView, selectProject, openGroup } =
    useGitBoard(
      useShallow((state) => ({
        repositories: state.repositories,
        selectedProjectId: state.selectedProjectId,
        view: state.view,
        remoteView: state.remoteView,
        selectProject: state.selectProject,
        openGroup: state.openGroup,
      })),
    )
  const projectAppearances = useDesktopSettingsField((settings) => settings.projectAppearances)
  const projectId = project.projectId!
  const activeProjectId = selectedProjectId !== undefined ? selectedProjectId : (view?.id ?? null)
  const active = remoteView === 'board' && activeProjectId === projectId
  const result = repositories[projectId]?.result
  const isUnavailable = result?.ok === false
  const appearance = projectAppearances[projectId] ?? DEFAULT_PROJECT_APPEARANCE

  return (
    <SidebarRow
      active={active}
      className={cx(
        'sidebar-project-header',
        isUnavailable &&
          'sidebar-project-header--unavailable tw:text-app-text-disabled tw:hover:bg-transparent tw:[&_.sidebar-item-icon]:text-app-text-disabled',
      )}
      labelClassName="sidebar-project-name tw:flex tw:min-w-0 tw:items-center tw:text-inherit"
      layout="flex"
      leading={
        <ProjectAppearanceGlyph
          size={APP_ICON_SIZE}
          appearance={appearance}
          className={cx(
            PROJECT_APPEARANCE_MARKER_CLASS,
            PROJECT_APPEARANCE_COLOR_CLASS[appearance.color] ?? 'tw:text-app-text-soft',
          )}
        />
      }
    >
      <button
        type="button"
        aria-current={active ? 'page' : undefined}
        className="sidebar-project-button tw:flex tw:min-w-0 tw:w-full tw:flex-1 tw:cursor-pointer tw:items-center tw:gap-2 tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:text-inherit tw:focus-visible:outline-none"
        onClick={() => (selectProject ?? openGroup)?.(projectId)}
      >
        <span className="sidebar-project-title-text tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-inherit tw:type-row-title">
          {project.name}
        </span>
      </button>
    </SidebarRow>
  )
}
