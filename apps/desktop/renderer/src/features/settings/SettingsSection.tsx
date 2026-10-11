import React from 'react'
import { useLocale } from '../i18n/LocaleProvider.js'

type Props = {
  title?: string
  description?: React.ReactNode
  actions?: React.ReactNode
  bare?: boolean
  children: React.ReactNode
}

type HeaderProps = {
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
}

type SlotProps = {
  children: React.ReactNode
}

type ContentProps = SlotProps & {
  surface?: 'plain' | 'card' | 'flat'
}

export function SettingsSectionHeader({
  title,
  description,
  actions,
  children,
}: HeaderProps): React.ReactNode {
  const { t } = useLocale()
  if (!title && !description && !actions && !children) return null
  return (
    <header className="settings-section-header tw:mb-3 tw:flex tw:min-w-0 tw:items-start tw:justify-between tw:gap-4 tw:@max-[42rem]:flex-col tw:@max-[42rem]:items-stretch">
      <div className="settings-section-header-copy tw:min-w-0 tw:flex-1">
        {title ? (
          <h3 className="settings-section-title tw:m-0 tw:text-app-text tw:type-title-sm">
            {typeof title === 'string' ? t(title) : title}
          </h3>
        ) : null}
        {description ? (
          <p className="settings-section-desc tw:mt-1 tw:mr-0 tw:mb-0 tw:ml-0 tw:max-w-[68ch] tw:text-app-text-soft tw:type-body-sm">
            {typeof description === 'string' ? t(description) : description}
          </p>
        ) : null}
        {children}
      </div>
      {actions ? (
        <div className="settings-section-header-actions tw:flex tw:shrink-0 tw:flex-wrap tw:items-center tw:justify-end tw:gap-3 tw:@max-[42rem]:justify-start">
          {actions}
        </div>
      ) : null}
    </header>
  )
}

export function SettingsSectionContent({
  children,
  surface = 'card',
}: ContentProps): React.ReactNode {
  return (
    <div
      className={
        surface === 'card'
          ? 'settings-section-content settings-card tw:min-w-0 tw:overflow-hidden tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-panel tw:shadow-none'
          : surface === 'flat'
            ? 'settings-section-content settings-flat tw:min-w-0 tw:border-y tw:border-app-border-subtle tw:bg-transparent'
            : 'settings-section-content tw:min-w-0'
      }
      data-surface={surface}
    >
      {children}
    </div>
  )
}

export function SettingsSectionFooter({ children }: SlotProps): React.ReactNode {
  return (
    <footer className="settings-section-footer tw:mt-3 tw:px-1 tw:text-app-text-meta tw:type-caption">
      {children}
    </footer>
  )
}

function SettingsSectionRoot({
  title,
  description,
  actions,
  bare,
  children,
}: Props): React.ReactNode {
  const hasHeader = Boolean(title || description || actions)
  const usesSlots = React.Children.toArray(children).some((child) => {
    if (!React.isValidElement(child)) return false
    return (
      child.type === SettingsSectionHeader ||
      child.type === SettingsSectionContent ||
      child.type === SettingsSectionFooter
    )
  })

  return (
    <section className="settings-section tw:min-w-0 tw:[&+&]:mt-8">
      {hasHeader ? (
        <SettingsSectionHeader actions={actions} description={description} title={title} />
      ) : null}
      {usesSlots || bare ? children : <SettingsSectionContent>{children}</SettingsSectionContent>}
    </section>
  )
}

type SettingsSectionComponent = typeof SettingsSectionRoot & {
  Header: typeof SettingsSectionHeader
  Content: typeof SettingsSectionContent
  Footer: typeof SettingsSectionFooter
}

export const SettingsSection = Object.assign(SettingsSectionRoot, {
  Header: SettingsSectionHeader,
  Content: SettingsSectionContent,
  Footer: SettingsSectionFooter,
}) as SettingsSectionComponent
