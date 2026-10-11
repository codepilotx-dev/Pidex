import { isRecord } from './Guards.js'

export type BrowserAnnotationMode = 'element' | 'text' | 'region'
export type BrowserAnnotationRect = { x: number; y: number; width: number; height: number }
export type BrowserAnnotationAnchor = {
  kind: BrowserAnnotationMode
  pageUrl: string
  pageTitle: string
  framePath: string[]
  frameUrl: string
  runtimeId: string
  selector?: string
  xpath?: string
  name: string
  tagName: string
  role?: string
  text: string
  nearbyText: string
  rect: BrowserAnnotationRect
  scroll: { x: number; y: number }
  scrollContainers: { selector: string; x: number; y: number }[]
  style: Record<string, string>
  attributes: Record<string, string>
  html?: string
  regionReferenceRect?: BrowserAnnotationRect
  textRange?: {
    start: { selector: string; nodePath: number[]; offset: number }
    end: { selector: string; nodePath: number[]; offset: number }
  }
}
export type BrowserAnnotation = {
  id: string
  tabId: string
  documentId: string
  body: string
  anchors: BrowserAnnotationAnchor[]
  screenshotName?: string
}
export type BrowserAnnotationEditor = {
  id: string
  body: string
  anchors: BrowserAnnotationAnchor[]
  includeHtml: boolean
}
export const BROWSER_ANNOTATION_MANIFEST_NAME = 'pidex-browser-annotations.json'
export function serializeBrowserAnnotations(annotations: readonly BrowserAnnotation[]): string {
  return JSON.stringify({ format: 'pidex.browser-annotations', schemaVersion: 1, annotations })
}
export function isBrowserAnnotationAnchor(value: unknown): value is BrowserAnnotationAnchor {
  if (!isRecord(value)) return false
  const rect = value.rect
  const scroll = value.scroll
  const reference = value.regionReferenceRect
  return (
    ['element', 'text', 'region'].includes(String(value.kind)) &&
    [
      'pageUrl',
      'pageTitle',
      'frameUrl',
      'runtimeId',
      'name',
      'tagName',
      'text',
      'nearbyText',
    ].every((key) => typeof value[key] === 'string') &&
    Array.isArray(value.framePath) &&
    value.framePath.every((s) => typeof s === 'string') &&
    isRecord(rect) &&
    ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(rect[k])) &&
    Number(rect.width) >= 0 &&
    Number(rect.height) >= 0 &&
    isRecord(scroll) &&
    Number.isFinite(scroll.x) &&
    Number.isFinite(scroll.y) &&
    Array.isArray(value.scrollContainers) &&
    value.scrollContainers.every(
      (s) =>
        isRecord(s) &&
        typeof s.selector === 'string' &&
        Number.isFinite(s.x) &&
        Number.isFinite(s.y),
    ) &&
    [value.style, value.attributes].every(
      (v) => isRecord(v) && Object.values(v).every((s) => typeof s === 'string'),
    ) &&
    (reference === undefined ||
      (isRecord(reference) &&
        ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(reference[k])))) &&
    ['selector', 'xpath', 'role', 'html'].every(
      (k) => value[k] === undefined || typeof value[k] === 'string',
    ) &&
    (value.textRange === undefined ||
      (isRecord(value.textRange) &&
        [value.textRange.start, value.textRange.end].every(
          (p) =>
            isRecord(p) &&
            typeof p.selector === 'string' &&
            Number.isSafeInteger(p.offset) &&
            Number(p.offset) >= 0 &&
            Array.isArray(p.nodePath) &&
            p.nodePath.every((n) => Number.isSafeInteger(n) && n >= 0),
        )))
  )
}
export function isBrowserAnnotation(value: unknown): value is BrowserAnnotation {
  return (
    isRecord(value) &&
    ['id', 'tabId', 'documentId', 'body'].every((k) => typeof value[k] === 'string') &&
    String(value.body).trim().length > 0 &&
    Array.isArray(value.anchors) &&
    value.anchors.length > 0 &&
    value.anchors.every(isBrowserAnnotationAnchor) &&
    (value.screenshotName === undefined || typeof value.screenshotName === 'string')
  )
}
export function parseBrowserAnnotations(text: string): BrowserAnnotation[] | null {
  if (new TextEncoder().encode(text).length > 1024 * 1024) return null
  try {
    const value: unknown = JSON.parse(text)
    if (
      !isRecord(value) ||
      value.format !== 'pidex.browser-annotations' ||
      value.schemaVersion !== 1 ||
      !Array.isArray(value.annotations) ||
      !value.annotations.every(isBrowserAnnotation)
    )
      return null
    return value.annotations
  } catch {
    return null
  }
}
