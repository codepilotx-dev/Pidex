import type React from 'react'
import { Check, Plus, ShieldAlert, ShieldCheck, ShieldX, Sparkles } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../components/ui/IconTokens.js'
import type { DesktopSkillAuditStatus, DesktopSkillCatalogItem } from '../../../shared/Types.js'
import { cx } from '../../utils/Cx.js'
import {
  FORCED_COLORS_FOCUS_CLASS,
  FORCED_COLORS_SURFACE_CLASS,
  PLAIN_BUTTON_CLASS,
  STACKED_COPY_CLASS,
  TRUNCATED_LINE_CLASS,
} from './CatalogClassNames.js'

/* 审计徽章按状态取整段配色，避免动态拼接类名。 */
const AUDIT_BADGE_TONE_CLASS: Record<DesktopSkillAuditStatus, string> = {
  pass: 'tw:border-app-success-border tw:bg-app-success-subtle tw:text-app-success-fg',
  warn: 'tw:border-app-warning-border tw:bg-app-warning-subtle tw:text-app-warning-fg',
  fail: 'tw:border-app-danger-border tw:bg-app-danger-subtle tw:text-app-danger-fg',
}

/* 审计徽章外壳：胶囊形、描边、大写标签。 */
const AUDIT_BADGE_CLASS =
  'plugins-audit-badge tw:inline-flex tw:shrink-0 tw:items-center tw:gap-1 tw:rounded-full tw:border tw:border-app-border tw:px-2 tw:py-1 tw:type-label tw:uppercase'

type Props = {
  installing?: boolean
  skill: DesktopSkillCatalogItem
  onInstall: (skill: DesktopSkillCatalogItem) => void
  onOpenDetails: (skill: DesktopSkillCatalogItem, trigger: HTMLButtonElement) => void
}

export function SkillCatalogCard({
  installing = false,
  skill,
  onInstall,
  onOpenDetails,
}: Props): React.ReactNode {
  return (
    <li>
      <article
        className={cx(
          'skill-catalog-card tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:min-w-0 tw:items-center tw:gap-3 tw:rounded-item tw:border-0 tw:bg-transparent tw:p-3 tw:shadow-none tw:transition-[background-color] tw:duration-state tw:ease-standard tw:hover:bg-app-hover',
          FORCED_COLORS_SURFACE_CLASS,
        )}
      >
        <button
          className={cx(
            'skill-catalog-card__main tw:grid-cols-[auto_minmax(0,1fr)] tw:gap-3',
            PLAIN_BUTTON_CLASS,
            FORCED_COLORS_FOCUS_CLASS,
          )}
          data-catalog-item-id={`skill:${skill.id}`}
          onClick={(event) => onOpenDetails(skill, event.currentTarget)}
          type="button"
        >
          <span
            aria-hidden="true"
            className={cx(
              'skill-catalog-card__icon tw:inline-flex tw:size-9 tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-raised tw:text-app-text',
              FORCED_COLORS_SURFACE_CLASS,
            )}
          >
            <Sparkles data-icon-kind="artwork" size={APP_ICON_SIZE} strokeWidth={2} />
          </span>
          <span className={cx('skill-catalog-card__copy', STACKED_COPY_CLASS)}>
            <span className="skill-catalog-card__title-line tw:flex tw:min-w-0 tw:items-center tw:gap-2">
              <strong className="tw:overflow-hidden tw:text-app-text tw:type-row-title tw:text-ellipsis tw:whitespace-nowrap">
                {skill.name}
              </strong>
              {skill.audit ? (
                <span
                  className={cx(
                    `is-${skill.audit.status}`,
                    AUDIT_BADGE_CLASS,
                    AUDIT_BADGE_TONE_CLASS[skill.audit.status],
                    FORCED_COLORS_SURFACE_CLASS,
                  )}
                  title={skill.audit.summary}
                >
                  {renderAuditIcon(skill.audit.status)}
                  {skill.audit.status}
                </span>
              ) : null}
            </span>
            <span className={cx('skill-catalog-card__meta', TRUNCATED_LINE_CLASS)}>
              {skill.source} · {skill.installs.toLocaleString()} 次安装
            </span>
          </span>
        </button>

        <div className="skill-catalog-card__actions tw:flex tw:items-center tw:justify-end">
          {skill.installed ? (
            <span className="skill-catalog-card__installed tw:flex tw:items-center tw:gap-2 tw:text-app-text-meta tw:type-caption tw:whitespace-nowrap">
              <Check aria-hidden="true" size="var(--inline-icon-size, 1em)" />
              已添加
            </span>
          ) : (
            <Button
              className="skill-catalog-card__action"
              color="secondary"
              loading={installing}
              onClick={() => onInstall(skill)}
              size="toolbar"
              title="添加到 Pidex"
            >
              <Plus aria-hidden="true" size={APP_ICON_SIZE} />
              添加
            </Button>
          )}
        </div>
      </article>
    </li>
  )
}

function renderAuditIcon(status: DesktopSkillAuditStatus): React.ReactNode {
  if (status === 'pass') {
    return (
      <ShieldCheck aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
    )
  }
  if (status === 'warn') {
    return (
      <ShieldAlert aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
    )
  }
  return <ShieldX aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
}
