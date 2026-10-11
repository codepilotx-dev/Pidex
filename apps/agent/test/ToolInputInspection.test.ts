import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { removeFixturePaths } from './FixtureCleanup'
import { ToolExecutor } from '../src/tool/ToolExecutor'
import { ToolRegistry } from '../src/tool/ToolRegistry'
import { WorkspaceService } from '../src/workspace/WorkspaceService'

const temporary: string[] = []

afterEach(async () => {
  await removeFixturePaths(temporary.splice(0))
})

const fingerprintFor = (patch: string) =>
  createHash('sha256').update(`scope:${patch}`, 'utf8').digest('hex')

describe('工具输入检查与范围绑定', () => {
  test('在审批前检查多路径、配置写入和快照，并拒绝用旧指纹恢复', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'pidex-tool-inspection-'))
    temporary.push(parent)
    const root = join(parent, 'workspace')
    const userConfigPath = join(parent, 'config.json')
    await mkdir(root)
    await writeFile(join(root, 'target.txt'), 'before', 'utf8')
    await writeFile(userConfigPath, '{ "model": "old" }\n', 'utf8')
    const workspace = await WorkspaceService.open(root)
    const registry = new ToolRegistry()
    const inspected: Array<{ alias: string; hasSnapshot: boolean }> = []
    const executedScopes: unknown[] = []
    registry.register({
      sdkName: 'inspected_write',
      description: '测试宿主输入检查',
      schema: z
        .object({
          patch: z.string(),
          config: z.string(),
        })
        .strict(),
      inputSchema: {
        type: 'object',
        properties: {
          patch: { type: 'string' },
          config: { type: 'string' },
        },
        required: ['patch', 'config'],
        additionalProperties: false,
      },
      capabilities: {
        filesystem: 'workspace-write',
        network: 'none',
        process: false,
        externalState: false,
        userInteraction: false,
      },
      allowedModes: ['chat'],
      allowedProfiles: ['main'],
      approvalStrategy: 'policy',
      visibility: 'eager',
      executionMode: 'sequential',
      inspectInput: async (input, context) => {
        inspected.push({
          alias: await context.workspace.resolveEditorFilePath('@pidex/config.json'),
          hasSnapshot: Boolean(await context.fileSnapshots?.get('target.txt')),
        })
        return {
          authorizationScope: {
            affectedPaths: [
              { path: 'target.txt', operation: 'update' },
              { path: '@pidex/config.json', operation: 'update' },
            ],
            fingerprint: fingerprintFor(input.patch),
            ruleRequiresApproval: true,
            reviewSummary: {
              fileCount: 2,
              hunkCount: 2,
              additions: 2,
              deletions: 2,
            },
          },
          configWrites: [
            {
              path: '@pidex/config.json',
              content: input.config,
              scope: 'user',
            },
          ],
        }
      },
      execute: async (_input, context) => {
        executedScopes.push(context.authorizationScope)
        const before = await context.fileSnapshots?.get('target.txt')
        await context.fileSnapshots?.invalidate(['target.txt'])
        const invalidated = await context.fileSnapshots?.get('target.txt')
        if (before) await context.fileSnapshots?.set('target.txt', before)
        const restored = await context.fileSnapshots?.get('target.txt')
        return {
          hadSnapshot: Boolean(before),
          invalidated: invalidated === undefined,
          restored: restored?.sha256 === before?.sha256,
        }
      },
    })
    const reviewed: unknown[] = []
    const hookEvidence: unknown[] = []
    const validated: Array<{ content: string; scope: 'user' | 'project' }> = []
    const executor = new ToolExecutor(registry, {
      dataDir: join(parent, 'data'),
      userConfigPath,
      validateConfigDocument: (content, scope) => validated.push({ content, scope }),
      authorizeShell: async (invocation) => {
        reviewed.push(invocation)
        return { decision: 'allow', risk: 'high', reason: 'approved' }
      },
      hooks: {
        run: async (_event, evidence) => {
          hookEvidence.push(evidence)
          return []
        },
      },
    })
    const context = {
      threadID: 'thread',
      turnID: 'turn',
      agentID: 'agent',
      taskMode: 'chat' as const,
      signal: new AbortController().signal,
      workspace,
      permissionConfig: {
        sandboxMode: 'workspace-write' as const,
        approvalPolicy: 'on-request' as const,
        approvalsReviewer: 'user' as const,
      },
    }
    await executor.execute('Read', { file_path: 'target.txt' }, context)
    const input = { patch: 'first patch', config: '{ "model": "new" }\n' }
    const preview = await executor.previewApproval('inspected_write', input, context, 'scope-call')
    expect(preview).toMatchObject({
      decision: 'allow',
      authorizationFingerprint: fingerprintFor(input.patch),
    })
    expect(inspected.at(-1)).toEqual({
      alias: '@pidex/config.json',
      hasSnapshot: true,
    })
    expect(validated.at(-1)).toEqual({
      content: input.config,
      scope: 'user',
    })
    expect(reviewed.at(-1)).toMatchObject({
      authorizationScope: {
        affectedPaths: [
          { path: 'target.txt', operation: 'update' },
          { path: '@pidex/config.json', operation: 'update' },
        ],
      },
    })
    expect(hookEvidence.at(-1)).toMatchObject({
      authorizationScope: {
        fingerprint: fingerprintFor(input.patch),
      },
    })

    await expect(
      executor.execute(
        'inspected_write',
        { ...input, patch: 'changed patch' },
        {
          ...context,
          toolCallID: 'scope-call',
          approvedToolCallID: 'scope-call',
          approvedAuthorizationFingerprint: fingerprintFor(input.patch),
        },
      ),
    ).rejects.toMatchObject({ code: 'APPROVAL_SCOPE_CHANGED' })

    validated.length = 0
    const result = await executor.execute<{
      hadSnapshot: boolean
      invalidated: boolean
      restored: boolean
    }>('inspected_write', input, {
      ...context,
      toolCallID: 'scope-call',
      approvedToolCallID: 'scope-call',
      approvedAuthorizationFingerprint: fingerprintFor(input.patch),
    })
    expect(result).toEqual({
      hadSnapshot: true,
      invalidated: true,
      restored: true,
    })
    expect(validated).toEqual([
      { content: input.config, scope: 'user' },
      { content: input.config, scope: 'user' },
    ])
    expect(executedScopes.at(-1)).toMatchObject({
      fingerprint: fingerprintFor(input.patch),
    })
  })
})
