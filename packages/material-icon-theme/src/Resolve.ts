import {
  defaultIconNames,
  fileExtensions,
  fileNames,
  folderNames,
  folderNamesExpanded,
  languageIds,
  rootFolderNames,
  rootFolderNamesExpanded,
} from './generated/Manifest'
import type { IconName } from './icons'

export interface ResolveFileIconOptions {
  /**
   * Controls whether filename and compound-extension associations participate.
   * `extension-only` only consults the basename's final extension.
   */
  associationMode?: 'full' | 'extension-only'
  /**
   * VS Code language identifier. It is consulted after filename and extension
   * associations, matching VS Code icon-theme precedence.
   */
  language?: string
  languageId?: string
  /**
   * Optional parent path for callers that only have a basename.
   */
  parentPath?: string
  parentDirectory?: string
}

export interface ResolveFolderIconOptions {
  expanded?: boolean
  root?: boolean
  /**
   * Optional parent path for callers that only have a folder basename.
   */
  parentPath?: string
  parentDirectory?: string
}

export function resolveFileIconName(
  filePath: string,
  options: ResolveFileIconOptions = {},
): IconName {
  const path = withOptionalParent(filePath, options.parentPath ?? options.parentDirectory)
  const associationMode = options.associationMode ?? 'full'
  if (associationMode === 'full') {
    const nameMatch = findPathAssociation(fileNames, path)
    if (nameMatch) return nameMatch
  }

  const basename = path.split('/').at(-1) ?? path
  const extensions =
    associationMode === 'extension-only'
      ? finalExtensionCandidate(basename)
      : extensionCandidates(basename)
  for (const extension of extensions) {
    const extensionMatch = getAssociation(fileExtensions, extension)
    if (extensionMatch) return extensionMatch
  }

  const language = options.languageId ?? options.language
  if (language) {
    const languageMatch = getAssociation(languageIds, language.toLowerCase())
    if (languageMatch) return languageMatch
  }
  return defaultIconNames.file
}

export function resolveFolderIconName(
  folderPath: string,
  options: ResolveFolderIconOptions = {},
): IconName {
  const path = withOptionalParent(folderPath, options.parentPath ?? options.parentDirectory)
  if (options.root) {
    const mapping = options.expanded ? rootFolderNamesExpanded : rootFolderNames
    return (
      findPathAssociation(mapping, path) ??
      (options.expanded ? defaultIconNames.rootFolderExpanded : defaultIconNames.rootFolder)
    )
  }

  const mapping = options.expanded ? folderNamesExpanded : folderNames
  return (
    findPathAssociation(mapping, path) ??
    (options.expanded ? defaultIconNames.folderExpanded : defaultIconNames.folder)
  )
}

function withOptionalParent(path: string, parent: string | undefined): string {
  const normalized = normalizePath(path)
  if (!parent || normalized.includes('/')) return normalized
  const normalizedParent = normalizePath(parent)
  return normalizedParent ? `${normalizedParent}/${normalized}` : normalized
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase()
}

function findPathAssociation(
  mapping: Readonly<Record<string, IconName>>,
  path: string,
): IconName | undefined {
  const parts = path.split('/').filter(Boolean)
  for (let index = 0; index < parts.length; index += 1) {
    const match = getAssociation(mapping, parts.slice(index).join('/'))
    if (match) return match
  }
  return undefined
}

function extensionCandidates(basename: string): string[] {
  const candidates: string[] = []
  for (let index = basename.indexOf('.'); index >= 0; index = basename.indexOf('.', index + 1)) {
    const extension = index === 0 ? basename : basename.slice(index + 1)
    if (extension && !candidates.includes(extension)) candidates.push(extension)
  }
  return candidates.sort((left, right) => right.length - left.length)
}

function finalExtensionCandidate(basename: string): string[] {
  const index = basename.lastIndexOf('.')
  if (index < 0) return []
  const extension = index === 0 ? basename : basename.slice(index + 1)
  return extension ? [extension] : []
}

function getAssociation(
  mapping: Readonly<Record<string, IconName>>,
  key: string,
): IconName | undefined {
  return Object.prototype.hasOwnProperty.call(mapping, key) ? mapping[key] : undefined
}
