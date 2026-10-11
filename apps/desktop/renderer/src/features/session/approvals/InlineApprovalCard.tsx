import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import React from 'react'
import { decodeThreadPatchDiff } from '@pidex/agent-protocol'
import { FileMutationDiffBody } from '../timeline/FileMutationDiffBody.js'
import { ArrowDown, ArrowUp, ChevronDown, X } from 'lucide-react'
import { Dropdown as DropdownMenu } from '../../../components/ui/floating/Dropdown.js'
import type {
  DesktopPermissionDecision,
  DesktopPermissionGrantScope,
  DesktopPermissionMode,
  DesktopPermissionRequest,
} from '../../../../shared/Types.js'
import { Button } from '../../../components/ui/Button.js'
import { Dropdown } from '../../../components/ui/Dropdown.js'
import { PopoverRadioItem } from '../../../components/ui/PopoverItem.js'
import { AskUserQuestionApproval } from './AskUserQuestionApproval.js'
import { useQuestionSkipCapability } from './UseQuestionSkipCapability.js'
import { ASK_USER_QUESTION_NAV_BUTTON_CLASS, RequestCard } from './RequestCard.js'
import { ConfirmationDialog } from '../../../components/ui/ConfirmationDialog.js'
import { useApprovalCapability } from './UseQuestionSkipCapability.js'
import {
  McpElicitationForm,
  McpElicitationUnsupported,
} from '../mcpElicitation/McpElicitationForm.js'
import { getSchemaMode, parseMcpElicitationSchema } from '../mcpElicitation/McpElicitationUtils.js'
import { useHeightTransition } from '../../../hooks/UseHeightTransition.js'
import { cx } from '../../../utils/Cx.js'

export type InlineApprovalCommand = {
  full: string
  hint: string
}

export type PermissionGrantScopeOption = {
  scope: DesktopPermissionGrantScope
  label: string
}

export const PERMISSION_GRANT_SCOPE_LABELS: Record<DesktopPermissionGrantScope, string> = {
  'tool-call': '仅此次工具调用',
  turn: '当前轮次',
  session: '当前任务会话',
}

export function permissionGrantScopeOptions(
  request: DesktopPermissionRequest,
): PermissionGrantScopeOption[] {
  const grant = request.permissionGrant
  const allowedScopes = grant?.allowedScopes ?? []
  const scopes =
    allowedScopes.length > 0 ? allowedScopes : grant?.requestedScope ? [grant.requestedScope] : []
  return scopes.map((scope) => ({ scope, label: PERMISSION_GRANT_SCOPE_LABELS[scope] }))
}

export function permissionGrantDefaultScope(
  options: PermissionGrantScopeOption[],
  requestedScope: DesktopPermissionGrantScope | undefined,
): DesktopPermissionGrantScope | null {
  return (
    options.find((option) => option.scope === requestedScope)?.scope ?? options[0]?.scope ?? null
  )
}

export function permissionGrantGroups(
  request: DesktopPermissionRequest,
): Array<{ title: string; items: string[] }> {
  const requested = request.permissionGrant?.requestedPermissions
  const groups: Array<{ title: string; items: string[] }> = []
  if (requested) {
    const readPaths = stringArrayValue(requested.readPaths)
    const writePaths = stringArrayValue(requested.writePaths)
    const networkDomains = stringArrayValue(requested.networkDomains)
    if (readPaths.length > 0) groups.push({ title: '读取路径', items: readPaths })
    if (writePaths.length > 0) groups.push({ title: '写入路径', items: writePaths })
    if (networkDomains.length > 0) groups.push({ title: '网络域名', items: networkDomains })
  }
  if (groups.length === 0) {
    const paths = Array.isArray(request.input.paths)
      ? request.input.paths.filter((item): item is string => typeof item === 'string')
      : []
    if (paths.length > 0) groups.push({ title: '涉及范围', items: paths })
  }
  return groups
}

export type InlineApprovalCardProps = {
  identity?: string
  disabledReason?: string
  onInterrupt?: () => void | Promise<void>
  request: DesktopPermissionRequest
  currentPermissionMode?: DesktopPermissionMode
  onDecide: (
    request: DesktopPermissionRequest,
    behavior: 'allow' | 'deny',
    alwaysAllow?: boolean,
    updatedInput?: Record<string, unknown>,
    decisionExtras?: Pick<
      DesktopPermissionDecision,
      'grantScope' | 'computerGrant' | 'grantOptionId'
    >,
  ) => void | Promise<void>
}

const COMMAND_HINT_MAX_LENGTH = 56

export function InlineApprovalCard({
  request,
  currentPermissionMode,
  onDecide,
  onInterrupt,
  identity,
  disabledReason,
}: InlineApprovalCardProps): React.ReactNode {
  const supportsQuestionSkip = useQuestionSkipCapability(
    request.requestId,
    request.toolName === 'AskUserQuestion',
  )
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [confirmGrant, setConfirmGrant] = React.useState<
    NonNullable<DesktopPermissionRequest['grantOptions']>[number] | null
  >(null)
  const hasScopedGrants = useApprovalCapability(
    request.requestId,
    true,
    'interaction.scopedGrants.v1',
  )
  const grantOptions = hasScopedGrants ? (request.grantOptions ?? []) : []
  const requestIdRef = React.useRef(request.requestId)
  requestIdRef.current = request.requestId
  const busyRef = React.useRef(false)
  const disabled = busy || Boolean(disabledReason)
  const [isCommandExpanded, setIsCommandExpanded] = React.useState(false)
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const commandPreviewId = React.useId()
  const isPermissionGrant =
    request.requestKind === 'permission-grant' || Boolean(request.permissionGrant)
  const scopeOptions = permissionGrantScopeOptions(request)
  const defaultScope = permissionGrantDefaultScope(
    scopeOptions,
    request.permissionGrant?.requestedScope,
  )
  const [selectedScope, setSelectedScope] = React.useState<DesktopPermissionGrantScope | null>(
    defaultScope,
  )
  React.useEffect(() => {
    // A fresh permission request must not inherit the scope chosen for the
    // previous one rendered by the same card instance.
    setSelectedScope(defaultScope)
    busyRef.current = false
    setBusy(false)
    setError(null)
    setConfirmGrant(null)
    setDetailsOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.requestId])
  const command = buildInlineApprovalCommand(request)
  const commandPreviewTransition = useHeightTransition([isCommandExpanded, command.full])
  const approvalTitle = request.computerApp
    ? `允许使用 ${request.computerApp.name}？`
    : inlineApprovalTitle(request)
  const previewLabel = inlineApprovalPreviewLabel(request)
  const reviewSummary = inlineApprovalReviewSummary(request)
  const fileDiffs =
    !request.toolIdentity && Array.isArray(request.input.approvalFileDiffs)
      ? request.input.approvalFileDiffs.flatMap((value) => {
          try {
            return [decodeThreadPatchDiff(value)]
          } catch {
            return []
          }
        })
      : []
  async function act(action: () => void | Promise<void>): Promise<void> {
    if (busyRef.current || disabledReason) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    const activeId = request.requestId
    try {
      await action()
    } catch {
      if (requestIdRef.current === activeId) {
        setError('操作失败，请重试。')
        busyRef.current = false
        setBusy(false)
      }
    }
  }
  const navigation = onInterrupt ? (
    <button
      type="button"
      className={ASK_USER_QUESTION_NAV_BUTTON_CLASS}
      aria-label="中断当前对话"
      disabled={disabled}
      onClick={() => void act(onInterrupt)}
    >
      <X size={APP_ICON_SIZES.sm} />
    </button>
  ) : null
  const actions = (
    <div className="inline-approval-actions tw:ml-auto tw:flex tw:w-auto tw:shrink-0 tw:flex-wrap tw:items-center tw:justify-end tw:gap-2">
      {grantOptions
        .filter((option) => option.scope !== 'session')
        .map((option) => (
          <Button
            key={option.id}
            color="secondary"
            disabled={disabled}
            onClick={() => {
              if (option.requiresConfirmation) setConfirmGrant(option)
              else
                void act(() =>
                  onDecide(request, 'allow', false, undefined, { grantOptionId: option.id }),
                )
            }}
          >
            {option.label}
          </Button>
        ))}
      {request.computerApp?.allowPersistentApproval ? (
        <Button
          color="secondary"
          disabled={disabled}
          onClick={() =>
            void act(() =>
              onDecide(request, 'allow', false, undefined, { computerGrant: 'persistent' }),
            )
          }
        >
          始终允许
        </Button>
      ) : null}
      {isPermissionGrant && scopeOptions.length > 1 ? (
        <Dropdown
          className="popover-menu--flex"
          size="md"
          align="end"
          trigger={
            <button
              type="button"
              className="inline-approval-scope-trigger tw:inline-flex tw:items-center tw:gap-1 tw:rounded-control tw:border-0 tw:bg-transparent tw:p-2 tw:text-app-text-soft tw:type-control tw:hover:bg-app-hover"
              disabled={disabled}
              aria-label="授权范围"
            >
              {scopeOptions.find((option) => option.scope === selectedScope)?.label}
              <ChevronDown size={APP_ICON_SIZES.sm} />
            </button>
          }
        >
          <DropdownMenu.RadioGroup
            value={selectedScope ?? ''}
            onValueChange={(value) => {
              if (!disabled && scopeOptions.some((option) => option.scope === value))
                setSelectedScope(value as DesktopPermissionGrantScope)
            }}
          >
            {scopeOptions.map((option) => (
              <PopoverRadioItem key={option.scope} value={option.scope} disabled={disabled}>
                {option.label}
              </PopoverRadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </Dropdown>
      ) : isPermissionGrant && selectedScope ? (
        <span className="inline-approval-scope-label tw:text-app-text-soft tw:type-body-sm">
          {PERMISSION_GRANT_SCOPE_LABELS[selectedScope]}
        </span>
      ) : null}
      <Button
        color="secondary"
        disabled={disabled}
        onClick={() => void act(() => onDecide(request, 'deny'))}
      >
        拒绝
      </Button>
      <Button
        color="primary"
        disabled={disabled || (isPermissionGrant && !selectedScope)}
        onClick={() =>
          void act(() =>
            onDecide(
              request,
              'allow',
              false,
              undefined,
              request.computerApp
                ? { computerGrant: 'chat' }
                : isPermissionGrant && selectedScope
                  ? { grantScope: selectedScope }
                  : undefined,
            ),
          )
        }
      >
        {request.computerApp ? '允许此对话' : isPermissionGrant ? '允许' : '允许一次'}
      </Button>
      {grantOptions.some((option) => option.scope === 'session') ? (
        <Dropdown
          size="md"
          align="end"
          trigger={
            <button
              type="button"
              className="inline-approval-scope-trigger tw:inline-flex tw:items-center tw:gap-1 tw:rounded-control tw:border-0 tw:bg-transparent tw:p-2 tw:text-app-text-soft tw:type-control tw:hover:bg-app-hover"
              disabled={disabled}
              aria-label="更多授权范围"
            >
              <ChevronDown size={APP_ICON_SIZE} />
            </button>
          }
        >
          {grantOptions
            .filter((option) => option.scope === 'session')
            .map((option) => (
              <DropdownMenu.Item
                key={option.id}
                className="popover-item"
                disabled={disabled}
                onSelect={() =>
                  void act(() =>
                    onDecide(request, 'allow', false, undefined, { grantOptionId: option.id }),
                  )
                }
              >
                {option.label}
              </DropdownMenu.Item>
            ))}
        </Dropdown>
      ) : null}
      <ConfirmationDialog
        open={confirmGrant !== null}
        title="允许访问所有网站？"
        description="Agent 将能够读取和操作所有网站。明确拒绝的网站仍会被阻止，你可以在浏览器授权设置中撤销。"
        actionLabel="允许所有网站"
        actionDisabled={disabled}
        onCancel={() => {
          if (!busy) setConfirmGrant(null)
        }}
        onAction={() => {
          if (confirmGrant)
            void act(async () => {
              await onDecide(request, 'allow', false, undefined, { grantOptionId: confirmGrant.id })
              setConfirmGrant(null)
            })
        }}
      />
    </div>
  )

  if (request.computerApp) {
    return (
      <RequestCard
        title={approvalTitle}
        variant="permission"
        identity={identity}
        disabledReason={disabledReason}
        navigation={navigation}
        error={error}
      >
        <p className="inline-approval-target tw:m-0 tw:px-2 tw:text-app-text-soft tw:type-body-sm tw:wrap-anywhere">
          截图会进入聊天，必要时可能切到前台。你可以随时停止操作。
        </p>
        {actions}
      </RequestCard>
    )
  }
  if (request.toolName === 'AskUserQuestion') {
    return (
      <AskUserQuestionApproval
        supportsQuestionSkip={supportsQuestionSkip}
        identity={identity}
        disabledReason={disabledReason}
        onInterrupt={onInterrupt}
        request={request}
        onReject={() => onDecide(request, 'deny')}
        onSubmit={(updatedInput) => onDecide(request, 'allow', false, updatedInput)}
      />
    )
  }

  if (request.toolName === 'McpElicitation') {
    const elicitationRequest = request.input?.request as Record<string, unknown> | undefined
    const serverName = (request.input?.serverName as string) ?? '未知服务器'
    const message = (elicitationRequest?.message as string) ?? ''
    const mode = getSchemaMode(elicitationRequest)

    if (mode === 'form') {
      const schema = parseMcpElicitationSchema(elicitationRequest?.requestedSchema)
      if (schema) {
        return (
          <McpElicitationForm
            key={request.requestId}
            busy={disabled}
            error={error}
            details={elicitationConfirmationDetails(elicitationRequest?.presentation)}
            serverName={serverName}
            message={message}
            schema={schema}
            onSubmit={(content) => void act(() => onDecide(request, 'allow', false, { content }))}
            onDecline={() => void act(() => onDecide(request, 'deny'))}
            onCancel={() =>
              void act(() =>
                onDecide(request, 'deny', false, {
                  cancelled: true,
                  action: 'cancel',
                }),
              )
            }
          />
        )
      }
    }

    // Fallback: unsupported mode
    return (
      <McpElicitationUnsupported
        busy={disabled}
        error={error}
        serverName={serverName}
        message={message}
        onDecline={() => void act(() => onDecide(request, 'deny'))}
        onCancel={() =>
          void act(() =>
            onDecide(request, 'deny', false, {
              cancelled: true,
              action: 'cancel',
            }),
          )
        }
      />
    )
  }

  if (isPermissionGrant) {
    const permissionGroups = permissionGrantGroups(request)
    return (
      <RequestCard
        title="需要额外权限，是否允许？"
        variant="permission-grant"
        identity={identity}
        disabledReason={disabledReason}
        error={error}
        navigation={navigation}
      >
        {request.description ? (
          <p className="inline-approval-target tw:m-0 tw:px-2 tw:text-app-text-soft tw:type-body-sm tw:wrap-anywhere">
            {request.description}
          </p>
        ) : null}
        {request.autoReviewFallbackReason ? (
          <p className="inline-approval-target tw:m-0 tw:px-2 tw:text-app-text-soft tw:type-body-sm tw:wrap-anywhere">
            自动审查无法完成，已转为人工审批：{request.autoReviewFallbackReason}
          </p>
        ) : null}
        {reviewSummary ? (
          <p className="inline-approval-target tw:m-0 tw:px-2 tw:text-app-text-soft tw:type-body-sm tw:wrap-anywhere">
            {reviewSummary}
          </p>
        ) : null}
        {permissionGroups.length > 0 ? (
          <div className="inline-approval-permission-grant tw:grid tw:gap-2 tw:px-3">
            {permissionGroups.map((group) => (
              <div className="inline-approval-permission-group tw:grid tw:gap-1" key={group.title}>
                <span className="inline-approval-permission-group-title tw:text-app-text-soft tw:type-label">
                  {group.title}
                </span>
                <ul className="inline-approval-permission-group-items tw:m-0 tw:grid tw:list-none tw:gap-1 tw:rounded-lg tw:bg-app-editor tw:px-3 tw:py-2 tw:text-app-text-soft tw:type-code tw:break-all">
                  {group.items.map((item) => (
                    <li className="tw:min-w-0 tw:truncate" key={item}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
        {actions}
      </RequestCard>
    )
  }

  return (
    <RequestCard
      title={approvalTitle}
      variant="permission"
      identity={identity}
      disabledReason={disabledReason}
      error={error}
      navigation={navigation}
    >
      {request.description && request.description !== approvalTitle ? (
        <p className="inline-approval-target tw:m-0 tw:px-2 tw:text-app-text-soft tw:type-body-sm tw:wrap-anywhere">
          {request.description}
        </p>
      ) : null}
      {request.autoReviewFallbackReason ? (
        <p className="inline-approval-target">
          自动审查无法完成，已转为人工审批：{request.autoReviewFallbackReason}
        </p>
      ) : null}
      {reviewSummary ? (
        <p className="inline-approval-target tw:m-0 tw:px-2 tw:text-app-text-soft tw:type-body-sm tw:wrap-anywhere">
          {reviewSummary}
        </p>
      ) : null}

      {fileDiffs.map((diff) => (
        <details key={diff.path} className="request-card-content">
          <summary>{diff.path} · 查看修改差异</summary>
          <FileMutationDiffBody diff={diff} diffMarkerStyle="color" />
        </details>
      ))}

      {request.toolIdentity ? (
        <div className="request-card-content">
          <p className="request-card-identity tw:m-0 tw:text-app-text-soft tw:type-body-sm">
            {request.toolIdentity.server} / {request.toolIdentity.tool}
          </p>
          {Object.entries(request.toolInput ?? {})
            .slice(0, 4)
            .map(([key, value]) => (
              <div key={key}>
                <span>{key}</span>
                <code className="inline-approval-command tw:block tw:w-full tw:min-w-0 tw:overflow-auto tw:bg-transparent tw:p-0 tw:text-app-text-soft tw:type-code tw:whitespace-pre-wrap tw:break-all">
                  {typeof value === 'string' ? value : JSON.stringify(value)}
                </code>
              </div>
            ))}
          <Button color="secondary" onClick={() => setDetailsOpen(true)}>
            查看全部参数
          </Button>
        </div>
      ) : (
        <div className="inline-approval-summary tw:flex tw:items-stretch tw:min-w-0 tw:p-0">
          <div
            id={commandPreviewId}
            ref={commandPreviewTransition.ref}
            className={
              isCommandExpanded
                ? 'inline-approval-command-preview expanded tw:grid tw:w-full tw:min-w-0 tw:gap-2 tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-editor tw:p-3 tw:transition-[height] tw:duration-disclosure tw:ease-disclosure'
                : 'inline-approval-command-preview tw:grid tw:w-full tw:min-w-0 tw:gap-2 tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-editor tw:p-3 tw:transition-[height] tw:duration-disclosure tw:ease-disclosure'
            }
            style={commandPreviewTransition.style}
          >
            <div className="inline-approval-command-preview-header tw:flex tw:min-w-0 tw:items-center tw:justify-between tw:gap-2 tw:text-app-text-soft tw:type-label">
              <span>{previewLabel}</span>
              <button
                aria-controls={commandPreviewId}
                type="button"
                aria-expanded={isCommandExpanded}
                className="tw:inline-flex tw:items-center tw:gap-1 tw:cursor-pointer tw:rounded-md tw:border-0 tw:bg-transparent tw:px-2 tw:py-1 tw:text-app-text-meta tw:type-body-sm tw:hover:bg-app-hover tw:hover:text-app-text"
                onClick={() => setIsCommandExpanded((value) => !value)}
              >
                {isCommandExpanded ? '折叠' : '展开'}
                {isCommandExpanded ? (
                  <ArrowUp size={APP_ICON_SIZE} />
                ) : (
                  <ArrowDown size={APP_ICON_SIZE} />
                )}
              </button>
            </div>
            <code
              className={cx(
                'inline-approval-command tw:block tw:w-full tw:min-w-0 tw:overflow-auto tw:bg-transparent tw:p-0 tw:text-app-text-soft tw:type-code tw:whitespace-pre-wrap tw:break-all',
                isCommandExpanded ? 'tw:max-h-80' : 'tw:max-h-[3lh]',
              )}
            >
              {command.full}
            </code>
          </div>
        </div>
      )}

      <ConfirmationDialog
        open={detailsOpen}
        title="工具参数"
        actionLabel="关闭"
        onAction={() => setDetailsOpen(false)}
        onCancel={() => setDetailsOpen(false)}
        description={
          <pre className="inline-approval-command tw:block tw:w-full tw:min-w-0 tw:overflow-auto tw:bg-transparent tw:p-0 tw:text-app-text-soft tw:type-code tw:whitespace-pre-wrap tw:break-all">
            {JSON.stringify(request.toolInput ?? request.input, null, 2)}
          </pre>
        }
      />

      {actions}
    </RequestCard>
  )
}

function inlineApprovalTitle(request: DesktopPermissionRequest): string {
  if (request.toolIdentity)
    return `允许 ${request.toolIdentity.server} / ${request.toolIdentity.tool}？`
  if (isCommandPermission(request)) return '需要运行命令，是否允许？'
  const affectedPaths = inlineApprovalAffectedPaths(request)
  if (affectedPaths.length > 0) {
    return `需要修改 ${affectedPaths.length} 个文件，是否允许？`
  }
  return request.description
}

function elicitationConfirmationDetails(value: unknown): React.ReactNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const presentation = value as Record<string, unknown>
  if (presentation.type !== 'confirmation' || !Array.isArray(presentation.changes)) return null
  if (
    presentation.changes.some(
      (change) =>
        !change ||
        typeof change !== 'object' ||
        typeof (change as Record<string, unknown>).label !== 'string',
    )
  )
    return null
  return (
    <div className="request-card-content">
      {typeof presentation.title === 'string' ? <p>{presentation.title}</p> : null}
      {presentation.changes.map((raw, index) => {
        const change = raw as { label: string; before?: unknown; after?: unknown }
        return (
          <div key={index}>
            <strong>{change.label}</strong>
            {typeof change.before === 'string' ? (
              <pre className="inline-approval-command tw:block tw:w-full tw:min-w-0 tw:overflow-auto tw:bg-transparent tw:p-0 tw:text-app-text-soft tw:type-code tw:whitespace-pre-wrap tw:break-all">
                {change.before}
              </pre>
            ) : null}
            {typeof change.after === 'string' ? (
              <pre className="inline-approval-command tw:block tw:w-full tw:min-w-0 tw:overflow-auto tw:bg-transparent tw:p-0 tw:text-app-text-soft tw:type-code tw:whitespace-pre-wrap tw:break-all">
                {change.after}
              </pre>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function inlineApprovalPreviewLabel(request: DesktopPermissionRequest): string {
  if (isCommandPermission(request)) return 'Shell'
  const affectedPaths = inlineApprovalAffectedPaths(request)
  return affectedPaths.length > 0 ? `影响文件（${affectedPaths.length}）` : request.toolName
}

function inlineApprovalReviewSummary(request: DesktopPermissionRequest): string | null {
  const value = request.input.reviewSummary
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const summary = value as Record<string, unknown>
  const fileCount = nonNegativeInteger(summary.fileCount)
  const hunkCount = nonNegativeInteger(summary.hunkCount)
  const additions = nonNegativeInteger(summary.additions)
  const deletions = nonNegativeInteger(summary.deletions)
  if (fileCount === null || hunkCount === null || additions === null || deletions === null)
    return null
  return `${fileCount} 个文件，${hunkCount} 个变更块，+${additions} -${deletions}`
}

function isCommandPermission(request: DesktopPermissionRequest): boolean {
  return (
    request.toolName === 'Bash' ||
    request.toolName === 'PowerShell' ||
    stringValue(request.input.command) !== null ||
    stringValue(request.input.cmd) !== null
  )
}

export function buildInlineApprovalCommand(
  request: DesktopPermissionRequest,
): InlineApprovalCommand {
  const full = formatCommandLine(request)
  return {
    full,
    hint: truncateCommand(full, COMMAND_HINT_MAX_LENGTH),
  }
}

function formatCommandLine(request: DesktopPermissionRequest): string {
  const { toolName, input } = request
  const affectedPaths = inlineApprovalAffectedPaths(request)
  if (affectedPaths.length > 0) {
    return affectedPaths
      .map(({ path, operation }) => `${operation === 'create' ? '新增' : '修改'} ${path}`)
      .join('\n')
  }
  if (toolName.toLowerCase() === 'apply_patch') {
    return 'apply_patch（未提供可展示的文件范围）'
  }
  const filePath = stringValue(input.file_path) ?? stringValue(input.filePath)
  const isFileTool =
    toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit' || toolName === 'Read'

  if (isFileTool) {
    return filePath ? `${toolName} ${filePath}` : toolName
  }

  const parts: string[] = [toolName]
  for (const [key, value] of Object.entries(input)) {
    if (key === 'file_path' || key === 'filePath') continue
    const flag = key.length === 1 ? `-${key}` : `-${key}`
    if (typeof value === 'string') {
      parts.push(`${flag} ${quoteIfNeeded(value)}`)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${flag} ${String(value)}`)
    } else if (value !== null && value !== undefined) {
      parts.push(`${flag} ${JSON.stringify(value)}`)
    }
  }
  return parts.join(' ')
}

function quoteIfNeeded(value: string): string {
  if (value === '') return "''"
  if (/[\s'"$`]/.test(value)) {
    return `'${value.replace(/'/g, "''")}'`
  }
  return value
}

function truncateCommand(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}…`
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function inlineApprovalAffectedPaths(
  request: DesktopPermissionRequest,
): Array<{ path: string; operation: 'create' | 'update' }> {
  const value = request.input.affectedPaths
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return []
    }
    const affected = candidate as Record<string, unknown>
    const path = stringValue(affected.path)
    const operation = affected.operation
    return path && (operation === 'create' || operation === 'update') ? [{ path, operation }] : []
  })
}
