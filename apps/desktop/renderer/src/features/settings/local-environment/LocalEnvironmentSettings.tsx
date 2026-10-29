import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnchoredPopover } from '../../../components/ui/AnchoredPopover.js'
import { Button } from '../../../components/ui/Button.js'
import { Select } from '../../../components/ui/Select.js'
import { SegmentedControl } from '../../../components/ui/SegmentedControl.js'
import { Ellipsis, Play, Pencil } from 'lucide-react'
import { ConfirmationDialog } from '../../../components/ui/ConfirmationDialog.js'
import { Textarea } from '../../../components/ui/Textarea.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import { PopoverItem } from '../../../components/ui/PopoverItem.js'
import { APP_ICON_SIZE } from '../../../components/ui/IconTokens.js'
import { Input } from '../../../components/ui/Input.js'
const ProjectEnvironments = React.lazy(() =>
  import('./LocalEnvironmentProjectSettings.js').then((module) => ({
    default: module.LocalEnvironmentProjectSettings,
  })),
)
import {
  environmentDomainClient,
  type EnvironmentReadResult,
} from '../../../services/desktop-client/EnvironmentDomainClient.js'
import { notifyProjectCatalogChanged } from '../../projects/ProjectCatalogEvents.js'
import { SettingsContentArea } from '../SettingsContentArea.js'
import { SettingsSection } from '../SettingsSection.js'
import { SettingsRow } from '../SettingsRow.js'
import {
  EMPTY_ENVIRONMENT_ACTION,
  buildEnvironmentConfigEdits,
  environmentActionsValue,
  type EnvironmentActionEditorValue,
  type EnvironmentPlatformCommand,
} from './LocalEnvironmentEditorModel.js'

type Props = {
  onError: (message: string) => void
  onNotice?: (message: string) => void
  projectId?: string
  environmentId?: string
  embedded?: boolean
  projectName?: string
  readOnly?: boolean
  onEdit?: () => void
  onDeleted?: () => void
  onSaved?: (environmentId?: string) => void
}
type PlatformCommand = EnvironmentPlatformCommand

export const WORKTREE_SETUP_VARIABLES = [
  {
    name: 'PIDEX_SOURCE_TREE_PATH',
    description: '源任务的权威工作区路径',
  },
  {
    name: 'PIDEX_WORKTREE_PATH',
    description: '新托管工作树的路径',
  },
] as const

export function LocalEnvironmentSettings({
  onError,
  onNotice,
  projectId,
  environmentId,
  embedded,
  onSaved,
  projectName,
  readOnly = false,
  onEdit,
  onDeleted,
}: Props): React.ReactNode {
  const [params] = useSearchParams()
  const threadId = params.get('threadId') ?? ''
  const newEnvironment = environmentId === 'new'
  const createdDraft = React.useRef<{ id: string; source: EnvironmentReadResult | null } | null>(
    null,
  )
  const client = React.useMemo(() => environmentDomainClient(), [])
  const [source, setSource] = React.useState<EnvironmentReadResult | null>(null)
  const [name, setName] = React.useState('')
  const [setup, setSetup] = React.useState<PlatformCommand>({ script: '' })
  const [cleanup, setCleanup] = React.useState<PlatformCommand>({ script: '' })
  const [actions, setActions] = React.useState<EnvironmentActionEditorValue[]>([])
  const [saving, setSaving] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [optionsOpen, setOptionsOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const Frame = embedded ? React.Fragment : SettingsContentArea

  const load = React.useCallback(async () => {
    if (!threadId && (!projectId || !environmentId)) return
    const targetId =
      newEnvironment && projectId
        ? (await client.listProjectEnvironments(projectId)).environments[0]?.id
        : environmentId
    const loaded =
      projectId && targetId
        ? await client.readProjectEnvironment(projectId, targetId)
        : await client.readEnvironment(threadId)
    const result = newEnvironment
      ? {
          ...loaded,
          exists: false,
          executionTrusted: false,
          config: { schema_version: 1, name: projectName ?? '', actions: [] },
        }
      : loaded
    setSource(result)
    setName(stringValue(result.config.name) || projectName || '')
    setSetup(commandValue(result.config.setup))
    setCleanup(commandValue(result.config.cleanup))
    setActions(environmentActionsValue(result.config.actions))
    setFailed(false)
  }, [client, threadId, projectId, environmentId, projectName, newEnvironment])

  React.useEffect(() => {
    void load().catch((cause) => {
      setFailed(true)
      onError(message(cause))
    })
  }, [load, onError])

  const save = async () => {
    if (!source) return
    setSaving(true)
    try {
      let savedId = environmentId
      let original = source
      if (newEnvironment && projectId) {
        if (!createdDraft.current)
          createdDraft.current = {
            id: (await client.createProjectEnvironment(projectId, name)).environmentId,
            source: null,
          }
        savedId = createdDraft.current.id
        createdDraft.current.source ??= await client.readProjectEnvironment(projectId, savedId)
        original = createdDraft.current.source
      }
      const edits = buildEnvironmentConfigEdits({
        original: original.config,
        name,
        setup,
        cleanup,
        actions,
      })
      if (projectId && savedId) {
        const result = await client.updateProjectEnvironment({
          projectId,
          environmentId: savedId,
          expectedRevision: original.revision,
          edits: edits.length ? edits : [{ keyPath: ['name'], value: name }],
        })
        savedId =
          (await client.listProjectEnvironments(projectId)).environments.find(
            (environment) => environment.path === result.filePath,
          )?.id ?? savedId
      } else await client.updateEnvironment({ threadId, expectedRevision: source.revision, edits })
      notifyProjectCatalogChanged()
      if (!newEnvironment && savedId === environmentId) await load()
      onSaved?.(savedId)
    } catch (cause) {
      setFailed(true)
      onError(message(cause))
    } finally {
      setSaving(false)
    }
  }

  if (!threadId && (!projectId || !environmentId))
    return (
      <SettingsContentArea>
        <div className="settings-content-inner tw:w-full tw:min-w-0 tw:mx-auto tw:p-5 tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]">
          <h2 className="tw:type-page-title">本地环境</h2>
          <React.Suspense fallback={<p>正在加载项目…</p>}>
            <ProjectEnvironments onError={onError} onNotice={onNotice} />
          </React.Suspense>
        </div>
      </SettingsContentArea>
    )
  if (!threadId && !projectId)
    return (
      <SettingsContentArea>
        <SettingsSection title="编辑本地环境" description="请从任务页打开环境设置。">
          <p className="settings-empty-copy">缺少 threadId，无法确定配置发现范围。</p>
        </SettingsSection>
      </SettingsContentArea>
    )
  if (!source)
    return (
      <SettingsContentArea>
        <p className="settings-empty-copy">{failed ? '环境配置读取失败' : '正在读取环境配置…'}</p>
        {failed && (
          <Button
            color="secondary"
            onClick={() => void load().catch((cause) => onError(message(cause)))}
          >
            重新读取
          </Button>
        )}
      </SettingsContentArea>
    )

  return (
    <Frame>
      <div className="tw:grid tw:gap-6">
        <header className="tw:flex tw:items-center tw:justify-between tw:gap-3">
          <h1 className="tw:m-0 tw:type-page-title tw:text-app-text">
            {readOnly ? projectName || name : '编辑本地环境'}
          </h1>
          <div className="tw:flex tw:items-center tw:gap-2">
            <PopoverMenu
              open={optionsOpen}
              onOpenChange={setOptionsOpen}
              trigger={
                <Button isIconOnly color="ghostSecondary" size="toolbar" title="环境选项">
                  <Ellipsis size={APP_ICON_SIZE} />
                </Button>
              }
              size="md"
              align="end"
            >
              {projectId && environmentId && source.exists ? (
                <PopoverItem
                  disabled={saving}
                  onClick={() =>
                    void client
                      .selectProjectEnvironment(projectId, environmentId)
                      .then(async () => {
                        notifyProjectCatalogChanged()
                        const selected = (await client.listProjectEnvironments(projectId))
                          .selectedEnvironmentId
                        if (selected) onSaved?.(selected)
                        onNotice?.('已设为项目默认环境')
                      })
                      .catch((cause) => onError(message(cause)))
                  }
                >
                  设为项目默认环境
                </PopoverItem>
              ) : null}
              {projectId && environmentId && source.exists && onDeleted ? (
                <PopoverItem disabled={saving} onClick={() => setDeleting(true)}>
                  删除环境
                </PopoverItem>
              ) : null}
            </PopoverMenu>
            {readOnly ? (
              <Button color="secondary" onClick={onEdit}>
                <Pencil size={APP_ICON_SIZE} />
                编辑
              </Button>
            ) : null}
          </div>
        </header>
        {!readOnly ? (
          <SettingsSection>
            <SettingsRow
              title="名称"
              variant="stacked"
              control={
                <Input
                  className="tw:w-full"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              }
            />
          </SettingsSection>
        ) : null}
        <SettingsSection
          bare
          title="设置脚本"
          description={readOnly ? '此脚本会在创建工作树时运行' : '创建工作树时在工作树目录下运行'}
          actions={<SetupVariablesPopover />}
        >
          {readOnly ? (
            <ScriptPreview value={setup} />
          ) : (
            <CommandRows label="设置脚本" value={setup} onChange={setSetup} />
          )}
        </SettingsSection>
        <SettingsSection bare title="清理脚本" description="清理工作树之前在工作树目录下运行">
          {readOnly ? (
            <ScriptPreview value={cleanup} />
          ) : (
            <CommandRows label="清理脚本" value={cleanup} onChange={setCleanup} />
          )}
        </SettingsSection>
        <SettingsSection
          bare
          title="操作"
          description="这些操作可运行任意命令，并显示在顶部栏中"
          actions={
            !readOnly ? (
              <Button
                color="secondary"
                disabled={saving}
                onClick={() =>
                  setActions((current) => [...current, { ...EMPTY_ENVIRONMENT_ACTION }])
                }
              >
                添加操作
              </Button>
            ) : undefined
          }
        >
          {readOnly ? (
            <div className="tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-panel tw:p-4">
              {actions.length ? (
                actions.map((action, index) => (
                  <div
                    key={index}
                    className="tw:flex tw:items-center tw:gap-3 tw:py-3 tw:[&+&]:border-t tw:[&+&]:border-app-border-subtle"
                  >
                    <Play size={APP_ICON_SIZE} />
                    <div className="tw:min-w-0">
                      <strong className="tw:type-row-title">{action.name}</strong>
                      <pre className="tw:m-0 tw:whitespace-pre-wrap tw:break-words tw:type-code tw:text-app-text-meta">
                        {resolvedCommand({
                          script: action.command,
                          windows: action.windows,
                          macos: action.macos,
                          linux: action.linux,
                        })}
                      </pre>
                    </div>
                  </div>
                ))
              ) : (
                <p className="tw:m-0 tw:py-4 tw:text-center tw:type-caption tw:text-app-text-meta">
                  添加操作，以便从本地工具栏运行命令
                </p>
              )}
            </div>
          ) : (
            <div className="tw:grid tw:gap-3">
              {actions.map((action, index) => (
                <article
                  className="settings-card tw:grid tw:gap-2 tw:p-3 tw:overflow-hidden tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-panel tw:shadow-none"
                  key={index}
                >
                  <div className="tw:flex tw:items-end tw:gap-3">
                    <label className="tw:grid tw:gap-1 tw:min-w-0 tw:flex-1">
                      <span className="tw:type-caption tw:text-app-text-soft">名称</span>
                      <Input
                        aria-label="操作名称"
                        value={action.name}
                        disabled={saving}
                        onChange={(event) =>
                          setActions((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, name: event.target.value } : item,
                            ),
                          )
                        }
                      />
                    </label>
                    <Select
                      ariaLabel="操作图标"
                      value={action.icon || 'tool'}
                      options={[
                        { value: 'tool', label: '工具' },
                        { value: 'run', label: '运行' },
                        { value: 'debug', label: '调试' },
                        { value: 'test', label: '测试' },
                      ]}
                      onValueChange={(icon) =>
                        setActions((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, icon } : item,
                          ),
                        )
                      }
                    />
                  </div>
                  <CommandRows
                    label="操作命令"
                    value={{
                      script: action.command,
                      windows: action.windows,
                      macos: action.macos,
                      linux: action.linux,
                    }}
                    onChange={(command) =>
                      setActions((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                command: command.script,
                                windows: command.windows ?? '',
                                macos: command.macos ?? '',
                                linux: command.linux ?? '',
                              }
                            : item,
                        ),
                      )
                    }
                  />
                  <div className="tw:flex tw:justify-end">
                    <Button
                      color="danger"
                      disabled={saving}
                      onClick={() =>
                        setActions((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      删除操作
                    </Button>
                  </div>
                </article>
              ))}
              {actions.length === 0 ? (
                <p className="settings-empty-copy">添加操作，以便从顶部栏运行命令。</p>
              ) : null}
            </div>
          )}
        </SettingsSection>
        {!readOnly ? (
          <>
            <div className="tw:flex tw:justify-end tw:py-4">
              <Button
                color="primary"
                loading={saving}
                disabled={
                  !name.trim() ||
                  actions.some(
                    (action) =>
                      !action.name.trim() ||
                      ![action.command, action.windows, action.macos, action.linux].some(
                        (command) => command.trim(),
                      ),
                  )
                }
                onClick={() => void save()}
              >
                保存
              </Button>
            </div>
          </>
        ) : null}
        {failed ? (
          <div role="alert" className="tw:flex tw:items-center tw:gap-2">
            <span>保存失败，已保留草稿。</span>
            <Button
              color="secondary"
              onClick={() => void load().catch((cause) => onError(message(cause)))}
            >
              重新读取并放弃修改
            </Button>
            <Button color="secondary" onClick={() => void save()}>
              重试保存
            </Button>
          </div>
        ) : null}
        <ConfirmationDialog
          open={deleting}
          title="删除环境？"
          description="默认环境或仍被工作树引用的环境不能删除。"
          actionLabel="删除"
          tone="danger"
          actionDisabled={saving}
          onCancel={() => setDeleting(false)}
          onAction={() => {
            if (!projectId || !environmentId) return
            setSaving(true)
            void client
              .deleteProjectEnvironment(projectId, environmentId, source.revision)
              .then(() => {
                notifyProjectCatalogChanged()
                setDeleting(false)
                onDeleted?.()
              })
              .catch((cause) => onError(message(cause)))
              .finally(() => setSaving(false))
          }}
        />
      </div>
    </Frame>
  )
}

function SetupVariablesPopover(): React.ReactNode {
  return (
    <AnchoredPopover
      align="end"
      arrow
      className="tw:grid tw:gap-3"
      collisionPadding={8}

      sideOffset={6}
      trigger={<Button color="secondary">变量</Button>}
      size="lg"
    >
      <div>
        <strong className="tw:type-control">设置脚本环境变量</strong>
        <p className="tw:type-caption tw:m-0 tw:mt-1 tw:text-app-text-soft">
          创建托管工作树时由 Agent 注入；这里只显示变量名，不显示路径值。
        </p>
      </div>
      {WORKTREE_SETUP_VARIABLES.map((variable) => (
        <EnvironmentVariable {...variable} key={variable.name} />
      ))}
    </AnchoredPopover>
  )
}

function EnvironmentVariable({
  description,
  name,
}: {
  description: string
  name: string
}): React.ReactNode {
  return (
    <div className="tw:grid tw:gap-1">
      <span className="tw:type-caption tw:text-app-text-soft">{description}</span>
      <code className="local-environment-code tw:bg-app-canvas tw:px-2 tw:py-1 tw:type-code">
        {name}
      </code>
    </div>
  )
}

function CommandRows({
  label,
  value,
  onChange,
}: {
  label: string
  value: PlatformCommand
  onChange: (value: PlatformCommand) => void
}) {
  const [platform, setPlatform] = React.useState<'script' | 'macos' | 'linux' | 'windows'>('script')
  return (
    <div className="tw:grid tw:gap-3">
      <SegmentedControl<'script' | 'macos' | 'linux' | 'windows'>
        ariaLabel={`${label}平台`}
        value={platform}
        options={[
          { value: 'script', label: '默认' },
          { value: 'macos', label: 'macOS' },
          { value: 'linux', label: 'Linux' },
          { value: 'windows', label: 'Windows' },
        ]}
        onChange={setPlatform}
      />
      <Textarea
        aria-label={`${label} ${platform}`}
        className="local-environment-code tw:w-full tw:min-w-0 tw:min-h-32 tw:type-code"
        value={value[platform] ?? ''}
        placeholder={platform === 'script' ? '输入命令…' : '留空时使用默认脚本'}
        onChange={(event) => onChange({ ...value, [platform]: event.target.value })}
      />
    </div>
  )
}

function commandValue(value: unknown): PlatformCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { script: '' }
  const record = value as Record<string, unknown>
  return {
    script: stringValue(record.script),
    ...optionalString('windows', record.windows),
    ...optionalString('macos', record.macos),
    ...optionalString('linux', record.linux),
  }
}
function optionalString<K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  return typeof value === 'string' ? ({ [key]: value } as Record<K, string>) : {}
}
function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}
function message(cause: unknown) {
  return cause instanceof Error ? cause.message : '环境配置操作失败。'
}

function resolvedCommand(value: PlatformCommand) {
  const platform = navigator.platform.toLowerCase()
  const override = platform.includes('win')
    ? value.windows
    : platform.includes('mac')
      ? value.macos
      : value.linux
  return override?.trim() ? override : value.script
}
function ScriptPreview({ value }: { value: PlatformCommand }) {
  return (
    <pre className="tw:m-0 tw:rounded-control tw:bg-app-control tw:p-3 tw:whitespace-pre-wrap tw:break-words tw:type-code tw:text-app-text">
      {resolvedCommand(value) || '未配置脚本'}
    </pre>
  )
}
