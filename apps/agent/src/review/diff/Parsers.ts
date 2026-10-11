import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { ReviewFileSummary } from '@pidex/agent-protocol'
import { AgentError } from '../../Domain'

type NameStatus = {
  path: string
  previousPath: string | null
  status: ReviewFileSummary['status']
}

export type RawDiffEntry = NameStatus & {
  oldMode: string
  newMode: string
  oldOid: string
  newOid: string
}

export const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
export const normalizedPath = (path: string) => path.replaceAll('\\', '/')

export const validateRelativePath = (path: string) => {
  const normalized = normalizedPath(path)
  const segments = normalized.split('/')
  const pathspecMagic =
    normalized.startsWith(':(') ||
    normalized.startsWith(':/') ||
    normalized.startsWith(':!') ||
    normalized.startsWith(':^') ||
    normalized.startsWith('::')
  if (
    !normalized ||
    normalized === '.' ||
    isAbsolute(path) ||
    segments.includes('..') ||
    segments.includes('.') ||
    segments.includes('') ||
    normalized.includes('\0') ||
    pathspecMagic
  ) {
    throw new AgentError('PATH_DENIED', 'Review 文件路径必须是仓库内相对路径', 403)
  }
  return normalized
}

const mapStatus = (status: string): ReviewFileSummary['status'] => {
  switch (status[0]) {
    case 'A':
      return 'added'
    case 'M':
      return 'modified'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'T':
      return 'type-changed'
    case '?':
      return 'untracked'
    default:
      return 'unknown'
  }
}

export const parseNameStatus = (value: string): NameStatus[] => {
  const fields = value.split('\0')
  const result: NameStatus[] = []
  for (let index = 0; index < fields.length;) {
    const rawStatus = fields[index++]
    if (!rawStatus) continue
    const firstPath = fields[index++]
    if (!firstPath) continue
    if (rawStatus.startsWith('R') || rawStatus.startsWith('C')) {
      const destination = fields[index++]
      if (!destination) continue
      result.push({
        path: validateRelativePath(destination),
        previousPath: validateRelativePath(firstPath),
        status: mapStatus(rawStatus),
      })
    } else {
      result.push({
        path: validateRelativePath(firstPath),
        previousPath: null,
        status: mapStatus(rawStatus),
      })
    }
  }
  return result
}

export const parseRawDiff = (value: string): RawDiffEntry[] => {
  const fields = value.split('\0')
  const result: RawDiffEntry[] = []
  for (let index = 0; index < fields.length;) {
    const header = fields[index++]
    if (!header?.startsWith(':')) continue
    const [oldMode, newMode, oldOid, newOid, rawStatus] = header.slice(1).split(' ')
    if (!oldMode || !newMode || !oldOid || !newOid || !rawStatus) continue
    const firstPath = fields[index++]
    if (!firstPath) continue
    if (rawStatus.startsWith('R') || rawStatus.startsWith('C')) {
      const destination = fields[index++]
      if (!destination) continue
      result.push({
        path: validateRelativePath(destination),
        previousPath: validateRelativePath(firstPath),
        status: mapStatus(rawStatus),
        oldMode,
        newMode,
        oldOid,
        newOid,
      })
    } else {
      result.push({
        path: validateRelativePath(firstPath),
        previousPath: null,
        status: mapStatus(rawStatus),
        oldMode,
        newMode,
        oldOid,
        newOid,
      })
    }
  }
  return result
}

export const parseRawNumstatDiff = (value: string) => {
  const fields = value.split('\0')
  let index = 0
  while (fields[index]?.startsWith(':')) {
    const header = fields[index++]!
    const rawStatus = header.slice(1).split(' ')[4] ?? ''
    index += rawStatus.startsWith('R') || rawStatus.startsWith('C') ? 2 : 1
  }
  return {
    rawEntries: parseRawDiff(value),
    numstats: parseNumstats(fields.slice(index).join('\0')),
  }
}

export const parsePorcelainStatus = (value: string) => {
  const fields = value.split('\0')
  const files: Array<{
    path: string
    previousPath: string | null
    stagedStatus: string
    unstagedStatus: string
    untracked: boolean
  }> = []
  for (let index = 0; index < fields.length;) {
    const field = fields[index++]
    if (!field || field.length < 4) continue
    const stagedStatus = field[0] ?? ' '
    const unstagedStatus = field[1] ?? ' '
    const path = validateRelativePath(field.slice(3))
    const renamedOrCopied =
      stagedStatus === 'R' ||
      stagedStatus === 'C' ||
      unstagedStatus === 'R' ||
      unstagedStatus === 'C'
    const previousPath = renamedOrCopied ? validateRelativePath(fields[index++] ?? '') : null
    files.push({
      path,
      previousPath,
      stagedStatus,
      unstagedStatus,
      untracked: stagedStatus === '?' && unstagedStatus === '?',
    })
  }
  return files
}

export const parseNumstat = (value: string) => {
  const first = value.split('\0').find(Boolean)
  if (!first) return { additions: 0, deletions: 0, binary: false }
  const [added = '0', deleted = '0'] = first.split('\t')
  if (added === '-' || deleted === '-') return { additions: null, deletions: null, binary: true }
  return {
    additions: Number.parseInt(added, 10) || 0,
    deletions: Number.parseInt(deleted, 10) || 0,
    binary: false,
  }
}

export const parseNumstats = (value: string) => {
  const result = new Map<
    string,
    { additions: number | null; deletions: number | null; binary: boolean }
  >()
  const fields = value.split('\0')
  for (let index = 0; index < fields.length;) {
    const field = fields[index++]
    if (!field) continue
    const [added = '0', deleted = '0', inlinePath = ''] = field.split('\t')
    let path = inlinePath
    if (!path) {
      index += 1
      path = fields[index++] ?? ''
    }
    if (!path) continue
    result.set(
      validateRelativePath(path),
      added === '-' || deleted === '-'
        ? { additions: null, deletions: null, binary: true }
        : {
            additions: Number.parseInt(added, 10) || 0,
            deletions: Number.parseInt(deleted, 10) || 0,
            binary: false,
          },
    )
  }
  return result
}

export const textFilePatch = (path: string, content: string) => {
  const normalized = content.replaceAll('\r\n', '\n')
  const hasFinalNewline = normalized.endsWith('\n')
  const body = hasFinalNewline ? normalized.slice(0, -1) : normalized
  const lines = body ? body.split('\n') : []
  const patchLines = [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ]
  if (!hasFinalNewline && lines.length > 0) patchLines.push('\\ No newline at end of file')
  return { patch: `${patchLines.join('\n')}\n`, additions: lines.length }
}

export const parseHunks = (patch: string) => {
  const matches = [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/gm)]
  if (!matches.length) return []
  const preamble = patch.slice(0, matches[0]!.index)
  return matches.map((match, index) => {
    const body = patch.slice(match.index!, matches[index + 1]?.index ?? patch.length)
    const hunkPatch = `${preamble}${body}`
    return {
      id: sha256(hunkPatch),
      header: match[0],
      oldStart: Number.parseInt(match[1]!, 10),
      oldLines: match[2] === undefined ? 1 : Number.parseInt(match[2], 10),
      newStart: Number.parseInt(match[3]!, 10),
      newLines: match[4] === undefined ? 1 : Number.parseInt(match[4], 10),
      patch: hunkPatch,
    }
  })
}
