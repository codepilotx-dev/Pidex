import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileDiff,
  History,
  MessageSquare,
  MessagesSquare,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  UserMinus,
  Users,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { RpcResult } from '@pidex/agent-protocol'
import { Button } from '../../components/ui/Button.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'

import { SearchInput } from '../../components/ui/SearchInput.js'
import { Select, type SelectOption } from '../../components/ui/Select.js'
import { Spinner } from '../../components/ui/Spinner.js'
import { DisclosureContent } from '../../components/ui/DisclosureContent.js'
import { useHeightTransition } from '../../hooks/UseHeightTransition.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../components/ui/IconTokens.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import type {
  DesktopSessionGroup,
  DesktopSessionGroupDetail,
  DesktopSessionGroupStep,
} from '../../services/desktop-client/Types.js'
import { cx } from '../../utils/Cx.js'
import { PrimaryPageLayout } from '../layout/primary-page/index.js'
import { FileMutationDiffBody } from '../session/timeline/FileMutationDiffBody.js'
import { SessionGroupEditorDialog } from './SessionGroupEditorDialog.js'

function formatGroupTime(timestamp?: number | string | null): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const now = Date.now()
  const diff = now - date.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`
  return date.toLocaleDateString()
}

export function SessionGroupsView(): React.ReactNode {
  const { groupId } = useParams<{ groupId: string }>()
  const navigate = useNavigate()
  const [groups, setGroups] = useState<DesktopSessionGroup[]>([])
  const [detail, setDetail] = useState<DesktopSessionGroupDetail | null>(null)
  const [steps, setSteps] = useState<DesktopSessionGroupStep[]>([])
  const [availableSessions, setAvailableSessions] = useState<
    Array<{ id: string; title: string; workspaceLabel: string }>
  >([])
  const [sessionToAdd, setSessionToAdd] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editorMode, setEditorMode] = useState<'create' | 'edit' | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const nextGroups = await desktopClient.listSessionGroups()
      setGroups(nextGroups)
      if (groupId) {
        const [nextDetail, nextSteps, activeSessions, archivedSessions] = await Promise.all([
          desktopClient.readSessionGroup(groupId),
          desktopClient.listSessionGroupSteps(groupId),
          desktopClient.listSessions({ archived: false }),
          desktopClient.listSessions({ archived: true }),
        ])
        const sessionItems = [...activeSessions, ...archivedSessions].map((session) => session.item)
        const sessions = new Map(sessionItems.map((session) => [session.id, session]))
        setAvailableSessions(
          sessionItems.map((session) => ({
            id: session.id,
            title: session.customTitle ?? session.aiTitle ?? session.sessionName ?? session.id,
            workspaceLabel: session.workspaceName || '无项目',
          })),
        )
        setDetail({
          ...nextDetail,
          members: nextDetail.members.map((member) => {
            const session = sessions.get(member.threadId)
            return {
              ...member,
              title: session?.customTitle ?? session?.aiTitle ?? session?.sessionName ?? undefined,
              workspaceLabel: session?.workspaceName || undefined,
            }
          }),
        })
        setSteps([...nextSteps].reverse())
      } else {
        setDetail(null)
        setSteps([])
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '工作组加载失败')
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase()
    return keyword
      ? groups.filter((group) =>
          `${group.name} ${group.description}`.toLocaleLowerCase().includes(keyword),
        )
      : groups
  }, [groups, search])

  const memberThreadIds = useMemo(
    () => new Set(detail?.members.map((m) => m.threadId) ?? []),
    [detail?.members],
  )

  const sessionSelectOptions: SelectOption[] = useMemo(() => {
    return availableSessions
      .filter((session) => !memberThreadIds.has(session.id))
      .map((session) => ({
        value: session.id,
        label: session.title,
        detail: session.workspaceLabel,
        icon: <MessageSquare className="session-group-select-icon tw:me-1" size={APP_ICON_SIZE} />,
      }))
  }, [availableSessions, memberThreadIds])

  function openCreateDialog(): void {
    setDraftName('')
    setDraftDescription('')
    setEditorMode('create')
  }

  function openEditDialog(): void {
    if (!detail) return
    setDraftName(detail.group.name)
    setDraftDescription(detail.group.description)
    setEditorMode('edit')
  }

  async function saveGroup(): Promise<void> {
    const name = draftName.trim()
    if (!name) return
    setSaving(true)
    setError(null)
    try {
      if (editorMode === 'create') {
        const group = await desktopClient.createSessionGroup({
          name,
          description: draftDescription.trim(),
        })
        setEditorMode(null)
        navigate(`/workflows/${encodeURIComponent(group.id)}`)
      } else if (editorMode === 'edit' && detail) {
        await desktopClient.updateSessionGroup({
          groupId: detail.group.id,
          version: detail.group.version,
          name,
          description: draftDescription.trim(),
        })
        setEditorMode(null)
        await refresh()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '工作组保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function deleteGroup(): Promise<void> {
    if (!detail) return
    setSaving(true)
    setError(null)
    try {
      await desktopClient.deleteSessionGroup(detail.group.id, detail.group.version)
      setDeleteDialogOpen(false)
      navigate('/workflows')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '工作组删除失败')
    } finally {
      setSaving(false)
    }
  }

  async function addSession(): Promise<void> {
    if (!detail || !sessionToAdd) return
    await desktopClient.setSessionGroupMembership({
      threadId: sessionToAdd,
      groupId: detail.group.id,
    })
    setSessionToAdd('')
    await refresh()
  }

  async function removeSession(threadId: string): Promise<void> {
    await desktopClient.setSessionGroupMembership({ threadId, groupId: null })
    await refresh()
  }

  const createWorkflowAction = (
    <Button
      aria-label="新建工作组"
      color="primary"
      onClick={openCreateDialog}
      shape="pill"
      size="md"
    >
      <Plus aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      <span>新建工作组</span>
    </Button>
  )

  return (
    <>
      <SessionGroupEditorDialog
        description={draftDescription}
        mode={editorMode ?? 'create'}
        name={draftName}
        open={editorMode !== null}
        saving={saving}
        onCancel={() => setEditorMode(null)}
        onDescriptionChange={setDraftDescription}
        onNameChange={setDraftName}
        onSubmit={() => void saveGroup()}
      />
      <ConfirmationDialog
        actionDisabled={saving}
        actionLabel={saving ? '删除中…' : '删除组'}
        description="聊天、Turn 和 Diff 不会被删除，但工作组上下文将无法恢复。"
        open={deleteDialogOpen}
        title={`删除“${detail?.group.name ?? ''}”？`}
        tone="danger"
        onAction={() => void deleteGroup()}
        onCancel={() => setDeleteDialogOpen(false)}
      />
      {groupId ? (
        <main
          aria-live="polite"
          className="session-group-detail-page tw:@container tw:h-full tw:w-full tw:min-w-0 tw:min-h-0 tw:overflow-x-hidden tw:overflow-y-auto tw:p-5 tw:[scrollbar-gutter:stable]"
        >
          {error ? (
            <div
              className="session-group-detail-message tw:flex tw:min-h-[calc(var(--cpx-sys-space-8)*8)] tw:flex-col tw:items-center tw:justify-center tw:gap-2 tw:text-app-text-soft tw:type-body-sm"
              role="alert"
            >
              <AlertCircle size={APP_ICON_SIZE} />
              <h1>无法打开工作组</h1>
              <p>{error}</p>
              <div>
                <Button color="secondary" size="compact" onClick={() => void refresh()}>
                  <RefreshCw size={APP_ICON_SIZES.sm} />
                  <span>重试</span>
                </Button>
                <Button color="secondary" size="compact" onClick={() => navigate('/workflows')}>
                  返回工作组
                </Button>
              </div>
            </div>
          ) : null}
          {loading && !detail ? (
            <div className="session-group-loading tw:flex tw:min-h-[40vh] tw:flex-col tw:items-center tw:justify-center tw:gap-3 tw:text-app-text-soft tw:type-body-sm">
              <Spinner size="medium" />
              <span>正在加载工作组…</span>
            </div>
          ) : null}
          {detail ? (
            <div className="session-group-detail__inner tw:mx-auto tw:flex tw:w-[min(var(--page-content-max-width),100%)] tw:flex-col tw:pb-8">
              <div className="tw:mb-3 tw:flex tw:items-center">
                <Link
                  className="session-groups-back tw:inline-flex tw:items-center tw:gap-2 tw:rounded-md tw:px-2 tw:py-1 tw:text-app-text-soft tw:type-label tw:no-underline tw:hover:bg-app-hover tw:hover:text-app-text tw:focus-visible:outline-2 tw:focus-visible:outline-offset-1 tw:focus-visible:outline-app-focus"
                  to="/workflows"
                >
                  <ArrowLeft aria-hidden="true" size="var(--inline-icon-size, 1em)" />
                  <span>返回工作组</span>
                </Link>
              </div>
              <header className="session-group-detail__header tw:flex tw:items-start tw:justify-between tw:gap-4 tw:border-b tw:border-b-app-border-subtle tw:pb-6 tw:@max-[760px]:flex-col tw:@max-[760px]:items-stretch">
                <div className="session-group-detail__info tw:flex tw:min-w-0 tw:grow tw:shrink tw:basis-auto tw:flex-col tw:gap-1 tw:[&>h1]:mt-1 tw:[&>h1]:text-app-text tw:[&>h1]:type-title-xl tw:[&>p]:m-0 tw:[&>p]:text-app-text-soft tw:[&>p]:type-body">
                  <span className="chip-semantic accent session-group-eyebrow tw:self-start">
                    <Sparkles size="var(--inline-icon-size, 1em)" strokeWidth={APP_ICON_STROKE_WIDTH} />
                    共享上下文
                  </span>
                  <h1>{detail.group.name}</h1>
                  <p>{detail.group.description || '这个组暂未设置详细说明。'}</p>
                </div>
                <div className="session-group-actions tw:flex tw:items-center tw:gap-2 tw:@max-[760px]:flex-wrap">
                  <Button color="secondary" size="compact" onClick={openEditDialog}>
                    <Pencil size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    <span>编辑</span>
                  </Button>
                  <Button
                    color="secondary"
                    size="compact"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    <span>删除组</span>
                  </Button>
                </div>
              </header>

              <section className="session-group-section tw:border-b tw:border-b-app-border-subtle tw:py-6 tw:last:border-b-0">
                <div className="session-group-section__title-row tw:mb-4 tw:flex tw:items-center tw:gap-2 tw:text-app-text tw:[&>h3]:m-0 tw:[&>h3]:type-title-sm">
                  <BookOpen size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                  <h3>当前摘要</h3>
                </div>
                <div className="session-group-digest-card tw:rounded-xl tw:border tw:border-app-border-subtle tw:bg-app-underlay tw:p-4">
                  <p className="session-group-digest tw:m-0 tw:whitespace-pre-wrap tw:text-app-text tw:type-body">
                    {detail.digest ||
                      '完成组内第一个会话步骤后，这里会自动整理目标、决策和修复结论。'}
                  </p>
                </div>
                {detail.contextEntries.length ? (
                  <div className="session-group-context-grid tw:mt-4 tw:grid tw:grid-cols-[repeat(auto-fit,minmax(240px,1fr))] tw:gap-3">
                    {detail.contextEntries
                      .filter((entry) => entry.status === 'active')
                      .map((entry) => (
                        <article
                          className="session-group-context-card tw:rounded-xl tw:border tw:border-app-border-subtle tw:bg-app-canvas tw:px-4 tw:py-3 tw:[&>p]:mt-2 tw:[&>p]:text-app-text-soft tw:[&>p]:type-body-sm"
                          key={entry.id}
                        >
                          <div className="session-group-context-card__header tw:flex tw:items-center tw:gap-2 tw:[&>strong]:text-app-text tw:[&>strong]:type-row-title">
                            <span className="chip-semantic accent">{entry.section}</span>
                            <strong>{entry.title}</strong>
                          </div>
                          <p>{entry.content}</p>
                        </article>
                      ))}
                  </div>
                ) : null}
              </section>

              <section className="session-group-section tw:border-b tw:border-b-app-border-subtle tw:py-6 tw:last:border-b-0">
                <div className="session-group-section__title-row tw:mb-4 tw:flex tw:items-center tw:gap-2 tw:text-app-text tw:[&>h3]:m-0 tw:[&>h3]:type-title-sm">
                  <Users size="var(--inline-icon-size, 1em)" strokeWidth={APP_ICON_STROKE_WIDTH} />
                  <h3>成员会话</h3>
                  <span className="session-group-section-count tw:inline-flex tw:h-4.5 tw:min-w-4.5 tw:items-center tw:justify-center tw:rounded-full tw:bg-app-control tw:px-1 tw:text-app-text-soft tw:type-label">
                    {detail.members.length}
                  </span>
                </div>
                <p className="session-group-member-hint tw:m-0 tw:mb-4 tw:text-app-text-soft tw:type-body-sm">
                  成员可以来自不同项目；组内会共享各自的设计、计划和成果，打开成员会话可查看完整历史。
                </p>
                <div className="session-group-member-add tw:mb-4 tw:flex tw:items-center tw:gap-2 tw:@max-[760px]:flex-col tw:@max-[760px]:items-stretch">
                  <div className="session-group-member-select-wrap tw:max-w-[380px] tw:flex-1 tw:@max-[760px]:w-full tw:@max-[760px]:max-w-none">
                    <Select
                      ariaLabel="选择已有会话"
                      emptyText="没有可添加的会话"
                      onValueChange={setSessionToAdd}
                      options={sessionSelectOptions}
                      placeholder="选择已有会话并加入工作组…"
                      searchPlaceholder="搜索会话名称或项目…"
                      searchable
                      value={sessionToAdd}
                    />
                  </div>
                  <Button
                    color="primary"
                    disabled={!sessionToAdd}
                    size="compact"
                    onClick={() => void addSession()}
                  >
                    <Plus size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    <span>加入组</span>
                  </Button>
                </div>
                <div className="session-group-members tw:grid tw:grid-cols-[repeat(auto-fill,minmax(260px,1fr))] tw:gap-2">
                  {detail.members.map((member) => (
                    <article
                      className="session-group-member-card tw:flex tw:items-center tw:gap-2 tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-underlay tw:px-3 tw:py-2 tw:transition-[background-color,border-color] tw:duration-enter tw:ease-standard tw:hover:border-app-border tw:hover:bg-app-canvas"
                      key={member.threadId}
                    >
                      <div className="session-group-member-card__icon tw:flex tw:items-center tw:text-app-text-meta">
                        <MessageSquare size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                      </div>
                      <Link
                        className="session-group-member-card__body"
                        to={`/threads/${encodeURIComponent(member.threadId)}`}
                      >
                        <span className="session-group-member-card__title tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-app-text tw:type-row-title">
                          {member.title || member.threadId}
                        </span>
                        <span className="chip-semantic info session-group-member-card__chip tw:self-start tw:type-caption">
                          {member.workspaceLabel || '无项目'}
                        </span>
                      </Link>
                      <div className="session-group-member-card__actions">
                        <Button
                          isIconOnly
                          aria-label={`移出会话：${member.title || member.threadId}`}
                          color="ghostSecondary"
                          size="toolbar"
                          title="从该组移出"
                          onClick={() => void removeSession(member.threadId)}
                        >
                          <UserMinus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                        </Button>
                      </div>
                    </article>
                  ))}
                  {detail.members.length === 0 ? (
                    <p className="session-group-empty-subtle tw:m-0 tw:py-4 tw:text-app-text-meta tw:type-body-sm">
                      当前工作组暂无成员会话，请在上方选择已有会话加入。
                    </p>
                  ) : null}
                </div>
              </section>

              <section className="session-group-section tw:border-b tw:border-b-app-border-subtle tw:py-6 tw:last:border-b-0">
                <div className="session-group-section__title-row tw:mb-4 tw:flex tw:items-center tw:gap-2 tw:text-app-text tw:[&>h3]:m-0 tw:[&>h3]:type-title-sm">
                  <History size="var(--inline-icon-size, 1em)" strokeWidth={APP_ICON_STROKE_WIDTH} />
                  <h3>步骤时间线</h3>
                  <span className="session-group-section-count tw:inline-flex tw:h-4.5 tw:min-w-4.5 tw:items-center tw:justify-center tw:rounded-full tw:bg-app-control tw:px-1 tw:text-app-text-soft tw:type-label">
                    {steps.length}
                  </span>
                </div>
                <div className="session-group-timeline tw:flex tw:flex-col">
                  {steps.map((step) => (
                    <SessionGroupStepCard groupId={detail.group.id} key={step.id} step={step} />
                  ))}
                  {steps.length === 0 ? (
                    <p className="session-group-empty-subtle tw:m-0 tw:py-4 tw:text-app-text-meta tw:type-body-sm">
                      组内的新会话完成一步后，会自动在此记录决策、修改和验证结果。
                    </p>
                  ) : null}
                </div>
              </section>
            </div>
          ) : null}
        </main>
      ) : (
        <PrimaryPageLayout
          actions={createWorkflowAction}
          className="session-groups-primary-page"
          description="组织相关任务，共享修复上下文、决策摘要和验证记录。"
          search={
            <SearchInput
              aria-label="搜索工作组"
              onChange={setSearch}
              placeholder="搜索名称或说明…"
              shape="pill"
              size="md"
              value={search}
              variant="outlined"
            />
          }
          title="工作组"
        >
          <main
            aria-live="polite"
            className="session-groups-index tw:flex tw:min-w-0 tw:flex-auto tw:shrink-0 tw:flex-col"
          >
            {error ? (
              <div
                className="session-group-notice tw:mb-4 tw:flex tw:items-center tw:justify-between tw:gap-3 tw:rounded-lg tw:border tw:border-app-danger-border tw:bg-app-danger-subtle tw:px-4 tw:py-3 tw:text-app-danger-fg tw:type-body-sm"
                role="alert"
              >
                <AlertCircle size="var(--inline-icon-size, 1em)" />
                <span>{error}</span>
                <Button color="secondary" size="compact" onClick={() => void refresh()}>
                  <RefreshCw size={APP_ICON_SIZES.sm} />
                  <span>重试</span>
                </Button>
              </div>
            ) : null}
            {loading ? (
              <div className="session-group-loading tw:flex tw:min-h-[40vh] tw:flex-col tw:items-center tw:justify-center tw:gap-3 tw:text-app-text-soft tw:type-body-sm">
                <Spinner size="medium" />
                <span>正在加载工作组…</span>
              </div>
            ) : null}
            {!loading && !error && filtered.length > 0 ? (
              <div className="session-groups-table tw:@container">
                <div
                  aria-hidden="true"
                  className="session-groups-table__header tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(120px,160px)_minmax(112px,auto)] tw:items-center tw:gap-4 tw:border-b tw:border-b-app-border-subtle tw:px-3 tw:py-2 tw:text-app-text-meta tw:type-caption tw:@max-[760px]:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <span>工作组</span>
                  <span>项目</span>
                  <span>最近更新</span>
                </div>
                <div className="session-groups-table__rows tw:grid">
                  {filtered.map((group) => (
                    <Link
                      className="session-group-row tw:min-w-0 tw:rounded-lg tw:p-3 tw:text-inherit tw:no-underline tw:hover:bg-app-hover tw:focus-visible:outline-2 tw:focus-visible:outline-offset-1 tw:focus-visible:outline-app-focus"
                      key={group.id}
                      to={`/workflows/${encodeURIComponent(group.id)}`}
                    >
                      <span className="session-group-row__main tw:flex tw:min-w-0 tw:flex-col tw:gap-1 tw:[&>small]:overflow-hidden tw:[&>small]:text-ellipsis tw:[&>small]:whitespace-nowrap tw:[&>small]:text-app-text-soft tw:[&>small]:type-body-sm tw:[&>strong]:overflow-hidden tw:[&>strong]:text-ellipsis tw:[&>strong]:whitespace-nowrap tw:[&>strong]:text-app-text tw:[&>strong]:type-row-title">
                        <strong>{group.name}</strong>
                        <small>
                          {group.memberCount} 个会话
                          {group.description ? ` · ${group.description}` : ''}
                        </small>
                      </span>
                      <span className="session-group-row__projects tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-app-text-meta tw:type-caption tw:@max-[760px]:hidden">
                        {group.projectLabels.length > 0
                          ? group.projectLabels.slice(0, 2).join('、')
                          : '无项目'}
                      </span>
                      <span className="session-group-row__updated tw:flex tw:min-w-0 tw:items-center tw:justify-between tw:gap-2 tw:whitespace-nowrap tw:text-app-text-meta tw:type-caption">
                        <span>{formatGroupTime(group.latestStepAt) || '暂无记录'}</span>
                        <ChevronRight aria-hidden="true" size="var(--inline-icon-size, 1em)" />
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
            {!loading && !error && groups.length === 0 ? (
              <div className="session-groups-empty-state tw:flex tw:min-h-[calc(var(--cpx-sys-space-8)*8)] tw:grow tw:shrink tw:basis-auto tw:flex-col tw:items-center tw:justify-center tw:gap-2 tw:px-4 tw:py-8 tw:text-center tw:text-app-text-meta tw:type-body-sm tw:[&>h2]:m-0 tw:[&>h2]:text-app-text tw:[&>h2]:type-title-sm tw:[&>p]:m-0">
                <MessagesSquare
                  aria-hidden="true"
                  size={APP_ICON_SIZES.lg}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
                <h2>暂无工作组</h2>
                <p>将相关任务组织在一起，共享上下文并追踪每一步验证。</p>
                <Button color="secondary" onClick={openCreateDialog}>
                  创建新工作组
                </Button>
              </div>
            ) : null}
            {!loading && !error && groups.length > 0 && filtered.length === 0 ? (
              <div className="session-groups-empty-state tw:flex tw:min-h-[calc(var(--cpx-sys-space-8)*8)] tw:grow tw:shrink tw:basis-auto tw:flex-col tw:items-center tw:justify-center tw:gap-2 tw:px-4 tw:py-8 tw:text-center tw:text-app-text-meta tw:type-body-sm tw:[&>h2]:m-0 tw:[&>h2]:text-app-text tw:[&>h2]:type-title-sm tw:[&>p]:m-0">
                <MessagesSquare
                  aria-hidden="true"
                  size={APP_ICON_SIZES.lg}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
                <h2>未找到工作组</h2>
                <p>没有与“{search}”匹配的工作组。</p>
                <Button color="secondary" size="compact" onClick={() => setSearch('')}>
                  清除搜索
                </Button>
              </div>
            ) : null}
          </main>
        </PrimaryPageLayout>
      )}
    </>
  )
}

const SessionGroupStepCard = memo(function SessionGroupStepCard({
  groupId,
  step,
}: {
  groupId: string
  step: DesktopSessionGroupStep
}): React.ReactNode {
  const [diff, setDiff] = useState<RpcResult<'session-group/step/diff'> | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)
  const [diffLoading, setDiffLoading] = useState(false)
  const diffRequestRef = useRef<Promise<RpcResult<'session-group/step/diff'>> | null>(null)
  const diffId = useId()
  const diffResize = useHeightTransition([diffLoading, diff?.files.length ?? 0])
  const diffFiles = useMemo(
    () =>
      diff?.files.map((file) => ({
        diff: {
          path: file.path,
          operation: file.operation === 'rename' ? ('update' as const) : file.operation,
          patch: file.patch,
          hunks: file.hunks,
          renderable: file.renderable,
          tooLargeReason: file.tooLargeReason,
        },
        key: `${file.workspaceLabel}:${file.path}`,
      })) ?? [],
    [diff],
  )

  async function toggleDiff(): Promise<void> {
    const next = !diffOpen
    setDiffOpen(next)
    if (next && !diff && !diffRequestRef.current) {
      setDiffLoading(true)
      const request = desktopClient.readSessionGroupStepDiff({ groupId, stepId: step.id })
      diffRequestRef.current = request
      try {
        const diffResult = await request
        setDiff(diffResult)
      } finally {
        if (diffRequestRef.current === request) {
          diffRequestRef.current = null
          setDiffLoading(false)
        }
      }
    }
  }

  const isFailed =
    step.status === 'failed' ||
    step.status === 'interrupted' ||
    step.status === 'cancelled' ||
    Boolean(step.failure)
  const isCompleted = step.status === 'completed'

  const statusLabel =
    step.status === 'completed'
      ? '已完成'
      : step.status === 'failed'
        ? '失败'
        : step.status === 'interrupted'
          ? '已中断'
          : step.status === 'cancelled'
            ? '已取消'
            : step.status === 'waiting_permission'
              ? '等待权限'
              : '等待提问'

  return (
    <article
      className="session-group-step tw:relative tw:grid tw:grid-cols-[36px_minmax(0,1fr)]"
      data-status={step.status}
    >
      <div className="session-group-step__rail tw:relative tw:flex tw:flex-col tw:items-center">
        <div
          className={cx(
            'session-group-step__node tw:z-local tw:flex tw:size-6.5 tw:items-center tw:justify-center tw:rounded-full',
            isFailed
              ? 'is-danger tw:border tw:border-app-danger-border tw:bg-app-danger-subtle tw:text-app-danger-fg'
              : isCompleted
                ? 'is-success tw:border tw:border-app-success-border tw:bg-app-success-subtle tw:text-app-success-fg'
                : 'is-accent tw:border tw:border-app-accent-border tw:bg-app-accent-subtle tw:text-app-accent-fg',
          )}
        >
          {isFailed ? (
            <AlertCircle size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          ) : isCompleted ? (
            <CheckCircle2 size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          ) : (
            <Sparkles size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          )}
        </div>
        <span className="session-group-step__seq tw:hidden">{step.sequence}</span>
      </div>
      <div className="session-group-step__body tw:min-w-0 tw:pb-6 tw:pl-3">
        <header className="session-group-step__header tw:mb-2 tw:flex tw:items-start tw:justify-between tw:gap-3 tw:@max-[760px]:flex-col">
          <div className="session-group-step__meta tw:flex tw:flex-col tw:gap-1">
            <div className="session-group-step__title-row tw:flex tw:items-center tw:gap-2">
              <strong className="session-group-step__title tw:text-app-text tw:type-row-title">
                {step.sourceThreadTitle || '未命名步骤'}
              </strong>
              <span
                className={cx(
                  'chip-semantic',
                  isFailed ? 'danger' : isCompleted ? 'success' : 'accent',
                )}
              >
                {statusLabel}
              </span>
            </div>
            <div className="session-group-step__submeta tw:flex tw:items-center tw:gap-1 tw:text-app-text-meta tw:type-caption">
              <span>{step.workspaceLabel || '默认工作区'}</span>
              <span>·</span>
              <span>Turn {step.sourceTurnId}</span>
            </div>
          </div>
          {step.sourceThreadId ? (
            <Link
              className="session-group-step__link tw:inline-flex tw:items-center tw:gap-1 tw:text-app-accent-fg tw:type-caption tw:no-underline tw:hover:underline"
              to={`/threads/${encodeURIComponent(step.sourceThreadId)}`}
            >
              <span>打开来源</span>
              <ArrowUpRight size="var(--inline-icon-size, 1em)" strokeWidth={APP_ICON_STROKE_WIDTH} />
            </Link>
          ) : (
            <span className="session-group-step__link session-group-step__link--disabled tw:cursor-default tw:text-app-text-disabled">
              来源已删除
            </span>
          )}
        </header>

        {step.summary ? (
          <p className="session-group-step__summary tw:mb-2 tw:mt-0 tw:whitespace-pre-wrap tw:text-app-text-soft tw:type-body-sm">
            {step.summary}
          </p>
        ) : null}

        {step.checkpoints.length ? (
          <ol className="session-group-step__evidence tw:my-2 tw:flex tw:list-none tw:flex-col tw:gap-1 tw:p-0 tw:[&>li]:flex tw:[&>li]:items-baseline tw:[&>li]:gap-2 tw:[&>li]:text-app-text-meta tw:[&>li]:type-caption">
            {step.checkpoints.map((checkpoint) => {
              const checkpointLabel =
                checkpoint.status === 'completed'
                  ? '已完成'
                  : checkpoint.status === 'failed'
                    ? '失败'
                    : '进行中'
              return (
                <li key={`${checkpoint.ordinal}:${checkpoint.kind}`}>
                  <span
                    className={cx(
                      'chip-semantic',
                      checkpoint.status === 'completed'
                        ? 'success'
                        : checkpoint.status === 'failed'
                          ? 'danger'
                          : 'info',
                    )}
                  >
                    {checkpointLabel}
                  </span>
                  <span className="session-group-step__checkpoint-text tw:flex-1">
                    {checkpoint.summary}
                  </span>
                </li>
              )
            })}
          </ol>
        ) : null}

        {step.validations.length ? (
          <div className="session-group-step__validations tw:mt-2 tw:grid tw:gap-2">
            {step.validations.map((validation) => (
              <div
                className={cx(
                  'session-group-step__validation-item tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-underlay tw:px-3 tw:py-2 tw:[&>p]:mb-0 tw:[&>p]:mt-1 tw:[&>p]:text-app-text-soft tw:[&>p]:type-body-sm',
                  validation.status === 'passed'
                    ? 'is-passed tw:border-app-border-subtle'
                    : validation.status === 'failed'
                      ? 'is-failed tw:border-app-danger-border tw:bg-app-danger-subtle'
                      : 'is-skipped',
                )}
                key={`${validation.name}:${validation.summary}`}
              >
                <div className="session-group-step__validation-header tw:flex tw:items-center tw:gap-1 tw:text-app-text tw:type-label tw:[&>strong]:type-weight-label">
                  {validation.status === 'passed' ? (
                    <Check className="tw:text-app-success" size={APP_ICON_SIZES.sm} />
                  ) : validation.status === 'failed' ? (
                    <AlertCircle className="tw:text-app-danger" size={APP_ICON_SIZES.sm} />
                  ) : (
                    <History className="tw:text-app-text-meta" size={APP_ICON_SIZES.sm} />
                  )}
                  <strong>
                    {validation.status === 'passed'
                      ? '验证通过'
                      : validation.status === 'failed'
                        ? '验证失败'
                        : '验证跳过'}{' '}
                    · {validation.name}
                  </strong>
                </div>
                {validation.summary ? <p>{validation.summary}</p> : null}
              </div>
            ))}
          </div>
        ) : null}

        {step.failure ? (
          <div
            className="session-group-step__failure tw:mt-2 tw:flex tw:flex-col tw:gap-1 tw:rounded-md tw:border tw:border-app-danger-border tw:bg-app-danger-subtle tw:px-3 tw:py-2 tw:text-app-danger-fg tw:type-caption"
            role="alert"
          >
            <div className="session-group-step__failure-title tw:flex tw:items-center tw:gap-1 tw:type-weight-label">
              <AlertCircle size="var(--inline-icon-size, 1em)" />
              <strong>失败阶段：{step.failure.stage}</strong>
            </div>
            <span>{step.failure.message}</span>
          </div>
        ) : null}

        {step.changedFiles.length ? (
          <div className="session-group-step__diff-area tw:mt-2">
            <button
              aria-controls={diffId}
              aria-expanded={diffOpen}
              className="session-group-diff-toggle tw:inline-flex tw:cursor-pointer tw:items-center tw:gap-1 tw:rounded-md tw:border-0 tw:bg-app-control tw:px-2 tw:py-1 tw:text-app-accent-fg tw:type-label tw:transition-[background-color] tw:duration-enter tw:ease-standard tw:hover:bg-app-hover"
              type="button"
              onClick={() => void toggleDiff()}
            >
              <FileDiff size="var(--inline-icon-size, 1em)" strokeWidth={APP_ICON_STROKE_WIDTH} />
              <span>{step.changedFiles.length} 个变更文件</span>
              {diffOpen ? (
                <ChevronUp size={APP_ICON_SIZES.sm} />
              ) : (
                <ChevronDown size={APP_ICON_SIZES.sm} />
              )}
            </button>
            <DisclosureContent
              contentClassName="session-group-step__diff tw:mt-2 tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border-subtle"
              expanded={diffOpen}
              id={diffId}
              mountPolicy="always"
            >
              <div
                className="session-group-step__diff-resize tw:transition-[height] tw:duration-disclosure tw:ease-disclosure"
                ref={diffResize.ref}
                style={diffResize.style}
              >
                {diffLoading ? (
                  <div className="session-group-diff-loading tw:p-4 tw:text-center tw:text-app-text-meta tw:type-caption">
                    正在加载 Diff…
                  </div>
                ) : diff ? (
                  diffFiles.map((file) => (
                    <FileMutationDiffBody diff={file.diff} diffMarkerStyle="color" key={file.key} />
                  ))
                ) : null}
              </div>
            </DisclosureContent>
          </div>
        ) : null}
      </div>
    </article>
  )
})
