import { describe, expect, test } from 'bun:test'
import type { Project } from '@pidex/shared'
import type { ThreadListItem, ThreadSettings, ThreadSnapshot } from '@pidex/shared/thread'
import { createDesktopClient, startGithubLoginFlow } from '../src/services/desktop-client/index.js'

const now = 1_700_000_000_000
const selectedSkills = [
  { name: 'review', path: 'builtin://review/SKILL.md' },
  { name: 'plan', path: 'plugin://tools/skills/plan/SKILL.md' },
]
const projectRootPath = 'F:\\CodeProject\\Pidex-Ts'
const primaryFolder = {
  id: 'folder-primary',
  name: 'Pidex-Ts',
  path: projectRootPath,
  role: 'primary' as const,
  availability: 'available' as const,
  order: 0,
  createdAt: now,
  updatedAt: now,
}
const defaultSettings: ThreadSettings = {
  taskMode: 'chat',
  permissionConfig: {
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
  },
}
const project: Project = {
  id: 'project-1',
  name: 'Pidex-Ts',
  primaryFolderId: primaryFolder.id,
  folders: [primaryFolder],
  removedAt: null,
  lastOpenedAt: now,
  createdAt: now,
  updatedAt: now,
  settings: {
    defaultModel: null,
    instructions: '',
    version: 1,
  },
}
const projectWorkspace = {
  kind: 'project' as const,
  projectID: project.id,
  cwd: projectRootPath,
  runtimeWorkspaceRoots: [
    {
      folderId: primaryFolder.id,
      path: projectRootPath,
      role: 'primary' as const,
    },
  ],
  instructionSources: [],
  outputDirectory: null,
}

describe('desktop thread settings client', () => {
  test('plan approval preserves target, operation and model and refreshes after success', async () => {
    const calls: string[] = []
    const approval = {
      id: 'plan-approval-1',
      threadId: 'session-plan',
      turnId: 'plan-turn',
      planItemId: 'plan-item',
      version: 1,
      status: 'pending' as const,
      title: '计划',
      markdown: '修改目标文件',
      nextTurnId: null,
      createdAt: now,
      resolvedAt: null,
    }
    const params = {
      threadId: approval.threadId,
      approvalId: approval.id,
      expectedVersion: 1,
      operationId: 'plan-op-1',
      response: {
        action: 'implement' as const,
        model: { providerID: 'deepseek', id: 'deepseek-chat' },
      },
    }
    const client = createDesktopClient({
      fetch: async (_path, init) => {
        const body = JSON.parse(String(init?.body))
        calls.push(body.method)
        if (body.method === 'initialized') return new Response(null, { status: 204 })
        if (body.method === 'initialize') {
          expect(body.params.capabilities).toContain('plan.approval.v1')
          return rpc(body.id, {
            ...initializedResult(),
            capabilities: [...initializedResult().capabilities, 'plan.approval.v1'],
          })
        }
        if (body.method === 'planApproval/read') {
          expect(body.params).toEqual({ threadId: approval.threadId })
          return rpc(body.id, { approval })
        }
        if (body.method === 'planApproval/respond') {
          expect(body.params).toEqual(params)
          return rpc(body.id, {
            approval: {
              ...approval,
              status: 'implemented',
              version: 2,
              nextTurnId: 'coding-turn',
              resolvedAt: now,
            },
            disposition: 'applied',
          })
        }
        if (body.method === 'thread/read') {
          expect(body.params.threadId).toBe(approval.threadId)
          return rpc(body.id, snapshotResult(snapshot(approval.threadId, defaultSettings)))
        }
        if (body.method === 'project/list') return rpc(body.id, { projects: [], nextCursor: null })
        throw new Error(`Unexpected method: ${body.method}`)
      },
    })
    expect((await client.readPlanApproval({ threadId: approval.threadId })).approval?.id).toBe(
      approval.id,
    )
    expect((await client.respondPlanApproval(params)).approval.status).toBe('implemented')
    expect(calls).not.toContain('interaction/respond')
    expect(calls.indexOf('thread/read')).toBeGreaterThan(calls.indexOf('planApproval/respond'))
  })

  test.each(['answer', 'mixed', 'all', 'unsupported'] as const)(
    'submits complete question results by original ids with capability gating (%s)',
    async (mode) => {
      const responses: unknown[] = []
      const questions = ['scope', 'format', 'filter'].map((id) => ({
        id,
        header: id,
        prompt: `请选择 ${id}`,
        choices: [
          { id: 'yes', label: '是', description: '保留', recommended: true },
          { id: 'no', label: '否', description: '排除', recommended: false },
        ],
        allowFreeform: true,
        required: true,
      }))
      const client = createDesktopClient({
        fetch: async (_path, init) => {
          const body = JSON.parse(String(init?.body))
          if (body.method === 'initialized') return new Response(null, { status: 204 })
          if (body.method === 'initialize')
            return rpc(body.id, {
              ...initializedResult(),
              capabilities: [
                ...initializedResult().capabilities,
                ...(mode === 'unsupported' ? [] : ['interaction.questionSkip.v1']),
              ],
            })
          if (body.method === 'interaction/listPending') {
            expect(body.params.threadId).toBe('session-1')
            return rpc(body.id, {
              interactions: [
                {
                  interactionId: 'group-1',
                  threadId: 'session-1',
                  turnId: 'turn-1',
                  agentId: 'agent-1',
                  createdAt: now,
                  version: 1,
                  kind: 'question',
                  questions,
                },
              ],
              nextCursor: null,
            })
          }
          if (body.method === 'interaction/respond') {
            responses.push(body.params)
            return rpc(body.id, {
              interactionId: 'group-1',
              kind: 'question',
              state: 'resolved',
              version: 2,
              resolvedAt: now,
              response: body.params.response,
            })
          }
          if (body.method === 'thread/read')
            return rpc(body.id, snapshotResult(snapshot('session-1', defaultSettings)))
          throw new Error(`Unhandled method: ${body.method}`)
        },
      })
      const skippedQuestionIds =
        mode === 'answer' ? [] : mode === 'all' ? ['scope', 'format', 'filter'] : ['scope']
      const submission = client.respondToPermission('session-1', 'question:group-1', {
        behavior: 'allow',
        updatedInput: {
          answer: 'stale legacy answer',
          answers: {
            scope: mode === 'answer' ? '是' : '',
            format: mode === 'all' ? '' : '中文自定义',
            filter: mode === 'all' ? '' : '否',
          },
          skippedQuestionIds,
          questionAnswers: questions.map((question) =>
            skippedQuestionIds.includes(question.id)
              ? { questionId: question.id, choiceIds: [], skipped: true }
              : question.id === 'format'
                ? { questionId: question.id, choiceIds: [], text: '中文自定义' }
                : { questionId: question.id, choiceIds: [question.id === 'scope' ? 'yes' : 'no'] },
          ),
        },
      })
      if (mode === 'unsupported') {
        await expect(submission).rejects.toThrow('interaction.questionSkip.v1')
        expect(responses).toHaveLength(0)
        return
      }
      await submission
      expect(responses).toHaveLength(1)
      expect(responses[0]).toMatchObject({
        interactionId: 'group-1',
        expectedVersion: 1,
        response: {
          kind: 'question',
          status: 'answered',
          resolution: 'user',
          answers: [
            ...(mode === 'all'
              ? skippedQuestionIds.map((questionId) => ({
                  questionId,
                  choiceIds: [],
                  skipped: true,
                }))
              : [
                  mode === 'mixed'
                    ? { questionId: 'scope', choiceIds: [], skipped: true }
                    : { questionId: 'scope', choiceIds: ['yes'] },
                  { questionId: 'format', choiceIds: [], text: '中文自定义' },
                  { questionId: 'filter', choiceIds: ['no'] },
                ]),
          ],
        },
      })
    },
  )

  test('opens home and thread windows through the typed desktop bridge', async () => {
    const calls: unknown[] = []
    const client = createDesktopClient({
      window: {
        DesktopBridge: {
          openWindow: async (input) => {
            calls.push(input)
          },
        },
      },
    })

    await client.newWindow()
    await client.openWindow({ kind: 'thread', threadId: 'thread-1' })

    expect(calls).toEqual([{ kind: 'home' }, { kind: 'thread', threadId: 'thread-1' }])
  })

  test('shows composer file entry only with Electron bridge and both Agent capabilities', async () => {
    const bridge = {
      chooseComposerFiles: async () => [],
      grantComposerPaths: async () => [],
      getPathForFile: () => '',
    }
    const createCapabilityClient = (capabilities: string[]) =>
      createDesktopClient({
        window: { DesktopBridge: bridge } as never,
        fetch: async (_path, init) => {
          const body = JSON.parse(String(init?.body))
          if (body.method === 'initialized') return new Response(null, { status: 204 })
          if (body.method === 'initialize') {
            return rpc(body.id, { ...initializedResult(), capabilities })
          }
          throw new Error(`Unhandled method: ${body.method}`)
        },
      })
    expect(
      await createCapabilityClient([
        'attachments.v1',
        'local-context.paths.v1',
      ]).isComposerFileAttachmentAvailable(),
    ).toBe(true)
    expect(
      await createCapabilityClient(['attachments.v1']).isComposerFileAttachmentAvailable(),
    ).toBe(false)
    expect(await createDesktopClient({}).isComposerFileAttachmentAvailable()).toBe(false)
  })

  test('imports live local paths separately and binds their ids to turn/start', async () => {
    const calls: Array<{ method: string; params: any }> = []
    const client = createDesktopClient({
      fetch: async (path, init) => {
        if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
        const body = JSON.parse(String(init?.body))
        calls.push({ method: body.method, params: body.params })
        if (body.method === 'initialize') return rpc(body.id, initializedResult())
        if (body.method === 'initialized') return new Response(null, { status: 204 })
        if (body.method === 'context/path/import') {
          return rpc(body.id, {
            references: [
              {
                id: 'context-docs',
                name: 'docs',
                path: 'C:\\outside\\docs',
                kind: 'directory',
                status: 'available',
                createdAt: now,
              },
            ],
          })
        }
        if (body.method === 'model/list') return rpc(body.id, modelCatalog())
        if (body.method === 'turn/start') {
          return rpc(body.id, {
            inputId: body.params.inputId,
            turnId: 'local-context-turn',
            disposition: 'accepted',
            streamPosition: { streamId: body.params.threadId, sequence: 1 },
          })
        }
        if (body.method === 'thread/read') throw new Error('refresh omitted')
        throw new Error(`Unhandled method: ${body.method}`)
      },
    })

    await client.sendUserMessage('session-local-context', {
      text: '读取目录',
      skills: selectedSkills,
      attachments: [
        {
          id: 'draft-grant',
          name: 'docs',
          path: 'C:\\outside\\docs',
          pathKind: 'directory',
          localGrantId: 'draft-grant',
          storage: 'local-path',
          mediaType: 'inode/directory',
          sizeBytes: 0,
          kind: 'document',
          status: 'ready',
        },
      ],
    })

    expect(calls.some((call) => call.method === 'attachment/import')).toBe(false)
    expect(calls.find((call) => call.method === 'context/path/import')?.params).toMatchObject({
      threadId: 'session-local-context',
      paths: ['C:\\outside\\docs'],
      operationId: expect.any(String),
    })
    expect(calls.find((call) => call.method === 'turn/start')?.params).toMatchObject({
      content: '读取目录',
      skills: selectedSkills,
      contextReferenceIds: ['context-docs'],
    })
  })

  test('reimports retained attachments before starting an edited turn', async () => {
    const calls: Array<{ method: string; params: any }> = []
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      calls.push({ method: body.method, params: body.params })
      if (body.method === 'initialize') return rpc(body.id, initializedResult())
      if (body.method === 'initialized') return new Response(null, { status: 204 })
      if (body.method === 'attachment/read') {
        return rpc(body.id, {
          attachment: {
            id: body.params.attachmentId,
            kind: 'text',
            name: 'history.md',
            mediaType: 'text/markdown',
            sizeBytes: 7,
            sha256: 'history-sha',
            createdAt: now,
          },
          data: 'history',
          encoding: 'utf8',
          range: { offset: 0, length: 7, total: 7 },
        })
      }
      if (body.method === 'attachment/import') {
        return rpc(body.id, {
          attachments: [
            {
              id: 'cloned-history-id',
              kind: 'text',
              name: 'history.md',
              mediaType: 'text/markdown',
              sizeBytes: 7,
              sha256: 'cloned-sha',
              createdAt: now,
            },
          ],
        })
      }
      if (body.method === 'model/list') return rpc(body.id, modelCatalog())
      if (body.method === 'turn/start') {
        return rpc(body.id, {
          inputId: body.params.inputId,
          turnId: 'edited-turn',
          disposition: 'accepted',
          streamPosition: { streamId: body.params.threadId, sequence: 1 },
        })
      }
      if (body.method === 'thread/read') {
        throw new Error('视觉外的刷新失败不应改变已提交请求。')
      }
      throw new Error(`Unhandled method: ${body.method}`)
    }
    const client = createDesktopClient({ fetch: fetcher })

    await client.sendUserMessage('session-edited', {
      text: '修改后的消息',
      retainedAttachmentIds: ['history-id'],
    })

    expect(calls.find((call) => call.method === 'attachment/read')?.params).toEqual({
      attachmentId: 'history-id',
    })
    expect(calls.find((call) => call.method === 'attachment/import')?.params).toMatchObject({
      uploads: [
        {
          kind: 'text',
          name: 'history.md',
          data: 'history',
          encoding: 'utf8',
        },
      ],
    })
    expect(calls.find((call) => call.method === 'turn/start')?.params).toMatchObject({
      attachmentIds: ['cloned-history-id'],
      content: '修改后的消息',
      threadId: 'session-edited',
    })
    expect(calls.find((call) => call.method === 'turn/start')?.params.attachmentIds).not.toContain(
      'history-id',
    )
  })

  test('routes shared Profile listing and selection through RPC v4', async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      calls.push({ method: body.method, params: body.params })
      if (body.method === 'initialize') return rpc(body.id, initializedResult())
      if (body.method === 'initialized') return new Response(null, { status: 204 })
      if (body.method === 'config/profile/list') {
        return rpc(body.id, {
          profileState: {
            activeProfile: null,
            selectedProfile: null,
            restartRequired: false,
          },
          profiles: [
            {
              id: 'deep-review',
              displayName: '深度审查',
              filePath: 'C:/Users/example/.pidex/profiles/deep-review.json',
              version: 'a'.repeat(64),
              valid: true,
              diagnostics: [],
            },
          ],
          profilesDirectory: 'C:/Users/example/.pidex/profiles',
        })
      }
      if (body.method === 'config/profile/select') {
        return rpc(body.id, {
          status: 'ok',
          version: 'b'.repeat(64),
          filePath: 'C:/Users/example/.pidex/config.json',
          profileState: {
            activeProfile: null,
            selectedProfile: 'deep-review',
            restartRequired: true,
          },
        })
      }
      throw new Error(`Unhandled method: ${body.method}`)
    }
    const client = createDesktopClient({ fetch: fetcher })

    const listed = await client.listConfigProfiles()
    const selected = await client.selectConfigProfile('deep-review')

    expect(listed.profiles[0]?.displayName).toBe('深度审查')
    expect(selected.profileState.restartRequired).toBe(true)
    expect(calls).toEqual(
      expect.arrayContaining([
        { method: 'config/profile/list', params: {} },
        { method: 'config/profile/select', params: { profileId: 'deep-review' } },
      ]),
    )
  })

  test('routes tooling management and live updates through RPC v4', async () => {
    let eventSubscribeParams: unknown
    const source = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as (() => void) | null,
      close: () => {},
    }
    const toolingStatus = {
      id: 'ripgrep' as const,
      preference: 'managed' as const,
      phase: 'ready' as const,
      activeSource: 'managed' as const,
      pinnedVersion: '15.2.0',
      managed: { installed: true, version: '15.2.0' },
      system: { available: false, version: null, path: null },
    }
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      if (body?.method === 'initialized') return new Response(null, { status: 204 })
      if (body?.method === 'initialize') return rpc(body.id, initializedResult())
      if (body?.method === 'tooling/list') {
        return rpc(body.id, { statuses: [toolingStatus] })
      }
      if (body?.method === 'tooling/refresh') {
        expect(body.params).toEqual({})
        return rpc(body.id, { statuses: [toolingStatus] })
      }
      if (body?.method === 'tooling/setPreference') {
        expect(body.params).toMatchObject({
          id: 'ripgrep',
          preference: 'system',
          operationId: expect.any(String),
        })
        return rpc(body.id, {
          status: { ...toolingStatus, preference: 'system' },
        })
      }
      if (body?.method === 'tooling/install') {
        expect(body.params).toMatchObject({
          id: 'ripgrep',
          force: true,
          operationId: expect.any(String),
        })
        return rpc(body.id, { status: toolingStatus })
      }
      if (body?.method === 'event/subscribe') {
        eventSubscribeParams = body.params
        return rpc(body.id, {
          subscriptionId: 'tooling-subscription',
          highWatermarks: [{ streamId: 'global', sequence: 3 }],
        })
      }
      if (body?.method === 'event/unsubscribe') {
        return rpc(body.id, { ok: true })
      }
      if (body?.method === 'event/ack') {
        return rpc(body.id, {
          subscriptionId: body.params.subscriptionId,
          acknowledged: body.params.positions,
        })
      }
      throw new Error(`Unhandled RPC method: ${body?.method}`)
    }
    const client = createDesktopClient({
      fetch: fetcher,
      eventSourceFactory: () => source as unknown as EventSource,
    })

    expect(await client.listTooling()).toEqual([toolingStatus])
    expect(await client.refreshTooling()).toEqual([toolingStatus])
    expect((await client.setToolingPreference('ripgrep', 'system')).preference).toBe('system')
    expect(await client.installTooling('ripgrep', true)).toEqual(toolingStatus)

    const updates: unknown[] = []
    const unsubscribe = client.onToolingUpdated((status) => updates.push(status))
    for (let index = 0; index < 20 && !source.onmessage; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(eventSubscribeParams).toEqual({
      streams: [{ streamId: 'global', after: 'latest' }],
      liveEventTypes: [
        'catalog/updated',
        'provider/credential/updated',
        'config/updated',
        'workspace/file/changed',
        'workspace/git/changed',
        'usage/source/updated',
        'model/health/updated',
        'skill/updated',
        'plugins/updated',
        'tooling/updated',
        'mcp/updated',
        'speech/statusChanged',
      ],
    })
    source.onmessage?.({
      data: JSON.stringify({
        jsonrpc: '2.0',
        method: 'event/next',
        params: {
          subscriptionId: 'tooling-subscription',
          event: {
            eventId: 'tooling-event-4',
            streamId: 'global',
            type: 'tooling/updated',
            version: 1,
            occurredAt: now,
            durability: 'live',
            sequence: null,
            afterSequence: 3,
            payload: { status: toolingStatus },
          },
        },
      }),
    } as MessageEvent)
    for (let index = 0; index < 20 && updates.length === 0; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(updates).toEqual([toolingStatus])
    unsubscribe()
  })

  test('uses initial settings for the first turn and serializes immediate updates', async () => {
    let settings: ThreadSettings = {
      taskMode: 'plan',
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
      },
    }
    const methods: string[] = []
    const turnStarts: unknown[] = []
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      const params = body?.params ?? {}
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      if (body?.method === 'initialized') return new Response(null, { status: 204 })
      if (body?.method === 'initialize') return rpc(body.id, initializedResult())
      if (body?.method === 'project/open') return rpc(body.id, { project })
      if (body?.method === 'project/list')
        return rpc(body.id, { projects: [project], nextCursor: null })
      if (body?.method === 'project/trust/read') {
        return rpc(body.id, {
          projectRoot: projectRootPath,
          trustLevel: 'trusted',
          hasProjectConfig: true,
        })
      }
      if (body?.method === 'thread/create') {
        expect(params).toEqual({
          workspace: { kind: 'project', projectId: project.id },
          settings,
          title: 'Plan 会话',
          operationId: expect.any(String),
        })
        return rpc(body.id, snapshotResult(snapshot('session-1', settings)))
      }
      if (body?.method === 'thread/list') {
        return rpc(body.id, {
          threads: [listItem('session-1', settings)],
          nextCursor: null,
        })
      }
      if (body?.method === 'thread/read') {
        return rpc(body.id, snapshotResult(snapshot(params.threadId, settings)))
      }
      if (body?.method === 'thread/settings/update') {
        methods.push(body.method)
        settings = { ...settings, ...params.settings }
        await Promise.resolve()
        return rpc(body.id, {
          threadId: params.threadId,
          settings,
          version: 1,
        })
      }
      if (body?.method === 'model/list') return rpc(body.id, modelCatalog())
      if (body?.method === 'turn/start') {
        methods.push(body.method)
        turnStarts.push(params)
        return rpc(body.id, {
          inputId: params.inputId,
          turnId: 'turn-1',
          disposition: 'accepted',
          streamPosition: {
            streamId: params.threadId,
            sequence: 1,
          },
        })
      }
      throw new Error(`Unhandled RPC method: ${body?.method}`)
    }
    const client = createDesktopClient({ fetch: fetcher })
    const created = await client.createSession({
      workspacePath: projectRootPath,
      sessionName: 'Plan 会话',
      permissionConfig: settings.permissionConfig,
      planModeActive: true,
    })

    await client.sendUserMessage(created.sessionId, { text: '首轮' })
    expect(turnStarts[0]).toMatchObject({
      permissionConfig: settings.permissionConfig,
      taskMode: 'plan',
    })

    const planUpdate = client.setSessionPlanModeActive('session-1', false)
    const permissionUpdate = client.setSessionPermissionMode('session-1', 'full-access')
    const send = client.sendUserMessage('session-1', { text: '立即发送' })
    const [, permissionSnapshot] = await Promise.all([planUpdate, permissionUpdate, send])

    expect(methods).toEqual([
      'turn/start',
      'thread/settings/update',
      'thread/settings/update',
      'turn/start',
    ])
    expect(turnStarts[1]).toMatchObject({
      permissionConfig: {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
      },
      taskMode: 'chat',
    })
    expect(permissionSnapshot.item.permissionMode).toBe('full-access')
    expect(permissionSnapshot.item.planModeActive).toBe(false)
  })

  test('returns explicit unsupported errors instead of entering the mock map', async () => {
    const compactRequests: unknown[] = []
    const settingsRequests: unknown[] = []
    const client = createDesktopClient({
      fetch: async (_path, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) : null
        if (body?.method === 'initialized') return new Response(null, { status: 204 })
        if (body?.method === 'initialize') return rpc(body.id, initializedResult())
        if (body?.method === 'project/list')
          return rpc(body.id, { projects: [project], nextCursor: null })
        if (body?.method === 'thread/compact') {
          compactRequests.push(body.params)
          return rpc(body.id, {
            compaction: {
              id: 'compaction-1',
              beforeCount: 10,
              afterCount: 5,
              beforeTokens: 100,
              afterTokens: 50,
              targetTokens: 60,
              usageSampleId: 'usage-1',
              baselineVersion: 1,
            },
          })
        }
        if (body?.method === 'thread/read') {
          return rpc(body.id, snapshotResult(snapshot(body.params.threadId, defaultSettings)))
        }
        if (body?.method === 'thread/settings/update') {
          settingsRequests.push(body.params)
          return rpc(body.id, {
            threadId: body.params.threadId,
            settings: { ...defaultSettings, ...body.params.settings },
            version: 1,
          })
        }
        throw new Error(`Unexpected RPC method: ${body?.method}`)
      },
    })
    await client.compactSession('real-uuid')
    expect(compactRequests).toEqual([
      {
        threadId: 'real-uuid',
        operationId: expect.any(String),
      },
    ])
    await client.setSessionPermissionProfile('real-uuid', 'read-only', 'never')
    expect(settingsRequests).toEqual([
      {
        threadId: 'real-uuid',
        operationId: expect.any(String),
        settings: {
          permissionConfig: {
            sandboxMode: 'read-only',
            approvalPolicy: 'never',
            approvalsReviewer: 'user',
          },
        },
      },
    ])

    const unsupported: Array<[string, () => Promise<unknown>]> = [
      [
        'restoreSessionTurnChanges',
        () => client.restoreSessionTurnChanges({ sessionId: 'real-uuid' } as never),
      ],
      [
        'saveSessionReviewComment',
        () => client.saveSessionReviewComment({ sessionId: 'real-uuid' } as never),
      ],
      [
        'resolveSessionReviewComment',
        () => client.resolveSessionReviewComment({ sessionId: 'real-uuid' } as never),
      ],
      [
        'deleteSessionReviewComment',
        () => client.deleteSessionReviewComment({ sessionId: 'real-uuid' } as never),
      ],
      ['setSessionLocalRouterMode', () => client.setSessionLocalRouterMode('real-uuid', 'off')],
      ['rollbackSession', () => client.rollbackSession({ sessionId: 'real-uuid' } as never)],
      ['getSessionGoal', () => client.getSessionGoal('real-uuid')],
      ['setSessionGoal', () => client.setSessionGoal('real-uuid', {})],
      ['clearSessionGoal', () => client.clearSessionGoal('real-uuid')],
    ]

    for (const [operation, invoke] of unsupported) {
      try {
        await invoke()
        throw new Error(`${operation} unexpectedly succeeded`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        expect(message).toContain('AGENT_OPERATION_UNSUPPORTED')
        expect(message).toContain(operation)
        expect(message).not.toContain('Mock session not found')
      }
    }
  })

  test('routes MCP management through RPC with the current workspace', async () => {
    const requests: Array<{ method: string; params: Record<string, unknown> }> = []
    const server = {
      name: 'fixture',
      scope: 'local' as const,
      enabled: true,
      diagnosticContext: true,
      transport: {
        type: 'stdio' as const,
        command: 'bun',
        args: ['fixture.ts'],
      },
    }
    const listResult = {
      servers: [{ server, effective: true }],
      generation: 4,
    }
    const client = createDesktopClient({
      fetch: async (_path, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) : null
        if (body?.method === 'initialized') return new Response(null, { status: 204 })
        if (body?.method === 'initialize') return rpc(body.id, initializedResult())
        requests.push({ method: body.method, params: body.params })
        if (body.method === 'mcp/status') {
          return rpc(body.id, {
            servers: [
              {
                name: 'fixture',
                scope: 'local',
                type: 'stdio',
                state: 'connected',
                auth: { source: 'none', canLogin: false, canLogout: false },
                toolCount: 2,
                resourceCount: 1,
                promptCount: 1,
              },
            ],
            totalTools: 2,
            totalResources: 1,
            totalPrompts: 1,
            generation: 4,
          })
        }
        if (body.method === 'mcp/reload') {
          return rpc(body.id, {
            generation: 5,
            added: [],
            replaced: ['fixture'],
            removed: [],
            unchanged: [],
            failed: [],
          })
        }
        if (body.method === 'mcp/oauth/start') {
          return rpc(body.id, {
            attemptId: 'oauth-attempt',
            authorizationUrl: 'https://example.com/oauth',
            expiresAt: Date.now() + 60_000,
          })
        }
        if (body.method === 'mcp/oauth/status') {
          return rpc(body.id, { state: 'completed' })
        }
        if (body.method === 'mcp/oauth/logout') {
          return rpc(body.id, { generation: 6 })
        }
        return rpc(body.id, listResult)
      },
    })

    expect(await client.listMcpServers(projectRootPath)).toMatchObject([
      {
        name: 'fixture',
        scope: 'local',
        effective: true,
        diagnosticContext: true,
      },
    ])
    expect(await client.getMcpRuntimeStatus(projectRootPath)).toMatchObject({
      servers: [{ name: 'fixture', state: 'connected', toolCount: 2 }],
    })
    await client.saveMcpServer({
      ...server,
      workspacePath: projectRootPath,
      originalName: 'old-fixture',
    })
    await client.setMcpServerEnabled('fixture', 'local', false, projectRootPath)
    await client.removeMcpServer('fixture', 'local', projectRootPath)
    await client.reloadMcpConfiguration(projectRootPath)
    const oauth = await client.startMcpOAuth('fixture', 'local', projectRootPath)
    expect(oauth.attemptId).toBe('oauth-attempt')
    expect(await client.getMcpOAuthStatus(oauth.attemptId)).toEqual({
      state: 'completed',
    })
    expect(await client.logoutMcpOAuth('fixture', 'local', projectRootPath)).toEqual({
      generation: 6,
    })

    expect(requests.map((request) => request.method)).toEqual([
      'mcp/list',
      'mcp/status',
      'mcp/save',
      'mcp/setEnabled',
      'mcp/remove',
      'mcp/reload',
      'mcp/oauth/start',
      'mcp/oauth/status',
      'mcp/oauth/logout',
    ])
    for (const request of requests.filter((request) => request.method !== 'mcp/oauth/status')) {
      expect(request.params.workspace).toBe(projectRootPath)
    }
    expect(requests[7]?.params).toEqual({ attemptId: 'oauth-attempt' })
    expect(requests[2]?.params).toMatchObject({
      originalName: 'old-fixture',
      operationId: expect.any(String),
      server,
    })
    expect(requests[3]?.params).toMatchObject({
      name: 'fixture',
      scope: 'local',
      enabled: false,
      operationId: expect.any(String),
    })
  })

  test('starts AI Review with the persisted delivery preference', async () => {
    const requests: unknown[] = []
    const client = createDesktopClient({
      window: {
        DesktopBridge: {
          pickWorkspaceDirectory: async () => null,
          getDesktopSettings: async () => ({ reviewDelivery: 'detached' }),
        },
      },
      fetch: async (_path, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) : null
        if (body?.method === 'initialized') return new Response(null, { status: 204 })
        if (body?.method === 'initialize') {
          return rpc(body.id, initializedResult())
        }
        if (body?.method === 'review/ai/start') {
          requests.push(body.params)
          return rpc(body.id, {
            threadId: 'review-thread',
            turnId: 'review-turn',
            delivery: 'detached',
            source: { kind: 'branch', baseBranch: 'main' },
          })
        }
        throw new Error(`Unexpected RPC method: ${body?.method}`)
      },
    })

    const result = await client.startSessionReview('source-thread', {
      type: 'baseBranch',
      branch: 'main',
    })

    expect(requests).toEqual([
      {
        threadId: 'source-thread',
        target: { type: 'baseBranch', branch: 'main' },
        delivery: 'detached',
      },
    ])
    expect(result).toMatchObject({
      threadId: 'review-thread',
      delivery: 'detached',
      source: { kind: 'branch', baseBranch: 'main' },
    })
  })

  test('uses real queue RPCs with optimistic queue versions', async () => {
    const queueRequests: Array<{ method: string; params: Record<string, unknown> }> = []
    const fetcher = async (_path: string, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      if (body?.method === 'initialized') return new Response(null, { status: 204 })
      if (body?.method === 'initialize') return rpc(body.id, initializedResult())
      if (body?.method === 'project/list')
        return rpc(body.id, { projects: [project], nextCursor: null })
      if (body?.method === 'model/list') return rpc(body.id, modelCatalog())
      if (body?.method === 'thread/read') {
        return rpc(
          body.id,
          snapshotResult({
            ...snapshot(body.params.threadId, defaultSettings),
            queue: { version: 7, pauseReason: null },
          }),
        )
      }
      if (typeof body?.method === 'string' && body.method.startsWith('queue/')) {
        queueRequests.push({ method: body.method, params: body.params })
        if (body.method === 'queue/add') {
          return rpc(body.id, {
            inputId: body.params.inputId,
            turnId: 'turn-queued',
            disposition: 'accepted',
            admission: 'queued',
            streamPosition: { streamId: 'stream-1', sequence: 8 },
          })
        }
        return rpc(body.id, {
          threadId: body.params.threadId,
          version: 8,
          pauseReason: null,
          turns: [],
          inputs: [],
          streamPosition: { streamId: 'stream-1', sequence: 8 },
        })
      }
      throw new Error(`Unexpected RPC method: ${body?.method}`)
    }
    const client = createDesktopClient({ fetch: fetcher })
    await client.getSession('thread-queue')

    await client.submitSessionFollowUp(
      'thread-queue',
      { text: '下一轮', skills: selectedSkills },
      'follow-up',
      'input-follow-up',
      { providerID: 'anthropic', model: 'claude-opus-4-1' },
    )
    expect(queueRequests[0]?.params.model).toEqual({
      providerID: 'anthropic',
      id: 'claude-opus-4-1',
    })
    await client.updateQueuedFollowUp('thread-queue', 'input-1', {
      text: '更新',
      skills: selectedSkills.slice(1),
    })
    await client.removeQueuedFollowUp('thread-queue', 'input-2')
    await client.resumeQueuedFollowUps('thread-queue')

    expect(queueRequests.map((request) => request.method)).toEqual([
      'queue/add',
      'queue/update',
      'queue/remove',
      'queue/resume',
    ])
    for (const request of queueRequests) {
      expect(request.params).toMatchObject({
        threadId: 'thread-queue',
        operationId: expect.any(String),
        expectedVersion: 7,
      })
    }
    expect(queueRequests[0]?.params).toMatchObject({
      inputId: 'input-follow-up',
      content: '下一轮',
      skills: selectedSkills,
    })
    expect(queueRequests[1]?.params).toMatchObject({
      content: '更新',
      skills: selectedSkills.slice(1),
    })
    expect(queueRequests[1]?.params).not.toHaveProperty('attachmentIds')
  })

  test('uses turn steer for an active follow-up without legacy strategy params', async () => {
    let steerParams: Record<string, unknown> | null = null
    const activeSnapshot = (): ThreadSnapshot => ({
      ...snapshot('thread-active', defaultSettings),
      turns: [
        {
          id: 'turn-active',
          threadId: 'thread-active',
          sourceInputID: 'input-active',
          status: 'running',
          mode: 'chat',
          model: { providerID: 'openai', id: 'gpt-5' },
          permissionConfig: defaultSettings.permissionConfig,
          rootAgentId: 'agent-active',
          mergedInputIDs: [],
          startedAt: now,
          finishedAt: null,
          elapsedSeconds: 1,
          error: null,
        },
      ],
    })
    const client = createDesktopClient({
      fetch: async (_path, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) : null
        if (body?.method === 'initialized') return new Response(null, { status: 204 })
        if (body?.method === 'initialize') return rpc(body.id, initializedResult())
        if (body?.method === 'project/list')
          return rpc(body.id, { projects: [project], nextCursor: null })
        if (body?.method === 'thread/read') {
          return rpc(body.id, snapshotResult(activeSnapshot()))
        }
        if (body?.method === 'turn/steer') {
          steerParams = body.params
          return rpc(body.id, {
            inputId: body.params.inputId,
            turnId: 'turn-active',
            disposition: 'accepted',
            streamPosition: {
              streamId: 'thread-active',
              sequence: 1,
            },
          })
        }
        throw new Error(`Unexpected RPC method: ${body?.method}`)
      },
    })
    await client.getSession('thread-active')
    await client.submitSessionFollowUp(
      'thread-active',
      { text: '补充要求', skills: selectedSkills },
      'steer',
      'draft-steer',
      { providerID: 'anthropic', model: 'claude-opus-4-1' },
    )

    expect(steerParams).toMatchObject({
      threadId: 'thread-active',
      turnId: 'turn-active',
      inputId: 'draft-steer',
      content: '补充要求',
      skills: selectedSkills,
    })
    expect(steerParams).not.toHaveProperty('strategy')
    expect(steerParams).not.toHaveProperty('model')
  })

  test('reports unavailable without mock fallback and preserves browser mock behavior', async () => {
    const unavailable = createDesktopClient({
      fetch: async () => new Response('nope', { status: 503 }),
      window: {
        DesktopBridge: {
          pickWorkspaceDirectory: async () => null,
        },
      },
    })
    expect(await unavailable.getSessionCatalogStatus()).toMatchObject({
      state: 'unavailable',
    })

    const browser = createDesktopClient({
      fetch: async () => new Response('nope', { status: 503 }),
    })
    const created = await browser.createSession({ sessionName: 'mock' })
    const updated = await browser.setSessionPermissionMode(created.sessionId, 'auto-review')
    expect(created.sessionId).toStartWith('browser-mock-')
    expect(updated.item.permissionMode).toBe('auto-review')
  })

  test('reconciles thread and pending-interaction catalog metadata before committing a global thread update', async () => {
    const readThreadIds: string[] = []
    let threadListRequests = 0
    let interactionListRequests = 0
    let pendingInteractionThreadIds: readonly string[] = []
    const source = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as (() => void) | null,
      close: () => {},
    }
    let subscriptionCount = 0
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      const params = body?.params ?? {}
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      if (body?.method === 'initialized') return new Response(null, { status: 204 })
      if (body?.method === 'initialize') return rpc(body.id, initializedResult())
      if (body?.method === 'event/subscribe') {
        subscriptionCount += 1
        return rpc(body.id, {
          subscriptionId: `subscription-${subscriptionCount}`,
          highWatermarks: [{ streamId: 'global', sequence: 12 }],
        })
      }
      if (body?.method === 'event/unsubscribe') {
        return rpc(body.id, { ok: true })
      }
      if (body?.method === 'event/ack') {
        return rpc(body.id, {
          subscriptionId: params.subscriptionId,
          acknowledged: params.positions,
        })
      }
      if (body?.method === 'interaction/listPending') {
        interactionListRequests += 1
        return rpc(body.id, {
          interactions: [
            {
              interactionId: 'hook-trust-1',
              threadId: 'session-2',
              turnId: 'turn-2',
              agentId: 'agent-2',
              createdAt: now,
              version: 1,
              kind: 'hookTrust',
              configPath: '.pidex/hooks.json',
              sha256: 'fixture-sha256',
              hook: {
                id: 'hook-1',
                name: 'Fixture hook',
                event: 'pre-tool',
                command: 'fixture-command',
              },
            },
            {
              interactionId: 'hook-trust-1',
              threadId: 'session-1',
              turnId: 'turn-1',
              agentId: 'agent-1',
              createdAt: now,
              version: 1,
              kind: 'hookTrust',
              configPath: '.pidex/hooks.json',
              sha256: 'fixture-sha256',
              hook: {
                id: 'hook-1',
                name: 'Fixture hook',
                event: 'pre-tool',
                command: 'fixture-command',
              },
            },
          ],
          nextCursor: null,
        })
      }
      if (body?.method === 'project/list') {
        return rpc(body.id, { projects: [project], nextCursor: null })
      }
      if (body?.method === 'thread/list') {
        threadListRequests += 1
        return rpc(body.id, {
          threads: [listItem('session-1', defaultSettings), listItem('session-2', defaultSettings)],
          nextCursor: null,
        })
      }
      if (body?.method === 'thread/read') {
        readThreadIds.push(params.threadId)
        return rpc(body.id, snapshotResult(snapshot(params.threadId, defaultSettings)))
      }
      throw new Error(`Unhandled RPC method: ${body?.method}`)
    }
    const client = createDesktopClient({
      fetch: fetcher,
      eventSourceFactory: () => source as unknown as EventSource,
    })
    await client.listSessions()
    const sharedGlobalEventIds: string[] = []
    const unsubscribeStore = client.onSessionStoreChange((change) => {
      pendingInteractionThreadIds = change.pendingInteractionThreadIds ?? []
    })
    const unsubscribeShared = client.subscribeAgentEventEnvelopes(
      { liveEventTypes: [] },
      (events) => {
        sharedGlobalEventIds.push(...events.map((event) => event.eventId))
      },
    )
    for (let index = 0; index < 20 && !source.onmessage; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    source.onmessage?.({
      data: JSON.stringify({
        jsonrpc: '2.0',
        method: 'event/next',
        params: {
          subscriptionId: 'subscription-1',
          event: {
            eventId: 'event-13',
            streamId: 'global',
            type: 'thread/updated',
            version: 1,
            occurredAt: now,
            durability: 'durable',
            sequence: 13,
            payload: {
              thread: snapshot('session-2', defaultSettings).thread,
              version: 1,
            },
          },
        },
      }),
    } as MessageEvent)
    for (let index = 0; index < 20 && interactionListRequests === 0; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    unsubscribeShared()
    unsubscribeStore()

    expect(subscriptionCount).toBe(1)
    expect(sharedGlobalEventIds).toEqual(['event-13'])
    expect(readThreadIds).toEqual([])
    expect(threadListRequests).toBe(2)
    expect(interactionListRequests).toBe(1)
    expect(pendingInteractionThreadIds).toEqual(['session-2', 'session-1'])
  })

  test('会话专用订阅在内容错误且无可恢复游标时停止并回调 onSubscriptionError', async () => {
    const sources: Array<{
      onmessage: ((event: MessageEvent) => void) | null
      onerror: (() => void) | null
      close: () => void
    }> = []
    let subscriptionCount = 0
    const fetcher = subscriptionFetcher(() => {
      subscriptionCount += 1
      return { subscriptionId: `subscription-${subscriptionCount}` }
    })
    const client = createDesktopClient({
      fetch: fetcher,
      eventSourceFactory: () => {
        const source = { onmessage: null, onerror: null, close: () => {} }
        sources.push(source)
        return source as unknown as EventSource
      },
    })
    const errors: unknown[] = []
    const unsubscribe = client.subscribeAgentEventEnvelopes(
      {
        threadId: 'session-1',
        after: 12,
        liveEventTypes: [],
        onDeliveryError: () => undefined,
        onSubscriptionError: (error) => errors.push(error),
      },
      () => {},
    )
    for (let index = 0; index < 40 && !sources[0]?.onmessage; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(subscriptionCount).toBe(1)

    sources[0]?.onmessage?.(malformedEventMessage('subscription-1') as MessageEvent)
    for (let index = 0; index < 40 && errors.length === 0; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    for (let index = 0; index < 10; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(Error)
    // No usable snapshot cursor means no resubscribe for this thread stream.
    expect(subscriptionCount).toBe(1)
    unsubscribe()
  })

  test('共享全局订阅停止恢复时向各监听器分发 onSubscriptionError', async () => {
    const sources: Array<{
      onmessage: ((event: MessageEvent) => void) | null
      onerror: (() => void) | null
      close: () => void
    }> = []
    let subscriptionCount = 0
    const fetcher = subscriptionFetcher(() => {
      subscriptionCount += 1
      return { subscriptionId: `subscription-${subscriptionCount}` }
    })
    const client = createDesktopClient({
      fetch: fetcher,
      eventSourceFactory: () => {
        const source = { onmessage: null, onerror: null, close: () => {} }
        sources.push(source)
        return source as unknown as EventSource
      },
    })
    const errors: unknown[] = []
    const unsubscribeShared = client.subscribeAgentEventEnvelopes({ liveEventTypes: [] }, () => {})
    const unsubscribeReporting = client.subscribeAgentEventEnvelopes(
      { liveEventTypes: [], onSubscriptionError: (error) => errors.push(error) },
      () => {},
    )
    for (let index = 0; index < 40 && !sources[0]?.onmessage; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    // Listeners stay on the single shared global subscription.
    expect(subscriptionCount).toBe(1)
    expect(sources[1]).toBeUndefined()

    sources[0]?.onmessage?.(malformedEventMessage('subscription-1') as MessageEvent)
    for (let index = 0; index < 60 && subscriptionCount < 2; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(subscriptionCount).toBe(2)

    sources[1]?.onmessage?.(malformedEventMessage('subscription-2') as MessageEvent)
    for (let index = 0; index < 40 && errors.length === 0; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    for (let index = 0; index < 10; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(Error)
    // Recovery stopped: the shared subscription is not resubscribed again.
    expect(subscriptionCount).toBe(2)
    unsubscribeReporting()
    unsubscribeShared()
  })

  test('reconciles the active thread after event replay completes', async () => {
    let completed = false
    const readThreadIds: string[] = []
    const observedStatuses: string[] = []
    const source = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as (() => void) | null,
      close: () => {},
    }
    const currentSnapshot = (): ThreadSnapshot => ({
      ...snapshot('session-1', defaultSettings),
      turns: [
        {
          id: 'turn-1',
          threadId: 'session-1',
          sourceInputID: 'input-1',
          status: completed ? 'completed' : 'running',
          mode: 'chat',
          model: { providerID: 'openai', id: 'gpt-5' },
          permissionConfig: defaultSettings.permissionConfig,
          rootAgentId: 'agent-1',
          mergedInputIDs: [],
          startedAt: now,
          finishedAt: completed ? now + 1_000 : null,
          elapsedSeconds: completed ? 1 : 0,
          error: null,
        },
      ],
    })
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      const params = body?.params ?? {}
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      if (body?.method === 'initialized') return new Response(null, { status: 204 })
      if (body?.method === 'initialize') return rpc(body.id, initializedResult())
      if (body?.method === 'event/subscribe') {
        expect(params).toEqual({
          streams: [{ streamId: 'global', after: 'latest' }],
          liveEventTypes: [
            'catalog/updated',
            'provider/credential/updated',
            'config/updated',
            'workspace/file/changed',
            'workspace/git/changed',
            'usage/source/updated',
            'model/health/updated',
            'skill/updated',
            'plugins/updated',
            'tooling/updated',
            'mcp/updated',
            'speech/statusChanged',
          ],
        })
        return rpc(body.id, {
          subscriptionId: 'subscription-1',
          highWatermarks: [{ streamId: 'global', sequence: 12 }],
        })
      }
      if (body?.method === 'event/unsubscribe') return rpc(body.id, { ok: true })
      if (body?.method === 'event/ack') {
        return rpc(body.id, {
          subscriptionId: params.subscriptionId,
          acknowledged: params.positions,
        })
      }
      if (body?.method === 'interaction/listPending') {
        return rpc(body.id, { interactions: [], nextCursor: null })
      }
      if (body?.method === 'project/list') {
        return rpc(body.id, { projects: [project], nextCursor: null })
      }
      if (body?.method === 'thread/list') {
        return rpc(body.id, {
          threads: [
            {
              ...listItem('session-1', defaultSettings),
              latestTurnStatus: completed ? 'completed' : 'running',
            },
          ],
          nextCursor: null,
        })
      }
      if (body?.method === 'thread/read') {
        readThreadIds.push(params.threadId)
        return rpc(body.id, snapshotResult(currentSnapshot()))
      }
      throw new Error(`Unhandled RPC method: ${body?.method}`)
    }
    const client = createDesktopClient({
      fetch: fetcher,
      eventSourceFactory: () => source as unknown as EventSource,
    })
    await client.listSessions()
    await client.setActiveSession('session-1')
    const unsubscribeStore = client.onSessionStoreChange((change) => {
      const status = change.sessions.find((item) => item.item.id === 'session-1')?.item.status
      if (status) observedStatuses.push(status)
    })
    for (let index = 0; index < 20 && !source.onmessage; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    completed = true
    source.onmessage?.({
      data: JSON.stringify({
        jsonrpc: '2.0',
        method: 'event/replayComplete',
        params: {
          subscriptionId: 'subscription-1',
          positions: [{ streamId: 'global', sequence: 12 }],
        },
      }),
    } as MessageEvent)
    for (let index = 0; index < 50 && !observedStatuses.includes('done'); index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    unsubscribeStore()

    expect(readThreadIds).toEqual(['session-1'])
    expect(observedStatuses).toContain('done')
  })

  test('does not let a stale running snapshot overwrite a completed lifecycle event', async () => {
    let completed = false
    let readRequests = 0
    let releaseStaleRead = () => {}
    const staleReadGate = new Promise<void>((resolve) => {
      releaseStaleRead = resolve
    })
    const observedStatuses: string[] = []
    let observedUnreadAt: string | null | undefined
    const source = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as (() => void) | null,
      close: () => {},
    }
    const runningSnapshot = (): ThreadSnapshot => ({
      ...snapshot('session-1', defaultSettings),
      turns: [
        {
          id: 'turn-1',
          threadId: 'session-1',
          sourceInputID: 'input-1',
          status: 'running',
          mode: 'chat',
          model: { providerID: 'openai', id: 'gpt-5' },
          permissionConfig: defaultSettings.permissionConfig,
          rootAgentId: 'agent-1',
          mergedInputIDs: [],
          startedAt: now,
          finishedAt: null,
          elapsedSeconds: 0,
          error: null,
        },
      ],
    })
    const completedTurn: ThreadSnapshot['turns'][number] = {
      ...runningSnapshot().turns[0]!,
      status: 'completed',
      finishedAt: now + 1_000,
      elapsedSeconds: 1,
    }
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      const params = body?.params ?? {}
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      if (body?.method === 'initialized') return new Response(null, { status: 204 })
      if (body?.method === 'initialize') return rpc(body.id, initializedResult())
      if (body?.method === 'event/subscribe') {
        return rpc(body.id, {
          subscriptionId: 'subscription-1',
          highWatermarks: [{ streamId: 'global', sequence: 12 }],
        })
      }
      if (body?.method === 'event/unsubscribe') return rpc(body.id, { ok: true })
      if (body?.method === 'event/ack') {
        return rpc(body.id, {
          subscriptionId: params.subscriptionId,
          acknowledged: params.positions,
        })
      }
      if (body?.method === 'interaction/listPending') {
        return rpc(body.id, { interactions: [], nextCursor: null })
      }
      if (body?.method === 'project/list') {
        return rpc(body.id, { projects: [project], nextCursor: null })
      }
      if (body?.method === 'thread/list') {
        return rpc(body.id, {
          threads: [
            {
              ...listItem('session-1', defaultSettings),
              latestTurnStatus: 'running',
              unreadAt: completed ? now + 1_000 : null,
            },
          ],
          nextCursor: null,
        })
      }
      if (body?.method === 'thread/read') {
        readRequests += 1
        const responseSnapshot = runningSnapshot()
        if (!completed) await staleReadGate
        return rpc(body.id, snapshotResult(responseSnapshot))
      }
      throw new Error(`Unhandled RPC method: ${body?.method}`)
    }
    const client = createDesktopClient({
      fetch: fetcher,
      eventSourceFactory: () => source as unknown as EventSource,
    })
    await client.listSessions()
    await client.setActiveSession('session-1')
    const unsubscribeStore = client.onSessionStoreChange((change) => {
      const item = change.sessions.find((item) => item.item.id === 'session-1')?.item
      const status = item?.status
      if (status) observedStatuses.push(status)
      observedUnreadAt = item?.unreadAt
    })
    for (let index = 0; index < 20 && !source.onmessage; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const staleRead = client.getSession('session-1')
    for (let index = 0; index < 20 && readRequests === 0; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    completed = true
    source.onmessage?.({
      data: JSON.stringify({
        jsonrpc: '2.0',
        method: 'event/next',
        params: {
          subscriptionId: 'subscription-1',
          event: {
            eventId: 'event-13',
            streamId: 'global',
            type: 'turn/completed',
            version: 2,
            occurredAt: now + 1_000,
            threadId: 'session-1',
            turnId: 'turn-1',
            durability: 'durable',
            sequence: 13,
            payload: { turn: completedTurn },
          },
        },
      }),
    } as MessageEvent)
    for (
      let index = 0;
      index < 50 && (!observedStatuses.includes('done') || readRequests < 2);
      index += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    releaseStaleRead()
    const staleResult = await staleRead
    await new Promise((resolve) => setTimeout(resolve, 0))

    const completedIndex = observedStatuses.indexOf('done')
    expect(completedIndex).toBeGreaterThanOrEqual(0)
    expect(observedStatuses.slice(completedIndex)).not.toContain('running')
    expect(staleResult?.item.status).toBe('done')
    expect(observedUnreadAt).toBe(new Date(now + 1_000).toISOString())

    const statusCountBeforeNextTurn = observedStatuses.length
    const nextTurn = {
      ...runningSnapshot().turns[0]!,
      id: 'turn-2',
      sourceInputID: 'input-2',
      startedAt: now + 2_000,
    }
    source.onmessage?.({
      data: JSON.stringify({
        jsonrpc: '2.0',
        method: 'event/next',
        params: {
          subscriptionId: 'subscription-1',
          event: {
            eventId: 'event-14',
            streamId: 'global',
            type: 'turn/started',
            version: 2,
            occurredAt: now + 2_000,
            threadId: 'session-1',
            turnId: 'turn-2',
            durability: 'durable',
            sequence: 14,
            payload: {
              turn: nextTurn,
              input: {
                id: 'input-2',
                threadId: 'session-1',
                turnId: 'turn-2',
                content: 'next turn',
                delivery: 'start',
                mode: 'chat',
                model: { providerID: 'openai', id: 'gpt-5' },
                permissionConfig: defaultSettings.permissionConfig,
                state: 'active',
                createdAt: now + 2_000,
              },
            },
          },
        },
      }),
    } as MessageEvent)
    for (
      let index = 0;
      index < 50 && !observedStatuses.slice(statusCountBeforeNextTurn).includes('running');
      index += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    unsubscribeStore()

    expect(observedStatuses.slice(statusCountBeforeNextTurn)).toContain('running')
  })

  test('routes GitHub auth, profile, repositories, push and PR creation through Agent RPC', async () => {
    const requests: Array<{ method: string; params: Record<string, unknown> }> = []
    const githubUser = {
      login: 'octocat',
      id: 1,
      name: 'Octocat',
      avatarUrl: null,
      htmlUrl: 'https://github.com/octocat',
    }
    const auth = { configured: true, authenticated: true, user: githubUser }
    const login = {
      loginId: 'login-1',
      mode: 'browser',
      state: 'awaiting_auth',
      authorizationUrl: 'https://github.com/login/oauth/authorize?client_id=fixture',
      userCode: null,
      verificationUri: null,
      expiresAt: '2026-07-18T00:00:00.000Z',
      error: null,
      auth: null,
      elapsedMs: 0,
    }
    const fetcher = async (_path: string, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      const params = body?.params ?? {}
      if (body?.method === 'initialized') return new Response(null, { status: 204 })
      if (body?.method !== 'initialize') {
        requests.push({ method: body.method, params })
      }
      switch (body?.method) {
        case 'initialize':
          return rpc(body.id, initializedResult())
        case 'github/auth/status':
          return rpc(body.id, auth)
        case 'github/auth/start':
        case 'github/auth/poll':
          return rpc(body.id, login)
        case 'github/auth/logout':
          return rpc(body.id, { configured: true, authenticated: false, user: null })
        case 'github/repositories':
          return rpc(body.id, { repositories: [] })
        case 'github/profileOverview':
          return rpc(body.id, {
            overview: {
              user: {
                ...githubUser,
                bio: null,
                company: null,
                location: null,
                websiteUrl: null,
                email: null,
                followers: 0,
                following: 0,
                repositoryCount: 0,
                starredRepositoryCount: 0,
                status: null,
              },
              organizations: [],
              pinnedRepositories: [],
              popularRepositories: [],
              contributions: {
                totalContributions: 0,
                totalCommitContributions: 0,
                totalIssueContributions: 0,
                totalPullRequestContributions: 0,
                totalPullRequestReviewContributions: 0,
                restrictedContributionsCount: 0,
                weeks: [],
              },
            },
          })
        case 'project/list':
          return rpc(body.id, { projects: [project], nextCursor: null })
        case 'project/open':
          return rpc(body.id, { project })
        case 'project/trust/read':
          return rpc(body.id, {
            projectRoot: projectRootPath,
            trustLevel: 'trusted',
            hasProjectConfig: true,
          })
        case 'github/push':
          return rpc(body.id, {
            remote: 'origin',
            branch: 'feature',
            repositoryUrl: 'https://github.com/octocat/repo',
            status: {
              branchName: 'feature',
              upstream: 'origin/feature',
              ahead: 0,
              behind: 0,
              clean: true,
              files: [],
            },
          })
        case 'github/pullRequest/createForProject':
          return rpc(body.id, {
            pullRequest: {
              id: 7,
              number: 7,
              title: 'PR title',
              body: 'PR body',
              state: 'open',
              draft: true,
              htmlUrl: 'https://github.com/octocat/repo/pull/7',
              base: { ref: 'main', sha: 'base-sha' },
              head: { ref: 'feature', sha: 'head-sha' },
              additions: 1,
              deletions: 0,
              changedFiles: 1,
              mergeable: true,
            },
          })
        default:
          throw new Error(`Unexpected RPC method: ${body?.method}`)
      }
    }
    const client = createDesktopClient({ fetch: fetcher })

    expect(await client.getGithubAuthStatus()).toEqual(auth)
    expect(await client.startGithubLogin({ mode: 'browser' })).toEqual(login)
    expect(await client.pollGithubLogin()).toEqual(login)
    expect(await client.listGithubRepositories()).toEqual({ ok: true, repositories: [] })
    expect(await client.getGithubProfileOverview()).toMatchObject({
      ok: true,
      overview: { user: { login: 'octocat' } },
    })
    await client.getGithubAuthStatus()
    await client.getGithubProfileOverview()
    expect(requests.filter((request) => request.method === 'github/profileOverview')).toHaveLength(
      1,
    )
    expect(client.getGithubAccountSnapshot().overview?.user.login).toBe('octocat')
    await client.getGithubProfileOverview({ force: true })
    expect(requests.filter((request) => request.method === 'github/profileOverview')).toHaveLength(
      2,
    )
    expect(
      await client.pushWorkspaceBranch({
        workspacePath: projectRootPath,
        setUpstream: true,
        forceWithLease: false,
      }),
    ).toMatchObject({ ok: true, status: { branchName: 'feature' } })
    expect(
      await client.createPullRequest({
        workspacePath: projectRootPath,
        title: 'PR title',
        body: 'PR body',
        draft: true,
      }),
    ).toEqual({
      ok: true,
      url: 'https://github.com/octocat/repo/pull/7',
      output: '已创建 Pull Request #7',
    })
    expect(await client.logoutGithub()).toEqual({
      configured: true,
      authenticated: false,
      user: null,
    })
    expect(client.getGithubAccountSnapshot().overview).toBeNull()

    expect(requests).toContainEqual({
      method: 'github/auth/start',
      params: { mode: 'browser' },
    })
    expect(requests).toContainEqual({
      method: 'github/push',
      params: {
        projectId: project.id,
        setUpstream: true,
        forceWithLease: false,
      },
    })
    expect(requests).toContainEqual({
      method: 'github/pullRequest/createForProject',
      params: {
        projectId: project.id,
        title: 'PR title',
        body: 'PR body',
        draft: true,
      },
    })
  })

  test('opens browser authorization URLs and preserves launch failures', async () => {
    const opened: string[] = []
    const login = {
      loginId: 'login-browser',
      mode: 'browser' as const,
      state: 'awaiting_auth' as const,
      authorizationUrl: 'https://github.com/login/oauth/authorize?client_id=fixture',
      userCode: null,
      verificationUri: null,
      expiresAt: '2026-07-25T10:00:00.000Z',
      error: null,
      auth: null,
      elapsedMs: 0,
    }

    expect(
      await startGithubLoginFlow(
        {
          startGithubLogin: async (input) => ({ ...login, mode: input.mode }),
          openExternalURL: async (url) => {
            opened.push(url)
          },
        },
        'browser',
      ),
    ).toEqual(login)
    expect(opened).toEqual([login.authorizationUrl])

    const failed = await startGithubLoginFlow(
      {
        startGithubLogin: async () => login,
        openExternalURL: async () => {
          throw new Error('无法打开系统浏览器')
        },
      },
      'browser',
    )
    expect(failed).toMatchObject({
      loginId: login.loginId,
      mode: 'browser',
      state: 'failed',
      error: '无法打开系统浏览器',
    })

    const missingUrl = await startGithubLoginFlow(
      {
        startGithubLogin: async () => ({ ...login, authorizationUrl: null }),
        openExternalURL: async () => {
          throw new Error('不应尝试打开空地址')
        },
      },
      'browser',
    )
    expect(missingUrl).toMatchObject({
      state: 'failed',
      error: 'GitHub 登录服务未返回浏览器授权地址，请稍后重试。',
    })

    expect(
      await startGithubLoginFlow(
        {
          startGithubLogin: async () => {
            throw new Error('登录服务不可用')
          },
          openExternalURL: async () => {},
        },
        'browser',
      ),
    ).toMatchObject({
      loginId: null,
      mode: 'browser',
      state: 'failed',
      error: '登录服务不可用',
    })
  })
})

function listItem(id: string, settings: ThreadSettings): ThreadListItem {
  return {
    id,
    projectID: project.id,
    gitBranch: null,
    workspace: projectWorkspace,
    title: 'Session',
    preview: null,
    firstUserMessage: null,
    messageCount: 0,
    latestTurnStatus: null,
    archivedAt: null,
    settings,
    createdAt: now,
    updatedAt: now,
  }
}

function snapshot(id: string, settings: ThreadSettings): ThreadSnapshot {
  return {
    thread: {
      id,
      title: 'Session',
      projectID: project.id,
      gitBranch: null,
      workspace: projectWorkspace,
      settings,
      createdAt: now,
      updatedAt: now,
    },
    turns: [],
    agents: [],
    subagents: [],
    inputs: [],
    messages: [],
    items: [],
    approvals: [],
    proposals: [],
  }
}

function snapshotResult(value: ThreadSnapshot) {
  return {
    snapshot: value,
    streamPosition: {
      streamId: value.thread.id,
      sequence: 1,
    },
  }
}

function modelCatalog() {
  return {
    providers: [
      {
        provider: {
          id: 'openai',
          name: 'OpenAI',
          source: {
            type: 'pi',
            kind: 'builtin',
            apis: ['openai-responses'],
          },
          auth: { apiKey: true, oauth: true },
        },
        models: [
          {
            id: 'gpt-5',
            providerID: 'openai',
            name: 'GPT-5',
            api: {
              id: 'gpt-5',
              type: 'pi',
              name: 'openai-responses',
              baseUrl: 'https://api.openai.com/v1',
            },
            capabilities: { tools: true, input: ['text'], output: ['text'] },
            variants: [],
            time: { released: now },
            cost: [],
            status: 'active',
            enabled: true,
            limit: { context: 128_000, output: 8_192 },
          },
        ],
      },
    ],
    defaultModel: { providerID: 'openai', id: 'gpt-5' },
    reviewerModel: null,
    catalogVersion: 1,
  }
}

function rpc(id: string | number, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'content-type': 'application/json' },
  })
}

/** Minimal event-stream RPC fetcher: handshake, subscribe, ack and unsubscribe. */
function subscriptionFetcher(subscribe: () => { subscriptionId: string }) {
  return async (path: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null
    const params = body?.params ?? {}
    if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
    if (body?.method === 'initialize') return rpc(body.id, initializedResult())
    if (body?.method === 'initialized') return new Response(null, { status: 204 })
    if (body?.method === 'event/subscribe') {
      return rpc(body.id, {
        ...subscribe(),
        highWatermarks: [{ streamId: 'global', sequence: 12 }],
      })
    }
    if (body?.method === 'event/unsubscribe') return rpc(body.id, { ok: true })
    if (body?.method === 'event/ack') {
      return rpc(body.id, {
        subscriptionId: params.subscriptionId,
        acknowledged: params.positions,
      })
    }
    if (body?.method === 'project/list') return rpc(body.id, { projects: [], nextCursor: null })
    if (body?.method === 'thread/list') return rpc(body.id, { threads: [], nextCursor: null })
    if (body?.method === 'interaction/listPending') {
      return rpc(body.id, { interactions: [], nextCursor: null })
    }
    throw new Error(`Unhandled RPC method: ${body?.method}`)
  }
}

/** A frame the client can never project: unsupported envelope version. */
function malformedEventMessage(subscriptionId: string) {
  return {
    data: JSON.stringify({
      jsonrpc: '2.0',
      method: 'event/next',
      params: {
        subscriptionId,
        event: {
          eventId: 'event-malformed',
          streamId: 'global',
          type: 'catalog/updated',
          version: 2,
          occurredAt: now,
          durability: 'live',
          sequence: null,
          afterSequence: 12,
          payload: {},
        },
      },
    }),
  }
}

function initializedResult() {
  return {
    protocol: 'thread-rpc-v4',
    serverInfo: { name: 'test-agent', version: '1.0.0' },
    capabilities: [
      'rpc.typed.v1',
      'events.replay.v1',
      'events.live.v1',
      'interactions.serverRequests.v1',
      'interaction.recovery.v1',
      'turn.admission.v1',
      'skills.invocation.v1',
      'turn.steer.v1',
      'turn.queue.management.v1',
      'attachments.v1',
      'local-context.paths.v1',
      'memory.v2',
      'workspace.editor.v1',
      'git.review.v1',
      'ai.review.v1',
      'github.oauth.v1',
      'github.pullRequests.v1',
      'context.compact.v1',
      'hooks.trust.v1',
      'subagents.v1',
      'sandbox.management.v1',
      'prompt.preview.sensitive.v1',
      'tooling.management.v1',
      'mcp.manage.v1',
      'mcp.oauth.v1',
      'config.manage.v1',
      'config.profiles.v1',
    ],
    limits: {
      maxFrameBytes: 1024,
      maxSubscriptions: 8,
      maxStreamsPerSubscription: 8,
      maxPendingRequests: 32,
    },
    connectionId: 'test-connection',
  }
}

test('聊天宽度经过桌面 bridge 保存并在新 client 中读取', async () => {
  const { defaultDesktopStoredSettings } = await import('../shared/SettingsSchema.js')
  let stored = defaultDesktopStoredSettings()
  const environment = {
    window: {
      DesktopBridge: {
        getDesktopSettings: async () => stored,
        saveDesktopSettings: async (settings: typeof stored) => {
          stored = settings
          return stored
        },
      },
    },
  }
  const client = createDesktopClient(environment)
  for (const conversationWidth of ['wide', 'narrow', 'default'] as const) {
    await client.saveDesktopSettings({ ...stored, conversationWidth })
    const reopened = createDesktopClient(environment)
    expect((await reopened.getDesktopSettings()).conversationWidth).toBe(conversationWidth)
  }
})

test('日程会话显示过滤经过桌面 bridge 保存并在新 client 中读取', async () => {
  const { defaultDesktopStoredSettings, normalizeDesktopStoredSettings } =
    await import('../shared/SettingsSchema.js')
  let stored = defaultDesktopStoredSettings()
  const environment = {
    window: {
      DesktopBridge: {
        getDesktopSettings: async () => stored,
        saveDesktopSettings: async (settings: typeof stored) => {
          stored = normalizeDesktopStoredSettings(settings)
          return stored
        },
      },
    },
  }
  const client = createDesktopClient(environment)
  expect((await client.getDesktopSettings()).sidebarShowScheduledSessions).toBe(true)
  for (const sidebarShowScheduledSessions of [false, true]) {
    await client.saveDesktopSettings({
      ...stored,
      sidebarShowScheduledSessions,
      sidebarActivityShowScheduled: !sidebarShowScheduledSessions,
    })
    const reopened = createDesktopClient(environment)
    expect((await reopened.getDesktopSettings()).sidebarActivityShowScheduled).toBe(
      !sidebarShowScheduledSessions,
    )
    expect((await reopened.getDesktopSettings()).sidebarShowScheduledSessions).toBe(
      sidebarShowScheduledSessions,
    )
  }
})
