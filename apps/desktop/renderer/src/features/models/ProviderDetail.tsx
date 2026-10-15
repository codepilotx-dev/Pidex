import { Server } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef } from 'react'
import type { ModelProviderID } from '../../../shared/Types.js'
import type { ModelCenterProviderSection } from './ModelCenterState.js'
import { ProviderIcon } from './ProviderIcon.js'
import { WorkspaceHeaderItem } from '../layout/workspace-header/index.js'

export type ProviderDetailStatusTone = 'positive' | 'warning' | 'danger' | 'neutral'

export type ProviderDetailIdentity = {
  id: ModelProviderID
  name: string
  logoURL?: string
  description?: string
  status: {
    label: string
    tone: ProviderDetailStatusTone
  }
}

export type ProviderDetailProps = {
  provider: ProviderDetailIdentity
  section?: ModelCenterProviderSection
  actions?: React.ReactNode
  feedback?: React.ReactNode
  children: React.ReactNode
}

export function ProviderDetail({
  provider,
  section,
  actions,
  feedback,
  children,
}: ProviderDetailProps): React.ReactNode {
  const detailRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!section) return
    const frame = requestAnimationFrame(() => {
      const target =
        section === 'connection'
          ? detailRef.current
          : detailRef.current?.querySelector('[data-provider-section="models"]')
      target?.scrollIntoView({ block: 'start' })
    })
    return () => cancelAnimationFrame(frame)
  }, [provider.id, section])

  return (
    <section
      ref={detailRef}
      className="model-center-provider-detail tw:grid tw:min-w-0 tw:gap-3"
      aria-label={`${provider.name} 详情`}
    >
      <WorkspaceHeaderItem id="provider-detail" slot="left">
        <div className="model-center-provider-detail-header tw:flex tw:min-w-0 tw:items-center tw:gap-2">
          <div className="model-center-provider-identity tw:flex tw:min-w-0 tw:items-center tw:gap-2">
            <span className="model-center-provider-identity-logo tw:inline-flex tw:size-6 tw:flex-none tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-md tw:text-app-text">
                <ProviderIcon
                  foreground
                  className="tw:size-full"
                  imageClassName="tw:object-contain"
                  fallback={
                    <Server aria-hidden size={14} data-icon-kind="artwork" strokeWidth={2} />
                  }
                  logoURL={provider.logoURL}
                  providerID={provider.id}
                />
            </span>
            <div className="model-center-provider-identity-copy tw:grid tw:min-w-0 tw:gap-1">
              <h2 className="tw:m-0 tw:min-w-0 tw:overflow-hidden tw:text-app-text tw:type-row-title tw:text-ellipsis tw:whitespace-nowrap">
                {provider.name}
              </h2>
            </div>
          </div>
        </div>
      </WorkspaceHeaderItem>
      <WorkspaceHeaderItem id="provider-actions" slot="right">
        <div className="model-center-provider-context-actions tw:flex tw:min-w-0 tw:shrink-0 tw:items-center tw:gap-2 tw:group-data-[right-dock-open]:pr-0 tw:pr-2">
          {actions}
        </div>
      </WorkspaceHeaderItem>

      {feedback ? (
        <div
          className="model-center-provider-feedback tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-4 tw:py-3 tw:text-app-text-soft tw:type-body-sm"
          role="status"
        >
          {feedback}
        </div>
      ) : null}

      <div className="model-center-provider-panel tw:grid tw:min-w-0 tw:gap-6">{children}</div>
    </section>
  )
}
