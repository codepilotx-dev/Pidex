import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { AutomationRpcMethods } from '../src/methods/Automation'
import { Capabilities } from '../src/runtime/Capabilities'
import { EventManifest } from '../src/wire/Events'

describe('automation protocol contracts', () => {
  test('公开十个 typed methods 并使用唯一 capability', () => {
    expect(Object.keys(AutomationRpcMethods)).toHaveLength(10)
    expect(
      Object.values(AutomationRpcMethods).every(
        (method) => method.capability === 'automation.manage.v1',
      ),
    ).toBe(true)
    expect(Capabilities).toContain('automation.manage.v1')
  })

  test('durable invalidation events 不接受 prompt、权限或路径', () => {
    expect(EventManifest['automation/changed']).toMatchObject({
      durability: 'durable',
      stream: 'global',
      capability: 'automation.manage.v1',
      reconcilesWith: 'automation/list',
    })
    expect(EventManifest['automation/runChanged']).toMatchObject({
      durability: 'durable',
      stream: 'global',
      capability: 'automation.manage.v1',
      reconcilesWith: 'automation/run/list',
    })

    const decodeAutomation = Schema.decodeUnknownSync(EventManifest['automation/changed'].payload, {
      onExcessProperty: 'error',
    })
    const decodeRun = Schema.decodeUnknownSync(EventManifest['automation/runChanged'].payload, {
      onExcessProperty: 'error',
    })
    const automation = {
      automationId: 'automation:1',
      revision: 2,
      status: 'active',
      changedAt: 10,
    } as const
    const run = {
      automationId: 'automation:1',
      runId: 'run:1',
      status: 'completed',
      changedAt: 11,
    } as const

    expect(decodeAutomation(automation)).toEqual(automation)
    expect(decodeRun(run)).toEqual(run)
    expect(() => decodeAutomation({ ...automation, prompt: '不得进入事件' })).toThrow()
    expect(() => decodeRun({ ...run, workspacePath: 'F:/private' })).toThrow()
  })
})
