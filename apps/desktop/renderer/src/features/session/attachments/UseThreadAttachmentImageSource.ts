import type { Attachment } from '@pidex/shared/thread'
import { useEffect, useState, type RefObject } from 'react'
import { desktopClient } from '../../../services/desktop-client/index.js'

export type ThreadAttachmentImageState =
  | { status: 'loading' }
  | { status: 'ready'; source: string }
  | { status: 'error'; message: string }

type AttachmentImageReadResult =
  | { kind: 'ready'; source: string }
  | { kind: 'error'; message: string }

const pendingReads = new Map<string, Promise<AttachmentImageReadResult>>()

export function readAttachmentImage(attachmentId: string): Promise<AttachmentImageReadResult> {
  const existing = pendingReads.get(attachmentId)
  if (existing) return existing

  const promise = (async () => {
    try {
      const result = await desktopClient.readAttachment(attachmentId)
      if (result.attachment.kind !== 'image' || result.encoding !== 'base64') {
        return { kind: 'error' as const, message: '图片附件格式不受支持。' }
      }
      return {
        kind: 'ready' as const,
        source: `data:${result.attachment.mediaType};base64,${result.data}`,
      }
    } catch {
      return { kind: 'error' as const, message: '图片附件加载失败。' }
    } finally {
      pendingReads.delete(attachmentId)
    }
  })()

  pendingReads.set(attachmentId, promise)
  return promise
}

export function findScrollContainer(element: Element | null): Element | null {
  if (!element) return null
  const declared = element.closest<HTMLElement>(
    '[data-component="thread-scroll-layout"], .thread-scroll-layout, [data-scroll-container]',
  )
  if (declared) return declared

  let current = element.parentElement
  while (current && current !== document.body && current !== document.documentElement) {
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      const style = window.getComputedStyle(current)
      const overflowY = style.overflowY
      const overflowX = style.overflowX
      if (
        overflowY === 'auto' ||
        overflowY === 'scroll' ||
        overflowX === 'auto' ||
        overflowX === 'scroll'
      ) {
        return current
      }
    }
    current = current.parentElement
  }
  return null
}

export function useThreadAttachmentImageSource(
  attachment: Attachment,
  targetRef?: RefObject<Element | null>,
): ThreadAttachmentImageState {
  const [state, setState] = useState<ThreadAttachmentImageState>({
    status: 'loading',
  })

  useEffect(() => {
    let mounted = true
    setState({ status: 'loading' })

    const startRead = () => {
      void readAttachmentImage(attachment.id).then((result) => {
        if (!mounted) return
        if (result.kind === 'ready') {
          setState({ status: 'ready', source: result.source })
        } else {
          setState({ status: 'error', message: result.message })
        }
      })
    }

    if (typeof IntersectionObserver === 'undefined' || !targetRef) {
      startRead()
      return () => {
        mounted = false
      }
    }

    const element = targetRef.current
    if (!element) {
      startRead()
      return () => {
        mounted = false
      }
    }

    const root = findScrollContainer(element)
    const observer = new IntersectionObserver(
      (entries) => {
        const isIntersecting = entries.some((entry) => entry.isIntersecting)
        if (!isIntersecting) return
        observer.disconnect()
        if (mounted) {
          startRead()
        }
      },
      {
        root,
        rootMargin: '200px',
      },
    )

    observer.observe(element)

    return () => {
      mounted = false
      observer.disconnect()
    }
  }, [attachment.id, targetRef])

  return state
}

export function _getPendingAttachmentReadsCount(): number {
  return pendingReads.size
}
