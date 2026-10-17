import type React from 'react'
import type { DesktopPermissionRequest } from '../../../../shared/Types.js'
import { cx } from '../../../utils/Cx.js'

type GuardianReview = NonNullable<DesktopPermissionRequest['guardian']>

const STATUS_LABEL: Record<GuardianReview['status'], string> = {
  completed: '审查完成',
  cached: '低风险放行',
  unavailable: '审查不可用',
  timeout: '审查超时',
  circuit_open: '本轮已中断',
}

const RISK_LABEL: Record<GuardianReview['risk'], string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  critical: '灾难级风险',
}

const AUTH_LABEL: Record<GuardianReview['userAuthorization'], string> = {
  unknown: '授权未知',
  low: '授权弱',
  medium: '授权中',
  high: '授权明确',
}

const CONFIDENCE_LABEL: Record<GuardianReview['confidence'], string> = {
  low: '置信低',
  medium: '置信中',
  high: '置信高',
}

const SOURCE_LABEL: Record<GuardianReview['source'], string> = {
  model: 'Guardian 模型',
  cache: '异步评分',
  fallback: '回退',
}

const CATEGORY_LABEL: Record<string, string> = {
  destructive: '破坏性',
  irreversible_change: '不可逆',
  system_modification: '系统修改',
  security_control: '安全控制',
  credential_access: '凭据访问',
  credential_exfiltration: '凭据外发',
  privilege_escalation: '提权',
  persistence: '持久化',
  resource_exhaustion: '资源耗尽',
  network_access: '网络访问',
  scope_escape: '越权',
  prompt_injection: '提示注入',
  obfuscation: '混淆',
  unknown_infrastructure: '未知基础设施',
}

function tone(value: GuardianReview['risk']): string {
  if (value === 'critical') return 'tw:text-app-danger'
  if (value === 'high') return 'tw:text-app-warning'
  if (value === 'medium') return 'tw:text-app-text'
  return 'tw:text-app-text-soft'
}

export function GuardianReviewSummary({
  review,
  fallbackReason,
}: {
  review: GuardianReview
  fallbackReason?: string
}): React.ReactNode {
  const categories = review.categories
    .slice(0, 4)
    .map((category) => CATEGORY_LABEL[category] ?? category)
  return (
    <div className="inline-approval-guardian tw:grid tw:gap-2 tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-editor tw:p-3">
      <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2">
        <span className="tw:text-app-text tw:type-label">Guardian 自动审查</span>
        <span className="tw:rounded-full tw:bg-app-hover tw:px-2 tw:py-0.5 tw:text-app-text-soft tw:type-caption">
          {STATUS_LABEL[review.status]}
        </span>
        <span className={cx('tw:text-app-text-soft tw:type-caption', tone(review.risk))}>
          {RISK_LABEL[review.risk]}
        </span>
        <span className="tw:text-app-text-meta tw:type-caption">
          {AUTH_LABEL[review.userAuthorization]}
        </span>
        <span className="tw:text-app-text-meta tw:type-caption">
          {CONFIDENCE_LABEL[review.confidence]}
        </span>
        <span className="tw:text-app-text-meta tw:type-caption">{SOURCE_LABEL[review.source]}</span>
        {review.scoreLag !== undefined ? (
          <span className="tw:text-app-text-meta tw:type-caption">评分滞后 {review.scoreLag}</span>
        ) : null}
      </div>
      <p className="tw:m-0 tw:text-app-text-soft tw:type-body-sm tw:wrap-anywhere">
        {review.rationale}
      </p>
      {categories.length > 0 ? (
        <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:gap-1">
          {categories.map((category) => (
            <span
              key={category}
              className="tw:rounded-full tw:bg-app-hover tw:px-2 tw:py-0.5 tw:text-app-text-meta tw:type-caption"
            >
              {category}
            </span>
          ))}
        </div>
      ) : null}
      {review.fallbackReason || fallbackReason ? (
        <p className="tw:m-0 tw:text-app-text-meta tw:type-caption tw:wrap-anywhere">
          已回退人工审批：{review.fallbackReason ?? fallbackReason}
        </p>
      ) : null}
    </div>
  )
}
