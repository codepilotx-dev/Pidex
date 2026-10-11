/**
 * Normalizes a filesystem path for case-insensitive comparison on Windows.
 * Converts backslashes to forward slashes, strips trailing slashes, and converts to lowercase.
 */
export function normalizePathForComparison(path: string): string {
  return path.replace(/\\/gu, '/').replace(/\/+$/u, '').toLowerCase()
}

/**
 * Checks if two filesystem paths refer to the same location,
 * ignoring separator styles, trailing slashes, and case differences.
 */
export function arePathsEqual(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (left === right) return true
  if (left == null || right == null) return false
  return normalizePathForComparison(left) === normalizePathForComparison(right)
}
