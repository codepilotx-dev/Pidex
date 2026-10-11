import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createDefaultWindowState,
  normalizeWindowState,
  WindowStateStore,
} from '../src/windows/WindowState.js'

const PRIMARY_DISPLAY = { x: 0, y: 0, width: 1920, height: 1080 }
const SECONDARY_DISPLAY = { x: 1920, y: 0, width: 1280, height: 1024 }
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('window state', () => {
  test('centers the default window inside the primary work area', () => {
    expect(createDefaultWindowState(PRIMARY_DISPLAY)).toEqual({
      version: 1,
      bounds: { x: 240, y: 80, width: 1440, height: 920 },
      maximized: false,
      zoomPercent: 100,
    })
  })

  test('restores valid secondary-display bounds and clamps oversized windows', () => {
    expect(
      normalizeWindowState(
        {
          version: 1,
          bounds: { x: 2100, y: 80, width: 1600, height: 1200 },
          maximized: true,
          zoomPercent: 157,
        },
        [PRIMARY_DISPLAY, SECONDARY_DISPLAY],
        PRIMARY_DISPLAY,
      ),
    ).toEqual({
      version: 1,
      bounds: { x: 1920, y: 0, width: 1280, height: 1024 },
      maximized: true,
      zoomPercent: 160,
    })
  })

  test('moves a completely off-screen window back to the primary display', () => {
    expect(
      normalizeWindowState(
        {
          version: 1,
          bounds: { x: 9000, y: -4000, width: 1200, height: 800 },
          maximized: true,
        },
        [PRIMARY_DISPLAY],
        PRIMARY_DISPLAY,
      ),
    ).toEqual({
      version: 1,
      bounds: { x: 240, y: 80, width: 1440, height: 920 },
      maximized: true,
      zoomPercent: 100,
    })
  })

  test('falls back for malformed or unsupported documents', () => {
    const fallback = createDefaultWindowState(PRIMARY_DISPLAY)
    expect(normalizeWindowState(null, [], PRIMARY_DISPLAY)).toEqual(fallback)
    expect(
      normalizeWindowState(
        { version: 2, bounds: PRIMARY_DISPLAY, maximized: false },
        [PRIMARY_DISPLAY],
        PRIMARY_DISPLAY,
      ),
    ).toEqual(fallback)
    expect(
      normalizeWindowState(
        {
          version: 1,
          bounds: { x: 0, y: 0, width: Number.NaN, height: 800 },
          maximized: false,
        },
        [PRIMARY_DISPLAY],
        PRIMARY_DISPLAY,
      ),
    ).toEqual(fallback)
  })

  test('atomically flushes only the latest debounced state', async () => {
    const directory = await createTemporaryDirectory()
    const store = new WindowStateStore(directory)
    store.scheduleSave({
      version: 1,
      bounds: { x: 10, y: 20, width: 1100, height: 700 },
      maximized: false,
      zoomPercent: 90,
    })
    const latest = {
      version: 1 as const,
      bounds: { x: 30, y: 40, width: 1300, height: 800 },
      maximized: true,
      zoomPercent: 150,
    }
    store.scheduleSave(latest)
    await store.flush()

    expect(JSON.parse(await readFile(store.filePath, 'utf8'))).toEqual(latest)
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  test('uses a safe default when persisted JSON is corrupt', async () => {
    const directory = await createTemporaryDirectory()
    const store = new WindowStateStore(directory)
    await writeFile(store.filePath, '{not-json', 'utf8')

    expect(await store.load([PRIMARY_DISPLAY], PRIMARY_DISPLAY)).toEqual(
      createDefaultWindowState(PRIMARY_DISPLAY),
    )
  })
})

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'pidex-window-state-'))
  temporaryDirectories.push(directory)
  return directory
}
