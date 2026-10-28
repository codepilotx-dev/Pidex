import { useShallow } from 'zustand/react/shallow'
import { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import type { DesktopWorkspace } from '../../../shared/Types.js'
import { Button } from '../../components/ui/Button.js'
import { OverflowTitle } from '../../components/ui/OverflowTitle.js'
import { usePrefersReducedMotion } from '../../hooks/UsePrefersReducedMotion.js'
import {
  createSidebarSessionPagingState,
  setSidebarSessionVisibleLimit,
} from '../layout/sidebar/SidebarSessionPaging.js'
import { SidebarHoverCardProvider } from '../layout/sidebar/SidebarHoverCard.js'
import { SidebarRow } from '../../components/ui/SidebarRow.js'
import { useLocale } from '../i18n/LocaleProvider.js'
import { cx } from '../../utils/Cx.js'
import {
  useGitBoard,
  type GitBoardRepository,
  type GitBoardReviewSelection,
} from './GitBoardContext.js'
import type { ReviewCommit } from '../review/source/ReviewAgentClient.js'
import {
  GitBoardCommitHoverCard,
  buildGitBoardCommitHoverCardModel,
} from './GitBoardCommitHoverCard.js'

/** 与会话列表一致：每仓库默认渲染 5 条提交，“展开显示”按 5 条步进。 */
export const GIT_BOARD_COMMIT_VISIBLE_LIMIT = 5

/** 提交子列表与“展开显示”按钮共用的缩进列，对齐会话行的 leading 占位。 */
const COMMIT_LIST_CLASS =
  'sidebar-commit-list tw:m-0 tw:flex tw:list-none tw:flex-col tw:sidebar-row-gap tw:p-0'
const COMMIT_ACTIONS_CLASS =
  'sidebar-show-more-actions tw:grid tw:w-full tw:box-border tw:min-h-7 tw:items-center tw:gap-x-2 tw:rounded-md tw:px-2 tw:py-1 tw:text-left tw:text-app-text-meta tw:type-control tw:no-underline tw:transition-[background-color,box-shadow,color] tw:duration-feedback tw:ease-standard tw:grid-cols-[var(--sidebar-row-columns)]'
const COMMIT_LEADING_SPACER_CLASS =
  'sidebar-row-leading sidebar-row-leading-spacer tw:flex tw:size-6 tw:w-6 tw:min-w-6 tw:shrink-0 tw:grow-0 tw:basis-6 tw:items-center tw:justify-center'
const COMMIT_STATUS_CLASS =
  'sidebar-commit-status tw:m-0 tw:flex tw:min-h-7 tw:items-center tw:gap-2 tw:rounded-md tw:px-2 tw:py-1 tw:type-caption tw:text-app-text-meta'
/**
 * 提交短 SHA 不常驻：默认隐藏且不占宽，行 hover 或行内键盘聚焦时显示；点击后保持可见，
 * 便于对照当前选中的提交。完整 SHA 与作者/时间仍由悬浮卡提供。
 */
const COMMIT_SHA_CLASS =
  'sidebar-commit-sha tw:max-w-[5.5rem] tw:shrink-0 tw:truncate tw:font-mono tw:type-caption tw:text-app-text-meta tw:hidden tw:group-hover:inline tw:group-has-[:focus-visible]:inline tw:group-data-[selected=true]:inline'

function GitBoardCommitRow({
  commit,
  project,
  branchLabel,
  active,
  onSelect,
}: {
  commit: ReviewCommit
  project: DesktopWorkspace
  branchLabel: string
  active: boolean
  onSelect: () => void
}) {
  const { t } = useLocale()
  const [hovered, setHovered] = useState(false)
  const reducedMotion = usePrefersReducedMotion()
  const model = buildGitBoardCommitHoverCardModel({
    subject: commit.subject,
    author: commit.author,
    authoredAt: commit.authoredAt,
    shortSha: commit.shortSha,
    projectName: project.name,
    branchLabel,
  })
  return (
    <li>
      <SidebarRow
        active={active}
        className="sidebar-commit-row tw:group"
        layout="grid"
        leadingMode="spacer"
        trailing={
          <span aria-hidden="true" className={COMMIT_SHA_CLASS}>
            {commit.shortSha}
          </span>
        }
      >
        <GitBoardCommitHoverCard ariaLabel={`${t('提交详情')}：${model.shortSha}`} model={model}>
          <button
            type="button"
            aria-current={active ? 'true' : undefined}
            className="sidebar-commit-button tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:text-inherit tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={onSelect}
          >
            <OverflowTitle active={hovered} reducedMotion={reducedMotion}>
              {model.subject}
            </OverflowTitle>
          </button>
        </GitBoardCommitHoverCard>
      </SidebarRow>
    </li>
  )
}

/**
 * 仓库列内的提交记录列表。数据来自 `GitBoardContext`，
 * 分页规则与会话列表一致：默认 5 条，展开时把需求条数上报给 Context 按需补拉。
 */
export function GitBoardCommitRows({
  project,
  repository,
  type = 'project',
  onSelect,
}: {
  project: DesktopWorkspace
  repository?: GitBoardRepository
  /** 分页状态键后缀，缺省为 `project`。 */
  type?: 'project' | 'group'
  onSelect?: (selection: GitBoardReviewSelection) => void
}) {
  const projectId = project.projectId!
  return (
    <SidebarHoverCardProvider>
      <GitBoardCommitSection
        key={`${projectId}:${type}`}
        project={project}
        repository={repository}
        groupKey={`${projectId}:${type}`}
        onSelect={onSelect}
      />
    </SidebarHoverCardProvider>
  )
}

function GitBoardCommitSection({
  project,
  repository: repositoryProp,
  groupKey,
  onSelect,
}: {
  project: DesktopWorkspace
  repository?: GitBoardRepository
  groupKey: string
  onSelect?: (selection: GitBoardReviewSelection) => void
}) {
  const { t } = useLocale()
  const {
    repositories,
    selectedRefs,
    supportsCommitRef,
    selectedReview,
    selectReview,
    expandCommitHistory,
    ensureCommitHistory,
    refreshProject,
  } = useGitBoard(
    useShallow((state) => ({
      repositories: state.repositories,
      selectedRefs: state.selectedRefs,
      supportsCommitRef: state.supportsCommitRef,
      selectedReview: state.selectedReview,
      selectReview: state.selectReview,
      expandCommitHistory: state.expandCommitHistory,
      ensureCommitHistory: state.ensureCommitHistory,
      refreshProject: state.refreshProject,
    })),
  )
  const projectId = project.projectId!
  const repository = repositoryProp ?? repositories?.[projectId]
  const handleSelect = onSelect ?? selectReview
  const commits = repository?.commits
  useEffect(() => {
    ensureCommitHistory?.(projectId, GIT_BOARD_COMMIT_VISIBLE_LIMIT)
  }, [projectId, ensureCommitHistory])
  const [paging, setPaging] = useState(() =>
    createSidebarSessionPagingState({
      groupKey,
      initialLimit: GIT_BOARD_COMMIT_VISIBLE_LIMIT,
    }),
  )
  const visible = [...(commits ?? [])].slice(0, paging.visibleLimit)
  // `commitsComplete` 由服务端返回条数与请求上限比较得出；取完历史后不再显示“展开显示”。
  const hasMoreCommits = repository?.commitsComplete === false
  const canShowMore = visible.length < (commits?.length ?? 0) || hasMoreCommits
  const canCollapse = paging.visibleLimit > GIT_BOARD_COMMIT_VISIBLE_LIMIT
  const selectedRef = selectedRefs?.[projectId]
  const branchLabel = supportsCommitRef ? (selectedRef ?? 'HEAD') : 'HEAD'

  function showMore(): void {
    const nextLimit = paging.visibleLimit + GIT_BOARD_COMMIT_VISIBLE_LIMIT
    setPaging((current) => setSidebarSessionVisibleLimit(current, nextLimit))
    expandCommitHistory?.(projectId, nextLimit)
  }
  function collapse(): void {
    setPaging((current) => setSidebarSessionVisibleLimit(current, GIT_BOARD_COMMIT_VISIBLE_LIMIT))
  }

  return (
    <div className="sidebar-commit-group tw:grid tw:min-w-0 tw:sidebar-row-gap">
      {repository?.historyError ? (
        <div role="alert" className={cx(COMMIT_STATUS_CLASS, 'tw:flex-wrap tw:whitespace-normal')}>
          <AlertCircle
            aria-hidden="true"
            size="var(--inline-icon-size, 1em)"
            className="tw:shrink-0"
          />
          <span className="tw:min-w-0 tw:flex-1">{t(repository.historyError)}</span>
          <Button
            className="sidebar-show-more-button tw:w-auto tw:min-w-0 tw:border-0 tw:[font:inherit]"
            variant="text"
            onClick={() => refreshProject?.(projectId)}
            size="compact"
            type="button"
          >
            {t('重试')}
          </Button>
        </div>
      ) : !commits ? (
        <p role="status" className={COMMIT_STATUS_CLASS}>
          {t('加载中')}
        </p>
      ) : commits.length === 0 ? (
        <p className={COMMIT_STATUS_CLASS}>{t('暂无提交')}</p>
      ) : (
        <>
          <ul className={COMMIT_LIST_CLASS}>
            {visible.map((commit) => (
              <GitBoardCommitRow
                key={commit.sha}
                active={
                  selectedReview?.project.projectId === projectId &&
                  selectedReview.source.kind === 'commit' &&
                  selectedReview.source.commitSha === commit.sha
                }
                branchLabel={branchLabel}
                commit={commit}
                project={project}
                onSelect={() =>
                  handleSelect?.({
                    project,
                    source: { kind: 'commit', commitSha: commit.sha },
                  })
                }
              />
            ))}
          </ul>
          {(canShowMore || canCollapse) && (
            <div className={COMMIT_ACTIONS_CLASS}>
              <span aria-hidden="true" className={COMMIT_LEADING_SPACER_CLASS} />
              <div className="sidebar-row-main tw:flex tw:min-w-0 tw:items-center tw:gap-4">
                {canShowMore ? (
                  <Button
                    aria-expanded={canCollapse}
                    className="tw:w-auto sidebar-show-more-button tw:first:-ml-2 tw:min-w-0 tw:border-0 tw:[font:inherit]"
                    variant="text"
                    onClick={showMore}
                    size="compact"
                    type="button"
                  >
                    <span className="tw:block tw:overflow-hidden tw:whitespace-nowrap">
                      {t('展开显示')}
                    </span>
                  </Button>
                ) : null}
                {canCollapse ? (
                  <Button
                    className="tw:w-auto sidebar-show-more-button tw:first:-ml-2 tw:min-w-0 tw:border-0 tw:[font:inherit]"
                    variant="text"
                    onClick={collapse}
                    size="compact"
                    type="button"
                  >
                    <span className="tw:block tw:overflow-hidden tw:whitespace-nowrap">
                      {t('折叠显示')}
                    </span>
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
