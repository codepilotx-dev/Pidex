import type { PluginDetails } from '@pidex/agent-protocol'
import type React from 'react'
import {
  ArrowRight,
  Blocks,
  FileText,
  MessageCircle,
  MoreHorizontal,
  Server,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { usePluginSkills } from './UsePluginSkills.js'

import { PopoverItem } from '../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../components/ui/PopoverMenu.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import promptHeroPurple from '../../assets/plugin-backgrounds/prompt-hero-purple.png'
import { PluginDetailsPrimaryAction, PluginDetailsMetadata } from './PluginDetailsContent.js'
import { PluginIcon } from './PluginIcon.js'
import { pluginPrimaryAction, type PluginCatalogItem } from './PluginCatalog.js'
import { cx } from '../../utils/Cx.js'
import {
  DETAILS_ACTION_GROUP_CLASS,
  DETAILS_ERROR_CLASS,
  DETAILS_IDENTITY_CLASS,
  DETAILS_SECTION_CLASS,
  DETAILS_SECTION_TITLE_CLASS,
  FORCED_COLORS_SURFACE_CLASS,
} from './CatalogClassNames.js'

const SECTION_HEADING_CLASS =
  'tw:flex tw:items-center tw:justify-between tw:gap-3 tw:border-b tw:border-app-border-subtle tw:pb-3'

type Props = {
  item: PluginCatalogItem
  details: PluginDetails | null
  busy: boolean
  error?: string | null
  onPrimaryAction: (item: PluginCatalogItem, trigger: HTMLButtonElement, checked?: boolean) => void
  detailsError?: string | null
  onRetryDetails?: () => void
  onTryPrompt: (prompt: string) => void
  onUninstall?: () => void
  workspacePath?: string | null
}

export function PluginProductDetailsView({
  item,
  details,
  busy,
  error,
  onPrimaryAction,
  onTryPrompt,
  onUninstall,
  workspacePath,
  detailsError,
  onRetryDetails,
}: Props): React.ReactNode {
  const [moreOpen, setMoreOpen] = useState(false)
  const prompts = (details?.defaultPrompts ?? []).map((prompt) => prompt.trim()).filter(Boolean)
  const skills =
    details?.skills ?? (item.skills ?? []).map((id) => ({ id, name: id, description: '' }))
  const primaryAction = pluginPrimaryAction(item)
  const canTry =
    prompts.length > 0 &&
    item.status !== 'unavailable' &&
    (item.installed || item.canInstall === true)
  const runtimeSkills = usePluginSkills(item.id, item.enabled && skills.length > 0, workspacePath)
  const componentGroups = [
    { kind: 'mcp' as const, title: 'MCP 服务器', Icon: Server },
    { kind: 'documentation' as const, title: '文档', Icon: FileText },
  ]

  return (
    <section
      className={cx(
        'catalog-details-view catalog-plugin-details tw:grid tw:mx-auto tw:w-[min(var(--page-content-max-width),100%)] tw:gap-8',
      )}
    >
      <header className="catalog-details-view__header tw:flex tw:flex-col tw:items-start tw:gap-5">
        <span
          aria-hidden="true"
          className={cx(
            'catalog-details-view__icon',
            'tw:inline-flex tw:size-16 tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-container tw:text-app-text',
            FORCED_COLORS_SURFACE_CLASS,
          )}
          data-plugin-tone={item.tone}
        >
          <PluginIcon
            plugin={item}
            logoDarkSource={item.logoDarkSource}
            logoSource={item.logoSource}
            name={item.iconName}
          />
        </span>
        <div className="catalog-plugin-details__heading-row tw:flex tw:w-full tw:min-w-0 tw:flex-wrap tw:items-start tw:justify-between tw:gap-4">
          <div
            className={cx('catalog-details-view__identity', DETAILS_IDENTITY_CLASS, 'tw:flex-1')}
          >
            <h1 className="tw:m-0 tw:text-app-text tw:type-title-xl tw:wrap-anywhere">
              {item.name}
            </h1>
            <p className="tw:m-0 tw:text-app-text-soft tw:type-body">{item.description}</p>
          </div>
          <div className={cx('catalog-details-view__primary-action', DETAILS_ACTION_GROUP_CLASS)}>
            {item.canUninstall && item.installed && onUninstall ? (
              <PopoverMenu
                align="end"
                open={moreOpen}
                onOpenChange={setMoreOpen}
                size="sm"
                trigger={
                  <Button isIconOnly color="ghostSecondary" size="toolbar" title="更多插件操作">
                    <MoreHorizontal
                      aria-hidden="true"
                      size={APP_ICON_SIZE}
                      strokeWidth={APP_ICON_STROKE_WIDTH}
                    />
                  </Button>
                }
              >
                <PopoverItem
                  disabled={busy}
                  icon={
                    <Trash2
                      aria-hidden="true"
                      size={APP_ICON_SIZE}
                      strokeWidth={APP_ICON_STROKE_WIDTH}
                    />
                  }
                  onClick={onUninstall}
                >
                  卸载
                </PopoverItem>
              </PopoverMenu>
            ) : null}
            {canTry ? (
              <Button color="primary" disabled={busy} onClick={() => onTryPrompt(prompts[0]!)}>
                <MessageCircle
                  aria-hidden="true"
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
                立即试用
              </Button>
            ) : null}
            {primaryAction.kind === 'toggle-plugin' || !canTry ? (
              <PluginDetailsPrimaryAction
                ariaLabel={`启用 ${item.name} 插件`}
                busy={busy}
                item={item}
                onPrimaryAction={onPrimaryAction}
              />
            ) : null}
          </div>
        </div>
      </header>

      {prompts.length ? (
        <div
          aria-label="示例提示词"
          className="catalog-plugin-prompts tw:relative tw:isolate tw:flex tw:justify-center tw:overflow-hidden tw:rounded-container tw:bg-app-underlay tw:px-8 tw:py-8 tw:after:pointer-events-none tw:after:absolute tw:after:inset-0 tw:after:z-1 tw:after:bg-app-panel/70 tw:after:content-[''] tw:forced-colors:after:hidden"
        >
          <img
            alt=""
            aria-hidden="true"
            className="catalog-plugin-prompts__background tw:pointer-events-none tw:absolute tw:inset-0 tw:z-0 tw:size-full tw:object-cover tw:object-center tw:select-none tw:forced-colors:hidden"
            draggable={false}
            src={promptHeroPurple}
          />
          <div className="tw:relative tw:z-2 tw:flex tw:w-full tw:max-w-[40rem] tw:flex-col tw:items-center tw:gap-4">
            {prompts.map((prompt, index) => (
              <button
                className="catalog-plugin-prompts__item tw:grid tw:w-fit tw:max-w-[77%] tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-2 tw:rounded-container tw:border-0 tw:bg-app-panel/75 tw:p-2 tw:text-left tw:text-app-text tw:type-body tw:enabled:cursor-pointer tw:enabled:hover:bg-app-panel tw:disabled:cursor-not-allowed tw:disabled:opacity-50 tw:focus-visible:outline-2 tw:focus-visible:outline-solid tw:focus-visible:outline-offset-2 tw:focus-visible:outline-app-focus tw:forced-colors:border tw:forced-colors:border-[color:CanvasText] tw:forced-colors:bg-[color:Canvas] tw:forced-colors:[color:CanvasText]"
                disabled={!canTry || busy}
                key={`${index}:${prompt}`}
                onClick={() => onTryPrompt(prompt)}
                type="button"
              >
                <span className="catalog-plugin-prompts__label tw:flex tw:min-w-0 tw:items-baseline tw:gap-1">
                  <PluginIcon
                    plugin={item}
                    className="catalog-plugin-prompts__plugin-icon tw:shrink-0 tw:basis-3.5 tw:max-w-3.5 tw:max-h-3.5 tw:overflow-hidden tw:rounded-sm"
                    logoDarkSource={item.logoDarkSource}
                    logoSource={item.logoSource}
                    name={item.iconName}
                  />
                  <span>
                    <strong className="tw:text-app-accent-fg tw:type-weight-label">
                      {item.name}
                    </strong>{' '}
                    {prompt}
                  </span>
                </span>
                <span className="catalog-plugin-prompts__arrow tw:inline-flex tw:size-7 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-full tw:bg-app-text/10 tw:forced-colors:border">
                  <ArrowRight
                    aria-hidden="true"
                    size={APP_ICON_SIZE}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {detailsError ? (
        <div className={DETAILS_ERROR_CLASS} role="status">
          {detailsError}
          <Button color="secondary" onClick={onRetryDetails}>
            重试详情
          </Button>
        </div>
      ) : null}
      {details?.longDescription && details.longDescription.trim() !== item.description.trim() ? (
        <p className="catalog-plugin-details__description tw:m-0 tw:whitespace-pre-line tw:text-app-text tw:type-body">
          {details.longDescription}
        </p>
      ) : null}

      {skills.length ? (
        <section
          aria-labelledby="catalog-plugin-skills"
          className={cx('catalog-details-section', DETAILS_SECTION_CLASS)}
        >
          <div className={cx('catalog-details-section__heading', SECTION_HEADING_CLASS)}>
            <h2 className={DETAILS_SECTION_TITLE_CLASS} id="catalog-plugin-skills">
              技能 {skills.length}
            </h2>
          </div>
          <div className="catalog-plugin-skills tw:grid">
            {skills.map((skill) => {
              const installedSkill = runtimeSkills.skills.find(
                (entry) => entry.path === `plugin://${item.id}/skills/${skill.id}/SKILL.md`,
              )
              return (
                <div
                  className="catalog-plugin-skill tw:grid tw:grid-cols-[auto_minmax(0,1fr)_auto] tw:min-w-0 tw:items-center tw:gap-4 tw:py-4"
                  key={skill.id}
                >
                  <span
                    aria-hidden="true"
                    className={cx(
                      'catalog-plugin-skill__icon tw:inline-flex tw:size-8 tw:items-center tw:justify-center tw:text-app-text-soft',
                      FORCED_COLORS_SURFACE_CLASS,
                    )}
                    data-plugin-tone={item.tone}
                  >
                    <Blocks aria-hidden="true" size={24} strokeWidth={APP_ICON_STROKE_WIDTH} />
                  </span>
                  <div className="catalog-plugin-skill__copy tw:grid tw:min-w-0 tw:gap-1">
                    <h3 className="tw:m-0 tw:text-app-text tw:type-row-title">
                      {skills.length === 1 && skill.id === item.id ? item.name : skill.name}
                    </h3>
                    {skill.description ? (
                      <p className="tw:m-0 tw:text-app-text-soft tw:type-body-sm">
                        {skill.description}
                      </p>
                    ) : null}
                  </div>
                  <ToggleSwitch
                    ariaLabel={`启用 ${skill.name} 技能`}
                    checked={installedSkill?.enabled ?? false}
                    disabled={!item.enabled || !installedSkill || busy || runtimeSkills.pending}
                    onChange={(enabled) => {
                      if (installedSkill)
                        void runtimeSkills.setEnabled(installedSkill.path, enabled)
                    }}
                  />
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {componentGroups.map(({ kind, title, Icon }) => {
        const components = details?.components?.filter((component) => component.kind === kind) ?? []
        return components.length ? (
          <section
            aria-labelledby={`catalog-plugin-${kind}`}
            key={kind}
            className={cx('catalog-details-section', DETAILS_SECTION_CLASS)}
          >
            <div className={cx('catalog-details-section__heading', SECTION_HEADING_CLASS)}>
              <h2 className={DETAILS_SECTION_TITLE_CLASS} id={`catalog-plugin-${kind}`}>
                {title} {components.length}
              </h2>
            </div>
            <div className="tw:grid">
              {components.map((component) => (
                <div
                  className="tw:flex tw:items-center tw:gap-4 tw:py-4"
                  key={`${component.kind}:${component.id}`}
                >
                  <Icon
                    aria-hidden="true"
                    className="tw:shrink-0 tw:text-app-text-soft"
                    size={24}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                  <div className="tw:grid tw:min-w-0 tw:gap-1">
                    <h3 className="tw:m-0 tw:text-app-text tw:type-row-title">{component.name}</h3>
                    <p className="tw:m-0 tw:text-app-text-soft tw:type-body-sm">
                      {component.description ||
                        (component.managedBy === 'host' ? '由 Pidex 宿主管理' : '插件提供')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null
      })}

      <section
        aria-labelledby="catalog-plugin-information"
        className={cx('catalog-details-section', DETAILS_SECTION_CLASS)}
      >
        <div className={cx('catalog-details-section__heading', SECTION_HEADING_CLASS)}>
          <h2 className={DETAILS_SECTION_TITLE_CLASS} id="catalog-plugin-information">
            信息
          </h2>
        </div>
        <PluginDetailsMetadata item={item} details={details} />
      </section>

      {error || runtimeSkills.error ? (
        <p className={cx('catalog-details-view__error', DETAILS_ERROR_CLASS)} role="status">
          {error || runtimeSkills.error}
        </p>
      ) : null}
    </section>
  )
}
