import { useEffect, useState } from 'react'
import type { Attachment } from '@pidex/shared/thread'
import {
  BROWSER_ANNOTATION_MANIFEST_NAME,
  parseBrowserAnnotations,
  type BrowserAnnotation,
} from '@pidex/shared/browser-annotation'
import { desktopClient } from '../../../services/desktop-client/index.js'

export function useBrowserAnnotationManifest(attachments: readonly Attachment[]) {
  const manifest = attachments.find(
    (a) =>
      a.name === BROWSER_ANNOTATION_MANIFEST_NAME &&
      a.kind === 'text' &&
      a.mediaType === 'application/json',
  )
  const [state, setState] = useState<{ id: string; annotations: BrowserAnnotation[] } | null>(null)
  useEffect(() => {
    let cancelled = false
    setState(null)
    if (manifest)
      void desktopClient
        .readAttachment(manifest.id)
        .then((result) => {
          const annotations =
            result.encoding === 'utf8' ? parseBrowserAnnotations(result.data) : null
          if (!cancelled && annotations) setState({ id: manifest.id, annotations })
        })
        .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [manifest?.id])
  return state?.id === manifest?.id ? state : null
}
