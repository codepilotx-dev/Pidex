import { useEffect, useState } from 'react'
import type { BrowserAnnotation } from '@pidex/shared/browser-annotation'
import type { ComposerDraftKey } from '../session/composer/ComposerTypes.js'
import { composerDraftStore } from '../session/composer/ComposerDraftStore.js'
import { deleteBrowserAnnotation } from './BrowserAnnotationDraft.js'
import { Button } from '../../components/ui/Button.js'

export function BrowserAnnotationCard({
  annotation,
  source,
  onEdit,
  onDelete,
  editedBody,
  onDraftEdit,
}: {
  annotation: BrowserAnnotation
  source?: string
  onEdit?: (body: string) => void
  onDelete?: () => void
  editedBody?: string
  onDraftEdit?: (body: string | undefined) => void
}) {
  const [editing, setEditing] = useState(editedBody !== undefined),
    [body, setBody] = useState(editedBody ?? annotation.body)
  useEffect(() => {
    setBody(editedBody ?? annotation.body)
  }, [annotation.body, editedBody])
  return (
    <article className="browser-annotation-card tw:flex tw:gap-2 tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-panel tw:p-2 tw:type-body-sm tw:text-app-text">
      {source ? (
        <img
          className="tw:size-20 tw:shrink-0 tw:self-start tw:rounded-sm tw:object-contain"
          src={source}
          alt="批注截图"
        />
      ) : null}
      <div className="tw:min-w-0 tw:flex-1">
        <strong>
          {annotation.anchors.map((anchor) => anchor.name || anchor.tagName || '区域').join(' · ')}
        </strong>
        {editing && onEdit ? (
          <div>
            <textarea
              aria-label="编辑批注反馈"
              className="tw:my-1 tw:block tw:w-full tw:resize-y tw:rounded-sm tw:border tw:border-app-border-subtle tw:bg-app-raised tw:p-1 tw:text-inherit tw:type-body tw:focus-visible:shadow-[var(--cpx-sys-focus-ring-inset)] tw:focus-visible:outline-none"
              value={body}
              onChange={(event) => {
                setBody(event.target.value)
                onDraftEdit?.(event.target.value)
              }}
            />
            <Button
              color="primary"
              disabled={!body.trim()}
              onClick={() => {
                onEdit(body.trim())
                setEditing(false)
              }}
            >
              保存反馈
            </Button>
            <Button
              color="secondary"
              onClick={() => {
                setBody(annotation.body)
                onDraftEdit?.(undefined)
                setEditing(false)
              }}
            >
              取消
            </Button>
          </div>
        ) : (
          <p className="tw:my-1 tw:whitespace-pre-wrap tw:wrap-anywhere">{annotation.body}</p>
        )}
        <details>
          <summary className="tw:cursor-pointer tw:text-app-text-soft">定位和样式详情</summary>
          <pre className="tw:my-1 tw:whitespace-pre-wrap tw:wrap-anywhere">
            {JSON.stringify(annotation.anchors, null, 2)}
          </pre>
        </details>
        {onEdit && !editing ? (
          <Button
            color="secondary"
            onClick={() => {
              setEditing(true)
              onDraftEdit?.(annotation.body)
            }}
          >
            编辑反馈
          </Button>
        ) : null}
        {onDelete ? (
          <Button color="secondary" onClick={onDelete}>
            删除批注
          </Button>
        ) : null}
      </div>
    </article>
  )
}

export function BrowserAnnotationDraftCards({ draftKey }: { draftKey: ComposerDraftKey }) {
  const [, update] = useState(0)
  useEffect(() => composerDraftStore.subscribe(() => update((v) => v + 1)), [])
  const draft = composerDraftStore.get(draftKey)
  if (!draft.browserAnnotations?.length) return null
  return (
    <div
      className="browser-annotation-cards tw:flex tw:max-h-80 tw:flex-col tw:gap-2 tw:overflow-auto tw:p-2"
      aria-label="待发送的网页批注"
    >
      {draft.browserAnnotations.map((annotation) => (
        <BrowserAnnotationCard
          key={annotation.id}
          annotation={annotation}
          editedBody={draft.browserAnnotationFeedback?.[annotation.id]}
          onDraftEdit={(body) =>
            composerDraftStore.updateBrowserAnnotations(draftKey, (current) => {
              const feedback = { ...current.browserAnnotationFeedback }
              if (body === undefined) delete feedback[annotation.id]
              else feedback[annotation.id] = body
              return { ...current, browserAnnotationFeedback: feedback }
            })
          }
          source={
            draft.browserAnnotationImages?.find((image) => image.name === annotation.screenshotName)
              ?.previewDataUrl
          }
          onEdit={(body) =>
            composerDraftStore.updateBrowserAnnotations(draftKey, (draft) => ({
              ...draft,
              browserAnnotationFeedback: Object.fromEntries(
                Object.entries(draft.browserAnnotationFeedback ?? {}).filter(
                  ([id]) => id !== annotation.id,
                ),
              ),
              browserAnnotations: draft.browserAnnotations?.map((a) =>
                a.id === annotation.id ? { ...a, body } : a,
              ),
            }))
          }
          onDelete={() =>
            composerDraftStore.updateBrowserAnnotations(draftKey, (draft) =>
              deleteBrowserAnnotation(draft, annotation.id),
            )
          }
        />
      ))}
    </div>
  )
}
