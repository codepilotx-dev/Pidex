import type React from 'react'
import { useEffect, useRef } from 'react'
import { toastStore } from './toast/ToastState.js'

type Props = {
  message: string | null
  onDismiss: () => void
  tone?: 'error' | 'status'
}

export function GlobalErrorModal({ message, onDismiss, tone = 'error' }: Props): React.ReactNode {
  const onDismissRef = useRef(onDismiss)

  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])

  useEffect(() => {
    if (!message) return
    const id = toastStore.show({
      tone,
      message,
      dedupeKey: `${tone}:${message}`,
      onDismiss: () => {
        onDismissRef.current()
      },
    })
    return () => {
      toastStore.dismiss(id)
    }
  }, [message, tone])

  return null
}
