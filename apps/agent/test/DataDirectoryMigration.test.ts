import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { migrateLegacyAgentData, relocateAgentDataRoot } from '../src/config/DataDirectoryMigration'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await removeFixturePaths(temporaryDirectories.splice(0))
})

describe('legacy Agent data migration', () => {
  test('copies only active data, preserves conflicts and never deletes the source', async () => {
    const root = await temporaryRoot()
    const source = join(root, 'legacy')
    const formerCodexPets = join(root, 'codex-home', 'pets')
    const target = join(root, 'current')
    await Promise.all([
      mkdir(join(source, 'pets', 'old-pet'), { recursive: true }),
      mkdir(join(source, 'pets', 'same-pet'), { recursive: true }),
      mkdir(join(formerCodexPets, 'codex-pet'), { recursive: true }),
      mkdir(join(source, 'attachments'), { recursive: true }),
      mkdir(join(source, 'logs'), { recursive: true }),
      mkdir(join(source, 'skills'), { recursive: true }),
      mkdir(join(target, 'pets', 'same-pet'), { recursive: true }),
      mkdir(join(target, 'tooling'), { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(source, 'history.sqlite'), 'history'),
      writeFile(join(source, 'history.sqlite-wal'), 'wal'),
      writeFile(join(source, 'history.sqlite-shm'), 'shm'),
      writeFile(join(source, 'models.cache.json'), 'models'),
      writeFile(join(source, 'pi-models.cache.json'), 'pi-models'),
      writeFile(join(source, 'agent.pre-v17.sqlite'), 'backup'),
      writeFile(join(source, 'hooks.json'), 'project config'),
      writeFile(join(source, 'pets', 'old-pet', 'pet.json'), 'old pet'),
      writeFile(join(source, 'pets', 'same-pet', 'pet.json'), 'legacy pet'),
      writeFile(join(formerCodexPets, 'codex-pet', 'pet.json'), 'codex pet'),
      writeFile(join(source, 'attachments', 'attachment.bin'), 'attachment'),
      writeFile(join(source, 'logs', 'agent.jsonl'), 'log'),
      writeFile(join(source, 'logs', 'desktop.log'), 'desktop'),
      writeFile(join(target, 'pets', 'same-pet', 'pet.json'), 'current pet'),
    ])

    await migrateLegacyAgentData({
      dataDir: target,
      legacyDataDir: source,
      legacyPetsDir: formerCodexPets,
    })

    expect(await readText(join(target, 'history.sqlite'))).toBe('history')
    expect(await readText(join(target, 'history.sqlite-wal'))).toBe('wal')
    expect(await readText(join(target, 'history.sqlite-shm'))).toBe('shm')
    expect(await readText(join(target, 'models.cache.json'))).toBe('models')
    expect(await readText(join(target, 'pi-models.cache.json'))).toBe('pi-models')
    expect(await readText(join(target, 'pets', 'old-pet', 'pet.json'))).toBe('old pet')
    expect(await readText(join(target, 'pets', 'same-pet', 'pet.json'))).toBe('current pet')
    expect(await readText(join(target, 'pets', 'codex-pet', 'pet.json'))).toBe('codex pet')
    expect(await readText(join(target, 'attachments', 'attachment.bin'))).toBe('attachment')
    expect(await readText(join(target, 'logs', 'agent.jsonl'))).toBe('log')
    expect(await readText(join(target, 'agent.pre-v17.sqlite'))).toBeNull()
    expect(await readText(join(target, 'hooks.json'))).toBeNull()
    expect(await readText(join(target, 'skills'))).toBeNull()
    expect(await readText(join(target, 'logs', 'desktop.log'))).toBeNull()
    expect(await readText(join(source, 'history.sqlite'))).toBe('history')

    await rm(join(target, 'pets', 'old-pet'), {
      recursive: true,
      force: true,
    })
    await migrateLegacyAgentData({
      dataDir: target,
      legacyDataDir: source,
      legacyPetsDir: formerCodexPets,
    })
    expect(await readText(join(target, 'pets', 'old-pet', 'pet.json'))).toBeNull()
  })

  test('does not combine database-coupled files with an existing target database', async () => {
    const root = await temporaryRoot()
    const source = join(root, 'legacy')
    const target = join(root, 'current')
    await Promise.all([
      mkdir(join(source, 'attachments'), { recursive: true }),
      mkdir(target, { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(source, 'profile.sqlite'), 'legacy profile'),
      writeFile(join(source, 'attachments', 'attachment.bin'), 'legacy attachment'),
      writeFile(join(target, 'history.sqlite'), 'current history'),
    ])

    await migrateLegacyAgentData({
      dataDir: target,
      legacyDataDir: source,
      legacyPetsDir: null,
    })

    expect(await readText(join(target, 'history.sqlite'))).toBe('current history')
    expect(await readText(join(target, 'profile.sqlite'))).toBeNull()
    expect(await readText(join(target, 'attachments', 'attachment.bin'))).toBeNull()
  })

  test('resumes an interrupted database publication before marking the source complete', async () => {
    const root = await temporaryRoot()
    const source = join(root, 'legacy')
    const target = join(root, 'current')
    await Promise.all([mkdir(source, { recursive: true }), mkdir(target, { recursive: true })])
    await Promise.all([
      writeFile(join(source, 'history.sqlite'), 'source history'),
      writeFile(join(source, 'profile.sqlite'), 'source profile'),
      writeFile(join(target, 'history.sqlite'), 'already published'),
      writeFile(
        join(target, '.data-location-v1.json'),
        JSON.stringify({
          version: 1,
          completedSources: [],
          pendingSource: {
            id: sourceID('data', source),
            copyDatabase: true,
          },
        }),
      ),
    ])

    await migrateLegacyAgentData({
      dataDir: target,
      legacyDataDir: source,
      legacyPetsDir: null,
    })

    expect(await readText(join(target, 'history.sqlite'))).toBe('already published')
    expect(await readText(join(target, 'profile.sqlite'))).toBe('source profile')
  })

  test('imports only valid pet packages from the former CODEX_HOME pets directory', async () => {
    const root = await temporaryRoot()
    const sourcePets = join(root, 'codex-home', 'pets')
    const target = join(root, 'current')
    await Promise.all([
      mkdir(join(sourcePets, 'valid-pet'), { recursive: true }),
      mkdir(join(sourcePets, '.install-partial'), { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(sourcePets, 'valid-pet', 'pet.json'), 'pet'),
      writeFile(join(sourcePets, '.install-partial', 'pet.json'), 'partial'),
    ])

    await migrateLegacyAgentData({
      dataDir: target,
      legacyDataDir: null,
      legacyPetsDir: sourcePets,
    })

    expect(await readText(join(target, 'pets', 'valid-pet', 'pet.json'))).toBe('pet')
    expect(await readText(join(target, 'pets', '.install-partial', 'pet.json'))).toBeNull()
  })
})

describe('active Agent data relocation', () => {
  test('publishes the owned data atomically and preserves the source', async () => {
    const root = await temporaryRoot()
    const source = join(root, 'source', '.pidex')
    const target = join(root, 'target', '.pidex')
    await Promise.all([
      mkdir(join(source, 'skills', 'demo'), { recursive: true }),
      mkdir(join(source, 'tooling', 'nodejs'), { recursive: true }),
      mkdir(join(source, 'pets', 'pet'), { recursive: true }),
      mkdir(join(target, '..'), { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(source, 'history.sqlite'), 'history'),
      writeFile(join(source, 'history.sqlite-wal'), 'wal'),
      writeFile(join(source, 'profile.sqlite'), 'profile'),
      writeFile(join(source, 'hooks.json'), '{}'),
      writeFile(join(source, 'pi-models.cache.json'), 'pi-models'),
      writeFile(join(source, 'skills', 'demo', 'SKILL.md'), 'skill'),
      writeFile(join(source, 'tooling', 'nodejs', 'node.exe'), 'node'),
      writeFile(join(source, 'pets', 'pet', 'pet.json'), 'pet'),
      writeFile(join(source, 'unowned.txt'), 'skip'),
    ])

    await relocateAgentDataRoot({
      sourceDir: source,
      targetDir: target,
      operationId: 'relocation-test-0001',
    })

    expect(await readText(join(target, 'history.sqlite'))).toBe('history')
    expect(await readText(join(target, 'history.sqlite-wal'))).toBe('wal')
    expect(await readText(join(target, 'profile.sqlite'))).toBe('profile')
    expect(await readText(join(target, 'hooks.json'))).toBe('{}')
    expect(await readText(join(target, 'pi-models.cache.json'))).toBe('pi-models')
    expect(await readText(join(target, 'skills', 'demo', 'SKILL.md'))).toBe('skill')
    expect(await readText(join(target, 'tooling', 'nodejs', 'node.exe'))).toBe('node')
    expect(await readText(join(target, 'unowned.txt'))).toBeNull()
    expect(await readText(join(source, 'history.sqlite'))).toBe('history')

    await relocateAgentDataRoot({
      sourceDir: source,
      targetDir: target,
      operationId: 'relocation-test-0001',
    })
    expect(await readText(join(target, 'history.sqlite'))).toBe('history')
  })
})

async function temporaryRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'pidex-data-migration-'))
  temporaryDirectories.push(path)
  return path
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

function sourceID(kind: 'data' | 'pets', path: string): string {
  const normalized = process.platform === 'win32' ? path.toLowerCase() : path
  return createHash('sha256').update(`${kind}\0${normalized}`).digest('hex')
}
