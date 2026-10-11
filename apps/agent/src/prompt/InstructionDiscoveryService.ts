import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

const INSTRUCTION_NAMES = ['AGENTS.override.md', 'AGENTS.md', 'CLAUDE.md'] as const
const DEFAULT_BUDGET = 32 * 1024

export interface ProjectInstructionSource {
  path: string
  scope: string
  content: string
  hash: string
  bytes: number
  truncated: boolean
}

export interface InstructionDiscoveryResult {
  workspaceRoot: string
  cwd: string
  sources: ProjectInstructionSource[]
  totalBytes: number
  budgetBytes: number
  truncated: boolean
}

export interface InstructionDiscoveryOptions {
  budgetBytes?: number
}

const decoder = new TextDecoder('utf-8', { fatal: true })
const contained = (root: string, candidate: string) => {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}
const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex')

const decodeWithinBudget = (bytes: Uint8Array, budget: number) => {
  if (bytes.byteLength <= budget)
    return { content: decoder.decode(bytes), bytes: bytes.byteLength, truncated: false }
  let end = Math.max(0, budget)
  while (end > 0) {
    try {
      return { content: decoder.decode(bytes.subarray(0, end)), bytes: end, truncated: true }
    } catch {
      end -= 1
    }
  }
  return { content: '', bytes: 0, truncated: true }
}

const directoriesFromRoot = (root: string, cwd: string) => {
  const directories: string[] = []
  let current = cwd
  while (true) {
    directories.push(current)
    if (current === root) break
    const parent = dirname(current)
    if (parent === current) throw new Error('cwd 不在 workspace 内')
    current = parent
  }
  return directories.reverse()
}

export class InstructionDiscoveryService {
  async discover(
    workspaceRoot: string,
    cwd = workspaceRoot,
    options: InstructionDiscoveryOptions = {},
  ): Promise<InstructionDiscoveryResult> {
    const root = await realpath(resolve(workspaceRoot))
    const canonicalCwd = await realpath(resolve(cwd))
    if (!contained(root, canonicalCwd)) throw new Error('cwd 必须位于 workspace 内')
    const budgetBytes = Math.max(0, options.budgetBytes ?? DEFAULT_BUDGET)
    const sources: ProjectInstructionSource[] = []
    let remaining = budgetBytes
    let budgetTruncated = false

    for (const directory of directoriesFromRoot(root, canonicalCwd)) {
      let selected: string | null = null
      for (const name of INSTRUCTION_NAMES) {
        const candidate = join(directory, name)
        try {
          const stats = await lstat(candidate)
          if (stats.isFile() || stats.isSymbolicLink()) {
            selected = candidate
            break
          }
        } catch (cause) {
          if (!(cause instanceof Error) || !('code' in cause) || cause.code !== 'ENOENT')
            throw cause
        }
      }
      if (!selected) continue
      const canonical = await realpath(selected)
      if (!contained(root, canonical)) throw new Error(`项目指令文件逃出 workspace: ${selected}`)
      const raw = await readFile(canonical)
      // Validate the complete file even when only a prefix fits the context budget.
      decoder.decode(raw)
      const decoded = decodeWithinBudget(raw, remaining)
      sources.push({
        path: canonical,
        scope: relative(root, directory) || '.',
        content: decoded.content,
        hash: sha256(raw),
        bytes: decoded.bytes,
        truncated: decoded.truncated,
      })
      remaining -= decoded.bytes
      if (decoded.truncated) budgetTruncated = true
      if (remaining === 0) break
    }

    return {
      workspaceRoot: root,
      cwd: canonicalCwd,
      sources,
      totalBytes: budgetBytes - remaining,
      budgetBytes,
      truncated: budgetTruncated,
    }
  }
}
