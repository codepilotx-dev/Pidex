import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Effect } from 'effect'
import { ComputerPolicyService } from '../src/computer/ComputerPolicyService'
import { ComputerUseService } from '../src/computer/ComputerUseService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { EventHub } from '../src/storage/events/EventHub'
import type { ConfigService, ConfigEdit } from '../src/config/ConfigService'
import { computerToolDefinitions } from '../src/tool/Computer/Definition'
import { ApprovalService } from '../src/permission/ApprovalService'
import { ToolExecutor } from '../src/tool/ToolExecutor'
import { InteractionService } from '../src/interaction/InteractionService'
import { ResumeCheckpointResolver } from '../src/interaction/ResumeCheckpointResolver'
import { ThreadProjection } from '../src/transport/ThreadProjection'
import { WorkspaceService } from '../src/workspace/WorkspaceService'
import { Model, Provider } from '@pidex/model-schema'
import { ToolRegistry } from '../src/tool/ToolRegistry'
import { PermissionDecisionEngine } from '../src/permission/PermissionDecisionEngine'
import type { ToolInvocation } from '../src/Domain'
import type { ComputerCommand, ComputerResult, ComputerWindow } from '@pidex/agent-protocol'
import { removeFixturePaths } from './FixtureCleanup'
import { PluginManagementService } from '../src/plugin/PluginManagementService'
import { PluginSettingsRepository } from '../src/storage/repositories/PluginSettingsRepository'

const paths: string[] = []
const cleanups: Array<() => void> = []
const HOST = { instanceId: 'instance:test', connectionId: 'connection:test' }
const APP = {
  appId: 'cpx2:notepad',
  name: '记事本',
  pid: 42,
  windowId: '7',
  processKey: '1:2',
  identity: {
    kind: 'packaged' as const,
    fingerprint: 'a'.repeat(64),
    legacyAppId: 'aumid:notepad',
    aumid: 'notepad',
  },
}
const REF = 'window:issued'

type Identity = { threadID: string; turnID: string }

const issuedWindow = (ref = REF): ComputerWindow => ({ ref, ...APP })

afterEach(async () => {
  cleanups.splice(0).forEach((fn) => fn())
  await removeFixturePaths(paths.splice(0))
}, 30_000)

async function fixture(options: { enabled?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cpx-computer-'))
  paths.push(root)
  const db = new AgentDatabase(join(root, 'history.sqlite'))
  const configuration: Record<string, any> = {
    desktop: {
      computerUseEnabled: options.enabled ?? true,
      computerAppPermissions: [],
      unknown: 'keep',
    },
  }
  const listeners = new Set<(event: any) => unknown>()
  const config = {
    snapshot: () => configuration,
    snapshotLayers: () => [{ kind: 'user', config: configuration }],
    subscribe: (listener: (event: any) => unknown) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    read: async () => ({
      config: configuration,
      layers: [{ kind: 'user', version: 'test', config: configuration }],
    }),
    batchWrite: async ({ edits }: { edits: ConfigEdit[] }) => {
      for (const edit of edits) configuration[edit.keyPath[0]!][edit.keyPath[1]!] = edit.value
      for (const listener of listeners)
        await listener({ scope: 'user', changedKeyPaths: edits.map((edit) => edit.keyPath) })
    },
  } as unknown as ConfigService
  const hub = await Effect.runPromise(EventHub.make)
  const policy = new ComputerPolicyService(config, join(root, 'requirements.toml'))
  const plugins = new PluginManagementService(new PluginSettingsRepository(db), {
    builtinPluginsRoot: join(import.meta.dir, '../resources/plugins'),
    userHome: root,
  })
  plugins.initializeComputerUse(options.enabled ?? true)
  await plugins.list()
  const computer = new ComputerUseService(config, db, hub, plugins, policy)
  await computer.initialize()
  cleanups.push(() => {
    computer.dispose()
    db.close()
  })
  computer.register(HOST.instanceId, HOST.connectionId, true, true)
  return { db, computer, configuration, policy, root, hub, plugins }
}

const computerTools = (registry: ToolRegistry, mode: 'chat' | 'plan') =>
  registry
    .list(mode)
    .map((tool) => tool.sdkName)
    .filter((name) => name.startsWith('Computer'))
    .sort()

async function discover(computer: ComputerUseService, identity: Identity, signal: AbortSignal) {
  const listed = computer.list(identity, signal)
  const command = await take(computer)
  computer.complete(command.requestId, command.generation, {
    text: '发现 1 个窗口',
    windows: [issuedWindow()],
  })
  return listed
}

async function take(computer: ComputerUseService): Promise<ComputerCommand> {
  const command = await commandWithin(computer)
  expect(command).not.toBeNull()
  return command!
}

/** A dispatchable command resolves at once; otherwise the long-poll is abandoned. */
async function commandWithin(
  computer: ComputerUseService,
  waitMs = 100,
): Promise<ComputerCommand | null> {
  const result = await Promise.race([computer.next(), Bun.sleep(waitMs).then(() => null)])
  return result ? result.command : null
}

async function observe(
  computer: ComputerUseService,
  identity: Identity,
  signal: AbortSignal,
  result: ComputerResult,
): Promise<string> {
  const reading = computer.read(identity, REF, signal, false, undefined, 'chat')
  const command = await take(computer)
  computer.complete(command.requestId, command.generation, result)
  const text = (await reading).text ?? ''
  return /observationId: (\S+)/.exec(text)?.[1] ?? ''
}

describe('ComputerUseService', () => {
  test('旧宿主缺少可信身份能力时保持不可用', async () => {
    const { computer } = await fixture()
    computer.register(HOST.instanceId, HOST.connectionId, true)
    expect(computer.available()).toBe(false)
  })
  test('旧允许需要重新确认，旧拒绝继续限制且旧记录原样保留', async () => {
    const { computer, db, configuration } = await fixture()
    configuration.desktop.computerAppPermissions = [
      { appId: APP.identity.legacyAppId, name: APP.name, decision: 'allow', unknown: 42 },
    ]
    const identity = { threadID: db.createThread('旧授权').id, turnID: 'turn:legacy' }
    await discover(computer, identity, new AbortController().signal)
    expect(computer.inspect(identity, REF, false).ruleRequiresApproval).toBe(true)
    expect(computer.state().permissions[0]?.needsConfirmation).toBe(true)
    await computer.configure({ appId: APP.appId, decision: 'allow' })
    expect(configuration.desktop.computerAppPermissions[0].unknown).toBe(42)
    configuration.desktop.computerAppPermissions[0].decision = 'deny'
    expect(() => computer.inspect(identity, REF, false)).toThrow('旧路径授权已拒绝')
  })
  test('永久允许禁用后记录保留但需授权，已有效聊天授权继续使用', async () => {
    const { computer, db, configuration, policy } = await fixture()
    configuration.computer_use = { allow_persistent_approval: false }
    configuration.desktop.computerAppApprovalsV2 = [
      { appId: APP.appId, name: APP.name, decision: 'allow' },
    ]
    await policy.refresh()
    const identity = { threadID: db.createThread('临时授权').id, turnID: 'turn:session' }
    await discover(computer, identity, new AbortController().signal)
    expect(computer.inspect(identity, REF, false).ruleRequiresApproval).toBe(true)
    await expect(computer.configure({ appId: APP.appId, decision: 'allow' })).rejects.toThrow(
      '禁止保存永久',
    )
    await computer.configure({ appId: APP.appId, decision: 'session', threadId: identity.threadID })
    expect(computer.inspect(identity, REF, true).ruleRequiresApproval).toBe(false)
    expect(configuration.desktop.computerAppApprovalsV2).toHaveLength(1)
  })
  test('策略收紧取消待执行命令并失效旧引用，聊天授权不会变成策略允许', async () => {
    const { computer, db, policy, root } = await fixture()
    const identity = { threadID: db.createThread('动态策略').id, turnID: 'turn:restrict' }
    await discover(computer, identity, new AbortController().signal)
    const reading = computer.read(
      identity,
      REF,
      new AbortController().signal,
      false,
      undefined,
      'chat',
    )
    const rejected = reading.catch((error: Error) => error)
    await writeFile(
      join(root, 'requirements.toml'),
      '[computer_use]\ndefault_app_access="deny"',
      'utf8',
    )
    await policy.refresh()
    expect(((await rejected) as Error).message).toContain('电脑控制已停止')
    expect(computer.state().busy).toBe(false)
    expect(computer.state().applications?.[0]?.policy).toMatchObject({
      access: 'deny',
      source: 'managed',
    })
    expect(() => computer.inspect(identity, REF, false)).toThrow('本回合电脑控制已停止')
  })
  test('手动临时授权只在指定聊天有效，设置保留聊天归属', async () => {
    const { computer, db } = await fixture()
    const first = { threadID: db.createThread('授权聊天').id, turnID: 'turn:manual-first' }
    await discover(computer, first, new AbortController().signal)
    await computer.configure({ appId: APP.appId, threadId: first.threadID, decision: 'session' })
    expect(computer.inspect(first, REF, false).ruleRequiresApproval).toBe(false)
    computer.stop()
    const second = { threadID: db.createThread('其他聊天').id, turnID: 'turn:manual-second' }
    await discover(computer, second, new AbortController().signal)
    expect(computer.inspect(second, REF, false).ruleRequiresApproval).toBe(true)
    expect(computer.state().permissions[0]?.chatThreadIds).toEqual([first.threadID])
  })
  test('未签名文件替换后新哈希身份不会继承原永久允许', async () => {
    const { computer, db, configuration } = await fixture()
    configuration.desktop.computerAppApprovalsV2 = [
      { appId: 'cpx2:old-hash', name: '开发应用', decision: 'allow' },
    ]
    const identity = { threadID: db.createThread('开发应用').id, turnID: 'turn:hash' }
    const pending = computer.list(identity, new AbortController().signal)
    const command = await take(computer)
    computer.complete(command.requestId, command.generation, {
      text: '新文件',
      windows: [
        {
          ...issuedWindow(),
          appId: 'cpx2:new-hash',
          identity: {
            kind: 'unsigned',
            legacyAppId: 'exe:dev',
            fingerprint: 'b'.repeat(64),
            sha256: 'b'.repeat(64),
          },
        },
      ],
    })
    await pending
    expect(computer.inspect(identity, REF, false).ruleRequiresApproval).toBe(true)
  })
  test('设置只发现应用标识，手动允许后才可在不询问模式读取，撤销后重新要求授权', async () => {
    const { computer, db } = await fixture()
    const discovery = computer.discoverApplications()
    const command = await take(computer)
    expect(command.kind).toBe('list')
    computer.complete(command.requestId, command.generation, {
      text: '应用',
      windows: [issuedWindow()],
    })
    expect(await discovery).toMatchObject({ apps: [{ appId: APP.appId, name: APP.name }] })
    expect(computer.state()).toMatchObject({ ownerTurnId: null, permissions: [] })
    await expect(computer.configure({ appId: 'forged', decision: 'allow' })).rejects.toThrow(
      '请先发现',
    )
    await computer.configure({ appId: APP.appId, decision: 'allow' })
    const identity = { threadID: db.createThread('手动授权').id, turnID: 'turn:manual' }
    const signal = new AbortController().signal
    await discover(computer, identity, signal)
    expect(computer.inspect(identity, REF, true).ruleRequiresApproval).toBe(false)
    await expect(computer.discoverApplications()).rejects.toThrow('另一个聊天回合')
    await computer.configure({ appId: APP.appId, decision: 'remove' })
    await discover(computer, { ...identity, turnID: 'turn:after' }, signal)
    expect(
      computer.inspect({ ...identity, turnID: 'turn:after' }, REF, false).ruleRequiresApproval,
    ).toBe(true)
  })

  test('停止后的宿主即使错过唤醒也立即收到新 generation', async () => {
    const { computer } = await fixture()
    const first = await computer.next('generation:old')
    computer.stop()
    const result = await Promise.race([
      computer.next(first.generation),
      Bun.sleep(100).then(() => null),
    ])
    expect(result).not.toBeNull()
    expect(result?.generation).not.toBe(first.generation)
    expect(result?.command).toBeNull()
  })

  test('never 拒绝新应用授权，允许询问时走审批，已手动授权时 never 可读取', async () => {
    const { computer, db } = await fixture()
    const registry = new ToolRegistry()
    for (const definition of computerToolDefinitions(computer)) registry.register(definition)
    const tool = registry.get('ComputerRead')
    const identity = { threadID: db.createThread('授权策略').id, turnID: 'turn:policy' }
    await discover(computer, identity, new AbortController().signal)
    const scope = computer.inspect(identity, REF, false)
    const invocation: ToolInvocation = {
      id: 'tool:read',
      ...identity,
      agentID: 'main',
      name: 'ComputerRead',
      input: { windowRef: REF },
      permissionConfig: {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
      },
      taskMode: 'chat',
      model: {} as ToolInvocation['model'],
      authorizationScope: scope,
    }
    const engine = new PermissionDecisionEngine()
    expect(engine.evaluate(invocation, tool).action).toBe('deny')
    expect(
      engine.evaluate(
        {
          ...invocation,
          permissionConfig: { ...invocation.permissionConfig, approvalPolicy: 'on-request' },
        },
        tool,
      ).action,
    ).toBe('review')
    await observe(computer, identity, new AbortController().signal, { text: '窗口' })
    await computer.configure({ appId: APP.appId, decision: 'allow' })
    const next = identity
    expect(
      engine.evaluate(
        { ...invocation, ...next, authorizationScope: computer.inspect(next, REF, false) },
        tool,
      ).action,
    ).toBe('allow')
  })

  test('宿主发放的窗口引用不被改写，模型提供的引用必须来自发现结果', async () => {
    const { db, computer } = await fixture()
    const thread = db.createThread('电脑')
    const identity = { threadID: thread.id, turnID: 'turn:1' }
    const result = await discover(computer, identity, new AbortController().signal)
    expect(result.text).toBe(JSON.stringify([{ ref: REF, name: APP.name }]))
    expect(() => computer.inspect(identity, 'window:forged', false)).toThrow('窗口引用已失效')
  })

  test('未授权应用要求审批，读取成功后本聊天放行，持久化拒绝优先', async () => {
    const { computer, db } = await fixture()
    const thread = db.createThread('电脑')
    const signal = new AbortController().signal
    await discover(computer, { threadID: thread.id, turnID: 'turn:1' }, signal)

    expect(computer.inspect({ threadID: thread.id, turnID: 'turn:1' }, REF, false)).toMatchObject({
      computerApp: { name: APP.name },
      ruleRequiresApproval: true,
    })

    await observe(computer, { threadID: thread.id, turnID: 'turn:1' }, signal, {
      text: '窗口内容',
    })
    expect(computer.inspect({ threadID: thread.id, turnID: 'turn:1' }, REF, false)).toMatchObject({
      ruleRequiresApproval: false,
    })
    expect(computer.state().permissions).toMatchObject([
      { appId: APP.appId, name: APP.name, decision: 'session' },
    ])

    // Recording a decision retires the current control turn and its window
    // references, so the next turn re-discovers before reading the deny.
    await computer.configure({ appId: APP.appId, decision: 'deny' })
    expect(computer.state().permissions).toMatchObject([
      { appId: APP.appId, name: APP.name, decision: 'deny' },
    ])
    await discover(computer, { threadID: thread.id, turnID: 'turn:2' }, signal)
    expect(() => computer.inspect({ threadID: thread.id, turnID: 'turn:2' }, REF, false)).toThrow(
      '此应用的电脑控制权限已拒绝',
    )

    await computer.configure({ appId: APP.appId, decision: 'remove' })
    expect(computer.state().permissions).toMatchObject([])
    await discover(computer, { threadID: thread.id, turnID: 'turn:3' }, signal)
    expect(computer.inspect({ threadID: thread.id, turnID: 'turn:3' }, REF, false)).toMatchObject({
      ruleRequiresApproval: true,
    })
  })

  test('Plan 模式只能读取已授权窗口，ComputerAction 不进入 Plan 工具表', async () => {
    const { computer, db } = await fixture()
    const thread = db.createThread('电脑')
    const identity = { threadID: thread.id, turnID: 'turn:1' }
    const signal = new AbortController().signal
    await discover(computer, identity, signal)

    expect(() => computer.inspect(identity, REF, true)).toThrow('Plan 模式只能读取已授权应用')
    const registry = new ToolRegistry()
    for (const definition of computerToolDefinitions(computer)) registry.register(definition)
    expect(computerTools(registry, 'plan')).toEqual(['ComputerApps', 'ComputerRead'])
    expect(computerTools(registry, 'chat')).toEqual([
      'ComputerAction',
      'ComputerApps',
      'ComputerRead',
    ])

    await observe(computer, identity, signal, { text: '窗口内容' })
    expect(computer.inspect(identity, REF, true).ruleRequiresApproval).toBe(false)
  })

  test('观察失效与元素越界都被拒绝', async () => {
    const { computer, db } = await fixture()
    const thread = db.createThread('电脑')
    const identity = { threadID: thread.id, turnID: 'turn:1' }
    const signal = new AbortController().signal
    await discover(computer, identity, signal)
    // Actions require the app to be granted by an earlier successful read.
    await observe(computer, identity, signal, { text: '窗口内容' })

    await expect(
      computer.action(
        identity,
        REF,
        'observation:unknown',
        { action: 'click', elementToken: 's00000001:4', delivery: 'background' },
        signal,
      ),
    ).rejects.toThrow('观察已失效')

    const observationId = await observe(computer, identity, signal, {
      text: '窗口内容',
      snapshotId: 's00000001',
      captureId: 'capture:1',
      elementTokens: ['s00000001:4'],
    })
    await expect(
      computer.action(
        identity,
        REF,
        observationId,
        { action: 'click', elementToken: 's00000001:9', delivery: 'background' },
        signal,
      ),
    ).rejects.toThrow('元素不属于当前窗口观察')
  })

  test('坐标操作绑定截图，前台重试携带新的观察且观察用后即失效', async () => {
    const { computer, db } = await fixture()
    const thread = db.createThread('电脑')
    const identity = { threadID: thread.id, turnID: 'turn:1' }
    const signal = new AbortController().signal
    await discover(computer, identity, signal)

    // A read without a capture cannot ground coordinates.
    const withoutCapture = await observe(computer, identity, signal, {
      text: '窗口内容',
      snapshotId: 's00000001',
      elementTokens: [],
    })
    await expect(
      computer.action(
        identity,
        REF,
        withoutCapture,
        { action: 'click', x: 10, y: 20, delivery: 'background' },
        signal,
      ),
    ).rejects.toThrow('坐标操作需要有效截图')

    const observationId = await observe(computer, identity, signal, {
      text: '窗口内容',
      snapshotId: 's00000002',
      captureId: 'capture:2',
      elementTokens: [],
    })
    const acting = computer.action(
      identity,
      REF,
      observationId,
      { action: 'click', x: 10, y: 20, delivery: 'foreground' },
      signal,
    )
    const command = await take(computer)
    expect(command).toMatchObject({
      kind: 'action',
      captureId: 'capture:2',
      operation: { action: 'click', x: 10, y: 20, delivery: 'foreground' },
    })
    computer.complete(command.requestId, command.generation, { text: '已点击' })
    await acting

    // The observation is consumed, so a retry needs a fresh read.
    await expect(
      computer.action(
        identity,
        REF,
        observationId,
        { action: 'click', x: 10, y: 20, delivery: 'foreground' },
        signal,
      ),
    ).rejects.toThrow('观察已失效')
  })

  test('同一真实桌面只允许一个聊天回合控制，其他聊天不排队', async () => {
    const { computer, db } = await fixture()
    const owner = db.createThread('拥有者')
    const other = db.createThread('其他')
    const signal = new AbortController().signal
    const ownerIdentity = { threadID: owner.id, turnID: 'turn:owner' }
    await discover(computer, ownerIdentity, signal)

    const reading = computer.read(ownerIdentity, REF, signal, false, undefined, 'chat')
    const command = await take(computer)

    expect(() =>
      computer.inspect({ threadID: other.id, turnID: 'turn:other' }, REF, false),
    ).toThrow('电脑正由另一个聊天回合控制')
    expect(computer.state()).toMatchObject({ ownerThreadId: owner.id, ownerTurnId: 'turn:owner' })
    expect(computer.state().busy).toBe(true)
    // The other chat gets a busy signal, not a queued command.
    expect(await commandWithin(computer)).toBeNull()

    computer.complete(command.requestId, command.generation, { text: '窗口内容' })
    await reading
  })

  test('停止清空待执行命令、失效引用并禁止本回合继续，迟到结果不生效', async () => {
    const { computer, db } = await fixture()
    const thread = db.createThread('电脑')
    const identity = { threadID: thread.id, turnID: 'turn:1' }
    const signal = new AbortController().signal
    await discover(computer, identity, signal)

    const reading = computer.read(identity, REF, signal, false, undefined, 'chat')
    const command = await take(computer)
    computer.stop()

    await expect(reading).rejects.toThrow('电脑控制已停止')
    expect(await commandWithin(computer)).toBeNull()
    expect(() => computer.inspect(identity, REF, false)).toThrow('本回合电脑控制已停止')
    computer.complete(command.requestId, command.generation, { text: '迟到的结果' })
    expect(computer.state()).toMatchObject({
      ownerThreadId: null,
      ownerTurnId: null,
      targetName: null,
      busy: false,
    })
  })

  test('宿主断开释放控制权、清除聊天授权并保留持久化设置', async () => {
    const { computer, db, configuration } = await fixture()
    const thread = db.createThread('电脑')
    const identity = { threadID: thread.id, turnID: 'turn:1' }
    const signal = new AbortController().signal
    await discover(computer, identity, signal)
    await observe(computer, identity, signal, { text: '窗口内容' })
    await computer.configure({ appId: APP.appId, decision: 'allow' })

    computer.release(HOST.instanceId)

    expect(computer.state()).toMatchObject({
      available: false,
      ownerThreadId: null,
      ownerTurnId: null,
      permissions: [{ appId: APP.appId, name: APP.name, decision: 'allow' }],
    })
    expect(configuration.desktop.unknown).toBe('keep')
    expect(() => computer.inspect({ threadID: thread.id, turnID: 'turn:2' }, REF, false)).toThrow(
      '请开启电脑控制',
    )
  })

  test('功能关闭时工具不暴露且命令被拒绝', async () => {
    const { computer, db } = await fixture({ enabled: false })
    const thread = db.createThread('电脑')
    expect(computer.available()).toBe(false)
    await expect(
      computer.list({ threadID: thread.id, turnID: 'turn:1' }, new AbortController().signal),
    ).rejects.toThrow('请开启电脑控制')
    const registry = new ToolRegistry()
    for (const definition of computerToolDefinitions(computer)) registry.register(definition)
    expect(computerTools(registry, 'chat')).toEqual([])
  })

  test('插件与电脑设置共用状态，禁用停止在途命令并保留应用授权', async () => {
    const { computer, plugins, db, configuration, root } = await fixture()
    const identity = { threadID: db.createThread('插件').id, turnID: 'turn:plugin' }
    const signal = new AbortController().signal
    await discover(computer, identity, signal)
    await computer.configure({ appId: APP.appId, decision: 'allow' })
    const permissions = computer.state().permissions
    const registry = new ToolRegistry()
    for (const definition of computerToolDefinitions(computer)) registry.register(definition)
    const executor = new ToolExecutor(registry)
    const exposure = {
      taskMode: 'chat' as const,
      sandboxMode: 'danger-full-access' as const,
      approvalPolicy: 'never' as const,
    }
    const frozenDeferredToolNames = executor
      .deferredDefinitions(exposure)
      .map((tool) => tool.sdkName)
    const pending = computer.list(identity, signal)
    const rejected = pending.catch((error: Error) => error)
    const command = await take(computer)
    await plugins.setEnabled({
      pluginId: 'computer-use',
      enabled: false,
      operationId: 'plugin-off',
    })
    expect(((await rejected) as Error).message).toContain('电脑控制已停止')
    expect(computer.state()).toMatchObject({
      enabled: false,
      busy: false,
      ownerTurnId: null,
      permissions,
    })
    expect(computerTools(registry, 'chat')).toEqual([])
    expect(
      executor
        .deferredDefinitions({ ...exposure, frozenDeferredToolNames })
        .map((tool) => tool.sdkName),
    ).toEqual(frozenDeferredToolNames.filter((name) => !name.startsWith('Computer')))
    expect(() => computer.inspect(identity, REF, false)).toThrow('请开启电脑控制')
    computer.complete(command.requestId, command.generation, { text: '旧结果' })
    await expect(
      executor.execute(
        'ComputerApps',
        {},
        {
          ...identity,
          taskMode: 'chat',
          signal,
          permissionConfig: FULL_ACCESS,
          workspace: await WorkspaceService.open(root),
          frozenDeferredToolNames,
        },
      ),
    ).rejects.toThrow('请开启电脑控制')
    await computer.configure({ enabled: true })
    expect(
      (await plugins.list()).plugins.find((plugin) => plugin.id === 'computer-use')?.enabled,
    ).toBe(true)
    expect(configuration.desktop.computerUseEnabled).toBe(true)
    await computer.configure({ enabled: false })
    // The legacy configuration is preserved and can no longer override the plugin choice.
    plugins.initializeComputerUse(configuration.desktop.computerUseEnabled)
    expect(computer.enabled()).toBe(false)
    expect(computer.state().permissions).toEqual(permissions)
  })

  test('未完成握手的宿主动作被拒绝', async () => {
    const { computer } = await fixture()
    expect(() => computer.requireHost('instance:other', HOST.connectionId)).toThrow(
      '电脑宿主连接已失效',
    )
    expect(() => computer.requireHost(HOST.instanceId, HOST.connectionId)).not.toThrow()
    expect(computer.state().available).toBe(true)
  })
})

const FULL_ACCESS = {
  sandboxMode: 'danger-full-access',
  approvalPolicy: 'never',
  approvalsReviewer: 'user',
} as const

describe('聊天电脑授权', () => {
  test('完全访问 never 拒绝新应用，保留已手动授权范围且不能绕过显式拒绝', async () => {
    const { computer, db, root } = await fixture()
    const identity = { threadID: db.createThread().id, turnID: 'turn:full' }
    const signal = new AbortController().signal
    await discover(computer, identity, signal)
    expect(
      computer.inspect(identity, REF, false, undefined, FULL_ACCESS).ruleRequiresApproval,
    ).toBe(true)
    const registry = new ToolRegistry()
    for (const definition of computerToolDefinitions(computer)) registry.register(definition)
    const executor = new ToolExecutor(registry)
    const context = {
      ...identity,
      agentID: 'main',
      taskMode: 'chat' as const,
      signal,
      permissionConfig: FULL_ACCESS,
      workspace: await WorkspaceService.open(root),
    }
    await expect(
      executor.execute('ComputerRead', { windowRef: REF }, { ...context, authorizationOnly: true }),
    ).rejects.toThrow('never')
    expect(() => computer.inspect(identity, REF, true, undefined, FULL_ACCESS)).toThrow('Plan')
    await computer.configure({ appId: APP.appId, decision: 'allow' })
    expect(
      computer.inspect(identity, REF, false, undefined, FULL_ACCESS).ruleRequiresApproval,
    ).toBe(false)
    await computer.configure({ appId: APP.appId, decision: 'deny' })
    const next = { ...identity, turnID: 'turn:denied' }
    await discover(computer, next, signal)
    expect(() => computer.inspect(next, REF, false, undefined, FULL_ACCESS)).toThrow('已拒绝')
  })

  for (const reviewer of ['user', 'auto_review'] as const) {
    test(`${reviewer} 首次使用走人工 checkpoint，应用授权恢复不打断读取和动作`, async () => {
      const { computer, db, root, hub } = await fixture()
      const grant = reviewer === 'user' ? 'chat' : 'persistent'
      const permissions = {
        sandboxMode: 'workspace-write',
        approvalPolicy: reviewer === 'user' ? 'on-request' : 'untrusted',
        approvalsReviewer: reviewer,
      } as const
      const model = Model.Ref.make({
        providerID: Provider.ID.make('openai'),
        id: Model.ID.make('test'),
      })
      const thread = db.createThread()
      const turn = db.createTurn(thread.id, {
        content: '读取电脑',
        model,
        permissionConfig: permissions,
        strategy: 'queue',
        taskMode: 'chat',
      })
      db.claimTurnExecution(turn.turnID)
      const identity = { threadID: thread.id, turnID: turn.turnID }
      const signal = new AbortController().signal
      await discover(computer, identity, signal)
      const registry = new ToolRegistry()
      for (const definition of computerToolDefinitions(computer)) registry.register(definition)
      let reviewed = 0
      const approvals = new ApprovalService(db, hub, registry, async () => {
        reviewed++
        return { decision: 'allow', risk: 'low', reason: '自动' }
      })
      const executor = new ToolExecutor(registry, {
        dataDir: root,
        authorizeShell: (invocation, abort) => approvals.authorize(invocation, abort),
      })
      const context = {
        ...identity,
        agentID: turn.agentID,
        toolCallID: 'computer:read',
        taskMode: 'chat' as const,
        signal,
        workspace: await WorkspaceService.open(root),
        permissionConfig: permissions,
        model,
      }
      await expect(
        executor.execute(
          'ComputerRead',
          { windowRef: REF },
          { ...context, permissionConfig: FULL_ACCESS, authorizationOnly: true },
        ),
      ).rejects.toThrow('never')
      const result = await executor.execute(
        'ComputerRead',
        { windowRef: REF },
        { ...context, authorizationOnly: true },
      )
      expect(result).toMatchObject({ decision: 'ask' })
      expect(reviewed).toBe(0)
      await approvals.attachRunState(context.toolCallID, JSON.stringify({ version: 1 }), {
        name: 'ComputerRead',
        callId: context.toolCallID,
      })
      const stored = db.approvalCheckpointForToolCall(context.toolCallID)!
      const interactions = new InteractionService({
        db,
        hub,
        approvals,
        computer,
        threads: { resumeTurn: async () => {} },
      } as unknown as ConstructorParameters<typeof InteractionService>[0])
      expect(interactions.listPending({ threadId: thread.id }).interactions[0]).toMatchObject({
        computerApp: { name: APP.name, allowPersistentApproval: true },
      })
      expect(new ThreadProjection(db).snapshot(thread.id)?.approvals[0]).toMatchObject({
        computerApp: { name: APP.name },
      })
      await expect(
        interactions.respond({
          interactionId: stored.approvalID,
          operationId: 'invalid:remember',
          expectedVersion: stored.version,
          response: {
            kind: 'approval',
            decision: 'allow-once',
            remember: { scope: 'tool', value: 'ComputerRead' },
          },
        }),
      ).rejects.toThrow('记忆规则')
      await interactions.respond({
        interactionId: stored.approvalID,
        operationId: `allow:${reviewer}`,
        expectedVersion: stored.version,
        response: {
          kind: 'approval',
          decision: 'allow-once',
          ...(grant === 'persistent' ? { computerGrant: grant } : {}),
        },
      })
      const lease = new ResumeCheckpointResolver(db, approvals).acquire(
        turn.turnID,
        'main',
        `lease:${reviewer}`,
      )!
      expect(lease.checkpoint).toMatchObject({ computerGrant: grant })
      const resumed = executor.execute<ComputerResult>(
        'ComputerRead',
        { windowRef: REF },
        {
          ...context,
          approvedToolCallID: context.toolCallID,
          approvedAuthorizationFingerprint:
            stored.payload.invocation.authorizationScope!.fingerprint,
          approvedComputerGrant: grant,
        },
      )
      const command = await take(computer)
      computer.complete(command.requestId, command.generation, {
        text: '窗口',
        captureId: 'capture',
      })
      const observationId = /observationId: (\S+)/.exec((await resumed).text)![1]!
      expect(computer.state().permissions[0]).toMatchObject({
        decision: grant === 'chat' ? 'session' : 'allow',
        chatThreadIds: [thread.id],
      })
      expect(computer.inspect(identity, REF, false).ruleRequiresApproval).toBe(false)
      const allowed = await executor.execute(
        'ComputerRead',
        { windowRef: REF },
        { ...context, toolCallID: 'next:read', authorizationOnly: true },
      )
      expect(allowed).toMatchObject({ decision: 'allow' })
      const action = computer.action(
        identity,
        REF,
        observationId,
        { action: 'click', x: 1, y: 2, delivery: 'background' },
        signal,
      )
      const actionCommand = await take(computer)
      computer.complete(actionCommand.requestId, actionCommand.generation, { text: '完成' })
      await action
      await computer.configure({ appId: APP.appId, decision: 'remove' })
      expect(() => computer.inspect(identity, REF, false)).toThrow('本回合电脑控制已停止')
    })
  }

  test('永久授权禁用和失效引用在回复前复核，聊天授权仍可用', async () => {
    const { computer, db, policy, configuration } = await fixture()
    const identity = { threadID: db.createThread().id, turnID: 'turn:temporary' }
    configuration.computer_use = { allow_persistent_approval: false }
    await policy.refresh()
    const signal = new AbortController().signal
    await discover(computer, identity, signal)
    const permissions = { ...FULL_ACCESS, approvalPolicy: 'on-request' } as const
    const scope = computer.inspect(identity, REF, false, undefined, permissions)
    expect(() =>
      computer.validateGrant(identity, REF, scope.fingerprint, true, false, permissions),
    ).toThrow('禁止保存永久')
    expect(() =>
      computer.validateGrant(identity, REF, 'b'.repeat(64), false, false, permissions),
    ).toThrow('身份已变化')
    computer.validateGrant(identity, REF, scope.fingerprint, false, false, permissions)
    await observe(computer, identity, signal, { text: '窗口' })
    expect(computer.inspect(identity, REF, true).ruleRequiresApproval).toBe(false)
    computer.stop()
    const other = { threadID: db.createThread().id, turnID: 'turn:other' }
    await discover(computer, other, signal)
    expect(computer.inspect(other, REF, false).ruleRequiresApproval).toBe(true)
  })
})
