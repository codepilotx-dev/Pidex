import { createHash, randomUUID } from 'node:crypto'
import {
  constants,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const MARKER_FILE_NAME = '.data-location-v1.json'
const PET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const DATABASE_NAMES = ['history.sqlite', 'profile.sqlite', 'agent.sqlite'] as const
const DATABASE_DIRECTORIES = ['attachments', 'subagent-isolation', 'workspaces'] as const
const RELOCATION_DIRECTORIES = [
  'attachments',
  'pets',
  'skills',
  'tooling',
  'workspaces',
  'logs',
  'speech',
] as const
const RELOCATION_FILES = [
  'models.cache.json',
  'pi-models.cache.json',
  'hooks.json',
  '.data-location-v1.json',
] as const
const RELOCATION_MARKER_FILE_NAME = '.data-location-v2.json'
const OPERATION_ID_PATTERN = /^[a-zA-Z0-9-]{8,128}$/

type MigrationMarker = {
  version: 1
  completedSources: string[]
  pendingSource?: {
    id: string
    copyDatabase: boolean
  }
}

export type DataDirectoryMigrationInput = {
  dataDir: string
  legacyDataDir: string | null
  legacyPetsDir: string | null
}

export type DataRootRelocationInput = {
  sourceDir: string
  targetDir: string
  operationId: string
}

export async function relocateAgentDataRoot(input: DataRootRelocationInput): Promise<void> {
  if (!OPERATION_ID_PATTERN.test(input.operationId)) {
    throw new Error('数据目录迁移操作 ID 无效')
  }
  const sourceRoot = resolve(input.sourceDir)
  const targetRoot = resolve(input.targetDir)
  if (samePath(sourceRoot, targetRoot)) return
  if (isWithin(sourceRoot, targetRoot) || isWithin(targetRoot, sourceRoot)) {
    throw new Error('新旧数据目录不能互相包含')
  }
  if (!(await isDirectory(sourceRoot))) {
    throw new Error('原用户数据目录不存在')
  }
  if (await relocationAlreadyPublished(targetRoot, input.operationId)) return
  if (await pathExists(targetRoot)) {
    if (!(await isEmptyDirectory(targetRoot))) {
      throw new Error('目标用户数据目录不是空目录')
    }
    await rmdir(targetRoot)
  }

  const stagingRoot = join(
    dirname(targetRoot),
    `.${basename(targetRoot)}.migration-${input.operationId}`,
  )
  if (!isAbsolute(stagingRoot)) throw new Error('迁移暂存目录无效')
  await rm(stagingRoot, { recursive: true, force: true })
  try {
    await mkdir(stagingRoot, { recursive: false })
    for (const name of ['history.sqlite', 'profile.sqlite'] as const) {
      await migrateDatabaseGroup(sourceRoot, stagingRoot, name)
    }
    for (const name of RELOCATION_DIRECTORIES) {
      await copyTreeIfMissing(join(sourceRoot, name), join(stagingRoot, name))
    }
    for (const name of RELOCATION_FILES) {
      await copyFileIfMissing(join(sourceRoot, name), join(stagingRoot, name))
    }
    await writeFile(
      join(stagingRoot, RELOCATION_MARKER_FILE_NAME),
      `${JSON.stringify(
        {
          version: 2,
          operation: operationHash(input.operationId),
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    await rename(stagingRoot, targetRoot)
  } catch (cause) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
    throw cause
  }
}

export async function migrateLegacyAgentData(input: DataDirectoryMigrationInput): Promise<void> {
  const targetRoot = resolve(input.dataDir)
  await mkdir(targetRoot, { recursive: true })
  let marker = await readMarker(targetRoot)
  const completed = new Set(marker.completedSources)

  const sources = [
    ...(input.legacyDataDir ? [{ kind: 'data' as const, path: resolve(input.legacyDataDir) }] : []),
    ...(input.legacyPetsDir ? [{ kind: 'pets' as const, path: resolve(input.legacyPetsDir) }] : []),
  ]

  for (const source of sources) {
    const destination = source.kind === 'data' ? targetRoot : join(targetRoot, 'pets')
    if (samePath(source.path, destination)) continue
    const sourceID = identifySource(source.kind, source.path)
    if (completed.has(sourceID) || !(await isDirectory(source.path))) continue
    try {
      const copyDatabase =
        marker.pendingSource?.id === sourceID
          ? marker.pendingSource.copyDatabase
          : source.kind === 'data' && !(await targetHasDatabase(targetRoot))
      marker = {
        version: 1,
        completedSources: [...completed],
        pendingSource: { id: sourceID, copyDatabase },
      }
      await writeMarker(targetRoot, marker)
      if (source.kind === 'data') {
        await migrateDataRoot(source.path, targetRoot, copyDatabase)
      } else {
        await migratePets(source.path, join(targetRoot, 'pets'))
      }
      completed.add(sourceID)
      marker = {
        version: 1,
        completedSources: [...completed],
      }
      await writeMarker(targetRoot, marker)
    } catch {
      throw new Error('Pidex 用户数据迁移失败，请检查目录权限和磁盘空间')
    }
  }
}

async function migrateDataRoot(sourceRoot: string, targetRoot: string, copyDatabase: boolean) {
  if (copyDatabase) {
    for (const name of DATABASE_NAMES) {
      await migrateDatabaseGroup(sourceRoot, targetRoot, name)
    }
    for (const name of DATABASE_DIRECTORIES) {
      await copyTreeIfMissing(join(sourceRoot, name), join(targetRoot, name))
    }
  }

  await copyFileIfMissing(
    join(sourceRoot, 'models.cache.json'),
    join(targetRoot, 'models.cache.json'),
  )
  await copyFileIfMissing(
    join(sourceRoot, 'pi-models.cache.json'),
    join(targetRoot, 'pi-models.cache.json'),
  )
  await migratePets(join(sourceRoot, 'pets'), join(targetRoot, 'pets'))
  await migrateAgentLogs(join(sourceRoot, 'logs'), join(targetRoot, 'logs'))
  await copyTreeIfMissing(join(sourceRoot, 'speech'), join(targetRoot, 'speech'))
}

async function migrateDatabaseGroup(sourceRoot: string, targetRoot: string, name: string) {
  const sourceMain = join(sourceRoot, name)
  const targetMain = join(targetRoot, name)
  if (!(await isFile(sourceMain)) || (await pathExists(targetMain))) return

  for (const suffix of ['-wal', '-shm']) {
    await copyFileIfMissing(`${sourceMain}${suffix}`, `${targetMain}${suffix}`)
  }
  await copyFileIfMissing(sourceMain, targetMain)
}

async function migratePets(sourceRoot: string, targetRoot: string) {
  if (!(await isDirectory(sourceRoot))) return
  await mkdir(targetRoot, { recursive: true })
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    const source = checkedChild(sourceRoot, entry.name)
    const target = checkedChild(targetRoot, entry.name)
    if (
      entry.isDirectory() &&
      PET_ID_PATTERN.test(entry.name) &&
      (await isFile(join(source, 'pet.json')))
    ) {
      await copyTreeIfMissing(source, target)
    } else if (entry.isFile() && entry.name === '.catalog-cache.json') {
      await copyFileIfMissing(source, target)
    }
  }
}

async function migrateAgentLogs(sourceRoot: string, targetRoot: string) {
  if (!(await isDirectory(sourceRoot))) return
  await mkdir(targetRoot, { recursive: true })
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/^agent(?:\.\d+)?\.jsonl$/.test(entry.name)) {
      continue
    }
    await copyFileIfMissing(
      checkedChild(sourceRoot, entry.name),
      checkedChild(targetRoot, entry.name),
    )
  }
}

async function copyTreeIfMissing(source: string, target: string) {
  if (!(await isDirectory(source)) || (await pathExists(target))) return
  const temporary = join(resolve(target, '..'), `.${basename(target)}.migration-${randomUUID()}`)
  try {
    await copyTree(source, temporary)
    await rename(temporary, target)
  } catch (cause) {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
    if (await pathExists(target)) return
    throw cause
  }
}

async function copyTree(sourceRoot: string, targetRoot: string): Promise<void> {
  await mkdir(targetRoot, { recursive: true })
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    const source = checkedChild(sourceRoot, entry.name)
    const target = checkedChild(targetRoot, entry.name)
    if (entry.isDirectory()) {
      await copyTree(source, target)
    } else if (entry.isFile()) {
      await copyFile(source, target, constants.COPYFILE_EXCL)
    }
  }
}

async function copyFileIfMissing(source: string, target: string) {
  if (!(await isFile(source)) || (await pathExists(target))) return
  await mkdir(resolve(target, '..'), { recursive: true })
  const temporary = `${target}.migration-${randomUUID()}`
  try {
    await copyFile(source, temporary, constants.COPYFILE_EXCL)
    await rename(temporary, target)
  } catch (cause) {
    await rm(temporary, { force: true }).catch(() => undefined)
    if (await pathExists(target)) return
    throw cause
  }
}

async function readMarker(targetRoot: string): Promise<MigrationMarker> {
  try {
    const value = JSON.parse(
      await readFile(join(targetRoot, MARKER_FILE_NAME), 'utf8'),
    ) as Partial<MigrationMarker>
    if (
      value.version === 1 &&
      Array.isArray(value.completedSources) &&
      value.completedSources.every((item) => typeof item === 'string')
    ) {
      return {
        version: 1,
        completedSources: [...new Set(value.completedSources)],
        ...(isPendingSource(value.pendingSource) ? { pendingSource: value.pendingSource } : {}),
      }
    }
  } catch {
    // Missing and damaged markers are retried without touching source data.
  }
  return { version: 1, completedSources: [] }
}

async function writeMarker(targetRoot: string, marker: MigrationMarker) {
  const target = join(targetRoot, MARKER_FILE_NAME)
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
  try {
    await rename(temporary, target)
  } catch (cause) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw cause
  }
}

function identifySource(kind: 'data' | 'pets', path: string): string {
  const normalized = process.platform === 'win32' ? path.toLowerCase() : path
  return createHash('sha256').update(`${kind}\0${normalized}`).digest('hex')
}

function checkedChild(root: string, name: string): string {
  const child = resolve(root, name)
  const relation = relative(resolve(root), child)
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`)) {
    throw new Error('迁移路径越界')
  }
  return child
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function isWithin(parent: string, child: string): boolean {
  const relation = relative(resolve(parent), resolve(child))
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`))
}

function operationHash(operationId: string): string {
  return createHash('sha256').update(operationId).digest('hex')
}

async function relocationAlreadyPublished(
  targetRoot: string,
  operationId: string,
): Promise<boolean> {
  try {
    const value = JSON.parse(
      await readFile(join(targetRoot, RELOCATION_MARKER_FILE_NAME), 'utf8'),
    ) as { version?: unknown; operation?: unknown }
    return value.version === 2 && value.operation === operationHash(operationId)
  } catch {
    return false
  }
}

async function isEmptyDirectory(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length === 0
  } catch {
    return false
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (cause) {
    return !isMissing(cause)
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory()
  } catch {
    return false
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile()
  } catch {
    return false
  }
}

async function anyExists(paths: readonly string[]): Promise<boolean> {
  for (const path of paths) {
    if (await pathExists(path)) return true
  }
  return false
}

async function targetHasDatabase(targetRoot: string): Promise<boolean> {
  return anyExists(DATABASE_NAMES.map((name) => join(targetRoot, name)))
}

function isPendingSource(value: unknown): value is NonNullable<MigrationMarker['pendingSource']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string' && typeof candidate.copyDatabase === 'boolean'
}

function isMissing(cause: unknown): boolean {
  return cause instanceof Error && 'code' in cause && cause.code === 'ENOENT'
}
