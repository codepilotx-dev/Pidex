import { lazy, Suspense, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, GitBranch, RefreshCw } from 'lucide-react'
import type {
  DesktopGitFileChange,
  DesktopReviewSource,
  DesktopWorkspace,
} from '../../../shared/Types.js'
import { Tooltip } from '../../components/ui/Tooltip.js'
import { Select } from '../../components/ui/Select.js'
import { OverflowTitle } from '../../components/ui/OverflowTitle.js'
import { DisclosureController } from '../../components/ui/DisclosureController.js'
import { useScrollEdgeState } from '../../hooks/UseScrollEdgeState.js'
import { usePrefersReducedMotion } from '../../hooks/UsePrefersReducedMotion.js'
import { APP_ICON_SIZE } from '../../components/ui/IconTokens.js'
import { Button } from '../../components/ui/Button.js'
import { cx } from '../../utils/Cx.js'
import { useLocale } from '../i18n/LocaleProvider.js'
import { FileTypeIcon } from '../layout/FileTypeIcon.js'
import { SidebarRow } from '../layout/sidebar/SidebarRow.js'
import { PrimaryPageLayout } from '../layout/primary-page/index.js'
import { useGitBoard, type GitBoardRepository } from './GitBoardContext.js'

const GitBoardDetails = lazy(() =>
  import('./GitBoardDetails.js').then((module) => ({ default: module.GitBoardDetails })),
)
type Selection = { project: DesktopWorkspace; source: DesktopReviewSource; path?: string }

export function gitBoardFileStatuses(
  file: DesktopGitFileChange,
): { code: string; label: string }[] {
  if (file.isUntracked) return [{ code: 'U', label: '未跟踪' }]
  const pair = `${file.stagedStatus}${file.unstagedStatus}`
  if (pair.includes('U') || ['DD', 'AA'].includes(pair)) return [{ code: '!', label: '冲突' }]
  const labels: Record<string, string> = {
    M: '修改',
    A: '新增',
    D: '删除',
    R: '重命名',
    C: '复制',
    T: '类型变更',
  }
  return [
    { code: file.stagedStatus.trim(), area: '已暂存' },
    { code: file.unstagedStatus.trim(), area: '未暂存' },
  ]
    .filter(({ code }) => code && code !== '?')
    .map(({ code, area }) => ({ code, label: `${area}：${labels[code] ?? code}` }))
}

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
      className="tw:flex tw:min-h-[var(--sidebar-row-height,30px)] tw:w-full tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-md tw:border-0 tw:bg-transparent tw:p-0 tw:px-2 tw:select-none tw:text-left tw:type-body tw:text-app-text-meta tw:focus-visible:outline-app-focus"
    >
      <span>{title}</span>
      <ChevronDown
        aria-hidden="true"
        size={14}
        className={cx(
          'tw:shrink-0 tw:opacity-0 tw:group-hover:opacity-100 tw:group-focus-within:opacity-100 tw:[transition:opacity_var(--cpx-sys-motion-feedback)_var(--cpx-sys-ease-out),transform_var(--cpx-sys-motion-disclosure)_var(--cpx-sys-ease-disclosure)]',
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

function CommitRow({
  commit,
  onClick,
}: {
  commit: NonNullable<GitBoardRepository['commits']>[number]
  onClick: () => void
}) {
  const [active, setActive] = useState(false)
  const reducedMotion = usePrefersReducedMotion()
  return (
    <SidebarRow asChild layout="flex" leadingMode="none" labelClassName="tw:gap-3">
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={() => setActive(true)}
        onMouseLeave={() => setActive(false)}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
        className="tw:border-0 tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus"
      >
        <span className="tw:min-w-0 tw:flex-1 tw:type-row-title">
          <OverflowTitle active={active} reducedMotion={reducedMotion}>
            {commit.subject}
          </OverflowTitle>
        </span>
        <Tooltip content={commit.author}>
          <span className="tw:max-w-[33.333%] tw:shrink-0 tw:truncate tw:type-caption tw:text-app-text-meta">
            {commit.author}
          </span>
        </Tooltip>
      </button>
    </SidebarRow>
  )
}

export function RepositoryColumn({
  project,
  repository,
  onSelect,
  onBranchChange,
}: {
  project: DesktopWorkspace
  repository?: GitBoardRepository
  onSelect: (selection: Selection) => void
  onBranchChange: () => void
}) {
  const { t } = useLocale()
  const { refreshView: refresh, selectedRefs, selectBranch, supportsCommitRef } = useGitBoard()
  const result = repository?.result
  const status = result?.ok ? result.status : null
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
      className="tw:flex tw:h-full tw:min-h-0 tw:w-[400px] tw:min-w-[400px] tw:flex-none tw:flex-col tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-panel"
    >
      <header className="tw:shrink-0 tw:border-b tw:border-app-border-subtle tw:p-4">
        <div className="tw:flex tw:items-center tw:justify-between tw:gap-2">
          <Tooltip content={project.path}>
            <h2 className="tw:m-0 tw:truncate tw:type-title-sm">{project.name}</h2>
          </Tooltip>
          {status && (
            <Tooltip
              content={`${status.branchName ?? 'detached HEAD'} · ${status.upstream ?? t('未设置上游')}`}
            >
              <span className="tw:shrink-0 tw:whitespace-nowrap tw:type-caption tw:text-app-text-meta">{`↑ ${status.ahead} ↓ ${status.behind}`}</span>
            </Tooltip>
          )}
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
      </header>
      <div className="tw:min-h-0 tw:flex-1 tw:overflow-y-auto tw:py-3 tw:pl-3 tw:pr-1">
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
              {result.status.clean && (
                <p className="tw:py-3 tw:type-body-sm tw:text-app-text-meta">{t('工作区干净')}</p>
              )}
              {result.status.files.map((file) => (
                <SidebarRow
                  key={file.path}
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
              {repository?.historyError ? (
                <div role="alert">
                  <p>{t(repository.historyError)}</p>
                  <Button variant="text" onClick={refresh}>
                    {t('重试')}
                  </Button>
                </div>
              ) : !repository?.commits ? (
                <p role="status">{t('加载中')}</p>
              ) : repository.commits.length === 0 ? (
                <p className="tw:py-3 tw:type-body-sm tw:text-app-text-meta">{t('暂无提交')}</p>
              ) : (
                repository.commits.map((commit) => (
                  <CommitRow
                    key={commit.sha}
                    commit={commit}
                    onClick={() =>
                      onSelect({ project, source: { kind: 'commit', commitSha: commit.sha } })
                    }
                  />
                ))
              )}
            </BoardSection>
          </>
        )}
      </div>
    </section>
  )
}

function GroupBoard() {
  const { t } = useLocale()
  const { view, projects, repositories, state, toggleQuickView, ready } = useGitBoard()
  const [selection, setSelection] = useState<Selection | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const edges = useScrollEdgeState(viewportRef, { axis: 'x', version: view.projectIds })
  return (
    <div
      inert={ready === false}
      className="tw:flex tw:min-h-0 tw:min-w-0 tw:flex-1 tw:overflow-hidden"
    >
      <div className="tw:relative tw:flex tw:min-h-0 tw:min-w-0 tw:flex-1">
        <div
          ref={viewportRef}
          className="tw:flex tw:min-h-0 tw:min-w-0 tw:flex-1 tw:gap-3 tw:overflow-x-auto tw:overflow-y-hidden tw:pb-3"
        >
          {!view.projectIds.length && (
            <p className="tw:m-auto tw:type-body-sm tw:text-app-text-meta">
              {t('从左侧加入仓库，或打开一个分组')}
            </p>
          )}
          {view.projectIds.map((id) => {
            const project = projects.find((item) => item.projectId === id)
            return project ? (
              <RepositoryColumn
                key={id}
                project={project}
                repository={repositories[id]}
                onSelect={setSelection}
                onBranchChange={() =>
                  setSelection((current) =>
                    current?.project.projectId === id && current.source.kind === 'commit'
                      ? null
                      : current,
                  )
                }
              />
            ) : (
              <div
                key={id}
                className="tw:min-w-[360px] tw:p-4 tw:type-body-sm tw:text-app-text-meta"
              >
                {t('项目已移除或暂不可用')}
                <Button variant="ghost" onClick={() => toggleQuickView(id)}>
                  {t(state.quickProjectIds.includes(id) ? '从看板移除' : '在速览中打开')}
                </Button>
              </div>
            )
          })}
        </div>
        {!edges.atStart && (
          <div
            aria-hidden="true"
            className="tw:pointer-events-none tw:absolute tw:inset-y-0 tw:bottom-7 tw:left-0 tw:w-4 tw:bg-linear-to-r tw:from-app-canvas tw:to-transparent tw:forced-colors:hidden"
          />
        )}
        {!edges.atEnd && (
          <div
            aria-hidden="true"
            className="tw:pointer-events-none tw:absolute tw:inset-y-0 tw:bottom-7 tw:right-0 tw:w-4 tw:bg-linear-to-l tw:from-app-canvas tw:to-transparent tw:forced-colors:hidden"
          />
        )}
      </div>
      {selection && view.projectIds.includes(selection.project.projectId!) && (
        <Suspense fallback={<p role="status">{t('加载中')}</p>}>
          <GitBoardDetails
            key={`${selection.project.projectId}:${JSON.stringify(selection.source)}:${selection.path ?? ''}`}
            {...selection}
            onClose={() => setSelection(null)}
          />
        </Suspense>
      )}
    </div>
  )
}

export function GitBoardView() {
  const { t } = useLocale()
  const { view, refreshView, refreshing } = useGitBoard()
  return (
    <PrimaryPageLayout
      className="tw:overflow-y-hidden tw:[--page-content-max-width:100%] tw:[&.primary-page-layout]:[scrollbar-gutter:auto]"
      bodyClassName="tw:min-h-0 tw:basis-0 tw:overflow-hidden tw:pb-2"
      title={view.id === null ? t('速览') : view.name}
      actions={
        <Tooltip content={t('刷新当前分组仓库')}>
          <Button
            isIconOnly
            nativeTitle={false}
            title={t('刷新当前分组仓库')}
            aria-busy={refreshing}
            variant="ghost"
            shape="pill"
            size="md"
            disabled={refreshing}
            onClick={refreshView}
          >
            <RefreshCw
              aria-hidden="true"
              size={APP_ICON_SIZE}
              className={refreshing ? 'tw:animate-spin' : undefined}
            />
          </Button>
        </Tooltip>
      }
    >
      <GroupBoard key={view.id ?? 'quick-view'} />
    </PrimaryPageLayout>
  )
}
