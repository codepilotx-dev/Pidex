import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { AgentError } from '../Domain'
import { WorkspaceIsolationService } from '../subagent/WorkspaceIsolationService'
import { WorktreeIncludeService } from './WorktreeIncludeService'
import { hasWindowsDeviceName, windowsWorktreeFiles } from './WindowsWorktreeFiles'

type SnapshotManifest = {
  version: 1
  headCommit: string
  files: string[]
}

const contained = (root: string, path: string) => {
  const value = relative(root, path)
  return value === '' || (!value.startsWith('..') && !isAbsolute(value))
}

export type WorktreeRestoreSnapshot = {
  root: string
  headCommit: string
  stagedPatch: string
  unstagedPatch: string
  filesRoot: string
  files: readonly string[]
}

/** Permission-restricted, layered recovery snapshot; command/env/output never enter it. */
export class WorktreeRestoreSnapshotStore {
  constructor(
    private readonly snapshotsRoot: string,
    private readonly include: WorktreeIncludeService,
    private readonly id: () => string = randomUUID,
  ) {}

  async capture(worktreeId: string, workspacePath: string) {
    await mkdir(this.snapshotsRoot, { recursive: true, mode: 0o700 })
    const snapshotsRoot = await realpath(this.snapshotsRoot)
    const root = resolve(snapshotsRoot, `${worktreeId}-${this.id()}`)
    if (!contained(snapshotsRoot, root))
      throw new AgentError('WORKTREE_PATH_DENIED', '恢复快照路径越界', 403)
    await mkdir(root, { mode: 0o700 })
    const filesRoot = resolve(root, 'files')
    await mkdir(filesRoot, { mode: 0o700 })
    const temporary = await mkdtemp(join(tmpdir(), 'pidex-worktree-snapshot-'))
    try {
      const isolation = await WorkspaceIsolationService.open(workspacePath, temporary)
      const layers = await isolation.captureWorkingTreeLayers()
      await writeFile(resolve(root, 'staged.patch'), layers.stagedPatch, {
        encoding: 'utf8',
        mode: 0o600,
      })
      await writeFile(resolve(root, 'unstaged.patch'), layers.unstagedPatch, {
        encoding: 'utf8',
        mode: 0o600,
      })
      const regular = await this.include.copyUntracked(workspacePath, filesRoot)
      const included = await this.include.copy(workspacePath, filesRoot)
      const files = [...new Set([...regular.paths, ...included.paths])].sort()
      const manifest: SnapshotManifest = { version: 1, headCommit: layers.headCommit, files }
      await writeFile(resolve(root, 'manifest.json'), JSON.stringify(manifest), {
        encoding: 'utf8',
        mode: 0o600,
      })
      return root
    } catch (cause) {
      await rm(root, { recursive: true, force: true })
      throw cause
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }

  async preserveWindowsDeviceFiles(snapshotRoot: string, workspacePath: string) {
    if (process.platform !== 'win32') return
    const snapshot = await this.read(snapshotRoot)
    const pending = [workspacePath]
    const files: string[] = []
    while (pending.length) {
      const directory = pending.pop()!
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue
        const path = join(directory, entry.name)
        if (entry.isDirectory()) pending.push(path)
        else if (entry.isFile() && hasWindowsDeviceName(path))
          files.push(relative(workspacePath, path).replaceAll('\\', '/'))
      }
    }
    for (const path of files) {
      await windowsWorktreeFiles({
        operation: 'preserve',
        source: resolve(workspacePath, path),
        target: resolve(snapshot.filesRoot, path),
      })
    }
    await writeFile(
      resolve(snapshot.root, 'manifest.json'),
      JSON.stringify({
        version: 1,
        headCommit: snapshot.headCommit,
        files: [...new Set([...snapshot.files, ...files])].sort(),
      }),
      { encoding: 'utf8', mode: 0o600 },
    )
  }

  async read(snapshotRootInput: string): Promise<WorktreeRestoreSnapshot> {
    const snapshotsRoot = await realpath(this.snapshotsRoot)
    const snapshotRoot = await realpath(snapshotRootInput)
    if (!contained(snapshotsRoot, snapshotRoot))
      throw new AgentError('WORKTREE_PATH_DENIED', '恢复快照路径越界', 403)
    const manifest = JSON.parse(
      await readFile(resolve(snapshotRoot, 'manifest.json'), 'utf8'),
    ) as SnapshotManifest
    if (
      manifest.version !== 1 ||
      typeof manifest.headCommit !== 'string' ||
      !Array.isArray(manifest.files)
    ) {
      throw new AgentError('WORKTREE_RESTORE_FAILED', '恢复快照格式无效', 409)
    }
    return {
      root: snapshotRoot,
      headCommit: manifest.headCommit,
      stagedPatch: await readFile(resolve(snapshotRoot, 'staged.patch'), 'utf8'),
      unstagedPatch: await readFile(resolve(snapshotRoot, 'unstaged.patch'), 'utf8'),
      filesRoot: await realpath(resolve(snapshotRoot, 'files')),
      files: manifest.files,
    }
  }
}
