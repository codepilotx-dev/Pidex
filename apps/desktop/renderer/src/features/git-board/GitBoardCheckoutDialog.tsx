import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, GitBranch, X } from 'lucide-react'
import type { DesktopWorkspace } from '../../../shared/Types.js'
import type { ReviewBranch } from '../review/source/ReviewAgentClient.js'
import { Button } from '../../components/ui/Button.js'
import { SearchInput } from '../../components/ui/SearchInput.js'
import { Tooltip } from '../../components/ui/Tooltip.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import { useDialogFocusRestore } from '../../components/ui/UseDialogFocusRestore.js'
import { cx } from '../../utils/Cx.js'
import { useLocale } from '../i18n/LocaleProvider.js'
import type { GitBoardRepository } from './GitBoardRepository.js'

/** 本地分支列表（不含远端分支）；未加载时为 null。 */
export function gitBoardLocalBranches(repository?: GitBoardRepository): ReviewBranch[] | null {
  if (!repository?.branches) return null
  return repository.branches.filter((branch) => !branch.remote)
}

export function filterGitBoardBranches(
  branches: readonly ReviewBranch[],
  query: string,
): ReviewBranch[] {
  const keyword = query.trim().toLowerCase()
  return keyword
    ? branches.filter((branch) => branch.name.toLowerCase().includes(keyword))
    : [...branches]
}

export function GitBoardCheckoutDialog({
  open,
  project,
  repository,
  busy,
  error,
  canCheckout,
  onRetryBranches,
  onCheckout,
  onClose,
}: {
  open: boolean
  project: DesktopWorkspace | null
  repository?: GitBoardRepository
  busy: boolean
  error: string | null
  canCheckout: boolean
  onRetryBranches: () => void
  onCheckout: (branchName: string) => void
  onClose: () => void
}) {
  const { t } = useLocale()
  const [query, setQuery] = useState('')
  const { onCloseAutoFocus } = useDialogFocusRestore(open)
  const result = repository?.result
  const branchError = repository?.branchError
  const branches = gitBoardLocalBranches(repository)
  const filteredBranches = branches
    ? filterGitBoardBranches(branches, query).sort((a, b) => Number(b.current) - Number(a.current))
    : null
  const branchListUnavailable = !repository || !result || !result.ok
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) return
        setQuery('')
        onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
        <Dialog.Content
          aria-describedby="git-board-checkout-description"
          className="ui-dialog-surface ui-dialog-surface--centered permission-modal tw:grid tw:w-[min(30rem,100%)] tw:gap-3 tw:p-5"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <header className="tw:flex tw:items-start tw:justify-between tw:gap-3">
            <Dialog.Title asChild>
              <h2 className="tw:m-0 tw:min-w-0 tw:flex-1 tw:text-app-text tw:type-title-sm tw:break-words">
                {t('签出分支')}
              </h2>
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button
                isIconOnly
                className="tw:shrink-0"
                color="ghostSecondary"
                size="toolbar"
                title={t('关闭对话框')}
              >
                <X aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              </Button>
            </Dialog.Close>
          </header>
          <Dialog.Description asChild>
            <div
              id="git-board-checkout-description"
              className="tw:m-0 tw:min-w-0 tw:text-app-text-soft tw:type-body-sm"
            >
              <p className="tw:m-0 tw:truncate tw:text-app-text">
                {project ? project.name : t('未选择项目')}
              </p>
              <p className="tw:m-0 tw:truncate" title={project?.path}>
                {project?.path ?? t('仓库操作始终针对实际工作分支。')}
              </p>
            </div>
          </Dialog.Description>
          {error && (
            <p role="alert" className="tw:m-0 tw:text-app-danger tw:type-body-sm">
              {error}
            </p>
          )}
          {!canCheckout ? (
            <p role="status" className="tw:m-0 tw:text-app-text-meta tw:type-body-sm">
              {t('当前服务不支持签出分支（需要 git.workspace.v1）。')}
            </p>
          ) : branchListUnavailable ? (
            <div role="alert" className="tw:grid tw:gap-2">
              <p className="tw:m-0 tw:text-app-text-meta tw:type-body-sm">
                {t('仓库状态不可用，无法读取本地分支。')}
              </p>
              <Button variant="ghost" onClick={onRetryBranches}>
                {t('重试')}
              </Button>
            </div>
          ) : !branches ? (
            <div role="status" className="tw:grid tw:gap-2">
              <p className="tw:m-0 tw:text-app-text-meta tw:type-body-sm">
                {branchError ? t(branchError) : t('正在加载本地分支…')}
              </p>
              <Button variant="ghost" onClick={onRetryBranches}>
                {t('重试')}
              </Button>
            </div>
          ) : (
            <>
              <SearchInput
                aria-label={t('搜索本地分支')}
                placeholder={t('搜索本地分支')}
                value={query}
                onChange={setQuery}
              />
              {busy && (
                <p role="status" className="tw:m-0 tw:text-app-text-meta tw:type-body-sm">
                  {t('正在签出分支…')}
                </p>
              )}
              <div className="tw:grid tw:max-h-[min(24rem,50vh)] tw:gap-1 tw:overflow-y-auto">
                {filteredBranches.length === 0 ? (
                  <p role="status" className="tw:m-0 tw:py-2 tw:text-app-text-meta tw:type-body-sm">
                    {branches.length === 0 ? t('没有可签出的本地分支') : t('没有匹配的本地分支')}
                  </p>
                ) : (
                  filteredBranches.map((branch) => (
                    <button
                      key={branch.name}
                      type="button"
                      aria-current={branch.current ? 'true' : undefined}
                      className={cx(
                        'tw:flex tw:w-full tw:min-w-0 tw:items-center tw:gap-2 tw:rounded-md tw:border-0 tw:bg-transparent tw:px-2 tw:py-2 tw:text-left tw:text-app-text tw:type-body-sm',
                        branch.current
                          ? 'tw:text-app-text-meta'
                          : 'tw:cursor-pointer tw:hover:bg-app-hover tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus',
                        busy && 'tw:cursor-default tw:opacity-55',
                      )}
                      disabled={busy || branch.current}
                      title={branch.current ? t('当前分支，无需签出') : t('签出到该本地分支')}
                      onClick={() => {
                        setQuery('')
                        onCheckout(branch.name)
                      }}
                    >
                      <GitBranch aria-hidden="true" size={APP_ICON_SIZE} className="tw:shrink-0" />
                      <span className="tw:min-w-0 tw:flex-1 tw:truncate">{branch.name}</span>
                      {branch.current && (
                        <Tooltip content={t('当前分支')}>
                          <span className="tw:inline-flex tw:shrink-0 tw:items-center tw:gap-1 tw:type-caption">
                            <Check aria-hidden="true" size={APP_ICON_SIZE} />
                            {t('当前分支')}
                          </span>
                        </Tooltip>
                      )}
                    </button>
                  ))
                )}
              </div>
            </>
          )}
          <div className="permission-modal-actions tw:flex tw:items-center tw:justify-end">
            <Dialog.Close asChild>
              <Button className="tw:min-w-19" color="secondary" size="md">
                {t('关闭')}
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
