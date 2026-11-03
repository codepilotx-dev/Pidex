import type { Session, WebContents, WebFrameMain } from 'electron'

const installed = new WeakSet<Session>()
export function isVisualizationFrame(url: string): boolean {
  try {
    return new URL(url).pathname === '/visualization-frame.html'
  } catch {
    return false
  }
}
function visualizationAncestor(frame: WebFrameMain | null | undefined): WebFrameMain | null {
  for (let current = frame; current; current = current.parent) {
    if (isVisualizationFrame(current.url)) return current
  }
  return null
}

/** CSP does not block a sandboxed frame navigating itself; Electron closes that gap. */
export function installVisualizationIsolation(contents: WebContents): void {
  contents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && visualizationAncestor(event.frame)) event.preventDefault()
  })
  const session = contents.session
  if (installed.has(session)) return
  installed.add(session)
  session.webRequest.onBeforeRequest((request, callback) => {
    try {
      const owner = visualizationAncestor(request.frame)
      if (!owner) {
        callback({ cancel: false })
        return
      }
      const bootstrap = new URL('/visualization-frame.js', owner.url).href
      const local = request.url.startsWith('blob:') || request.url.startsWith('data:')
      callback({
        cancel:
          !local &&
          !(
            request.method === 'GET' &&
            request.resourceType === 'script' &&
            request.url === bootstrap
          ),
      })
    } catch {
      callback({ cancel: true })
    }
  })
}
