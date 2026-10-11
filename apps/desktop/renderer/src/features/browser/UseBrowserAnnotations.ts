import { useEffect, useRef, useState } from 'react'
import type { BrowserAnnotationMode } from '@pidex/shared/browser-annotation'
import type {
  DesktopBrowserAnnotationEvent,
  DesktopBrowserAnnotationInput,
  DesktopBrowserAnnotationOperation,
} from '@pidex/shared/desktop-browser-ipc'
import type { DesktopBrowserClient } from '../../services/desktop-client/BrowserClientService.js'
import type { DesktopBrowserState } from '../../../shared/Types.js'
import type { ComposerDraftKey } from '../session/composer/ComposerTypes.js'
import { composerDraftStore } from '../session/composer/ComposerDraftStore.js'
import {
  deleteBrowserAnnotation,
  retainBrowserAnnotationEditor,
  saveBrowserAnnotation,
} from './BrowserAnnotationDraft.js'

type Interaction = Omit<DesktopBrowserAnnotationInput, 'operation'> & {
  draftKey: ComposerDraftKey
  clientId: string
  mode: BrowserAnnotationMode
  stopped: boolean
  saving: boolean
  editorVersion: number
  cleanup?: () => void
}

export function useBrowserAnnotations(
  client: DesktopBrowserClient,
  state: DesktopBrowserState,
  draftKey: ComposerDraftKey,
) {
  const [active, setActive] = useState(false),
    [mode, setMode] = useState<BrowserAnnotationMode>('element'),
    [error, setError] = useState('')
  const [invalid, setInvalid] = useState<string[]>([])
  const current = useRef<Interaction | null>(null)
  const modeRef = useRef(mode)
  modeRef.current = mode
  const request = (s: Interaction, operation: DesktopBrowserAnnotationOperation) =>
    client.annotation({
      tabId: s.tabId,
      generation: s.generation,
      documentId: s.documentId,
      interactionId: s.interactionId,
      operation,
    })
  const stop = () => {
    const s = current.current
    current.current = null
    setActive(false)
    if (s) {
      s.stopped = true
      s.cleanup?.()
      if (s.interactionId) void request(s, { action: 'stop' }).catch(() => {})
    }
  }
  useEffect(() => {
    return stop
  }, [client, draftKey, state.tabId, state.generation, state.documentId])
  useEffect(
    () =>
      composerDraftStore.subscribe(() => {
        const s = current.current
        if (s && composerDraftStore.get(s.draftKey).clientId !== s.clientId) {
          stop()
          return
        }
        if (s && s.interactionId && !s.saving)
          void request(s, {
            action: 'sync',
            mode: s.mode,
            annotations: composerDraftStore.get(s.draftKey).browserAnnotations ?? [],
          }).catch(() => {})
      }),
    [client],
  )

  async function start() {
    if (!state.generation || !state.documentId || !state.features?.annotations) return
    stop()
    setError('')
    setInvalid([])
    const s: Interaction = {
      tabId: state.tabId,
      generation: state.generation,
      documentId: state.documentId,
      draftKey,
      clientId: composerDraftStore.get(draftKey).clientId,
      mode: modeRef.current,
      stopped: false,
      saving: false,
      editorVersion: 0,
    }
    current.current = s
    const queued: DesktopBrowserAnnotationEvent[] = []
    const receive = (event: DesktopBrowserAnnotationEvent) => {
      if (
        current.current !== s ||
        s.stopped ||
        event.generation !== s.generation ||
        event.documentId !== s.documentId
      )
        return
      if (!s.interactionId) {
        queued.push(event)
        return
      }
      if (event.interactionId !== s.interactionId) return
      if (event.kind === 'stopped') {
        stop()
        return
      }
      if (event.kind === 'invalid') {
        setInvalid(event.ids)
        return
      }
      if (event.kind === 'editor') {
        s.editorVersion++
        composerDraftStore.updateBrowserAnnotations(s.draftKey, (draft) =>
          retainBrowserAnnotationEditor(draft, s.tabId, s.documentId, event.editor),
        )
      } else if (event.kind === 'delete') {
        composerDraftStore.updateBrowserAnnotations(s.draftKey, (draft) =>
          deleteBrowserAnnotation(draft, event.id),
        )
      } else if (event.kind === 'save' && !s.saving) {
        s.saving = true
        const editorVersion = s.editorVersion
        void (async () => {
          try {
            const image = event.textOnly
              ? undefined
              : (await request(s, { action: 'capture' })).image
            if (!event.textOnly && !image) throw new Error('截图失败，请重试或仅保存文字')
            if (current.current !== s || s.stopped) return
            if (s.editorVersion !== editorVersion) {
              await request(s, { action: 'result', error: '选择或反馈已变化，请重新保存' })
              return
            }
            composerDraftStore.updateBrowserAnnotations(s.draftKey, (draft) =>
              saveBrowserAnnotation(
                draft,
                {
                  id: event.editor.id,
                  tabId: s.tabId,
                  documentId: s.documentId,
                  body: event.editor.body.trim(),
                  anchors: event.editor.anchors,
                },
                image,
              ),
            )
            await request(s, {
              action: 'sync',
              mode: s.mode,
              annotations: composerDraftStore.get(s.draftKey).browserAnnotations ?? [],
            })
            await request(s, { action: 'result' })
          } catch (cause) {
            if (current.current === s && !s.stopped)
              await request(s, {
                action: 'result',
                error: cause instanceof Error ? cause.message : '批注保存失败',
              }).catch(() => {})
          } finally {
            s.saving = false
          }
        })()
      }
    }
    const unsubscribe = client.onAnnotationEvent(receive)
    s.cleanup = unsubscribe
    // The listener belongs to this interaction, including a delayed start response.
    const originalStop = () => {
      unsubscribe()
      s.stopped = true
    }
    const draft = composerDraftStore.get(draftKey)
    try {
      const result = await request(s, {
        action: 'start',
        mode: s.mode,
        annotations: draft.browserAnnotations ?? [],
        editor: draft.browserAnnotationEditors?.[s.tabId]?.editor,
        theme: annotationTheme(),
      })
      s.interactionId = result.interactionId
      if (current.current !== s || s.stopped) {
        if (s.interactionId) await request(s, { action: 'stop' }).catch(() => {})
        originalStop()
        return
      }
      setActive(true)
      for (const event of queued) receive(event)
    } catch (cause) {
      originalStop()
      if (current.current === s) {
        current.current = null
        setError(cause instanceof Error ? cause.message : '无法开启批注')
      }
    }
  }
  function changeMode(next: BrowserAnnotationMode) {
    setMode(next)
    const s = current.current
    if (s) {
      s.mode = next
      if (s.interactionId)
        void request(s, {
          action: 'sync',
          mode: next,
          annotations: composerDraftStore.get(s.draftKey).browserAnnotations ?? [],
        }).catch(() => {})
    }
  }
  return {
    active,
    mode,
    error,
    invalid,
    changeMode,
    toggle: () => (active ? stop() : void start()),
  }
}

function annotationTheme(): Record<string, string> {
  const css = getComputedStyle(document.documentElement)
  const token = (name: string) => css.getPropertyValue(`--cpx-sys-${name}`).trim()
  return Object.fromEntries(
    Object.entries({
      accent: token('color-accent'),
      'accent-text': token('color-fg-inverse'),
      ink: token('color-fg-primary'),
      surface: token('color-surface-panel'),
      border: token('color-border-subtle'),
      control: token('color-surface-raised'),
      font: css.fontFamily,
      shadow: token('shadow-floating'),
      error: token('color-danger'),
    }).filter(([, value]) => value),
  )
}
