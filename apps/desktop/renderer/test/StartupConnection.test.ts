import { expect, test } from 'bun:test'
import type { DesktopStartupSnapshot } from '@pidex/shared/desktop-startup-ipc'
import { subscribeStartupConnection } from '../src/startup/StartupConnection.js'

test('早到事件优先于旧快照，拒绝旧代通知并在清理后停止投递', async () => {
  const seen: number[] = []
  let emit!: (snapshot: DesktopStartupSnapshot) => void
  let resolve!: (snapshot: DesktopStartupSnapshot) => void
  const stop = subscribeStartupConnection(
    {
      onStartupChanged(listener) {
        emit = listener
        return () => {}
      },
      getStartupSnapshot: () =>
        new Promise((done) => {
          resolve = done
        }),
    },
    (state) => seen.push(state.revision),
    () => {
      throw new Error('unexpected error')
    },
  )
  const state = (generation: number, revision: number): DesktopStartupSnapshot => ({
    generation,
    revision,
    state: 'connected',
    label: 'ready',
  })
  emit(state(2, 3))
  resolve(state(1, 1))
  await Promise.resolve()
  emit(state(1, 4))
  emit(state(2, 3))
  emit(state(2, 5))
  stop()
  emit(state(3, 6))
  expect(seen).toEqual([3, 5])
})
