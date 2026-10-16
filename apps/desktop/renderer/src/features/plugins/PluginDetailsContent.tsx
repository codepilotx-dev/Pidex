import type { PluginDetails } from '@pidex/agent-protocol'
import { desktopClient } from '../../services/desktop-client/index.js'
import type React from 'react'
import { ExternalLink } from 'lucide-react'
import { useRef } from 'react'
import { Button } from '../../components/ui/Button.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import type { PluginCatalogItem } from './PluginCatalog.js'
import {
  PLUGIN_CATEGORY_LABELS,
  PLUGIN_SOURCE_LABELS,
  pluginPrimaryAction,
  pluginStatusLabel,
} from './PluginCatalog.js'
import { cx } from '../../utils/Cx.js'
import {
  DETAILS_METADATA_CLASS,
  DETAILS_METADATA_LABEL_CLASS,
  DETAILS_METADATA_ROW_CLASS,
  DETAILS_METADATA_VALUE_CLASS,
} from './CatalogClassNames.js'

type ActionProps = {
  item: PluginCatalogItem
  busy?: boolean
  ariaLabel?: string
  onPrimaryAction: (item: PluginCatalogItem, trigger: HTMLButtonElement, checked?: boolean) => void
}

export function PluginDetailsMetadata({
  item,
  details,
}: {
  item: PluginCatalogItem
  details?: PluginDetails | null
}): React.ReactNode {
  return (
    <dl className={cx('plugin-details-metadata', DETAILS_METADATA_CLASS)}>
      <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
        <dt className={DETAILS_METADATA_LABEL_CLASS}>来源</dt>
        <dd className={DETAILS_METADATA_VALUE_CLASS}>
          {item.source ? PLUGIN_SOURCE_LABELS[item.source] : PLUGIN_CATEGORY_LABELS[item.category]}
        </dd>
      </div>
      <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
        <dt className={DETAILS_METADATA_LABEL_CLASS}>状态</dt>
        <dd className={DETAILS_METADATA_VALUE_CLASS}>{pluginStatusLabel(item)}</dd>
      </div>
      {item.version ? (
        <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
          <dt className={DETAILS_METADATA_LABEL_CLASS}>版本</dt>
          <dd className={DETAILS_METADATA_VALUE_CLASS}>{item.version}</dd>
        </div>
      ) : null}
      {item.developerName ? (
        <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
          <dt className={DETAILS_METADATA_LABEL_CLASS}>开发者</dt>
          <dd className={DETAILS_METADATA_VALUE_CLASS}>{item.developerName}</dd>
        </div>
      ) : null}
      {details?.displayCapabilities.length ? (
        <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
          <dt className={DETAILS_METADATA_LABEL_CLASS}>能力</dt>
          <dd className={DETAILS_METADATA_VALUE_CLASS}>{details.displayCapabilities.join('、')}</dd>
        </div>
      ) : null}
      {item.productCategory ? (
        <div className={DETAILS_METADATA_ROW_CLASS}>
          <dt className={DETAILS_METADATA_LABEL_CLASS}>类别</dt>
          <dd className={DETAILS_METADATA_VALUE_CLASS}>{item.productCategory}</dd>
        </div>
      ) : null}
      {(['websiteURL', 'privacyPolicyURL', 'termsOfServiceURL'] as const).map((key) => {
        const url = details?.[key]
        const label = {
          websiteURL: '网站',
          privacyPolicyURL: '隐私政策',
          termsOfServiceURL: '服务条款',
        }[key]
        return url ? (
          <div className={DETAILS_METADATA_ROW_CLASS} key={key}>
            <dt className={DETAILS_METADATA_LABEL_CLASS}>{label}</dt>
            <dd className={DETAILS_METADATA_VALUE_CLASS}>
              <Button
                color="ghostSecondary"
                size="toolbar"
                onClick={() => void desktopClient.openExternalURL(url)}
              >
                打开{label}
                <ExternalLink aria-hidden="true" size={APP_ICON_SIZE} />
              </Button>
            </dd>
          </div>
        ) : null
      })}
      {item.unavailableReason ? (
        <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
          <dt className={DETAILS_METADATA_LABEL_CLASS}>说明</dt>
          <dd className={DETAILS_METADATA_VALUE_CLASS}>{item.unavailableReason}</dd>
        </div>
      ) : null}
    </dl>
  )
}

export function PluginDetailsPrimaryAction({
  ariaLabel,
  item,
  busy = false,
  onPrimaryAction,
}: ActionProps): React.ReactNode {
  const action = pluginPrimaryAction(item)
  const toggleRef = useRef<HTMLButtonElement>(null)

  if (action.kind === 'toggle-plugin') {
    return (
      <span className="plugin-details-primary-toggle tw:flex tw:items-center tw:gap-2 tw:text-app-text-meta tw:type-caption tw:whitespace-nowrap">
        <span>{action.checked ? '已启用' : '已禁用'}</span>
        <ToggleSwitch
          ref={toggleRef}
          ariaLabel={ariaLabel ?? `启用 ${item.name}`}
          checked={action.checked}
          disabled={action.disabled || busy}
          onChange={(checked) => {
            const trigger = toggleRef.current
            if (trigger) onPrimaryAction(item, trigger, checked)
          }}
        />
      </span>
    )
  }

  return (
    <Button
      color="secondary"
      disabled={action.disabled}
      loading={busy}
      onClick={(event) => onPrimaryAction(item, event.currentTarget)}
    >
      {action.label}
      {action.kind === 'open-external' ? (
        <ExternalLink aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      ) : null}
    </Button>
  )
}
