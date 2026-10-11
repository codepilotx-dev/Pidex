import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { AgentError } from '../Domain'

type GitOutput = (cwd: string, args: readonly string[]) => Promise<string>

const contained = (root: string, path: string) => {
  const value = relative(root, path)
  return value === '' || (!value.startsWith('..') && !isAbsolute(value))
}

const splitZero = (value: string) =>
  value
    .split('\0')
    .filter(Boolean)
    .map((path) => path.replaceAll('\\', '/'))

const safeSegments = (relativePath: string) => {
  if (!relativePath || relativePath.includes('\0') || isAbsolute(relativePath)) return false
  return !relativePath
    .split('/')
    .some((segment) => segment === '' || segment === '.' || segment === '..')
}

const hasUnsafeNode = async (root: string, relativePath: string, includeLeaf: boolean) => {
  const segments = relativePath.split('/')
  const count = includeLeaf ? segments.length : segments.length - 1
  let cursor = root
  for (let index = 0; index < count; index += 1) {
    cursor = resolve(cursor, segments[index]!)
    const metadata = await lstat(cursor).catch((cause: NodeJS.ErrnoException) =>
      cause.code === 'ENOENT' ? null : Promise.reject(cause),
    )
    if (metadata?.isSymbolicLink()) return true
    if (metadata && index < count - 1 && !metadata.isDirectory()) return true
  }
  return false
}

/** Copies only explicitly selected ignored/untracked regular files into a managed destination. */
export class WorktreeIncludeService {
  constructor(private readonly gitOutput: GitOutput) {}

  private async roots(sourceRootInput: string, targetRootInput: string) {
    const sourceRoot = await realpath(sourceRootInput)
    const targetRoot = await realpath(targetRootInput)
    const [sourceMeta, targetMeta] = await Promise.all([lstat(sourceRoot), lstat(targetRoot)])
    if (
      !sourceMeta.isDirectory() ||
      sourceMeta.isSymbolicLink() ||
      !targetMeta.isDirectory() ||
      targetMeta.isSymbolicLink()
    ) {
      throw new AgentError('WORKTREE_PATH_UNSAFE', 'worktree 文件复制边界不是普通目录', 409)
    }
    return { sourceRoot, targetRoot }
  }

  async copy(sourceRootInput: string, targetRootInput: string) {
    const { sourceRoot, targetRoot } = await this.roots(sourceRootInput, targetRootInput)

    const ignored = new Set(
      splitZero(
        await this.gitOutput(sourceRoot, [
          'ls-files',
          '--others',
          '--ignored',
          '--exclude-standard',
          '-z',
        ]),
      ),
    )
    const untracked = new Set(
      splitZero(
        await this.gitOutput(sourceRoot, ['ls-files', '--others', '--exclude-standard', '-z']),
      ),
    )
    const includeExists = await lstat(resolve(sourceRoot, '.worktreeinclude'))
      .then((metadata) => metadata.isFile() && !metadata.isSymbolicLink())
      .catch((cause: NodeJS.ErrnoException) =>
        cause.code === 'ENOENT' ? false : Promise.reject(cause),
      )
    const selectedByPattern = includeExists
      ? new Set(
          splitZero(
            await this.gitOutput(sourceRoot, [
              'ls-files',
              '--others',
              '--ignored',
              '--exclude-from=.worktreeinclude',
              '-z',
            ]),
          ),
        )
      : new Set<string>()
    const selected = new Set<string>()
    for (const path of [...ignored, ...untracked]) {
      if (!safeSegments(path)) continue
      if (
        selectedByPattern.has(path) ||
        (ignored.has(path) && basename(path).toLocaleLowerCase('en-US') === 'agents.override.md')
      ) {
        selected.add(path)
      }
    }

    return this.copyRegularFiles(sourceRoot, targetRoot, [...selected])
  }

  async copyRegularFiles(
    sourceRootInput: string,
    targetRootInput: string,
    inputPaths: readonly string[],
  ) {
    const { sourceRoot, targetRoot } = await this.roots(sourceRootInput, targetRootInput)
    const paths = [...new Set(inputPaths)].filter(safeSegments).sort()
    let copied = 0
    let skipped = 0
    const copiedPaths: string[] = []
    for (let offset = 0; offset < paths.length; offset += 16) {
      await Promise.all(
        paths.slice(offset, offset + 16).map(async (relativePath) => {
          const source = resolve(sourceRoot, relativePath)
          const target = resolve(targetRoot, relativePath)
          if (!contained(sourceRoot, source) || !contained(targetRoot, target)) {
            throw new AgentError('WORKTREE_PATH_DENIED', 'worktree include 路径越界', 403)
          }
          if (await hasUnsafeNode(sourceRoot, relativePath, true)) {
            skipped += 1
            return
          }
          const metadata = await lstat(source)
          if (!metadata.isFile()) {
            skipped += 1
            return
          }
          if (await hasUnsafeNode(targetRoot, relativePath, false)) {
            skipped += 1
            return
          }
          await mkdir(dirname(target), { recursive: true })
          if (await hasUnsafeNode(targetRoot, relativePath, false)) {
            skipped += 1
            return
          }
          try {
            await copyFile(source, target, constants.COPYFILE_EXCL)
            copied += 1
            copiedPaths.push(relativePath)
          } catch (cause) {
            if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
              skipped += 1
              return
            }
            throw cause
          }
        }),
      )
    }
    return { copied, skipped, paths: copiedPaths.sort() }
  }

  async preflightRegularFiles(
    sourceRootInput: string,
    targetRootInput: string,
    inputPaths: readonly string[],
  ) {
    const { sourceRoot, targetRoot } = await this.roots(sourceRootInput, targetRootInput)
    const unique = [...new Set(inputPaths)].sort()
    const paths: string[] = []
    let skipped = 0
    for (const relativePath of unique) {
      if (!safeSegments(relativePath)) {
        skipped += 1
        continue
      }
      const source = resolve(sourceRoot, relativePath)
      const target = resolve(targetRoot, relativePath)
      if (!contained(sourceRoot, source) || !contained(targetRoot, target)) {
        throw new AgentError('WORKTREE_PATH_DENIED', 'worktree include 路径越界', 403)
      }
      if (await hasUnsafeNode(sourceRoot, relativePath, true)) {
        skipped += 1
        continue
      }
      const metadata = await lstat(source).catch((cause: NodeJS.ErrnoException) =>
        cause.code === 'ENOENT' ? null : Promise.reject(cause),
      )
      if (!metadata?.isFile() || metadata.isSymbolicLink()) {
        skipped += 1
        continue
      }
      if (await hasUnsafeNode(targetRoot, relativePath, false)) {
        skipped += 1
        continue
      }
      const targetMetadata = await lstat(target).catch((cause: NodeJS.ErrnoException) =>
        cause.code === 'ENOENT' ? null : Promise.reject(cause),
      )
      if (targetMetadata) {
        skipped += 1
        continue
      }
      paths.push(relativePath)
    }
    return { ready: skipped === 0, skipped, paths }
  }
}
