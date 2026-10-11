import { formatReviewCount } from '../../review/diff/ReviewFormat.js'
import * as React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Popover as Popover } from '../../../components/ui/floating/Popover.js'
import {
  Bot,
  ChevronDown,
  FileText,
  Folder,
  GitBranch,
  Ellipsis,
  Terminal,
  Globe,
  Image as ImageIcon,
  Link2,
  Package,
  Paperclip,
  Pause,
  Play,
  Plus,
  Plug,
  RefreshCcw,
  Search,
  Square,
  SquarePlus,
  X,
} from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import { cx } from '../../../utils/Cx.js'
import { Tooltip } from '../../../components/ui/Tooltip.js'
import { BranchSelectPopover } from '../composer/BranchSelectPopover.js'
import type {
  ThreadSummaryArtifact,
  ThreadSummaryBrowserTab,
  ThreadSummarySourceEntry,
  ThreadSummaryViewModel,
} from './ThreadSummaryViewModel.js'
import {
  previewThreadSummaryAgents,
  previewThreadSummarySources,
  threadSummaryArtifactPreviewKind,
} from './ThreadSummaryViewModel.js'
import type { Attachment, LocalContextReference } from '@pidex/shared/thread'
import { Button } from '../../../components/ui/Button.js'
import { useDialogFocusRestore } from '../../../components/ui/UseDialogFocusRestore.js'
import { DisclosureContent } from '../../../components/ui/DisclosureContent.js'
import { Spinner } from '../../../components/ui/Spinner.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import type { CommandMenuActionRegistration } from '../../search/CommandMenuActionStore.js'
import { PopoverItem } from '../../../components/ui/PopoverItem.js'

/**
 * 置顶摘要的宽度契约：行在浮层里靠 `--thread-summary-inline-width` 取得与内联
 * 面板一致的宽度，浮层挂在 Portal 上，必须自己再声明一次该变量。
 */
const THREAD_SUMMARY_WIDTH_CLASS = 'tw:w-full'

const SUMMARY_ROW_CLASS =
  'interactive-row interactive-row--nav thread-summary-row tw:grid tw:w-[calc(100%+16px)] tw:min-w-0 tw:-mx-2 tw:grid-cols-[16px_minmax(0,1fr)_max-content] tw:text-left tw:no-underline tw:type-body'

const SUMMARY_ROW_LABEL_CLASS =
  'tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap'

const SUMMARY_ROW_ICON_CLASS = 'tw:text-app-text'

export type ThreadSummarySectionId =
  'environment' | 'goal' | 'agents' | 'browser' | 'sources' | 'artifacts'

type ThreadSummaryActions = {
  environmentChoices?: readonly CommandMenuActionRegistration[]
  workspaceActions?: readonly CommandMenuActionRegistration[]
  selectedActionId?: string
  onSelectAction?: (id: string) => void
  onActivateBrowserTab?: (tabId: string) => void
  onBranchSelect: (branch: string) => Promise<void>
  onCommitOrPush: () => void
  onCreateBranch: () => void
  onCreatePullRequest: () => void
  onCreateOutput?: () => void
  onGitOperation?: (operation: 'commit' | 'push') => void
  onOpenEnvironmentSettings?: () => void
  onAddEnvironmentAction?: () => void
  onOpenTerminal?: () => void
  onMoveToWorktree?: () => void
  onRetryGitDetection?: () => void
  pushEnabled?: boolean
  onGoalPause?: () => void
  onGoalResume?: () => void
  onOpenArtifact?: (artifact: ThreadSummaryArtifact) => void
  onOpenAttachment?: (attachment: Attachment) => void
  onOpenLocalContext?: (reference: LocalContextReference) => void
  onOpenReview: () => void
  onOpenSubagent?: (taskId: string) => void
  onOpenWorkspacePath: () => void
  onStopSubagent?: (taskId: string) => void
}

type ThreadSummaryPanelProps = ThreadSummaryActions & {
  changesLoading?: boolean
  branches: string[]
  collapsedSections: ReadonlySet<ThreadSummarySectionId>
  model: ThreadSummaryViewModel
  onToggleSection: (id: ThreadSummarySectionId) => void
}

const AGENT_STATUS_META_LABELS: Record<string, string> = {
  loading: '加载中',
  busy: '忙碌',
  suspended: '已挂起',
  error: '错误',
}

const GOAL_STATUS_LABELS: Record<string, string> = {
  active: '进行中',
  paused: '已暂停',
  blocked: '受阻',
  'usage-limited': '用量受限',
  'budget-limited': '预算受限',
  complete: '已完成',
}

export function ThreadSummaryPopover({
  children,
  open,
  panel,
  onOpenChange,
}: {
  children: React.ReactElement
  open: boolean
  panel: React.ReactNode
  onOpenChange: (open: boolean) => void
}): React.ReactNode {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          size="lg"
          align="end"
          aria-label="置顶摘要"
          className={`thread-summary-popover ${THREAD_SUMMARY_WIDTH_CLASS} tw:max-h-[min(680px,calc(100vh-80px))]`}
          collisionPadding={12}
          side="bottom"
          sideOffset={8}
        >
          {panel}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function ThreadSummaryInline({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <div
      className="thread-summary-inline tw:absolute tw:top-4 tw:bottom-4 tw:end-[var(--thread-summary-inline-edge)] tw:z-sticky tw:w-[var(--thread-summary-inline-width)] tw:min-h-0 tw:origin-right"
      data-testid="thread-summary-inline"
    >
      {children}
    </div>
  )
}

export class ThreadSummaryErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean; retryKey: number }
> {
  state = { failed: false, retryKey: 0 }

  static getDerivedStateFromError(): Partial<{
    failed: boolean
    retryKey: number
  }> {
    return { failed: true }
  }

  retry = (): void => {
    this.setState((state) => ({
      failed: false,
      retryKey: state.retryKey + 1,
    }))
  }

  render(): React.ReactNode {
    if (this.state.failed) {
      return (
        <section
          aria-label="摘要加载失败"
          className={`thread-summary-error ${THREAD_SUMMARY_WIDTH_CLASS} tw:grid tw:min-h-45 tw:place-content-center tw:justify-items-center tw:gap-2 tw:p-5 tw:text-center`}
          role="alert"
        >
          <strong>摘要暂时无法显示</strong>
          <span className="tw:text-app-text-meta tw:type-body-sm">会话本身不受影响。</span>
          <button
            type="button"
            onClick={this.retry}
            className="tw:mt-2 tw:inline-flex tw:items-center tw:gap-1 tw:rounded-control tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-3 tw:py-2 tw:text-app-text tw:[font:inherit] tw:cursor-pointer tw:focus-visible:outline-1 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-app-focus"
          >
            <RefreshCcw size={APP_ICON_SIZE} />
            重试
          </button>
        </section>
      )
    }
    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>
  }
}

export function ThreadSummaryPanel({
  changesLoading = false,
  workspaceActions = [],
  environmentChoices = [],
  selectedActionId,
  onSelectAction,
  branches,
  collapsedSections,
  model,
  onActivateBrowserTab,
  onBranchSelect,
  onCommitOrPush,
  onCreateBranch,
  onCreateOutput,
  onGitOperation,
  onOpenEnvironmentSettings,
  onAddEnvironmentAction,
  onOpenTerminal,
  onMoveToWorktree,
  onRetryGitDetection,
  pushEnabled = false,
  onGoalPause,
  onGoalResume,
  onOpenArtifact,
  onOpenAttachment,
  onOpenLocalContext,
  onOpenReview,
  onOpenSubagent,
  onToggleSection,
  onStopSubagent,
}: ThreadSummaryPanelProps): React.ReactNode {
  const selectedAction =
    workspaceActions.find((action) => action.id === selectedActionId) ?? workspaceActions[0]
  const [environmentChoicesOpen, setEnvironmentChoicesOpen] = React.useState(false)
  const [branchPopoverOpen, setBranchPopoverOpen] = React.useState(false)
  const [gitMenuOpen, setGitMenuOpen] = React.useState(false)
  const [environmentMenuOpen, setEnvironmentMenuOpen] = React.useState(false)
  const [branchSearch, setBranchSearch] = React.useState('')
  const [sourcesPanelOpen, setSourcesPanelOpen] = React.useState(false)
  const [showAllAgents, setShowAllAgents] = React.useState(false)
  const [showAllArtifacts, setShowAllArtifacts] = React.useState(false)
  const sourcePreview = previewThreadSummarySources(model.sources)
  const sourceListId = React.useId()
  const agentPreview = previewThreadSummaryAgents(model.agents)
  const visibleAgents = showAllAgents ? model.agents : agentPreview.items
  const artifactPreview = {
    items: model.artifacts.slice(0, showAllArtifacts ? model.artifacts.length : 6),
    totalCount: model.artifacts.length,
  }
  const changes = model.changes ?? {
    additions: 0,
    deletions: 0,
    fileCount: 0,
  }
  const environment = model.environment

  const isSectionExpanded = (id: ThreadSummarySectionId): boolean => !collapsedSections.has(id)
  const toggleSection = (id: ThreadSummarySectionId): void => onToggleSection(id)

  return (
    <aside
      className={`thread-summary-panel ${THREAD_SUMMARY_WIDTH_CLASS} tw:flex tw:min-h-0 tw:flex-col tw:gap-3 tw:overflow-x-hidden tw:overflow-y-auto tw:pt-3 tw:pb-2 tw:[scrollbar-width:thin]`}
      aria-label="置顶摘要"
    >
      {model.gitDetection === 'error' ? (
        <div
          className="tw:flex tw:items-center tw:gap-2 tw:px-4 tw:py-2 tw:text-app-text-meta tw:type-body-sm"
          role="status"
        >
          <>
            <span>仓库检测失败</span>
            <Button
              variant="text"
              size="sm"
              onClick={onRetryGitDetection}
              disabled={!onRetryGitDetection}
            >
              重试
            </Button>
          </>
        </div>
      ) : null}
      {environment &&
      (environment.isGitRepository ||
        workspaceActions.length > 0 ||
        environmentChoices.length > 0) ? (
        <ThreadSummarySection
          collapsedSummary={
            changes.fileCount > 0 ? (
              <span className="thread-summary-diff tw:inline-flex tw:gap-1 tw:type-caption tw:tabular-nums">
                <strong className="tw:text-app-success tw:type-weight-body">
                  +{formatReviewCount(changes.additions)}
                </strong>
                <em className="tw:text-app-danger tw:not-italic">
                  -{formatReviewCount(changes.deletions)}
                </em>
              </span>
            ) : null
          }
          expanded={isSectionExpanded('environment')}
          first
          id="environment"
          title={environment.workspaceName ?? '本地仓库'}
          meta={
            <div className="tw:flex tw:items-center tw:gap-1">
              <PopoverMenu
                open={environmentMenuOpen}
                onOpenChange={setEnvironmentMenuOpen}
                side="left"
                align="start"
                size="md"
                trigger={
                  <button
                    type="button"
                    aria-label="操作"
                    title="操作"
                    className="tw:inline-flex tw:size-6 tw:items-center tw:justify-center tw:rounded-md tw:border-0 tw:bg-transparent tw:text-app-text-meta tw:cursor-pointer tw:hover:bg-app-hover tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus"
                  >
                    <Ellipsis aria-hidden="true" size={APP_ICON_SIZE} />
                  </button>
                }
              >
                <div className="tw:px-2 tw:py-1 tw:type-caption tw:text-app-text-meta">操作</div>
                {workspaceActions.map((action) => (
                  <PopoverItem
                    key={action.id}
                    icon={<Play size={APP_ICON_SIZE} />}
                    selected={action.id === selectedAction?.id}
                    withCheck
                    disabled={action.availability !== 'available'}
                    onClick={() => onSelectAction?.(action.id)}
                  >
                    {action.label}
                  </PopoverItem>
                ))}
                <PopoverItem
                  icon={<Plus size={APP_ICON_SIZE} />}
                  disabled={!onOpenEnvironmentSettings}
                  onClick={onAddEnvironmentAction ?? onOpenEnvironmentSettings}
                >
                  添加操作
                </PopoverItem>
                <div className="tw:my-1 tw:border-t tw:border-app-border-subtle" />
                <PopoverItem
                  icon={<Plus size={APP_ICON_SIZE} />}
                  disabled={!onOpenEnvironmentSettings}
                  onClick={() => setEnvironmentChoicesOpen((value) => !value)}
                  keepOpen
                  withArrow
                  arrowDirection={environmentChoicesOpen ? 'up' : 'down'}
                >
                  更改环境
                </PopoverItem>
                {environmentChoicesOpen ? (
                  <>
                    {environmentChoices.map((choice) => (
                      <PopoverItem
                        key={choice.id}
                        selected={choice.selected}
                        withCheck
                        disabled={choice.availability !== 'available'}
                        onClick={() => void choice.execute()}
                      >
                        {choice.label}
                      </PopoverItem>
                    ))}
                    {!environmentChoices.length ? (
                      <div className="tw:px-2 tw:py-1 tw:type-caption tw:text-app-text-meta">
                        暂无环境
                      </div>
                    ) : null}
                    <PopoverItem onClick={onOpenEnvironmentSettings}>环境设置</PopoverItem>
                  </>
                ) : null}
                <PopoverItem
                  icon={<Terminal size={APP_ICON_SIZE} />}
                  disabled={!onOpenTerminal}
                  onClick={onOpenTerminal}
                >
                  打开终端
                </PopoverItem>
                <div className="tw:my-1 tw:border-t tw:border-app-border-subtle" />
                <PopoverItem disabled={!onMoveToWorktree} onClick={onMoveToWorktree}>
                  移动到工作树
                </PopoverItem>
              </PopoverMenu>
              <Button
                isIconOnly
                color="ghostSecondary"
                size="toolbar"
                title={selectedAction ? `运行 ${selectedAction.label}` : '添加启动操作'}
                aria-label={selectedAction ? `运行 ${selectedAction.label}` : '运行脚本'}
                disabled={!selectedAction || selectedAction.availability !== 'available'}
                onClick={() => void selectedAction?.execute()}
              >
                <Play size={APP_ICON_SIZE} />
              </Button>
            </div>
          }
          onToggle={toggleSection}
        >
          {environment.isGitRepository ? (
            <div className="tw:group tw:relative tw:min-w-0">
              <button
                className={SUMMARY_ROW_CLASS}
                title="打开分支变更审查"
                type="button"
                onClick={onOpenReview}
              >
                <SquarePlus
                  className={SUMMARY_ROW_ICON_CLASS}
                  aria-hidden="true"
                  size={APP_ICON_SIZE}
                />
                <span className={SUMMARY_ROW_LABEL_CLASS}>变更</span>
                <span
                  className={`tw:inline-flex tw:items-center tw:justify-end ${gitMenuOpen || branchPopoverOpen ? 'tw:invisible' : 'tw:group-hover:invisible tw:group-focus-within:invisible'}`}
                >
                  {changesLoading && !model.changes ? (
                    <Spinner label="正在加载变更统计" className="tw:text-app-text-meta" />
                  ) : model.changes && (changes.additions > 0 || changes.deletions > 0) ? (
                    <small className="thread-summary-change-summary tw:inline-flex tw:items-center tw:justify-end tw:gap-2 tw:whitespace-nowrap tw:text-app-text-meta tw:type-caption">
                      <span className="thread-summary-diff tw:inline-flex tw:gap-1 tw:type-caption tw:tabular-nums">
                        <strong className="tw:text-app-success tw:type-weight-body">
                          +{formatReviewCount(changes.additions)}
                        </strong>
                        <em className="tw:text-app-danger tw:not-italic">
                          -{formatReviewCount(changes.deletions)}
                        </em>
                      </span>
                    </small>
                  ) : null}
                </span>
              </button>
              <div
                className={`tw:absolute tw:right-0 tw:top-0 tw:bottom-0 tw:flex tw:items-center ${gitMenuOpen || branchPopoverOpen ? 'tw:opacity-100' : 'tw:opacity-0 tw:group-hover:opacity-100 tw:group-focus-within:opacity-100'}`}
              >
                <PopoverMenu
                  open={gitMenuOpen}
                  onOpenChange={setGitMenuOpen}
                  side="left"
                  align="start"
                  size="sm"
                  trigger={
                    <button
                      type="button"
                      aria-label="Git 操作"
                      title="Git 操作"
                      className="tw:inline-flex tw:size-7 tw:items-center tw:justify-center tw:rounded-md tw:border-0 tw:bg-transparent tw:text-app-text tw:cursor-pointer tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus"
                    >
                      <GitBranch aria-hidden="true" size={APP_ICON_SIZE} />
                    </button>
                  }
                >
                  <PopoverItem
                    disabled={!environment.changedFileCount}
                    onClick={() => (onGitOperation ? onGitOperation('commit') : onCommitOrPush())}
                  >
                    提交
                  </PopoverItem>
                  <PopoverItem
                    disabled={!pushEnabled}
                    onClick={() => (onGitOperation ? onGitOperation('push') : onCommitOrPush())}
                  >
                    推送
                  </PopoverItem>
                  <PopoverItem onClick={onCreateBranch}>创建分支</PopoverItem>
                  <PopoverItem onClick={() => setBranchPopoverOpen(true)}>切换分支</PopoverItem>
                </PopoverMenu>
              </div>
              {environment.isGitRepository ? (
                <>
                  <BranchSelectPopover
                    align="start"
                    branchSearch={branchSearch}
                    branches={branches}
                    className="popover-thread-summary-branch"
                    currentBranchDetail={`未提交：${environment.changedFileCount} 个文件`}
                    currentBranchName={environment.branchName ?? ''}
                    open={branchPopoverOpen}
                    side="left"
                    sideOffset={8}
                    size="sm"
                    onBranchSearchChange={setBranchSearch}
                    onBranchSelect={onBranchSelect}
                    onCreateBranch={onCreateBranch}
                    onOpenChange={setBranchPopoverOpen}
                    trigger={
                      <button
                        className="tw:absolute tw:right-0 tw:top-0 tw:size-7 tw:pointer-events-none tw:opacity-0"
                        tabIndex={-1}
                        data-state={branchPopoverOpen ? 'open' : 'closed'}
                        title={environment.branchName ?? '未检测到 Git 分支'}
                        type="button"
                      >
                        <GitBranch
                          className={SUMMARY_ROW_ICON_CLASS}
                          aria-hidden="true"
                          size={APP_ICON_SIZE}
                        />
                        <span className={SUMMARY_ROW_LABEL_CLASS}>
                          {environment.branchName ?? '未检测到 Git 分支'}
                        </span>
                        <ChevronDown aria-hidden="true" size={APP_ICON_SIZES.sm} />
                      </button>
                    }
                  />
                </>
              ) : null}
            </div>
          ) : null}
        </ThreadSummarySection>
      ) : null}

      {model.goal ? (
        <ThreadSummarySection
          expanded={isSectionExpanded('goal')}
          id="goal"
          meta={
            <GoalHeaderAction
              goal={model.goal}
              onGoalPause={onGoalPause}
              onGoalResume={onGoalResume}
            />
          }
          title="目标"
          onToggle={toggleSection}
        >
          <div className="thread-summary-goal tw:grid tw:gap-1 tw:px-2 tw:py-1">
            <p className="thread-summary-goal__objective tw:m-0 tw:min-w-0 tw:type-body tw:line-clamp-3 tw:whitespace-pre-wrap">
              {model.goal.objective}
            </p>
            <small className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1 tw:text-app-text-meta tw:type-caption">
              <span
                className={cx(
                  'tw:whitespace-nowrap',
                  model.goal.status === 'complete' && 'tw:text-app-success',
                  model.goal.status === 'paused' && 'tw:text-app-warning',
                )}
              >
                {GOAL_STATUS_LABELS[model.goal.status] ?? model.goal.status}
              </span>
              <span aria-hidden="true">·</span>
              <span className="tw:tabular-nums">
                累计 {formatGoalDuration(model.goal.timeUsedSeconds)}
              </span>
              <span aria-hidden="true">·</span>
              <span className="tw:tabular-nums">
                {model.goal.tokenBudget !== null
                  ? `${formatGoalNumber(model.goal.tokensUsed)} / ${formatGoalNumber(model.goal.tokenBudget)} tokens`
                  : `${formatGoalNumber(model.goal.tokensUsed)} tokens`}
              </span>
            </small>
          </div>
        </ThreadSummarySection>
      ) : null}

      {model.agents.length ? (
        <ThreadSummarySection
          collapsedSummary={<AgentSectionSummary agents={model.agents} />}
          expanded={isSectionExpanded('agents')}
          id="agents"
          meta={<AgentSectionMeta agents={model.agents} />}
          title="Agent"
          onToggle={toggleSection}
        >
          {visibleAgents.map((agent) => (
            <div
              className="thread-summary-row-group tw:grid tw:w-[calc(100%+16px)] tw:-mx-2 tw:grid-cols-[minmax(0,1fr)_max-content]"
              key={agent.id}
            >
              <button
                className="interactive-row interactive-row--nav thread-summary-row-group__main tw:grid tw:min-w-0 tw:grid-cols-[16px_minmax(0,1fr)_max-content] tw:bg-transparent tw:text-left tw:type-body"
                type="button"
                onClick={() => onOpenSubagent?.(agent.id)}
              >
                <Bot className={SUMMARY_ROW_ICON_CLASS} aria-hidden="true" size={APP_ICON_SIZE} />
                <span className={SUMMARY_ROW_LABEL_CLASS}>{agent.name}</span>
                <small
                  className={cx(
                    'tw:whitespace-nowrap tw:type-caption',
                    agent.state === 'finished' ? 'tw:text-app-text-meta' : 'tw:text-app-accent-fg',
                  )}
                >
                  {subagentStatusLabel(agent.status)}
                </small>
              </button>
              {agent.stoppable ? (
                <Tooltip content="停止该子 Agent">
                  <button
                    aria-label={`停止 ${agent.name}`}
                    className="tw:inline-flex tw:size-7 tw:items-center tw:justify-center tw:rounded-md tw:border-0 tw:bg-transparent tw:p-0 tw:text-app-text-meta tw:[font:inherit] tw:cursor-pointer tw:outline-none tw:hover:bg-app-hover tw:hover:text-app-danger tw:focus-visible:outline-1 tw:focus-visible:outline-offset-1 tw:focus-visible:outline-app-focus tw:[&>svg]:size-icon-sm"
                    type="button"
                    onClick={() => onStopSubagent?.(agent.id)}
                  >
                    <Square aria-hidden="true" size={APP_ICON_SIZES.sm} />
                  </button>
                </Tooltip>
              ) : null}
            </div>
          ))}
          {!showAllAgents && agentPreview.totalCount > visibleAgents.length ? (
            <button
              className={`${SUMMARY_ROW_CLASS} tw:text-app-text-meta tw:hover:text-app-text tw:focus-visible:text-app-text`}
              type="button"
              onClick={() => setShowAllAgents(true)}
            >
              <ChevronDown aria-hidden="true" size={APP_ICON_SIZE} />
              <span className={SUMMARY_ROW_LABEL_CLASS}>
                查看全部 {agentPreview.totalCount} 个 Agent
              </span>
            </button>
          ) : null}
        </ThreadSummarySection>
      ) : null}

      {model.browserTabs.length ? (
        <ThreadSummarySection
          expanded={isSectionExpanded('browser')}
          id="browser"
          title="浏览器"
          onToggle={toggleSection}
        >
          {model.browserTabs.map((tab) => (
            <BrowserTabRow key={tab.tabId} tab={tab} onActivate={onActivateBrowserTab} />
          ))}
        </ThreadSummarySection>
      ) : null}

      {artifactPreview.items.length || model.gitDetection === 'non-git' ? (
        <ThreadSummarySection
          expanded={isSectionExpanded('artifacts')}
          id="artifacts"
          title="输出内容"
          meta={
            onCreateOutput ? (
              <button
                aria-label="创建文件或站点"
                className="tw:inline-flex tw:size-6 tw:items-center tw:justify-center tw:rounded-md tw:border-0 tw:bg-transparent tw:p-0 tw:text-app-text-meta tw:cursor-pointer tw:hover:text-app-text tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus"
                type="button"
                onClick={onCreateOutput}
              >
                <Plus aria-hidden="true" size={APP_ICON_SIZE} />
              </button>
            ) : null
          }
          onToggle={toggleSection}
        >
          {!artifactPreview.items.length ? (
            <button
              className={`${SUMMARY_ROW_CLASS} tw:text-app-text-meta`}
              type="button"
              disabled={!onCreateOutput}
              onClick={onCreateOutput}
            >
              <span aria-hidden="true" />
              <span className={SUMMARY_ROW_LABEL_CLASS}>创建文件或站点</span>
            </button>
          ) : null}
          {artifactPreview.items.map((artifact) => (
            <ArtifactRow key={artifact.artifactId} artifact={artifact} onOpen={onOpenArtifact} />
          ))}
          {!showAllArtifacts && artifactPreview.totalCount > artifactPreview.items.length ? (
            <button
              className={`${SUMMARY_ROW_CLASS} tw:text-app-text-meta tw:hover:text-app-text tw:focus-visible:text-app-text`}
              type="button"
              onClick={() => setShowAllArtifacts(true)}
            >
              <ChevronDown aria-hidden="true" size={APP_ICON_SIZE} />
              <span className={SUMMARY_ROW_LABEL_CLASS}>
                查看全部 {artifactPreview.totalCount} 个产物
              </span>
            </button>
          ) : null}
        </ThreadSummarySection>
      ) : null}

      {sourcePreview.items.length ? (
        <ThreadSummarySection
          expanded={isSectionExpanded('sources')}
          id="sources"
          title="来源"
          onToggle={toggleSection}
        >
          {sourcePreview.items.map((source) => (
            <ThreadSummarySourceRow
              key={source.identity}
              source={source}
              onOpenAttachment={onOpenAttachment}
              onOpenLocalContext={onOpenLocalContext}
            />
          ))}
          {sourcePreview.totalCount > sourcePreview.items.length ? (
            <button
              aria-haspopup="dialog"
              className={`${SUMMARY_ROW_CLASS} thread-summary-source-toggle tw:text-app-text-meta tw:[&>svg:first-child]:text-app-text-meta tw:hover:text-app-text tw:focus-visible:text-app-text tw:hover:[&>svg:first-child]:text-app-text tw:focus-visible:[&>svg:first-child]:text-app-text`}
              type="button"
              onClick={() => setSourcesPanelOpen(true)}
            >
              <Link2 aria-hidden="true" size={APP_ICON_SIZE} />
              <span className={SUMMARY_ROW_LABEL_CLASS}>
                查看全部 {sourcePreview.totalCount} 条来源
              </span>
            </button>
          ) : null}
        </ThreadSummarySection>
      ) : null}

      <ThreadSummarySourcesPanel
        open={sourcesPanelOpen}
        sources={model.sources}
        onOpenAttachment={onOpenAttachment}
        onOpenLocalContext={onOpenLocalContext}
        onOpenChange={setSourcesPanelOpen}
      />
    </aside>
  )
}

function GoalHeaderAction({
  goal,
  onGoalPause,
  onGoalResume,
}: {
  goal: ThreadSummaryViewModel['goal']
  onGoalPause?: () => void
  onGoalResume?: () => void
}): React.ReactNode {
  if (!goal) return null
  const paused = goal.status === 'paused'
  const action = paused ? onGoalResume : onGoalPause
  if (!action || (goal.status !== 'active' && !paused)) return null
  const label = paused ? '恢复目标' : '暂停目标'
  return (
    <Tooltip content={label}>
      <button
        aria-label={label}
        className="tw:inline-flex tw:size-6 tw:items-center tw:justify-center tw:rounded-md tw:border-0 tw:bg-transparent tw:p-0 tw:text-app-text-meta tw:[font:inherit] tw:cursor-pointer tw:outline-none tw:hover:bg-app-hover tw:hover:text-app-text tw:focus-visible:outline-1 tw:focus-visible:outline-offset-1 tw:focus-visible:outline-app-focus tw:[&>svg]:size-icon-sm"
        type="button"
        onClick={action}
      >
        {paused ? (
          <Play aria-hidden="true" size={APP_ICON_SIZES.sm} />
        ) : (
          <Pause aria-hidden="true" size={APP_ICON_SIZES.sm} />
        )}
      </button>
    </Tooltip>
  )
}

function AgentSectionMeta({
  agents,
}: {
  agents: ThreadSummaryViewModel['agents']
}): React.ReactNode {
  const running = agents.filter((agent) => agent.state === 'running').length
  const waiting = agents.filter((agent) => agent.state === 'waiting').length
  const finished = agents.length - running - waiting
  const label =
    running + waiting > 0
      ? [running > 0 ? `${running} 运行` : null, waiting > 0 ? `${waiting} 等待` : null]
          .filter(Boolean)
          .join(' · ')
      : `${finished} 已结束`
  return <span className="tw:whitespace-nowrap tw:text-app-text-meta tw:type-caption">{label}</span>
}

function AgentSectionSummary({
  agents,
}: {
  agents: ThreadSummaryViewModel['agents']
}): React.ReactNode {
  const active = agents.filter((agent) => agent.state !== 'finished').length
  return (
    <span className="tw:type-caption tw:tabular-nums">
      {active > 0 ? `${active} 活跃` : `${agents.length} 已结束`}
    </span>
  )
}

function BrowserTabRow({
  tab,
  onActivate,
}: {
  tab: ThreadSummaryBrowserTab
  onActivate?: (tabId: string) => void
}): React.ReactNode {
  const stateLabel = AGENT_STATUS_META_LABELS[tab.state]
  return (
    <button
      className={SUMMARY_ROW_CLASS}
      title={tab.state === 'error' ? '该标签页加载出错' : tab.title}
      type="button"
      onClick={() => onActivate?.(tab.tabId)}
    >
      <Globe className={SUMMARY_ROW_ICON_CLASS} aria-hidden="true" size={APP_ICON_SIZE} />
      <span className={SUMMARY_ROW_LABEL_CLASS}>{tab.title}</span>
      <small className="tw:flex tw:items-center tw:gap-1.5 tw:whitespace-nowrap tw:text-app-text-meta tw:type-caption">
        {tab.domain ? <span>{tab.domain}</span> : null}
        {stateLabel ? (
          <span
            className={cx(
              tab.state === 'error' && 'tw:text-app-danger',
              tab.state === 'suspended' && 'tw:text-app-warning',
            )}
          >
            {stateLabel}
          </span>
        ) : null}
      </small>
    </button>
  )
}

function ThreadSummarySourceRow({
  source,
  onOpenAttachment,
  onOpenLocalContext,
}: {
  source: ThreadSummarySourceEntry
  onOpenAttachment?: (attachment: Attachment) => void
  onOpenLocalContext?: (reference: LocalContextReference) => void
}): React.ReactNode {
  if (source.kind === 'attachment') {
    const Icon = source.attachment.kind === 'image' ? ImageIcon : Paperclip
    return (
      <button
        className={SUMMARY_ROW_CLASS}
        title={source.attachment.kind === 'image' ? '预览图片附件' : source.label}
        type="button"
        onClick={() => onOpenAttachment?.(source.attachment)}
      >
        <Icon className={SUMMARY_ROW_ICON_CLASS} aria-hidden="true" size={APP_ICON_SIZE} />
        <span className={SUMMARY_ROW_LABEL_CLASS}>{source.label}</span>
      </button>
    )
  }
  if (source.kind === 'reference') {
    const Icon = source.reference.kind === 'directory' ? Folder : FileText
    return (
      <button
        className={SUMMARY_ROW_CLASS}
        title={source.reference.status === 'missing' ? '引用的路径已不存在' : source.label}
        type="button"
        onClick={() => onOpenLocalContext?.(source.reference)}
      >
        <Icon className={SUMMARY_ROW_ICON_CLASS} aria-hidden="true" size={APP_ICON_SIZE} />
        <span className={SUMMARY_ROW_LABEL_CLASS}>{source.label}</span>
      </button>
    )
  }
  if (source.kind === 'link') {
    return (
      <a
        className={SUMMARY_ROW_CLASS}
        href={source.url}
        rel="noreferrer"
        target="_blank"
        title={source.url}
      >
        <Link2 className={SUMMARY_ROW_ICON_CLASS} aria-hidden="true" size={APP_ICON_SIZE} />
        <span className={SUMMARY_ROW_LABEL_CLASS}>{source.label}</span>
      </a>
    )
  }
  const Icon = source.toolKind === 'web-search' ? Search : Plug
  return (
    <div
      className="thread-summary-row thread-summary-source-static tw:grid tw:w-[calc(100%+16px)] tw:min-w-0 tw:-mx-2 tw:grid-cols-[16px_minmax(0,1fr)] tw:items-center tw:gap-2 tw:px-2 tw:text-app-text tw:type-body"
      title={source.source ?? source.label}
    >
      <Icon className={SUMMARY_ROW_ICON_CLASS} aria-hidden="true" size={APP_ICON_SIZE} />
      <span className={SUMMARY_ROW_LABEL_CLASS}>{source.label}</span>
    </div>
  )
}

function ArtifactRow({
  artifact,
  onOpen,
}: {
  artifact: ThreadSummaryArtifact
  onOpen?: (artifact: ThreadSummaryArtifact) => void
}): React.ReactNode {
  const previewable = threadSummaryArtifactPreviewKind(artifact.mimeType) !== 'binary'
  const meta = [
    artifact.mimeType,
    artifact.sizeBytes !== null ? formatByteSize(artifact.sizeBytes) : null,
    previewable ? null : '不支持预览',
  ]
    .filter(Boolean)
    .join(' · ')
  const row = (
    <>
      {artifact.previewKind === 'image' ? (
        <ImageIcon className={SUMMARY_ROW_ICON_CLASS} aria-hidden="true" size={APP_ICON_SIZE} />
      ) : (
        <Package className={SUMMARY_ROW_ICON_CLASS} aria-hidden="true" size={APP_ICON_SIZE} />
      )}
      <span className={SUMMARY_ROW_LABEL_CLASS}>{artifact.name}</span>
      <small
        className={cx(
          'tw:whitespace-nowrap tw:type-caption',
          previewable ? 'tw:text-app-text-meta' : 'tw:text-app-text-disabled',
        )}
      >
        {meta}
      </small>
    </>
  )
  if (!previewable || !onOpen) {
    return (
      <div
        className="thread-summary-row tw:grid tw:w-[calc(100%+16px)] tw:min-w-0 tw:-mx-2 tw:grid-cols-[16px_minmax(0,1fr)_max-content] tw:items-center tw:gap-2 tw:px-2 tw:text-app-text tw:type-body"
        title={`${artifact.name}：${meta}`}
      >
        {row}
      </div>
    )
  }
  return (
    <button
      className={SUMMARY_ROW_CLASS}
      title={`预览 ${artifact.name}`}
      type="button"
      onClick={() => onOpen(artifact)}
    >
      {row}
    </button>
  )
}

function ThreadSummarySourcesPanel({
  open,
  sources,
  onOpenAttachment,
  onOpenLocalContext,
  onOpenChange,
}: {
  open: boolean
  sources: ThreadSummaryViewModel['sources']
  onOpenAttachment?: (attachment: Attachment) => void
  onOpenLocalContext?: (reference: LocalContextReference) => void
  onOpenChange: (open: boolean) => void
}): React.ReactNode {
  const { onCloseAutoFocus } = useDialogFocusRestore(open)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop thread-summary-sources-overlay tw:fixed tw:inset-0 tw:z-modal" />
        <Dialog.Content
          className="ui-dialog-surface ui-dialog-surface--side-right thread-summary-sources-panel tw:fixed tw:z-popover tw:top-3 tw:right-3 tw:bottom-3 tw:flex tw:w-[min(360px,calc(100vw-24px))] tw:flex-col tw:gap-3 tw:rounded-xl tw:p-4 tw:text-app-text tw:outline-none"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <header className="tw:flex tw:items-center tw:justify-between tw:gap-3">
            <div className="tw:flex tw:min-w-0 tw:items-baseline tw:gap-2">
              <Dialog.Title className="tw:m-0 tw:type-row-title">来源</Dialog.Title>
              <span className="tw:text-app-text-meta tw:type-caption">{sources.length}</span>
            </div>
            <Dialog.Close asChild>
              <Button isIconOnly color="ghostSecondary" size="toolbar" title="关闭来源面板">
                <X aria-hidden="true" size={APP_ICON_SIZE} />
              </Button>
            </Dialog.Close>
          </header>
          <Dialog.Description className="tw:m-0 tw:text-app-text-meta tw:type-body-sm">
            当前会话中已识别的附件、文件与网页来源。
          </Dialog.Description>
          <div
            className="thread-summary-sources-panel__list tw:grid tw:min-h-0 tw:content-start tw:gap-1 tw:overflow-y-auto"
            role="list"
          >
            {sources.map((source) => (
              <ThreadSummarySourceRow
                key={source.identity}
                source={source}
                onOpenAttachment={onOpenAttachment}
                onOpenLocalContext={onOpenLocalContext}
              />
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ThreadSummarySection({
  children,
  collapsedSummary,
  expanded,
  first = false,
  id,
  meta,
  title,
  onToggle,
}: {
  children: React.ReactNode
  collapsedSummary?: React.ReactNode
  expanded: boolean
  first?: boolean
  id: ThreadSummarySectionId
  meta?: React.ReactNode
  title: string
  onToggle: (id: ThreadSummarySectionId) => void
}): React.ReactNode {
  const headingId = React.useId()
  const contentId = React.useId()
  return (
    <section
      aria-labelledby={headingId}
      className={
        first
          ? 'thread-summary-section thread-summary-section--first tw:relative tw:z-0 tw:flex tw:flex-col tw:pb-3 tw:last:pb-1'
          : 'thread-summary-section tw:relative tw:z-0 tw:flex tw:flex-col tw:pb-3 tw:last:pb-1'
      }
    >
      <header className="tw:sticky tw:top-0 tw:z-local tw:flex tw:h-7 tw:w-full tw:min-w-0 tw:items-center tw:justify-between tw:gap-2 tw:bg-transparent tw:pt-0 tw:pr-3 tw:pb-1 tw:pl-4 tw:text-app-text-soft tw:type-row-title">
        <h2 className="tw:m-0 tw:text-inherit tw:[font:inherit]">
          <button
            aria-controls={contentId}
            aria-expanded={expanded}
            className="thread-summary-section__toggle tw:inline-flex tw:min-w-0 tw:items-center tw:gap-2 tw:rounded-md tw:border-0 tw:bg-transparent tw:py-1 tw:pr-1 tw:pl-0 tw:text-left tw:text-inherit tw:[font:inherit] tw:cursor-pointer tw:outline-none tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-app-focus"
            type="button"
            onClick={() => onToggle(id)}
          >
            <span
              className="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap"
              id={headingId}
            >
              {title}
            </span>
            {!expanded ? collapsedSummary : null}
            <ChevronDown aria-hidden="true" size={APP_ICON_SIZES.sm} />
          </button>
        </h2>
        <span className="thread-summary-section__actions tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:justify-end">
          {expanded || id === 'environment' ? meta : null}
        </span>
      </header>
      <DisclosureContent
        className="thread-summary-section__content tw:relative tw:z-0"
        contentClassName="thread-summary-section__rows tw:grid tw:min-h-0 tw:gap-0 tw:overflow-hidden tw:px-4 tw:pt-1"
        expanded={expanded}
        id={contentId}
      >
        {children}
      </DisclosureContent>
    </section>
  )
}

function subagentStatusLabel(status: string): string {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'stopped') return '已停止'
  if (status === 'interrupted') return '已中断'
  if (status === 'queued') return '排队中'
  if (status === 'waiting-question') return '等待回答'
  if (status === 'waiting-permission') return '等待审批'
  if (status === 'steering') return '调整中'
  return '运行中'
}

function formatGoalDuration(timeUsedSeconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(timeUsedSeconds))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}小时${minutes}分`
  if (minutes > 0) return `${minutes}分${seconds}秒`
  return `${seconds}秒`
}

function formatGoalNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.floor(value)))
}

function formatByteSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = sizeBytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}
