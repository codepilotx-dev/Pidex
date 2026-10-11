import type {
  BrowserAnnotationAnchor,
  BrowserAnnotationRect,
} from '@pidex/shared/browser-annotation'

/** Self-contained DOM helpers serialized into the annotation isolated world. */
export function createBrowserAnnotationDomTools() {
  // randomUUID is secure-context-only; HTTP pages still support getRandomValues.
  const uuid = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6]! & 15) | 64
    bytes[8] = (bytes[8]! & 63) | 128
    const hex = Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  const elements = new Map<string, Element>()
  const ids = new WeakMap<Element, string>()
  const ranges = new Map<string, Range>()
  const controls = 'input,textarea,script,style,noscript,template'
  const trim = (s: string | null | undefined, max = 4000) =>
    (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
  const isElement = (v: unknown): v is Element => Boolean(v && (v as Node).nodeType === 1)
  const parent = (e: Element): Element | null =>
    e.parentElement ?? (e.getRootNode() as ShadowRoot).host ?? null
  function text(e: Element): string {
    if (e.matches(controls)) return ''
    const walker = e.ownerDocument.createTreeWalker(e, 4)
    let result = '',
      node: Node | null
    while ((node = walker.nextNode()) && result.length < 4000) {
      if (!node.parentElement?.closest(controls)) result += ` ${node.textContent ?? ''}`
    }
    return trim(result)
  }
  function name(e: Element): string {
    const labels = e
      .getAttribute('aria-labelledby')
      ?.split(/\s+/)
      .map((id) => {
        const label = e.ownerDocument.getElementById(id)
        return label ? text(label) : ''
      })
      .join(' ')
    return trim(
      labels ||
        e.getAttribute('aria-label') ||
        e.getAttribute('alt') ||
        e.getAttribute('title') ||
        e.getAttribute('placeholder') ||
        text(e),
      4000,
    )
  }
  function selector(e: Element): string | undefined {
    const root = e.getRootNode() as Document | ShadowRoot
    const parts: string[] = []
    let current: Element | null = e
    while (current) {
      let part = current.localName
      if (current.id) part += `#${CSS.escape(current.id)}`
      else {
        const testId = current.getAttribute('data-testid')
        if (testId) part += `[data-testid="${CSS.escape(testId)}"]`
        else
          part += Array.from(current.classList)
            .slice(0, 2)
            .map((c) => `.${CSS.escape(c)}`)
            .join('')
        const siblings = Array.from(current.parentElement?.children ?? []).filter(
          (s) => s.localName === current!.localName,
        )
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`
      }
      parts.unshift(part)
      const candidate = parts.join(' > ')
      if (root.querySelectorAll(candidate).length === 1 && root.querySelector(candidate) === e) {
        if (root.nodeType === 9) return candidate
        const host = (root as ShadowRoot).host
        if (host.shadowRoot !== root) return undefined
        const outer = selector(host)
        return outer ? `${outer} >>> ${candidate}` : undefined
      }
      current = current.parentElement
    }
    return undefined
  }
  function query(root: Document | ShadowRoot, path: string): Element | null {
    const parts = path.split(' >>> ')
    let currentRoot = root
    let result: Element | null = null
    for (let i = 0; i < parts.length; i++) {
      const matches = currentRoot.querySelectorAll(parts[i]!)
      if (matches.length !== 1) return null
      result = matches[0]!
      if (i < parts.length - 1) {
        if (!result.shadowRoot) return null
        currentRoot = result.shadowRoot
      }
    }
    return result
  }
  function frameInfo(
    win: Window,
  ): { path: string[]; x: number; y: number; scaleX: number; scaleY: number } | null {
    const path: string[] = []
    let x = 0,
      y = 0,
      scaleX = 1,
      scaleY = 1,
      current = win
    while (current !== window) {
      const frame = current.frameElement
      if (!isElement(frame)) return null
      const s = selector(frame)
      if (!s) return null
      path.unshift(s)
      const rect = frame.getBoundingClientRect()
      const sx = rect.width / ((frame as HTMLElement).offsetWidth || rect.width),
        sy = rect.height / ((frame as HTMLElement).offsetHeight || rect.height)
      x = rect.left + (frame.clientLeft + x) * sx
      y = rect.top + (frame.clientTop + y) * sy
      scaleX *= sx
      scaleY *= sy
      current = frame.ownerDocument.defaultView!
    }
    return { path, x, y, scaleX, scaleY }
  }
  function frameDocument(path: string[]): Document | null {
    let doc = document
    for (const s of path) {
      try {
        const frame = query(doc, s) as HTMLIFrameElement | null
        if (!frame?.contentDocument) return null
        doc = frame.contentDocument
      } catch {
        return null
      }
    }
    return doc
  }
  function hit(doc: Document, x: number, y: number): Element | null {
    let e = doc.elementFromPoint(x, y)
    while (e?.shadowRoot) {
      const next = e.shadowRoot.elementFromPoint(x, y)
      if (!next || next === e) break
      e = next
    }
    if (e?.localName === 'iframe') {
      try {
        const child = (e as HTMLIFrameElement).contentDocument
        if (child) {
          const rect = e.getBoundingClientRect()
          const sx = rect.width / ((e as HTMLElement).offsetWidth || rect.width),
            sy = rect.height / ((e as HTMLElement).offsetHeight || rect.height)
          return (
            hit(child, (x - rect.left) / sx - e.clientLeft, (y - rect.top) / sy - e.clientTop) ?? e
          )
        }
      } catch {
        /* Cross-origin frames remain selectable as outer elements. */
      }
    }
    if (!e) return null
    let fallback = e
    const ancestors: Element[] = []
    for (let candidate: Element | null = e; candidate; candidate = parent(candidate)) {
      ancestors.push(candidate)
      if (candidate.matches('a,button,img,iframe,[role]')) return candidate
      if (candidate.localName === 'body') break
    }
    for (const candidate of ancestors) {
      const rect = candidate.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) continue
      if (
        candidate.matches('a,button,input,textarea,select,label,img,iframe,[role]') ||
        (text(candidate) && rect.width >= 24 && rect.height >= 16)
      )
        return candidate
      if (rect.width >= 48 && rect.height >= 24) fallback = candidate
      if (candidate.localName === 'body') break
    }
    return fallback
  }
  function rect(e: Element): BrowserAnnotationRect | null {
    if (!e.isConnected) return null
    const bounds = e.getBoundingClientRect(),
      info = frameInfo(e.ownerDocument.defaultView!)
    if (!info || bounds.width <= 0 || bounds.height <= 0) return null
    return {
      x: bounds.x * info.scaleX + info.x,
      y: bounds.y * info.scaleY + info.y,
      width: bounds.width * info.scaleX,
      height: bounds.height * info.scaleY,
    }
  }
  function html(e: Element): string {
    const clone = e.cloneNode(true) as Element
    const nodes = [clone, ...Array.from(clone.querySelectorAll('*'))]
    for (const node of nodes) {
      if (node.matches('script,style,noscript,template')) {
        node.remove()
        continue
      }
      for (const attribute of Array.from(node.attributes)) {
        if (
          attribute.name.startsWith('on') ||
          attribute.name === 'value' ||
          attribute.name === 'srcdoc' ||
          attribute.name.startsWith('data-')
        )
          node.removeAttribute(attribute.name)
      }
      if (node.matches('textarea')) node.textContent = ''
      if (node.matches('input')) node.removeAttribute('checked')
      if (node.matches('option')) node.removeAttribute('selected')
    }
    return clone.matches('script,style,noscript,template') ? '' : trim(clone.outerHTML, 6000)
  }
  function anchor(e: Element, includeHtml = false): BrowserAnnotationAnchor | null {
    const bounds = rect(e),
      win = e.ownerDocument.defaultView!,
      info = frameInfo(win)
    if (!bounds || !info) return null
    let runtimeId = ids.get(e)
    if (!runtimeId) {
      runtimeId = uuid()
      ids.set(e, runtimeId)
      elements.set(runtimeId, e)
    }
    const computed = win.getComputedStyle(e),
      attributes: Record<string, string> = {}
    const xpathParts: string[] = []
    for (let p: Element | null = e; p; p = p.parentElement) {
      const siblings = Array.from(p.parentElement?.children ?? []).filter(
        (s) => s.localName === p!.localName,
      )
      xpathParts.unshift(`${p.localName}[${Math.max(1, siblings.indexOf(p) + 1)}]`)
    }
    for (const a of Array.from(e.attributes)) {
      if (
        ['id', 'class', 'href', 'src', 'alt', 'title', 'name', 'type', 'placeholder'].includes(
          a.name,
        ) ||
        a.name.startsWith('aria-')
      )
        attributes[a.name] = trim(a.value, 500)
    }
    const style = Object.fromEntries(
      ['color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight', 'display'].map((key) => [
        key,
        String(computed[key as keyof CSSStyleDeclaration]),
      ]),
    )
    const scrollContainers: BrowserAnnotationAnchor['scrollContainers'] = []
    for (let p = parent(e); p; p = parent(p)) {
      if (p.scrollHeight > p.clientHeight || p.scrollWidth > p.clientWidth) {
        const s = selector(p)
        if (s) scrollContainers.push({ selector: s, x: p.scrollLeft, y: p.scrollTop })
      }
    }
    return {
      kind: 'element',
      pageUrl: location.href,
      pageTitle: document.title,
      framePath: info.path,
      frameUrl: win.location.href,
      runtimeId,
      xpath: `/${xpathParts.join('/')}`,
      ...(selector(e) ? { selector: selector(e) } : {}),
      name: name(e),
      tagName: e.localName,
      role:
        e.getAttribute('role') ||
        ({ button: 'button', a: 'link', img: 'img', input: 'textbox' } as Record<string, string>)[
          e.localName
        ],
      text: text(e),
      nearbyText: text(e.closest('article,section,main,form,li,tr,dialog') ?? parent(e) ?? e),
      rect: bounds,
      scroll: { x: win.scrollX, y: win.scrollY },
      scrollContainers,
      style,
      attributes,
      ...(includeHtml ? { html: html(e) } : {}),
    }
  }
  function resolve(a: BrowserAnnotationAnchor): Element | null {
    const cached = elements.get(a.runtimeId)
    const doc = frameDocument(a.framePath)
    if (cached?.isConnected && cached.ownerDocument === doc) return cached
    if (!a.selector || a.pageUrl !== location.href) return null
    try {
      const e = doc && query(doc, a.selector)
      // Do not attach an old marker to a replacement that merely shares its selector.
      if (
        !e ||
        doc?.defaultView?.location.href !== a.frameUrl ||
        e.localName !== a.tagName ||
        name(e) !== a.name ||
        text(e) !== a.text ||
        text(e.closest('article,section,main,form,li,tr,dialog') ?? parent(e) ?? e) !== a.nearbyText
      )
        return null
      elements.set(a.runtimeId, e)
      return e
    } catch {
      return null
    }
  }
  function windows(): Window[] {
    const result: Window[] = []
    const visit = (win: Window) => {
      result.push(win)
      const frames: HTMLIFrameElement[] = []
      const scan = (root: Document | ShadowRoot) => {
        for (const element of Array.from(root.querySelectorAll('*'))) {
          if (element.localName === 'iframe') frames.push(element as HTMLIFrameElement)
          if (element.shadowRoot) scan(element.shadowRoot)
        }
      }
      scan(win.document)
      for (const frame of frames) {
        try {
          if (frame.contentDocument && frame.contentWindow) visit(frame.contentWindow)
        } catch {
          /* Same-origin only. */
        }
      }
    }
    visit(window)
    return result
  }
  function endpoint(node: Node, offset: number) {
    const e = isElement(node) ? node : node.parentElement
    if (!e) return null
    const s = selector(e)
    if (!s) return null
    const nodePath: number[] = []
    for (let p = node; p !== e; p = p.parentNode!) {
      if (!p.parentNode) return null
      nodePath.unshift(Array.from(p.parentNode.childNodes).indexOf(p as ChildNode))
    }
    return { selector: s, nodePath, offset }
  }
  function textAnchor(range: Range): BrowserAnnotationAnchor | null {
    const container = isElement(range.commonAncestorContainer)
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement
    if (!container || container.closest(controls)) return null
    if (Array.from(container.querySelectorAll(controls)).some((e) => range.intersectsNode(e)))
      return null
    const a = anchor(container),
      start = endpoint(range.startContainer, range.startOffset),
      end = endpoint(range.endContainer, range.endOffset)
    const b = range.getBoundingClientRect()
    if (!a || !start || !end || !b.width || !b.height) return null
    const info = frameInfo(container.ownerDocument.defaultView!)!
    a.kind = 'text'
    a.name = '选中文字'
    a.runtimeId = uuid()
    a.text = trim(range.toString())
    a.textRange = { start, end }
    a.rect = {
      x: b.x * info.scaleX + info.x,
      y: b.y * info.scaleY + info.y,
      width: b.width * info.scaleX,
      height: b.height * info.scaleY,
    }
    ranges.set(a.runtimeId, range.cloneRange())
    return a
  }
  function textRect(a: BrowserAnnotationAnchor): BrowserAnnotationRect | null {
    const doc = frameDocument(a.framePath)
    if (!doc || !a.textRange || doc.defaultView?.location.href !== a.frameUrl) return null
    try {
      let range = ranges.get(a.runtimeId)
      if (!range?.startContainer.isConnected || range.startContainer.ownerDocument !== doc) {
        const nodeAt = (p: NonNullable<BrowserAnnotationAnchor['textRange']>['start']) => {
          let node: Node | null = query(doc, p.selector)
          for (const index of p.nodePath) node = node?.childNodes[index] ?? null
          return node
        }
        const start = nodeAt(a.textRange.start),
          end = nodeAt(a.textRange.end)
        if (!start || !end) return null
        range = doc.createRange()
        range.setStart(start, a.textRange.start.offset)
        range.setEnd(end, a.textRange.end.offset)
        ranges.set(a.runtimeId, range)
      }
      if (trim(range.toString()) !== a.text) return null
      const b = range.getBoundingClientRect(),
        info = frameInfo(doc.defaultView!)
      return b.width && b.height && info
        ? {
            x: b.x * info.scaleX + info.x,
            y: b.y * info.scaleY + info.y,
            width: b.width * info.scaleX,
            height: b.height * info.scaleY,
          }
        : null
    } catch {
      return null
    }
  }
  return {
    uuid,
    hit,
    rect,
    anchor,
    resolve,
    html,
    text,
    frameInfo,
    windows,
    frameDocument,
    textAnchor,
    textRect,
  }
}
