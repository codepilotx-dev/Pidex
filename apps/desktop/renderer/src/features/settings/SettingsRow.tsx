import React from 'react'
import { useLocale } from '../i18n/LocaleProvider.js'
import { cx } from '../../utils/Cx.js'

export type SettingsRowControlAria = {
  labelledby: string
  describedby: string | null
}

type SettingsRowControlRender = (aria: SettingsRowControlAria) => React.ReactNode

type Props = {
  title: string
  description?: React.ReactNode
  control?: React.ReactNode | SettingsRowControlRender
  autoSave?: boolean
  id?: string
  size?: 'default' | 'compact'
  variant?: 'default' | 'stacked' | 'nested'
}

export function SettingsRow({
  title,
  description,
  control,
  id,
  size = 'default',
  variant = 'default',
}: Props) {
  const { t } = useLocale()
  const controlIsRender = typeof control === 'function'
  const rowAriaId = React.useId()
  const titleId = controlIsRender ? `${rowAriaId}-label` : undefined
  const descriptionId =
    controlIsRender && description != null ? `${rowAriaId}-description` : undefined
  const resolvedControl = controlIsRender
    ? (control as SettingsRowControlRender)({
        labelledby: titleId ?? '',
        describedby: descriptionId ?? null,
      })
    : control
  return (
    <div
      className={cx(
        'settings-row tw:min-w-0 tw:bg-transparent',
        variant === 'stacked'
          ? 'tw:grid tw:gap-2 tw:py-3'
          : variant === 'nested'
            ? 'tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-4 tw:py-2'
            : cx(
                'tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-4',
                size === 'compact' ? 'tw:py-2' : 'tw:py-3',
              ),
      )}
      data-size={size}
      data-variant={variant}
      id={id}
    >
      <div className="settings-row-info tw:min-w-0">
        <h4 className="settings-row-title tw:m-0 tw:text-app-text tw:type-row-title" id={titleId}>
          {t(title)}
        </h4>
        {description ? (
          <p
            className="settings-row-desc tw:mt-1 tw:mr-0 tw:mb-0 tw:ml-0 tw:max-w-[68ch] tw:text-app-text-soft tw:type-body-sm"
            id={descriptionId}
          >
            {typeof description === 'string' ? t(description) : description}
          </p>
        ) : null}
      </div>
      {Boolean(resolvedControl) && (
        <div
          className={cx(
            'settings-row-control tw:relative tw:flex tw:min-w-0 tw:shrink-0 tw:items-center tw:gap-2',
            variant === 'stacked' ? 'tw:justify-start' : 'tw:justify-end',
          )}
        >
          {resolvedControl}
        </div>
      )}
    </div>
  )
}
