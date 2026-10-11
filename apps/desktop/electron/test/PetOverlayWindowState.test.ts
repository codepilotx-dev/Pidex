import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createDefaultPetOverlayWindowState,
  normalizePetOverlayWindowState,
  PetOverlayWindowStateStore,
} from '../src/windows/PetOverlayWindowState.js'

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1080 }
const SECONDARY = { x: 1920, y: 0, width: 1280, height: 1024 }
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('pet overlay window state', () => {
  test('anchors the default overlay to the primary bottom-right margin', () => {
    expect(createDefaultPetOverlayWindowState(PRIMARY)).toEqual({
      version: 1,
      bounds: { x: 1540, y: 736, width: 356, height: 320 },
    })
  })

  test('restores on a secondary display and clamps off-screen bounds', () => {
    expect(
      normalizePetOverlayWindowState(
        {
          version: 1,
          bounds: { x: 3000, y: 900, width: 356, height: 320 },
        },
        [PRIMARY, SECONDARY],
        PRIMARY,
      ),
    ).toEqual({
      version: 1,
      bounds: { x: 2844, y: 704, width: 356, height: 320 },
    })
  })

  test('recovers a fully disconnected display to primary', () => {
    expect(
      normalizePetOverlayWindowState(
        {
          version: 1,
          bounds: { x: 9000, y: -4000, width: 356, height: 320 },
        },
        [PRIMARY],
        PRIMARY,
      ),
    ).toEqual(createDefaultPetOverlayWindowState(PRIMARY))
  })

  test('atomically flushes only the latest debounced bounds', async () => {
    const directory = await createTemporaryDirectory()
    const store = new PetOverlayWindowStateStore(directory)
    store.scheduleSave({
      version: 1,
      bounds: { x: 100, y: 100, width: 356, height: 320 },
    })
    const latest = {
      version: 1 as const,
      bounds: { x: 300, y: 240, width: 356, height: 320 },
    }
    store.scheduleSave(latest)
    await store.flush()

    expect(JSON.parse(await readFile(store.filePath, 'utf8'))).toEqual(latest)
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  test('uses the safe default for corrupt persisted JSON', async () => {
    const directory = await createTemporaryDirectory()
    const store = new PetOverlayWindowStateStore(directory)
    await writeFile(store.filePath, '{not-json', 'utf8')

    expect(await store.load([PRIMARY], PRIMARY)).toEqual(
      createDefaultPetOverlayWindowState(PRIMARY),
    )
  })
})

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'pidex-pet-overlay-'))
  temporaryDirectories.push(directory)
  return directory
}
