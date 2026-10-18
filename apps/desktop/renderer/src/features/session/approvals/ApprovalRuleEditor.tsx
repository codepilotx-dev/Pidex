import React from 'react'
import { Button } from '../../../components/ui/Button.js'
import { Input } from '../../../components/ui/Input.js'
import { Select } from '../../../components/ui/Select.js'
import { ToggleSwitch } from '../../../components/ui/ToggleSwitch.js'
import {
  APPROVAL_RULE_EFFECT_TABS,
  approvalRuleScopeOptions,
  type ApprovalRuleEditorValues,
  type ApprovalRuleMatchKind,
  type ApprovalRuleScopeOption,
} from './ApprovalRulesModel.js'

const MATCH_KIND_OPTIONS: ReadonlyArray<{
  value: ApprovalRuleMatchKind
  label: string
  detail: string
}> = [
  { value: 'tool', label: '工具', detail: '按宿主工具名匹配，例如 Bash 或 apply_patch' },
  { value: 'file', label: '文件', detail: '按内建文件工具的读/写目标目录匹配' },
  { value: 'command', label: '命令', detail: '精确命令，或同参数前缀的命令' },
  { value: 'network', label: '网络', detail: '精确域名，不支持通配符或子域' },
  { value: 'mcp', label: 'MCP', detail: '按 MCP server 与可选工具名匹配' },
]

const FIELD_CLASS = 'tw:grid tw:min-w-0 tw:gap-1.5 tw:text-app-text tw:type-control'
const FIELD_HINT_CLASS = 'tw:m-0 tw:text-app-text-meta tw:type-caption'
const EDITOR_BOX_CLASS =
  'tw:grid tw:min-w-0 tw:gap-3 tw:rounded-control tw:border tw:border-app-border-subtle tw:bg-app-canvas tw:p-3'

export function ApprovalRuleEditor({
  mode,
  values,
  isProjectChat,
  workspaceRoots,
  busy,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  mode: 'create' | 'edit'
  values: ApprovalRuleEditorValues
  isProjectChat: boolean
  workspaceRoots: readonly string[]
  busy: boolean
  error: string | null
  onChange: (values: ApprovalRuleEditorValues) => void
  onSave: () => void
  onCancel: () => void
}): React.ReactNode {
  const set = (patch: Partial<ApprovalRuleEditorValues>): void => onChange({ ...values, ...patch })
  const scopeOptions: ApprovalRuleScopeOption[] = approvalRuleScopeOptions(isProjectChat)
  const filePathOptions = React.useMemo(() => {
    const roots = workspaceRoots.filter((root) => root.trim())
    const candidates =
      values.filePath && !roots.includes(values.filePath) ? [values.filePath, ...roots] : roots
    return candidates.map((root) => ({ value: root, label: root }))
  }, [values.filePath, workspaceRoots])

  return (
    <div className={EDITOR_BOX_CLASS} data-approval-rule-editor={mode}>
      <div className="tw:grid tw:min-w-0 tw:grid-cols-2 tw:gap-3">
        <div className={FIELD_CLASS}>
          <span className="tw:text-app-text-soft tw:type-label">效果</span>
          <Select
            ariaLabel="规则效果"
            options={APPROVAL_RULE_EFFECT_TABS.map((tab) => ({
              value: tab.value,
              label: tab.label,
            }))}
            value={values.effect}
            onValueChange={(value) => set({ effect: value as ApprovalRuleEditorValues['effect'] })}
          />
        </div>
        <div className={FIELD_CLASS}>
          <span className="tw:text-app-text-soft tw:type-label">范围</span>
          <Select
            ariaLabel="规则范围"
            options={scopeOptions.map((option) => ({
              value: option.value,
              label: option.label,
              detail: option.detail,
            }))}
            value={values.scope}
            onValueChange={(value) => set({ scope: value as ApprovalRuleEditorValues['scope'] })}
          />
        </div>
      </div>
      <div className={FIELD_CLASS}>
        <span className="tw:text-app-text-soft tw:type-label">匹配类型</span>
        <Select
          ariaLabel="匹配类型"
          options={MATCH_KIND_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
            detail: option.detail,
          }))}
          value={values.matchKind}
          onValueChange={(value) => set({ matchKind: value as ApprovalRuleMatchKind })}
        />
      </div>

      {values.matchKind === 'tool' ? (
        <label className={FIELD_CLASS}>
          <span className="tw:text-app-text-soft tw:type-label">工具名称</span>
          <Input
            aria-label="工具名称"
            placeholder="例如 Bash"
            value={values.tool}
            onChange={(event) => set({ tool: event.currentTarget.value })}
          />
          <p className={FIELD_HINT_CLASS}>使用宿主注册的规范工具名；服务端会校验工具是否存在。</p>
        </label>
      ) : null}

      {values.matchKind === 'file' ? (
        <div className="tw:grid tw:min-w-0 tw:gap-1.5">
          <span className="tw:text-app-text-soft tw:type-label">文件访问</span>
          <Select
            ariaLabel="文件访问方式"
            options={[
              { value: 'read', label: '读取', detail: '允许内建文件工具读取该目录' },
              { value: 'write', label: '写入', detail: '允许内建文件工具写入该目录' },
            ]}
            value={values.fileAccess}
            onValueChange={(value) =>
              set({ fileAccess: value as ApprovalRuleEditorValues['fileAccess'] })
            }
          />
          <span className="tw:text-app-text-soft tw:type-label">目录</span>
          {filePathOptions.length ? (
            <Select
              ariaLabel="规则目录"
              options={filePathOptions}
              value={values.filePath}
              onValueChange={(value) => set({ filePath: value })}
            />
          ) : (
            <Input
              aria-label="规则目录"
              placeholder="尚未加载到会话工作区路径"
              value={values.filePath}
              onChange={(event) => set({ filePath: event.currentTarget.value })}
            />
          )}
          <p className={FIELD_HINT_CLASS}>
            候选目录来自当前会话的工作区与已配置目录；新增或移除目录请继续使用现有工作区服务。
          </p>
        </div>
      ) : null}

      {values.matchKind === 'command' ? (
        <div className="tw:grid tw:min-w-0 tw:gap-1.5">
          <label className={FIELD_CLASS}>
            <span className="tw:text-app-text-soft tw:type-label">命令</span>
            <Input
              aria-label="命令"
              placeholder="例如 git status"
              value={values.command}
              onChange={(event) => set({ command: event.currentTarget.value })}
            />
          </label>
          <label className="tw:flex tw:items-center tw:justify-between tw:gap-3 tw:type-control tw:text-app-text">
            <span>同时接收相同参数前缀</span>
            <ToggleSwitch
              ariaLabel="同时接收相同参数前缀"
              checked={values.commandMode === 'prefix'}
              onChange={(checked) =>
                set({
                  commandMode: checked ? 'prefix' : 'exact',
                  argvText:
                    checked && !values.argvText.trim()
                      ? values.command.trim().split(/\s+/u).join('\n')
                      : values.argvText,
                })
              }
            />
          </label>
          {values.commandMode === 'prefix' ? (
            <label className={FIELD_CLASS}>
              <span className="tw:text-app-text-soft tw:type-label">参数前缀（每行一个参数）</span>
              <textarea
                aria-label="参数前缀"
                className="tw:min-h-20 tw:w-full tw:resize-y tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-control tw:px-control-inline tw:py-control-block tw:text-app-text tw:type-control tw:outline-none tw:focus-visible:border-app-focus tw:focus-visible:outline-2 tw:focus-visible:outline-solid tw:focus-visible:outline-offset-1 tw:focus-visible:outline-app-focus"
                value={values.argvText}
                onChange={(event) => set({ argvText: event.currentTarget.value })}
              />
              <p className={FIELD_HINT_CLASS}>
                命令前缀必须与宿主安全切分的参数一致；包含引号、管道或脚本语法的命令不能使用前缀匹配。
              </p>
            </label>
          ) : (
            <p className={FIELD_HINT_CLASS}>精确命令按字面值匹配，参数必须完全相同。</p>
          )}
        </div>
      ) : null}

      {values.matchKind === 'network' ? (
        <label className={FIELD_CLASS}>
          <span className="tw:text-app-text-soft tw:type-label">精确域名</span>
          <Input
            aria-label="精确域名"
            placeholder="例如 example.com"
            value={values.domain}
            onChange={(event) => set({ domain: event.currentTarget.value })}
          />
          <p className={FIELD_HINT_CLASS}>只匹配完全相同的域名；不支持通配符或子域。</p>
        </label>
      ) : null}

      {values.matchKind === 'mcp' ? (
        <div className="tw:grid tw:min-w-0 tw:grid-cols-2 tw:gap-3">
          <label className={FIELD_CLASS}>
            <span className="tw:text-app-text-soft tw:type-label">MCP 服务器</span>
            <Input
              aria-label="MCP 服务器"
              placeholder="例如 filesystem"
              value={values.mcpServer}
              onChange={(event) => set({ mcpServer: event.currentTarget.value })}
            />
          </label>
          <label className={FIELD_CLASS}>
            <span className="tw:text-app-text-soft tw:type-label">MCP 工具（可选）</span>
            <Input
              aria-label="MCP 工具"
              placeholder="留空表示该服务器的全部工具"
              value={values.mcpTool}
              onChange={(event) => set({ mcpTool: event.currentTarget.value })}
            />
          </label>
        </div>
      ) : null}

      {error ? (
        <p className="tw:m-0 tw:text-app-danger tw:type-body-sm" role="alert">
          {error}
        </p>
      ) : null}
      <div className="tw:flex tw:items-center tw:justify-end tw:gap-2">
        <Button color="secondary" disabled={busy} size="md" onClick={onCancel}>
          取消
        </Button>
        <Button color="primary" disabled={busy} size="md" onClick={onSave}>
          {busy ? '保存中…' : mode === 'edit' ? '保存规则' : '添加规则'}
        </Button>
      </div>
    </div>
  )
}
