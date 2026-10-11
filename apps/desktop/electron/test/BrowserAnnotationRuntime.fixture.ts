import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium, type Browser, type Page } from 'playwright-core'
import { createBrowserAnnotationDomTools } from '../src/browser/BrowserAnnotationDom.js'
import { buildBrowserAnnotationRuntime } from '../src/browser/BrowserAnnotationRuntime.js'

let browser: Browser, page: Page
before(
  async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    page = await browser.newPage()
  },
  { timeout: 30000 },
)
after(async () => {
  await browser?.close()
})
const setup = async () => {
  await page.setContent(
    '<main><button id="first"><span>确定</span></button><button id="second">取消</button><p id="text">请选择这段文字。</p><div id="shadow"></div><iframe id="frame" srcdoc="<button id=inner>内部按钮</button>"></iframe><form id="form"><input value="ROOT_SECRET" oninput="bad()"><textarea>TEXT_SECRET</textarea><script>CODE_SECRET</script></form></main>',
  )
  await page.evaluate(() => {
    const root = document.querySelector('#shadow')!.attachShadow({ mode: 'open' })
    root.innerHTML = '<button id="nested">Shadow 按钮</button>'
    ;(globalThis as any).tools = null
  })
  await page.evaluate(`globalThis.tools = (${createBrowserAnnotationDomTools.toString()})();`)
}

test('点击重新命中按钮、开放 Shadow DOM 与同源 iframe，失效定位不挂到替换元素', async () => {
  await setup()
  const result = await page.evaluate(async () => {
    const t = (globalThis as any).tools
    const at = (e: Element) => {
      const b = t.rect(e)
      return t.hit(document, b.x + b.width / 2, b.y + b.height / 2)
    }
    const first = document.querySelector('#first')!,
      second = document.querySelector('#second')!
    const hover = at(first),
      click = at(second)
    const shadow = document.querySelector('#shadow')!.shadowRoot!.querySelector('button')!
    const inner = document
      .querySelector<HTMLIFrameElement>('#frame')!
      .contentDocument!.querySelector('button')!
    const cross = document.createElement('iframe')
    cross.id = 'cross'
    cross.src = 'data:text/html,<button>cross</button>'
    await new Promise<void>((resolve) => {
      cross.onload = () => resolve()
      document.querySelector('main')!.append(cross)
    })
    const anchor = t.anchor(first)
    first.remove()
    const replacement = document.createElement('button')
    replacement.id = 'first'
    replacement.textContent = '不同的按钮'
    document.querySelector('main')!.prepend(replacement)
    return {
      hover: hover.id,
      click: click.id,
      shadow: at(shadow).id,
      iframe: at(inner).id,
      cross: at(cross).id,
      path: t.anchor(inner).framePath,
      selector: t.anchor(shadow).selector,
      stale: t.resolve(anchor),
      sanitizedRoot: t.html(document.querySelector('input')),
      sanitizedTree: t.html(document.querySelector('#form')),
    }
  })
  assert.equal(result.hover, 'first')
  assert.equal(result.click, 'second')
  assert.equal(result.shadow, 'nested')
  assert.equal(result.iframe, 'inner')
  assert.equal(result.cross, 'cross')
  assert.equal(result.path.length, 1)
  assert.ok(result.selector.includes(' >>> '))
  assert.equal(result.stale, null)
  for (const html of [result.sanitizedRoot, result.sanitizedTree]) {
    assert.ok(!html.includes('SECRET'))
    assert.ok(!html.includes('oninput'))
    assert.ok(!html.includes('<script'))
  }
})

test('文本 Range 跟随布局变化，排除表单值；隔离 runtime 可完成多选、区域与 Esc', async () => {
  await setup()
  const text = await page.evaluate(() => {
    const t = (globalThis as any).tools,
      range = document.createRange(),
      node = document.querySelector('#text')!.firstChild!
    range.setStart(node, 1)
    range.setEnd(node, 5)
    const a = t.textAnchor(range),
      before = t.textRect(a)
    document.querySelector<HTMLElement>('#text')!.style.marginTop = '100px'
    const after = t.textRect(a)
    const invalid = document.createRange()
    invalid.selectNodeContents(document.querySelector('#form')!)
    return { text: a.text, moved: after.y > before.y, blocked: t.textAnchor(invalid) }
  })
  assert.deepEqual(text, { text: '选择这段', moved: true, blocked: null })
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    const tree = await cdp.send('Page.getFrameTree')
    const world = await cdp.send('Page.createIsolatedWorld', {
      frameId: tree.frameTree.frame.id,
      worldName: 'annotation-test',
    })
    const evalWorld = async (expression: string) => {
      const r = await cdp.send('Runtime.evaluate', {
        expression,
        contextId: world.executionContextId,
        awaitPromise: true,
        returnByValue: true,
      })
      if (r.exceptionDetails)
        throw new Error(r.exceptionDetails.exception?.description ?? 'runtime failed')
      return r.result.value
    }
    const reported: { executionContextId: number; name: string }[] = []
    cdp.on('Runtime.bindingCalled', (event) => reported.push(event))
    await cdp.send('Runtime.addBinding', {
      name: 'fixtureBinding',
      executionContextId: world.executionContextId,
    })
    await evalWorld(
      'globalThis.events=[];const nativeBinding=fixtureBinding;globalThis.fixtureBinding=message=>{events.push(JSON.parse(message));nativeBinding(message)};',
    )
    await evalWorld(
      buildBrowserAnnotationRuntime(
        { mode: 'element', annotations: [], theme: {}, tabId: 'tab', documentId: 'doc' },
        'fixtureBinding',
      ),
    )
    // Ordinary page globals cannot access the isolated world binding or runtime.
    assert.equal(await page.evaluate(() => (globalThis as any).fixtureBinding), undefined)
    const selected = await evalWorld(`
      for (const [id,shift] of [['first',false],['second',true],['first',true]]) {
        const e=document.getElementById(id),b=e.getBoundingClientRect();
        e.dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true,clientX:b.x+b.width/2,clientY:b.y+b.height/2,shiftKey:shift}));
      }
      events.filter(e=>e.kind==='editor').at(-1).editor.anchors.map(a=>a.name)
    `)
    assert.deepEqual(selected, ['取消'])
    assert.ok(
      reported.length >= 3 &&
        reported.every(
          (event) =>
            event.executionContextId === world.executionContextId &&
            event.name === 'fixtureBinding',
        ),
    )
    const region = await evalWorld(`
      __cpxAnnotations.sync({mode:'region',annotations:[]});
      window.dispatchEvent(new MouseEvent('mousedown',{clientX:100,clientY:100,button:0}));
      window.dispatchEvent(new MouseEvent('mouseup',{clientX:200,clientY:180,button:0}));
      events.filter(e=>e.kind==='editor').at(-1).editor.anchors[0].rect
    `)
    assert.deepEqual(region, { x: 100, y: 100, width: 100, height: 80 })
    await evalWorld('__cpxAnnotations.prepare();')
    await evalWorld('__cpxAnnotations.restore();')
    await evalWorld(
      `window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));`,
    )
    assert.equal(await evalWorld('events.at(-1).kind'), 'stopped')
  } finally {
    await cdp.detach()
  }
})
