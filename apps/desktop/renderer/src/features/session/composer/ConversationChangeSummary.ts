import type { RenderTurnEntry } from '@pidex/session-view'

import type { DesktopGitStatus } from '../../../../shared/Types.js'
import { syntheticPatchDisplay } from '../timeline/CanonicalItemRenderer.js'

export type ConversationChangedFile = {
  path: string
  additions: number | null
  deletions: number | null
}

type ConversationChangeSummary = {
  files: ConversationChangedFile[]
  additions: number | null
  deletions: number | null
}

export function deriveConversationChangeSummary(
  turns: readonly RenderTurnEntry[],
  gitStatus: DesktopGitStatus | null,
): ConversationChangeSummary {
  if (!gitStatus) {
    return { files: [], additions: 0, deletions: 0 }
  }

  const touchedPaths = new Set<string>()
  for (const turn of turns) {
    const patchFiles = turn.patchItems.flatMap((patch) => patch.files)
    const files =
      patchFiles.length > 0 ? patchFiles : (syntheticPatchDisplay(turn.processItems)?.files ?? [])
    for (const file of files) {
      touchedPaths.add(normalizePathForCompare(file.path))
    }
  }
  const files = gitStatus.files.filter(
    (file) =>
      touchedPaths.has(normalizePathForCompare(file.path)) ||
      (file.originalPath ? touchedPaths.has(normalizePathForCompare(file.originalPath)) : false),
  )
  const projectedFiles = files.map((file) => ({
    path: file.path,
    additions: file.additions,
    deletions: file.deletions,
  }))
  const statsAvailable = projectedFiles.every(
    (file) => file.additions !== null && file.deletions !== null,
  )
  const additions = statsAvailable
    ? projectedFiles.reduce((total, file) => total + (file.additions ?? 0), 0)
    : null
  const deletions = statsAvailable
    ? projectedFiles.reduce((total, file) => total + (file.deletions ?? 0), 0)
    : null

  return {
    files: projectedFiles,
    additions,
    deletions,
  }
}

function normalizePathForCompare(path: string): string {
  return path
    .replaceAll('\\', '/')
    .replace(/^\.\/+|\/+$/gu, '')
    .toLowerCase()
}
