import React, { useEffect, useState } from 'react'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { APP_ICON_SIZE } from '../../components/ui/IconTokens.js'
import { CONFIG_UPDATED_EVENT, desktopClient } from '../../services/desktop-client/index.js'
import { useDesktopSettings } from './UseDesktopSettings.js'
import {
  PERMISSION_MODE_OPTIONS,
  permissionConfigForMode,
  permissionModeForConfig,
} from './SettingsStorage.js'
import type {
  DesktopConfigReadResult,
  DesktopConfigProfileListResult,
  DesktopDataLocationState,
  DesktopShellSecurityLevel,
} from '../../../shared/Types.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { SpecializedModelSelect } from './SpecializedModelSelect.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { Button } from '../../components/ui/Button.js'

export function ConfigSettings(): React.ReactNode {
  const settings = useDesktopSettings()
  const { draft } = settings
  const [dataLocation, setDataLocation] = useState<DesktopDataLocationState | null>(null)
  const [changingLocation, setChangingLocation] = useState(false)
  const [promptPreview, setPromptPreview] = useState<string | null>(null)
  const [configRead, setConfigRead] = useState<DesktopConfigReadResult | null>(null)
  const [configLayer, setConfigLayer] = useState<'user' | 'profile' | 'project'>('user')
  const [configProfiles, setConfigProfiles] = useState<DesktopConfigProfileListResult | null>(null)
  const configCwd = draft.values.lastActiveWorkspacePath || undefined

  const readConfigState = async () => {
    const read = await desktopClient.readConfig({
      includeLayers: true,
      ...(configCwd ? { cwd: configCwd } : {}),
    })
    const profiles = await desktopClient.listConfigProfiles().catch(() => null)
    return { read, profiles }
  }

  const reloadConfig = async () => {
    const { read, profiles } = await readConfigState()
    setConfigRead(read)
    setConfigProfiles(profiles)
    if (configLayer === 'project' && !read.layers?.some((layer) => layer.kind === 'project')) {
      setConfigLayer('user')
    }
    if (configLayer === 'profile' && !read.layers?.some((layer) => layer.kind === 'profile')) {
      setConfigLayer('user')
    }
  }

  useEffect(() => {
    let mounted = true
    void readConfigState()
      .then(({ read, profiles }) => {
        if (mounted) {
          setConfigRead(read)
          setConfigProfiles(profiles)
        }
      })
      .catch(() => {
        if (mounted) {
          setConfigRead(null)
        }
      })
    return () => {
      mounted = false
    }
  }, [configCwd])

  useEffect(() => {
    const refresh = () => void reloadConfig().catch(() => undefined)
    window.addEventListener(CONFIG_UPDATED_EVENT, refresh)
    return () => window.removeEventListener(CONFIG_UPDATED_EVENT, refresh)
  })

  const selectedConfigLayer = configRead?.layers?.find((layer) => layer.kind === configLayer)

  useEffect(() => {
    let mounted = true
    void desktopClient
      .getDataLocation()
      .then((state) => {
        if (mounted) setDataLocation(state)
      })
      .catch(() => {
        if (mounted) setDataLocation(null)
      })
    return () => {
      mounted = false
    }
  }, [])

  const handleChooseDataLocation = async (): Promise<void> => {
    if (changingLocation) return
    setChangingLocation(true)
    try {
      const result = await desktopClient.chooseDataLocation()
      if (result) {
        const newState = await desktopClient.getDataLocation()
        setDataLocation(newState)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`更改数据位置失败：${message}`)
    } finally {
      setChangingLocation(false)
    }
  }

  return (
    <SettingsContentArea className="">
      <div className="settings-content-inner tw:@container tw:w-full tw:min-w-0 tw:mx-auto tw:p-5 tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]">
        <div className="settings-page-header tw:mt-0 tw:mx-0 tw:mb-8 tw:grid tw:gap-2">
          <h2 className="settings-page-title tw:m-0 tw:type-title-xl tw:text-app-text tw:tracking-[-0.01em]">
            配置
          </h2>
          <p className="settings-page-desc tw:m-0 tw:max-w-[68ch] tw:text-app-text-soft tw:type-body-sm">
            配置审批策略和命令执行范围。
          </p>
        </div>

        <SettingsSection>
          <SettingsSection.Header
            title="智能体默认设置"
            description="配置权限预设、工具范围、Shell 风险处理和审批方式。"
          />
          <div className="config-settings-source-toolbar tw:mb-3 tw:flex tw:min-w-0 tw:items-center tw:justify-between tw:gap-3 tw:max-[600px]:flex-col tw:max-[600px]:items-start">
            <div className="config-settings-source-controls tw:flex tw:min-w-0 tw:items-center tw:gap-2 tw:max-[600px]:w-full tw:max-[600px]:flex-wrap">
              <SettingsDropdown
                size="sm"
                ariaLabel="活动 Profile"
                disabled={!configProfiles}
                value={configRead?.profileState.selectedProfile ?? ''}
                options={[
                  { value: '', label: '基础配置' },
                  ...(configProfiles?.profiles ?? []).map((profile) => ({
                    value: profile.id,
                    label: profile.displayName,
                    detail: profile.valid ? profile.description : '配置无效',
                    disabled: !profile.valid,
                  })),
                ]}
                onChange={(value) => {
                  void desktopClient
                    .selectConfigProfile(value || null)
                    .then(() => reloadConfig())
                    .catch((error) =>
                      window.alert(error instanceof Error ? error.message : String(error)),
                    )
                }}
              />
              <SettingsDropdown
                size="sm"
                ariaLabel="配置层"
                value={configLayer}
                options={[
                  { value: 'user', label: '用户配置' },
                  ...(configRead?.layers?.some((layer) => layer.kind === 'profile')
                    ? [{ value: 'profile', label: '活动 Profile' }]
                    : []),
                  ...(configRead?.layers?.some((layer) => layer.kind === 'project')
                    ? [{ value: 'project', label: '项目配置' }]
                    : []),
                ]}
                onChange={(value) => setConfigLayer(value as 'user' | 'profile' | 'project')}
              />
            </div>
            <div className="config-settings-source-actions tw:flex tw:min-w-0 tw:items-center tw:gap-2 tw:max-[600px]:w-full tw:max-[600px]:flex-wrap">
              <Button
                color="secondary"
                type="button"
                disabled={!configProfiles?.profilesDirectory}
                onClick={() => {
                  if (configProfiles?.profilesDirectory) {
                    void desktopClient.openPathWithDefaultTarget(configProfiles.profilesDirectory)
                  }
                }}
              >
                <ExternalLink size={APP_ICON_SIZE} />
                打开 Profiles 目录
              </Button>
              <Button
                color="secondary"
                type="button"
                disabled={!selectedConfigLayer?.filePath}
                onClick={() => {
                  if (selectedConfigLayer?.filePath) {
                    void desktopClient.openPathWithDefaultTarget(selectedConfigLayer.filePath)
                  }
                }}
              >
                <ExternalLink size={APP_ICON_SIZE} />
                打开配置文件
              </Button>
            </div>
          </div>
          <SettingsSection.Content>
            {configRead?.profileState.restartRequired ? (
              <SettingsRow
                title="Profile 等待重启"
                description="关闭所有 Pidex 桌面端和 CLI/TUI 后重新打开，新的 Profile 才会应用；当前任务不会被切换。"
                control={<span className="settings-row-status">待重启</span>}
              />
            ) : null}
            <SettingsRow
              title="权限预设"
              description="快速选择默认权限、自动审查、完全访问或自定义策略。"
              control={
                <SettingsDropdown
                  size="md"
                  ariaLabel="权限预设"
                  value={permissionModeForConfig(draft.values.permissionConfig)}
                  options={PERMISSION_MODE_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                    detail: option.detail,
                  }))}
                  onChange={(value) => {
                    const mode = value as Parameters<typeof permissionConfigForMode>[0]
                    if (mode !== 'custom')
                      draft.setValue('permissionConfig', permissionConfigForMode(mode))
                    draft.autoSave()
                  }}
                />
              }
            />
            <SettingsRow
              title="文件访问范围"
              description="约束内建文件工具；Shell 始终在宿主机执行。网络授权属于审批范围，不提供网络隔离。"
              control={
                <SettingsDropdown
                  size="md"
                  ariaLabel="文件访问范围"
                  value={
                    draft.values.permissionConfig.sandboxMode === 'read-only'
                      ? ':read-only'
                      : draft.values.permissionConfig.sandboxMode === 'danger-full-access'
                        ? ':danger-full-access'
                        : ':workspace'
                  }
                  options={[
                    {
                      value: ':read-only',
                      label: '只读',
                      detail: '结构化文件工具只读；终端命令在本机执行并经过风险、Hook 和审批',
                    },
                    {
                      value: ':workspace',
                      label: '当前工作区',
                      detail:
                        '结构化文件工具仅写当前工作区；终端命令在本机执行并经过风险、Hook 和审批',
                    },
                    {
                      value: ':danger-full-access',
                      label: '完全访问',
                      detail:
                        '结构化文件工具可访问本机路径；终端命令在本机执行并经过风险、Hook 和审批',
                    },
                  ]}
                  onChange={(value) => {
                    const sandboxMode =
                      value === ':read-only'
                        ? 'read-only'
                        : value === ':danger-full-access'
                          ? 'danger-full-access'
                          : 'workspace-write'
                    draft.setValue('permissionConfig', {
                      ...draft.values.permissionConfig,
                      sandboxMode,
                    })
                    draft.autoSave()
                  }}
                />
              }
            />
            <SettingsRow
              title="Shell 安全级别"
              description="调整 Shell 静态风险处理，不改变文件或网络权限范围；审批时机为“从不”时，需要审批的命令会直接拒绝。"
              control={
                <SettingsDropdown
                  size="md"
                  ariaLabel="Shell 安全级别"
                  value={draft.values.shellSecurityLevel}
                  options={[
                    {
                      value: 'strict',
                      label: '严格',
                      detail: '更多高风险特征直接拒绝，适合陌生仓库',
                    },
                    {
                      value: 'balanced',
                      label: '平衡',
                      detail: '灾难级行为拒绝，可疑项转审批（推荐）',
                    },
                    {
                      value: 'relaxed',
                      label: '宽松',
                      detail: '保留不可绕过底线，其余高风险尽量转审批',
                    },
                  ]}
                  onChange={(value) => {
                    draft.setValue('shellSecurityLevel', value as DesktopShellSecurityLevel)
                    draft.autoSave()
                  }}
                />
              }
            />
            <SettingsRow
              title="审批时机"
              description="选择 Pidex 何时请求批准。"
              control={
                <SettingsDropdown
                  size="md"
                  ariaLabel="审批时机"
                  value={
                    typeof draft.values.permissionConfig.approvalPolicy === 'object'
                      ? 'granular'
                      : draft.values.permissionConfig.approvalPolicy === 'on-failure'
                        ? 'on-request'
                        : draft.values.permissionConfig.approvalPolicy
                  }
                  options={[
                    { value: 'untrusted', label: '不可信', detail: '执行不受信任的操作前请求批准' },
                    { value: 'on-request', label: '按请求', detail: '需要提升权限时请求批准' },
                    { value: 'granular', label: '精细控制', detail: '分别控制不同类别的审批请求' },
                    { value: 'never', label: '从不', detail: '运行操作时不请求批准' },
                  ]}
                  onChange={(value) => {
                    const approvalPolicy =
                      value === 'granular'
                        ? {
                            type: 'granular' as const,
                            sandboxApproval: true,
                            rules: true,
                            skillApproval: true,
                            requestPermissions: true,
                            mcpTools: true,
                            mcpElicitations: true,
                          }
                        : (value as 'untrusted' | 'on-request' | 'never')
                    draft.setValue('permissionConfig', {
                      ...draft.values.permissionConfig,
                      approvalPolicy,
                    })
                    draft.autoSave()
                  }}
                />
              }
            />
            <SettingsRow
              title="审批执行者"
              description="选择由你还是独立 Guardian 处理需要审批的操作。"
              control={
                <SettingsDropdown
                  size="md"
                  ariaLabel="审批执行者"
                  value={draft.values.permissionConfig.approvalsReviewer}
                  options={[
                    { value: 'user', label: '用户', detail: '由你确认或拒绝审批请求' },
                    {
                      value: 'auto_review',
                      label: 'Guardian 自动审查',
                      detail: '由独立 Guardian 模型处理审批请求',
                    },
                  ]}
                  onChange={(value) => {
                    const approvalsReviewer = value as 'user' | 'auto_review'
                    draft.setValue('permissionConfig', {
                      ...draft.values.permissionConfig,
                      approvalsReviewer,
                    })
                    draft.autoSave()
                  }}
                />
              }
            />
            {typeof draft.values.permissionConfig.approvalPolicy === 'object' ? (
              <>
                {(
                  [
                    ['sandboxApproval', '执行范围提升'],
                    ['rules', '规则审批'],
                    ['skillApproval', 'Skill 脚本'],
                    ['requestPermissions', '动态权限请求'],
                    ['mcpTools', 'MCP 工具调用'],
                    ['mcpElicitations', 'MCP 交互请求'],
                  ] as const
                ).map(([key, label]) => (
                  <SettingsRow
                    key={key}
                    title={label}
                    description="允许该类审批请求出现；关闭时需要该能力的调用会直接拒绝。"
                    control={
                      <ToggleSwitch
                        ariaLabel={label}
                        checked={draft.values.permissionConfig.approvalPolicy[key]}
                        onChange={(checked) => {
                          const policy = draft.values.permissionConfig.approvalPolicy
                          if (typeof policy !== 'object') return
                          const approvalPolicy = { ...policy, [key]: checked }
                          draft.setValue('permissionConfig', {
                            ...draft.values.permissionConfig,
                            approvalPolicy,
                          })
                          draft.autoSave()
                        }}
                      />
                    }
                  />
                ))}
              </>
            ) : null}
          </SettingsSection.Content>
        </SettingsSection>

        <SettingsSection title="诊断">
          {configRead?.diagnostics.map((diagnostic) => (
            <SettingsRow
              key={`${diagnostic.scope}:${diagnostic.code}`}
              title={diagnostic.code}
              description={
                <span>
                  <AlertTriangle size={APP_ICON_SIZE} /> {diagnostic.message}
                </span>
              }
            />
          ))}
          <SettingsRow
            title="完整提示词诊断"
            description="仅在你主动请求时读取当前任务的 system/developer/contextual-user sections、来源、hash、token 估算和缓存分类；内容不会写入日志或遥测。"
            control={
              <Button
                color="secondary"
                type="button"
                onClick={() =>
                  void (async () => {
                    try {
                      const sessionId = await desktopClient.getActiveSessionId()
                      if (!sessionId) throw new Error('当前没有活动任务')
                      const preview = await desktopClient.getSessionPromptPreview(sessionId)
                      setPromptPreview(JSON.stringify(preview, null, 2))
                    } catch (error) {
                      window.alert(error instanceof Error ? error.message : String(error))
                    }
                  })()
                }
              >
                预览当前任务提示词
              </Button>
            }
          />
          {promptPreview ? (
            <div
              aria-label="当前任务完整提示词"
              className="config-settings-prompt-preview tw:max-h-[min(32rem,60vh)] tw:overflow-auto tw:border-t-[0.5px] tw:border-t-app-border tw:p-4"
              role="region"
            >
              <pre className="settings-code-block tw:m-0 tw:min-w-max tw:whitespace-pre tw:text-app-text-soft tw:type-code">
                {promptPreview}
              </pre>
            </div>
          ) : null}
        </SettingsSection>

        <SettingsSection
          title="专用模型"
          description="按用途为辅助能力选择模型；留空时使用上面的会话主模型。"
        >
          <SettingsRow
            title="生成模型"
            description="用于任务建议和会话标题生成与更新。"
            control={
              <SpecializedModelSelect
                value={draft.values.generationModel}
                mainModel={settings.model}
                specializedModelKey="generationModel"
                onChange={(v) => {
                  draft.setValue('generationModel', v)
                  draft.autoSave()
                }}
              />
            }
          />
          <SettingsRow
            title="整理模型"
            description="用于记忆提取和任务上下文整理。"
            control={
              <SpecializedModelSelect
                value={draft.values.organizationModel}
                mainModel={settings.model}
                specializedModelKey="organizationModel"
                onChange={(v) => {
                  draft.setValue('organizationModel', v)
                  draft.autoSave()
                }}
              />
            }
          />
          <SettingsRow
            title="代码模型"
            description="用于计划实施和 AI 代码审查。"
            control={
              <SpecializedModelSelect
                value={draft.values.codingModel}
                mainModel={settings.model}
                specializedModelKey="codingModel"
                onChange={(v) => {
                  draft.setValue('codingModel', v)
                  draft.autoSave()
                }}
              />
            }
          />
          <SettingsRow
            title="安全模型（实验）"
            description="用于 Shell 和工具权限自动审核。"
            control={
              <SpecializedModelSelect
                value={draft.values.securityModel}
                mainModel={settings.model}
                specializedModelKey="securityModel"
                onChange={(v) => {
                  draft.setValue('securityModel', v)
                  draft.autoSave()
                }}
              />
            }
          />
        </SettingsSection>

        <SettingsSection
          title="数据位置"
          description="Pidex 的全局配置、会话、宠物和托管工具存储位置。"
        >
          <SettingsRow
            title="当前数据目录"
            description={dataLocation ? dataLocation.currentDataDir : '加载中…'}
            control={
              <span className="settings-row-status">
                {dataLocation
                  ? dataLocation.isEnvControlled
                    ? '环境变量控制'
                    : dataLocation.controlSource === 'bootstrap'
                      ? '自定义位置'
                      : '默认位置'
                  : '—'}
              </span>
            }
          />
          <SettingsRow
            title="配置文件"
            description={
              dataLocation ? appendDataFile(dataLocation.currentDataDir, 'config.json') : '加载中…'
            }
            control={<span className="settings-row-status">建议备份</span>}
          />
          <SettingsRow
            title="Provider 凭据文件（可选）"
            description={
              dataLocation ? appendDataFile(dataLocation.currentDataDir, 'auth.json') : '加载中…'
            }
            control={<span className="settings-row-status">使用 auth.json 仓库时</span>}
          />
          <SettingsRow
            title="快速恢复"
            description="手动复制 config.json，以及启用 auth.json 仓库时的 auth.json。Skill 内容不包含在这两个文件中，需另行处理。"
          />
          {dataLocation?.pendingDataDir ? (
            <SettingsRow
              title="待生效目录"
              description={`重启后将使用：${dataLocation.pendingDataDir}`}
              control={<span className="settings-row-status">等待重启</span>}
            />
          ) : null}
          <SettingsRow
            title="更改位置"
            description={
              dataLocation?.isEnvControlled
                ? '当前由 PIDEX_DATA_DIR 控制；移除环境变量后才能通过桌面设置迁移。'
                : '选择父目录后会创建 .pidex，并立即重启完成安全迁移。旧目录不会删除。'
            }
            control={
              <Button
                color="primary"
                disabled={changingLocation || dataLocation?.isEnvControlled}
                onClick={() => void handleChooseDataLocation()}
                type="button"
              >
                {changingLocation ? '处理中…' : '选择目录'}
              </Button>
            }
          />
        </SettingsSection>
      </div>
    </SettingsContentArea>
  )
}

function appendDataFile(directory: string, fileName: string): string {
  const separator = directory.includes('\\') ? '\\' : '/'
  return `${directory.replace(/[\\/]+$/, '')}${separator}${fileName}`
}
