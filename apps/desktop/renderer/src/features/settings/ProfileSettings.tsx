import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../components/ui/IconTokens.js'
import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Popover as Popover } from '../../components/ui/floating/Popover.js'
import { Edit3, GitFork, Globe, Mail, MapPin, RefreshCw, Star, User } from 'lucide-react'
import { SettingsContentArea } from './SettingsContentArea.js'
import { useNavigate } from 'react-router-dom'
import type {
  DesktopGithubContributionWeek,
  DesktopGithubProfileRepository,
} from '../../../shared/Types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { Button } from '../../components/ui/Button.js'

import { RemoteImage } from '../../components/ui/RemoteImage.js'
import { SkeletonBlock, SkeletonRegion } from '../../components/ui/Skeleton.js'
import { SettingsDropdown } from './SettingsDropdown.js'

const STATUS_EMOJI_OPTIONS = [
  { value: 'palm_tree', label: '🌴 On vacation' },
  { value: 'face_with_thermometer', label: '🤒 Out sick' },
  { value: 'house', label: '🏠 Working from home' },
  { value: 'dart', label: '🎯 Focusing' },
  { value: 'speech_balloon', label: '💬 Custom' },
]

export function ProfileSettings(): React.ReactNode {
  const navigate = useNavigate()
  const { auth: githubAuth, overview: githubOverview } = useSyncExternalStore(
    desktopClient.onGithubAccountChange,
    desktopClient.getGithubAccountSnapshot,
    desktopClient.getGithubAccountSnapshot,
  )
  const [githubOverviewError, setGithubOverviewError] = useState<string | null>(null)
  const [statusEditorOpen, setStatusEditorOpen] = useState(false)
  const [statusEmoji, setStatusEmoji] = useState('speech_balloon')
  const [statusMessage, setStatusMessage] = useState('')
  const [statusBusy, setStatusBusy] = useState(false)
  const [statusLimited, setStatusLimited] = useState(false)
  const [loading, setLoading] = useState(githubOverview === null)

  const loadGithubAuth = async (force = false): Promise<void> => {
    setLoading(force || desktopClient.getGithubAccountSnapshot().overview === null)
    setGithubOverviewError(null)
    try {
      const status = await desktopClient.getGithubAuthStatus({ force })
      if (status.authenticated) {
        const result = await desktopClient.getGithubProfileOverview({ force })
        if (result.ok === false) {
          setGithubOverviewError(result.error)
        }
      } else {
        setGithubOverviewError(status.error ?? null)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadGithubAuth()
  }, [])

  const user = githubOverview?.user ?? (githubAuth?.authenticated ? githubAuth.user : null)
  const repositories = githubOverview
    ? githubOverview.pinnedRepositories.length
      ? githubOverview.pinnedRepositories
      : githubOverview.popularRepositories
    : []
  const maxContributionCount = useMemo(
    () => maxContribution(githubOverview?.contributions.weeks ?? []),
    [githubOverview],
  )
  const contributionWeeks = githubOverview?.contributions.weeks ?? []
  const currentStatus = githubOverview?.user.status ?? null
  const showLoadingSkeleton = loading && githubOverview === null

  const openStatusEditor = (): void => {
    setStatusEmoji(statusEmojiName(currentStatus?.emoji) ?? 'speech_balloon')
    setStatusMessage(currentStatus?.message ?? '')
    setStatusLimited(currentStatus?.indicatesLimitedAvailability ?? false)
    setStatusEditorOpen(true)
  }

  const saveStatus = async (): Promise<void> => {
    setStatusBusy(true)
    try {
      const result = await desktopClient.setGithubUserStatus({
        emoji: statusEmoji,
        message: statusMessage,
        limitedAvailability: statusLimited,
        expiresAt: null,
      })
      if (result.ok === false) {
        setGithubOverviewError(result.error)
        return
      }
      setStatusEditorOpen(false)
      await loadGithubAuth(true)
    } finally {
      setStatusBusy(false)
    }
  }

  const clearStatus = async (): Promise<void> => {
    setStatusBusy(true)
    try {
      const result = await desktopClient.clearGithubUserStatus()
      if (result.ok === false) {
        setGithubOverviewError(result.error)
        return
      }
      setStatusEditorOpen(false)
      await loadGithubAuth(true)
    } finally {
      setStatusBusy(false)
    }
  }

  return (
    <Popover.Root open={statusEditorOpen} onOpenChange={setStatusEditorOpen}>
      <SettingsContentArea className="profile-dashboard-area">
        <div className="profile-dashboard tw:min-h-full tw:bg-app-canvas tw:px-[var(--cpx-sys-layout-page-padding-inline)] tw:pt-12 tw:pb-[var(--cpx-sys-layout-page-padding-bottom)] tw:max-[980px]:pt-8">
          <header className="profile-dashboard-header tw:mx-auto tw:flex tw:max-w-[732px] tw:items-center tw:justify-between tw:gap-4 tw:pb-10 tw:max-[980px]:pb-8 tw:max-[760px]:items-start tw:[&>h2]:m-0 tw:[&>h2]:text-app-text tw:[&>h2]:type-row-title">
            <h2>个人资料</h2>
            <div className="profile-dashboard-actions tw:flex tw:items-center tw:gap-2">
              <Button
                color="secondary"
                disabled={!user?.htmlUrl}
                onClick={() => user?.htmlUrl && void desktopClient.openExternalURL(user.htmlUrl)}
              >
                <Edit3 size={APP_ICON_SIZE} />
                编辑
              </Button>
              <Button
                color="primary"
                disabled={loading}
                onClick={() => void loadGithubAuth(true)}
                title={loading ? '正在刷新中...' : '刷新'}
              >
                <RefreshCw size={APP_ICON_SIZE} />
                {loading ? '刷新中...' : '刷新'}
              </Button>
            </div>
          </header>

          {showLoadingSkeleton ? (
            <ProfileLoadingSkeleton />
          ) : (
            <>
              <section className="profile-hero tw:mx-auto tw:flex tw:max-w-[732px] tw:flex-col tw:items-center tw:text-center tw:[&>h1]:m-0 tw:[&>h1]:w-full tw:[&>h1]:truncate tw:[&>h1]:px-2 tw:[&>h1]:text-app-text tw:[&>h1]:type-title-xl tw:[&>h1]:tracking-[0.003em]">
                <div className="profile-avatar-wrap tw:relative tw:mx-auto tw:mt-0 tw:mb-4 tw:size-20">
                  <div
                    className="profile-avatar tw:inline-flex tw:size-20 tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-pill tw:bg-app-accent tw:text-app-text tw:text-[length:var(--cpx-sys-font-size-3xl)] tw:[&_img]:block tw:[&_img]:size-full tw:[&_img]:object-cover tw:[&_svg]:size-3.5"
                    aria-hidden="true"
                  >
                    {user?.avatarUrl ? (
                      <RemoteImage
                        alt=""
                        fallback={<User data-icon-kind="artwork" size={14} />}
                        src={user.avatarUrl}
                      />
                    ) : (
                      <User data-icon-kind="artwork" size={14} />
                    )}
                  </div>
                  {user ? (
                    <Popover.Trigger asChild>
                      <Button
                        isIconOnly
                        className="profile-avatar-badge tw:absolute tw:-right-1.5 tw:-bottom-0.5 tw:w-7.5 tw:inline-flex tw:items-center tw:justify-center tw:rounded-pill tw:border-[3px] tw:border-app-canvas tw:bg-app-raised tw:text-app-text tw:text-[length:var(--cpx-sys-space-5)] tw:cursor-pointer tw:shadow-none tw:focus-visible:outline-solid tw:focus-visible:outline-1 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-app-focus"
                        color="ghostSecondary"
                        onClick={openStatusEditor}
                        size="toolbar"
                        title={currentStatus?.message ?? '设置状态'}
                        type="button"
                      >
                        {statusEmojiGlyph(currentStatus?.emoji)}
                      </Button>
                    </Popover.Trigger>
                  ) : null}
                </div>
                <h1>{user?.name || user?.login || 'GitHub Profile'}</h1>
                <div className="profile-identity tw:mt-1 tw:flex tw:min-h-7 tw:max-w-full tw:items-center tw:justify-center tw:gap-2 tw:text-app-text-soft tw:type-body">
                  {user ? `@${user.login}` : '未登录 GitHub'}
                  {githubOverview ? (
                    <>
                      <span
                        aria-hidden="true"
                        className="profile-identity-separator tw:text-app-text-meta"
                      >
                        ·
                      </span>
                      <span className="profile-account-label tw:h-6 tw:rounded-md tw:border tw:border-app-border-subtle tw:px-2 tw:py-1 tw:type-caption">
                        GitHub
                      </span>
                    </>
                  ) : null}
                </div>
                {githubOverview?.user.bio ? (
                  <p className="profile-bio tw:mx-auto tw:mt-3 tw:mb-0 tw:max-w-[540px] tw:text-app-text tw:type-reading">
                    {githubOverview.user.bio}
                  </p>
                ) : null}
                {currentStatus?.message ? (
                  <div className="profile-status-line tw:mt-3 tw:inline-flex tw:max-w-[560px] tw:items-center tw:gap-2 tw:rounded-full tw:border tw:border-app-border-subtle tw:px-3 tw:py-2 tw:text-app-text tw:type-caption tw:[&>strong]:pl-2 tw:[&>strong]:text-app-text-soft tw:[&>strong]:type-weight-label">
                    <span>{statusEmojiGlyph(currentStatus.emoji)}</span>
                    {currentStatus.message}
                    {currentStatus.indicatesLimitedAvailability ? <strong>Busy</strong> : null}
                  </div>
                ) : null}
                {githubOverview ? (
                  <div className="profile-meta-line tw:mt-3 tw:flex tw:max-w-[640px] tw:flex-wrap tw:justify-center tw:gap-x-4 tw:gap-y-2 tw:text-app-text-soft tw:text-[length:var(--cpx-sys-font-size-xs)] tw:[&>span]:inline-flex tw:[&>span]:min-w-0 tw:[&>span]:items-center tw:[&>span]:gap-1 tw:[&>span]:[overflow-wrap:anywhere] tw:[&_svg]:size-icon-sm">
                    <ProfileMeta
                      icon={<User size={APP_ICON_SIZES.sm} />}
                      value={`${githubOverview.user.followers} followers`}
                    />
                    <ProfileMeta
                      icon={<GitFork size={APP_ICON_SIZES.sm} />}
                      value={`${githubOverview.user.following} following`}
                    />
                    <ProfileMeta
                      icon={<MapPin size={APP_ICON_SIZES.sm} />}
                      value={githubOverview.user.location}
                    />
                    <ProfileMeta
                      icon={<Globe size={APP_ICON_SIZES.sm} />}
                      value={githubOverview.user.websiteUrl}
                    />
                    <ProfileMeta
                      icon={<Mail size={APP_ICON_SIZES.sm} />}
                      value={githubOverview.user.email}
                    />
                  </div>
                ) : null}
              </section>

              {githubOverview ? (
                <>
                  <section
                    className="profile-stat-strip tw:mx-auto tw:mt-10 tw:flex tw:min-h-15 tw:max-w-[732px] tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-panel tw:shadow-none tw:max-[760px]:grid tw:max-[760px]:grid-cols-2"
                    aria-label="GitHub 统计"
                  >
                    <ProfileMetric label="公开仓库" value={githubOverview.user.repositoryCount} />
                    <ProfileMetric
                      label="Starred"
                      value={githubOverview.user.starredRepositoryCount}
                    />
                    <ProfileMetric
                      label="今年贡献"
                      value={githubOverview.contributions.totalContributions}
                    />
                    <ProfileMetric
                      label="Commit 贡献"
                      value={githubOverview.contributions.totalCommitContributions}
                    />
                    <ProfileMetric
                      label="受限贡献"
                      value={githubOverview.contributions.restrictedContributionsCount}
                    />
                  </section>

                  <section className="profile-activity-panel tw:mx-auto tw:mt-10 tw:max-w-[732px]">
                    <div className="profile-panel-heading tw:mb-3 tw:flex tw:items-center tw:justify-between tw:[&>h3]:m-0 tw:[&>h3]:text-app-text tw:[&>h3]:type-row-title">
                      <h3>GitHub 活动</h3>
                    </div>
                    <div className="profile-contribution-map tw:w-full tw:min-w-0">
                      <div
                        className="profile-contribution-grid"
                        style={{
                          gridTemplateColumns: `repeat(${Math.max(contributionWeeks.length, 1)}, minmax(1px, 1fr))`,
                        }}
                      >
                        {contributionWeeks.map((week, weekIndex) => (
                          <div
                            className="profile-contribution-week"
                            key={week.days[0]?.date ?? weekIndex}
                          >
                            {week.days.map((day) => (
                              <span
                                className="profile-contribution-day"
                                data-level={contributionLevel(day.count, maxContributionCount)}
                                key={day.date}
                                title={`${day.date}: ${day.count} contributions`}
                              />
                            ))}
                          </div>
                        ))}
                      </div>
                      <div className="profile-contribution-months tw:relative tw:mt-2 tw:h-[1.4em] tw:w-full tw:text-app-text-soft tw:text-[length:var(--cpx-sys-font-size-xs)] tw:[line-height:var(--cpx-sys-line-height-tight)] tw:[&>span]:absolute tw:[&>span]:top-0 tw:[&>span]:-translate-x-1/2 tw:[&>span]:whitespace-nowrap tw:[&>span:first-child]:transform-none">
                        {monthLabels(contributionWeeks).map((item) => (
                          <span
                            key={`${item.label}-${item.index}`}
                            style={{
                              left: `${monthLabelOffset(item.index, contributionWeeks.length)}%`,
                            }}
                          >
                            {item.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  </section>

                  <section className="profile-lower-grid tw:mx-auto tw:mt-10 tw:grid tw:max-w-[732px] tw:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] tw:gap-10 tw:max-[980px]:grid-cols-1 tw:max-[980px]:gap-7">
                    <div className="profile-insights tw:[&>h3]:m-0 tw:[&>h3]:text-app-text tw:[&>h3]:type-row-title">
                      <h3>活动概览</h3>
                      <ProfileInsight
                        label="Commit 贡献"
                        value={githubOverview.contributions.totalCommitContributions}
                      />
                      <ProfileInsight
                        label="Pull request 贡献"
                        value={githubOverview.contributions.totalPullRequestContributions}
                      />
                      <ProfileInsight
                        label="Issue 贡献"
                        value={githubOverview.contributions.totalIssueContributions}
                      />
                      <ProfileInsight
                        label="Review 贡献"
                        value={githubOverview.contributions.totalPullRequestReviewContributions}
                      />
                      <ProfileInsight
                        label="受限贡献"
                        value={githubOverview.contributions.restrictedContributionsCount}
                      />
                    </div>

                    <div className="profile-repositories tw:[&>h3]:m-0 tw:[&>h3]:text-app-text tw:[&>h3]:type-row-title">
                      <h3>常用仓库</h3>
                      {repositories.slice(0, 5).map((repository) => (
                        <ProfileRepositoryRow key={repository.id} repository={repository} />
                      ))}
                      {repositories.length === 0 ? (
                        <p className="profile-empty-copy tw:mt-3 tw:mb-0 tw:text-app-text-soft tw:type-body-sm">
                          暂无可显示的数据。
                        </p>
                      ) : null}
                    </div>
                  </section>
                </>
              ) : (
                <section className="profile-empty-state tw:mx-auto tw:mt-10 tw:max-w-[520px] tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-panel tw:px-6 tw:py-10 tw:text-center tw:text-app-text-soft tw:shadow-none">
                  <p>
                    {githubOverviewError ??
                      githubAuth?.error ??
                      (githubAuth?.authenticated
                        ? '连接 GitHub 失败，请稍后重试。'
                        : '尚未登录 GitHub，请前往 Git 设置登录。')}
                  </p>
                  <div className="profile-empty-actions tw:mt-4 tw:flex tw:justify-center tw:gap-2">
                    <Button
                      color="secondary"
                      onClick={() => void loadGithubAuth(true)}
                      type="button"
                    >
                      <RefreshCw size={APP_ICON_SIZE} />
                      刷新
                    </Button>
                    <Button
                      color="secondary"
                      onClick={() => navigate('/settings/git')}
                      type="button"
                    >
                      前往 Git 设置
                    </Button>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </SettingsContentArea>
      <Popover.Portal>
        <Popover.Content
          size="lg"
          align="center"
          aria-label="设置 GitHub 状态"
          className="popover-surface profile-status-popover tw:z-popover"
          style={{ padding: 0 }}
          collisionPadding={8}
          side="bottom"
          sideOffset={8}
        >
          <div className="profile-status-popover-header tw:flex tw:items-center tw:justify-between tw:border-b tw:border-b-app-border tw:p-3">
            <strong>设置 GitHub 状态</strong>
            <Popover.Close asChild>
              <Button
                isIconOnly
                color="ghostSecondary"
                size="toolbar"
                title="关闭状态设置"
                type="button"
              >
                ×
              </Button>
            </Popover.Close>
          </div>
          <div className="profile-status-field tw:block tw:p-3 tw:[&>span]:mb-2 tw:[&>span]:block tw:[&>span]:text-app-text tw:[&>span]:type-row-title tw:[&>div]:grid tw:[&>div]:grid-cols-[160px_minmax(0,1fr)] tw:[&>div]:gap-2 tw:[&_input]:rounded-md tw:[&_input]:border tw:[&_input]:border-app-border tw:[&_input]:bg-app-canvas tw:[&_input]:px-2 tw:[&_input]:py-1 tw:[&_input]:text-app-text tw:[&_input]:type-body">
            <span>What's happening</span>
            <div>
              <SettingsDropdown
                ariaLabel="GitHub 状态 Emoji"
                options={STATUS_EMOJI_OPTIONS}
                showSelectedIndicator
                triggerClassName="profile-status-select tw:w-full tw:h-8 tw:min-h-8 tw:bg-app-canvas"
                value={statusEmoji}
                size="md"
                onChange={setStatusEmoji}
              />
              <input
                aria-label="GitHub 状态消息"
                maxLength={80}
                value={statusMessage}
                onChange={(event) => setStatusMessage(event.target.value)}
                placeholder="What are you up to?"
              />
            </div>
          </div>
          <label className="profile-status-checkbox tw:flex tw:items-center tw:gap-2 tw:px-3 tw:pt-0 tw:pb-3 tw:text-app-text tw:type-body">
            <input
              type="checkbox"
              checked={statusLimited}
              onChange={(event) => setStatusLimited(event.target.checked)}
            />
            Busy
          </label>
          <div className="profile-status-actions tw:flex tw:justify-end tw:gap-2 tw:border-t tw:border-t-app-border-subtle tw:p-3">
            <Button
              color="danger"
              disabled={statusBusy}
              onClick={() => void clearStatus()}
              type="button"
            >
              Clear status
            </Button>
            <Button
              color="primary"
              disabled={statusBusy || !statusMessage.trim()}
              onClick={() => void saveStatus()}
              type="button"
            >
              Set status
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function ProfileLoadingSkeleton(): React.ReactNode {
  return (
    <SkeletonRegion
      className="profile-loading tw:mx-auto tw:flex tw:max-w-[732px] tw:flex-col tw:gap-10"
      label="正在读取 GitHub 资料"
    >
      <section className="profile-loading-hero tw:flex tw:flex-col tw:items-center tw:gap-2">
        <SkeletonBlock className="profile-loading-avatar tw:mx-0 tw:mb-2 tw:size-20 tw:rounded-pill" />
        <SkeletonBlock className="profile-loading-name tw:h-8 tw:w-36 tw:rounded-md" />
        <SkeletonBlock className="profile-loading-identity tw:h-5 tw:w-26 tw:rounded-md" />
      </section>
      <section className="profile-loading-stats" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index}>
            <SkeletonBlock />
            <SkeletonBlock />
          </div>
        ))}
      </section>
      <section className="profile-loading-activity tw:flex tw:flex-col tw:gap-3" aria-hidden="true">
        <SkeletonBlock className="profile-loading-heading tw:h-5 tw:w-23 tw:rounded-md" />
        <div className="profile-loading-contributions tw:grid tw:grid-cols-12 tw:gap-1">
          {Array.from({ length: 84 }, (_, index) => (
            <SkeletonBlock key={index} />
          ))}
        </div>
      </section>
      <section
        className="profile-loading-lower tw:grid tw:grid-cols-2 tw:gap-10 tw:max-[980px]:grid-cols-1 tw:max-[980px]:gap-7 tw:[&>div]:flex tw:[&>div]:flex-col tw:[&>div]:gap-2"
        aria-hidden="true"
      >
        <div>
          {Array.from({ length: 5 }, (_, index) => (
            <SkeletonBlock key={index} />
          ))}
        </div>
        <div>
          {Array.from({ length: 5 }, (_, index) => (
            <SkeletonBlock key={index} />
          ))}
        </div>
      </section>
    </SkeletonRegion>
  )
}

function ProfileMeta({
  icon,
  value,
}: {
  icon: React.ReactNode
  value: string | null
}): React.ReactNode {
  if (!value) return null
  return (
    <span>
      {icon}
      {value}
    </span>
  )
}

function ProfileMetric({ label, value }: { label: string; value: number }): React.ReactNode {
  return (
    <div className="profile-metric tw:min-w-0 tw:flex-1 tw:border-r tw:border-r-app-border-subtle tw:p-3 tw:text-center tw:last:border-r-0 tw:max-[760px]:border-b tw:max-[760px]:border-b-app-border-subtle tw:max-[760px]:even:border-r-0 tw:max-[760px]:last:col-span-2 tw:max-[760px]:last:border-b-0 tw:[&>strong]:block tw:[&>strong]:truncate tw:[&>strong]:text-app-text tw:[&>strong]:type-body tw:[&>strong]:type-weight-label tw:[&>strong]:tabular-nums tw:[&>span]:mt-1 tw:[&>span]:block tw:[&>span]:truncate tw:[&>span]:text-app-text-meta tw:[&>span]:type-caption">
      <strong>{formatCompact(value)}</strong>
      <span>{label}</span>
    </div>
  )
}

function ProfileInsight({ label, value }: { label: string; value: number }): React.ReactNode {
  return (
    <div className="profile-insight-row tw:mt-1 tw:flex tw:min-h-6 tw:items-center tw:justify-between tw:gap-3 tw:py-1 tw:text-app-text-soft tw:type-body tw:[&>strong]:text-app-text tw:[&>strong]:type-weight-label tw:[&>strong]:tabular-nums">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  )
}

function ProfileRepositoryRow({
  repository,
}: {
  repository: DesktopGithubProfileRepository
}): React.ReactNode {
  return (
    <button
      className="profile-repository-row tw:mt-1 tw:flex tw:min-h-6 tw:w-full tw:cursor-pointer tw:items-center tw:justify-between tw:gap-3 tw:border-0 tw:bg-transparent tw:py-1 tw:text-left tw:text-app-text-soft tw:type-body tw:hover:[&_.profile-repository-name]:text-app-accent-fg tw:focus-visible:rounded-md tw:focus-visible:outline-solid tw:focus-visible:outline-1 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-app-focus"
      onClick={() => void desktopClient.openExternalURL(repository.url)}
      type="button"
    >
      <span
        className="profile-repository-dot tw:size-2.5 tw:shrink-0 tw:rounded-pill"
        style={{
          backgroundColor: repository.primaryLanguage?.color ?? 'var(--cpx-sys-color-fg-secondary)',
        }}
      />
      <span className="profile-repository-name tw:min-w-0 tw:flex-1 tw:truncate tw:text-app-text">
        {repository.fullName}
      </span>
      <span className="profile-repository-count tw:inline-flex tw:shrink-0 tw:items-center tw:gap-1 tw:text-app-text-soft tw:tabular-nums tw:[&_svg]:size-icon-sm">
        <Star size={APP_ICON_SIZE} />
        {repository.stargazerCount.toLocaleString()}
      </span>
    </button>
  )
}

function maxContribution(weeks: DesktopGithubContributionWeek[]): number {
  return Math.max(1, ...weeks.flatMap((week) => week.days.map((day) => day.count)))
}

function contributionLevel(count: number, max: number): number {
  if (count <= 0) return 0
  const ratio = count / max
  if (ratio < 0.25) return 1
  if (ratio < 0.5) return 2
  if (ratio < 0.75) return 3
  return 4
}

function monthLabels(
  weeks: DesktopGithubContributionWeek[],
): Array<{ label: string; index: number }> {
  const formatter = new Intl.DateTimeFormat('zh-CN', { month: 'numeric' })
  const labels: Array<{ label: string; index: number }> = []
  let lastMonth = ''
  weeks.forEach((week, index) => {
    const day = week.days[0]
    if (!day) return
    const month = formatter.format(new Date(day.date))
    if (month !== lastMonth) {
      labels.push({ label: `${month}`, index })
      lastMonth = month
    }
  })
  return labels.slice(-12)
}

function monthLabelOffset(index: number, weekCount: number): number {
  if (weekCount <= 1) return 0
  return Math.min(100, Math.max(0, (index / (weekCount - 1)) * 100))
}

function formatCompact(value: number): string {
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)}亿`
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`
  return value.toLocaleString()
}

function statusEmojiName(value: string | null | undefined): string | null {
  if (!value) return null
  return value.replace(/^:+|:+$/g, '')
}

function statusEmojiGlyph(value: string | null | undefined): string {
  switch (statusEmojiName(value)) {
    case 'palm_tree':
      return '🌴'
    case 'face_with_thermometer':
      return '🤒'
    case 'house':
      return '🏠'
    case 'dart':
      return '🎯'
    case 'speech_balloon':
      return '💬'
    default:
      return value ? '💬' : ''
  }
}
