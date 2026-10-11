import {
  BROWSER_ANNOTATION_MANIFEST_NAME,
  serializeBrowserAnnotations,
  type BrowserAnnotation,
  type BrowserAnnotationEditor,
} from '@pidex/shared/browser-annotation'
import type { DesktopComposerAttachment } from '../../../shared/Types.js'
import type { ComposerDraft } from '../session/composer/ComposerTypes.js'

export function annotationAttachments(draft: ComposerDraft): DesktopComposerAttachment[] {
  const annotations = draft.browserAnnotations ?? []
  if (!annotations.length) return [...draft.attachments]
  const textContent = serializeBrowserAnnotations(annotations)
  return [
    ...draft.attachments,
    ...(draft.browserAnnotationImages ?? []),
    {
      id: `browser-annotations:${draft.clientId}`,
      name: BROWSER_ANNOTATION_MANIFEST_NAME,
      path: '',
      kind: 'text',
      mediaType: 'application/json',
      storage: 'managed',
      status: 'ready',
      sizeBytes: new TextEncoder().encode(textContent).byteLength,
      textContent,
    },
  ]
}

export function validateAnnotationCapacity(draft: ComposerDraft): void {
  const attachments = annotationAttachments(draft)
  if (attachments.length > 8)
    throw new Error('最多 8 个附件，批注清单占用 1 个名额；请移除附件后重试')
  if (
    attachments.filter((a) => a.storage !== 'local-path').reduce((sum, a) => sum + a.sizeBytes, 0) >
    25 * 1024 * 1024
  )
    throw new Error('托管附件合计超过 25 MiB，请移除附件后重试')
  const manifest = attachments.find((a) => a.id === `browser-annotations:${draft.clientId}`)
  if (manifest && manifest.sizeBytes > 1024 * 1024) throw new Error('批注清单超过文本附件上限')
}

export function saveBrowserAnnotation(
  draft: ComposerDraft,
  annotation: BrowserAnnotation,
  image?: { data: string; mimeType: 'image/png' },
): ComposerDraft {
  const previous = draft.browserAnnotations?.find((a) => a.id === annotation.id)
  const nextAnnotation = { ...annotation }
  let images = (draft.browserAnnotationImages ?? []).filter(
    (i) => i.name !== previous?.screenshotName,
  )
  if (image) {
    const sizeBytes =
      Math.floor((image.data.length * 3) / 4) -
      (image.data.endsWith('==') ? 2 : image.data.endsWith('=') ? 1 : 0)
    if (sizeBytes <= 0 || sizeBytes > 8 * 1024 * 1024) throw new Error('截图为空或超过 8 MB')
    const name = `browser-annotation-${annotation.id}-${crypto.randomUUID()}.png`
    nextAnnotation.screenshotName = name
    images = [
      ...images,
      {
        id: crypto.randomUUID(),
        name,
        path: '',
        mediaType: image.mimeType,
        kind: 'image',
        status: 'ready',
        storage: 'managed',
        sizeBytes,
        contentBase64: image.data,
        previewDataUrl: `data:image/png;base64,${image.data}`,
      },
    ]
  } else delete nextAnnotation.screenshotName
  const existing = draft.browserAnnotations ?? []
  const annotations = previous
    ? existing.map((a) => (a.id === annotation.id ? nextAnnotation : a))
    : [...existing, nextAnnotation]
  const editors = { ...draft.browserAnnotationEditors }
  delete editors[annotation.tabId]
  const feedback = { ...draft.browserAnnotationFeedback }
  delete feedback[annotation.id]
  const next = {
    ...draft,
    browserAnnotations: annotations,
    browserAnnotationImages: images,
    browserAnnotationEditors: editors,
    browserAnnotationFeedback: feedback,
  }
  validateAnnotationCapacity(next)
  return next
}

export function deleteBrowserAnnotation(draft: ComposerDraft, id: string): ComposerDraft {
  const removed = draft.browserAnnotations?.find((a) => a.id === id)
  const feedback = { ...draft.browserAnnotationFeedback }
  delete feedback[id]
  return {
    ...draft,
    browserAnnotations: draft.browserAnnotations?.filter((a) => a.id !== id),
    browserAnnotationImages: draft.browserAnnotationImages?.filter(
      (i) => i.name !== removed?.screenshotName,
    ),
    browserAnnotationFeedback: feedback,
  }
}

export function retainBrowserAnnotationEditor(
  draft: ComposerDraft,
  tabId: string,
  documentId: string,
  editor: BrowserAnnotationEditor | null,
): ComposerDraft {
  const editors = { ...draft.browserAnnotationEditors }
  if (editor) editors[tabId] = { documentId, editor }
  else delete editors[tabId]
  return { ...draft, browserAnnotationEditors: editors }
}
