import React, { useState } from 'react'
import { Server } from 'lucide-react'

import { RemoteImage } from '../../../components/ui/RemoteImage.js'
import { useProviderIconSource } from '../../../services/desktop-client/ProviderIconClient.js'

/**
 * Provider appearance overrides and catalogue/model logos share the local cache.
 * Unknown brands retain the generic provider glyph.
 */
export function ProviderLogo({ logoURL, providerID }: { logoURL?: string; providerID?: string }): React.ReactNode {
  const source = useProviderIconSource(logoURL, providerID)
  const override = useProviderIconSource(undefined, providerID)
  const [loadedSource, setLoadedSource] = useState<string>()
  const fallback = <Server aria-hidden="true" size={14} data-icon-kind="artwork" strokeWidth={2} />

  return (
    <span
      aria-hidden="true"
      className="composer-provider-logo tw:relative tw:inline-flex tw:size-4.5 tw:shrink-0 tw:items-center tw:justify-center tw:text-inherit tw:[&>svg]:block tw:[&>svg]:size-full"
    >
      {source ? (
        <RemoteImage
          alt=""
          className="composer-provider-logo-image"
          imageClassName={override ? 'tw:object-contain' : 'tw:invisible'}
          fallback={fallback}
          src={source}
          onLoad={() => setLoadedSource(source)}
        />
      ) : (
        fallback
      )}
      {source && !override && loadedSource === source ? (
        <span
          className="tw:pointer-events-none tw:absolute tw:inset-0 tw:bg-current tw:[mask-size:contain] tw:[mask-position:center] tw:[mask-repeat:no-repeat]"
          style={{ maskImage: `url(${JSON.stringify(source)})` }}
        />
      ) : null}
    </span>
  )
}
