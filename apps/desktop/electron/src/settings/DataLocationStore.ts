import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { writeJsonAtomically } from '../windows/DebouncedAtomicJsonWriter.js'
import type {
  DesktopDataLocationChange,
  DesktopDataLocationState,
} from '@pidex/shared/desktop-data-location-ipc'

const FILE_NAME = 'data-location.json'

type PendingDataLocation = {
  operationId: string
  sourceDataDir: string
  targetDataDir: string
}

type DataLocationBootstrap = {
  version: 1
  activeDataDir: string | null
  pending?: PendingDataLocation
}

export type DataLocationLaunch = {
  dataDir: string
  relocation: PendingDataLocation | null
}

export class DataLocationStore {
  readonly #filePath: string
  readonly #defaultDataDir: string
  readonly #environmentDataDir: string | null
  #value: DataLocationBootstrap | null = null

  constructor(
    userDataDirectory: string,
    defaultDataDir: string,
    environmentDataDir: string | null,
  ) {
    this.#filePath = join(resolve(userDataDirectory), FILE_NAME)
    this.#defaultDataDir = resolve(defaultDataDir)
    this.#environmentDataDir = environmentDataDir ? resolve(environmentDataDir) : null
  }

  async load(): Promise<void> {
    if (this.#value) return
    try {
      const parsed = JSON.parse(
        await readFile(this.#filePath, 'utf8'),
      ) as Partial<DataLocationBootstrap>
      this.#value = normalizeBootstrap(parsed)
    } catch {
      this.#value = { version: 1, activeDataDir: null }
    }
  }

  async state(): Promise<DesktopDataLocationState> {
    await this.load()
    const value = this.#value!
    const activeDataDir = value.activeDataDir ?? this.#defaultDataDir
    return {
      defaultDataDir: this.#defaultDataDir,
      currentDataDir: this.#environmentDataDir ?? activeDataDir,
      pendingDataDir: this.#environmentDataDir ? null : (value.pending?.targetDataDir ?? null),
      controlSource: this.#environmentDataDir
        ? 'env'
        : value.activeDataDir
          ? 'bootstrap'
          : 'default',
      isEnvControlled: this.#environmentDataDir !== null,
    }
  }

  async launch(): Promise<DataLocationLaunch> {
    await this.load()
    if (this.#environmentDataDir) {
      return { dataDir: this.#environmentDataDir, relocation: null }
    }
    const value = this.#value!
    if (value.pending) {
      return {
        dataDir: value.pending.targetDataDir,
        relocation: value.pending,
      }
    }
    return {
      dataDir: value.activeDataDir ?? this.#defaultDataDir,
      relocation: null,
    }
  }

  async schedule(
    selectedParent: string,
    installDirectory: string,
    workspaceRoots: readonly string[] = [],
  ): Promise<DesktopDataLocationChange> {
    await this.load()
    if (this.#environmentDataDir) {
      throw new Error('当前数据目录由 PIDEX_DATA_DIR 控制')
    }
    const parent = requireLocalAbsolutePath(selectedParent)
    if (basename(parent).toLowerCase() === '.pidex') {
      throw new Error('请选择 .pidex 的父目录')
    }
    const targetDataDir = resolve(parent, '.pidex')
    const sourceDataDir = this.#value!.activeDataDir ?? this.#defaultDataDir
    if (samePath(sourceDataDir, targetDataDir)) {
      throw new Error('所选位置就是当前数据目录')
    }
    if (
      pathsOverlap(targetDataDir, installDirectory) ||
      pathsOverlap(targetDataDir, sourceDataDir)
    ) {
      throw new Error('目标目录不能位于安装目录或当前数据目录内')
    }
    if (workspaceRoots.some((workspaceRoot) => pathsOverlap(targetDataDir, workspaceRoot))) {
      throw new Error('目标数据目录不能与已注册工作区互相包含')
    }
    if ((await pathExists(targetDataDir)) && !(await isEmptyDirectory(targetDataDir))) {
      throw new Error('目标 .pidex 目录必须为空')
    }
    const pending = {
      operationId: randomUUID(),
      sourceDataDir: resolve(sourceDataDir),
      targetDataDir,
    }
    this.#value = {
      ...this.#value!,
      pending,
    }
    await this.#save()
    return {
      sourceDataDir: pending.sourceDataDir,
      targetDataDir: pending.targetDataDir,
      restartScheduled: true,
    }
  }

  async promotePending(): Promise<void> {
    await this.load()
    const pending = this.#value!.pending
    if (!pending || this.#environmentDataDir) return
    this.#value = {
      version: 1,
      activeDataDir: pending.targetDataDir,
    }
    await this.#save()
  }

  async restoreActive(): Promise<void> {
    await this.load()
    if (!this.#value!.pending) return
    this.#value = {
      version: 1,
      activeDataDir: this.#value!.activeDataDir,
    }
    await this.#save()
  }

  async #save(): Promise<void> {
    await writeJsonAtomically(this.#filePath, this.#value)
  }
}

function normalizeBootstrap(value: Partial<DataLocationBootstrap>): DataLocationBootstrap {
  if (value.version !== 1) return { version: 1, activeDataDir: null }
  const activeDataDir =
    typeof value.activeDataDir === 'string' ? requireLocalAbsolutePath(value.activeDataDir) : null
  const pending = normalizePending(value.pending)
  return {
    version: 1,
    activeDataDir,
    ...(pending ? { pending } : {}),
  }
}

function normalizePending(value: unknown): PendingDataLocation | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<PendingDataLocation>
  if (
    typeof candidate.operationId !== 'string' ||
    !/^[a-zA-Z0-9-]{8,128}$/.test(candidate.operationId) ||
    typeof candidate.sourceDataDir !== 'string' ||
    typeof candidate.targetDataDir !== 'string'
  )
    return null
  return {
    operationId: candidate.operationId,
    sourceDataDir: requireLocalAbsolutePath(candidate.sourceDataDir),
    targetDataDir: requireLocalAbsolutePath(candidate.targetDataDir),
  }
}

function requireLocalAbsolutePath(value: string): string {
  const normalized = resolve(value)
  if (!isAbsolute(value) || value.startsWith('\\\\')) {
    throw new Error('数据目录必须是本地绝对路径')
  }
  return normalized
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right)
}

function pathsOverlap(left: string, right: string): boolean {
  return isWithin(left, right) || isWithin(right, left)
}

function isWithin(parent: string, child: string): boolean {
  const relation = relative(resolve(parent), resolve(child))
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`))
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch(() => false)
}

async function isEmptyDirectory(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length === 0
  } catch {
    return false
  }
}
