import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { isRecord } from '@pidex/shared/guards'
import {
  isBrowserAnnotation,
  isBrowserAnnotationAnchor,
  type BrowserAnnotationEditor,
} from '@pidex/shared/browser-annotation'
import type {
  DesktopBrowserAnnotationInput,
  DesktopBrowserAnnotationEvent,
  DesktopBrowserAnnotationResult,
} from '@pidex/shared/desktop-browser-ipc'
import { buildBrowserAnnotationRuntime } from './BrowserAnnotationRuntime.js'

export function isAnnotationEditor(value: unknown): value is BrowserAnnotationEditor {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.body === 'string' &&
    typeof value.includeHtml === 'boolean' &&
    Array.isArray(value.anchors) &&
    value.anchors.every(isBrowserAnnotationAnchor)
  )
}
export function requireBrowserAnnotation(value: unknown): DesktopBrowserAnnotationInput {
  if (
    !isRecord(value) ||
    !['tabId', 'generation', 'documentId'].every(
      (k) =>
        typeof value[k] === 'string' &&
        String(value[k]).length > 0 &&
        String(value[k]).length <= 200,
    ) ||
    (value.interactionId !== undefined && typeof value.interactionId !== 'string') ||
    !isRecord(value.operation)
  )
    throw new Error('批注请求无效')
  if (Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024) throw new Error('批注内容过大')
  const op = value.operation
  if (!['start', 'stop', 'sync', 'capture', 'result'].includes(String(op.action)))
    throw new Error('批注动作无效')
  if (op.action === 'start' || op.action === 'sync') {
    if (
      !['element', 'text', 'region'].includes(String(op.mode)) ||
      !Array.isArray(op.annotations) ||
      !op.annotations.every(isBrowserAnnotation) ||
      (op.editor !== undefined && !isAnnotationEditor(op.editor))
    )
      throw new Error('批注状态无效')
  }
  if (
    op.action === 'start' &&
    (!isRecord(op.theme) ||
      Object.entries(op.theme).some(
        ([k, v]) =>
          ![
            'accent',
            'accent-text',
            'ink',
            'surface',
            'border',
            'control',
            'font',
            'shadow',
            'error',
          ].includes(k) ||
          typeof v !== 'string' ||
          v.length > 300,
      ))
  )
    throw new Error('批注主题无效')
  if (op.action === 'result' && op.error !== undefined && typeof op.error !== 'string')
    throw new Error('批注结果无效')
  return value as unknown as DesktopBrowserAnnotationInput
}

type Identity = { tabId: string; generation: string; documentId: string }
type Session = Identity & {
  interactionId: string
  contents: WebContents
  contextId: number
  binding: string
  current: () => boolean
  publish: (event: DesktopBrowserAnnotationEvent) => void
  listener: (...args: any[]) => void
  capturing: boolean
}

export class BrowserAnnotations {
  private readonly sessions = new Map<number, Session>()
  private readonly starts = new Map<number, string>()
  active(contents: WebContents | undefined): boolean {
    return !!contents && this.sessions.has(contents.id)
  }
  async perform(
    contents: WebContents,
    identity: Identity,
    input: DesktopBrowserAnnotationInput,
    current: () => boolean,
    publish: Session['publish'],
  ): Promise<DesktopBrowserAnnotationResult> {
    const op = input.operation
    if (op.action === 'start') {
      this.stop(contents)
      if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
      const interactionId = randomUUID(),
        binding = `cpxAnnotation_${interactionId.replaceAll('-', '')}`
      this.starts.set(contents.id, interactionId)
      await contents.debugger.sendCommand('Page.enable')
      await contents.debugger.sendCommand('Runtime.enable')
      const tree = await contents.debugger.sendCommand('Page.getFrameTree')
      const world = await contents.debugger.sendCommand('Page.createIsolatedWorld', {
        frameId: tree.frameTree.frame.id,
        worldName: `pidex-annotations-${interactionId}`,
        grantUniveralAccess: false,
      })
      if (!current() || this.starts.get(contents.id) !== interactionId)
        throw new Error('网页已变化，请重新选择')
      const s: Session = {
        ...identity,
        interactionId,
        contents,
        contextId: world.executionContextId,
        binding,
        current,
        publish,
        listener: () => {},
        capturing: false,
      }
      s.listener = (_event, method, params) => {
        if (
          method === 'Runtime.executionContextDestroyed' &&
          params.executionContextId === s.contextId
        ) {
          if (this.sessions.get(contents.id) === s) this.stop(contents)
          return
        }
        if (
          method !== 'Runtime.bindingCalled' ||
          params.executionContextId !== s.contextId ||
          params.name !== s.binding ||
          !this.isCurrent(s)
        )
          return
        const event = this.decode(params.payload)
        if (!event) return
        publish({ ...identity, interactionId, ...event } as DesktopBrowserAnnotationEvent)
        if (event.kind === 'stopped') this.stop(contents, false)
      }
      this.sessions.set(contents.id, s)
      contents.debugger.on('message', s.listener)
      try {
        await contents.debugger.sendCommand('Runtime.addBinding', {
          name: binding,
          executionContextId: s.contextId,
        })
        await this.evaluate(s, buildBrowserAnnotationRuntime({ ...op, ...identity }, binding))
        if (!this.isCurrent(s)) throw new Error('网页已变化，请重新选择')
      } catch (error) {
        if (this.sessions.get(contents.id) === s) this.stop(contents)
        throw error
      }
      return { interactionId, documentId: identity.documentId }
    }
    const s = this.sessions.get(contents.id)
    if (
      !s ||
      !this.isCurrent(s) ||
      s.interactionId !== input.interactionId ||
      s.documentId !== input.documentId ||
      s.generation !== input.generation
    )
      throw new Error('批注交互已失效，请重新开启')
    if (op.action === 'stop') {
      this.stop(contents)
      return {}
    }
    if (op.action === 'sync')
      await this.evaluate(s, `globalThis.__cpxAnnotations.sync(${JSON.stringify(op)})`)
    if (op.action === 'result')
      await this.evaluate(
        s,
        `globalThis.__cpxAnnotations.result(${JSON.stringify(op.error) ?? 'undefined'})`,
      )
    if (op.action !== 'capture') return {}
    if (s.capturing) throw new Error('批注截图处理中')
    s.capturing = true
    try {
      await this.evaluate(s, 'globalThis.__cpxAnnotations.prepare()')
      if (!this.isCurrent(s)) throw new Error('网页已变化，请重新选择')
      const image = await contents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      if (!this.isCurrent(s)) throw new Error('网页已变化，请重新选择')
      const png = image.toPNG()
      if (image.isEmpty() || png.byteLength > 8 * 1024 * 1024)
        throw new Error('截图为空或超过 8 MB')
      return { image: { data: png.toString('base64'), mimeType: 'image/png' } }
    } finally {
      s.capturing = false
      if (this.isCurrent(s))
        await this.evaluate(s, 'globalThis.__cpxAnnotations.restore()').catch(() => {})
    }
  }
  stop(contents: WebContents | undefined, notify = true) {
    if (!contents) return
    this.starts.delete(contents.id)
    const s = this.sessions.get(contents.id)
    if (!s) return
    this.sessions.delete(contents.id)
    contents.debugger.removeListener('message', s.listener)
    if (notify)
      s.publish({
        tabId: s.tabId,
        generation: s.generation,
        documentId: s.documentId,
        interactionId: s.interactionId,
        kind: 'stopped',
      })
    if (!contents.isDestroyed() && contents.debugger.isAttached()) {
      void this.evaluate(s, 'globalThis.__cpxAnnotations?.dispose()').catch(() => {})
      void contents.debugger
        .sendCommand('Runtime.removeBinding', { name: s.binding })
        .catch(() => {})
    }
  }
  private isCurrent(s: Session) {
    return this.sessions.get(s.contents.id) === s && !s.contents.isDestroyed() && s.current()
  }
  private async evaluate(s: Session, expression: string) {
    const result = await s.contents.debugger.sendCommand('Runtime.evaluate', {
      expression,
      contextId: s.contextId,
      awaitPromise: true,
      returnByValue: true,
      timeout: 5000,
    })
    if (result.exceptionDetails) throw new Error('网页批注操作失败')
    return result.result?.value
  }
  private decode(payload: unknown): Record<string, unknown> | null {
    if (typeof payload !== 'string' || Buffer.byteLength(payload) > 1024 * 1024) return null
    try {
      const v: unknown = JSON.parse(payload)
      if (!isRecord(v)) return null
      switch (v.kind) {
        case 'stopped':
          return { kind: 'stopped' }
        case 'editor':
          return v.editor === null || isAnnotationEditor(v.editor)
            ? { kind: 'editor', editor: v.editor }
            : null
        case 'save':
          return isAnnotationEditor(v.editor) &&
            v.editor.anchors.length > 0 &&
            v.editor.body.trim() &&
            typeof v.textOnly === 'boolean'
            ? { kind: 'save', editor: v.editor, textOnly: v.textOnly }
            : null
        case 'delete':
          return typeof v.id === 'string' ? { kind: 'delete', id: v.id } : null
        case 'invalid':
          return Array.isArray(v.ids) && v.ids.every((i) => typeof i === 'string')
            ? { kind: 'invalid', ids: v.ids }
            : null
        default:
          return null
      }
    } catch {
      return null
    }
  }
}
