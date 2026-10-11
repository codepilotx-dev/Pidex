import { defaultDesktopClientEnvironment } from './Environment.js'
import { createDesktopBrowserClient } from './BrowserClientService.js'
export { createDesktopBrowserClient, type DesktopBrowserClient } from './BrowserClientService.js'
const environment = defaultDesktopClientEnvironment()
export const desktopBrowserClient = createDesktopBrowserClient(
  environment.window?.DesktopBridge,
  typeof document === 'undefined' ? undefined : document,
)
