import type React from 'react'
import { ExternalLink, Plus } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import { Tooltip } from '../../components/ui/Tooltip.js'
import { PluginActionsMenu } from './PluginActionsMenu.js'
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
  const statusClass =
    item.status === 'disabled'
      ? 'tw:opacity-60'
      : item.status === 'unavailable' || item.status === 'error'
        ? 'tw:opacity-40'
        : undefined
  const unavailableReason = item.unavailableReason ?? pluginStatusLabel(item)
  const errorId = error ? `plugin-card-${item.id}-error` : undefined

  return (
    <li>
      <article
        className={cx(
          'plugin-catalog-card tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:min-w-0 tw:items-center tw:gap-3 tw:rounded-item tw:border-0 tw:bg-transparent tw:p-3 tw:shadow-none tw:transition-[background-color] tw:duration-state tw:ease-standard tw:hover:bg-app-hover tw:active:bg-app-active',
          FORCED_COLORS_SURFACE_CLASS,
        )}
        data-plugin-category={item.category}
        data-plugin-status={item.status}
        data-plugin-tone={item.tone}
      >
        <button
          aria-describedby={errorId}
          aria-label={`${item.name} · ${pluginStatusLabel(item)}`}
          title={pluginStatusLabel(item)}
          data-plugin-status={item.status}
          className={cx(
            'plugin-catalog-card__main tw:grid-cols-[auto_minmax(0,1fr)] tw:gap-3',
            PLAIN_BUTTON_CLASS,
            FORCED_COLORS_FOCUS_CLASS,
          )}
          data-catalog-item-id={`plugin:${item.id}`}
          onClick={(event) => onOpenDetails(item, event.currentTarget)}
          type="button"
        >
          <span
            aria-hidden="true"
            className={cx(
              'plugin-catalog-card__icon tw:inline-flex tw:size-9 tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-raised tw:text-app-text',
              FORCED_COLORS_SURFACE_CLASS,
              statusClass,
            )}
          >
            <PluginIcon
              logoDarkSource={item.logoDarkSource}
              logoSource={item.logoSource}
              name={item.iconName}
            />
          </span>
          <span className={cx('plugin-catalog-card__copy', STACKED_COPY_CLASS)}>
            <strong
              className={cx(
                'tw:overflow-hidden tw:text-app-text tw:type-row-title tw:text-ellipsis tw:whitespace-nowrap',
                statusClass,
              )}
            >
              {item.name}
            </strong>
            <span
              className={cx('plugin-catalog-card__description', TRUNCATED_LINE_CLASS, statusClass)}
            >
              {item.description}
            </span>
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

        <div className="plugin-catalog-card__actions tw:flex tw:items-center tw:justify-end">
          {item.installed ? (
            <PluginActionsMenu item={item} busy={busy} onPrimaryAction={onPrimaryAction} />
          ) : (
            <Tooltip content={action.disabled ? unavailableReason : `${action.label} ${item.name}`}>
              <span
                tabIndex={action.disabled && !busy ? 0 : undefined}
                aria-label={action.disabled ? unavailableReason : undefined}
                className="tw:inline-flex tw:rounded-control tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus"
              >
                <Button
                  aria-describedby={errorId}
                  className="plugin-catalog-card__external-action"
                  color={action.kind === 'open-external' ? 'secondary' : 'ghostSecondary'}
                  isIconOnly={action.kind !== 'open-external'}
                  disabled={action.disabled || busy}
                  loading={busy}
                  title={`${action.label} ${item.name} · ${pluginStatusLabel(item)}`}
                  aria-label={`${action.label} ${item.name} · ${pluginStatusLabel(item)}`}
                  onClick={(event) => onPrimaryAction(item, event.currentTarget)}
                  size="toolbar"
                >
                  {action.kind === 'open-external' ? (
                    <>
                      {action.label}
                      <ExternalLink
                        aria-hidden="true"
                        size={APP_ICON_SIZE}
                        strokeWidth={APP_ICON_STROKE_WIDTH}
                      />
                    </>
                  ) : (
                    <Plus
                      aria-hidden="true"
                      size={APP_ICON_SIZE}
                      strokeWidth={APP_ICON_STROKE_WIDTH}
                    />
                  )}
                </Button>
              </span>
            </Tooltip>
          )}
        </div>
      </article>
    </li>
  )
}
