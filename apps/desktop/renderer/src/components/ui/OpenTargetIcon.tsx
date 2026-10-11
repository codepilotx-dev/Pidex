import type React from 'react'
import { Code2, File, FolderOpen, SquareTerminal } from 'lucide-react'
import type { DesktopOpenTargetKind } from '../../../shared/Types.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from './IconTokens.js'

export const KNOWN_OPEN_TARGET_IDS = [
  'vscode',
  'vscode-insiders',
  'visual-studio',
  'cursor',
  'windsurf',
  'github-desktop',
  'file-explorer',
  'terminal',
  'intellij',
] as const

export type KnownOpenTargetId = (typeof KNOWN_OPEN_TARGET_IDS)[number]

const OPEN_TARGET_ICON_SRC: Record<KnownOpenTargetId, string> = {
  vscode: '/open-targets/vscode.png',
  'vscode-insiders': '/open-targets/vscode-insiders.png',
  'visual-studio': '/open-targets/visual-studio.png',
  cursor: '/open-targets/cursor.png',
  windsurf: '/open-targets/windsurf.png',
  'github-desktop': '/open-targets/github-desktop.png',
  'file-explorer': '/open-targets/file-explorer.png',
  terminal: '/open-targets/microsoft-terminal.png',
  intellij: '/open-targets/intellij.png',
}

export function openTargetIconSrc(targetId: string): string | null {
  return OPEN_TARGET_ICON_SRC[targetId as KnownOpenTargetId] ?? null
}

/** 已知目标固定使用打包品牌图标；未知目标按类型回退到通用 Lucide 图标。 */
export function OpenTargetIcon({
  targetId,
  kind,
  className,
}: {
  targetId: string
  kind: DesktopOpenTargetKind
  className?: string
}): React.ReactNode {
  const src = openTargetIconSrc(targetId)
  if (src) {
    return <img alt="" className={className} src={src} />
  }
  if (kind === 'file-explorer') {
    return (
      <FolderOpen aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
    )
  }
  if (kind === 'terminal') {
    return (
      <SquareTerminal aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
    )
  }
  if (kind === 'editor') {
    return <Code2 aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
  }
  return <File aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
}
