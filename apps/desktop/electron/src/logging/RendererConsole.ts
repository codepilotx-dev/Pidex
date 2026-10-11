import { basename } from 'node:path'

export type RendererConsoleRecord = {
  level: 'warning' | 'error'
  message: string
  line: number
  source?: string
}

const sourceName = (sourceId: string): string | undefined => {
  if (!sourceId) return undefined
  try {
    return basename(decodeURIComponent(new URL(sourceId).pathname)) || undefined
  } catch {
    return basename(sourceId.replaceAll('\\', '/')) || undefined
  }
}

export function rendererConsoleRecord(
  level: 'info' | 'warning' | 'error' | 'debug',
  message: string,
  line: number,
  sourceId: string,
): RendererConsoleRecord | null {
  if (level !== 'warning' && level !== 'error') return null
  return {
    level,
    message,
    line,
    ...(sourceName(sourceId) ? { source: sourceName(sourceId) } : {}),
  }
}
