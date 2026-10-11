import { isRecord } from '@pidex/shared/guards'
import type {
  DesktopBrowserUtilityInput,
  DesktopBrowserDataRequest,
} from '@pidex/shared/desktop-browser-ipc'

const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(value)
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key))
function invalid(): never {
  throw new Error('浏览器请求参数无效')
}
export function requireBrowserUtility(value: unknown): DesktopBrowserUtilityInput {
  if (
    !isRecord(value) ||
    !exact(value, ['tabId', 'generation', 'operation']) ||
    !id(value.tabId) ||
    !id(value.generation) ||
    !isRecord(value.operation)
  )
    invalid()
  const op = value.operation
  let valid = false
  switch (op.action) {
    case 'find':
      valid =
        exact(op, ['action', 'text', 'forward', 'findNext']) &&
        typeof op.text === 'string' &&
        op.text.length > 0 &&
        op.text.length <= 1000 &&
        typeof op.forward === 'boolean' &&
        typeof op.findNext === 'boolean'
      break
    case 'stopFind':
      valid = exact(op, ['action'])
      break
    case 'zoom':
      valid =
        exact(op, ['action', 'direction']) && ['in', 'out', 'reset'].includes(String(op.direction))
      break
    case 'print':
      valid = exact(op, ['action', 'pdf']) && typeof op.pdf === 'boolean'
      break
    case 'screenshot':
      valid =
        exact(op, ['action', 'destination']) &&
        ['copy', 'save', 'composer'].includes(String(op.destination))
      break
    case 'device': {
      const device = op.device
      valid =
        exact(op, ['action', 'device']) &&
        isRecord(device) &&
        exact(device, ['mode', 'width', 'height']) &&
        ['desktop', 'mobile', 'tablet', 'custom'].includes(String(device.mode)) &&
        Number.isInteger(device.width) &&
        Number.isInteger(device.height) &&
        Number(device.width) >= 320 &&
        Number(device.width) <= 3840 &&
        Number(device.height) >= 200 &&
        Number(device.height) <= 2160
      break
    }
  }
  if (!valid) invalid()
  return value as unknown as DesktopBrowserUtilityInput
}
export function requireBrowserData(value: unknown): DesktopBrowserDataRequest {
  if (!isRecord(value)) invalid()
  let valid = false
  switch (value.action) {
    case 'history':
      valid =
        exact(value, ['action', 'query', 'cursor']) &&
        (value.query === undefined ||
          (typeof value.query === 'string' && value.query.length <= 500)) &&
        (value.cursor === undefined ||
          (typeof value.cursor === 'string' && value.cursor.length <= 1000))
      break
    case 'removeHistory':
      valid = exact(value, ['action', 'id']) && id(value.id)
      break
    case 'downloads':
      valid = exact(value, ['action'])
      break
    case 'downloadAction':
      valid =
        exact(value, ['action', 'id', 'command']) &&
        id(value.id) &&
        ['pause', 'resume', 'cancel', 'open', 'reveal', 'remove'].includes(String(value.command))
      break
    case 'preferences':
      valid =
        exact(value, ['action', 'downloadSaveMode']) &&
        (value.downloadSaveMode === undefined ||
          ['downloads', 'ask'].includes(String(value.downloadSaveMode)))
      break
    case 'clear':
      valid =
        exact(value, ['action', 'categories']) &&
        Array.isArray(value.categories) &&
        value.categories.length > 0 &&
        value.categories.length <= 4 &&
        new Set(value.categories).size === value.categories.length &&
        value.categories.every((category) =>
          ['history', 'downloads', 'cache', 'siteData'].includes(category),
        )
      break
  }
  if (!valid) invalid()
  return value as unknown as DesktopBrowserDataRequest
}
