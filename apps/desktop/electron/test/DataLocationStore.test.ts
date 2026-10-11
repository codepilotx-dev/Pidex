import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataLocationStore } from '../src/settings/DataLocationStore'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pidex-data-location-'))
  roots.push(root)
  return root
}

describe('Electron data location store', () => {
  test('schedules a parent/.pidex relocation and promotes it after ready', async () => {
    const root = await temporaryRoot()
    const userData = join(root, 'app-data')
    const current = join(root, 'current', '.pidex')
    const parent = join(root, 'selected')
    await Promise.all([mkdir(current, { recursive: true }), mkdir(parent, { recursive: true })])
    const store = new DataLocationStore(userData, current, null)

    const change = await store.schedule(parent, join(root, 'install'))
    expect(change.targetDataDir).toBe(join(parent, '.pidex'))
    expect((await store.launch()).relocation).toMatchObject({
      sourceDataDir: current,
      targetDataDir: join(parent, '.pidex'),
    })

    await store.promotePending()
    expect(await store.state()).toMatchObject({
      currentDataDir: join(parent, '.pidex'),
      pendingDataDir: null,
      controlSource: 'bootstrap',
    })
  })

  test('disables relocation when the environment controls the root', async () => {
    const root = await temporaryRoot()
    const store = new DataLocationStore(
      join(root, 'app-data'),
      join(root, 'default'),
      join(root, 'environment'),
    )
    expect((await store.state()).isEnvControlled).toBe(true)
    await expect(store.schedule(join(root, 'selected'), join(root, 'install'))).rejects.toThrow(
      'PIDEX_DATA_DIR',
    )
  })

  test('rejects a target that overlaps a registered workspace', async () => {
    const root = await temporaryRoot()
    const parent = join(root, 'projects')
    const workspace = join(parent, 'repository')
    await mkdir(workspace, { recursive: true })
    const store = new DataLocationStore(
      join(root, 'app-data'),
      join(root, 'current', '.pidex'),
      null,
    )

    await expect(store.schedule(parent, join(root, 'install'), [parent])).rejects.toThrow(
      '已注册工作区',
    )
  })

  test('rejects invalid, non-empty, and installation-owned targets', async () => {
    const root = await temporaryRoot()
    const current = join(root, 'current', '.pidex')
    const store = new DataLocationStore(join(root, 'app-data'), current, null)
    await mkdir(current, { recursive: true })

    await expect(store.schedule(current, join(root, 'install'))).rejects.toThrow('父目录')

    const nonEmptyParent = join(root, 'non-empty')
    const nonEmptyTarget = join(nonEmptyParent, '.pidex')
    await mkdir(nonEmptyTarget, { recursive: true })
    await writeFile(join(nonEmptyTarget, 'unexpected.txt'), 'occupied', 'utf8')
    await expect(store.schedule(nonEmptyParent, join(root, 'install'))).rejects.toThrow('必须为空')

    const installDirectory = join(root, 'install')
    await mkdir(installDirectory, { recursive: true })
    await expect(store.schedule(installDirectory, installDirectory)).rejects.toThrow('安装目录')

    if (process.platform === 'win32') {
      await expect(store.schedule('\\\\server\\share', installDirectory)).rejects.toThrow(
        '本地绝对路径',
      )
    }
  })

  test('keeps the pending relocation for retry and can restore the source', async () => {
    const root = await temporaryRoot()
    const current = join(root, 'current', '.pidex')
    const selectedParent = join(root, 'selected')
    await Promise.all([
      mkdir(current, { recursive: true }),
      mkdir(selectedParent, { recursive: true }),
    ])
    const store = new DataLocationStore(join(root, 'app-data'), current, null)

    await store.schedule(selectedParent, join(root, 'install'))
    expect((await store.launch()).relocation).not.toBeNull()

    await store.restoreActive()
    expect(await store.launch()).toEqual({
      dataDir: current,
      relocation: null,
    })
  })
})
