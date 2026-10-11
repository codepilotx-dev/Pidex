import type React from 'react'
import { useRef } from 'react'
import { ExternalLink } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import type { PluginCatalogItem } from './PluginCatalog.js'
import { pluginPrimaryAction, pluginStatusLabel } from './PluginCatalog.js'
import { PluginIcon } from './PluginIcon.js'
import { cx } from '../../utils/Cx.js'
import {
  FORCED_COLORS_FOCUS_CLASS,
  FORCED_COLORS_SURFACE_CLASS,
  PLAIN_BUTTON_CLASS,
  STACKED_COPY_CLASS,
  TRUNCATED_LINE_CLASS,
} from './CatalogClassNames.js'

type Props = {
  item: PluginCatalogItem
  busy?: boolean
  error?: string | null
  onOpenDetails: (item: PluginCatalogItem, trigger: HTMLButtonElement) => void
  onPrimaryAction: (item: PluginCatalogItem, trigger: HTMLButtonElement, checked?: boolean) => void
}

export function PluginCatalogCard({
  item,
  busy = false,
  error,
  onOpenDetails,
  onPrimaryAction,
}: Props): React.ReactNode {
  const action = pluginPrimaryAction(item)
  const errorId = error ? `plugin-card-${item.id}-error` : undefined
  const toggleRef = useRef<HTMLButtonElement>(null)

  return (
    <li>
      <article
        className={cx(
          'plugin-catalog-card tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:min-w-0 tw:items-center tw:gap-3 tw:rounded-2xl tw:border-0 tw:bg-transparent tw:p-2.5 tw:shadow-none tw:transition-[background-color] tw:duration-state tw:ease-standard tw:[&:hover:not(:has(>div:hover))]:bg-app-hover tw:@max-[479px]/plugins-page:grid-cols-1',
          FORCED_COLORS_SURFACE_CLASS,
        )}
        data-plugin-category={item.category}
        data-plugin-status={item.status}
        data-plugin-tone={item.tone}
      >
        <button
          aria-describedby={errorId}
          className={cx('plugin-catalog-card__main', PLAIN_BUTTON_CLASS, FORCED_COLORS_FOCUS_CLASS)}
          data-catalog-item-id={`plugin:${item.id}`}
          onClick={(event) => onOpenDetails(item, event.currentTarget)}
          type="button"
        >
          <span
            aria-hidden="true"
            className={cx(
              'plugin-catalog-card__icon tw:inline-flex tw:size-9 tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-raised tw:text-app-text',
              FORCED_COLORS_SURFACE_CLASS,
            )}
          >
            <PluginIcon
              logoDarkSource={item.logoDarkSource}
              logoSource={item.logoSource}
              name={item.iconName}
            />
          </span>
          <span className={cx('plugin-catalog-card__copy', STACKED_COPY_CLASS)}>
            <strong className="tw:overflow-hidden tw:text-app-text tw:type-row-title tw:text-ellipsis tw:whitespace-nowrap">
              {item.name}
            </strong>
            <span className={cx('plugin-catalog-card__description', TRUNCATED_LINE_CLASS)}>
              {item.description}
            </span>
            {item.category === 'manageable' ||
            item.actionKind === 'install' ||
            item.id === 'minimax' ? (
              <span className={cx('plugin-catalog-card__meta', TRUNCATED_LINE_CLASS)}>
                {pluginStatusLabel(item)}
              </span>
            ) : null}
            {error ? (
              <span
                className="plugin-catalog-card__error tw:min-w-0 tw:text-app-danger tw:type-body-sm tw:wrap-anywhere"
                id={errorId}
                role="status"
              >
                {error}
              </span>
            ) : null}
          </span>
        </button>

        <div className="plugin-catalog-card__actions tw:flex tw:items-center tw:justify-end tw:@max-[479px]/plugins-page:justify-start">
          {action.kind === 'toggle-plugin' ? (
            <ToggleSwitch
              ref={toggleRef}
              ariaLabel={`启用 ${item.name}`}
              checked={action.checked}
              disabled={action.disabled || busy}
              onChange={(checked) => {
                const trigger = toggleRef.current
                if (trigger) onPrimaryAction(item, trigger, checked)
              }}
            />
          ) : (
            <Button
              aria-describedby={errorId}
              className="plugin-catalog-card__external-action"
              color="secondary"
              disabled={action.disabled}
              loading={busy}
              onClick={(event) => onPrimaryAction(item, event.currentTarget)}
              size="toolbar"
            >
              {action.label}
              {action.kind === 'open-external' ? (
                <ExternalLink
                  aria-hidden="true"
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              ) : null}
            </Button>
          )}
        </div>
      </article>
    </li>
  )
}
