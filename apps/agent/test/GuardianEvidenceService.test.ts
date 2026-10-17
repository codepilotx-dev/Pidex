import { describe, expect, test } from 'bun:test'
import type { ToolInvocation } from '../src/Domain'
import { GuardianEvidenceService } from '../src/permission/GuardianEvidenceService'

const invocation = (overrides: Record<string, unknown> = {}): ToolInvocation =>
  ({
    id: 'tool-1',
    threadID: 'thread-1',
    turnID: 'turn-1',
    agentID: 'agent-1',
    name: 'Write',
    input: { file_path: 'src/a.ts' },
    permissionConfig: {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
    },
    taskMode: 'chat',
    authorizationScope: {
      affectedPaths: [{ path: 'src/a.ts', operation: 'update' }],
      fingerprint: 'scope-1',
      ruleRequiresApproval: true,
    },
    ...overrides,
  }) as unknown as ToolInvocation

const service = (
  read: (path: string, offset?: number, limit?: number) => Promise<string> = async (path) =>
    `content of ${path}`,
) =>
  new GuardianEvidenceService(async () => ({
    read,
    list: async (path = '.') => [{ name: path, path, type: 'file' as const }],
  }))

describe('GuardianEvidenceService', () => {
  test('prefetches AGENTS.md and the affected paths without exposing the tool registry', async () => {
    const evidence = await service().collect(invocation())
    expect(evidence?.files.map((file) => file.path)).toEqual(['AGENTS.md', 'src/a.ts'])
    expect(evidence?.files[0]?.content).toBe('content of AGENTS.md')
  })

  test('bounds each file and the total evidence budget', async () => {
    const evidence = await service(async () => 'x'.repeat(20_000)).collect(invocation())
    expect(evidence?.files).toHaveLength(2)
    expect(Buffer.byteLength(evidence!.files[0]!.content, 'utf8')).toBeLessThanOrEqual(8_000)
    expect(evidence?.files[0]?.truncated).toBe(true)
  })

  test('missing or denied files are skipped instead of failing the review', async () => {
    const evidence = await service(async () => {
      throw new Error('WORKSPACE_PATH_DENIED')
    }).collect(invocation())
    expect(evidence).toBeNull()
  })

  test('the read-only tool surface can read and list, but not escape the workspace', async () => {
    const evidence = service(async (path) => {
      if (path.startsWith('..')) throw new Error('路径不在当前工作区')
      return `content of ${path}`
    })
    const read = await evidence.execute(invocation(), 'guardian_read_file', { path: 'src/a.ts' })
    expect(read).toMatchObject({ isError: false })
    expect(read.text).toContain('content of src/a.ts')
    const listed = await evidence.execute(invocation(), 'guardian_list_dir', { path: '.' })
    expect(listed.isError).toBe(false)
    const escaped = await evidence.execute(invocation(), 'guardian_read_file', { path: '../secret' })
    expect(escaped.isError).toBe(true)
    const sensitive = await evidence.execute(invocation(), 'guardian_read_file', {
      path: '.env.local',
    })
    expect(sensitive.isError).toBe(true)
    const unsupported = await evidence.execute(invocation(), 'shell', { command: 'rm -rf .' })
    expect(unsupported.isError).toBe(true)
  })
})
