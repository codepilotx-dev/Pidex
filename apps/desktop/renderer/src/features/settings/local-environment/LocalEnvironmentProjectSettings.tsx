import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, Folder, Plus } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import type { RpcResult } from '@pidex/agent-protocol'
import type { DesktopWorkspace } from '../../../../shared/Types.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { environmentDomainClient } from '../../../services/desktop-client/EnvironmentDomainClient.js'
import { Button } from '../../../components/ui/Button.js'
import { APP_ICON_SIZE } from '../../../components/ui/IconTokens.js'
import { LocalEnvironmentSettings } from './LocalEnvironmentSettings.js'

type Props = {
  onlyProjectId?: string
  onError: (message: string) => void
  onNotice?: (message: string) => void
}
type Catalog = RpcResult<'local-environment/project/list'>

export function LocalEnvironmentProjectSettings({
  onError,
  onNotice,
  onlyProjectId,
}: Props): ReactNode {
  const [params, setParams] = useSearchParams()
  const [projects, setProjects] = useState<DesktopWorkspace[]>([])
  const [loading, setLoading] = useState(true)
  const projectId = params.get('projectId') ?? onlyProjectId
  const environmentId = params.get('environmentId')
  const editing = params.get('mode') === 'edit'
  const client = useMemo(() => environmentDomainClient(), [])
  const threadId = params.get('threadId')
  useEffect(() => {
    if (!threadId) return
    let active = true
    void client
      .projectForThread(threadId)
      .then((id) => {
        if (!active) return
        if (!id) throw new Error('当前聊天未关联项目，请从项目列表配置环境。')
        setParams((current) => {
          current.delete('threadId')
          current.set('projectId', id)
          return current
        })
      })
      .catch((cause) => onError(message(cause)))
    return () => {
      active = false
    }
  }, [client, threadId, setParams, onError])
  useEffect(() => {
    if (!projectId || environmentId || threadId) return
    let active = true
    void client
      .listProjectEnvironments(projectId)
      .then((catalog) => {
        if (!active) return
        const selected =
          catalog.environments.find((item) => item.id === catalog.selectedEnvironmentId) ??
          catalog.environments[0]
        if (!selected) throw new Error('项目环境不可用')
        setParams((current) => {
          current.set('environmentId', selected.id)
          if (!selected.exists) current.set('mode', 'edit')
          return current
        })
      })
      .catch((cause) => onError(message(cause)))
    return () => {
      active = false
    }
  }, [client, projectId, environmentId, threadId, setParams, onError])
  const project = projects.find((item) => item.projectId === projectId)
  const load = useCallback(async () => {
    try {
      setProjects(await desktopClient.listProjects())
    } catch (cause) {
      onError(message(cause))
    } finally {
      setLoading(false)
    }
  }, [onError])
  useEffect(() => {
    void load()
  }, [load])
  const open = (id: string, environment: string, edit: boolean) =>
    setParams((current) => {
      current.set('tab', 'environments')
      current.set('projectId', id)
      current.set('environmentId', environment)
      if (edit) current.set('mode', 'edit')
      else current.delete('mode')
      return current
    })
  if (loading || threadId || (projectId && !environmentId))
    return <p role="status">正在加载项目…</p>
  if (projectId && environmentId && project)
    return (
      <div className="tw:grid tw:gap-8">
        <nav
          aria-label="环境面包屑"
          className="tw:flex tw:items-center tw:gap-2 tw:type-caption tw:text-app-text-meta"
        >
          <Button
            color="ghostSecondary"
            size="toolbar"
            onClick={() => setParams({ tab: 'environments' })}
          >
            环境
          </Button>
          <ChevronRight aria-hidden="true" size={APP_ICON_SIZE} />
          <Button
            color="ghostSecondary"
            size="toolbar"
            onClick={() => open(projectId, environmentId, false)}
          >
            {project.name}
          </Button>
          {editing ? (
            <>
              <ChevronRight aria-hidden="true" size={APP_ICON_SIZE} />
              <span className="tw:text-app-text">编辑</span>
            </>
          ) : null}
        </nav>
        <LocalEnvironmentSettings
          key={`${projectId}:${environmentId}:${editing}`}
          projectId={projectId}
          environmentId={environmentId}
          projectName={project.name}
          readOnly={!editing}
          onEdit={() => open(projectId, environmentId, true)}
          onDeleted={() => setParams({ tab: 'environments' })}
          onSaved={(savedId) => open(projectId, savedId ?? environmentId, false)}
          embedded
          onError={onError}
          onNotice={onNotice}
        />
      </div>
    )
  return (
    <div className="tw:grid tw:gap-3">
      <header className="tw:flex tw:items-center tw:justify-between tw:gap-3">
        <h3 className="tw:m-0 tw:type-row-title tw:text-app-text">选择项目</h3>
        <Button
          color="secondary"
          onClick={() =>
            void desktopClient
              .chooseWorkspace()
              .then(() => load())
              .catch((cause) => onError(message(cause)))
          }
        >
          添加项目
        </Button>
      </header>
      {projects
        .filter((item) => item.projectId && (!onlyProjectId || item.projectId === onlyProjectId))
        .map((item) => (
          <ProjectCard key={item.projectId} project={item} onOpen={open} onError={onError} />
        ))}
      {!projects.length ? <p>暂无项目。</p> : null}
    </div>
  )
}

function ProjectCard({
  project,
  onOpen,
  onError,
}: {
  project: DesktopWorkspace
  onOpen: (projectId: string, environmentId: string, edit: boolean) => void
  onError: (message: string) => void
}) {
  const client = useMemo(() => environmentDomainClient(), [])
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const projectId = project.projectId!
  const refresh = useCallback(async () => {
    try {
      setCatalog(await client.listProjectEnvironments(projectId))
      setError(null)
    } catch (cause) {
      setError(message(cause))
    }
  }, [client, projectId])
  useEffect(() => {
    void refresh()
  }, [refresh])
  const defaultEnvironment =
    catalog?.environments.find((item) => item.id === catalog.selectedEnvironmentId) ??
    catalog?.environments[0]
  const add = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (defaultEnvironment && !defaultEnvironment.exists)
        onOpen(projectId, defaultEnvironment.id, true)
      else onOpen(projectId, 'new', true)
    } catch (cause) {
      onError(message(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <article className="tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-panel tw:p-4">
      <div className="tw:flex tw:items-center tw:gap-3">
        <button
          type="button"
          disabled={!defaultEnvironment || busy}
          className="tw:flex tw:min-w-0 tw:flex-1 tw:cursor-pointer tw:items-center tw:gap-3 tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:text-app-text tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus"
          onClick={() =>
            defaultEnvironment &&
            onOpen(projectId, defaultEnvironment.id, !defaultEnvironment.exists)
          }
        >
          <Folder aria-hidden="true" size={APP_ICON_SIZE} />
          <span className="tw:min-w-0 tw:type-row-title">
            {project.name}
            <span className="tw:block tw:truncate tw:type-caption tw:text-app-text-meta">
              {project.path}
            </span>
          </span>
        </button>
        <Button
          isIconOnly
          color="secondary"
          size="toolbar"
          title="添加环境"
          disabled={busy || !catalog}
          onClick={() => void add()}
        >
          <Plus size={APP_ICON_SIZE} />
        </Button>
      </div>
      {catalog?.environments
        .filter((item) => item.exists)
        .map((item) => (
          <button
            key={item.id}
            type="button"
            className="tw:mt-3 tw:flex tw:w-full tw:cursor-pointer tw:items-center tw:justify-between tw:gap-3 tw:border-0 tw:border-t tw:border-app-border-subtle tw:bg-transparent tw:pt-3 tw:text-left tw:text-app-text tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus"
            onClick={() => onOpen(projectId, item.id, false)}
          >
            <span className="tw:min-w-0 tw:type-row-title">
              {item.name}
              <span className="tw:block tw:truncate tw:type-caption tw:text-app-text-meta">
                {item.inherited ? '继承 · ' : ''}
                {item.path.split(/[\\/]/).pop()}
              </span>
            </span>
            <ChevronRight size={APP_ICON_SIZE} />
          </button>
        ))}
      {error ? (
        <div role="alert" className="tw:mt-3 tw:type-caption tw:text-app-danger">
          {error}
          <Button color="ghostSecondary" size="toolbar" onClick={() => void refresh()}>
            重试
          </Button>
        </div>
      ) : null}
    </article>
  )
}
function message(cause: unknown) {
  return cause instanceof Error ? cause.message : '环境操作失败'
}
