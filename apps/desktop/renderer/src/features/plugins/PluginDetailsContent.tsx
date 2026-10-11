import type React from 'react'
import { ExternalLink } from 'lucide-react'
import { useRef } from 'react'
import { Button } from '../../components/ui/Button.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import type { PluginCatalogItem } from './PluginCatalog.js'
import { PLUGIN_CATEGORY_LABELS, pluginPrimaryAction, pluginStatusLabel } from './PluginCatalog.js'
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

export function PluginDetailsMetadata({ item }: { item: PluginCatalogItem }): React.ReactNode {
  return (
    <dl className={cx('plugin-details-metadata', DETAILS_METADATA_CLASS)}>
      <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
        <dt className={DETAILS_METADATA_LABEL_CLASS}>来源</dt>
        <dd className={DETAILS_METADATA_VALUE_CLASS}>{PLUGIN_CATEGORY_LABELS[item.category]}</dd>
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
      {item.capabilities?.length ? (
        <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
          <dt className={DETAILS_METADATA_LABEL_CLASS}>能力</dt>
          <dd className={DETAILS_METADATA_VALUE_CLASS}>{item.capabilities.join('、')}</dd>
        </div>
      ) : null}
      {item.skills?.length ? (
        <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
          <dt className={DETAILS_METADATA_LABEL_CLASS}>技能</dt>
          <dd className={DETAILS_METADATA_VALUE_CLASS}>{item.skills.join('、')}</dd>
        </div>
      ) : null}
      {item.unavailableReason ? (
        <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
          <dt className={DETAILS_METADATA_LABEL_CLASS}>说明</dt>
          <dd className={DETAILS_METADATA_VALUE_CLASS}>{item.unavailableReason}</dd>
        </div>
      ) : null}
      {item.miniMaxCli?.latestVersion ? (
        <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
          <dt className={DETAILS_METADATA_LABEL_CLASS}>最新版本</dt>
          <dd className={DETAILS_METADATA_VALUE_CLASS}>{item.miniMaxCli.latestVersion}</dd>
        </div>
      ) : null}
      {item.miniMaxCli ? (
        <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
          <dt className={DETAILS_METADATA_LABEL_CLASS}>认证</dt>
          <dd className={DETAILS_METADATA_VALUE_CLASS}>
            {miniMaxAuthLabel(item.miniMaxCli.authStatus)}
          </dd>
        </div>
      ) : null}
      {item.miniMaxCli?.credentialSource ? (
        <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
          <dt className={DETAILS_METADATA_LABEL_CLASS}>当前 Key</dt>
          <dd className={DETAILS_METADATA_VALUE_CLASS}>
            {item.miniMaxCli.credentialSource.label} ·{' '}
            {item.miniMaxCli.credentialSource.maskedValue}
          </dd>
        </div>
      ) : null}
      {item.miniMaxCli?.credentialSource ? (
        <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
          <dt className={DETAILS_METADATA_LABEL_CLASS}>区域</dt>
          <dd className={DETAILS_METADATA_VALUE_CLASS}>
            {item.miniMaxCli.credentialSource.region === 'cn' ? '中国' : 'Global'}
          </dd>
        </div>
      ) : null}
      {item.miniMaxCli?.quotaLabel ? (
        <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
          <dt className={DETAILS_METADATA_LABEL_CLASS}>套餐</dt>
          <dd className={DETAILS_METADATA_VALUE_CLASS}>{item.miniMaxCli.quotaLabel}</dd>
        </div>
      ) : null}
    </dl>
  )
}

function miniMaxAuthLabel(
  status: NonNullable<PluginCatalogItem['miniMaxCli']>['authStatus'],
): string {
  if (status === 'coding-plan-synced') return '正在使用 API Key Hub 当前 Coding Plan Key'
  if (status === 'oauth') return '已通过 MiniMax 登录'
  if (status === 'api-key') return '已配置 MiniMax API Key'
  if (status === 'not-authenticated') return '尚未登录，实际使用时再登录'
  return '暂时无法确认'
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
