import type {
  BrowserAnnotation,
  BrowserAnnotationAnchor,
  BrowserAnnotationEditor,
  BrowserAnnotationMode,
} from '@pidex/shared/browser-annotation'
import { createBrowserAnnotationDomTools } from './BrowserAnnotationDom.js'

type RuntimeConfig = {
  mode: BrowserAnnotationMode
  annotations: BrowserAnnotation[]
  editor?: BrowserAnnotationEditor
  theme: Record<string, string>
  documentId: string
  tabId: string
}
type RuntimeMessage = { kind: string; [key: string]: unknown }

/** Runs only inside the named isolated execution context; no Electron object is exposed. */
function browserAnnotationRuntime(
  config: RuntimeConfig,
  tools: ReturnType<typeof createBrowserAnnotationDomTools>,
  emit: (message: RuntimeMessage) => void,
) {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
  const shadow = host.attachShadow({ mode: 'closed' })
  const layer = document.createElement('div')
  layer.setAttribute('popover', 'manual')
  layer.style.cssText =
    'position:fixed;inset:0;margin:0;border:0;padding:0;background:transparent;width:100vw;height:100vh;overflow:visible;pointer-events:none'
  shadow.append(layer)
  document.documentElement.append(host)
  layer.showPopover()
  const style = document.createElement('style')
  style.textContent = `
    *{box-sizing:border-box} .outline{position:fixed;border:2px solid var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);pointer-events:none;border-radius:4px}
    .marker{position:fixed;border:0;border-radius:50%;width:24px;height:24px;background:var(--accent);color:var(--accent-text);pointer-events:auto;cursor:pointer;font:600 12px var(--font)}
    .editor,.tip{position:fixed;color:var(--ink);background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px;font:13px var(--font);box-shadow:var(--shadow)}
    .tip{pointer-events:none;white-space:pre-line;max-width:300px}.editor{pointer-events:auto;width:min(340px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto}
    textarea{display:block;width:100%;min-height:80px;resize:vertical;margin:8px 0;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--control);color:var(--ink);font:inherit}
    button{font:inherit} .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.action{min-height:28px;padding:4px 12px;border:1px solid var(--border);border-radius:8px;background:var(--control);color:var(--ink);cursor:pointer}.primary{background:var(--accent);color:var(--accent-text)}
    .action:disabled{opacity:.5;cursor:default}.error{color:var(--error);margin:8px 0;white-space:pre-wrap} summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}label{display:flex;gap:8px;align-items:center}
  `
  shadow.append(style)
  const defaults: Record<string, string> = {
    accent: '#339cff',
    'accent-text': '#fff',
    ink: '#1a1c1f',
    surface: '#fff',
    border: '#8888',
    control: '#f5f5f5',
    font: 'Segoe UI, sans-serif',
    shadow: '0 8px 24px #0003',
    error: '#c22',
  }
  for (const [key, value] of Object.entries({ ...defaults, ...config.theme }))
    layer.style.setProperty(`--${key}`, value)
  let mode = config.mode,
    annotations = config.annotations,
    editor: BrowserAnnotationEditor | null = null
  let form: HTMLDivElement | null = null,
    capturing = false,
    saving = false,
    drag: { x: number; y: number } | null = null,
    stopped = false
  let updateFrame = 0
  let lastInvalid = ''
  const cleanupListeners: (() => void)[] = []
  const hover = document.createElement('div'),
    tip = document.createElement('div'),
    highlights = document.createElement('div'),
    markers = document.createElement('div')
  hover.className = 'outline'
  tip.className = 'tip'
  hover.hidden = tip.hidden = true
  layer.append(highlights, markers, hover, tip)
  const blocked = (event: Event) => event.composedPath().includes(host)
  const hitTarget = (x: number, y: number) => {
    layer.style.visibility = 'hidden'
    try {
      return tools.hit(document, x, y)
    } finally {
      layer.style.visibility = ''
    }
  }
  const consume = (event: Event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const notifyEditor = () =>
    emit({ kind: 'editor', editor: editor ? structuredClone(editor) : null })
  const place = (
    node: HTMLElement,
    rect: { x: number; y: number; width: number; height: number },
  ) => {
    const x = Math.max(8, Math.min(rect.x, innerWidth - node.offsetWidth - 8))
    const below = rect.y + rect.height + 8
    const y =
      below + node.offsetHeight < innerHeight ? below : Math.max(8, rect.y - node.offsetHeight - 8)
    node.style.left = `${x}px`
    node.style.top = `${Math.min(y, Math.max(8, innerHeight - node.offsetHeight - 8))}px`
  }
  function bounds(a: BrowserAnnotationAnchor) {
    if (a.kind === 'element') {
      const e = tools.resolve(a)
      return e && tools.rect(e)
    }
    if (a.kind === 'text') return tools.textRect(a)
    if (a.regionReferenceRect) {
      const e = tools.resolve(a),
        now = e && tools.rect(e),
        before = a.regionReferenceRect
      return now
        ? {
            x: now.x + a.rect.x - before.x,
            y: now.y + a.rect.y - before.y,
            width: a.rect.width,
            height: a.rect.height,
          }
        : null
    }
    const doc = tools.frameDocument(a.framePath),
      win = doc?.defaultView,
      info = win && tools.frameInfo(win)
    return win && info
      ? {
          ...a.rect,
          x: a.rect.x + info.x - (win.scrollX - a.scroll.x),
          y: a.rect.y + info.y - (win.scrollY - a.scroll.y),
        }
      : null
  }
  function outline(a: BrowserAnnotationAnchor) {
    const rect = bounds(a)
    if (!rect) return null
    const node = document.createElement('div')
    node.className = 'outline'
    Object.assign(node.style, {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
    return node
  }
  function draw() {
    updateFrame = 0
    highlights.replaceChildren()
    markers.replaceChildren()
    const invalid: string[] = []
    annotations.forEach((a, index) => {
      if (a.tabId !== config.tabId || a.documentId !== config.documentId) return
      const rect = bounds(a.anchors[0]!)
      const stale = !rect || a.anchors.some((anchor) => !bounds(anchor))
      if (stale) {
        invalid.push(a.id)
        if (!rect) return
      }
      const marker = document.createElement('button')
      marker.className = 'marker'
      marker.textContent = String(index + 1)
      marker.setAttribute('aria-label', `编辑批注 ${index + 1}`)
      if (stale) {
        marker.style.background = 'var(--error)'
        marker.title = '部分目标已失效，反馈仍可发送'
      }
      Object.assign(marker.style, {
        left: `${Math.max(0, rect.x)}px`,
        top: `${Math.max(0, rect.y - 12)}px`,
      })
      marker.onclick = () => {
        editorControls = openEditor({
          id: a.id,
          body: a.body,
          anchors: structuredClone(a.anchors),
          includeHtml: a.anchors.some((a) => a.html !== undefined),
        })
      }
      markers.append(marker)
      for (const anchor of a.anchors) {
        const node = outline(anchor)
        if (node) highlights.append(node)
      }
    })
    if (editor) {
      for (const anchor of editor.anchors) {
        const node = outline(anchor)
        if (node) highlights.append(node)
      }
      if (!annotations.some((a) => a.id === editor!.id)) {
        const rect = editor.anchors[0] && bounds(editor.anchors[0])
        if (rect) {
          const marker = document.createElement('span')
          marker.className = 'marker'
          marker.textContent = String(annotations.length + 1)
          Object.assign(marker.style, {
            left: `${Math.max(0, rect.x)}px`,
            top: `${Math.max(0, rect.y - 12)}px`,
            display: 'grid',
            placeItems: 'center',
          })
          markers.append(marker)
        }
      }
    }
    const signature = invalid.join('|')
    if (signature !== lastInvalid) {
      lastInvalid = signature
      emit({ kind: 'invalid', ids: invalid })
    }
    if (form && editor?.anchors[0]) place(form, bounds(editor.anchors[0]) ?? editor.anchors[0].rect)
  }
  function schedule() {
    if (!updateFrame && !stopped) updateFrame = requestAnimationFrame(draw)
  }
  function closeEditor() {
    editor = null
    config.editor = undefined
    form?.remove()
    form = null
    saving = false
    notifyEditor()
    draw()
  }
  function openEditor(next: BrowserAnnotationEditor) {
    form?.remove()
    editor = structuredClone(next)
    saving = false
    form = document.createElement('div')
    form.className = 'editor'
    form.setAttribute('role', 'dialog')
    form.setAttribute('aria-label', '网页批注')
    const title = document.createElement('strong')
    title.textContent = next.anchors.map((a) => a.name || a.tagName || '区域').join(' · ')
    const textarea = document.createElement('textarea')
    textarea.value = next.body
    textarea.placeholder = '填写反馈'
    textarea.setAttribute('aria-label', '批注反馈')
    const details = document.createElement('details'),
      summary = document.createElement('summary'),
      content = document.createElement('pre')
    summary.textContent = '元素详情'
    details.append(summary, content)
    const showDetails = () => {
      content.textContent = JSON.stringify(editor?.anchors, null, 2)
    }
    const label = document.createElement('label'),
      include = document.createElement('input')
    include.type = 'checkbox'
    include.checked = next.includeHtml
    label.append(include, document.createTextNode('包含精简 HTML（可选）'))
    include.onchange = () => {
      if (!editor) return
      editor.includeHtml = include.checked
      editor.anchors = editor.anchors.map((a) => {
        const result = { ...a }
        delete result.html
        const e = a.kind === 'element' && tools.resolve(a)
        if (include.checked && e) result.html = tools.html(e)
        return result
      })
      showDetails()
      notifyEditor()
    }
    const error = document.createElement('div')
    error.className = 'error'
    const actions = document.createElement('div')
    actions.className = 'actions'
    const button = (text: string, action: () => void, primary = false) => {
      const node = document.createElement('button')
      node.type = 'button'
      node.className = `action${primary ? ' primary' : ''}`
      node.textContent = text
      node.onclick = action
      actions.append(node)
      return node
    }
    const save = (textOnly: boolean) => {
      if (!editor?.body.trim() || saving) return
      if (editor.anchors.some((a) => !bounds(a))) {
        error.textContent = '目标已失效，请重新选择后保存'
        return
      }
      saving = true
      saveButton.disabled = true
      emit({ kind: 'save', editor: structuredClone(editor), textOnly })
    }
    const saveButton = button('保存批注', () => save(false), true)
    const textOnly = button('仅保存文字', () => save(true))
    textOnly.hidden = true
    button('取消', closeEditor)
    if (annotations.some((a) => a.id === next.id))
      button('删除', () => {
        emit({ kind: 'delete', id: next.id })
        closeEditor()
      })
    textarea.oninput = () => {
      if (editor) {
        editor.body = textarea.value
        saveButton.disabled = !editor.body.trim()
        notifyEditor()
      }
    }
    saveButton.disabled = !next.body.trim()
    form.append(title, textarea, details, label, error, actions)
    layer.append(form)
    showDetails()
    notifyEditor()
    draw()
    textarea.focus({ preventScroll: true })
    return { error, saveButton, textOnly }
  }
  let editorControls: ReturnType<typeof openEditor>
  function select(anchor: BrowserAnnotationAnchor, multi: boolean) {
    if (multi && editor) {
      const index = editor.anchors.findIndex((a) => a.runtimeId === anchor.runtimeId)
      const anchors =
        index >= 0 ? editor.anchors.filter((_, i) => i !== index) : [...editor.anchors, anchor]
      if (!anchors.length) {
        closeEditor()
        return
      }
      editorControls = openEditor({ ...editor, anchors })
    } else
      editorControls = openEditor({
        id: tools.uuid(),
        body: editor?.body ?? config.editor?.body ?? '',
        anchors: [anchor],
        includeHtml: false,
      })
  }
  const point = (win: Window, event: MouseEvent) => {
    const info = tools.frameInfo(win)
    return {
      x: event.clientX * (info?.scaleX ?? 1) + (info?.x ?? 0),
      y: event.clientY * (info?.scaleY ?? 1) + (info?.y ?? 0),
    }
  }
  function emptyAnchor(
    kind: 'region' | 'text',
    rect: BrowserAnnotationAnchor['rect'],
    selectedText = '',
  ): BrowserAnnotationAnchor {
    return {
      kind,
      pageUrl: location.href,
      pageTitle: document.title,
      framePath: [],
      frameUrl: location.href,
      runtimeId: tools.uuid(),
      name: kind === 'text' ? '选中文字' : '选中区域',
      tagName: '',
      text: selectedText.slice(0, 4000),
      nearbyText: '',
      rect,
      scroll: { x: scrollX, y: scrollY },
      scrollContainers: [],
      style: {},
      attributes: {},
    }
  }
  function bind(win: Window) {
    const onMove = (event: MouseEvent) => {
      if (mode === 'region' && drag && !capturing) {
        const p = point(win, event)
        hover.hidden = false
        tip.hidden = true
        Object.assign(hover.style, {
          left: `${Math.min(drag.x, p.x)}px`,
          top: `${Math.min(drag.y, p.y)}px`,
          width: `${Math.abs(drag.x - p.x)}px`,
          height: `${Math.abs(drag.y - p.y)}px`,
        })
        return
      }
      if (blocked(event) || capturing || mode !== 'element' || (editor && !event.shiftKey)) {
        hover.hidden = tip.hidden = true
        return
      }
      const p = point(win, event),
        e = hitTarget(p.x, p.y),
        rect = e && tools.rect(e)
      if (!rect) {
        hover.hidden = tip.hidden = true
        return
      }
      hover.hidden = tip.hidden = false
      Object.assign(hover.style, {
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      })
      const css = e!.ownerDocument.defaultView!.getComputedStyle(e!)
      tip.textContent = `${e!.localName} · ${Math.round(rect.width)}×${Math.round(rect.height)}\n${css.color} · ${css.fontSize} ${css.fontFamily}`
      place(tip, rect)
    }
    const onDown = (event: MouseEvent) => {
      if (blocked(event) || event.button !== 0 || capturing || saving) return
      if (mode === 'region') {
        consume(event)
        drag = point(win, event)
      } else if (mode === 'element') consume(event)
    }
    const onUp = (event: MouseEvent) => {
      if (blocked(event) || event.button !== 0 || capturing || saving) return
      const p = point(win, event)
      if (mode === 'region' && drag) {
        consume(event)
        const rect = {
          x: Math.min(drag.x, p.x),
          y: Math.min(drag.y, p.y),
          width: Math.abs(drag.x - p.x),
          height: Math.abs(drag.y - p.y),
        }
        drag = null
        if (rect.width >= 4 && rect.height >= 4) {
          const target = hitTarget(rect.x, rect.y),
            a = target && tools.anchor(target)
          if (a) {
            a.kind = 'region'
            a.regionReferenceRect = a.rect
            a.rect = rect
            select(a, false)
          } else select(emptyAnchor('region', rect), false)
        }
      } else if (mode === 'text') {
        const selection = win.getSelection()
        const container = selection?.anchorNode?.parentElement
        if (
          !selection ||
          selection.isCollapsed ||
          !container ||
          container.closest('input,textarea') ||
          !selection.rangeCount
        )
          return
        const a = tools.textAnchor(selection.getRangeAt(0))
        if (a) select(a, false)
      }
    }
    const onClick = (event: MouseEvent) => {
      if (blocked(event) || capturing || saving || mode === 'text') return
      consume(event)
      if (mode !== 'element') return
      const p = point(win, event),
        e = hitTarget(p.x, p.y),
        a = e && tools.anchor(e)
      if (a) select(a, event.shiftKey)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      consume(event)
      if (editor || drag) {
        drag = null
        closeEditor()
      } else {
        emit({ kind: 'stopped' })
        dispose()
      }
    }
    const events: [string, EventListener][] = [
      ['mousemove', onMove as EventListener],
      ['mousedown', onDown as EventListener],
      ['mouseup', onUp as EventListener],
      ['click', onClick as EventListener],
      ['keydown', onKey as EventListener],
      ['scroll', schedule],
      ['resize', schedule],
    ]
    for (const [name, handler] of events) win.addEventListener(name, handler, true)
    cleanupListeners.push(() => {
      for (const [name, handler] of events) win.removeEventListener(name, handler, true)
    })
  }
  const bound = new WeakSet<Window>()
  const bindFrames = () => {
    for (const win of tools.windows())
      if (!bound.has(win)) {
        bound.add(win)
        bind(win)
      }
  }
  bindFrames()
  const observer = new MutationObserver(() => {
    bindFrames()
    observeRoots()
    schedule()
  })
  const observed = new WeakSet<Node>()
  function observeRoots() {
    const visit = (root: Document | ShadowRoot) => {
      if (!observed.has(root)) {
        observed.add(root)
        observer.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        })
      }
      for (const e of Array.from(root.querySelectorAll('*'))) if (e.shadowRoot) visit(e.shadowRoot)
    }
    for (const win of tools.windows()) visit(win.document)
  }
  observeRoots()
  function dispose() {
    if (stopped) return
    stopped = true
    cleanupListeners.forEach((f) => f())
    observer.disconnect()
    cancelAnimationFrame(updateFrame)
    host.remove()
  }
  draw()
  return {
    dispose,
    sync(next: {
      mode: BrowserAnnotationMode
      annotations: BrowserAnnotation[]
      editor?: BrowserAnnotationEditor
    }) {
      if (
        editor &&
        annotations.some((a) => a.id === editor!.id) &&
        !next.annotations.some((a) => a.id === editor!.id)
      )
        closeEditor()
      mode = next.mode
      annotations = next.annotations
      if (next.editor) editorControls = openEditor(next.editor)
      draw()
    },
    async prepare() {
      capturing = true
      hover.hidden = tip.hidden = true
      if (form) form.hidden = true
      draw()
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      return true
    },
    restore() {
      capturing = false
      if (form) form.hidden = false
    },
    result(error?: string) {
      saving = false
      if (!error) {
        closeEditor()
        return
      }
      if (editorControls) {
        editorControls.error.textContent = error
        editorControls.saveButton.textContent = '重试截图'
        editorControls.saveButton.disabled = !editor?.body.trim()
        editorControls.textOnly.hidden = false
      }
    },
  }
}

export function buildBrowserAnnotationRuntime(config: RuntimeConfig, binding: string): string {
  return `globalThis.__cpxAnnotations?.dispose(); globalThis.__cpxAnnotations = (${browserAnnotationRuntime.toString()})(${JSON.stringify(config)}, (${createBrowserAnnotationDomTools.toString()})(), message => globalThis[${JSON.stringify(binding)}](JSON.stringify(message))); true`
}
