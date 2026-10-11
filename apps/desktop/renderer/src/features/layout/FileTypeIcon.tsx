import { APP_ICON_SIZE } from '../../components/ui/IconTokens.js'
import type React from 'react'
import { lazy, Suspense } from 'react'
import { File, Folder, type LucideProps } from 'lucide-react'

const MaterialFileIcon = lazy(() =>
  import('./material-icons/Components.js').then((module) => ({
    default: module.FileIcon,
  })),
)

const MaterialFolderIcon = lazy(() =>
  import('./material-icons/Components.js').then((module) => ({
    default: module.FolderIcon,
  })),
)

export type FileTypeIconProps = LucideProps & {
  associationMode?: 'extension-only'
  path?: string | null
}

export function FileTypeIcon({
  size = APP_ICON_SIZE,
  path,
  strokeWidth: _strokeWidth,
  absoluteStrokeWidth: _absoluteStrokeWidth,
  ...iconProps
}: FileTypeIconProps): React.ReactNode {
  return (
    <Suspense fallback={<File size={size} {...iconProps} />}>
      <MaterialFileIcon size={size} {...iconProps} path={path} />
    </Suspense>
  )
}

export type FolderTypeIconProps = LucideProps & {
  expanded?: boolean
  path?: string | null
}

export function FolderTypeIcon({
  size = APP_ICON_SIZE,
  path,
  expanded,
  strokeWidth: _strokeWidth,
  absoluteStrokeWidth: _absoluteStrokeWidth,
  ...iconProps
}: FolderTypeIconProps): React.ReactNode {
  return (
    <Suspense fallback={<Folder size={size} {...iconProps} />}>
      <MaterialFolderIcon size={size} {...iconProps} expanded={expanded} path={path} />
    </Suspense>
  )
}
