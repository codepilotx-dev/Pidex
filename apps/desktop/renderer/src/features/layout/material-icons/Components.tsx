import { useEffect, useState, type ComponentType } from 'react'
import {
  resolveFileIconName,
  resolveFolderIconName,
  type IconName,
  type ResolveFileIconOptions,
  type ResolveFolderIconOptions,
} from '@pidex/material-icon-theme'
import { loadCachedIconShard } from './IconShardCache.js'
import {
  createMaterialIcon,
  iconShard,
  loadIconShard,
  type IconComponent,
  type MaterialSvgIconProps,
} from './index.js'

const FileIconComponent = createMaterialIcon(
  'FileIcon',
  '0 0 16 16',
  '<path d="m8.668 6h3.6641l-3.6641-3.668v3.668m-4.668-4.668h5.332l4 4v8c0 0.73828-0.59375 1.3359-1.332 1.3359h-8c-0.73828 0-1.332-0.59766-1.332-1.3359v-10.664c0-0.74219 0.59375-1.3359 1.332-1.3359m3.332 1.3359h-3.332v10.664h8v-6h-4.668z" fill="currentColor" />',
)
const FolderIconComponent = createMaterialIcon(
  'FolderIcon',
  '0 0 16 16',
  '<path d="m6.922 3.768-.644-.536A1 1 0 0 0 5.638 3H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H7.562a1 1 0 0 1-.64-.232" fill="currentColor" />',
)
const FolderOpenIconComponent = createMaterialIcon(
  'FolderOpenIcon',
  '0 0 16 16',
  '<path d="M14.483 6H4.721a1 1 0 0 0-.949.684L2 12V5h12a1 1 0 0 0-1-1H7.562a1 1 0 0 1-.64-.232l-.644-.536A1 1 0 0 0 5.638 3H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h11l2.403-5.606A1 1 0 0 0 14.483 6" fill="currentColor" />',
)
const FolderRootIconComponent = createMaterialIcon(
  'FolderRootIcon',
  '0 0 16 16',
  '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="8" r="3" fill="currentColor"/>',
)
const FolderRootOpenIconComponent = createMaterialIcon(
  'FolderRootOpenIcon',
  '0 0 16 16',
  '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2"/>',
)

export interface MaterialIconProps extends MaterialSvgIconProps {
  name: IconName
}

export function MaterialIcon({ name, ...props }: MaterialIconProps) {
  return <AsyncMaterialIcon fallback={FileIconComponent} name={name} {...props} />
}

const componentCache = new Map<IconName, IconComponent>([
  ['file', FileIconComponent],
  ['folder', FolderIconComponent],
  ['folder-open', FolderOpenIconComponent],
  ['folder-root', FolderRootIconComponent],
  ['folder-root-open', FolderRootOpenIconComponent],
])
const shardCache = new Map<number, Promise<void>>()

function AsyncMaterialIcon({
  fallback: Fallback,
  name,
  ...props
}: MaterialIconProps & { fallback: ComponentType<MaterialSvgIconProps> }) {
  const initialIcon = componentCache.get(name)
  const [Icon, setIcon] = useState<IconComponent>(() => initialIcon ?? Fallback)
  const [resolvedName, setResolvedName] = useState<IconName | null>(() =>
    initialIcon ? name : null,
  )

  useEffect(() => {
    const cached = componentCache.get(name)
    if (cached) {
      setIcon(() => cached)
      setResolvedName(name)
      return
    }

    setIcon(() => Fallback)
    setResolvedName(null)
    let active = true
    const shard = iconShard(name)
    const loading = loadCachedIconShard(shardCache, shard, () =>
      loadIconShard(name).then((components) => {
        for (const [iconName, component] of Object.entries(components)) {
          if (component) componentCache.set(iconName as IconName, component)
        }
      }),
    )
    void loading.then(() => {
      const loaded = componentCache.get(name)
      if (active && loaded) {
        setIcon(() => loaded)
        setResolvedName(name)
      }
    })
    return () => {
      active = false
    }
  }, [Fallback, name])

  return (
    <Icon
      data-material-icon-name={name}
      data-material-icon-ready={resolvedName === name ? 'true' : 'false'}
      {...props}
    />
  )
}

export interface FileIconProps
  extends Omit<MaterialIconProps, 'name' | 'path'>, ResolveFileIconOptions {
  path?: string | null
}

export function FileIcon({
  path,
  associationMode,
  language,
  languageId,
  parentPath,
  parentDirectory,
  ...props
}: FileIconProps) {
  const name = resolveFileIconName(path ?? '', {
    associationMode,
    language,
    languageId,
    parentPath,
    parentDirectory,
  })
  return <AsyncMaterialIcon fallback={FileIconComponent} name={name} {...props} />
}

export interface FolderIconProps
  extends Omit<MaterialIconProps, 'name' | 'path'>, ResolveFolderIconOptions {
  path?: string | null
}

export function FolderIcon({
  path,
  expanded,
  root,
  parentPath,
  parentDirectory,
  ...props
}: FolderIconProps) {
  const name = resolveFolderIconName(path ?? '', {
    expanded,
    root,
    parentPath,
    parentDirectory,
  })
  const fallback = root
    ? expanded
      ? FolderRootOpenIconComponent
      : FolderRootIconComponent
    : expanded
      ? FolderOpenIconComponent
      : FolderIconComponent
  return <AsyncMaterialIcon fallback={fallback} name={name} {...props} />
}
