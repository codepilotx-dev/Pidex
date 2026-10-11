import { describe, expect, test } from 'bun:test'
import type { DesktopExternalOpenTarget } from '../shared/Types.js'
import { AgentRpcError } from '../src/services/AgentRpcClient.js'
import {
  createExternalOpenTargetsStore,
  shouldFallbackToExternalOpen,
} from '../src/services/ExternalOpenTargetsStore.js'

const targets: DesktopExternalOpenTarget[] = [
  {
    id: 'file-explorer',
    kind: 'file-explorer',
    label: 'File Explorer',
    preferred: true,
  },
  {
    id: 'cursor',
    kind: 'editor',
    label: 'Cursor',
    preferred: false,
  },
]

describe('external open targets store', () => {
  test('keeps missing files internal and only falls back unsupported file content', () => {
    const error = (code: string) => new AgentRpcError('无法打开文件', -32_000, { code })

    expect(shouldFallbackToExternalOpen(error('FILE_NOT_FOUND'))).toBe(false)
    expect(shouldFallbackToExternalOpen(error('PATH_DENIED'))).toBe(false)
    expect(shouldFallbackToExternalOpen(error('FILE_NOT_TEXT'))).toBe(true)
    expect(shouldFallbackToExternalOpen(error('FILE_TOO_LARGE'))).toBe(true)
  })

  test('deduplicates concurrent and fresh requests until the TTL expires', async () => {
    let calls = 0
    let now = 1_000
    let resolveRequest: ((value: DesktopExternalOpenTarget[]) => void) | undefined
    const request = new Promise<DesktopExternalOpenTarget[]>((resolve) => {
      resolveRequest = resolve
    })
    const store = createExternalOpenTargetsStore(
      {
        listExternalOpenTargets: async () => {
          calls += 1
          return request
        },
        openPathWithTarget: async () => {},
      },
      { now: () => now },
    )

    const first = store.loadExternalOpenTargets('C:\\workspace\\README.md')
    const concurrent = store.loadExternalOpenTargets('C:\\workspace\\README.md')
    expect(calls).toBe(1)
    resolveRequest?.(targets)
    await expect(Promise.all([first, concurrent])).resolves.toEqual([targets, targets])

    now += 59_999
    await store.prefetchExternalOpenTargets('C:\\workspace\\README.md')
    expect(calls).toBe(1)

    now += 1
    await store.loadExternalOpenTargets('C:\\workspace\\README.md')
    expect(calls).toBe(2)
  })

  test('removes a failed request so a later prefetch can retry', async () => {
    let calls = 0
    const store = createExternalOpenTargetsStore({
      listExternalOpenTargets: async () => {
        calls += 1
        if (calls === 1) throw new Error('暂时不可用')
        return targets
      },
      openPathWithTarget: async () => {},
    })

    await expect(store.prefetchExternalOpenTargets('C:\\workspace\\README.md')).rejects.toThrow(
      '暂时不可用',
    )
    await expect(store.loadExternalOpenTargets('C:\\workspace\\README.md')).resolves.toEqual(
      targets,
    )
    expect(calls).toBe(2)
  })

  test('prefetch only lists targets and never performs an open action', async () => {
    let openCalls = 0
    const store = createExternalOpenTargetsStore({
      listExternalOpenTargets: async () => targets,
      openPathWithTarget: async () => {
        openCalls += 1
      },
    })

    await store.prefetchExternalOpenTargets('C:\\workspace\\README.md')
    expect(openCalls).toBe(0)
  })

  test('opens preferred and specific targets and updates the cached preference', async () => {
    const opened: Array<{ path: string; targetId: string }> = []
    let listCalls = 0
    const store = createExternalOpenTargetsStore({
      listExternalOpenTargets: async () => {
        listCalls += 1
        return targets
      },
      openPathWithTarget: async (path, targetId) => {
        opened.push({ path, targetId })
      },
    })
    const path = 'C:\\workspace\\README.md'

    await expect(store.openPathWithPreferredExternalTarget(path)).resolves.toMatchObject({
      id: 'file-explorer',
      preferred: true,
    })
    await expect(store.openPathWithExternalTarget(path, 'cursor')).resolves.toMatchObject({
      id: 'cursor',
      preferred: true,
    })

    expect(opened).toEqual([
      { path, targetId: 'file-explorer' },
      { path, targetId: 'cursor' },
    ])
    await expect(store.loadExternalOpenTargets(path)).resolves.toEqual([
      { ...targets[0], preferred: false },
      { ...targets[1], preferred: true },
    ])
    expect(listCalls).toBe(1)
  })
})
