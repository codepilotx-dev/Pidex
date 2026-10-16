import type { PluginDetails } from '@pidex/agent-protocol'
import type React from 'react'
import { ExternalLink, Plus, Sparkles } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import type { DesktopSkillCatalogItem } from '../../../shared/Types.js'
import { PluginProductDetailsView } from './PluginProductDetailsView.js'
import type { PluginCatalogItem } from './PluginCatalog.js'
import { cx } from '../../utils/Cx.js'
import {
  DETAILS_ACTION_GROUP_CLASS,
  DETAILS_ICON_CLASS,
  DETAILS_IDENTITY_CLASS,
  DETAILS_METADATA_CLASS,
  DETAILS_METADATA_LABEL_CLASS,
  DETAILS_METADATA_ROW_CLASS,
  DETAILS_METADATA_VALUE_CLASS,
  DETAILS_SECTION_CLASS,
  FORCED_COLORS_SURFACE_CLASS,
} from './CatalogClassNames.js'

type PluginProps = {
  kind: 'plugin'
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

type SkillProps = {
  kind: 'skill'
  item: DesktopSkillCatalogItem
  installing: boolean
  onInstall: (skill: DesktopSkillCatalogItem) => void
  onOpenSource: (skill: DesktopSkillCatalogItem) => void
}

export function CatalogDetailsView(props: PluginProps | SkillProps): React.ReactNode {
  if (props.kind === 'plugin') {
    return <PluginProductDetailsView {...props} />
  }

  const { item } = props

  return (
    <section className="catalog-details-view tw:grid tw:mx-auto tw:w-[min(var(--page-content-max-width),100%)] tw:gap-7">
      <header className="catalog-details-view__header tw:grid tw:grid-cols-[auto_minmax(0,1fr)_auto] tw:items-center tw:gap-4 tw:@max-[479px]/plugins-page:grid-cols-1">
        <span
          aria-hidden="true"
          className={cx(
            'catalog-details-view__icon',
            DETAILS_ICON_CLASS,
            FORCED_COLORS_SURFACE_CLASS,
          )}
        >
          <Sparkles data-icon-kind="artwork" size={APP_ICON_SIZE} strokeWidth={2} />
        </span>
        <div className={cx('catalog-details-view__identity', DETAILS_IDENTITY_CLASS)}>
          <h1 className="tw:m-0 tw:text-app-text tw:type-title-sm tw:wrap-anywhere">{item.name}</h1>
          <p className="tw:m-0 tw:text-app-text-soft tw:type-body-sm">{props.item.source}</p>
        </div>
        <div className={cx('catalog-details-view__primary-action', DETAILS_ACTION_GROUP_CLASS)}>
          {props.item.installed ? (
            <span className="catalog-details-view__installed tw:text-app-success-fg tw:type-caption">
              已添加
            </span>
          ) : (
            <Button
              color="secondary"
              loading={props.installing}
              onClick={() => props.onInstall(props.item)}
            >
              <Plus aria-hidden="true" size={APP_ICON_SIZE} />
              添加
            </Button>
          )}
        </div>
      </header>

      <div className="catalog-details-view__body tw:grid tw:min-w-0 tw:gap-6">
        <section
          aria-labelledby="catalog-details-overview"
          className={cx('catalog-details-section', DETAILS_SECTION_CLASS)}
        >
          <h2 className="tw:m-0 tw:text-app-text tw:type-title-sm" id="catalog-details-overview">
            概览
          </h2>
          <SkillDetailsMetadata item={props.item} />
        </section>

        <section
          aria-labelledby="catalog-details-audit"
          className={cx('catalog-details-section', DETAILS_SECTION_CLASS)}
        >
          <h2 className="tw:m-0 tw:text-app-text tw:type-title-sm" id="catalog-details-audit">
            安全审计
          </h2>
          {props.item.audit ? (
            <dl className={cx('plugin-details-metadata', DETAILS_METADATA_CLASS)}>
              <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
                <dt className={DETAILS_METADATA_LABEL_CLASS}>结果</dt>
                <dd className={DETAILS_METADATA_VALUE_CLASS}>
                  {skillAuditLabel(props.item.audit.status)}
                </dd>
              </div>
              <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
                <dt className={DETAILS_METADATA_LABEL_CLASS}>摘要</dt>
                <dd className={DETAILS_METADATA_VALUE_CLASS}>{props.item.audit.summary}</dd>
              </div>
              <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
                <dt className={DETAILS_METADATA_LABEL_CLASS}>Provider</dt>
                <dd className={DETAILS_METADATA_VALUE_CLASS}>{props.item.audit.providerCount}</dd>
              </div>
              {props.item.audit.auditedAt ? (
                <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
                  <dt className={DETAILS_METADATA_LABEL_CLASS}>审计时间</dt>
                  <dd className={DETAILS_METADATA_VALUE_CLASS}>
                    {new Date(props.item.audit.auditedAt).toLocaleString()}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="catalog-details-section__empty tw:m-0 tw:text-app-text-soft tw:type-body-sm">
              该目录条目未提供审计信息。
            </p>
          )}
        </section>

        {props.item.url ? (
          <div className={cx('catalog-details-view__secondary-action', DETAILS_ACTION_GROUP_CLASS)}>
            <Button color="secondary" onClick={() => props.onOpenSource(props.item)}>
              打开来源页面
              <ExternalLink
                aria-hidden="true"
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function SkillDetailsMetadata({ item }: { item: DesktopSkillCatalogItem }): React.ReactNode {
  return (
    <dl className={cx('plugin-details-metadata', DETAILS_METADATA_CLASS)}>
      <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
        <dt className={DETAILS_METADATA_LABEL_CLASS}>来源</dt>
        <dd className={DETAILS_METADATA_VALUE_CLASS}>{item.source}</dd>
      </div>
      <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
        <dt className={DETAILS_METADATA_LABEL_CLASS}>来源类型</dt>
        <dd className={DETAILS_METADATA_VALUE_CLASS}>{item.sourceType}</dd>
      </div>
      <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
        <dt className={DETAILS_METADATA_LABEL_CLASS}>安装量</dt>
        <dd className={DETAILS_METADATA_VALUE_CLASS}>{item.installs.toLocaleString()}</dd>
      </div>
      <div className={cx('plugin-details-metadata__row', DETAILS_METADATA_ROW_CLASS)}>
        <dt className={DETAILS_METADATA_LABEL_CLASS}>状态</dt>
        <dd className={DETAILS_METADATA_VALUE_CLASS}>{item.installed ? '已添加' : '未添加'}</dd>
      </div>
    </dl>
  )
}

function skillAuditLabel(status: 'pass' | 'warn' | 'fail'): string {
  if (status === 'pass') return '通过'
  if (status === 'warn') return '需要注意'
  return '未通过'
}
