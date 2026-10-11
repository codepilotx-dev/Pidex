export function trimTrailingEnvPathSeparators(path: string): string {
  let end = path.length
  while (end > 0 && path.charCodeAt(end - 1) === 47) end -= 1
  return end === path.length ? path : path.slice(0, end)
}

export function trimLeadingEnvPathSeparators(path: string): string {
  let start = 0
  while (start < path.length && path.charCodeAt(start) === 47) start += 1
  return start === 0 ? path : path.slice(start)
}

export function joinEnvPath(base: string, child: string): string {
  return `${trimTrailingEnvPathSeparators(base)}/${trimLeadingEnvPathSeparators(child)}`
}

export function dirnameEnvPath(path: string): string {
  const normalized = trimTrailingEnvPathSeparators(path)
  const slashIndex = normalized.lastIndexOf('/')
  return slashIndex <= 0 ? '/' : normalized.slice(0, slashIndex)
}

export function basenameEnvPath(path: string): string {
  const normalized = trimTrailingEnvPathSeparators(path)
  const slashIndex = normalized.lastIndexOf('/')
  return slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1)
}

export function relativeEnvPath(root: string, path: string): string {
  const normalizedRoot = trimTrailingEnvPathSeparators(root)
  const normalizedPath = trimTrailingEnvPathSeparators(path)
  if (normalizedPath === normalizedRoot) return ''
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : trimLeadingEnvPathSeparators(normalizedPath)
}
