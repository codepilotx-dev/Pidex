import React, { useState } from 'react'
import { Server } from 'lucide-react'

import { RemoteImage } from '../../../components/ui/RemoteImage.js'
import { useProviderIconSource } from '../../../services/desktop-client/ProviderIconClient.js'

/**
 * Provider logos always come from the catalogue `logoURL`, resolved through the
 * shared local icon cache so the composer and the provider settings surface show
 * the same brand mark without re-fetching it. Providers with no catalogue logo
 * fall back to the shared generic provider glyph, never to a locally bundled
 * brand mark.
 */
export function ProviderLogo({ logoURL }: { logoURL?: string }): React.ReactNode {
  const source = useProviderIconSource(logoURL)
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
          imageClassName="tw:invisible"
          fallback={fallback}
          src={source}
          onLoad={() => setLoadedSource(source)}
        />
      ) : (
        fallback
      )}
      {source && loadedSource === source ? (
        <span
          className="tw:pointer-events-none tw:absolute tw:inset-0 tw:bg-current tw:[mask-size:contain] tw:[mask-position:center] tw:[mask-repeat:no-repeat]"
          style={{ maskImage: `url(${JSON.stringify(source)})` }}
        />
      ) : null}
    </span>
  )
}
