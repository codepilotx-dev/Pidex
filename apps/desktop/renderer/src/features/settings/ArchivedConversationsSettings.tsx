import { desktopClient } from '../../services/desktop-client/index.js'
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { sessionDisplayTitle, type SessionListItem } from '../../UiTypes.js'
import { SettingsSection } from './SettingsSection.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { Button } from '../../components/ui/Button.js'
import { Input } from '../../components/ui/Input.js'
import { Select } from '../../components/ui/Select.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'
import { canonicalThreadCache } from '../session/state/CanonicalThreadCache.js'
import { errorMessageOf } from '@pidex/shared/errors'
import {
  archivedGroups,
  deleteArchivedSessions,
  type ArchivedSort,
} from './ArchivedConversationsModel.js'

export function ArchivedConversationsSettings(): ReactNode {
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const mutating = useRef(false)
  const [query, setQuery] = useState('')
  const search = useDeferredValue(query)
  const [project, setProject] = useState('all')
  const [sort, setSort] = useState<ArchivedSort>('updated')
  const [type, setType] = useState('all')
  const [deleting, setDeleting] = useState<SessionListItem[] | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const loadSessions = useCallback(async () => {
    try {
      const snapshots = await desktopClient.listSessions({ archived: true })
      setSessions(
        snapshots.map((snapshot) => snapshot.item).filter((session) => session.archivedAt),
      )
      setError(null)
    } catch (cause) {
      setError(errorMessageOf(cause))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void loadSessions()
  }, [loadSessions])
  const groups = useMemo(
    () =>
      archivedGroups(
        type === 'local'
          ? sessions.filter((session) => session.storageSource === 'local')
          : sessions,
        search,
        project,
        sort,
      ),
    [sessions, search, project, sort, type],
  )
  const projects = useMemo(
    () => [
      ...new Map(
        sessions.filter((s) => s.projectId).map((s) => [s.projectId!, s.workspaceName]),
      ).entries(),
    ],
    [sessions],
  )
  const projectOptions = [
    { value: 'all', label: '所有项目' },
    ...projects.map(([value, label]) => ({ value, label })),
    { value: 'chats', label: '无项目聊天' },
    { value: 'scheduled', label: '定时任务' },
  ]

  async function restoreSession(session: SessionListItem) {
    if (mutating.current) return
    mutating.current = true
    setBusy(true)
    try {
      await desktopClient.updateSessionMetadata(session.id, { archivedAt: null })
      canonicalThreadCache.invalidate(session.id)
      setSessions((current) => current.filter((item) => item.id !== session.id))
      setError(null)
      requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }))
    } catch (cause) {
      setError(errorMessageOf(cause))
    } finally {
      mutating.current = false
      setBusy(false)
    }
  }

  async function deleteSessions() {
    if (!deleting || mutating.current) return
    mutating.current = true
    setBusy(true)
    const targets = deleting
    try {
      const { removed, failed } = await deleteArchivedSessions(
        targets.map((session) => session.id),
        async (id) => {
          await desktopClient.disposeSession(id)
          canonicalThreadCache.invalidate(id)
        },
      )
      setSessions((current) => current.filter((item) => !removed.has(item.id)))
      await loadSessions()
      setError(failed ? `已删除 ${removed.size} 个聊天，${failed} 个删除失败，请重试。` : null)
      setDeleting(null)
    } finally {
      mutating.current = false
      setBusy(false)
    }
  }

  return (
    <SettingsContentArea>
      <div className="settings-content-inner tw:@container tw:w-full tw:min-w-0 tw:mx-auto tw:p-5 tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]">
        <header className="tw:mb-8 tw:flex tw:items-center tw:justify-between tw:gap-4">
          <h2 className="tw:m-0 tw:type-title-xl tw:text-app-text">已归档对话</h2>
          <Button
            color="danger"
            disabled={busy || !sessions.length}
            onClick={() => setDeleting(sessions)}
          >
            全部删除
          </Button>
        </header>
        <div className="tw:mb-8 tw:flex tw:items-center tw:gap-2">
          <Input
            ref={searchRef}
            aria-label="搜索已归档聊天"
            placeholder="搜索已归档聊天"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="tw:min-w-0 tw:flex-1"
          />
          <Select<ArchivedSort>
            ariaLabel="排序方式"
            value={sort}
            onValueChange={setSort}
            options={[
              { value: 'updated', label: '更新时间' },
              { value: 'created', label: '创建时间' },
              { value: 'alphabetical', label: '字母顺序' },
            ]}
          />
          <Select
            ariaLabel="聊天类型"
            value={type}
            onValueChange={setType}
            options={[
              { value: 'all', label: '全部聊天' },
              { value: 'local', label: '本地' },
            ]}
          />
          <Select
            ariaLabel="项目筛选"
            value={project}
            options={projectOptions}
            onValueChange={setProject}
          />
        </div>
        {error ? (
          <p role="alert" className="tw:type-body-sm tw:text-app-danger">
            {error}
          </p>
        ) : null}
        {loading ? (
          <p role="status">正在加载归档聊天…</p>
        ) : !groups.length ? (
          <p className="tw:type-body-sm tw:text-app-text-soft">
            {sessions.length ? '没有匹配的聊天。' : '暂无已归档对话。'}
          </p>
        ) : (
          groups.map((group) => (
            <SettingsSection
              key={group.id}
              title={project === 'all' ? group.label : undefined}
              description={`${group.sessions.length} 个聊天`}
              actions={
                <Button color="danger" disabled={busy} onClick={() => setDeleting(group.sessions)}>
                  删除此组
                </Button>
              }
            >
              {group.sessions.map((session) => (
                <article
                  key={session.id}
                  className="tw:flex tw:items-center tw:gap-4 tw:py-3 tw:[&+&]:border-t tw:[&+&]:border-app-border-subtle"
                >
                  <div className="tw:min-w-0 tw:flex-1">
                    <h4 className="tw:m-0 tw:truncate tw:type-row-title tw:text-app-text">
                      {sessionDisplayTitle(session)}
                    </h4>
                    <p className="tw:m-0 tw:type-caption tw:text-app-text-meta">
                      {new Date(session.lastMessageAt ?? session.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <Button color="danger" disabled={busy} onClick={() => setDeleting([session])}>
                    删除
                  </Button>
                  <Button
                    color="secondary"
                    disabled={busy}
                    onClick={() => void restoreSession(session)}
                  >
                    取消归档
                  </Button>
                </article>
              ))}
            </SettingsSection>
          ))
        )}
        <ConfirmationDialog
          open={deleting !== null}
          title="删除归档聊天？"
          description={`将永久删除 ${deleting?.length ?? 0} 个本地归档聊天。${deleting === sessions ? '全部删除不受搜索和项目筛选限制。' : '仅删除这次选择的聊天。'}`}
          actionLabel="删除"
          tone="danger"
          actionDisabled={busy}
          onCancel={() => {
            if (!busy) setDeleting(null)
          }}
          onAction={() => void deleteSessions()}
        />
      </div>
    </SettingsContentArea>
  )
}
