import * as Dialog from '@radix-ui/react-dialog'
import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { GitFork, Lock, Unlock } from 'lucide-react'
import {
  desktopClipboard,
  desktopClient,
  startGithubLoginFlow,
} from '../../../services/desktop-client/index.js'
import type {
  DesktopGithubAuthMode,
  DesktopGithubAuthStatus,
  DesktopGithubLoginStatus,
  DesktopGithubRepository,
  DesktopWorkspace,
} from '../../../../shared/Types.js'
import { APP_ICON_SIZE } from '../../../components/ui/IconTokens.js'
import { SearchInput } from '../../../components/ui/SearchInput.js'
import { Button } from '../../../components/ui/Button.js'
import { cx } from '../../../utils/Cx.js'
import { useDialogFocusRestore } from '../../../components/ui/UseDialogFocusRestore.js'
import { errorMessageOf } from '@pidex/shared/errors'

type Props = {
  open: boolean
  onClose: () => void
  onError: (message: string) => void
  onWorkspaceCloned: (workspace: DesktopWorkspace) => void
}

export function GithubRepositoryModal({
  open,
  onClose,
  onError,
  onWorkspaceCloned,
}: Props): React.ReactNode {
  const [auth, setAuth] = useState<DesktopGithubAuthStatus | null>(null)
  const [login, setLogin] = useState<DesktopGithubLoginStatus | null>(null)
  const [repositories, setRepositories] = useState<DesktopGithubRepository[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [cloningRepo, setCloningRepo] = useState<string | null>(null)
  const { onCloseAutoFocus } = useDialogFocusRestore(open)

  useEffect(() => {
    if (!open) return
    setSearch('')
    setLogin(null)
    void refreshAuth()
  }, [open])

  useEffect(() => {
    if (!auth?.authenticated || !open) return
    void loadRepositories()
  }, [auth?.authenticated, open])

  useEffect(() => {
    if (!login || login.state !== 'awaiting_auth') return
    const timer = window.setInterval(() => {
      void desktopClient.pollGithubLogin().then((status) => {
        setLogin(status)
        if (status.auth) {
          setAuth(status.auth)
        }
        if (status.state === 'failed' && status.error) {
          onError(status.error)
        }
      })
    }, 2000)
    return () => window.clearInterval(timer)
  }, [login, onError])

  const filteredRepositories = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return repositories
    return repositories.filter((repo) =>
      [repo.fullName, repo.description ?? '', repo.defaultBranch]
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    )
  }, [repositories, search])

  async function refreshAuth(): Promise<void> {
    setLoading(true)
    try {
      setAuth(await desktopClient.getGithubAuthStatus())
    } catch (error) {
      onError(errorMessageOf(error))
    } finally {
      setLoading(false)
    }
  }

  async function loadRepositories(): Promise<void> {
    setLoading(true)
    try {
      const result = await desktopClient.listGithubRepositories()
      if (result.ok === false) {
        onError(result.error)
        return
      }
      setRepositories(result.repositories)
    } catch (error) {
      onError(errorMessageOf(error))
    } finally {
      setLoading(false)
    }
  }

  async function startLogin(mode: DesktopGithubAuthMode): Promise<void> {
    setLoading(true)
    try {
      const status = await startGithubLoginFlow(desktopClient, mode)
      setLogin(status)
      if (status.auth) {
        setAuth(status.auth)
      }
      if (status.state === 'failed' && status.error) {
        onError(status.error)
      }
    } catch (error) {
      onError(errorMessageOf(error))
    } finally {
      setLoading(false)
    }
  }

  async function copyGithubCode(): Promise<void> {
    if (!login?.userCode) return
    await desktopClipboard.writeText(login.userCode)
  }

  async function openGithubDevicePage(): Promise<void> {
    if (!login?.verificationUri) return
    await desktopClient.openExternalURL(login.verificationUri)
  }

  async function cloneRepository(repository: DesktopGithubRepository): Promise<void> {
    setCloningRepo(repository.fullName)
    try {
      const result = await desktopClient.cloneGithubRepository({ repository })
      if (result.ok === false) {
        onError(result.error)
        return
      }
      onWorkspaceCloned(result.workspace)
      onClose()
    } catch (error) {
      onError(errorMessageOf(error))
    } finally {
      setCloningRepo(null)
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
        <Dialog.Content
          aria-describedby="github-repository-description"
          className="ui-dialog-surface ui-dialog-surface--centered permission-modal github-repository-modal"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <header className={cx('tw:flex', 'tw:items-center', 'tw:justify-between', 'tw:gap-3')}>
            <Dialog.Title asChild>
              <h2>从 GitHub 克隆项目</h2>
            </Dialog.Title>
            {auth?.authenticated ? <span>{auth.user?.login}</span> : <span>GitHub</span>}
          </header>
          <Dialog.Description id="github-repository-description">
            登录 GitHub 后选择你有权限访问的仓库，软件会让你选择本地克隆目录。
          </Dialog.Description>

          {!auth?.authenticated ? (
            <div className="github-login-panel">
              <GitFork size={APP_ICON_SIZE} />
              <div>
                <h3>登录 GitHub</h3>
                <p>
                  {login?.error
                    ? login.error
                    : login?.mode === 'device' && login.state === 'awaiting_auth' && login.userCode
                      ? `请在打开的 GitHub 页面输入验证码 ${login.userCode}`
                      : '在系统浏览器中授权后，可列出并克隆私有仓库。'}
                </p>
                {login?.mode === 'device' && login.state === 'awaiting_auth' && login.userCode ? (
                  <div className="github-device-code-card compact tw:flex tw:items-center tw:justify-between tw:gap-4 tw:bg-app-raised tw:[&_p]:mt-2 tw:[&_p]:mb-0 tw:[&_p]:text-app-text-soft tw:[&_p]:type-body-sm tw:[&_p]:leading-[var(--cpx-sys-line-height-tight)] tw:mt-3 tw:rounded-md tw:border tw:border-app-border-subtle tw:p-3">
                    <div>
                      <div className="github-device-code-label tw:mb-1 tw:text-app-text-soft tw:text-[length:var(--cpx-sys-font-size-xs)]">
                        GitHub 设备验证码
                      </div>
                      <div className="github-device-code-value tw:font-mono tw:text-[length:var(--cpx-sys-font-size-3xl)] tw:type-weight-heading tw:tracking-[0.08em] tw:text-app-text">
                        {login.userCode}
                      </div>
                      <p>在 GitHub 设备登录页面输入这个验证码，不是 OAuth Client ID。</p>
                    </div>
                    <div className="github-device-code-actions tw:flex tw:shrink-0 tw:items-center tw:gap-2">
                      <Button
                        size="md"
                        color="secondary"
                        onClick={() => void copyGithubCode()}
                        type="button"
                      >
                        复制验证码
                      </Button>
                      <Button
                        size="md"
                        color="secondary"
                        onClick={() => void openGithubDevicePage()}
                        type="button"
                      >
                        打开验证页面
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="settings-inline-actions tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2 tw:max-[900px]:justify-start">
                <Button
                  size="md"
                  color="primary"
                  disabled={loading}
                  onClick={() => void startLogin('browser')}
                  type="button"
                >
                  登录 GitHub
                </Button>
                {login?.state === 'failed' ? (
                  <Button
                    size="md"
                    color="secondary"
                    disabled={loading}
                    onClick={() => void startLogin('device')}
                    type="button"
                  >
                    使用设备验证码
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <SearchInput
                aria-label="搜索仓库"
                className="github-repository-search"
                onChange={setSearch}
                placeholder="搜索仓库"
                value={search}
                variant="standard"
              />
              <div className="github-repository-list-scroll-area">
                <div
                  className={cx('github-repository-list-scroll-content', 'tw:min-w-0', 'tw:grid')}
                >
                  {loading ? (
                    <div className={cx('github-repository-empty', 'tw:p-5', 'tw:text-center')}>
                      正在加载仓库...
                    </div>
                  ) : filteredRepositories.length === 0 ? (
                    <div className={cx('github-repository-empty', 'tw:p-5', 'tw:text-center')}>
                      没有匹配仓库
                    </div>
                  ) : (
                    filteredRepositories.map((repository) => (
                      <div className="github-repository-row" key={repository.id}>
                        <div className="github-repository-main">
                          <div
                            className={cx(
                              'github-repository-title',
                              'tw:min-w-0',
                              'tw:flex',
                              'tw:items-center',
                              'tw:gap-2',
                            )}
                          >
                            {repository.private ? (
                              <Lock size={APP_ICON_SIZE} />
                            ) : (
                              <Unlock size={APP_ICON_SIZE} />
                            )}
                            <strong>{repository.fullName}</strong>
                            {repository.fork ? <span>Fork</span> : null}
                          </div>
                          <p>{repository.description ?? '无描述'}</p>
                          <small>
                            {repository.defaultBranch}
                            {repository.pushedAt ? ` · ${formatDate(repository.pushedAt)}` : ''}
                          </small>
                        </div>
                        <Button
                          size="md"
                          color="primary"
                          disabled={Boolean(cloningRepo)}
                          onClick={() => void cloneRepository(repository)}
                          type="button"
                        >
                          {cloningRepo === repository.fullName ? '克隆中...' : '克隆'}
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}

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
              <Button size="md" color="secondary">
                关闭
              </Button>
            </Dialog.Close>
            {auth?.authenticated ? (
              <Button
                size="md"
                color="secondary"
                onClick={() => void loadRepositories()}
                type="button"
              >
                刷新
              </Button>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString()
}
