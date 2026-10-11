import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { useSearchParams } from 'react-router-dom'
import type { DesktopWorkspace, SidebarProductMode } from '../../../shared/Types.js'
import {
  getEffectiveReducedMotion,
  usePrefersReducedMotion,
} from '../../hooks/UsePrefersReducedMotion.js'
import { useDesktopSettings } from '../settings/UseDesktopSettings.js'
import {
  normalizeNewSessionSurfaceSearch,
  parseNewSessionSurface,
  type NewSessionSurface,
} from './NewSessionSurface.js'
import { DesktopComposer } from './composer/DesktopComposer.js'
import { useQuickChatContext } from './QuickChatContext.js'
import { enterTween, exitTween, motionTransition } from '../motion/MotionTransitions.js'
import { CodingHeadingTransition } from './CodingHeadingTransition.js'
import { ProjectSwitcherPopover } from './composer/ProjectSwitcherPopover.js'
import { useLocale } from '../i18n/LocaleProvider.js'

export function QuickChatView(): React.ReactNode {
  const [searchParams, setSearchParams] = useSearchParams()
  const { sidebarProductMode, setSidebarProductMode } = useDesktopSettings()
  const search = searchParams.toString()
  const urlSurface = parseNewSessionSurface(search)
  const surface = urlSurface ?? sidebarProductMode
  const reducedMotion = usePrefersReducedMotion()

  // 缺失或无效的 surface 参数回退到已保存模式，并只替换 surface 参数
  useEffect(() => {
    if (urlSurface === surface) return
    setSearchParams(normalizeNewSessionSurfaceSearch(search, surface), { replace: true })
  }, [search, setSearchParams, surface, urlSurface])

  // URL 中的有效 surface 优先于已保存设置，并同步侧栏模式
  useEffect(() => {
    if (urlSurface === null || urlSurface === sidebarProductMode) return
    setSidebarProductMode(urlSurface)
  }, [setSidebarProductMode, sidebarProductMode, urlSurface])

  const handleModeChange = useCallback(
    (mode: SidebarProductMode) => {
      setSidebarProductMode(mode)
      setSearchParams(normalizeNewSessionSurfaceSearch(search, mode), { replace: true })
    },
    [search, setSearchParams, setSidebarProductMode],
  )

  return (
    <AnimatePresence initial={false} mode="wait">
      <NewSessionPresence key="unified-home" kind="surface" reducedMotion={reducedMotion}>
        <CodingQuickChatView onModeChange={handleModeChange} surface={surface} />
      </NewSessionPresence>
    </AnimatePresence>
  )
}

function CodingQuickChatView({
  surface,
  onModeChange,
}: {
  surface: NewSessionSurface
  onModeChange?: (mode: SidebarProductMode) => void
}): React.ReactNode {
  const { t } = useLocale()
  const {
    branchName,
    composerProps,
    gitStatus,
    recentWorkspaces,
    workspaceName,
    workspacePath,
    onChooseWorkspace,
    onCloneGithub,
    onClearWorkspace,
    onOpenWorkspace,
  } = useQuickChatContext()
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const pageRef = useRef<HTMLDivElement | null>(null)
  const whaleMarkRef = useRef<HTMLButtonElement | null>(null)
  const whaleMarkAnimationRef = useRef<Animation | null>(null)
  const currentWorkspace = useMemo<DesktopWorkspace | null>(() => {
    if (!workspaceName || !workspacePath) return null
    return (
      recentWorkspaces.find((workspace) => workspace.path === workspacePath) ?? {
        name: workspaceName,
        path: workspacePath,
        branchName,
      }
    )
  }, [branchName, recentWorkspaces, workspaceName, workspacePath])
  const handleWhaleMarkClick = useCallback(() => {
    const mark = whaleMarkRef.current
    if (!mark || getEffectiveReducedMotion()) return
    whaleMarkAnimationRef.current?.cancel()
    whaleMarkAnimationRef.current = mark.animate(
      [
        { transform: 'scale(1) rotate(0deg)' },
        { transform: 'scale(1.08) rotate(180deg)', offset: 0.5 },
        { transform: 'scale(1) rotate(360deg)' },
      ],
      {
        duration: 100,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    )
  }, [])

  useEffect(
    () => () => {
      whaleMarkAnimationRef.current?.cancel()
    },
    [],
  )

  const hasGitWorkspace = Boolean(branchName || gitStatus)
  const headingUsesProject = Boolean(currentWorkspace && workspaceName)
  const baseHeadingKey = headingUsesProject
    ? `${hasGitWorkspace ? 'git' : 'project'}:${workspacePath}`
    : 'no-project'
  const headingKey = `${surface}:${baseHeadingKey}`

  const projectTrigger = (
    <button
      aria-label={`${t('选择项目：')}${workspaceName}`}
      className="project-name tw:inline-block tw:max-w-[min(40vw,18ch)] tw:min-w-0 tw:overflow-hidden tw:whitespace-nowrap tw:text-ellipsis tw:align-baseline tw:cursor-pointer tw:text-app-text tw:[font:inherit] tw:underline tw:decoration-dotted tw:decoration-1 tw:underline-offset-4 tw:hover:text-app-text-soft tw:hover:decoration-current tw:data-[state=open]:text-app-text-soft tw:data-[state=open]:decoration-current tw:aria-expanded:text-app-text-soft tw:aria-expanded:decoration-current tw:focus-visible:outline-offset-3"
      title={workspaceName}
      type="button"
    >
      {workspaceName}
    </button>
  )

  const renderProjectSwitcher = (suffixText: string): React.ReactNode => (
    <>
      {t('你想让我们在 ')}
      <ProjectSwitcherPopover
        align="center"
        className="popover-project quick-chat-project-popover"
        open={projectMenuOpen}
        recentWorkspaces={recentWorkspaces}
        side="top"
        sideOffset={4}
        trigger={projectTrigger}
        size="sm"
        workspace={currentWorkspace}
        onChooseWorkspace={() => {
          void onChooseWorkspace()
          setProjectMenuOpen(false)
        }}
        onCloneGithub={() => {
          onCloneGithub()
          setProjectMenuOpen(false)
        }}
        onClearWorkspace={() => {
          onClearWorkspace()
          setProjectMenuOpen(false)
        }}
        onOpenChange={setProjectMenuOpen}
        onOpenWorkspace={(workspace) => {
          void onOpenWorkspace(workspace)
          setProjectMenuOpen(false)
        }}
      />
      {suffixText}
    </>
  )

  const headingContent =
    surface === 'chat'
      ? t('随时可以开始。')
      : surface === 'working'
        ? headingUsesProject
          ? renderProjectSwitcher(t(' 中分析什么?'))
          : t('写作与分析')
        : headingUsesProject
          ? renderProjectSwitcher(t(' 中构建什么?'))
          : t('我们该构建什么？')

  const composerPlaceholder =
    surface === 'chat'
      ? t('给 Pidex 发消息')
      : surface === 'working'
        ? t('使用 Pidex Working，描述你的任务')
        : undefined

  return (
    <div
      ref={pageRef}
      className="quick-chat-workspace tw:flex tw:h-full tw:w-full tw:min-h-0 tw:overflow-hidden"
    >
      <main className="quick-chat-view coding-chat-view tw:flex tw:h-full tw:max-w-none tw:w-full tw:min-h-full tw:flex-col tw:items-stretch tw:justify-end tw:overflow-x-hidden tw:overflow-y-auto tw:px-8 tw:pb-4 tw:text-app-text tw:[scrollbar-gutter:stable]">
        <section className="quick-chat-hero-region tw:m-auto tw:flex tw:w-full tw:min-w-0 tw:flex-col tw:items-center tw:justify-center tw:gap-5">
          <div className="quick-chat-hero tw:flex tw:w-[var(--quick-chat-surface-width)] tw:max-w-full tw:flex-col tw:items-center tw:gap-6 tw:text-center tw:text-app-text tw:type-display">
            <button
              ref={whaleMarkRef}
              aria-hidden="true"
              className="quick-chat-mark tw:block tw:size-14 tw:origin-center tw:cursor-pointer tw:select-none tw:border-0 tw:bg-app-text tw:p-0 tw:opacity-30 tw:[mask:url('/pidex-mark-green.svg')_center/contain_no-repeat] tw:[transition:opacity_var(--cpx-sys-motion-micro)_var(--cpx-sys-ease-standard),transform_var(--cpx-sys-motion-state)_var(--cpx-sys-ease-standard)] tw:hover:opacity-40 tw:focus-visible:outline-offset-4"
              tabIndex={-1}
              type="button"
              onClick={handleWhaleMarkClick}
            />
            <CodingHeadingTransition transitionKey={headingKey}>
              {headingContent}
            </CodingHeadingTransition>
          </div>
        </section>

        <section className="quick-chat-composer-region tw:flex tw:w-full tw:min-w-0 tw:flex-col tw:items-center tw:justify-end tw:gap-3">
          {composerProps ? (
            <div className="chat-composer tw:static tw:m-0 tw:flex tw:w-[var(--quick-chat-surface-width)] tw:max-w-full tw:flex-col tw:items-center tw:gap-3 tw:pointer-events-auto">
              <DesktopComposer
                {...composerProps}
                placeholder={composerPlaceholder}
                productMode={surface}
                onProductModeChange={onModeChange}
                surface={surface}
              />
            </div>
          ) : null}
        </section>
      </main>
    </div>
  )
}

function NewSessionPresence({
  children,
  kind,
  reducedMotion,
}: {
  children: React.ReactNode
  kind: 'panel' | 'surface'
  reducedMotion: boolean
}): React.ReactNode {
  const isPresent = useIsPresent()
  const panel = kind === 'panel'
  const offset = panel ? 4 : -4

  return (
    <motion.div
      animate={{ opacity: 1, scale: 1, y: 0 }}
      aria-hidden={!isPresent ? true : undefined}
      className={
        panel
          ? `new-session-${kind}-presence tw:flex tw:w-full tw:min-w-0 tw:justify-center`
          : `new-session-${kind}-presence tw:w-full tw:h-full tw:min-h-0`
      }
      data-presence={isPresent ? 'present' : 'exiting'}
      exit={{
        opacity: 0,
        scale: panel ? 0.985 : 1,
        y: offset,
        transition: motionTransition(reducedMotion, exitTween),
      }}
      inert={!isPresent ? true : undefined}
      initial={reducedMotion ? false : { opacity: 0, scale: panel ? 0.985 : 1, y: 4 }}
      style={{ pointerEvents: isPresent ? undefined : 'none' }}
      transition={motionTransition(reducedMotion, enterTween)}
    >
      {children}
    </motion.div>
  )
}
