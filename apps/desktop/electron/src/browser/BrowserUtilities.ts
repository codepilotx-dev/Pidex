import { clipboard, dialog, type BrowserWindow, type WebContents } from 'electron'
import { writeFile } from 'node:fs/promises'
import type {
  DesktopBrowserUtility,
  DesktopBrowserUtilityResult,
  DesktopBrowserDevice,
} from '@pidex/shared/desktop-browser-ipc'

export function changeBrowserZoom(contents: WebContents, direction: 'in' | 'out' | 'reset') {
  const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]
  const current = contents.getZoomFactor()
  const factor =
    direction === 'reset'
      ? 1
      : direction === 'in'
        ? (steps.find((step) => step > current + 0.001) ?? 5)
        : ([...steps].reverse().find((step) => step < current - 0.001) ?? 0.25)
  contents.setZoomFactor(factor)
  return factor
}
export async function applyBrowserDevice(
  contents: WebContents,
  device: DesktopBrowserDevice,
  defaultUserAgent: string,
) {
  if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
  const mobile = device.mode === 'mobile'
  if (device.mode === 'desktop')
    await contents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
  else
    await contents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: device.width,
      height: device.height,
      deviceScaleFactor: 1,
      mobile,
    })
  await contents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', {
    enabled: device.mode === 'mobile' || device.mode === 'tablet',
  })
  const userAgent = mobile
    ? defaultUserAgent
        .replace(/\([^)]*\)/, '(Linux; Android 14)')
        .replace(/Electron\/\S+\s*/g, '')
        .replace(/Safari\//, 'Mobile Safari/')
    : defaultUserAgent
  contents.setUserAgent(userAgent)
  await contents.debugger.sendCommand('Emulation.setUserAgentOverride', { userAgent })
}
export async function runBrowserUtility(
  owner: BrowserWindow,
  contents: WebContents,
  operation: DesktopBrowserUtility,
): Promise<DesktopBrowserUtilityResult> {
  switch (operation.action) {
    case 'find':
      return {
        requestId: contents.findInPage(operation.text, {
          forward: operation.forward,
          findNext: operation.findNext,
        }),
      }
    case 'stopFind':
      contents.stopFindInPage('clearSelection')
      contents.focus()
      return {}
    case 'zoom':
      changeBrowserZoom(contents, operation.direction)
      return {}
    case 'print': {
      if (!operation.pdf) {
        await new Promise<void>((resolve, reject) =>
          contents.print({}, (success, reason) =>
            success || /cancel/i.test(reason) ? resolve() : reject(new Error('打印未完成')),
          ),
        )
        return {}
      }
      const chosen = await dialog.showSaveDialog(owner, {
        defaultPath: '网页.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
      if (!chosen.canceled && chosen.filePath)
        await writeFile(chosen.filePath, await contents.printToPDF({ printBackground: true }))
      return { message: chosen.canceled ? '已取消' : 'PDF 已保存' }
    }
    case 'screenshot': {
      const image = await contents.capturePage()
      const png = image.toPNG()
      if (image.isEmpty() || png.byteLength > 8 * 1024 * 1024)
        throw new Error('截图为空或超过 8 MB')
      if (operation.destination === 'copy' || operation.destination === 'composer') {
        clipboard.writeImage(image)
        return operation.destination === 'composer'
          ? {
              image: { data: png.toString('base64'), mimeType: 'image/png' },
              message: '截图已复制',
            }
          : { message: '截图已复制' }
      }
      const chosen = await dialog.showSaveDialog(owner, {
        defaultPath: '网页截图.png',
        filters: [{ name: 'PNG', extensions: ['png'] }],
      })
      if (!chosen.canceled && chosen.filePath) await writeFile(chosen.filePath, png)
      return { message: chosen.canceled ? '已取消' : '截图已保存' }
    }
    case 'device':
      return {}
  }
}
