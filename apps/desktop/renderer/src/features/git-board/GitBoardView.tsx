import { useShallow } from 'zustand/react/shallow'
import { lazy, Suspense, useState, type ReactNode } from 'react'
import { ChevronDown, GitBranch, RefreshCw } from 'lucide-react'
import type { DesktopWorkspace } from '../../../shared/Types.js'
import { Tooltip } from '../../components/ui/Tooltip.js'
import { Select } from '../../components/ui/Select.js'
import { DisclosureController } from '../../components/ui/DisclosureController.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import { Button } from '../../components/ui/Button.js'
import { SearchInput } from '../../components/ui/SearchInput.js'
import { cx } from '../../utils/Cx.js'
import { useLocale } from '../i18n/LocaleProvider.js'
import { FileTypeIcon } from '../layout/FileTypeIcon.js'
import { SidebarRow } from '../../components/ui/SidebarRow.js'
import { PrimaryPageLayout } from '../layout/primary-page/index.js'
import {
  useGitBoard,
  type GitBoardRepository,
  type GitBoardReviewSelection,
} from './GitBoardContext.js'
import { useGitBoardActions } from './GitBoardActions.js'
import { GitBoardCommitRows } from './GitBoardCommitRows.js'
import { GitBoardGithubView } from './GitBoardGithubView.js'
import {
  GIT_BOARD_ACTION_LABEL,
  GitBoardRepositoryMenu,
  gitBoardActionAvailability,
  type GitBoardAction,
} from './GitBoardRepositoryMenu.js'
import { gitBoardFileStatuses, hasGitBoardConflicts } from './GitBoardStatus.js'

export { gitBoardFileStatuses } from './GitBoardStatus.js'

const GitBoardDetails = lazy(() =>
  import('./GitBoardDetails.js').then((module) => ({ default: module.GitBoardDetails })),
)

function CountChip({ count }: { count: number }) {
  return (
    <span className="tw:inline-flex tw:min-w-5 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-full tw:bg-app-selected tw:px-1.5 tw:type-caption tw:tabular-nums">
      {count}
    </span>
  )
}

function SectionSummary({
  title,
  count,
  diffStats,
  showDiff = false,
  expanded,
  contentId,
  onToggle,
}: {
  title: string
  count: number
  diffStats?: GitBoardRepository['diffStats']
  showDiff?: boolean
  expanded: boolean
  contentId: string
  onToggle: () => void
}) {
  const { t } = useLocale()
  return (
    <button
      type="button"
      aria-controls={contentId}
      aria-expanded={expanded}
      onClick={onToggle}
      className="tw:group/section-summary tw:flex tw:min-h-[var(--sidebar-row-height,30px)] tw:w-full tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-md tw:border-0 tw:bg-transparent tw:p-0 tw:px-2 tw:select-none tw:text-left tw:type-body tw:text-app-text-meta tw:focus-visible:outline-app-focus"
    >
      <span>{title}</span>
      <ChevronDown
        aria-hidden="true"
        size="var(--inline-icon-size, 1em)"
        className={cx(
          'tw:shrink-0 tw:opacity-0 tw:group-hover/section-summary:opacity-100 tw:group-focus-visible/section-summary:opacity-100 tw:[transition:opacity_var(--cpx-sys-motion-feedback)_var(--cpx-sys-ease-out),transform_var(--cpx-sys-motion-disclosure)_var(--cpx-sys-ease-disclosure)]',
          expanded ? 'tw:rotate-0' : 'tw:-rotate-90',
        )}
      />
      <span className="tw:ml-auto tw:inline-flex tw:shrink-0 tw:items-center tw:gap-2">
        {showDiff &&
          (diffStats ? (
            <Tooltip content={t('新增和删除行数')}>
              <span className="tw:inline-flex tw:gap-1 tw:type-caption tw:tabular-nums">
                <span className="tw:text-app-success">+{diffStats.additions}</span>
                <span className="tw:text-app-danger">-{diffStats.deletions}</span>
              </span>
            </Tooltip>
          ) : (
            <Tooltip content={t('改动统计暂不可用')}>
              <span>—</span>
            </Tooltip>
          ))}
        <CountChip count={count} />
      </span>
    </button>
  )
}

function BoardSection({
  title,
  count,
  diffStats,
  showDiff,
  className,
  children,
}: {
  title: string
  count: number
  diffStats?: GitBoardRepository['diffStats']
  showDiff?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cx('tw:group', className)}>
      <DisclosureController
        defaultExpanded
        renderTrigger={({ expanded, contentId, toggle }) => (
          <h3 className="tw:m-0">
            <SectionSummary
              contentId={contentId}
              count={count}
              diffStats={diffStats}
              expanded={expanded}
              showDiff={showDiff}
              title={title}
              onToggle={toggle}
            />
          </h3>
        )}
      >
        {children}
      </DisclosureController>
    </section>
  )
}

export function RepositoryColumn({
  project,
  repository,
  actionBusy = false,
  actionError,
  onSelect,
  onBranchChange,
  onAction,
}: {
  project: DesktopWorkspace
  repository?: GitBoardRepository
  actionBusy?: boolean
  actionError?: string
  onSelect: (selection: GitBoardReviewSelection) => void
  onBranchChange: () => void
  onAction?: (action: GitBoardAction) => void
}) {
  const { t } = useLocale()
  const {
    refreshView: refresh,
    selectedRefs,
    selectBranch,
    supportsCommitRef,
    capabilities,
    selectedReview,
  } = useGitBoard(
    useShallow((state) => ({
      refreshView: state.refreshView,
      selectedRefs: state.selectedRefs,
      selectBranch: state.selectBranch,
      supportsCommitRef: state.supportsCommitRef,
      capabilities: state.capabilities,
      selectedReview: state.selectedReview,
    })),
  )
  const result = repository?.result
  const status = result?.ok ? result.status : null
  const actionAvailability = gitBoardActionAvailability({
    capabilities,
    available: status !== null,
    busy: actionBusy,
  })
  const actionCaption = !repository
    ? t('仓库加载中，仓库操作暂不可用')
    : !status
      ? t('仓库状态不可用，仓库操作已禁用')
      : actionAvailability.missing.length
        ? `${t('当前服务不支持')}：${actionAvailability.missing
            .map((action) => t(GIT_BOARD_ACTION_LABEL[action]))
            .join('、')}`
        : actionBusy
          ? t('正在执行仓库操作…')
          : null
  const selectedRef = supportsCommitRef ? (selectedRefs[project.projectId!] ?? 'HEAD') : 'HEAD'
  const branchOptions = [
    { value: 'HEAD', label: `${status?.branchName ?? 'detached HEAD'} (HEAD)` },
    ...(repository?.branches ?? []).map((branch) => ({
      value: branch.name,
      label: branch.name,
      detail: t(branch.remote ? '远端分支' : '本地分支'),
    })),
  ]
  if (!branchOptions.some((branch) => branch.value === selectedRef))
    branchOptions.push({ value: selectedRef, label: selectedRef })
  return (
    <section
      aria-label={project.name}
      aria-busy={actionBusy || undefined}
      className="tw:flex tw:h-full tw:min-h-0 tw:w-[400px] tw:min-w-[400px] tw:flex-none tw:flex-col tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-panel"
    >
      <header className="tw:shrink-0 tw:border-b tw:border-app-border-subtle tw:p-4">
        <div className="tw:flex tw:items-center tw:justify-between tw:gap-2">
          <Tooltip content={project.path}>
            <h2 className="tw:m-0 tw:truncate tw:type-title-sm">{project.name}</h2>
          </Tooltip>
          <span className="tw:inline-flex tw:shrink-0 tw:items-center tw:gap-1">
            {status && (
              <Tooltip
                content={`${status.branchName ?? 'detached HEAD'} · ${status.upstream ?? t('未设置上游')}`}
              >
                <span className="tw:shrink-0 tw:whitespace-nowrap tw:type-caption tw:text-app-text-meta">{`↑ ${status.ahead} ↓ ${status.behind}`}</span>
              </Tooltip>
            )}
            <GitBoardRepositoryMenu
              available={status !== null}
              busy={actionBusy}
              capabilities={capabilities}
              projectName={project.name}
              onAction={(action) => onAction?.(action)}
            />
          </span>
        </div>
        {status && (
          <div className="tw:mt-2 tw:flex tw:min-w-0 tw:items-center tw:gap-2 tw:type-caption tw:text-app-text-meta">
            <GitBranch size={14} />
            <Tooltip
              content={t(
                !supportsCommitRef
                  ? '当前服务不支持按分支查看'
                  : (repository?.branchError ?? '选择查看分支'),
              )}
            >
              <span className="tw:min-w-0 tw:flex-1">
                <Select
                  value={selectedRef}
                  options={branchOptions}
                  ariaLabel={t('选择查看分支')}
                  searchable
                  disabled={!supportsCommitRef || !repository?.branches}
                  triggerClassName="tw:w-full"
                  onValueChange={(ref) => {
                    onBranchChange()
                    selectBranch(project.projectId!, ref)
                  }}
                />
              </span>
            </Tooltip>
            {repository?.branchError && (
              <Tooltip content={t(repository.branchError)}>
                <Button
                  isIconOnly
                  nativeTitle={false}
                  variant="text"
                  title={t('重试')}
                  onClick={refresh}
                >
                  <RefreshCw size={14} />
                </Button>
              </Tooltip>
            )}
          </div>
        )}
        {actionCaption && (
          <p className="tw:m-0 tw:mt-2 tw:type-caption tw:text-app-text-meta">{actionCaption}</p>
        )}
        {actionError && (
          <p role="alert" className="tw:m-0 tw:mt-2 tw:type-caption tw:text-app-danger">
            {actionError}
          </p>
        )}
      </header>
      <div className="tw:min-h-0 tw:flex-1 tw:overflow-y-auto tw:py-3 tw:pl-3 tw:pr-1">
        {repository?.refreshError && result?.ok && (
          // 刷新失败时保留上一份仓库数据，只在这里提供重试入口。
          <div
            role="alert"
            className="tw:mb-3 tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:px-2 tw:type-caption tw:text-app-danger"
          >
            <span className="tw:min-w-0 tw:flex-1">{t(repository.refreshError)}</span>
            <Button variant="text" size="compact" onClick={refresh}>
              {t('重试')}
            </Button>
          </div>
        )}
        {!result ? (
          <p role="status">{t('加载中')}</p>
        ) : !result.ok ? (
          <div role="alert">
            <p>{result.ok === false ? result.error : ''}</p>
            <Button variant="text" onClick={refresh}>
              {t('重试')}
            </Button>
          </div>
        ) : (
          <>
            <BoardSection
              className="tw:mb-4"
              title={t('未提交改动')}
              count={result.status.files.length}
              showDiff
              diffStats={repository?.diffStats}
            >
              {hasGitBoardConflicts(result.status.files) && (
                <p role="status" className="tw:px-2 tw:py-3 tw:type-body-sm tw:text-app-text-meta">
                  {t('存在未解决的冲突，差异统计暂不可用。')}
                </p>
              )}
              {result.status.clean && (
                <p className="tw:py-3 tw:type-body-sm tw:text-app-text-meta">{t('工作区干净')}</p>
              )}
              {result.status.files.map((file) => (
                <SidebarRow
                  key={file.path}
                  active={
                    selectedReview?.project.projectId === project.projectId &&
                    selectedReview.source.kind === 'uncommitted' &&
                    selectedReview.path === file.path
                  }
                  asChild
                  layout="flex"
                  leadingMode="none"
                  labelClassName="tw:gap-2"
                >
                  <button
                    type="button"
                    className="tw:border-0 tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus"
                    onClick={() =>
                      onSelect({ project, source: { kind: 'uncommitted' }, path: file.path })
                    }
                  >
                    <FileTypeIcon
                      aria-hidden="true"
                      associationMode="extension-only"
                      path={file.path}
                      size={APP_ICON_SIZE}
                    />
                    <Tooltip content={file.path}>
                      <span className="tw:min-w-0 tw:flex-1 tw:truncate tw:type-row-title">
                        {file.path.split(/[\\/]/).pop()}
                      </span>
                    </Tooltip>
                    <span className="tw:flex tw:shrink-0 tw:gap-1 tw:type-caption tw:text-app-text-meta">
                      {gitBoardFileStatuses(file).map(({ code, label }, index) => (
                        <Tooltip key={index} content={t(label)}>
                          <span aria-label={t(label)}>{code}</span>
                        </Tooltip>
                      ))}
                    </span>
                  </button>
                </SidebarRow>
              ))}
            </BoardSection>
            <BoardSection title={t('最近提交')} count={repository?.commits?.length ?? 0}>
              <GitBoardCommitRows project={project} repository={repository} onSelect={onSelect} />
            </BoardSection>
          </>
        )}
      </div>
    </section>
  )
}

function ProjectBoard() {
  const { t } = useLocale()
  const {
    view,
    selectedProjectId,
    selectedProject,
    projects,
    repositories,
    ready,
    selectedReview,
    selectReview,
    clearReview,
  } = useGitBoard(
    useShallow((state) => ({
      view: state.view,
      selectedProjectId: state.selectedProjectId,
      selectedProject: state.selectedProject,
      projects: state.projects,
      repositories: state.repositories,
      ready: state.ready,
      selectedReview: state.selectedReview,
      selectReview: state.selectReview,
      clearReview: state.clearReview,
    })),
  )
  const activeProjectId =
    selectedProjectId !== undefined ? selectedProjectId : (view?.projectIds?.[0] ?? null)
  const project =
    selectedProject ??
    (activeProjectId ? (projects.find((item) => item.projectId === activeProjectId) ?? null) : null)
  const selectedResult = selectedReview
    ? repositories[selectedReview.project.projectId!]?.result
    : undefined
  const actions = useGitBoardActions((projectId) => {
    if (selectedReview?.project.projectId === projectId) clearReview()
  })

  if (!activeProjectId) {
    return (
      <div
        inert={ready === false}
        className="tw:flex tw:min-h-0 tw:min-w-0 tw:flex-1 tw:items-center tw:justify-center tw:overflow-hidden"
      >
        <p className="tw:m-auto tw:type-body-sm tw:text-app-text-meta">
          {t('从左侧选择一个项目查看 Git 状态')}
        </p>
      </div>
    )
  }

  if (!project) {
    return (
      <div
        inert={ready === false}
        className="tw:flex tw:min-h-0 tw:min-w-0 tw:flex-1 tw:items-center tw:justify-center tw:overflow-hidden"
      >
        <p className="tw:m-auto tw:type-body-sm tw:text-app-text-meta">
          {t('项目已移除或暂不可用')}
        </p>
      </div>
    )
  }

  return (
    <div
      inert={ready === false}
      className="tw:flex tw:min-h-0 tw:min-w-0 tw:flex-1 tw:gap-3 tw:overflow-hidden"
    >
      <RepositoryColumn
        key={project.projectId}
        project={project}
        repository={repositories[project.projectId!]}
        actionBusy={actions.isBusy(project.projectId!)}
        actionError={actions.errorFor(project.projectId!)}
        onSelect={selectReview}
        onAction={(action) => actions.begin(project, action)}
        onBranchChange={() => {
          if (
            selectedReview?.project.projectId === project.projectId &&
            selectedReview.source.kind === 'commit'
          )
            clearReview()
        }}
      />
      {selectedReview ? (
        <Suspense
          fallback={
            <aside
              aria-label={t('变更详情')}
              className="tw:flex tw:h-full tw:min-w-[360px] tw:flex-1 tw:flex-col tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-main tw:p-4"
            >
              <p role="status" className="tw:m-0 tw:type-body-sm tw:text-app-text-meta">
                {t('加载中')}
              </p>
            </aside>
          }
        >
          <GitBoardDetails
            key={`${selectedReview.project.projectId}:${JSON.stringify(selectedReview.source)}:${selectedReview.path ?? ''}`}
            {...selectedReview}
            hasConflicts={
              selectedResult?.ok === true && hasGitBoardConflicts(selectedResult.status.files)
            }
            onClose={clearReview}
          />
        </Suspense>
      ) : (
        <aside
          aria-label={t('变更详情')}
          className="tw:flex tw:h-full tw:min-w-[360px] tw:flex-1 tw:flex-col tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-main tw:p-4"
        >
          <p className="tw:m-0 tw:type-body-sm tw:text-app-text-meta">
            {t('选择未提交文件或提交记录查看变更详情')}
          </p>
        </aside>
      )}
      {actions.host}
    </div>
  )
}

export function GitBoardView() {
  const { t } = useLocale()
  const {
    view,
    selectedProjectId,
    selectedProject,
    projects,
    remoteView,
    refreshView,
    refreshGithubRepositories,
    refreshing,
  } = useGitBoard(
    useShallow((state) => ({
      view: state.view,
      selectedProjectId: state.selectedProjectId,
      selectedProject: state.selectedProject,
      projects: state.projects,
      remoteView: state.remoteView,
      refreshView: state.refreshView,
      refreshGithubRepositories: state.refreshGithubRepositories,
      refreshing: state.refreshing,
    })),
  )
  const [githubSearch, setGithubSearch] = useState('')
  const [githubRefreshing, setGithubRefreshing] = useState(false)
  const githubView = remoteView === 'github'
  const activeProjectId =
    selectedProjectId !== undefined ? selectedProjectId : (view?.projectIds?.[0] ?? null)
  const project =
    selectedProject ??
    (activeProjectId
      ? (projects?.find((item) => item.projectId === activeProjectId) ?? null)
      : null)
  const pageTitle = githubView
    ? t('GitHub 仓库')
    : project
      ? project.name
      : activeProjectId && view?.name
        ? view.name
        : t('Git 看板')
  // 与宠物页一致的页头搜索：pill + outlined，占满页头搜索行。
  const githubHeaderSearch = (
    <div className="tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-2">
      <div className="tw:min-w-0 tw:flex-1">
        <SearchInput
          aria-label={t('搜索仓库')}
          onChange={setGithubSearch}
          placeholder={t('搜索仓库全名或描述')}
          shape="pill"
          size="md"
          value={githubSearch}
          variant="outlined"
        />
      </div>
    </div>
  )
  return (
    <PrimaryPageLayout
      className="tw:overflow-y-hidden tw:[--page-content-max-width:100%] tw:[&.primary-page-layout]:[scrollbar-gutter:auto]"
      bodyClassName="tw:min-h-0 tw:basis-0 tw:overflow-hidden tw:pb-2"
      title={pageTitle}
      search={githubView ? githubHeaderSearch : undefined}
      actions={
        githubView ? (
          <Tooltip content={t('刷新仓库列表')}>
            <Button
              isIconOnly
              nativeTitle={false}
              title={t('刷新仓库列表')}
              aria-busy={githubRefreshing}
              variant="ghost"
              shape="pill"
              size="md"
              disabled={githubRefreshing}
              onClick={refreshGithubRepositories}
            >
              <RefreshCw
                aria-hidden="true"
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
                className={githubRefreshing ? 'tw:animate-spin' : undefined}
              />
            </Button>
          </Tooltip>
        ) : (
          <Tooltip content={t('刷新仓库')}>
            <Button
              isIconOnly
              nativeTitle={false}
              title={t('刷新仓库')}
              aria-busy={refreshing}
              variant="ghost"
              shape="pill"
              size="md"
              disabled={refreshing || !activeProjectId}
              onClick={refreshView}
            >
              <RefreshCw
                aria-hidden="true"
                size={APP_ICON_SIZE}
                className={refreshing ? 'tw:animate-spin' : undefined}
              />
            </Button>
          </Tooltip>
        )
      }
    >
      {githubView ? (
        <GitBoardGithubView
          active
          onBusyChange={setGithubRefreshing}
          onSearchChange={setGithubSearch}
          search={githubSearch}
        />
      ) : (
        <ProjectBoard key={activeProjectId ?? 'empty'} />
      )}
    </PrimaryPageLayout>
  )
}
