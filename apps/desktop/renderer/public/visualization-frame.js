/* Pidex's isolated renderer shell. Generated scripts never run in the host. */
;(() => {
  'use strict'
  let port
  let initialized = false
  let final = false
  let failed = false
  let revision = 0
  const root = document.getElementById('visualization-root')
  const theme = document.createElement('style')
  theme.textContent =
    'html,body{margin:0;min-height:0;background:var(--pidex-background);color:var(--pidex-foreground);font:14px system-ui,sans-serif}main{padding:16px;box-sizing:border-box}button,input,select,textarea{font:inherit}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--pidex-accent);outline-offset:2px}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:0.01ms!important;transition-duration:0.01ms!important}}'
  document.head.append(theme)
  const css = document.createElement('style')
  document.head.append(css)
  const send = (type, payload = {}) => port?.postMessage({ type, ...payload })
  const reportError = () => {
    failed = true
    send('error', { message: '交互界面运行失败，可以重新加载或让 AI 修复。' })
  }
  addEventListener('error', reportError)
  addEventListener('unhandledrejection', reportError)
  new ResizeObserver(() => send('height', { height: document.body.scrollHeight })).observe(
    document.body,
  )
  function updateTheme(values) {
    for (const name of ['background', 'foreground', 'secondary', 'accent', 'border']) {
      if (typeof values?.[name] === 'string')
        document.documentElement.style.setProperty(`--pidex-${name}`, values[name])
    }
    document.documentElement.style.colorScheme = values?.scheme === 'dark' ? 'dark' : 'light'
  }
  // A layout parser, not a security boundary: CSP and iframe sandbox enforce isolation.
  function bodyFragment(html) {
    const template = document.createElement('template')
    template.innerHTML = html
    for (const node of template.content.querySelectorAll(
      'script,style,link,meta,base,iframe,object,embed',
    ))
      node.remove()
    for (const node of template.content.querySelectorAll('*')) {
      for (const attr of [...node.attributes]) {
        if (
          /^on/i.test(attr.name) ||
          attr.name === 'srcdoc' ||
          ((attr.name === 'href' || attr.name === 'src' || attr.name === 'action') &&
            !attr.value.startsWith('#') &&
            !attr.value.startsWith('data:') &&
            !attr.value.startsWith('blob:'))
        )
          node.removeAttribute(attr.name)
      }
    }
    return template.content
  }
  function run(code) {
    const script = document.createElement('script')
    script.textContent = code
    document.body.append(script)
  }
  async function render(message) {
    if (message.revision <= revision || final) return
    revision = message.revision
    updateTheme(message.theme)
    css.textContent = message.css
    root.inert = !message.final
    root.replaceChildren(bodyFragment(message.html))
    if (!message.final) return
    final = true
    // Generated code can prepare a follow-up; only a host-owned user button submits it.
    const api = Object.freeze({
      sendPrompt: async ({ text, selection } = {}) => {
        if (typeof text !== 'string' || !text.trim() || text.length > 4000)
          throw new Error('Invalid follow-up')
        const encoded = JSON.stringify(selection ?? null)
        if (encoded.length > 16000) throw new Error('Selection too large')
        send('followup', { text, selection: JSON.parse(encoded) })
        return { prepared: true }
      },
    })
    Object.defineProperty(globalThis, 'Pidex', { value: api, writable: false, configurable: false })
    for (const library of message.libraries ?? []) run(library)
    run(message.jsFunctions)
    for (const expression of message.jsExpressions ?? []) run(expression)
    if (!failed) send('ready')
    send('height', { height: document.body.scrollHeight })
  }
  addEventListener('message', (event) => {
    if (
      event.source !== parent ||
      initialized ||
      event.data?.type !== 'pidex:initialize' ||
      event.ports.length !== 1
    )
      return
    initialized = true
    port = event.ports[0]
    port.onmessage = (event) => {
      if (event.data?.type === 'theme') updateTheme(event.data.theme)
      else if (event.data?.type === 'render') void render(event.data).catch(reportError)
    }
    port.start()
    send('connected')
  })
})()
