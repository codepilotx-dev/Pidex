import type React from 'react'

type Props = {
  title: string
  description: string
  icon: React.ReactNode
  metadata?: React.ReactNode
  actions?: React.ReactNode
  dimmed?: boolean
  onActivate?: (trigger: HTMLElement) => void
}

export function ExtensionManagementRow({
  title,
  description,
  icon,
  metadata,
  actions,
  dimmed = false,
  onActivate,
}: Props): React.ReactNode {
  const rowContent = (
    <>
      <span aria-hidden="true" className="settings-management-row-icon">
        {icon}
      </span>
      <span className="settings-management-row-copy">
        <strong className="settings-management-row-title">{title}</strong>
        <span className="settings-management-row-description">{description}</span>
      </span>
      {metadata ? <span className="settings-management-row-meta">{metadata}</span> : null}
    </>
  )

  return (
    <article
      className="extensions-settings-row settings-management-row"
      data-dimmed={dimmed || undefined}
    >
      {onActivate ? (
        <button
          className="settings-management-row-main"
          onClick={(event) => onActivate(event.currentTarget)}
          type="button"
        >
          {rowContent}
        </button>
      ) : (
        <div className="settings-management-row-main">{rowContent}</div>
      )}
      {actions ? <span className="settings-management-row-actions">{actions}</span> : null}
    </article>
  )
}
