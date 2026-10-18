import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { DesktopGitStatus, DesktopWorkspace } from '../../../../shared/Types.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { Checkbox } from '../../../components/ui/Checkbox.js'
import { Input } from '../../../components/ui/Input.js'
import { Textarea } from '../../../components/ui/Textarea.js'
import { Button } from '../../../components/ui/Button.js'
import { cx } from '../../../utils/Cx.js'
import { useDialogFocusRestore } from '../../../components/ui/UseDialogFocusRestore.js'
import { useLastNonNull } from '../../../hooks/UsePresenceRetention.js'
import { environmentDomainClient } from '../../../services/desktop-client/EnvironmentDomainClient.js'
import { useDesktopSettings } from '../../settings/UseDesktopSettings.js'

export type GitWorkflowMode = 'branch' | 'commitPush' | 'commit' | 'push' | 'pullRequest'

const EMPTY_CHANGES: DesktopGitStatus['files'] = []

type Props = {
  mode: GitWorkflowMode | null
  workspace: DesktopWorkspace | null
  threadId?: string | null
  gitStatus: DesktopGitStatus | null
  gitBranchPrefix: string
  allowForcePush: boolean
  commitMessagePrompt: string
  pullRequestPrompt: string
  onClose: () => void
  onError: (message: string) => void
  onWorkspaceChanged: (workspace: DesktopWorkspace) => Promise<void>
  onRefreshWorkspace: () => Promise<void>
}

export function GitWorkflowModal({
  mode: currentMode,
  workspace,
  threadId,
  gitStatus,
  gitBranchPrefix,
  allowForcePush,
  onClose,
  onError,
  onWorkspaceChanged,
  onRefreshWorkspace,
}: Props): React.ReactNode {
  const retainedMode = useLastNonNull(currentMode)
  const settings = useDesktopSettings()
  const open = currentMode !== null
  const mode = open ? currentMode : retainedMode
  const [branchName, setBranchName] = useState(gitBranchPrefix)
  const [commitMessage, setCommitMessage] = useState('')
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [setUpstream, setSetUpstream] = useState(false)
  const [forceWithLease, setForceWithLease] = useState(false)
  const [prTitle, setPrTitle] = useState('')
  const [prTitleEdited, setPrTitleEdited] = useState(false)
  const [prBody, setPrBody] = useState('')
  const [draftPr, setDraftPr] = useState(settings.gitDraftPullRequest)
  const [localError, setLocalError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const changedFiles = gitStatus?.files ?? EMPTY_CHANGES
  const { onCloseAutoFocus } = useDialogFocusRestore(open)
  const title =
    mode === 'branch'
      ? '创建分支'
      : mode === 'pullRequest'
        ? '创建 Pull Request'
        : mode === 'commit'
          ? '提交'
          : mode === 'push'
            ? '推送'
            : '提交或推送'

  useEffect(() => {
    if (!open) return
    setLocalError(null)
    setIsSubmitting(false)
    setBranchName(gitBranchPrefix)
    setCommitMessage('')
    setSelectedPaths(changedFiles.map((file) => file.path))
    setSetUpstream(!gitStatus?.upstream)
    setForceWithLease(false)
    setPrTitle(gitStatus?.branchName ?? '')
    setPrTitleEdited(false)
    setPrBody('')
    setDraftPr(settings.gitDraftPullRequest)
  }, [open, currentMode, workspace?.path])

  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths])
  async function generateMessage(): Promise<void> {
    if (!workspace?.projectId) return
    await runOperation(async () => {
      const generated = await environmentDomainClient().generateGitMessage({
        projectId: workspace.projectId!,
        ...(threadId ? { threadId } : {}),
        kind: mode === 'pullRequest' ? 'pullRequest' : 'commit',
        ...(mode === 'pullRequest' ? {} : { paths: selectedPaths }),
      })
      if (mode === 'pullRequest') {
        setPrTitle(generated.title)
        setPrBody(generated.body)
      } else setCommitMessage([generated.title, generated.body].filter(Boolean).join('\n\n'))
    })
  }

  async function submitBranch(): Promise<void> {
    if (!workspace) return
    await runOperation(async () => {
      const result = await desktopClient.createWorkspaceBranch({
        ...(workspace.projectId ? { projectId: workspace.projectId } : {}),
        workspacePath: workspace.path,
        branchName,
      })
      if ('error' in result) {
        throw new Error(result.error)
      }
      await onWorkspaceChanged(result.workspace)
      onClose()
    })
  }

  async function submitCommit(): Promise<void> {
    if (!workspace) return
    await runOperation(async () => {
      const result = await desktopClient.commitWorkspaceChanges({
        ...(workspace.projectId ? { projectId: workspace.projectId } : {}),
        workspacePath: workspace.path,
        message: commitMessage,
        paths: selectedPaths,
      })
      if ('error' in result) {
        throw new Error(result.error)
      }
      await onRefreshWorkspace()
      onClose()
    })
  }

  async function submitPush(): Promise<void> {
    if (!workspace) return
    await runOperation(async () => {
      const result = await desktopClient.pushWorkspaceBranch({
        ...(workspace.projectId ? { projectId: workspace.projectId } : {}),
        workspacePath: workspace.path,
        setUpstream,
        forceWithLease,
        ...(threadId ? { threadId } : {}),
      })
      if ('error' in result) {
        throw new Error(result.error)
      }
      await onRefreshWorkspace()
      onClose()
    })
  }

  async function submitPullRequest(): Promise<void> {
    if (!workspace) return
    await runOperation(async () => {
      const result = await desktopClient.createPullRequest({
        ...(workspace.projectId ? { projectId: workspace.projectId } : {}),
        workspacePath: workspace.path,
        title: prTitle,
        body: prBody,
        draft: draftPr,
        ...(threadId ? { threadId } : {}),
      })
      if ('error' in result) {
        throw new Error(result.error)
      }
      await desktopClient.openExternalURL(result.url)
      onClose()
    })
  }

  async function runOperation(operation: () => Promise<void>): Promise<void> {
    setLocalError(null)
    setIsSubmitting(true)
    try {
      await operation()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLocalError(message)
      onError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  function togglePath(path: string): void {
    setSelectedPaths((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path],
    )
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isSubmitting) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
        <Dialog.Content
          aria-describedby="git-workflow-description"
          className="ui-dialog-surface ui-dialog-surface--centered permission-modal tw:grid tw:w-[min(40rem,calc(100%-3rem))] tw:max-h-[calc(100dvh-3rem)] tw:gap-4 tw:overflow-y-auto tw:p-5 tw:type-body"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <header className={cx('tw:flex', 'tw:items-center', 'tw:justify-between', 'tw:gap-3')}>
            <Dialog.Title asChild>
              <h2 className="tw:m-0 tw:type-title-sm">{title}</h2>
            </Dialog.Title>
            <span className="tw:max-w-[50%] tw:truncate tw:type-caption">
              {workspace?.name ?? '无项目'}
            </span>
          </header>
          <Dialog.Description
            id="git-workflow-description"
            className="tw:m-0 tw:break-all tw:type-caption tw:text-app-text-meta"
          >
            {workspace?.path ?? '请选择一个本地项目后再操作 Git。'}
          </Dialog.Description>
          {(mode === 'push' || mode === 'commitPush') && (
            <p className="tw:m-0 tw:type-body-sm tw:text-app-text-meta">
              当前分支：{gitStatus?.branchName ?? 'detached HEAD'} · 上游：
              {gitStatus?.upstream ?? '未设置'}
            </p>
          )}
          {localError ? <div className="git-workflow-error">{localError}</div> : null}
          {(mode === 'commit' || mode === 'commitPush' || mode === 'pullRequest') && (
            <Button
              size="md"
              color="secondary"
              title="清空已有内容后可以重新生成"
              disabled={
                isSubmitting ||
                !workspace?.projectId ||
                (mode === 'pullRequest'
                  ? !!prBody.trim() || (prTitleEdited && !!prTitle.trim())
                  : !!commitMessage.trim())
              }
              onClick={() => void generateMessage()}
            >
              生成{mode === 'pullRequest' ? ' PR 标题与说明' : '提交信息'}
            </Button>
          )}
          {mode === 'branch' ? (
            <div className={cx('tw:grid', 'tw:gap-3')}>
              <label className="tw:grid tw:min-w-0 tw:gap-2 tw:type-body-sm">
                <span>分支名称</span>
                <Input
                  disabled={isSubmitting}
                  value={branchName}
                  onChange={(event) => setBranchName(event.target.value)}
                />
              </label>
            </div>
          ) : null}
          {mode === 'commitPush' || mode === 'commit' || mode === 'push' ? (
            <div className={cx('tw:grid', 'tw:gap-3')}>
              {mode !== 'push' ? (
                <>
                  <label className="tw:grid tw:min-w-0 tw:gap-2 tw:type-body-sm">
                    <span>提交信息</span>
                    <Textarea
                      rows={4}
                      className="tw:w-full tw:resize-y"
                      value={commitMessage}
                      disabled={isSubmitting}
                      onChange={(event) => setCommitMessage(event.target.value)}
                    />
                  </label>
                  <div className="git-workflow-files-scroll-area">
                    <div className="git-workflow-files-scroll-content">
                      <div className="tw:flex tw:items-center tw:justify-between tw:gap-2">
                        <strong>变更文件</strong>
                        <Button
                          variant="text"
                          disabled={isSubmitting}
                          type="button"
                          onClick={() => setSelectedPaths(changedFiles.map((file) => file.path))}
                        >
                          全选
                        </Button>
                      </div>
                      {changedFiles.length === 0 ? (
                        <p>当前没有可提交的文件。</p>
                      ) : (
                        changedFiles.map((file) => (
                          <label
                            key={`${file.status}:${file.path}`}
                            className="tw:flex tw:min-w-0 tw:items-center tw:gap-2"
                          >
                            <Checkbox
                              checked={selectedPathSet.has(file.path)}
                              disabled={isSubmitting}
                              ariaLabel={file.path}
                              onCheckedChange={() => togglePath(file.path)}
                            />
                            <span
                              className="tw:min-w-0 tw:flex-1 tw:truncate tw:type-body-sm"
                              title={file.path}
                            >
                              {file.path}
                            </span>
                            <small>{file.status.trim() || 'M'}</small>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                </>
              ) : null}
              {mode !== 'commit' ? (
                <>
                  <Checkbox
                    checked={setUpstream}
                    disabled={isSubmitting}
                    onCheckedChange={(checked) => setSetUpstream(checked === true)}
                  >
                    首次推送时设置 upstream
                  </Checkbox>
                  {allowForcePush ? (
                    <Checkbox
                      checked={forceWithLease}
                      disabled={isSubmitting}
                      onCheckedChange={(checked) => setForceWithLease(checked === true)}
                    >
                      使用 --force-with-lease
                    </Checkbox>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
          {mode === 'pullRequest' ? (
            <div className={cx('tw:grid', 'tw:gap-3')}>
              <label className="tw:grid tw:min-w-0 tw:gap-2 tw:type-body-sm">
                <span>标题</span>
                <Input
                  disabled={isSubmitting}
                  value={prTitle}
                  onChange={(event) => {
                    setPrTitleEdited(true)
                    setPrTitle(event.target.value)
                  }}
                />
              </label>
              <label className="tw:grid tw:min-w-0 tw:gap-2 tw:type-body-sm">
                <span>描述</span>
                <Textarea
                  rows={4}
                  className="tw:w-full tw:resize-y"
                  disabled={isSubmitting}
                  value={prBody}
                  onChange={(event) => setPrBody(event.target.value)}
                />
              </label>
              <Checkbox
                checked={draftPr}
                disabled={isSubmitting}
                onCheckedChange={(checked) => setDraftPr(checked === true)}
              >
                创建为 draft PR
              </Checkbox>
            </div>
          ) : null}
          <div
            className={cx(
              'permission-modal-actions',
              'tw:flex',
              'tw:items-center',
              'tw:justify-between',
              'tw:gap-3',
            )}
          >
            <Dialog.Close asChild>
              <Button size="md" color="secondary" disabled={isSubmitting}>
                取消
              </Button>
            </Dialog.Close>
            {mode === 'commitPush' || mode === 'commit' || mode === 'push' ? (
              <>
                {mode !== 'push' ? (
                  <Button
                    size="md"
                    color="secondary"
                    disabled={isSubmitting || selectedPaths.length === 0 || !commitMessage.trim()}
                    type="button"
                    onClick={() => void submitCommit()}
                  >
                    提交选中文件
                  </Button>
                ) : null}
                {mode !== 'commit' ? (
                  <Button
                    size="md"
                    color="primary"
                    disabled={isSubmitting}
                    type="button"
                    onClick={() => void submitPush()}
                  >
                    推送
                  </Button>
                ) : null}
              </>
            ) : (
              <Button
                size="md"
                color="primary"
                disabled={isSubmitting}
                type="button"
                onClick={() => void (mode === 'branch' ? submitBranch() : submitPullRequest())}
              >
                {mode === 'branch' ? '创建并检出' : '创建 PR'}
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
