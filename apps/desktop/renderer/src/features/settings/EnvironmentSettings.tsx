import {
  ArrowLeft,
  ChevronRight,
  Eye,
  FilePlus2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type {
  DesktopProjectSource,
  DesktopProjectSourceReadResult,
  DesktopWorkspace,
} from '../../../shared/Types.js'
import { Button } from '../../components/ui/Button.js'

import { SearchInput } from '../../components/ui/SearchInput.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../components/ui/IconTokens.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { arrayBufferToBase64 } from '../../utils/BinaryEncoding.js'
import { cx } from '../../utils/Cx.js'
import { WorkspaceFileTree } from '../layout/WorkspaceFileTree.js'
import { PrimaryPageLayout } from '../layout/primary-page/index.js'
import { WorkspaceHeaderItem } from '../layout/workspace-header/index.js'
import {
  DEFAULT_PROJECT_APPEARANCE,
  PROJECT_APPEARANCE_COLOR_CLASS,
  PROJECT_APPEARANCE_MARKER_CLASS,
  ProjectAppearanceGlyph,
} from '../projects/ProjectAppearance.js'
import { notifyProjectCatalogChanged } from '../projects/ProjectCatalogEvents.js'
import { LocalEnvironmentProjectSettings } from './local-environment/LocalEnvironmentProjectSettings.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { SettingsSection } from './SettingsSection.js'
import { useDesktopSettings } from './UseDesktopSettings.js'
import {
  filterEnvironmentProjects,
  isProjectSettingsConflict,
  sortEnvironmentProjects,
} from './EnvironmentSettingsModel.js'
import { errorMessageOf as errorMessage } from '@pidex/shared/errors'

type Props = {
  onError: (message: string) => void
  onNotice?: (message: string) => void
  embedded?: boolean
}

export function EnvironmentSettings(props: Props): React.ReactNode {
  const [query] = useSearchParams()
  const { projectId: routeProjectId } = useParams<{ projectId?: string }>()
  const projectId = routeProjectId ?? (props.embedded ? query.get('projectId') : null)
  const location = useLocation()
  const routeBase = location.pathname.startsWith('/projects')
    ? '/projects'
    : '/settings/worktrees?tab=environments'
  return projectId ? (
    <EnvironmentDetail projectId={decodeURIComponent(projectId)} routeBase={routeBase} {...props} />
  ) : (
    <EnvironmentList routeBase={routeBase} {...props} />
  )
}

function EnvironmentList({
  onError,
  routeBase,
  embedded,
}: Props & { routeBase: string }): React.ReactNode {
  const navigate = useNavigate()
  const { projectAppearances } = useDesktopSettings()
  const [projects, setProjects] = useState<DesktopWorkspace[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setProjects(sortEnvironmentProjects(await desktopClient.listProjects()))
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [onError])

  useEffect(() => {
    void load()
  }, [load])

  const addProject = async (): Promise<void> => {
    if (adding) return
    setAdding(true)
    try {
      const project = await desktopClient.chooseWorkspace()
      if (project) notifyProjectCatalogChanged()
      if (project?.projectId) {
        navigate(projectSettingsRoute(routeBase, project.projectId))
      } else if (project) {
        onError('所选工作区未返回稳定的项目标识。')
      }
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      setAdding(false)
    }
  }

  const visibleProjects = filterEnvironmentProjects(projects, query)

  const projectRows = visibleProjects.map((project) => {
    const appearance = project.projectId
      ? (projectAppearances[project.projectId] ?? DEFAULT_PROJECT_APPEARANCE)
      : DEFAULT_PROJECT_APPEARANCE
    return (
      <button
        className={cx(
          'environment-project-row tw:grid tw:w-full tw:cursor-pointer tw:grid-cols-[auto_minmax(0,1fr)_auto_auto] tw:items-center tw:gap-3 tw:rounded-lg tw:px-4 tw:py-4 tw:text-left tw:text-app-text tw:shadow-none tw:[&>svg:last-child]:box-content tw:[&>svg:last-child]:rounded-md',
          routeBase === '/projects'
            ? 'tw:border-0 tw:bg-transparent tw:[&>svg:last-child]:bg-transparent tw:[&>svg:last-child]:p-0'
            : 'tw:border tw:border-app-border-subtle tw:bg-app-raised tw:hover:bg-app-hover tw:[&>svg:last-child]:bg-app-hover tw:[&>svg:last-child]:p-2',
        )}
        key={project.projectId ?? project.id ?? project.path}
        type="button"
        onClick={() => {
          if (!project.projectId) {
            onError('该项目缺少稳定的项目标识。')
            return
          }
          navigate(projectSettingsRoute(routeBase, project.projectId))
        }}
      >
        <span className="environment-project-icon tw:grid tw:size-8 tw:place-items-center tw:rounded-md tw:bg-app-hover tw:text-app-text-soft">
          <ProjectAppearanceGlyph
            appearance={appearance}
            className={cx(
              PROJECT_APPEARANCE_MARKER_CLASS,
              PROJECT_APPEARANCE_COLOR_CLASS[appearance.color] ?? 'tw:text-app-text-soft',
            )}
            size={APP_ICON_SIZE}
          />
        </span>
        <span className="environment-project-copy tw:grid tw:min-w-0 tw:gap-1 tw:[&>strong]:truncate tw:[&>strong]:type-row-title tw:[&>span]:truncate tw:[&>span]:text-app-text-soft tw:[&>span]:type-body-sm">
          <strong>{project.name}</strong>
          <span title={project.path}>{project.path}</span>
        </span>
        <span className="environment-project-meta tw:text-app-text-soft tw:type-body-sm tw:whitespace-nowrap tw:@max-[720px]:hidden">
          {project.folders?.length ?? 1} 个目录
        </span>
        <ChevronRight
          aria-hidden="true"
          size={APP_ICON_SIZES.sm}
          strokeWidth={APP_ICON_STROKE_WIDTH}
        />
      </button>
    )
  })

  const projectList = loading ? (
    <EnvironmentEmpty>正在载入项目…</EnvironmentEmpty>
  ) : projects.length === 0 ? (
    <EnvironmentEmpty>暂无项目。选择一个目录来创建或打开项目。</EnvironmentEmpty>
  ) : visibleProjects.length === 0 ? (
    <div className="environment-search-empty tw:flex tw:items-center tw:justify-between tw:gap-3 tw:text-app-text-soft tw:[&>p]:m-0">
      <p>未找到匹配“{query}”的项目。</p>
      <Button color="secondary" size="compact" onClick={() => setQuery('')}>
        清除搜索
      </Button>
    </div>
  ) : (
    <div className="environment-project-list tw:grid tw:gap-3">{projectRows}</div>
  )

  const projectSection = (
    <SettingsSection bare title="选择项目" description="最近打开的项目排在前面。">
      {projectList}
    </SettingsSection>
  )

  if (routeBase === '/projects') {
    return (
      <>
        <WorkspaceHeaderItem align="end" id="projects.add" order={100} slot="right">
          <Button color="primary" loading={adding} onClick={() => void addProject()}>
            <Plus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            添加项目
          </Button>
        </WorkspaceHeaderItem>
        <PrimaryPageLayout
          className="projects-primary-page"
          description="管理项目环境、项目指令和共享来源。"
          search={
            <SearchInput
              aria-label="搜索项目"
              onChange={setQuery}
              placeholder="搜索项目名称或路径…"
              value={query}
            />
          }
          title="项目"
        >
          <div className="environment-settings environment-primary-content tw:min-h-0 tw:min-w-0">
            {loading ? (
              <div className="environment-primary-empty tw:flex tw:min-h-64 tw:flex-col tw:items-center tw:justify-center tw:gap-2 tw:text-center tw:text-app-text-soft tw:[&>h2]:m-0 tw:[&>h2]:text-app-text tw:[&>h2]:type-title-sm tw:[&>p]:m-0 tw:[&>p]:type-body">
                正在载入项目…
              </div>
            ) : projects.length === 0 ? (
              <div className="environment-primary-empty tw:flex tw:min-h-64 tw:flex-col tw:items-center tw:justify-center tw:gap-2 tw:text-center tw:text-app-text-soft tw:[&>h2]:m-0 tw:[&>h2]:text-app-text tw:[&>h2]:type-title-sm tw:[&>p]:m-0 tw:[&>p]:type-body">
                <h2>暂无项目</h2>
                <p>添加一个本地目录，开始管理项目环境与默认设置。</p>
                <Button color="secondary" onClick={() => void addProject()}>
                  添加项目
                </Button>
              </div>
            ) : visibleProjects.length === 0 ? (
              <div className="environment-primary-empty tw:flex tw:min-h-64 tw:flex-col tw:items-center tw:justify-center tw:gap-2 tw:text-center tw:text-app-text-soft tw:[&>h2]:m-0 tw:[&>h2]:text-app-text tw:[&>h2]:type-title-sm tw:[&>p]:m-0 tw:[&>p]:type-body">
                <h2>未找到项目</h2>
                <p>没有与“{query}”匹配的项目。</p>
                <Button color="secondary" size="compact" onClick={() => setQuery('')}>
                  清除搜索
                </Button>
              </div>
            ) : (
              <div className="environment-primary-projects tw:@container">
                <div
                  className="environment-primary-projects__header tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:gap-4 tw:border-b tw:border-b-app-border-subtle tw:px-3 tw:py-2 tw:text-app-text-meta tw:type-caption"
                  aria-hidden="true"
                >
                  <span>项目</span>
                  <span>目录</span>
                </div>
                <div className="environment-project-list tw:grid">{projectRows}</div>
              </div>
            )}
          </div>
        </PrimaryPageLayout>
      </>
    )
  }

  return (
    <EnvironmentFrame embedded={embedded}>
      <div
        className={`settings-content-inner environment-settings tw:@container tw:w-full tw:min-w-0 tw:mx-auto ${embedded ? '' : 'tw:p-5 tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]'} tw:[&_.settings-section-content]:overflow-visible`}
      >
        {!embedded ? (
          <header className="settings-page-header environment-page-heading tw:mt-0 tw:mx-0 tw:mb-8 tw:flex tw:items-start tw:justify-between tw:gap-5 tw:[&>div]:min-w-0 tw:@max-[720px]:flex-col">
            <div>
              <h1 className="settings-page-title tw:m-0 tw:type-title-xl tw:text-app-text tw:tracking-[-0.01em]">
                环境
              </h1>
              <p className="settings-page-desc tw:m-0 tw:max-w-[68ch] tw:text-app-text-soft tw:type-body-sm">
                管理项目的项目指令和共享来源。
              </p>
            </div>
          </header>
        ) : null}

        <SettingsSection
          actions={
            <Button color="primary" loading={adding} onClick={() => void addProject()}>
              <Plus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              添加项目
            </Button>
          }
          bare
          title="选择项目"
          description="最近打开的项目排在前面。"
        >
          {projectList}
        </SettingsSection>
      </div>
    </EnvironmentFrame>
  )
}

function EnvironmentDetail({
  projectId,
  routeBase,
  embedded,
  onError,
  onNotice,
}: Props & { projectId: string; routeBase: string }): React.ReactNode {
  const navigate = useNavigate()
  const uploadRef = useRef<HTMLInputElement | null>(null)
  const [project, setProject] = useState<DesktopWorkspace | null>(null)
  const [draftName, setDraftName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [executionEnvironment, setExecutionEnvironment] = useState<'auto' | 'local'>('auto')
  const [sources, setSources] = useState<DesktopProjectSource[]>([])
  const [sourceFolderId, setSourceFolderId] = useState('')
  const [sourcePath, setSourcePath] = useState('')
  const [relinkSourceId, setRelinkSourceId] = useState<string | null>(null)
  const [preview, setPreview] = useState<DesktopProjectSourceReadResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const loadProject = useCallback(
    async (preserveDraft: boolean): Promise<DesktopWorkspace | null> => {
      const projects = await desktopClient.listProjects()
      const next = projects.find((item) => item.projectId === projectId) ?? null
      setProject(next)
      if (next && !preserveDraft) {
        setDraftName(next.name)
        setInstructions(next.projectSettings?.instructions ?? '')
        setExecutionEnvironment(next.projectSettings?.executionEnvironment ?? 'auto')
        setSourceFolderId(next.primaryFolderId ?? next.folders?.[0]?.id ?? '')
        setRelinkSourceId(null)
      }
      return next
    },
    [projectId],
  )

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const next = await loadProject(false)
      if (next) {
        setSources(await desktopClient.listProjectSources(projectId))
      }
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [loadProject, onError, projectId])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (key: string, action: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(key)
    try {
      await action()
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const saveProject = async (): Promise<void> => {
    if (!project || busy) return
    const name = draftName.trim()
    if (!name) {
      onError('项目名称不能为空。')
      return
    }
    setBusy('save')
    try {
      let next = project
      if (name !== project.name) {
        next = await desktopClient.updateProject({
          projectId,
          name,
          expectedVersion: project.projectVersion ?? 0,
        })
      }
      const currentExecution = next.projectSettings?.executionEnvironment ?? 'auto'
      if (
        instructions !== (next.projectSettings?.instructions ?? '') ||
        executionEnvironment !== currentExecution
      ) {
        next = await desktopClient.updateProjectSettings({
          projectId,
          instructions,
          executionEnvironment,
          expectedVersion: next.projectSettings?.version ?? 0,
        })
      }
      setProject(next)
      setDraftName(next.name)
      setInstructions(next.projectSettings?.instructions ?? '')
      setExecutionEnvironment(next.projectSettings?.executionEnvironment ?? 'auto')
      notifyProjectCatalogChanged()
      onNotice?.('项目设置已保存。')
    } catch (error) {
      notifyProjectCatalogChanged()
      if (isProjectSettingsConflict(error)) {
        try {
          await loadProject(true)
        } catch (refreshError) {
          onError(errorMessage(refreshError))
          return
        }
        onNotice?.('项目已在其他窗口更新。已刷新版本，请确认当前内容后重试。')
      } else {
        onError(errorMessage(error))
      }
    } finally {
      setBusy(null)
    }
  }

  const importFiles = async (files: FileList | null): Promise<void> => {
    if (!files?.length) return
    const selected = [...files].slice(0, 8)
    await run('upload', async () => {
      const uploads = await Promise.all(
        selected.map(async (file) => {
          const isImage = file.type.startsWith('image/')
          return {
            kind: isImage ? ('image' as const) : ('text' as const),
            name: file.name,
            mediaType: file.type || (isImage ? 'image/png' : 'text/plain'),
            encoding: isImage ? ('base64' as const) : ('utf8' as const),
            data: isImage ? arrayBufferToBase64(await file.arrayBuffer()) : await file.text(),
          }
        }),
      )
      setSources(await desktopClient.importProjectSources(projectId, uploads))
      onNotice?.(`已导入 ${uploads.length} 个共享来源。`)
    })
  }

  const addReference = async (): Promise<void> => {
    if (!sourceFolderId || !sourcePath.trim()) return
    await run('reference', async () => {
      const relinking = sources.find((source) => source.id === relinkSourceId)
      if (
        relinking?.storage === 'workspace-file' &&
        relinking.folderId === sourceFolderId &&
        relinking.path === sourcePath.trim()
      ) {
        throw new Error('重新关联时请选择不同的目录或相对路径。')
      }
      await desktopClient.addProjectSourceReference(projectId, sourceFolderId, sourcePath.trim())
      if (relinkSourceId) {
        await desktopClient.removeProjectSource(projectId, relinkSourceId)
      }
      setSources(await desktopClient.listProjectSources(projectId))
      setSourcePath('')
      setRelinkSourceId(null)
      onNotice?.(relinkSourceId ? '共享来源已重新关联。' : '工作区文件已添加为共享来源。')
    })
  }

  const previewSource = async (source: DesktopProjectSource): Promise<void> => {
    if (source.status !== 'available') return
    await run(`preview:${source.id}`, async () => {
      setPreview(
        await desktopClient.readProjectSource(
          projectId,
          source.id,
          source.kind === 'text' ? { offset: 0, length: 64 * 1024 } : undefined,
        ),
      )
    })
  }

  if (loading) {
    return (
      <EnvironmentFrame embedded={embedded}>
        <div
          className={`settings-content-inner environment-settings tw:@container tw:w-full tw:min-w-0 tw:mx-auto ${embedded ? '' : 'tw:p-5 tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]'} tw:[&_.settings-section-content]:overflow-visible`}
        >
          <EnvironmentEmpty>正在载入项目环境…</EnvironmentEmpty>
        </div>
      </EnvironmentFrame>
    )
  }

  if (!project) {
    return (
      <EnvironmentFrame embedded={embedded}>
        <div
          className={`settings-content-inner environment-settings tw:@container tw:w-full tw:min-w-0 tw:mx-auto ${embedded ? '' : 'tw:p-5 tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]'} tw:[&_.settings-section-content]:overflow-visible`}
        >
          <button
            className="environment-breadcrumb tw:mt-0 tw:mr-0 tw:mb-5 tw:ml-0 tw:inline-flex tw:cursor-pointer tw:items-center tw:gap-2 tw:max-w-full tw:border-0 tw:bg-transparent tw:p-0 tw:text-app-text-soft tw:hover:text-app-text tw:[&>span]:truncate tw:[&>span]:text-app-text"
            type="button"
            onClick={() => navigate(routeBase)}
          >
            <ArrowLeft size={APP_ICON_SIZE} />
            返回环境
          </button>
          <EnvironmentEmpty>项目不存在、已移除或当前不可用。</EnvironmentEmpty>
        </div>
      </EnvironmentFrame>
    )
  }

  if (embedded)
    return (
      <div className="tw:grid tw:gap-5">
        <Button color="ghostSecondary" onClick={() => navigate(routeBase)}>
          返回环境列表 · {project.name}
        </Button>
        <LocalEnvironmentProjectSettings
          onlyProjectId={projectId}
          onError={onError}
          onNotice={onNotice}
        />
        <Button
          color="secondary"
          onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}`)}
        >
          项目指令与共享来源
        </Button>
      </div>
    )

  return (
    <EnvironmentFrame embedded={embedded}>
      <div
        className={`settings-content-inner environment-settings tw:@container tw:w-full tw:min-w-0 tw:mx-auto ${embedded ? '' : 'tw:p-5 tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]'} tw:[&_.settings-section-content]:overflow-visible`}
      >
        <button
          className="environment-breadcrumb tw:mt-0 tw:mr-0 tw:mb-5 tw:ml-0 tw:inline-flex tw:cursor-pointer tw:items-center tw:gap-2 tw:max-w-full tw:border-0 tw:bg-transparent tw:p-0 tw:text-app-text-soft tw:hover:text-app-text tw:[&>span]:truncate tw:[&>span]:text-app-text"
          type="button"
          onClick={() => navigate(routeBase)}
        >
          <ArrowLeft size={APP_ICON_SIZE} />
          环境
          <ChevronRight aria-hidden="true" size={APP_ICON_SIZES.sm} />
          <span>{project.name}</span>
          <ChevronRight aria-hidden="true" size={APP_ICON_SIZES.sm} />
          <span>编辑</span>
        </button>

        <header className="settings-page-header environment-page-heading tw:mt-0 tw:mx-0 tw:mb-8 tw:flex tw:items-start tw:justify-between tw:gap-5 tw:[&>div]:min-w-0 tw:@max-[720px]:flex-col">
          <div>
            <h1 className="settings-page-title tw:m-0 tw:type-title-xl tw:text-app-text tw:tracking-[-0.01em]">
              项目环境
            </h1>
            <p
              className="settings-page-desc tw:m-0 tw:max-w-[68ch] tw:text-app-text-soft tw:type-body-sm"
              title={project.path}
            >
              {project.path}
            </p>
          </div>
          <Button color="primary" loading={busy === 'save'} onClick={() => void saveProject()}>
            保存更改
          </Button>
        </header>

        <SettingsSection title="基本信息" description="名称与项目任务的共享指令一起保存。">
          <label className="environment-field">
            <span>项目名称</span>
            <input
              maxLength={120}
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
            />
          </label>
          <div className="environment-field">
            <span>任务执行环境</span>
            <small>仅影响该项目之后新建的任务；已有任务保持创建时的执行环境不变。</small>
            <SettingsDropdown
              ariaLabel="任务执行环境"
              options={[
                { value: 'auto', label: '自动（推荐）' },
                { value: 'local', label: '本地目录' },
              ]}
              showSelectedIndicator
              triggerClassName="environment-settings-dropdown tw:w-full tw:bg-app-canvas"
              value={executionEnvironment}
              size="md"
              onChange={(value) => setExecutionEnvironment(value === 'local' ? 'local' : 'auto')}
            />
          </div>
          <label className="environment-field environment-field-textarea">
            <span>项目指令</span>
            <small>应用于该项目的每个新轮次；AGENTS、Skills 与配置仍只从主目录发现。</small>
            <textarea
              rows={9}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </label>
        </SettingsSection>

        <SettingsSection
          title="共享来源"
          description="来源操作立即生效，不需要点击页面顶部的保存。"
          actions={
            <>
              <input
                hidden
                multiple
                ref={uploadRef}
                type="file"
                onChange={(event) => {
                  void importFiles(event.currentTarget.files)
                  event.currentTarget.value = ''
                }}
              />
              <Button
                color="primary"
                loading={busy === 'upload'}
                onClick={() => uploadRef.current?.click()}
              >
                <Upload size={APP_ICON_SIZE} />
                上传来源
              </Button>
            </>
          }
        >
          <div className="environment-source-file-tree">
            <WorkspaceFileTree
              files={[]}
              searchable={false}
              workspace={project}
              onOpenFile={(file) => {
                if (file.type !== 'file' || !file.folderId) return
                setSourceFolderId(file.folderId)
                setSourcePath(file.path)
              }}
            />
          </div>
          <div className="environment-source-reference">
            <SettingsDropdown
              ariaLabel="来源所属目录"

              options={(project.folders ?? []).map((folder) => ({
                value: folder.id,
                label: `${folder.name}${folder.role === 'primary' ? '（主目录）' : ''}`,
              }))}
              showSelectedIndicator
              triggerClassName="environment-settings-dropdown tw:w-full tw:bg-app-canvas"
              value={sourceFolderId}
              size="md"
              onChange={setSourceFolderId}
            />
            <input
              aria-label="工作区文件相对路径"
              placeholder="docs/overview.md"
              value={sourcePath}
              onChange={(event) => setSourcePath(event.target.value)}
            />
            <Button
              color="primary"
              disabled={busy !== null || !sourcePath.trim()}
              onClick={() => void addReference()}
            >
              <FilePlus2 size={APP_ICON_SIZE} />
              {relinkSourceId ? '重新关联' : '添加文件'}
            </Button>
            {relinkSourceId ? (
              <Button
                color="secondary"
                disabled={busy !== null}
                onClick={() => {
                  setRelinkSourceId(null)
                  setSourcePath('')
                }}
              >
                取消
              </Button>
            ) : null}
          </div>

          {sources.length === 0 ? (
            <EnvironmentEmpty>暂无共享来源。</EnvironmentEmpty>
          ) : (
            <div className="environment-source-list tw:grid">
              {sources.map((source) => (
                <div className="environment-source-row" key={source.id}>
                  <div>
                    <strong>{source.name}</strong>
                    <span>{source.storage === 'managed' ? '托管文件' : source.path}</span>
                  </div>
                  <span
                    className="environment-source-status tw:whitespace-nowrap tw:text-app-text-soft tw:type-caption tw:[&:not([data-status=available])]:text-app-danger"
                    data-status={source.status}
                  >
                    {sourceStatusLabel(source.status)}
                  </span>
                  <Button
                    isIconOnly
                    color="ghostSecondary"
                    disabled={busy !== null || source.status !== 'available'}
                    size="toolbar"
                    title={`预览来源 ${source.name}`}
                    type="button"
                    onClick={() => void previewSource(source)}
                  >
                    <Eye size={APP_ICON_SIZE} />
                  </Button>
                  <Button
                    isIconOnly
                    color="ghostSecondary"
                    disabled={
                      busy !== null ||
                      source.storage !== 'workspace-file' ||
                      source.status === 'available'
                    }
                    hidden={source.storage !== 'workspace-file' || source.status === 'available'}
                    size="toolbar"
                    title={`重新关联来源 ${source.name}`}
                    type="button"
                    onClick={() => {
                      if (source.storage !== 'workspace-file') return
                      setRelinkSourceId(source.id)
                      setSourceFolderId(source.folderId)
                      setSourcePath(source.path)
                    }}
                  >
                    <RefreshCw size={APP_ICON_SIZE} />
                  </Button>
                  <Button
                    isIconOnly
                    color="ghostSecondary"
                    disabled={busy !== null}
                    size="toolbar"
                    title={`移除来源 ${source.name}`}
                    type="button"
                    onClick={() =>
                      void run(`remove:${source.id}`, async () => {
                        if (await desktopClient.removeProjectSource(projectId, source.id)) {
                          setSources((current) => current.filter((item) => item.id !== source.id))
                          if (preview?.source.id === source.id) setPreview(null)
                          onNotice?.('共享来源已移除。')
                        }
                      })
                    }
                  >
                    <Trash2 size={APP_ICON_SIZE} />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {preview ? (
            <div className="environment-source-preview">
              <header>
                <strong>{preview.source.name}</strong>
                <Button
                  isIconOnly
                  color="ghostSecondary"
                  size="toolbar"
                  title="关闭来源预览"
                  type="button"
                  onClick={() => setPreview(null)}
                >
                  <X size={APP_ICON_SIZE} />
                </Button>
              </header>
              {preview.encoding === 'base64' ? (
                <img
                  alt={preview.source.name}
                  src={`data:${sourceMediaType(preview.source)};base64,${preview.data}`}
                />
              ) : (
                <pre>{preview.data}</pre>
              )}
              {preview.range.length < preview.range.total ? (
                <small>
                  仅预览前 {preview.range.length} / {preview.range.total} 字节
                </small>
              ) : null}
            </div>
          ) : null}
        </SettingsSection>
      </div>
    </EnvironmentFrame>
  )
}

function EnvironmentEmpty({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <p className="environment-empty tw:m-0 tw:px-4 tw:py-6 tw:text-center tw:text-app-text-soft tw:type-body-sm">
      {children}
    </p>
  )
}

function sourceStatusLabel(status: DesktopProjectSource['status']): string {
  if (status === 'available') return '可用'
  if (status === 'missing') return '文件缺失'
  if (status === 'denied') return '拒绝访问'
  return '不支持'
}

function sourceMediaType(source: DesktopProjectSource): string {
  if (source.storage === 'managed') return source.mediaType
  const extension = source.path.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'webp') return 'image/webp'
  return 'image/png'
}

function projectSettingsRoute(base: string, projectId: string) {
  return base === '/projects'
    ? `${base}/${encodeURIComponent(projectId)}`
    : `${base}&projectId=${encodeURIComponent(projectId)}`
}
function EnvironmentFrame({
  embedded,
  children,
}: {
  embedded?: boolean
  children: React.ReactNode
}) {
  return embedded ? <>{children}</> : <SettingsContentArea>{children}</SettingsContentArea>
}
