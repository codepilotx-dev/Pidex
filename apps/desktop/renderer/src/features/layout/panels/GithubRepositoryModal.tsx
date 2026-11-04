import * as Dialog from '@radix-ui/react-dialog'
import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { GitFork, Lock, Unlock } from 'lucide-react'
import { desktopClient } from '../../../services/desktop-client/index.js'
import type { DesktopGithubRepository, DesktopWorkspace } from '../../../../shared/Types.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/IconTokens.js'
import { SearchInput } from '../../../components/ui/SearchInput.js'
import { Button } from '../../../components/ui/Button.js'
import { cx } from '../../../utils/Cx.js'
import { useDialogFocusRestore } from '../../../components/ui/UseDialogFocusRestore.js'
import { useLocale } from '../../i18n/LocaleProvider.js'
import { errorMessageOf } from '@pidex/shared/errors'
import { GithubLoginPanel, useGithubLogin } from './GithubLoginPanel.js'

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
  const { t, formatDate } = useLocale()
  // 登录 UI、轮询和设备验证码都由 GithubLoginPanel 的唯一实现提供。
  const githubLogin = useGithubLogin({ active: open, onError })
  const [repositories, setRepositories] = useState<DesktopGithubRepository[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [cloningRepo, setCloningRepo] = useState<string | null>(null)
  const { onCloseAutoFocus } = useDialogFocusRestore(open)
  const authenticated = githubLogin.authenticated

  useEffect(() => {
    if (!open) return
    setSearch('')
  }, [open])

  useEffect(() => {
    if (!authenticated || !open) return
    void loadRepositories()
  }, [authenticated, open])

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
              <h2>{t('从 GitHub 克隆项目')}</h2>
            </Dialog.Title>
            {authenticated ? <span>{githubLogin.auth?.user?.login}</span> : <span>GitHub</span>}
          </header>
          <Dialog.Description id="github-repository-description">
            {t('登录 GitHub 后选择你有权限访问的仓库，软件会让你选择本地克隆目录。')}
          </Dialog.Description>

          {!authenticated ? (
            // 登录 UI 与 Git 看板的 GitHub 仓库页共用同一实现，避免出现第二份登录流程。
            <GithubLoginPanel
              controller={githubLogin}
              description={t('登录后可列出并克隆你有权限访问的 GitHub 仓库。')}
              heading={t('登录 GitHub')}
            />
          ) : (
            <>
              <SearchInput
                aria-label={t('搜索仓库')}
                className="github-repository-search"
                onChange={setSearch}
                placeholder={t('搜索仓库')}
                value={search}
                variant="standard"
              />
              <div className="github-repository-list-scroll-area">
                <div
                  className={cx('github-repository-list-scroll-content', 'tw:min-w-0', 'tw:grid')}
                >
                  {loading ? (
                    <div
                      role="status"
                      className={cx('github-repository-empty', 'tw:p-5', 'tw:text-center')}
                    >
                      {t('正在加载仓库...')}
                    </div>
                  ) : filteredRepositories.length === 0 ? (
                    <div className={cx('github-repository-empty', 'tw:p-5', 'tw:text-center')}>
                      {t('没有匹配仓库')}
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
                              <Lock size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                            ) : (
                              <Unlock size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                            )}
                            <strong>{repository.fullName}</strong>
                            {repository.fork ? <span>Fork</span> : null}
                          </div>
                          <p>{repository.description ?? t('无描述')}</p>
                          <small>
                            {repository.defaultBranch}
                            {repository.pushedAt
                              ? ` · ${formatDate(new Date(repository.pushedAt))}`
                              : ''}
                          </small>
                        </div>
                        <Button
                          size="md"
                          color="primary"
                          disabled={Boolean(cloningRepo)}
                          onClick={() => void cloneRepository(repository)}
                          type="button"
                        >
                          {cloningRepo === repository.fullName ? t('克隆中...') : t('克隆')}
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
                {t('关闭')}
              </Button>
            </Dialog.Close>
            {authenticated ? (
              <Button
                size="md"
                color="secondary"
                onClick={() => void loadRepositories()}
                type="button"
              >
                {t('刷新')}
              </Button>
            ) : (
              <span className="tw:inline-flex tw:items-center tw:gap-2 tw:text-app-text-meta tw:type-caption">
                <GitFork aria-hidden="true" size="var(--inline-icon-size, 1em)" />
                {t('也可以在看板的 GitHub 仓库页浏览和克隆')}
              </span>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
