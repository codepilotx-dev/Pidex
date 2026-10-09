import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import {
  LocalEnvironmentActionListResultSchema,
  LocalEnvironmentReadParamsSchema,
  LocalEnvironmentReadResultSchema,
  LocalEnvironmentRpcMethods,
  LocalEnvironmentUpdateParamsSchema,
  TerminalHostActionResolveResultSchema,
  TerminalHostEnvironmentResultSchema,
} from '../src/methods/LocalEnvironment'

const digest = 'a'.repeat(64)

describe('local environment method contracts', () => {
  test('公开 Action 投影不接受 command 或环境变量', () => {
    const value = {
      revision: digest,
      actions: [{ name: 'Dev', icon: 'play', availability: 'available' as const }],
    }
    expect(
      Schema.decodeUnknownSync(LocalEnvironmentActionListResultSchema, {
        onExcessProperty: 'error',
      })(value),
    ).toEqual(value)
    expect(() =>
      Schema.decodeUnknownSync(LocalEnvironmentActionListResultSchema, {
        onExcessProperty: 'error',
      })({
        ...value,
        actions: [{ ...value.actions[0], command: 'secret', env: { TOKEN: 'secret' } }],
      }),
    ).toThrow()
  })

  test('read/update 使用 SHA-256 revision 且配置保持 JSON 值', () => {
    const read = {
      exists: true,
      filePath: 'C:\\repo\\.pidex\\environments\\environment.jsonc',
      gitRoot: 'C:\\repo',
      revision: digest,
      configHash: digest,
      config: { schema_version: 1, unknown: { future: true } },
      executionTrusted: false,
    }
    expect(Schema.decodeUnknownSync(LocalEnvironmentReadResultSchema)(read)).toEqual(read)
    expect(() =>
      Schema.decodeUnknownSync(LocalEnvironmentReadParamsSchema, { onExcessProperty: 'error' })({
        threadId: 'thread-1',
        cwd: 'C:\\other-repo',
      }),
    ).toThrow()
    expect(
      Schema.decodeUnknownSync(LocalEnvironmentUpdateParamsSchema)({
        threadId: 'thread-1',
        expectedRevision: digest,
        edits: [
          { keyPath: ['setup', 'windows'], value: 'bun install' },
          { keyPath: ['actions', 0, 'command'], value: 'bun test' },
        ],
      }).edits,
    ).toHaveLength(2)
    expect(() =>
      Schema.decodeUnknownSync(LocalEnvironmentUpdateParamsSchema)({
        threadId: 'thread-1',
        expectedRevision: digest,
        edits: [{ keyPath: ['actions', -1, 'command'], value: 'bun test' }],
      }),
    ).toThrow()
    expect(
      Schema.decodeUnknownSync(LocalEnvironmentUpdateParamsSchema)({
        threadId: 'thread-1',
        expectedRevision: digest,
        trust: { configHash: digest, decision: 'allow' },
      }).trust?.decision,
    ).toBe('allow')
    expect(() =>
      Schema.decodeUnknownSync(LocalEnvironmentUpdateParamsSchema)({
        threadId: 'thread-1',
        expectedRevision: digest,
      }),
    ).toThrow()
    expect(Object.keys(LocalEnvironmentRpcMethods).sort()).toEqual([
      'local-environment/action/list',
      'local-environment/read',
      'local-environment/update',
    ])
  })

  test('desktop-host 契约承载命令和环境 delta，不暴露 cwd', () => {
    const environment = { revision: 2, set: { PATH: 'safe' }, unset: ['OLD'] }
    expect(Schema.decodeUnknownSync(TerminalHostEnvironmentResultSchema)(environment)).toEqual(
      environment,
    )
    const action = { contextVersion: 'context', environmentRevision: 2, command: 'bun test' }
    expect(
      Schema.decodeUnknownSync(TerminalHostActionResolveResultSchema, {
        onExcessProperty: 'error',
      })(action),
    ).toEqual(action)
    expect(() =>
      Schema.decodeUnknownSync(TerminalHostActionResolveResultSchema, {
        onExcessProperty: 'error',
      })({
        ...action,
        cwd: 'C:\\secret',
      }),
    ).toThrow()
  })
})
