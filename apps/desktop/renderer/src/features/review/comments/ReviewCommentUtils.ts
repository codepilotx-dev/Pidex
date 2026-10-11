import type { DesktopReviewComment } from '../../../../shared/Types.js'

/**
 * Builds a map from file path (and aggregated directory paths) to open comment count.
 *
 * - File paths map to their direct open comment count.
 * - Directory paths (each prefix of a file path) map to the sum of open comments
 *   in all descendant files.
 * - Resolved comments are excluded.
 */
export function buildCommentCountsByPath(comments: DesktopReviewComment[]): Record<string, number> {
  const counts: Record<string, number> = {}

  // File-level counts from open comments
  for (const comment of comments) {
    if (comment.status !== 'open') continue
    counts[comment.filePath] = (counts[comment.filePath] ?? 0) + 1
  }

  // Aggregate file counts upward into directory paths
  const fileCounts = { ...counts }
  for (const [filePath, count] of Object.entries(fileCounts)) {
    const segments = filePath.split('/')
    if (segments.length <= 1) continue
    let dirPath = ''
    for (let i = 0; i < segments.length - 1; i++) {
      dirPath = dirPath ? `${dirPath}/${segments[i]}` : segments[i]
      counts[dirPath] = (counts[dirPath] ?? 0) + count
    }
  }

  return counts
}
