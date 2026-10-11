import type { WebContents } from 'electron'
import type { BrowserCommand, BrowserResult } from '@pidex/agent-protocol'
import { getPlaywrightInjectedScriptSource } from './PlaywrightInjectedScriptSource.js'
type Frame = { frame: { id: string; url: string; parentId?: string }; childFrames?: Frame[] }
const worldName = 'pidex-browser'
const injectedName = '__cpxInjected'
export async function runBrowserOperation(
  contents: WebContents,
  command: BrowserCommand,
  documentId: () => string,
  signal: AbortSignal,
): Promise<BrowserResult> {
  const op = command.operation
  if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
  const send = async (
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<any> => {
    signal.throwIfAborted()
    return contents.debugger.sendCommand(method, params, sessionId)
  }
  await send('Page.enable')
  const assertOrigin = (url: string) => {
    if (url === 'about:blank' || url === 'about:srcdoc' || !url) return
    if (
      command.deniedOrigins?.includes(new URL(url).origin) ||
      (!command.allowAllSites && !command.allowedOrigins.includes(new URL(url).origin))
    )
      throw new Error(`站点需要授权：${new URL(url).origin}`)
  }
  if (op.action !== 'navigate') assertOrigin(contents.getURL())
  if (op.action === 'navigate') {
    if (!op.url) throw new Error('缺少网址')
    assertOrigin(op.url)
    await contents.loadURL(op.url)
    return { text: contents.getURL() }
  }
  if (op.action === 'back' || op.action === 'forward') {
    const offset = op.action === 'back' ? -1 : 1
    const entry = contents.navigationHistory.getEntryAtIndex(
      contents.navigationHistory.getActiveIndex() + offset,
    )
    if (entry) {
      assertOrigin(entry.url)
      contents.navigationHistory.goToOffset(offset)
    }
    return { text: '已提交导航' }
  }
  if (op.action === 'reload') {
    contents.reload()
    return { text: '已刷新' }
  }
  if (op.action === 'stop') {
    contents.stop()
    return { text: '已停止加载' }
  }
  if (op.action === 'dialog') {
    await send('Page.handleJavaScriptDialog', {
      accept: op.accept ?? false,
      promptText: op.text ?? '',
    })
    return { text: '已处理对话框' }
  }
  if (op.action === 'viewport') {
    if (
      !op.width ||
      !op.height ||
      op.width < 320 ||
      op.width > 3840 ||
      op.height < 200 ||
      op.height > 2160
    )
      throw new Error('视口尺寸无效')
    await send('Emulation.setDeviceMetricsOverride', {
      width: op.width,
      height: op.height,
      deviceScaleFactor: 1,
      mobile: false,
    })
    return { text: `视口 ${op.width}×${op.height}` }
  }
  if (op.action === 'screenshot') {
    const metrics = await send('Page.getLayoutMetrics')
    const viewport = metrics.cssLayoutViewport ?? metrics.layoutViewport
    const image = await contents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    const normalized =
      viewport?.clientWidth && viewport?.clientHeight
        ? image.resize({
            width: Math.round(viewport.clientWidth),
            height: Math.round(viewport.clientHeight),
          })
        : image
    const png = normalized.toPNG()
    if (image.isEmpty() || png.byteLength > 8 * 1024 * 1024) throw new Error('截图为空或超过 8 MB')
    return {
      text: '浏览器页面截图',
      image: { mimeType: 'image/png', data: png.toString('base64') },
    }
  }
  if (op.action === 'scroll' && !op.target) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: 10,
      y: 10,
      deltaX: op.x ?? 0,
      deltaY: op.y ?? 600,
    })
    return { text: '已滚动' }
  }
  const tree = (await send('Page.getFrameTree')).frameTree as Frame
  const frames: Frame[] = []
  const walk = (frame: Frame) => {
    frames.push(frame)
    frame.childFrames?.forEach(walk)
  }
  walk(tree)
  const targets = (await send('Target.getTargets')).targetInfos as Array<{
    targetId: string
    type: string
    url: string
    parentFrameId?: string
  }>
  // Chromium omits committed OOP frames from the parent's Page frame tree.
  // Only adopt targets whose parent is already in this guest's own tree.
  for (let previous = -1; previous !== frames.length;) {
    previous = frames.length
    for (const target of targets)
      if (
        target.type === 'iframe' &&
        target.parentFrameId &&
        frames.some((item) => item.frame.id === target.parentFrameId) &&
        !frames.some((item) => item.frame.id === target.targetId)
      )
        frames.push({
          frame: { id: target.targetId, url: target.url, parentId: target.parentFrameId },
        })
  }
  for (const item of frames) {
    const remote = targets.find(
      (target) => target.targetId === item.frame.id && target.type === 'iframe',
    )
    if (remote) item.frame.url = remote.url
  }
  let frame = frames.find((frame) => frame.frame.id === (op.target?.frameId ?? tree.frame.id))
  if (!frame) throw new Error('页面 frame 已失效，请重新读取快照')
  assertOrigin(frame.frame.url)
  let sessionId: string | undefined
  let contextId: number
  try {
    const target = targets.find(
      (target) => target.targetId === frame!.frame.id && target.type === 'iframe',
    )
    if (target) {
      assertOrigin(target.url)
      sessionId = (
        await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
      ).sessionId
      await send('Page.enable', {}, sessionId)
    }
    contextId = (
      await send(
        'Page.createIsolatedWorld',
        { frameId: frame.frame.id, worldName, grantUniveralAccess: false },
        sessionId,
      )
    ).executionContextId
    const evaluate = async (expression: string): Promise<any> => {
      const response = await send(
        'Runtime.evaluate',
        { expression, contextId, returnByValue: true, awaitPromise: true, timeout: 5000 },
        sessionId,
      )
      if (response.exceptionDetails) throw new Error('页面元素操作失败，请重新读取快照并检查定位')
      return response.result?.value
    }
    if (!(await evaluate(`Boolean(globalThis.${injectedName})`))) {
      await evaluate(
        `(() => { const module = {}; ${getPlaywrightInjectedScriptSource()}; globalThis.${injectedName} = new (module.exports.InjectedScript())(globalThis, { browserName: 'chromium', customEngines: [], isUnderTest: false, sdkLanguage: 'javascript', stableRafCount: 1, testIdAttributeName: 'data-testid' }); return true })()`,
      )
    }
    if (op.action === 'snapshot') {
      const snapshot = await evaluate(
        `globalThis.${injectedName}.incrementalAriaSnapshot(document.body || document.documentElement, { mode: 'ai' }).full`,
      )
      return {
        text: JSON.stringify({
          url: contents.getURL(),
          documentId: documentId(),
          frameId: frame.frame.id,
          frames: frames.map((f) => ({
            frameId: f.frame.id,
            url: f.frame.url,
            authorized:
              f.frame.url.startsWith('about:') ||
              Boolean(
                URL.canParse(f.frame.url) &&
                !command.deniedOrigins?.includes(new URL(f.frame.url).origin) &&
                (command.allowAllSites ||
                  command.allowedOrigins.includes(new URL(f.frame.url).origin)),
              ),
          })),
          snapshot: String(snapshot).slice(0, 100000),
        }),
      }
    }
    if (op.action === 'key' && !op.target?.selector && !op.target?.ref) {
      if (!op.key) throw new Error('缺少按键')
      const focusedFrames = await evaluate(
        `(() => { const urls = []; let doc = document; while (doc?.activeElement && /^(IFRAME|FRAME)$/.test(doc.activeElement.tagName)) { const el = doc.activeElement; urls.push(el.src); try { doc = el.contentDocument } catch { break } } return urls })()`,
      )
      for (const url of focusedFrames) assertOrigin(url)
      await pressKey(send, op.key)
      return { text: '已输入按键' }
    }
    if (op.target?.ref && op.target.documentId !== documentId())
      throw new Error('元素引用已过期，请重新读取页面快照')
    const selector = op.target?.ref ? `aria-ref=${op.target.ref}` : op.target?.selector
    if (!selector) throw new Error('缺少元素定位：target.selector 或 target.ref')
    const action = `const injected = globalThis.${injectedName}; const all = injected.querySelectorAll(injected.parseSelector(${JSON.stringify(selector)}), document.documentElement); const visible = all.filter(el => injected.elementState(el, 'visible').matches); const el = all.length === 1 ? all[0] : visible.length === 1 ? visible[0] : null; if (!el) throw new Error('定位不唯一或元素不存在');`
    if (op.action === 'key') {
      if (!op.key) throw new Error('缺少按键')
      await evaluate(`(() => { ${action} el.focus(); return true })()`)
      await pressKey(send, op.key)
    } else if (op.action === 'fill') {
      if (op.text === undefined) throw new Error('缺少输入文字')
      const result = await evaluate(
        `(() => { ${action} return injected.fill(el, ${JSON.stringify(op.text)}); })()`,
      )
      if (result === 'needsinput') await send('Input.insertText', { text: op.text })
      else if (result !== 'done') throw new Error('此元素不可输入')
    } else if (op.action === 'select') {
      if (op.text === undefined) throw new Error('缺少选项 value')
      const selected = await evaluate(
        `(() => { ${action} return injected.selectOptions(el, [{ value: ${JSON.stringify(op.text)} }]); })()`,
      )
      if (!Array.isArray(selected) || !selected.length) throw new Error('此元素没有匹配的选项')
    } else {
      const point = await evaluate(
        `(() => { ${action} el.scrollIntoView({block:'center', inline:'center'}); const r=el.getBoundingClientRect(); if (!r.width || !r.height || injected.elementState(el, 'disabled').matches) throw new Error('元素不可操作'); const x=r.left+r.width/2, y=r.top+r.height/2; const hit=document.elementFromPoint(x,y); if (hit && hit !== el && !el.contains(hit)) throw new Error('元素被遮挡'); return {x,y,checked: !!el.checked}; })()`,
      )
      // Translate same-process iframe CSS pixels to the top-level input surface.
      let current = frame
      while (current.frame.parentId) {
        const owner = await send('DOM.getFrameOwner', { frameId: current.frame.id })
        const box = (await send('DOM.getBoxModel', { backendNodeId: owner.backendNodeId })).model
          .content as number[]
        point.x += box[0]
        point.y += box[1]
        const parent = frames.find((f) => f.frame.id === current.frame.parentId)
        if (!parent) break
        current = parent
      }
      if (op.action === 'scroll')
        await send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: point.x,
          y: point.y,
          deltaX: op.x ?? 0,
          deltaY: op.y ?? 600,
        })
      else {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
        if (
          op.action !== 'hover' &&
          !(op.action === 'check' && point.checked === (op.checked ?? true))
        ) {
          try {
            await send('Input.dispatchMouseEvent', {
              type: 'mousePressed',
              x: point.x,
              y: point.y,
              button: 'left',
              clickCount: 1,
            })
          } finally {
            if (!contents.isDestroyed() && contents.debugger.isAttached())
              await contents.debugger
                .sendCommand('Input.dispatchMouseEvent', {
                  type: 'mouseReleased',
                  x: point.x,
                  y: point.y,
                  button: 'left',
                  clickCount: 1,
                })
                .catch(() => {})
          }
        }
      }
    }
    signal.throwIfAborted()
    return { text: '已完成页面操作' }
  } finally {
    if (sessionId && contents.debugger.isAttached())
      await contents.debugger.sendCommand('Target.detachFromTarget', { sessionId }).catch(() => {})
  }
}

// Key mappings adapted from ZCode browserCommandInput.ts (Apache-2.0).
async function pressKey(
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  chord: string,
) {
  const aliases: Record<string, string> = {
    ctrl: 'Control',
    control: 'Control',
    shift: 'Shift',
    alt: 'Alt',
    cmd: 'Meta',
    meta: 'Meta',
    esc: 'Escape',
    enter: 'Enter',
    tab: 'Tab',
    space: ' ',
  }
  const parts = chord.split('+').map((key) => aliases[key.toLowerCase()] ?? key)
  const key = parts.pop()!
  const bits: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }
  const modifiers = parts.reduce((mask, key) => mask | (bits[key] ?? 0), 0)
  const codes: Record<string, number> = {
    Enter: 13,
    Tab: 9,
    Escape: 27,
    Backspace: 8,
    Delete: 46,
    ArrowUp: 38,
    ArrowDown: 40,
    ArrowLeft: 37,
    ArrowRight: 39,
    ' ': 32,
  }
  const windowsVirtualKeyCode =
    codes[key] ?? (/^[a-z\d]$/i.test(key) ? key.toUpperCase().charCodeAt(0) : undefined)
  const code = /^[a-z]$/i.test(key)
    ? `Key${key.toUpperCase()}`
    : /^[\d]$/.test(key)
      ? `Digit${key}`
      : key === ' '
        ? 'Space'
        : key
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    modifiers,
    ...(windowsVirtualKeyCode ? { windowsVirtualKeyCode } : {}),
    ...(!modifiers && key.length === 1 ? { text: key } : key === 'Enter' ? { text: '\r' } : {}),
  })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers })
}
