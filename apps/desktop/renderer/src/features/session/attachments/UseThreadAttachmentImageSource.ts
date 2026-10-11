import type { Attachment } from '@pidex/shared/thread'
import { useEffect, useState } from 'react'
import { desktopClient } from '../../../services/desktop-client/index.js'

export type ThreadAttachmentImageState =
  { status: 'loading' } | { status: 'ready'; source: string } | { status: 'error'; message: string }

export function useThreadAttachmentImageSource(attachment: Attachment): ThreadAttachmentImageState {
  const [state, setState] = useState<ThreadAttachmentImageState>({
    status: 'loading',
  })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    void desktopClient.readAttachment(attachment.id).then(
      (result) => {
        if (cancelled) return
        if (result.attachment.kind !== 'image' || result.encoding !== 'base64') {
          setState({ status: 'error', message: '图片附件格式不受支持。' })
          return
        }

        setState({
          status: 'ready',
          source: `data:${result.attachment.mediaType};base64,${result.data}`,
        })
      },
      () => {
        if (cancelled) return
        setState({ status: 'error', message: '图片附件加载失败。' })
      },
    )

    return () => {
      cancelled = true
    }
  }, [attachment.id])

  return state
}
