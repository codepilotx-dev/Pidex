import { describe, expect, test } from 'bun:test'
import type { Project } from '@pidex/shared'
import type { ThreadListItem, ThreadSnapshot } from '@pidex/shared/thread'
import {
  createDesktopClient,
  type DesktopClientEnvironment,
} from '../src/services/desktop-client/index.js'
import {
  DEFAULT_DESKTOP_THEME_SETTINGS,
  resetAdvancedDesktopThemeSettings,
} from '../shared/Theme.js'

const now = 1_700_000_000_000
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
const secondaryFolder = {
  id: 'folder-secondary',
  name: 'Pidex-Docs',
  path: 'F:\\CodeProject\\Pidex-Docs',
  role: 'secondary' as const,
  availability: 'available' as const,
  order: 1,
  createdAt: now,
  updatedAt: now,
}
const defaultThreadSettings = {
  taskMode: 'chat' as const,
  permissionConfig: {
    sandboxMode: 'workspace-write' as const,
    approvalPolicy: 'on-request' as const,
    approvalsReviewer: 'user' as const,
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
    executionEnvironment: 'auto' as const,
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

function sessionItem(overrides: Partial<ThreadListItem> = {}): ThreadListItem {
  return {
    id: 'session-1',
    projectID: project.id,
    gitBranch: null,
    workspace: projectWorkspace,
    title: '历史会话',
    preview: '预览',
    firstUserMessage: '第一条消息',
    messageCount: 1,
    latestTurnStatus: 'completed',
    archivedAt: null,
    settings: defaultThreadSettings,
    createdAt: now,
    updatedAt: now + 1000,
    ...overrides,
  }
}

function sessionSnapshot(overrides: Partial<ThreadSnapshot['thread']> = {}): ThreadSnapshot {
  return {
    thread: {
      id: 'session-1',
      title: '历史会话',
      projectID: project.id,
      gitBranch: null,
      workspace: projectWorkspace,
      settings: defaultThreadSettings,
      createdAt: now,
      updatedAt: now + 1000,
      ...overrides,
    },
    turns: [],
    inputs: [
      {
        id: 'input-1',
        threadId: 'session-1',
        turnId: null,
        content: '第一条消息',
        delivery: 'start',
        mode: 'chat',
        model: { providerID: 'openai', id: 'gpt-5' },
        permissionConfig: {
          sandboxMode: 'workspace-write',
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        },
        state: 'completed',
        createdAt: now,
      },
    ],
    messages: [],
    items: [],
    approvals: [],
    proposals: [],
    agents: [],
    subagents: [],
  }
}

describe('desktop history client', () => {
  test('resets both theme variants and persists only advanced defaults', async () => {
    const defaults = structuredClone(DEFAULT_DESKTOP_THEME_SETTINGS)
    const settings = structuredClone(defaults)
    settings.mode = 'light'
    settings.codeThemeIds.dark = 'nord'
    settings.fontSizes = { ui: 16, code: 24 }
    settings.reduceMotion = 'on'
    settings.pointerCursorEnabled = !defaults.pointerCursorEnabled
    settings.fontSmoothingEnabled = !defaults.fontSmoothingEnabled
    for (const variant of ['light', 'dark'] as const) {
      const theme = settings.chromeThemes[variant]
      theme.accent = '#123456'
      theme.accentPreset = 'custom'
      theme.surface = '#234567'
      theme.ink = '#345678'
      theme.semanticColors.skill = '#456789'
      theme.contrast = 99
    }
    settings.fonts = {
      ui: 'Inter',
      uiFace: { family: 'Inter', fullName: 'Inter Bold', postscriptName: 'Inter-Bold' },
      code: 'CodeMono',
      codeFace: {
        family: 'CodeMono',
        fullName: 'CodeMono Bold',
        postscriptName: 'CodeMono-Bold',
      },
    }
    const before = structuredClone(settings)
    let stored = settings
    const client = createDesktopClient({
      window: {
        DesktopBridge: {
          pickWorkspaceDirectory: async () => null,
          getAppearanceSettings: async () => stored,
          saveAppearanceSettings: async (next) => {
            stored = next
            return next
          },
        },
      },
    })
    const reset = resetAdvancedDesktopThemeSettings(settings)
    expect(settings).toEqual(before)
    expect(DEFAULT_DESKTOP_THEME_SETTINGS).toEqual(defaults)
    expect(resetAdvancedDesktopThemeSettings(reset)).toEqual(reset)
    await client.saveThemeSettings(reset)
    const reloaded = await client.getThemeSettings()
    expect(reloaded).toMatchObject({
      mode: before.mode,
      codeThemeIds: before.codeThemeIds,
      fontSizes: defaults.fontSizes,
      reduceMotion: defaults.reduceMotion,
      pointerCursorEnabled: defaults.pointerCursorEnabled,
      fontSmoothingEnabled: defaults.fontSmoothingEnabled,
    })
    for (const variant of ['light', 'dark'] as const) {
      expect(reloaded.chromeThemes[variant]).toEqual({
        ...before.chromeThemes[variant],
        contrast: defaults.chromeThemes[variant].contrast,
        fonts: { ...defaults.fonts, ui: 'Inter' },
      })
    }
    expect(reloaded.fonts).toEqual({ ...defaults.fonts, ui: 'Inter' })
  })

  test('persists appearance settings through the minimal Electron bridge', async () => {
    let stored: unknown = {
      version: 2,
      mode: 'dark',
      codeThemeIds: { light: 'auto', dark: 'dracula' },
      pointerCursorEnabled: true,
      reduceMotion: 'on',
      fontSizes: { ui: 15, code: 13 },
    }
    const environment: DesktopClientEnvironment = {
      window: {
        DesktopBridge: {
          pickWorkspaceDirectory: async () => null,
          getAppearanceSettings: async () => stored,
          saveAppearanceSettings: async (settings) => {
            stored = settings
            return settings
          },
        },
      },
    }
    const client = createDesktopClient(environment)

    const loaded = await client.getThemeSettings()
    expect(loaded).toMatchObject({
      version: 8,
      mode: 'system',
      codeThemeIds: { light: 'codex-new-light', dark: 'codex-new-dark' },
    })
    expect(loaded.chromeThemes.light).not.toHaveProperty('opaqueWindows')

    await client.saveThemeSettings({ ...loaded, mode: 'light' })
    expect(stored).toMatchObject({ version: 8, mode: 'light' })
    await client.saveThemeSettings({
      ...loaded,
      chromeThemes: {
        light: { ...loaded.chromeThemes.light, accent: '#000000', accentPreset: 'default' },
        dark: { ...loaded.chromeThemes.dark, accent: '#FFFFFF', accentPreset: 'black' },
      },
    })
    const reloaded = await createDesktopClient(environment).getThemeSettings()
    expect(reloaded.chromeThemes.light).toMatchObject({
      accent: '#000000',
      accentPreset: 'default',
    })
    expect(reloaded.chromeThemes.dark).toMatchObject({ accent: '#ffffff', accentPreset: 'black' })
  })

  test('saves accent presets through config key paths while preserving unknown settings', async () => {
    const appearance: Record<string, unknown> = {
      ...structuredClone(DEFAULT_DESKTOP_THEME_SETTINGS),
      unknownField: 'kept',
    }
    const edits: Array<{ keyPath: string[]; value: unknown }> = []
    const version = 'a'.repeat(64)
    const client = createDesktopClient({
      fetch: async (_path, init) => {
        const body = JSON.parse(String(init?.body))
        if (body.method === 'initialize') return rpc(body.id, initializedResult())
        if (body.method === 'initialized') return new Response(null, { status: 204 })
        if (body.method === 'config/read')
          return rpc(body.id, {
            config: { desktop: { appearance } },
            origins: {},
            diagnostics: [],
            profileState: { activeProfile: null, selectedProfile: null, restartRequired: false },
            layers: [
              {
                kind: 'user',
                displayName: 'User',
                version,
                writable: true,
                trusted: true,
                config: {},
              },
            ],
          })
        if (body.method === 'config/batchWrite') {
          expect(body.params.expectedVersion).toBe(version)
          edits.push(...body.params.edits)
          for (const edit of edits) {
            expect(edit.keyPath.slice(0, 2)).toEqual(['desktop', 'appearance'])
            const keys = edit.keyPath.slice(2)
            let target = appearance
            for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>
            target[keys.at(-1)!] = edit.value
          }
          return rpc(body.id, { status: 'ok', version, filePath: 'config.toml' })
        }
        throw new Error(`Unexpected RPC method: ${body.method}`)
      },
    })
    await client.getRuntimeCapabilities()
    const loaded = await client.getThemeSettings()
    await client.saveThemeSettings({
      ...loaded,
      chromeThemes: {
        ...loaded.chromeThemes,
        light: { ...loaded.chromeThemes.light, accent: '#3566F0', accentPreset: 'blue' },
      },
    })
    expect(edits).toContainEqual({
      keyPath: ['desktop', 'appearance', 'chromeThemes', 'light', 'accentPreset'],
      value: 'blue',
    })
    expect(appearance.unknownField).toBe('kept')
    expect((await client.getThemeSettings()).chromeThemes.light).toMatchObject({
      accent: '#3566f0',
      accentPreset: 'blue',
    })
  })

  test('never batch-writes over a newer Agent appearance generation', async () => {
    const rpcMethods: string[] = []
    const futureAppearance = {
      version: 9,
      mode: 'dark',
      futureField: 'must-survive',
    }
    const fetcher = async (_path: string, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      rpcMethods.push(body?.method)
      if (body?.method === 'initialize') return rpc(body.id, initializedResult())
      if (body?.method === 'initialized') return new Response(null, { status: 204 })
      if (body?.method === 'config/read') {
        return rpc(body.id, {
          config: { desktop: { appearance: futureAppearance } },
          layers: [{ kind: 'user', version: 'future-config' }],
        })
      }
      throw new Error(`Unexpected RPC method: ${body?.method}`)
    }
    const client = createDesktopClient({ fetch: fetcher })
    await client.getRuntimeCapabilities()
    const fallback = await client.getThemeSettings()

    await client.saveThemeSettings({ ...fallback, mode: 'light' })

    expect(rpcMethods.filter((method) => method === 'config/read')).toHaveLength(2)
    expect(rpcMethods).not.toContain('config/batchWrite')
  })

  test('uses agent fetch for list, create, get, message, rename, archive, and delete', async () => {
    const requests: Array<{ path: string; method: string; body: unknown }> = []
    let currentItem = sessionItem({ unreadAt: now + 500 })
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : null
      requests.push({ path, method, body })

      if (path !== '/rpc') throw new Error(`Unhandled request: ${method} ${path}`)
      const rpcMethod = body?.method
      const params = body?.params ?? {}
      if (rpcMethod === 'initialize') return rpc(body.id, initializedResult())
      if (rpcMethod === 'initialized') return new Response(null, { status: 204 })
      if (rpcMethod === 'project/list') {
        return rpc(body.id, { projects: [project], nextCursor: null })
      }
      if (rpcMethod === 'project/open') {
        expect(params).toEqual({
          projectId: project.id,
          operationId: expect.any(String),
        })
        return rpc(body.id, { project })
      }
      if (rpcMethod === 'thread/list') {
        return rpc(body.id, { threads: [currentItem], nextCursor: null })
      }
      if (rpcMethod === 'thread/create') {
        expect(params).toEqual({
          workspace: { kind: 'project', projectId: project.id },
          settings: defaultThreadSettings,
          title: '新会话',
          operationId: expect.any(String),
        })
        return rpc(body.id, snapshotResult(sessionSnapshot({ title: '新会话' })))
      }
      if (rpcMethod === 'thread/read') {
        return rpc(body.id, snapshotResult(sessionSnapshot()))
      }
      if (rpcMethod === 'model/list') {
        return rpc(body.id, {
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
        })
      }
      if (rpcMethod === 'turn/start') {
        expect(params).toMatchObject({
          threadId: 'session-1',
          inputId: expect.any(String),
          content: '继续推进',
          model: { providerID: 'anthropic', id: 'claude-opus-4-1' },
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user',
          },
          taskMode: 'chat',
        })
        return rpc(body.id, {
          inputId: 'input-2',
          turnId: 'turn-2',
          disposition: 'accepted',
          streamPosition: {
            streamId: 'session-1',
            sequence: 2,
          },
        })
      }
      if (rpcMethod === 'thread/update') {
        if (params.patch?.title) currentItem = sessionItem({ title: params.patch.title })
        if (params.patch?.archived === true) {
          currentItem = sessionItem({ archivedAt: now + 3000 })
        }
        return rpc(body.id, { thread: currentItem })
      }
      if (rpcMethod === 'thread/mark-read') {
        expect(params).toEqual({
          threadId: 'session-1',
          readThroughAt: now + 500,
          operationId: expect.any(String),
        })
        currentItem = { ...currentItem, unreadAt: null }
        return rpc(body.id, { thread: currentItem })
      }
      if (rpcMethod === 'thread/mark-unread') {
        expect(params).toEqual({
          threadId: 'session-1',
          unreadAt: now + 600,
          operationId: expect.any(String),
        })
        currentItem = { ...currentItem, unreadAt: now + 600 }
        return rpc(body.id, { thread: currentItem })
      }
      if (rpcMethod === 'thread/title/regenerate') {
        currentItem = sessionItem({ title: '自动更新后的标题' })
        return rpc(body.id, { thread: currentItem })
      }
      if (rpcMethod === 'thread/delete') {
        currentItem = sessionItem({ id: 'deleted' })
        return rpc(body.id, {
          threadId: params.threadId,
          deletedAt: now + 4000,
        })
      }
      if (rpcMethod === 'project/trust/read') {
        return rpc(body.id, {
          projectRoot: projectRootPath,
          trustLevel: 'trusted',
          hasProjectConfig: true,
        })
      }
      throw new Error(`Unhandled RPC method: ${rpcMethod}`)
    }

    const client = createDesktopClient({ fetch: fetcher })

    const listed = await client.listSessions()
    expect(listed[0]?.item.workspacePath).toBe(projectRootPath)
    expect(listed[0]?.item.unreadAt).toBe(new Date(now + 500).toISOString())

    const read = await client.markSessionRead('session-1', new Date(now + 500).toISOString())
    expect(read.unreadAt).toBeNull()
    currentItem = { ...currentItem, unreadAt: now + 500 }
    expect((await client.listSessions())[0]?.item.unreadAt).toBeNull()

    const unread = await client.markSessionUnread('session-1', new Date(now + 600).toISOString())
    expect(unread.unreadAt).toBe(new Date(now + 600).toISOString())

    const created = await client.createSession({
      workspacePath: projectRootPath,
      sessionName: '新会话',
    })
    expect(created).toMatchObject({ sessionId: 'session-1', standalone: false })

    const snapshot = await client.getSession('session-1')
    expect(snapshot.view.messages[0]?.text).toBe('第一条消息')
    snapshot.item.customTitle = '旧手工标题'
    snapshot.item.aiTitle = '旧 AI 标题'

    // The next turn must use the new selection, not the OpenAI model in history.
    await client.sendUserMessage(
      'session-1',
      { text: '继续推进' },
      {
        providerID: 'anthropic',
        model: 'claude-opus-4-1',
      },
    )
    expect(
      requests.some(
        (request) => (request.body as { method?: string } | null)?.method === 'model/list',
      ),
    ).toBe(false)

    let renamedStoreItem: Awaited<ReturnType<typeof client.getSession>>['item'] | null = null
    const unsubscribe = client.onSessionStoreChange((change) => {
      renamedStoreItem =
        change.sessions.find((candidate) => candidate.item.id === 'session-1')?.item ?? null
    })
    const renamed = await client.renameSession('session-1', '改名后')
    unsubscribe()
    expect(renamed.item.sessionName).toBe('改名后')
    expect(renamed.item.customTitle).toBeNull()
    expect(renamed.item.aiTitle).toBeNull()
    expect(renamedStoreItem).toMatchObject({
      sessionName: '改名后',
      customTitle: null,
      aiTitle: null,
    })
    expect(renamed.item.lastMessageAt).toBe(new Date(now + 1000).toISOString())

    const regenerated = await client.regenerateSessionTitle('session-1')
    expect(regenerated.item.sessionName).toBe('自动更新后的标题')
    expect(regenerated.item.lastMessageAt).toBe(new Date(now + 1000).toISOString())
    expect(
      requests
        .map((request) => request.body)
        .find((body) => body?.method === 'thread/title/regenerate')?.params,
    ).toMatchObject({
      threadId: 'session-1',
      operationId: expect.any(String),
    })

    const archived = await client.updateSessionMetadata('session-1', {
      archivedAt: new Date(now + 3000).toISOString(),
    })
    expect(archived.item.archivedAt).toBe('2023-11-14T22:13:23.000Z')

    await client.disposeSession('session-1')
    expect(
      requests.map((request) => request.body).some((body) => body?.method === 'thread/delete'),
    ).toBe(true)
  })

  test('responds to dynamic permission requests with grant/deny and the chosen scope', async () => {
    const respondRequests: Array<Record<string, unknown>> = []
    const pendingInteraction = {
      kind: 'permission' as const,
      interactionId: 'permission-1',
      threadId: 'session-1',
      turnId: 'turn-1',
      agentId: 'agent-1',
      createdAt: now,
      version: 1,
      toolCallId: 'call-perm',
      tool: 'request_permissions',
      reason: '需要额外权限',
      requestedPermissions: {
        readPaths: ['C:\\workspace\\docs'],
        writePaths: ['C:\\workspace\\out'],
        networkDomains: ['api.example.com'],
      },
      requestedScope: 'turn' as const,
      allowedScopes: ['tool-call', 'turn'] as const,
      risk: 'high' as const,
    }
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${init?.method} ${path}`)
      const body = init?.body ? JSON.parse(String(init.body)) : null
      const rpcMethod = body?.method
      if (rpcMethod === 'initialize') return rpc(body.id, initializedResult())
      if (rpcMethod === 'initialized') return new Response(null, { status: 204 })
      if (rpcMethod === 'interaction/listPending') {
        return rpc(body.id, { interactions: [pendingInteraction], nextCursor: null })
      }
      if (rpcMethod === 'interaction/respond') {
        respondRequests.push(body.params)
        return rpc(body.id, {
          interactionId: 'permission-1',
          kind: 'permission',
          state: 'resolved',
          version: 2,
          resolvedAt: now + 100,
          response: body.params.response,
        })
      }
      if (rpcMethod === 'thread/read') return rpc(body.id, snapshotResult(sessionSnapshot()))
      if (rpcMethod === 'project/list')
        return rpc(body.id, { projects: [project], nextCursor: null })
      if (rpcMethod === 'thread/list')
        return rpc(body.id, { threads: [sessionItem()], nextCursor: null })
      throw new Error(`Unhandled RPC method: ${rpcMethod}`)
    }
    const client = createDesktopClient({ fetch: fetcher })

    await client.respondToPermission('session-1', 'permission-1', {
      behavior: 'allow',
      grantScope: 'tool-call',
    })
    expect(respondRequests[0]).toMatchObject({
      interactionId: 'permission-1',
      expectedVersion: 1,
      response: {
        kind: 'permission',
        decision: 'grant',
        scope: 'tool-call',
        grantedPermissions: {
          readPaths: ['C:\\workspace\\docs'],
          writePaths: ['C:\\workspace\\out'],
          networkDomains: ['api.example.com'],
        },
      },
    })

    // Deny sends a bare permission deny response without any grant payload.
    respondRequests.length = 0
    await client.respondToPermission('session-1', 'permission-1', { behavior: 'deny' })
    expect(respondRequests[0]).toMatchObject({
      response: { kind: 'permission', decision: 'deny' },
    })

    // Granting a scope outside allowedScopes must fail before any RPC is sent.
    respondRequests.length = 0
    await expect(
      client.respondToPermission('session-1', 'permission-1', {
        behavior: 'allow',
        grantScope: 'session',
      }),
    ).rejects.toThrow('不在 Agent 允许的范围内')
    expect(respondRequests).toHaveLength(0)
  })

  test('responds to a projected question by its interaction id', async () => {
    const respondRequests: Array<Record<string, unknown>> = []
    const pendingInteraction = {
      kind: 'question' as const,
      interactionId: 'question-request-1',
      threadId: 'session-1',
      turnId: 'turn-1',
      agentId: 'agent-1',
      createdAt: now,
      version: 1,
      questions: [
        {
          id: 'filter_mode',
          header: '筛选模式',
          prompt: '状态筛选使用单选还是多选？',
          choices: [
            { id: 'single', label: '单选', description: '一次选择一个状态', recommended: true },
            { id: 'multiple', label: '多选', description: '可选择多个状态', recommended: false },
          ],
          allowFreeform: true,
          required: true,
        },
      ],
    }
    const client = createDesktopClient({
      fetch: async (path, init) => {
        if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
        const body = init?.body ? JSON.parse(String(init.body)) : null
        if (body?.method === 'initialize') return rpc(body.id, initializedResult())
        if (body?.method === 'initialized') return new Response(null, { status: 204 })
        if (body?.method === 'interaction/listPending') {
          return rpc(body.id, { interactions: [pendingInteraction], nextCursor: null })
        }
        if (body?.method === 'interaction/respond') {
          respondRequests.push(body.params)
          return rpc(body.id, {
            interactionId: pendingInteraction.interactionId,
            kind: 'question',
            state: 'resolved',
            version: 2,
            resolvedAt: now + 100,
            response: body.params.response,
          })
        }
        throw new Error(`Unhandled RPC method: ${body?.method}`)
      },
    })

    await client.respondToPermission('session-1', 'question:question-request-1', {
      behavior: 'allow',
      updatedInput: { questionAnswers: [{ questionId: 'filter_mode', choiceIds: ['single'] }] },
    })

    expect(respondRequests).toEqual([
      expect.objectContaining({
        interactionId: 'question-request-1',
        expectedVersion: 1,
        response: {
          kind: 'question',
          status: 'answered',
          resolution: 'user',
          answers: [{ questionId: 'filter_mode', choiceIds: ['single'] }],
        },
      }),
    ])
  })

  test('responds to hook trust through the typed hookTrust decision', async () => {
    const responses: Array<Record<string, unknown>> = []
    const pendingInteraction = {
      kind: 'hookTrust',
      interactionId: 'hook-trust-1',
      threadId: 'session-1',
      turnId: 'turn-1',
      agentId: 'agent-1',
      createdAt: now,
      version: 3,
      configPath: '.pidex/hooks.json',
      sha256: 'fixture-sha256',
      hook: {
        id: 'hook-1',
        name: 'Pre tool hook',
        event: 'pre-tool',
        command: 'fixture-command',
      },
    }
    const client = createDesktopClient({
      fetch: async (path, init) => {
        if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
        const body = init?.body ? JSON.parse(String(init.body)) : null
        if (body?.method === 'initialize') return rpc(body.id, initializedResult())
        if (body?.method === 'initialized') return new Response(null, { status: 204 })
        if (body?.method === 'interaction/listPending') {
          return rpc(body.id, {
            interactions: [pendingInteraction],
            nextCursor: null,
          })
        }
        if (body?.method === 'interaction/respond') {
          responses.push(body.params)
          return rpc(body.id, {
            interactionId: pendingInteraction.interactionId,
            kind: 'hookTrust',
            state: 'resolved',
            version: 4,
            resolvedAt: now + 1,
            response: body.params.response,
          })
        }
        throw new Error(`Unhandled RPC method: ${body?.method}`)
      },
    })

    await client.respondToPermission('session-1', 'hook-trust-1', {
      behavior: 'allow',
    })
    await client.respondToPermission('session-1', 'hook-trust-1', {
      behavior: 'deny',
    })

    expect(responses.map((response) => response.response)).toEqual([
      { kind: 'hookTrust', decision: 'allow' },
      { kind: 'hookTrust', decision: 'block' },
    ])
    expect(responses[0]).toMatchObject({
      interactionId: 'hook-trust-1',
      expectedVersion: 3,
      operationId: expect.any(String),
    })
  })

  test('falls back to browser mock when agent is unavailable', async () => {
    const client = createDesktopClient({
      fetch: async () => new Response('nope', { status: 503 }),
    })

    const created = await client.createSession({ sessionName: 'mock only' })

    expect(created.sessionId).toStartWith('browser-mock-')
    expect(created.standalone).toBe(true)
    await expect(
      client.listPendingAgentInteractions({
        threadId: created.sessionId,
        limit: 500,
      }),
    ).resolves.toEqual({ interactions: [], nextCursor: null })
  })

  test('restores authoritative unread state when mark-read fails', async () => {
    const unreadItem = sessionItem({ unreadAt: now + 500 })
    const client = createDesktopClient({
      fetch: async (_path, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) : null
        if (body?.method === 'initialize') {
          return rpc(body.id, initializedResult())
        }
        if (body?.method === 'initialized') {
          return new Response(null, { status: 204 })
        }
        if (body?.method === 'project/list') {
          return rpc(body.id, { projects: [project], nextCursor: null })
        }
        if (body?.method === 'thread/list') {
          return rpc(body.id, { threads: [unreadItem], nextCursor: null })
        }
        if (body?.method === 'thread/mark-read') {
          return new Response('mark read failed', { status: 500 })
        }
        throw new Error(`Unhandled RPC method: ${body?.method}`)
      },
    })

    await client.listSessions()
    await expect(
      client.markSessionRead('session-1', new Date(now + 500).toISOString()),
    ).rejects.toThrow()
    expect((await client.listSessions())[0]?.item.unreadAt).toBe(new Date(now + 500).toISOString())
  })

  test('restores authoritative read state when mark-unread fails', async () => {
    const readItem = sessionItem({ unreadAt: null })
    let optimisticUnreadAt: string | null | undefined
    const client = createDesktopClient({
      fetch: async (_path, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) : null
        if (body?.method === 'initialize') {
          return rpc(body.id, initializedResult())
        }
        if (body?.method === 'initialized') {
          return new Response(null, { status: 204 })
        }
        if (body?.method === 'project/list') {
          return rpc(body.id, { projects: [project], nextCursor: null })
        }
        if (body?.method === 'thread/list') {
          return rpc(body.id, { threads: [readItem], nextCursor: null })
        }
        if (body?.method === 'thread/mark-unread') {
          return new Response('mark unread failed', { status: 500 })
        }
        throw new Error(`Unhandled RPC method: ${body?.method}`)
      },
    })

    await client.listSessions()
    const unsubscribe = client.onSessionStoreChange((change) => {
      const unreadAt = change.sessions.find((session) => session.item.id === 'session-1')?.item
        .unreadAt
      if (unreadAt) optimisticUnreadAt ??= unreadAt
    })
    await expect(
      client.markSessionUnread('session-1', new Date(now + 600).toISOString()),
    ).rejects.toThrow()
    unsubscribe()
    expect(optimisticUnreadAt).toBe(new Date(now + 600).toISOString())
    expect((await client.listSessions())[0]?.item.unreadAt).toBeNull()
  })

  test('selects a workspace through preload, trusts imported folders and persists desktop settings', async () => {
    const openedPaths: string[] = []
    const trustRequests: Array<{ method: string; cwd: string }> = []
    let storedSettings: unknown = null
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = init?.body ? JSON.parse(String(init.body)) : null
      const params = body?.params ?? {}
      if (body?.method === 'initialize') return rpc(body.id, initializedResult())
      if (body?.method === 'initialized') return new Response(null, { status: 204 })
      if (body?.method === 'project/list') {
        return rpc(body.id, { projects: [project], nextCursor: null })
      }
      if (body?.method === 'project/open') {
        openedPaths.push(params.projectId)
        return rpc(body.id, { project })
      }
      if (body?.method === 'project/trust/read') {
        trustRequests.push({ method: body.method, cwd: params.cwd })
        return rpc(body.id, {
          projectRoot: params.cwd,
          trustLevel: 'untrusted',
          hasProjectConfig: false,
        })
      }
      if (body?.method === 'project/trust/update') {
        trustRequests.push({ method: body.method, cwd: params.cwd })
        return rpc(body.id, {
          status: 'ok',
          version: 'a'.repeat(64),
          filePath: 'F:\\CodeProject\\config.json',
        })
      }
      if (body?.method === 'project/folder/add') {
        return rpc(body.id, {
          project: { ...project, folders: [primaryFolder, secondaryFolder] },
          changed: true,
        })
      }
      throw new Error(`Unhandled RPC method: ${body?.method}`)
    }
    const client = createDesktopClient({
      fetch: fetcher,
      window: {
        DesktopBridge: {
          pickWorkspaceDirectory: async () => projectRootPath,
          getDesktopSettings: async () => storedSettings,
          saveDesktopSettings: async (settings) => {
            storedSettings = settings
            return settings
          },
        },
      },
    })

    const selected = await client.chooseWorkspace()
    expect(selected).toEqual({
      id: project.id,
      path: projectRootPath,
      name: project.name,
      branchName: null,
      lastOpenedAt: '2023-11-14T22:13:20.000Z',
      projectId: project.id,
      projectVersion: project.updatedAt,
      primaryFolderId: primaryFolder.id,
      folders: [primaryFolder],
      projectSettings: project.settings,
    })
    await client.openWorkspace(projectRootPath)
    await client.getWorkspaceContext(projectRootPath)
    await client.addProjectFolder(project.id, secondaryFolder.path)
    expect(openedPaths).toEqual([project.id, project.id, project.id])
    expect(trustRequests).toEqual([
      { method: 'project/trust/read', cwd: primaryFolder.path },
      { method: 'project/trust/update', cwd: primaryFolder.path },
      { method: 'project/trust/read', cwd: secondaryFolder.path },
      { method: 'project/trust/update', cwd: secondaryFolder.path },
    ])

    const defaults = await client.getDesktopSettings()
    expect(defaults.recentWorkspaces).toEqual([])
    expect(defaults.defaultModeRequestUserInput).toBe(false)
    const saved = await client.saveDesktopSettings({
      ...defaults,
      recentWorkspaces: [selected!],
      lastActiveWorkspacePath: projectRootPath,
      defaultModeRequestUserInput: true,
    })
    expect(saved.lastActiveWorkspacePath).toBe(projectRootPath)
    expect(saved.defaultModeRequestUserInput).toBe(true)
    const restored = await client.getDesktopSettings()
    expect(restored.recentWorkspaces).toHaveLength(1)
    expect(restored.recentWorkspaces[0]).toMatchObject({
      path: projectRootPath,
      name: project.name,
      projectId: project.id,
      primaryFolderId: primaryFolder.id,
      folders: [primaryFolder],
      projectSettings: project.settings,
    })
    expect(restored.defaultModeRequestUserInput).toBe(true)
  })

  test('does not rewrite a project source that is already trusted', async () => {
    const methods: string[] = []
    const client = createDesktopClient({
      fetch: async (path, init) => {
        if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
        const body = init?.body ? JSON.parse(String(init.body)) : null
        if (body?.method === 'initialize') return rpc(body.id, initializedResult())
        if (body?.method === 'initialized') return new Response(null, { status: 204 })
        methods.push(body.method)
        if (body?.method === 'project/list') {
          return rpc(body.id, { projects: [project], nextCursor: null })
        }
        if (body?.method === 'project/open') return rpc(body.id, { project })
        if (body?.method === 'project/trust/read') {
          return rpc(body.id, {
            projectRoot: projectRootPath,
            trustLevel: 'trusted',
            hasProjectConfig: true,
          })
        }
        throw new Error(`Unhandled RPC method: ${body?.method}`)
      },
      window: {
        DesktopBridge: {
          pickWorkspaceDirectory: async () => projectRootPath,
        },
      },
    })

    await expect(client.chooseWorkspace()).resolves.toMatchObject({
      projectId: project.id,
    })
    expect(methods).not.toContain('project/trust/update')
  })

  test('does not return a newly registered project when automatic trust fails', async () => {
    const methods: string[] = []
    const client = createDesktopClient({
      fetch: async (path, init) => {
        if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
        const body = init?.body ? JSON.parse(String(init.body)) : null
        if (body?.method === 'initialize') return rpc(body.id, initializedResult())
        if (body?.method === 'initialized') return new Response(null, { status: 204 })
        methods.push(body.method)
        if (body?.method === 'project/list') {
          return rpc(body.id, { projects: [], nextCursor: null })
        }
        if (body?.method === 'project/create') return rpc(body.id, { project })
        if (body?.method === 'project/trust/read') {
          return rpc(body.id, {
            projectRoot: projectRootPath,
            trustLevel: 'untrusted',
            hasProjectConfig: false,
          })
        }
        if (body?.method === 'project/trust/update') {
          return new Response('trust write failed', { status: 500 })
        }
        throw new Error(`Unhandled RPC method: ${body?.method}`)
      },
      window: {
        DesktopBridge: {
          pickWorkspaceDirectory: async () => projectRootPath,
        },
      },
    })

    await expect(client.chooseWorkspace()).rejects.toThrow()
    expect(methods).toContain('project/create')
    expect(methods).not.toContain('project/remove')
  })

  test('coalesces identical desktop settings saves and serializes distinct snapshots', async () => {
    const savedSessionNames: Array<string | undefined> = []
    let releaseFirstSave: (() => void) | undefined
    const firstSaveGate = new Promise<void>((resolve) => {
      releaseFirstSave = resolve
    })
    let failRetryOnce = true
    const client = createDesktopClient({
      window: {
        DesktopBridge: {
          getDesktopSettings: async () => null,
          saveDesktopSettings: async (settings) => {
            savedSessionNames.push(settings.sessionName)
            if (settings.sessionName === 'first') await firstSaveGate
            if (settings.sessionName === 'retry' && failRetryOnce) {
              failRetryOnce = false
              throw new Error('retryable save failure')
            }
            return settings
          },
        },
      },
    })
    const defaults = await client.getDesktopSettings()
    const firstSnapshot = { ...defaults, sessionName: 'first' }
    const secondSnapshot = { ...defaults, sessionName: 'second' }

    const firstSave = client.saveDesktopSettings(firstSnapshot)
    const duplicateSave = client.saveDesktopSettings({ ...firstSnapshot })
    const secondSave = client.saveDesktopSettings(secondSnapshot)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(savedSessionNames).toEqual(['first'])

    releaseFirstSave?.()
    expect(await firstSave).toEqual(await duplicateSave)
    expect((await secondSave).sessionName).toBe('second')
    expect(savedSessionNames).toEqual(['first', 'second'])

    await expect(
      client.saveDesktopSettings({
        ...defaults,
        sessionName: 'retry',
      }),
    ).rejects.toThrow('retryable save failure')
    expect(
      (
        await client.saveDesktopSettings({
          ...defaults,
          sessionName: 'retry',
        })
      ).sessionName,
    ).toBe('retry')
    expect(savedSessionNames).toEqual(['first', 'second', 'retry', 'retry'])
  })

  test('does not open a project when workspace selection is cancelled', async () => {
    const client = createDesktopClient({
      fetch: async () => {
        throw new Error('RPC should not be called')
      },
      window: {
        DesktopBridge: {
          pickWorkspaceDirectory: async () => null,
        },
      },
    })

    expect(await client.chooseWorkspace()).toBeNull()
  })
})

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function rpc(id: string | number, result: unknown): Response {
  return json({ jsonrpc: '2.0', id, result })
}

function snapshotResult(snapshot: ThreadSnapshot) {
  return {
    snapshot,
    streamPosition: {
      streamId: snapshot.thread.id,
      sequence: 1,
    },
  }
}

function initializedResult() {
  return {
    protocol: 'thread-rpc-v4',
    serverInfo: { name: 'test-agent', version: '1.0.0' },
    capabilities: ['rpc.typed.v1', 'config.manage.v1'],
    limits: {
      maxFrameBytes: 1024,
      maxSubscriptions: 8,
      maxStreamsPerSubscription: 8,
      maxPendingRequests: 32,
    },
    connectionId: 'test-connection',
  }
}
