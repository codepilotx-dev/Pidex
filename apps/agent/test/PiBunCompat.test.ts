import { describe, expect, test } from 'bun:test'
import {
  smokeAbort,
  smokeAsyncToolBlock,
  smokeCompaction,
  smokeSteerAndFollowUp,
  smokeTextImageToolAndHook,
} from '../scripts/PiBunCompatSmoke.ts'

describe('Pi AgentHarness on Bun', () => {
  test('streams text, accepts images, executes tools and awaits tool_call hooks', async () => {
    await expect(smokeTextImageToolAndHook()).resolves.toBeUndefined()
  })

  test('blocks a tool asynchronously before side effects', async () => {
    await expect(smokeAsyncToolBlock()).resolves.toBeUndefined()
  })

  test('drains steer and follow-up queues', async () => {
    await expect(smokeSteerAndFollowUp()).resolves.toBeUndefined()
  })

  test('aborts an active provider stream', async () => {
    await expect(smokeAbort()).resolves.toBeUndefined()
  })

  test('compacts into the injected session backend', async () => {
    await expect(smokeCompaction()).resolves.toBeUndefined()
  })
})
