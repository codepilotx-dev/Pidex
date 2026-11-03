import { useShallow } from 'zustand/react/shallow'
import type React from 'react'
import type { DesktopGithubRepository } from '../../../shared/Types.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  GitBranch,
  GitFork,
  Lock,
  RefreshCw,
  SquareArrowOutUpRight,
  Unlock,
} from 'lucide-react'
import { desktopClient } from '../../services/desktop-client/index.js'
import { errorMessageOf } from '@pidex/shared/errors'
import { notifyProjectCatalogChanged } from '../projects/ProjectCatalogEvents.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import { Button } from '../../components/ui/Button.js'
import { Spinner } from '../../components/ui/Spinner.js'
import { Tooltip } from '../../components/ui/Tooltip.js'
import { useLocale } from '../i18n/LocaleProvider.js'
import { GithubLoginPanel, useGithubLogin } from '../layout/panels/GithubLoginPanel.js'
import { formatGithubPushedAt, visibleGithubRepositories } from './GitBoardGithubRepositories.js'
import { useGitBoard } from './GitBoardContext.js'

/**
 * Git 看板内的常驻 GitHub 仓库页。
 * 登录 UI 复用 GithubLoginPanel 的唯一实现；克隆复用 desktopClient.cloneGithubRepository，
 * 它已包含目录选择、克隆、项目注册与缓存失效。本页只补充目录刷新与页面内反馈，
 * 不关闭页面、不自动把仓库加入速览或分组。
 */

type RepositoryListState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; repositories: DesktopGithubRepository[] }
  | { status: 'error'; error: string }

/** 克隆成功提示只保存数据，文案在渲染时经 t() 生成。 */
type CloneNotice = { kind: 'cloned'; projectName: string }

export function GitBoardGithubView({
  active = true,
  search,
  onSearchChange,
  onBusyChange,
}: {
  active?: boolean
  /** 搜索框由 GitBoardView 的页头渲染（与宠物页同一布局），本组件只消费关键字。 */
  search: string
  onSearchChange: (value: string) => void
  /** 把加载状态回报给页头刷新按钮，用于禁用与旋转反馈。 */
  onBusyChange?: (busy: boolean) => void
}) {
  const { t } = useLocale()
  const { registerGithubRefresh } = useGitBoard(
    useShallow((state) => ({ registerGithubRefresh: state.registerGithubRefresh })),
  )
  const githubLogin = useGithubLogin({ active })
  const authenticated = githubLogin.authenticated
  const [list, setList] = useState<RepositoryListState>({ status: 'idle' })
  const [cloning, setCloning] = useState<string | null>(null)
  const [notice, setNotice] = useState<CloneNotice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  // 刷新按钮的回调必须保持稳定身份：它如果随渲染变化，把 `t` 拉进 loadRepositories 的依赖，
  // 就会让下面的加载 effect 在每次语言/渲染变化时重跑并自增 request，把正在进行的自己判成过期。
  const loadRef = useRef<() => void>(() => {})

  const loadRepositories = useCallback(async (): Promise<void> => {
    const current = ++request.current
    setList({ status: 'loading' })
    try {
      const result = await desktopClient.listGithubRepositories()
      if (current !== request.current) return
      if (result.ok === false) {
        setList({ status: 'error', error: result.error })
        return
      }
      setList({ status: 'ready', repositories: result.repositories })
    } catch (cause) {
      if (current !== request.current) return
      setList({ status: 'error', error: errorMessageOf(cause) })
    }
    // 只有最新一次请求结束时才落定忙碌状态，避免被过期响应提前解锁。
    if (current === request.current) onBusyChange?.(false)
  }, [onBusyChange])

  useEffect(() => {
    loadRef.current = () => void loadRepositories()
  }, [loadRepositories])

  // 账号快照是唯一真源：登录后加载仓库列表，退出（含侧栏底部退出）后立即清空本页数据。
  // 依赖刻意只保留 active/authenticated：两个值稳定时本 effect 不会重跑，因此不会自增序号。
  useEffect(() => {
    if (!active || !authenticated) {
      // 递增序号让仍在执行的旧响应失效，避免退出后再次写回账号仓库。
      request.current += 1
      setList({ status: 'idle' })
      setCloning(null)
      setNotice(null)
      setError(null)
      onBusyChange?.(false)
      return
    }
    void loadRepositories()
  }, [active, authenticated, loadRepositories, onBusyChange])

  useEffect(() => {
    if (!active) return
    // 页面标题栏的刷新按钮通过 Context 调用这里，仓库页本身不接管 PrimaryPageLayout 头部。
    // 用 loadRef 间接调用，使注册函数身份稳定，不随 t/列表状态变化而反复重新注册。
    registerGithubRefresh(
      authenticated
        ? () => loadRef.current()
        : () => void desktopClient.getGithubAuthStatus().catch(() => undefined),
    )
    return () => registerGithubRefresh(null)
  }, [active, authenticated, registerGithubRefresh])

  const repositories = list.status === 'ready' ? list.repositories : []
  const visible = useMemo(
    () => visibleGithubRepositories(repositories, search),
    [repositories, search],
  )
  const searching = search.trim().length > 0

  const openRepository = useCallback(async (repository: DesktopGithubRepository) => {
    setError(null)
    try {
      await desktopClient.openExternalURL(repository.htmlUrl)
    } catch (cause) {
      setError(errorMessageOf(cause))
    }
  }, [])

  const cloneRepository = useCallback(async (repository: DesktopGithubRepository) => {
    setCloning(repository.fullName)
    setNotice(null)
    setError(null)
    try {
      const result = await desktopClient.cloneGithubRepository({ repository })
      if (result.ok === false) {
        setError(result.error)
        return
      }
      // 克隆成功只刷新本地项目目录并保留当前仓库列表与视图。
      notifyProjectCatalogChanged()
      // 提示只记录结果本身，渲染时再套 t()，避免把 t 写进这个回调的依赖。
      setNotice({ kind: 'cloned', projectName: result.workspace.name })
    } catch (cause) {
      setError(errorMessageOf(cause))
    } finally {
      setCloning(null)
    }
  }, [])

  const loginState = (
    <div className="tw:mx-auto tw:w-full tw:max-w-[32rem] tw:pt-6">
      <GithubLoginPanel
        controller={githubLogin}
        description={t('登录后可列出并克隆你有权限访问的 GitHub 仓库。')}
        heading={t('登录 GitHub 以查看仓库')}
      />
    </div>
  )

  return (
    <div className="tw:flex tw:min-h-0 tw:min-w-0 tw:flex-1 tw:flex-col tw:gap-3">
      {/* 搜索框位于页头（与宠物页一致），这里只报告匹配数量。 */}
      <span role="status" className="tw:shrink-0 tw:self-end tw:type-caption tw:text-app-text-meta">
        {list.status === 'ready'
          ? searching
            ? `${t('匹配')} ${visible.length} / ${repositories.length} ${t('个仓库')}`
            : `${repositories.length} ${t('个仓库')}`
          : null}
      </span>
      {notice && (
        <p
          role="status"
          className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:rounded-md tw:border tw:border-app-success-border tw:bg-app-success-subtle tw:px-3 tw:py-2 tw:text-app-success-fg tw:type-body-sm"
        >
          <CheckCircle2
            aria-hidden="true"
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
          {notice.kind === 'cloned'
            ? `${t('已克隆')} ${notice.projectName}${t('，可在左侧项目中打开')}`
            : null}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="tw:m-0 tw:rounded-md tw:border tw:border-app-danger-border tw:bg-app-danger-subtle tw:px-3 tw:py-2 tw:text-app-danger-fg tw:type-body-sm"
        >
          {error}
        </p>
      )}
      <div className="tw:min-h-0 tw:flex-1 tw:overflow-y-auto tw:pr-1">
        {!authenticated ? (
          loginState
        ) : list.status === 'loading' || list.status === 'idle' ? (
          <div
            role="status"
            className="tw:flex tw:items-center tw:justify-center tw:gap-2 tw:py-16 tw:text-app-text-soft tw:type-body-sm"
          >
            <Spinner size="small" />
            {t('正在加载仓库…')}
          </div>
        ) : list.status === 'error' ? (
          <div className="tw:mx-auto tw:grid tw:max-w-[28rem] tw:justify-items-center tw:gap-3 tw:py-16 tw:text-center">
            <p role="alert" className="tw:m-0 tw:text-app-text tw:type-body">
              {t('仓库列表加载失败')}
            </p>
            <p className="tw:m-0 tw:text-app-text-soft tw:type-body-sm">{list.error}</p>
            <Button variant="secondary" onClick={() => void loadRepositories()}>
              {t('重试')}
            </Button>
          </div>
        ) : !repositories.length ? (
          <p
            role="status"
            className="tw:m-0 tw:py-16 tw:text-center tw:text-app-text-soft tw:type-body-sm"
          >
            {t('没有可访问的 GitHub 仓库')}
          </p>
        ) : !visible.length ? (
          <div className="tw:mx-auto tw:grid tw:max-w-[28rem] tw:justify-items-center tw:gap-2 tw:py-16 tw:text-center">
            <p role="status" className="tw:m-0 tw:text-app-text tw:type-body">
              {`${t('没有匹配')} “${search.trim()}” ${t('的仓库')}`}
            </p>
            <Button variant="ghost" onClick={() => onSearchChange('')}>
              {t('清除搜索')}
            </Button>
          </div>
        ) : (
          <ul className="tw:m-0 tw:grid tw:list-none tw:gap-2 tw:p-0">
            {visible.map((repository) => (
              <RepositoryRow
                key={repository.id}
                busy={cloning !== null}
                cloning={cloning === repository.fullName}
                repository={repository}
                onClone={() => void cloneRepository(repository)}
                onOpen={() => void openRepository(repository)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function RepositoryRow({
  repository,
  cloning,
  busy,
  onOpen,
  onClone,
}: {
  repository: DesktopGithubRepository
  cloning: boolean
  busy: boolean
  onOpen: () => void
  onClone: () => void
}) {
  const { t, formatDate } = useLocale()
  const pushedAt = formatGithubPushedAt(repository.pushedAt, formatDate)
  return (
    <li className="tw:flex tw:min-w-0 tw:items-center tw:gap-3 tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-panel tw:px-4 tw:py-3">
      <div className="tw:flex tw:min-w-0 tw:flex-1 tw:flex-col tw:gap-1">
        <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
          <Tooltip content={t(repository.private ? '私有仓库' : '公开仓库')}>
            <span aria-hidden="true" className="tw:inline-flex tw:shrink-0 tw:text-app-text-meta">
              {repository.private ? (
                <Lock size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              ) : (
                <Unlock size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              )}
            </span>
          </Tooltip>
          <span className="tw:min-w-0 tw:truncate tw:text-app-text tw:type-row-title">
            {repository.fullName}
          </span>
          <MetaChip>{t(repository.private ? '私有' : '公开')}</MetaChip>
          {repository.fork && (
            <MetaChip>
              <GitFork
                aria-hidden="true"
                size="var(--inline-icon-size, 1em)"
                strokeWidth={APP_ICON_STROKE_WIDTH}
                className="tw:size-[var(--inline-icon-size,1em)]"
              />
              Fork
            </MetaChip>
          )}
          {repository.archived && <MetaChip>{t('已归档')}</MetaChip>}
        </div>
        <p className="tw:m-0 tw:min-w-0 tw:truncate tw:text-app-text-soft tw:type-body-sm">
          {repository.description ?? t('无描述')}
        </p>
        <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1 tw:text-app-text-meta tw:type-caption">
          <span className="tw:inline-flex tw:items-center tw:gap-1">
            <GitBranch
              aria-hidden="true"
              size={APP_ICON_SIZE}
              strokeWidth={APP_ICON_STROKE_WIDTH}
              className="tw:size-3"
            />
            {repository.defaultBranch}
          </span>
          {pushedAt && <span>{`${t('最后推送')} ${pushedAt}`}</span>}
        </div>
      </div>
      <span className="tw:flex tw:shrink-0 tw:items-center tw:gap-2">
        <Button variant="secondary" size="md" onClick={onOpen}>
          <SquareArrowOutUpRight
            aria-hidden="true"
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
          {t('在 GitHub 打开')}
        </Button>
        <Button variant="primary" size="md" disabled={busy} loading={cloning} onClick={onClone}>
          {t(cloning ? '克隆中…' : '克隆')}
        </Button>
      </span>
    </li>
  )
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="tw:inline-flex tw:shrink-0 tw:items-center tw:gap-1 tw:rounded-full tw:border tw:border-app-border-subtle tw:px-2 tw:text-app-text-soft tw:type-caption">
      {children}
    </span>
  )
}
