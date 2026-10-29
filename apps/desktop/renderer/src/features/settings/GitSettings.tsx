import { useMemo } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import {
  isSettingsSaveShortcut,
  useDesktopSettingsField,
  useDesktopSettingsDraftActions,
  useDesktopSettingsDraftValue,
  useDesktopSettingsDraftDirty,
  useDesktopSettingsDraftSaving,
} from './UseDesktopSettings.js'
import {
  desktopClient,
  desktopClipboard,
  startGithubLoginFlow,
} from '../../services/desktop-client/index.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import type {
  DesktopGithubAuthMode,
  DesktopGithubAuthStatus,
  DesktopGithubLoginStatus,
} from '../../../shared/Types.js'
import { Button } from '../../components/ui/Button.js'
import { Input } from '../../components/ui/Input.js'

const PR_MERGE_OPTIONS: Array<{ value: 'merge' | 'squash'; label: string }> = [
  { value: 'merge', label: '合并' },
  { value: 'squash', label: '压缩' },
]

export function GitSettings(): React.ReactNode {
  const subscribedDraftActions = useDesktopSettingsDraftActions()
  const subscribedGitBranchPrefix = useDesktopSettingsDraftValue('gitBranchPrefix')
  const subscribedGitPrMergeMethod = useDesktopSettingsDraftValue('gitPrMergeMethod')
  const subscribedGitShowPrIconsInSidebar = useDesktopSettingsDraftValue('gitShowPrIconsInSidebar')
  const subscribedGitDraftPullRequest = useDesktopSettingsDraftValue('gitDraftPullRequest')
  const subscribedAllowForcePush = useDesktopSettingsDraftValue('allowForcePush')
  const subscribedCommitMessagePrompt = useDesktopSettingsDraftValue('commitMessagePrompt')
  const subscribedPullRequestPrompt = useDesktopSettingsDraftValue('pullRequestPrompt')
  const subscribedDraftDirty = useDesktopSettingsDraftDirty()
  const subscribedDraftSaving = useDesktopSettingsDraftSaving()
  const draft = useMemo(
    () => ({
      ...subscribedDraftActions,
      values: {
        gitBranchPrefix: subscribedGitBranchPrefix,
        gitPrMergeMethod: subscribedGitPrMergeMethod,
        gitShowPrIconsInSidebar: subscribedGitShowPrIconsInSidebar,
        gitDraftPullRequest: subscribedGitDraftPullRequest,
        allowForcePush: subscribedAllowForcePush,
        commitMessagePrompt: subscribedCommitMessagePrompt,
        pullRequestPrompt: subscribedPullRequestPrompt,
      },
      dirty: subscribedDraftDirty,
      saving: subscribedDraftSaving,
    }),
    [
      subscribedDraftActions,
      subscribedGitBranchPrefix,
      subscribedGitPrMergeMethod,
      subscribedGitShowPrIconsInSidebar,
      subscribedGitDraftPullRequest,
      subscribedAllowForcePush,
      subscribedCommitMessagePrompt,
      subscribedPullRequestPrompt,
      subscribedDraftDirty,
      subscribedDraftSaving,
    ],
  )
  const subscribedCommitMessagePrompt2 = useDesktopSettingsField((s) => s.commitMessagePrompt)
  const subscribedPullRequestPrompt2 = useDesktopSettingsField((s) => s.pullRequestPrompt)
  const settings = useMemo(
    () => ({
      commitMessagePrompt: subscribedCommitMessagePrompt2,
      pullRequestPrompt: subscribedPullRequestPrompt2,
    }),
    [subscribedCommitMessagePrompt2, subscribedPullRequestPrompt2],
  )
  const [saveError, setSaveError] = useState<string | null>(null)
  const save = useCallback(
    async (keys: Parameters<typeof draft.saveFields>[0]) => {
      try {
        await draft.saveFields(keys)
        setSaveError(null)
      } catch (cause) {
        setSaveError(cause instanceof Error ? cause.message : '保存失败')
      }
    },
    [draft.saveFields],
  )
  const {
    gitBranchPrefix,
    gitPrMergeMethod,
    gitShowPrIconsInSidebar,
    gitDraftPullRequest,
    allowForcePush,
    commitMessagePrompt,
    pullRequestPrompt,
  } = draft.values
  const [githubAuth, setGithubAuth] = useState<DesktopGithubAuthStatus | null>(null)
  const [githubLogin, setGithubLogin] = useState<DesktopGithubLoginStatus | null>(null)
  const [githubBusy, setGithubBusy] = useState(false)
  useEffect(() => {
    const keys = (['commitMessagePrompt', 'pullRequestPrompt'] as const).filter(
      (key) => draft.values[key] !== settings[key],
    )
    if (!keys.length) return
    const timer = window.setTimeout(() => void save(keys), 3000)
    return () => window.clearTimeout(timer)
  }, [
    commitMessagePrompt,
    pullRequestPrompt,
    settings.commitMessagePrompt,
    settings.pullRequestPrompt,
    save,
  ])

  useEffect(() => {
    let mounted = true
    void desktopClient.getGithubAuthStatus().then((status) => {
      if (mounted) setGithubAuth(status)
    })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!githubLogin || githubLogin.state !== 'awaiting_auth') {
      return
    }
    const timer = window.setInterval(() => {
      void desktopClient.pollGithubLogin().then((status) => {
        setGithubLogin(status)
        if (status.auth) {
          setGithubAuth(status.auth)
        }
      })
    }, 2000)
    return () => window.clearInterval(timer)
  }, [githubLogin])

  const startGithubLogin = async (mode: DesktopGithubAuthMode): Promise<void> => {
    setGithubBusy(true)
    try {
      const status = await startGithubLoginFlow(desktopClient, mode)
      setGithubLogin(status)
      if (status.auth) {
        setGithubAuth(status.auth)
      }
    } finally {
      setGithubBusy(false)
    }
  }

  const logoutGithub = async (): Promise<void> => {
    setGithubBusy(true)
    try {
      const status = await desktopClient.logoutGithub()
      setGithubAuth(status)
      setGithubLogin(null)
    } finally {
      setGithubBusy(false)
    }
  }

  const githubStatusText = githubAuth?.authenticated
    ? `已登录 ${githubAuth.user?.login ?? 'GitHub'}`
    : githubLogin?.state === 'failed'
      ? '登录失败'
      : '未登录'
  const activeDeviceLogin =
    githubLogin?.mode === 'device' && githubLogin.state === 'awaiting_auth' && githubLogin.userCode

  const copyGithubCode = async (): Promise<void> => {
    if (!githubLogin?.userCode) return
    await desktopClipboard.writeText(githubLogin.userCode)
  }

  const openGithubDevicePage = async (): Promise<void> => {
    if (!githubLogin?.verificationUri) return
    await desktopClient.openExternalURL(githubLogin.verificationUri)
  }

  return (
    <SettingsContentArea className="">
      <div
        className="settings-content-inner tw:@container tw:w-full tw:min-w-0 tw:mx-auto tw:p-5 tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]"
        onKeyDown={(event) => {
          if (isSettingsSaveShortcut(event)) {
            event.preventDefault()
            void save(['gitBranchPrefix', 'commitMessagePrompt', 'pullRequestPrompt'])
          }
        }}
      >
        <div className="settings-page-header tw:mt-0 tw:mx-0 tw:mb-8 tw:grid tw:gap-2">
          <h2 className="settings-page-title tw:m-0 tw:type-page-title tw:text-app-text">
            Git
          </h2>
        </div>

        <SettingsSection>
          <SettingsRow
            title="分支前缀"
            description="在 Pidex 中创建新分支时使用的前缀"
            control={
              <Input
                className="settings-input-narrow"
                value={gitBranchPrefix}
                placeholder="pidex/"
                onBlur={() => void save(['gitBranchPrefix'])}
                onChange={(event) => draft.setValue('gitBranchPrefix', event.target.value)}
              />
            }
          />
          <SettingsRow
            title="拉取请求合并方法"
            description="选择 Pidex 合并拉取请求的方法"
            autoSave
            control={
              <SegmentedControl
                value={gitPrMergeMethod}
                options={PR_MERGE_OPTIONS}
                onChange={(value) => {
                  draft.setValue('gitPrMergeMethod', value)
                  void save(['gitPrMergeMethod'])
                }}
              />
            }
          />
          <SettingsRow
            title="在侧边栏显示 PR 图标"
            description="在侧边栏的对话行中显示 PR 状态图标"
            autoSave
            control={
              <ToggleSwitch
                checked={gitShowPrIconsInSidebar}
                onChange={(value) => {
                  draft.setValue('gitShowPrIconsInSidebar', value)
                  void save(['gitShowPrIconsInSidebar'])
                }}
                ariaLabel="在侧边栏显示 PR 图标"
              />
            }
          />
          <SettingsRow
            title="始终强制推送"
            description="从 Pidex 推送时使用 --force-with-lease 参数"
            autoSave
            control={
              <ToggleSwitch
                checked={allowForcePush}
                onChange={(value) => {
                  draft.setValue('allowForcePush', value)
                  void save(['allowForcePush'])
                }}
                ariaLabel="始终强制推送"
              />
            }
          />
          <SettingsRow
            title="创建草稿拉取请求"
            description="从 Pidex 创建 PR 时默认使用草稿拉取请求"
            autoSave
            control={
              <ToggleSwitch
                checked={gitDraftPullRequest}
                onChange={(value) => {
                  draft.setValue('gitDraftPullRequest', value)
                  void save(['gitDraftPullRequest'])
                }}
                ariaLabel="创建草稿拉取请求"
              />
            }
          />
        </SettingsSection>
        {saveError ? (
          <p role="alert" className="tw:type-body-sm tw:text-app-danger">
            {saveError}
          </p>
        ) : null}
        <SettingsSection>
          <SettingsRow
            title="提交指令"
            variant="stacked"
            description="已添加到提交信息生成提示中"
            control={
              <div className="settings-git-instruction-control tw:flex tw:flex-wrap tw:items-end tw:justify-end tw:gap-2 tw:[&_.settings-textarea]:min-w-0 tw:[&_.settings-textarea]:flex-[1_1_240px]">
                <textarea
                  className="settings-textarea"
                  rows={6}
                  value={commitMessagePrompt}
                  placeholder="添加提交消息指引..."
                  onChange={(event) => draft.setValue('commitMessagePrompt', event.target.value)}
                />
              </div>
            }
          />
          <SettingsRow
            title="拉取请求指令"
            variant="stacked"
            description="已添加到 PR 标题/描述生成提示中"
            control={
              <div className="settings-git-instruction-control tw:flex tw:flex-wrap tw:items-end tw:justify-end tw:gap-2 tw:[&_.settings-textarea]:min-w-0 tw:[&_.settings-textarea]:flex-[1_1_240px]">
                <textarea
                  className="settings-textarea"
                  rows={6}
                  value={pullRequestPrompt}
                  placeholder="添加拉取请求消息指引..."
                  onChange={(event) => draft.setValue('pullRequestPrompt', event.target.value)}
                />
              </div>
            }
          />
        </SettingsSection>

        <SettingsSection
          title="GitHub 账号"
          description="登录后可在项目选择器中列出并克隆你有权限访问的 GitHub 仓库。"
        >
          {activeDeviceLogin ? (
            <div className="github-device-code-card tw:flex tw:items-center tw:justify-between tw:gap-4 tw:bg-app-raised tw:[&_p]:mt-2 tw:[&_p]:mb-0 tw:[&_p]:text-app-text-soft tw:[&_p]:type-body-sm tw:[&_p]:leading-[var(--cpx-sys-line-height-tight)] tw:border-b tw:border-b-app-border-subtle tw:p-4">
              <div>
                <div className="github-device-code-label tw:mb-1 tw:text-app-text-soft tw:text-[length:var(--cpx-sys-font-size-xs)]">
                  GitHub 设备验证码
                </div>
                <div className="github-device-code-value tw:font-mono tw:text-[length:var(--cpx-sys-font-size-3xl)] tw:type-weight-heading tw:tracking-[0.08em] tw:text-app-text">
                  {githubLogin.userCode}
                </div>
                <p>在 GitHub 打开的设备登录页面输入这个验证码，不是 OAuth Client ID。</p>
              </div>
              <div className="github-device-code-actions tw:flex tw:shrink-0 tw:items-center tw:gap-2">
                <Button color="secondary" onClick={() => void copyGithubCode()} type="button">
                  复制验证码
                </Button>
                <Button color="secondary" onClick={() => void openGithubDevicePage()} type="button">
                  打开验证页面
                </Button>
              </div>
            </div>
          ) : null}
          <SettingsRow
            title="登录状态"
            description={
              activeDeviceLogin
                ? `请在打开的 GitHub 页面输入验证码 ${githubLogin.userCode}`
                : (githubLogin?.error ??
                  githubAuth?.error ??
                  '浏览器授权完成后，GitHub token 只会加密保存在本机。')
            }
            control={
              <div className="settings-inline-actions tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2 tw:max-[900px]:justify-start">
                <span className="settings-row-status">{githubStatusText}</span>
                {githubAuth?.authenticated ? (
                  <Button
                    color="danger"
                    disabled={githubBusy}
                    onClick={() => void logoutGithub()}
                    type="button"
                  >
                    退出
                  </Button>
                ) : (
                  <>
                    <Button
                      color="primary"
                      disabled={githubBusy}
                      onClick={() => void startGithubLogin('browser')}
                      type="button"
                    >
                      登录 GitHub
                    </Button>
                    <Button
                      color="secondary"
                      disabled={githubBusy}
                      onClick={() => void startGithubLogin('device')}
                      type="button"
                    >
                      使用设备验证码
                    </Button>
                  </>
                )}
              </div>
            }
          />
        </SettingsSection>
      </div>
    </SettingsContentArea>
  )
}
