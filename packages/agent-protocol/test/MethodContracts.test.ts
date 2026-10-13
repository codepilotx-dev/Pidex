import { describe, expect, test } from 'bun:test'
import { Credential, Model, Provider } from '@pidex/model-schema'
import { Schema } from 'effect'
import { TextItemSchema } from '@pidex/shared/thread'
import { RpcMethods, type RpcMethod, type RpcParams, type RpcResult } from '../src/methods/index'
import { AllRpcMethods } from '../src/methods/Host'
import { Capabilities, ProtocolCapabilitySchema } from '../src/runtime/Capabilities'
import { ModelHealthItemSchema, ModelHealthRunSchema } from '../src/methods/Extended'
import { EventManifest } from '../src/wire/Events'

const providerId = Schema.decodeUnknownSync(Provider.ID)('provider:test')
const modelId = Schema.decodeUnknownSync(Model.ID)('model:test')
const credentialId = Schema.decodeUnknownSync(Credential.ID)('credential:test')

const modelRef = {
  providerID: providerId,
  id: modelId,
}

const permissionConfig = {
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
} as const

const threadSettings = {
  taskMode: 'chat',
  permissionConfig,
} as const

const project = {
  id: 'project:1',
  name: 'Fixture project',
  primaryFolderId: 'folder:1',
  folders: [
    {
      id: 'folder:1',
      name: 'fixture',
      path: 'F:\\fixture',
      role: 'primary',
      availability: 'available',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    },
  ] as const,
  removedAt: null,
  lastOpenedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  settings: {
    defaultModel: null,
    instructions: '',
    executionEnvironment: 'auto' as const,
    version: 1,
  },
}

const threadListItem = {
  id: 'thread:1',
  projectID: project.id,
  gitBranch: 'codex/hover-card',
  workspace: {
    kind: 'project',
    projectID: project.id,
    cwd: project.folders[0].path,
    runtimeWorkspaceRoots: [
      {
        folderId: project.folders[0].id,
        path: project.folders[0].path,
        role: 'primary',
      },
    ],
    instructionSources: [],
    outputDirectory: null,
  } as const,
  title: 'Fixture thread',
  preview: null,
  firstUserMessage: null,
  messageCount: 0,
  latestTurnStatus: null,
  archivedAt: null,
  unreadAt: 2,
  settings: threadSettings,
  createdAt: 1,
  updatedAt: 1,
}

const threadSnapshot = {
  thread: {
    id: threadListItem.id,
    title: threadListItem.title,
    projectID: project.id,
    gitBranch: threadListItem.gitBranch,
    workspace: threadListItem.workspace,
    settings: threadSettings,
    createdAt: 1,
    updatedAt: 1,
  },
  turns: [],
  agents: [],
  subagents: [],
  inputs: [],
  messages: [],
  items: [],
  approvals: [],
}

const streamPosition = {
  streamId: 'stream:thread:1',
  sequence: 1,
}

const admission = {
  inputId: 'input:1',
  turnId: 'turn:1',
  disposition: 'accepted',
  streamPosition,
} as const

const sandboxStatus = {
  state: 'available',
  platform: 'win32',
  architecture: 'x64',
  runtimeVersion: '1.0.0',
  maturity: 'alpha',
  maxConcurrentCommands: 8,
  error: null,
  operations: {
    canInstall: false,
    canRepair: true,
    canUninstall: true,
  },
} as const

const toolingStatus = {
  id: 'git-bash',
  preference: 'managed',
  phase: 'ready',
  activeSource: 'managed',
  pinnedVersion: '2.55.0.3',
  managed: { installed: true, version: '2.55.0.3' },
  system: { available: false, version: null, path: null },
} as const

const attachment = {
  id: 'attachment:1',
  kind: 'text',
  name: 'fixture.txt',
  mediaType: 'text/plain',
  sizeBytes: 7,
  sha256: 'fixture-sha256',
  createdAt: 1,
} as const

const localContextReference = {
  id: 'context:1',
  name: 'fixture.txt',
  path: 'C:\\outside\\fixture.txt',
  kind: 'file',
  status: 'available',
  createdAt: 1,
} as const

const memoryEntry = {
  id: 'memory:1',
  scope: 'project',
  projectId: project.id,
  content: 'Use Bun for this project.',
  sourceThreadId: threadListItem.id,
  createdAt: 1,
  updatedAt: 1,
} as const

const promptPreview = {
  instructions: 'Fixture instructions',
  contextItems: [],
  diagnostics: [],
  cacheSegments: [],
  cacheBoundaries: [],
  baseHash: 'base-hash',
  contextHash: 'context-hash',
  cacheHash: 'cache-hash',
  cacheKey: 'cache-key',
  cacheMode: { provider: 'other', strategy: 'stable-prefix' },
  sections: [],
  baseline: null,
} as const

const promptSettingsSnapshot = {
  engine: 'prompt-engine-v2',
  version: 2,
  snapshottedAt: 1,
  settings: {},
} as const

const subagentWorkspace = {
  mode: 'worktree',
  state: 'ready',
  rootPath: 'F:\\fixture-worktree',
  baselineRef: 'HEAD',
} as const

const subagentRun = {
  id: 'run:1',
  taskId: 'task:1',
  generation: 1,
  status: 'completed',
  queueReason: null,
  model: modelRef,
  permissionConfig,
  result: null,
  error: null,
  createdAt: 1,
  startedAt: 1,
  finishedAt: 2,
  updatedAt: 2,
} as const

const subagentTask = {
  id: 'task:1',
  parentThreadId: threadListItem.id,
  parentTurnId: 'turn:1',
  parentAgentId: 'agent:1',
  childThreadId: 'thread:child:1',
  displayName: 'Fixture subagent',
  profile: 'worker',
  task: 'Inspect the fixture.',
  permissionCeiling: permissionConfig,
  workspace: subagentWorkspace,
  currentRun: null,
  createdAt: 1,
  updatedAt: 2,
} as const

const subagentCapabilities = {
  canStop: false,
  canRetry: true,
  canRespondToApprovals: true,
  canRespondToQuestions: true,
  canApplyWorktree: true,
  canDiscardWorktree: true,
  canRestoreWorkspace: true,
}

const githubUser = {
  login: 'octocat',
  id: 1,
  name: 'Octocat',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1',
  htmlUrl: 'https://github.com/octocat',
}

const githubAuth = {
  configured: true,
  authenticated: true,
  user: githubUser,
}

const githubLogin = {
  loginId: 'github-login:1',
  mode: 'device',
  state: 'awaiting_auth',
  authorizationUrl: null,
  userCode: 'ABCD-EFGH',
  verificationUri: 'https://github.com/login/device',
  expiresAt: '2026-07-18T10:00:00.000Z',
  error: null,
  auth: null,
  elapsedMs: 1,
} as const

const githubRepository = {
  id: 1,
  name: 'fixture',
  fullName: 'octocat/fixture',
  owner: 'octocat',
  private: false,
  fork: false,
  archived: false,
  disabled: false,
  cloneUrl: 'https://github.com/octocat/fixture.git',
  sshUrl: 'git@github.com:octocat/fixture.git',
  htmlUrl: 'https://github.com/octocat/fixture',
  description: 'Fixture repository',
  defaultBranch: 'main',
  pushedAt: '2026-07-18T09:00:00.000Z',
  updatedAt: '2026-07-18T09:00:00.000Z',
}

const githubPullRequest = {
  id: 10,
  number: 7,
  title: 'Fixture pull request',
  body: 'Fixture body',
  state: 'open',
  draft: false,
  htmlUrl: 'https://github.com/octocat/fixture/pull/7',
  base: { ref: 'main', sha: 'base-sha' },
  head: { ref: 'feature', sha: 'head-sha' },
  additions: 2,
  deletions: 1,
  changedFiles: 1,
  mergeable: true,
}

const githubThreadPullRequestSummary = {
  owner: 'octocat',
  repository: 'fixture',
  number: 7,
  url: 'https://github.com/octocat/fixture/pull/7',
  title: 'Fixture pull request',
  origin: 'discovered',
  primary: true,
  status: { state: 'mergeable', reason: null, stale: false, checkedAt: 1_800_000_000_000 },
} as const

const githubProfileRepository = {
  id: 'repo:1',
  name: 'fixture',
  fullName: 'octocat/fixture',
  url: 'https://github.com/octocat/fixture',
  description: null,
  isPrivate: false,
  isFork: false,
  primaryLanguage: { name: 'TypeScript', color: '#3178c6' },
  stargazerCount: 1,
  forkCount: 0,
  updatedAt: '2026-07-18T09:00:00.000Z',
}

const githubProfileOverview = {
  user: {
    ...githubUser,
    bio: null,
    company: null,
    location: null,
    websiteUrl: null,
    email: null,
    followers: 1,
    following: 0,
    repositoryCount: 1,
    starredRepositoryCount: 1,
    status: null,
  },
  organizations: [],
  pinnedRepositories: [githubProfileRepository],
  popularRepositories: [githubProfileRepository],
  contributions: {
    totalContributions: 1,
    totalCommitContributions: 1,
    totalIssueContributions: 0,
    totalPullRequestContributions: 0,
    totalPullRequestReviewContributions: 0,
    restrictedContributionsCount: 0,
    weeks: [{ days: [{ date: '2026-07-18', count: 1, color: '#40c463' }] }],
  },
}

const modelCatalog = {
  providers: [],
  defaultModel: modelRef,
  reviewerModel: null,
  catalogVersion: 1,
}

const providerCatalog = {
  ...modelCatalog,
  providers: [
    {
      ...Provider.Info.empty(providerId),
      authConfigured: true,
      config: {
        kind: 'builtin' as const,
        id: providerId,
        enabled: true,
        allowModels: [],
        denyModels: [],
        models: [],
      },
    },
  ],
  issues: [],
}

const providerCredentialSummary = {
  id: credentialId,
  providerId,
  kind: 'api-key' as const,
  label: 'Fixture API Key',
  maskedValue: '••••test',
  enabled: true,
  active: true,
  order: 0,
  health: { status: 'healthy' as const, lastTestedAt: 1 },
  createdAt: 1,
  updatedAt: 2,
}

const customProviderDefinition = {
  kind: 'custom' as const,
  id: providerId,
  name: 'Fixture provider',
  enabled: true,
  baseUrl: 'https://example.test/v1',
  auth: 'api-key' as const,
  env: ['FIXTURE_API_KEY'],
  allowInsecureHttp: false,
  headers: { 'x-client-version': '0.1.0' },
  models: [
    {
      id: modelId,
      name: 'Fixture model',
      api: 'openai-completions' as const,
      cost: { input: 0.15, output: 0.6, cacheRead: 0.0375, cacheWrite: 0.15 },
      headers: { 'x-model-profile': 'fixture' },
      thinkingLevelMap: { low: 'low', max: null },
      compat: { supportsStore: false },
    },
  ],
}

const authSession = {
  id: 'auth-session:1',
  target: { kind: 'provider' as const, providerId },
  status: 'waiting' as const,
  prompt: {
    id: 'auth-prompt:1',
    type: 'manual_code' as const,
    message: 'Paste the authorization code.',
  },
  notices: [],
  createdAt: 1,
  expiresAt: 2,
}

const methodFixture = <M extends string>(
  _method: M,
  params: M extends RpcMethod ? RpcParams<M> : unknown,
  result: M extends RpcMethod ? RpcResult<M> : unknown,
) => ({ params, result })

type MethodFixtures = {
  readonly [M in RpcMethod]: {
    readonly params: RpcParams<M>
    readonly result: RpcResult<M>
  }
} & Readonly<Record<string, { readonly params: unknown; readonly result: unknown }>>

const taskboardTask = {
  id: 'taskboard-task:1',
  projectId: project.id,
  number: 1,
  title: '实现原生任务看板',
  description: '共享契约与存储',
  status: 'in_progress',
  priority: 'high',
  position: 1_024,
  version: 2,
  labels: [],
  archivedAt: null,
  createdAt: 1,
  updatedAt: 2,
} as const

const taskboardDetails = {
  task: taskboardTask,
  threads: [],
  comments: [],
  activities: [],
} as const

const taskboardWorkflowTask = {
  ...taskboardTask,
  status: 'blocked',
  startDate: '2026-08-20',
  dueDate: '2026-08-25',
  attention: {
    unread: true,
    unreadAt: 3,
    readAt: null,
    reason: 'blocked',
  },
} as const

const taskboardWorkflowDetails = {
  task: taskboardWorkflowTask,
  threads: [],
  comments: [],
  activities: [],
} as const

const taskboardPlanAggregate = {
  directTotal: 1,
  directDone: 0,
  directSkipped: 0,
  descendantTaskCount: 0,
  openBlockerCount: 1,
  readyUnreadCount: 0,
} as const

const taskboardPlanItem = {
  kind: 'step',
  id: 'plan-item:1',
  parentTaskId: taskboardTask.id,
  title: '扫描代码库',
  description: '查找可复用实现',
  status: 'todo',
  skipReason: null,
  position: 1_024,
  readiness: { status: 'ready' },
  unreadReady: false,
  version: 1,
} as const

const taskboardBlocker = {
  id: 'blocker:1',
  taskId: taskboardTask.id,
  planItemId: taskboardPlanItem.id,
  reason: '等待用户确认',
  status: 'open',
  sourceThreadId: null,
  sourceTurnId: null,
  resolution: null,
  version: 1,
  createdAt: 3,
  resolvedAt: null,
  updatedAt: 3,
} as const

const taskboardPlanningSnapshot = {
  task: taskboardWorkflowDetails,
  breadcrumbs: [{ taskId: taskboardTask.id, number: 1, title: taskboardTask.title }],
  items: [taskboardPlanItem],
  dependencies: [],
  blockers: [taskboardBlocker],
  aggregate: taskboardPlanAggregate,
} as const

const taskboardComment = {
  id: 'taskboard-comment:1',
  taskId: taskboardTask.id,
  body: '已完成契约实现',
  author: 'user',
  sourceThreadId: null,
  version: 1,
  deletedAt: null,
  createdAt: 2,
  updatedAt: 2,
} as const

const taskboardLabel = {
  id: 'taskboard-label:1',
  projectId: project.id,
  name: 'Desktop',
  normalizedName: 'desktop',
  version: 1,
  createdAt: 1,
  updatedAt: 1,
} as const

const taskboardStartOperation = {
  operationId: 'taskboard-start:1',
  taskId: taskboardTask.id,
  projectId: project.id,
  threadId: 'thread:taskboard',
  worktreeId: null,
  execution: { kind: 'local' },
  status: 'completed',
  step: 'complete',
  revision: 3,
  errorCode: null,
  warnings: [],
  startupInstruction: '请先读取任务。',
  createdAt: 1,
  updatedAt: 3,
  completedAt: 3,
} as const

const automation = {
  id: 'automation:1',
  revision: 1,
  kind: 'standalone',
  name: '每日代码检查',
  prompt: '检查当前项目中的待办事项。',
  status: 'active',
  projectId: project.id,
  targetThreadId: null,
  execution: { kind: 'local' },
  model: modelRef,
  reasoningEffort: 'medium',
  permissionConfig: { ...permissionConfig, approvalPolicy: 'never' },
  schedule: { mode: 'daily', time: '09:00' },
  canonicalRrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
  timeZone: 'Asia/Shanghai',
  notificationPolicy: 'failures',
  nextRunAt: 2_000,
  pendingCatchUp: false,
  activeRunId: null,
  createdAt: 1_000,
  updatedAt: 1_000,
  deletedAt: null,
} as const

const automationRun = {
  id: 'automation-run:1',
  automationId: automation.id,
  trigger: 'manual',
  scheduledFor: 1_500,
  status: 'claimed',
  threadId: null,
  turnId: null,
  worktreeId: null,
  readAt: null,
  safeErrorCode: null,
  createdAt: 1_500,
  startedAt: null,
  completedAt: null,
} as const

const scheduledTask = {
  id: 'scheduled-task:1',
  revision: 1,
  kind: 'standalone',
  name: '发布前检查',
  prompt: '检查发布前状态。',
  status: 'scheduled',
  projectId: project.id,
  targetThreadId: null,
  execution: { kind: 'local' },
  model: modelRef,
  reasoningEffort: 'medium',
  permissionConfig: { ...permissionConfig, approvalPolicy: 'never' },
  scheduledFor: 2_000,
  timeZone: 'Asia/Shanghai',
  notificationPolicy: 'failures',
  threadId: null,
  turnId: null,
  worktreeId: null,
  readAt: null,
  safeErrorCode: null,
  createdAt: 1_000,
  updatedAt: 1_000,
  startedAt: null,
  completedAt: null,
  cancelledAt: null,
} as const

const schedulePlanDefaults = {
  kind: scheduledTask.kind,
  projectId: scheduledTask.projectId,
  targetThreadId: scheduledTask.targetThreadId,
  execution: scheduledTask.execution,
  model: scheduledTask.model,
  reasoningEffort: scheduledTask.reasoningEffort,
  permissionConfig: scheduledTask.permissionConfig,
  timeZone: scheduledTask.timeZone,
  notificationPolicy: scheduledTask.notificationPolicy,
} as const

const schedulePlanItems = [
  {
    key: 'release-check',
    enabled: true,
    kind: 'one-off',
    name: scheduledTask.name,
    prompt: scheduledTask.prompt,
    scheduledFor: scheduledTask.scheduledFor,
  },
] as const

const schedulePlanProposal = {
  id: 'schedule-plan:1',
  revision: 1,
  threadId: 'thread:1',
  turnId: 'turn:1',
  toolCallId: 'tool-call:1',
  status: 'pending',
  horizon: 'week',
  defaults: schedulePlanDefaults,
  items: schedulePlanItems,
  createdRefs: [],
  createdAt: 1_000,
  updatedAt: 1_000,
  committedAt: null,
} as const

const scheduleDraft = {
  id: 'schedule-draft:1',
  revision: 1,
  threadId: 'thread:1',
  turnId: 'turn:1',
  toolCallId: 'tool-call:1',
  status: 'pending',
  name: '登录页面改进',
  prompt: '按已确认的计划改进登录页面',
  taskPlan: {
    source: 'current-plan-item',
    sourceRef: 'turn:1:plan',
    contentHash: 'a'.repeat(64),
    structured: {
      title: '登录页面改进',
      summary: '改善登录页的可用性与错误提示。',
      changes: [{ area: '桌面展示', items: ['调整登录表单布局'] }],
      interfaceChanges: [],
      tests: ['人工验收登录流程'],
      assumptions: [],
    },
  },
  trigger: { kind: 'once', at: 2_000, timeZone: scheduledTask.timeZone },
  conditions: { dependsOn: [], requireEnvironment: true, notBefore: null, deadline: null },
  conditionFallback: 'skip',
  acceptance: { kind: 'manual' },
  notificationPolicy: 'failures',
  missedRuns: 'catch-up',
  execution: {
    kind: scheduledTask.kind,
    projectId: scheduledTask.projectId,
    targetThreadId: scheduledTask.targetThreadId,
    environment: scheduledTask.execution,
    model: scheduledTask.model,
    reasoningEffort: scheduledTask.reasoningEffort,
    permissionConfig: scheduledTask.permissionConfig,
  },
  createdRefs: [],
  createdAt: 1_000,
  updatedAt: 1_000,
  committedAt: null,
} as const

const browserTab = {
  tabId: 'browser:1',
  windowId: 'window:1',
  sourceThreadId: 'thread:1',
  controlThreadId: null,
  url: 'about:blank',
  title: '新标签页',
  state: 'suspended',
  loading: false,
  busy: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
  generation: 'generation:1',
  documentId: 'document:1',
  viewport: { width: 1280, height: 720 },
  panel: 'right',
  order: 1,
  lastUsedAt: 1,
  revision: 1,
} as const
const browserHost = { windowId: 'window:1', instanceId: 'instance:1' } as const
const computerHostId = 'instance:1'
const computerWindow = {
  ref: 'window:1',
  appId: 'aumid:notepad',
  name: '记事本',
  pid: 42,
  windowId: '7',
  processKey: '1:2',
} as const
const computerState: RpcResult<'computer/state'> = {
  enabled: true,
  available: true,
  ownerThreadId: 'thread:1',
  ownerTurnId: 'turn:1',
  targetName: '记事本',
  busy: false,
  permissions: [{ appId: computerWindow.appId, name: computerWindow.name, decision: 'allow' }],
}
const settingsEnvironment = {
  exists: true,
  filePath: 'F:/fixture/.pidex/environments/environment.jsonc',
  gitRoot: 'F:/fixture',
  revision: 'a'.repeat(64),
  configHash: 'a'.repeat(64),
  config: { schema_version: 1, name: 'fixture', actions: [] },
  executionTrusted: false,
}
const settingsWorktree = {
  id: 'worktree:1',
  projectId: project.id,
  status: 'ready',
  branchName: 'feature/test',
  baseCommit: 'abc123',
  headCommit: 'abc123',
  permanent: false,
  pinned: false,
  setupStatus: 'succeeded',
  continuedWithoutSetup: false,
  createdAt: 1,
  updatedAt: 1,
  lastUsedAt: 1,
  deletedAt: null,
} as const
const settingsWorktreeResult = {
  worktree: settingsWorktree,
  operation: {
    operationId: 'operation:1',
    worktreeId: settingsWorktree.id,
    projectId: project.id,
    kind: 'delete',
    step: 'complete',
    status: 'completed',
    revision: 1,
    errorCode: null,
    warnings: [],
    createdAt: 1,
    updatedAt: 1,
    completedAt: 1,
  },
} as const
const watch = {
  id: 'watch:1',
  projectId: project.id,
  url: 'https://github.com/owner/repository/pull/1',
  automation,
  threadId: 'thread:1',
  worktreeId: 'worktree:1',
  reason: null,
}
const fixtures = {
  'git/message/generate': methodFixture(
    'git/message/generate',
    { projectId: project.id, kind: 'commit', paths: ['src/index.ts'] },
    { title: 'feat: 示例', body: '' },
  ),
  'github/watch/start': methodFixture(
    'github/watch/start',
    { projectId: project.id, url: watch.url, model: modelRef, permissionConfig },
    watch,
  ),
  'github/watch/list': methodFixture('github/watch/list', {}, { watches: [watch] }),
  'github/watch/read': methodFixture('github/watch/read', { id: watch.id }, watch),
  'github/watch/stop': methodFixture('github/watch/stop', { id: watch.id }, watch),
  'github/watch/update': methodFixture(
    'github/watch/update',
    { id: watch.id, expectedRevision: 1, status: 'paused' },
    watch,
  ),
  'local-environment/project/list': methodFixture(
    'local-environment/project/list',
    { projectId: project.id },
    { environments: [], selectedEnvironmentId: null },
  ),
  'local-environment/project/create': methodFixture(
    'local-environment/project/create',
    { projectId: project.id, name: '环境' },
    { environmentId: 'environment:1' },
  ),
  'local-environment/project/read': methodFixture(
    'local-environment/project/read',
    { projectId: project.id, environmentId: 'environment:1' },
    settingsEnvironment,
  ),
  'local-environment/project/update': methodFixture(
    'local-environment/project/update',
    {
      projectId: project.id,
      environmentId: 'environment:1',
      expectedRevision: 'a'.repeat(64),
      edits: [{ keyPath: ['name'], value: '新环境' }],
    },
    {
      filePath: settingsEnvironment.filePath,
      revision: 'b'.repeat(64),
      configHash: 'b'.repeat(64),
      executionTrusted: false,
    },
  ),
  'local-environment/project/select': methodFixture(
    'local-environment/project/select',
    { projectId: project.id, environmentId: 'environment:1' },
    undefined,
  ),
  'local-environment/project/delete': methodFixture(
    'local-environment/project/delete',
    { projectId: project.id, environmentId: 'environment:1', expectedRevision: 'a'.repeat(64) },
    undefined,
  ),
  'worktree/settings/list': methodFixture(
    'worktree/settings/list',
    {},
    {
      worktrees: [
        {
          worktree: settingsWorktree,
          path: 'F:/worktrees/test',
          repositoryRoot: 'F:/fixture',
          conversations: [
            { id: 'thread:1', title: '聊天', archived: false, pinned: false, active: false },
          ],
        },
      ],
    },
  ),
  'worktree/settings/delete': methodFixture(
    'worktree/settings/delete',
    { worktreeId: settingsWorktree.id, operationId: 'operation:1' },
    settingsWorktreeResult,
  ),
  'worktree/settings/new-chat': methodFixture(
    'worktree/settings/new-chat',
    { worktreeId: settingsWorktree.id, operationId: 'operation:1' },
    { threadId: 'thread:1' },
  ),
  'interaction/questionPause': methodFixture(
    'interaction/questionPause',
    { interactionId: 'question:1', expectedVersion: 2 },
    { paused: true },
  ),
  'approval/rules/list': methodFixture(
    'approval/rules/list',
    { threadId: 'thread:1' },
    { rules: [] },
  ),
  'approval/rules/revoke': methodFixture(
    'approval/rules/revoke',
    { threadId: 'thread:1', ruleId: 'rule:1' },
    { revoked: true },
  ),
  'approval/reviewState': methodFixture(
    'approval/reviewState',
    { threadId: 'thread:1' },
    { manualAllows: 3, denials: [] },
  ),
  'approval/retry': methodFixture(
    'approval/retry',
    { threadId: 'thread:1', reviewId: 'review:1', operationId: 'operation:1' },
    { input: '重试这个操作' },
  ),
  'browser/history/list': methodFixture(
    'browser/history/list',
    {},
    { visits: [], nextCursor: null },
  ),
  'browser/history/remove': methodFixture('browser/history/remove', {}, { ok: true }),
  'browser/downloads/list': methodFixture('browser/downloads/list', {}, { downloads: [] }),
  'browser/downloads/remove': methodFixture('browser/downloads/remove', {}, { ok: true }),
  'browser/preferences/get': methodFixture(
    'browser/preferences/get',
    {},
    { downloadSaveMode: 'downloads' },
  ),
  'browser/preferences/set': methodFixture(
    'browser/preferences/set',
    { downloadSaveMode: 'ask' },
    { downloadSaveMode: 'ask' },
  ),
  'browser/host/visit': methodFixture(
    'browser/host/visit',
    {
      ...browserHost,
      generation: 'generation:1',
      historyEpoch: 0,
      visit: {
        id: 'visit:1',
        tabId: browserTab.tabId,
        sourceThreadId: 'thread:1',
        url: 'https://example.test/',
        title: '测试网页',
        visitedAt: 1,
      },
    },
    { ok: true },
  ),
  'browser/host/download': methodFixture(
    'browser/host/download',
    {
      ...browserHost,
      download: {
        id: 'download:1',
        tabId: browserTab.tabId,
        profileId: 'profile:1',
        runId: 'run:1',
        fileName: 'example.txt',
        url: 'https://example.test/file',
        state: 'progressing',
        receivedBytes: 0,
        totalBytes: 100,
        startedAt: 1,
        updatedAt: 1,
        resumable: false,
      },
    },
    { ok: true },
  ),
  'browser/host/download-path': methodFixture(
    'browser/host/download-path',
    { ...browserHost, id: 'download:1' },
    { filePath: null },
  ),
  'browser/host/download-recover': methodFixture(
    'browser/host/download-recover',
    { ...browserHost, profileId: 'profile:1', runId: 'run:1' },
    { ok: true },
  ),
  'browser/list': methodFixture('browser/list', {}, { tabs: [browserTab], permissions: [] }),
  'browser/create': methodFixture(
    'browser/create',
    {
      tabId: browserTab.tabId,
      windowId: browserTab.windowId,
      sourceThreadId: browserTab.sourceThreadId,
      url: browserTab.url,
    },
    browserTab,
  ),
  'browser/close': methodFixture('browser/close', { tabId: browserTab.tabId }, { ok: true }),
  'browser/control': methodFixture(
    'browser/control',
    { tabId: browserTab.tabId, threadId: null },
    browserTab,
  ),
  'browser/layout': methodFixture(
    'browser/layout',
    { tabId: browserTab.tabId, panel: 'bottom', order: 1 },
    browserTab,
  ),
  'browser/permissions': methodFixture(
    'browser/permissions',
    { decision: 'clear' },
    { permissions: [] },
  ),
  'browser/host/register': methodFixture('browser/host/register', browserHost, {
    tabs: [browserTab],
  }),
  'browser/host/next': methodFixture('browser/host/next', browserHost, {
    tabs: [browserTab],
    permissions: [],
    command: null,
  }),
  'browser/host/restore': methodFixture(
    'browser/host/restore',
    { ...browserHost, tabId: browserTab.tabId, generation: browserTab.generation },
    browserTab,
  ),
  'browser/host/report': methodFixture(
    'browser/host/report',
    {
      ...browserHost,
      tabId: browserTab.tabId,
      generation: browserTab.generation,
      patch: { loading: false },
    },
    browserTab,
  ),
  'browser/host/complete': methodFixture(
    'browser/host/complete',
    {
      ...browserHost,
      requestId: 'request:1',
      generation: browserTab.generation,
      result: { text: '完成' },
    },
    { ok: true },
  ),
  'browser/host/release': methodFixture('browser/host/release', browserHost, { ok: true }),
  'computer/state': methodFixture('computer/state', {}, computerState),
  'computer/apps': methodFixture('computer/apps', {}, { apps: [] }),
  'computer/configure': methodFixture(
    'computer/configure',
    { appId: computerWindow.appId, decision: 'deny' },
    computerState,
  ),
  'computer/stop': methodFixture('computer/stop', {}, { ok: true }),
  'computer/host/registerIdentity': methodFixture(
    'computer/host/registerIdentity',
    { instanceId: computerHostId, available: true },
    computerState,
  ),
  'computer/host/register': methodFixture(
    'computer/host/register',
    { instanceId: computerHostId, available: true },
    computerState,
  ),
  'computer/host/next': methodFixture(
    'computer/host/next',
    { instanceId: computerHostId },
    {
      enabled: true,
      generation: 'generation:1',
      command: {
        requestId: 'request:1',
        generation: 'generation:1',
        kind: 'read',
        session: 'cpx-turn:1',
        window: computerWindow,
        operation: { action: 'click', elementToken: 's00000001:4', delivery: 'background' },
      },
    },
  ),
  'computer/host/complete': methodFixture(
    'computer/host/complete',
    {
      instanceId: computerHostId,
      requestId: 'request:1',
      generation: 'generation:1',
      result: { text: '完成', snapshotId: 's00000001', elementTokens: ['s00000001:4'] },
    },
    { ok: true },
  ),
  'computer/host/release': methodFixture(
    'computer/host/release',
    { instanceId: computerHostId },
    { ok: true },
  ),
  'planApproval/read': methodFixture(
    'planApproval/read',
    {
      threadId: 'thread:1',
    },
    { approval: null },
  ),
  'planApproval/implementFresh': methodFixture(
    'planApproval/implementFresh',
    { threadId: 'thread:1', approvalId: 'plan:1', expectedVersion: 1, operationId: 'op:fresh' },
    {
      approval: {
        id: 'plan:1',
        threadId: 'thread:1',
        turnId: 'turn:1',
        planItemId: 'item:1',
        version: 2,
        status: 'implemented',
        title: '计划',
        markdown: '# 计划',
        nextTurnId: 'turn:fresh',
        createdAt: 1,
        resolvedAt: 2,
      },
      targetThreadId: 'thread:fresh',
      nextTurnId: 'turn:fresh',
      disposition: 'applied',
    },
  ),
  'planApproval/respond': methodFixture(
    'planApproval/respond',
    {
      threadId: 'thread:1',
      approvalId: 'plan:1',
      expectedVersion: 1,
      operationId: 'op:1',
      response: { action: 'close' },
    },
    {
      approval: {
        id: 'plan:1',
        threadId: 'thread:1',
        turnId: 'turn:1',
        planItemId: 'item:1',
        version: 2,
        status: 'closed',
        title: '计划',
        markdown: '# 计划',
        nextTurnId: null,
        createdAt: 1,
        resolvedAt: 2,
      },
      disposition: 'applied',
    },
  ),
  'calendar/range': methodFixture(
    'calendar/range',
    {
      from: 1_000,
      to: 3_000,
      timeZone: 'Asia/Shanghai',
      query: '发布',
      sourceKinds: ['scheduled-task', 'automation'],
    },
    {
      occurrences: [
        {
          id: 'calendar-occurrence:1',
          source: { kind: 'scheduled-task', id: scheduledTask.id },
          definitionKind: 'one-off',
          title: scheduledTask.name,
          scheduledFor: scheduledTask.scheduledFor,
          status: scheduledTask.status,
          runId: null,
          threadId: null,
          proposalId: schedulePlanProposal.id,
        },
      ],
      truncated: false,
    },
  ),
  'scheduled-task/read': methodFixture(
    'scheduled-task/read',
    {
      id: scheduledTask.id,
    },
    { scheduledTask },
  ),
  'scheduled-task/create': methodFixture(
    'scheduled-task/create',
    {
      operationId: 'operation:scheduled-task-create',
      kind: scheduledTask.kind,
      name: scheduledTask.name,
      prompt: scheduledTask.prompt,
      projectId: scheduledTask.projectId,
      targetThreadId: scheduledTask.targetThreadId,
      execution: scheduledTask.execution,
      model: scheduledTask.model,
      reasoningEffort: scheduledTask.reasoningEffort,
      permissionConfig: scheduledTask.permissionConfig,
      scheduledFor: scheduledTask.scheduledFor,
      timeZone: scheduledTask.timeZone,
      notificationPolicy: scheduledTask.notificationPolicy,
    },
    { scheduledTask },
  ),
  'scheduled-task/update': methodFixture(
    'scheduled-task/update',
    {
      id: scheduledTask.id,
      expectedRevision: scheduledTask.revision,
      status: 'paused',
    },
    { scheduledTask: { ...scheduledTask, revision: 2, status: 'paused', updatedAt: 1_100 } },
  ),
  'scheduled-task/delete': methodFixture(
    'scheduled-task/delete',
    {
      id: scheduledTask.id,
      expectedRevision: scheduledTask.revision,
    },
    {
      scheduledTask: {
        ...scheduledTask,
        revision: 2,
        status: 'cancelled',
        updatedAt: 1_100,
        cancelledAt: 1_100,
      },
    },
  ),
  'scheduled-task/run': methodFixture(
    'scheduled-task/run',
    {
      id: scheduledTask.id,
      operationId: 'operation:scheduled-task-run',
    },
    { scheduledTask: { ...scheduledTask, status: 'claimed' } },
  ),
  'schedule-plan/read': methodFixture(
    'schedule-plan/read',
    {
      id: schedulePlanProposal.id,
    },
    { proposal: schedulePlanProposal },
  ),
  'schedule-plan/commit': methodFixture(
    'schedule-plan/commit',
    {
      id: schedulePlanProposal.id,
      expectedRevision: schedulePlanProposal.revision,
      operationId: 'operation:schedule-plan-commit',
      defaults: schedulePlanDefaults,
      items: schedulePlanItems,
    },
    {
      proposal: {
        ...schedulePlanProposal,
        revision: 2,
        status: 'committed',
        createdRefs: [{ kind: 'scheduled-task', id: scheduledTask.id }],
        updatedAt: 1_100,
        committedAt: 1_100,
      },
    },
  ),
  'schedule-draft/read': methodFixture(
    'schedule-draft/read',
    { id: scheduleDraft.id },
    { draft: scheduleDraft },
  ),
  'schedule-draft/commit': methodFixture(
    'schedule-draft/commit',
    {
      id: scheduleDraft.id,
      expectedRevision: scheduleDraft.revision,
      operationId: 'operation:schedule-draft-commit',
      trigger: scheduleDraft.trigger,
      conditions: scheduleDraft.conditions,
      conditionFallback: scheduleDraft.conditionFallback,
      acceptance: scheduleDraft.acceptance,
      notificationPolicy: scheduleDraft.notificationPolicy,
      missedRuns: scheduleDraft.missedRuns,
      execution: scheduleDraft.execution,
    },
    {
      draft: {
        ...scheduleDraft,
        revision: 2,
        status: 'committed',
        createdRefs: [{ kind: 'scheduled-task', id: scheduledTask.id }],
        updatedAt: 1_100,
        committedAt: 1_100,
      },
    },
  ),
  'schedule-draft/cancel': methodFixture(
    'schedule-draft/cancel',
    { id: scheduleDraft.id, expectedRevision: scheduleDraft.revision },
    { draft: { ...scheduleDraft, revision: 2, status: 'cancelled', updatedAt: 1_100 } },
  ),
  'schedule-draft/feedback': methodFixture(
    'schedule-draft/feedback',
    {
      id: scheduleDraft.id,
      expectedRevision: scheduleDraft.revision,
      operationId: 'operation:schedule-draft-feedback',
      feedback: '先完成提问交互',
    },
    { draft: { ...scheduleDraft, revision: 2, status: 'cancelled', updatedAt: 1_100 } },
  ),
  'automation/list': methodFixture(
    'automation/list',
    {
      statuses: ['active'],
      query: '代码',
    },
    { automations: [automation] },
  ),
  'automation/read': methodFixture(
    'automation/read',
    {
      automationId: automation.id,
    },
    { automation },
  ),
  'automation/create': methodFixture(
    'automation/create',
    {
      operationId: 'operation:automation-create',
      kind: automation.kind,
      name: automation.name,
      prompt: automation.prompt,
      projectId: automation.projectId,
      targetThreadId: automation.targetThreadId,
      execution: automation.execution,
      model: automation.model,
      reasoningEffort: automation.reasoningEffort,
      permissionConfig: automation.permissionConfig,
      schedule: automation.schedule,
      timeZone: automation.timeZone,
      notificationPolicy: automation.notificationPolicy,
    },
    { automation },
  ),
  'automation/update': methodFixture(
    'automation/update',
    {
      automationId: automation.id,
      expectedRevision: automation.revision,
      name: '每日仓库检查',
    },
    { automation: { ...automation, revision: 2, name: '每日仓库检查', updatedAt: 1_100 } },
  ),
  'automation/delete': methodFixture(
    'automation/delete',
    {
      automationId: automation.id,
      expectedRevision: automation.revision,
    },
    {
      automation: {
        ...automation,
        revision: 2,
        status: 'deleted',
        nextRunAt: null,
        deletedAt: 1_200,
      },
    },
  ),
  'automation/run': methodFixture(
    'automation/run',
    {
      automationId: automation.id,
      operationId: 'operation:automation-run',
    },
    { run: automationRun },
  ),
  'automation/run/list': methodFixture(
    'automation/run/list',
    {
      automationId: automation.id,
      unreadOnly: true,
      limit: 20,
    },
    { runs: [automationRun] },
  ),
  'automation/run/mark-read': methodFixture(
    'automation/run/mark-read',
    {
      runId: automationRun.id,
    },
    { run: { ...automationRun, readAt: 1_600 } },
  ),
  'automation/run/mark-all-read': methodFixture(
    'automation/run/mark-all-read',
    {
      automationId: automation.id,
    },
    { updatedCount: 1 },
  ),
  'automation/schedule/preview': methodFixture(
    'automation/schedule/preview',
    {
      schedule: automation.schedule,
      timeZone: automation.timeZone,
      count: 3,
    },
    {
      preview: {
        canonicalRrule: automation.canonicalRrule,
        summary: '每天 09:00',
        nextRunAt: [2_000, 3_000, 4_000],
      },
    },
  ),
  'config/read': methodFixture(
    'config/read',
    {
      includeLayers: true,
      cwd: 'F:/CodeProject/example',
    },
    {
      config: { model: 'gpt-5.6', desktop: { showContextUsage: true } },
      origins: { model: 'user', 'desktop.showContextUsage': 'user' },
      layers: [
        {
          kind: 'user',
          displayName: '用户配置',
          filePath: 'C:/Users/example/.pidex/config.json',
          version: 'a'.repeat(64),
          writable: true,
          trusted: true,
          config: { model: 'gpt-5.6' },
        },
      ],
      diagnostics: [],
      profileState: {
        activeProfile: null,
        selectedProfile: null,
        restartRequired: false,
      },
    },
  ),
  'config/value/write': methodFixture(
    'config/value/write',
    {
      keyPath: ['desktop', 'showContextUsage'],
      value: true,
      expectedVersion: 'a'.repeat(64),
    },
    {
      status: 'ok',
      version: 'b'.repeat(64),
      filePath: 'C:/Users/example/.pidex/config.json',
    },
  ),
  'config/batchWrite': methodFixture(
    'config/batchWrite',
    {
      edits: [
        { keyPath: ['model'], value: 'gpt-5.6' },
        { keyPath: ['desktop', 'reviewView'], value: 'inline' },
      ],
      expectedVersion: 'b'.repeat(64),
      reloadUserConfig: true,
    },
    {
      status: 'ok-overridden',
      version: 'c'.repeat(64),
      filePath: 'C:/Users/example/.pidex/config.json',
      overridden: [{ keyPath: ['model'], by: 'project' }],
    },
  ),
  'config/profile/list': methodFixture(
    'config/profile/list',
    {},
    {
      profileState: {
        activeProfile: 'deep-review',
        selectedProfile: 'deep-review',
        restartRequired: false,
      },
      profiles: [
        {
          id: 'deep-review',
          displayName: '深度审查',
          description: '高推理强度',
          filePath: 'C:/Users/example/.pidex/profiles/deep-review.json',
          version: 'd'.repeat(64),
          valid: true,
          diagnostics: [],
        },
      ],
      profilesDirectory: 'C:/Users/example/.pidex/profiles',
    },
  ),
  'config/profile/select': methodFixture(
    'config/profile/select',
    {
      profileId: 'deep-review',
    },
    {
      status: 'ok',
      version: 'e'.repeat(64),
      filePath: 'C:/Users/example/.pidex/config.json',
      profileState: {
        activeProfile: null,
        selectedProfile: 'deep-review',
        restartRequired: true,
      },
    },
  ),
  'project/trust/read': methodFixture(
    'project/trust/read',
    {
      cwd: 'F:/CodeProject/example',
    },
    {
      projectRoot: 'F:/CodeProject/example',
      trustLevel: 'untrusted',
      hasProjectConfig: true,
    },
  ),
  'project/trust/update': methodFixture(
    'project/trust/update',
    {
      cwd: 'F:/CodeProject/example',
      trustLevel: 'trusted',
      expectedVersion: 'c'.repeat(64),
    },
    {
      status: 'ok',
      version: 'd'.repeat(64),
      filePath: 'C:/Users/example/.pidex/config.json',
    },
  ),
  initialize: methodFixture(
    'initialize',
    {
      clientInfo: {
        name: 'Pidex Desktop',
        version: '0.1.0',
        platform: 'win32',
        instanceId: 'client:1',
      },
      protocols: ['thread-rpc-v4'],
      capabilities: ['event.stream.v1'],
      interactionDelivery: 'active',
    },
    {
      protocol: 'thread-rpc-v4',
      serverInfo: { name: 'Pidex Agent', version: '0.1.0' },
      capabilities: ['event.stream.v1'],
      limits: {
        maxFrameBytes: 1_000_000,
        maxSubscriptions: 8,
        maxStreamsPerSubscription: 32,
        maxPendingRequests: 16,
      },
      connectionId: 'connection:1',
    },
  ),
  shutdown: methodFixture(
    'shutdown',
    { operationId: 'operation:shutdown' },
    { ok: true, acceptedAt: 1 },
  ),
  'event/subscribe': methodFixture(
    'event/subscribe',
    {
      streams: [{ streamId: streamPosition.streamId, after: 0 }],
      liveEventTypes: ['turn/delta'],
    },
    {
      subscriptionId: 'subscription:1',
      highWatermarks: [streamPosition],
    },
  ),
  'event/ack': methodFixture(
    'event/ack',
    {
      subscriptionId: 'subscription:1',
      positions: [streamPosition],
    },
    {
      subscriptionId: 'subscription:1',
      acknowledged: [streamPosition],
    },
  ),
  'event/unsubscribe': methodFixture(
    'event/unsubscribe',
    { subscriptionId: 'subscription:1' },
    { ok: true },
  ),
  'interaction/listPending': methodFixture(
    'interaction/listPending',
    {
      threadId: threadListItem.id,
      kinds: ['question'],
      cursor: 'cursor:1',
      limit: 20,
    },
    {
      interactions: [],
      nextCursor: null,
    },
  ),
  'interaction/respond': methodFixture(
    'interaction/respond',
    {
      interactionId: 'interaction:1',
      expectedVersion: 1,
      response: { kind: 'question', status: 'ignored' },
      operationId: 'operation:interaction',
    },
    {
      interactionId: 'interaction:1',
      kind: 'question',
      state: 'resolved',
      version: 2,
      resolvedAt: 2,
      response: { kind: 'question', status: 'ignored' },
    },
  ),
  'project/list': methodFixture(
    'project/list',
    { cursor: 'cursor:1', limit: 20, folderPath: project.folders[0].path },
    { projects: [project], nextCursor: null },
  ),
  'project/create': methodFixture(
    'project/create',
    {
      name: project.name,
      primaryPath: project.folders[0].path,
      operationId: 'operation:project-create',
    },
    { project },
  ),
  'project/open': methodFixture(
    'project/open',
    {
      projectId: project.id,
      operationId: 'operation:project-open',
    },
    { project },
  ),
  'project/update': methodFixture(
    'project/update',
    {
      projectId: project.id,
      name: project.name,
      expectedVersion: project.updatedAt,
      operationId: 'operation:project-update',
    },
    { project },
  ),
  'project/edit': methodFixture(
    'project/edit',
    {
      projectId: project.id,
      name: project.name,
      paths: [],
      expectedVersion: project.updatedAt,
      operationId: 'operation:project-edit',
    },
    { project },
  ),
  'project/restore': methodFixture(
    'project/restore',
    {
      projectId: project.id,
      removalOperationId: 'operation:project-remove',
      operationId: 'operation:project-restore',
    },
    { project },
  ),
  'project/remove': methodFixture(
    'project/remove',
    {
      projectId: project.id,
      operationId: 'operation:project-remove',
    },
    { projectId: project.id, removedAt: 2, archivedThreadCount: 1 },
  ),
  'project/context/read': methodFixture(
    'project/context/read',
    {
      projectId: project.id,
    },
    { project, sources: [] },
  ),
  'project/folder/add': methodFixture(
    'project/folder/add',
    {
      projectId: project.id,
      path: 'F:\\fixture-secondary',
      operationId: 'operation:folder-add',
    },
    { project, changed: true },
  ),
  'project/folder/remove': methodFixture(
    'project/folder/remove',
    {
      projectId: project.id,
      folderId: 'folder:2',
      operationId: 'operation:folder-remove',
    },
    { project, changed: true },
  ),
  'project/folder/set-primary': methodFixture(
    'project/folder/set-primary',
    {
      projectId: project.id,
      folderId: project.primaryFolderId,
      operationId: 'operation:folder-primary',
    },
    { project, changed: false },
  ),
  'project/settings/update': methodFixture(
    'project/settings/update',
    {
      projectId: project.id,
      settings: {
        defaultModel: modelRef,
        instructions: 'Project instructions',
        executionEnvironment: 'local' as const,
      },
      expectedVersion: 1,
      operationId: 'operation:project-settings',
    },
    {
      projectId: project.id,
      settings: {
        defaultModel: modelRef,
        instructions: 'Project instructions',
        executionEnvironment: 'local' as const,
        version: 2,
      },
      version: 2,
    },
  ),
  'project/source/list': methodFixture(
    'project/source/list',
    {
      projectId: project.id,
      cursor: 'offset:0',
      limit: 20,
    },
    { sources: [], nextCursor: null },
  ),
  'project/source/import': methodFixture(
    'project/source/import',
    {
      projectId: project.id,
      uploads: [
        {
          kind: 'text',
          name: 'context.md',
          mediaType: 'text/markdown',
          encoding: 'utf8',
          data: '# Context',
        },
      ],
      operationId: 'operation:source-import',
    },
    { sources: [] },
  ),
  'project/source/reference/add': methodFixture(
    'project/source/reference/add',
    {
      projectId: project.id,
      folderId: project.primaryFolderId,
      path: 'README.md',
      operationId: 'operation:source-reference',
    },
    { sources: [] },
  ),
  'project/source/read': methodFixture(
    'project/source/read',
    {
      projectId: project.id,
      sourceId: 'source:1',
      range: { offset: 0, length: 100 },
    },
    {
      source: {
        storage: 'managed',
        id: 'source:1',
        projectId: project.id,
        kind: 'text',
        name: 'context.md',
        mediaType: 'text/markdown',
        sizeBytes: 9,
        sha256: 'a'.repeat(64),
        status: 'available',
      },
      data: '# Context',
      encoding: 'utf8',
      range: { offset: 0, length: 9, total: 9 },
    },
  ),
  'project/source/remove': methodFixture(
    'project/source/remove',
    {
      projectId: project.id,
      sourceId: 'source:1',
      operationId: 'operation:source-remove',
    },
    { sourceId: 'source:1', removed: true },
  ),
  'workspace/file/list': methodFixture(
    'workspace/file/list',
    {
      projectId: project.id,
      folderId: project.primaryFolderId,
      path: '.',
    },
    {
      entries: [
        { name: 'src', path: 'src', type: 'directory', depth: 0 },
        { name: 'README.md', path: 'README.md', type: 'file', depth: 0 },
      ],
    },
  ),
  'workspace/file/read': methodFixture(
    'workspace/file/read',
    {
      projectId: project.id,
      folderId: project.primaryFolderId,
      path: 'src/index.ts',
    },
    {
      path: 'src/index.ts',
      content: 'export {}',
      sizeBytes: 9,
      readonly: false,
      truncated: false,
      revision: { mtimeMs: 1, sha256: 'a'.repeat(64) },
    },
  ),
  'workspace/file/save': methodFixture(
    'workspace/file/save',
    {
      projectId: project.id,
      folderId: project.primaryFolderId,
      path: 'src/index.ts',
      content: 'export {}',
      expectedRevision: { mtimeMs: 1, sha256: 'a'.repeat(64) },
    },
    {
      outcome: 'saved',
      revision: { mtimeMs: 2, sha256: 'b'.repeat(64) },
    },
  ),
  'workspace/file/watch': methodFixture(
    'workspace/file/watch',
    {
      projectId: project.id,
      folderId: project.primaryFolderId,
      path: 'src/index.ts',
    },
    {
      watching: true,
      path: 'src/index.ts',
    },
  ),
  'workspace/file/unwatch': methodFixture(
    'workspace/file/unwatch',
    {
      projectId: project.id,
      folderId: project.primaryFolderId,
      path: 'src/index.ts',
    },
    {
      watching: false,
      path: 'src/index.ts',
    },
  ),
  'thread/list': methodFixture(
    'thread/list',
    {
      projectId: project.id,
      archived: false,
      cursor: 'cursor:1',
      limit: 20,
    },
    { threads: [threadListItem], nextCursor: null },
  ),
  'thread/create': methodFixture(
    'thread/create',
    {
      workspace: { kind: 'project', projectId: project.id },
      title: threadListItem.title,
      settings: threadSettings,
      operationId: 'operation:thread-create',
    },
    { snapshot: threadSnapshot, streamPosition },
  ),
  'thread/read': methodFixture(
    'thread/read',
    { threadId: threadListItem.id },
    { snapshot: threadSnapshot, streamPosition },
  ),
  'thread/history/read': methodFixture(
    'thread/history/read',
    {
      threadId: threadListItem.id,
      before: 'history-cursor:1',
      limit: 10,
    },
    {
      thread: threadSnapshot.thread,
      subagents: [],
      turns: [],
      queue: { version: 0, pauseReason: null, turns: [], inputs: [] },
      olderCursor: null,
      hasOlder: false,
      streamPosition,
    },
  ),
  'thread/update': methodFixture(
    'thread/update',
    {
      threadId: threadListItem.id,
      patch: { title: 'Updated fixture thread', archived: false },
      operationId: 'operation:thread-update',
      expectedVersion: 1,
    },
    { thread: threadListItem },
  ),
  'thread/mark-read': methodFixture(
    'thread/mark-read',
    {
      threadId: threadListItem.id,
      readThroughAt: 2,
      operationId: 'operation:thread-mark-read',
    },
    { thread: { ...threadListItem, unreadAt: null } },
  ),
  'thread/mark-unread': methodFixture(
    'thread/mark-unread',
    {
      threadId: threadListItem.id,
      unreadAt: 3,
      operationId: 'operation:thread-mark-unread',
    },
    { thread: { ...threadListItem, unreadAt: 3 } },
  ),
  'thread/title/regenerate': methodFixture(
    'thread/title/regenerate',
    {
      threadId: threadListItem.id,
      operationId: 'operation:thread-title-regenerate',
    },
    { thread: threadListItem },
  ),
  'thread/settings/update': methodFixture(
    'thread/settings/update',
    {
      threadId: threadListItem.id,
      settings: { taskMode: 'plan' },
      operationId: 'operation:thread-settings',
      expectedVersion: 1,
    },
    {
      threadId: threadListItem.id,
      settings: threadSettings,
      version: 2,
    },
  ),
  'thread/delete': methodFixture(
    'thread/delete',
    {
      threadId: threadListItem.id,
      operationId: 'operation:thread-delete',
    },
    { threadId: threadListItem.id, deletedAt: 2 },
  ),
  'thread/side-chat/create': methodFixture(
    'thread/side-chat/create',
    {
      sourceThreadId: threadListItem.id,
      referenceText: 'selected reference',
      operationId: 'operation:side-chat-create',
    },
    {
      sideChat: {
        threadId: 'thread:side-chat',
        sourceThreadId: threadListItem.id,
        inheritedThroughTurnId: 'turn:1',
        createdAt: 2,
      },
    },
  ),
  'thread/side-chat/discard': methodFixture(
    'thread/side-chat/discard',
    {
      threadId: 'thread:side-chat',
      operationId: 'operation:side-chat-discard',
    },
    { ok: true },
  ),
  'thread/patch/diff': methodFixture(
    'thread/patch/diff',
    {
      threadId: threadListItem.id,
      toolCallId: 'tool:edit-1',
      path: 'src/index.ts',
    },
    {
      path: 'src/index.ts',
      operation: 'update',
      patch: '--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n',
      hunks: [
        {
          id: 'hunk:1',
          header: '@@ -1,1 +1,1 @@',
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          patch: '--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n',
        },
      ],
      renderable: true,
      tooLargeReason: null,
    },
  ),
  'thread/patch/apply': methodFixture(
    'thread/patch/apply',
    {
      threadId: threadListItem.id,
      itemId: 'patch:turn:1',
      action: 'undo',
      expectedVersion: 0,
      operationId: 'operation:thread-patch-apply',
    },
    {
      item: {
        id: 'patch:turn:1',
        messageID: 'turn:1',
        turnId: 'turn:1',
        agentId: 'agent:1',
        type: 'patch',
        files: [{ path: 'src/index.ts', additions: 1, deletions: 1 }],
        totalAdditions: 1,
        totalDeletions: 1,
        reversible: true,
        applyState: 'undone',
        actionVersion: 1,
        createdAt: 1,
      },
    },
  ),
  'prompt/preview': methodFixture(
    'prompt/preview',
    { threadId: threadListItem.id },
    {
      threadId: threadListItem.id,
      preview: promptPreview,
      cacheKey: promptPreview.cacheKey,
    },
  ),
  'prompt/refresh': methodFixture(
    'prompt/refresh',
    {
      threadId: threadListItem.id,
      operationId: 'operation:prompt-refresh',
    },
    {
      threadId: threadListItem.id,
      settings: promptSettingsSnapshot,
      cacheKey: promptPreview.cacheKey,
    },
  ),
  'thread/compact': methodFixture(
    'thread/compact',
    {
      threadId: threadListItem.id,
      operationId: 'operation:thread-compact',
    },
    {
      compaction: {
        id: 'compaction:1',
        trigger: 'manual',
        beforeCount: 10,
        afterCount: 4,
        beforeTokens: 1_000,
        afterTokens: 400,
        afterTokensSource: 'measured',
        targetTokens: 500,
        usageSampleId: 'usage:1',
        baselineVersion: 2,
      },
    },
  ),
  'turn/start': methodFixture(
    'turn/start',
    {
      threadId: threadListItem.id,
      inputId: admission.inputId,
      content: 'Start the fixture turn.',
      attachmentIds: [attachment.id],
      model: modelRef,
      permissionConfig,
      taskMode: 'chat',
    },
    admission,
  ),
  'turn/steer': methodFixture(
    'turn/steer',
    {
      threadId: threadListItem.id,
      turnId: admission.turnId,
      inputId: 'input:steer:1',
      content: 'Steer the fixture turn.',
      attachmentIds: [attachment.id],
    },
    { ...admission, inputId: 'input:steer:1' },
  ),
  'turn/interrupt': methodFixture(
    'turn/interrupt',
    {
      threadId: threadListItem.id,
      turnId: admission.turnId,
      operationId: 'operation:turn-interrupt',
    },
    {
      threadId: threadListItem.id,
      turnId: admission.turnId,
      status: 'interrupted',
    },
  ),
  'turn/resume': methodFixture(
    'turn/resume',
    {
      threadId: threadListItem.id,
      turnId: admission.turnId,
      operationId: 'operation:turn-resume',
    },
    {
      threadId: threadListItem.id,
      turnId: admission.turnId,
      status: 'running',
    },
  ),
  'queue/add': methodFixture(
    'queue/add',
    {
      threadId: threadListItem.id,
      inputId: 'input:queued:1',
      content: 'Queue the fixture follow-up.',
      attachmentIds: [attachment.id],
      model: modelRef,
      permissionConfig,
      taskMode: 'chat',
      operationId: 'operation:queue-add',
      expectedVersion: 1,
    },
    {
      ...admission,
      inputId: 'input:queued:1',
      admission: 'queued',
    },
  ),
  'queue/update': methodFixture(
    'queue/update',
    {
      threadId: threadListItem.id,
      inputId: 'input:queued:1',
      content: 'edited',
      operationId: 'operation:queue-update',
      expectedVersion: 1,
    },
    {
      threadId: threadListItem.id,
      version: 2,
      pauseReason: null,
      turns: [],
      inputs: [],
      streamPosition,
    },
  ),
  'queue/remove': methodFixture(
    'queue/remove',
    {
      threadId: threadListItem.id,
      inputId: 'input:queued:1',
      operationId: 'operation:queue-remove',
      expectedVersion: 2,
    },
    {
      threadId: threadListItem.id,
      version: 3,
      pauseReason: null,
      turns: [],
      inputs: [],
      streamPosition,
    },
  ),
  'queue/resume': methodFixture(
    'queue/resume',
    {
      threadId: threadListItem.id,
      operationId: 'operation:queue-resume',
      expectedVersion: 3,
    },
    {
      threadId: threadListItem.id,
      version: 4,
      pauseReason: null,
      turns: [],
      inputs: [],
      streamPosition,
    },
  ),
  'sandbox/status': methodFixture('sandbox/status', {}, { sandbox: sandboxStatus }),
  'sandbox/refresh': methodFixture('sandbox/refresh', {}, { sandbox: sandboxStatus }),
  'sandbox/install': methodFixture(
    'sandbox/install',
    { operationId: 'operation:sandbox-install' },
    { sandbox: sandboxStatus },
  ),
  'sandbox/repair': methodFixture(
    'sandbox/repair',
    { operationId: 'operation:sandbox-repair' },
    { sandbox: sandboxStatus },
  ),
  'sandbox/uninstall': methodFixture(
    'sandbox/uninstall',
    {
      confirm: true,
      operationId: 'operation:sandbox-uninstall',
    },
    { sandbox: sandboxStatus },
  ),
  'tooling/list': methodFixture('tooling/list', {}, { statuses: [toolingStatus] }),
  'tooling/refresh': methodFixture('tooling/refresh', {}, { statuses: [toolingStatus] }),
  'tooling/setPreference': methodFixture(
    'tooling/setPreference',
    {
      id: 'git-bash',
      preference: 'managed',
      operationId: 'operation:tooling-preference',
    },
    { status: toolingStatus },
  ),
  'tooling/install': methodFixture(
    'tooling/install',
    {
      id: 'git-bash',
      force: false,
      operationId: 'operation:tooling-install',
    },
    { status: toolingStatus },
  ),
  'skill/list': methodFixture(
    'skill/list',
    {
      workspace: 'C:\\workspace',
      forceReload: true,
    },
    {
      skills: [
        {
          name: 'fixture-skill',
          description: 'Fixture skill',
          path: 'C:\\workspace\\.codex\\skills\\fixture-skill\\SKILL.md',
          scope: 'workspace',
          format: 'codex',
          enabled: true,
        },
      ],
      generation: 1,
      updatedAt: 1,
    },
  ),
  'skill/read': methodFixture(
    'skill/read',
    {
      workspace: 'C:\\workspace',
      path: 'C:\\workspace\\.codex\\skills\\fixture-skill\\SKILL.md',
    },
    {
      skill: {
        name: 'fixture-skill',
        description: 'Fixture skill',
        path: 'C:\\workspace\\.codex\\skills\\fixture-skill\\SKILL.md',
        scope: 'workspace',
        format: 'codex',
        enabled: true,
      },
      content: '---\nname: fixture-skill\n---\nFixture',
    },
  ),
  'skill/setEnabled': methodFixture(
    'skill/setEnabled',
    {
      path: 'C:\\workspace\\.codex\\skills\\fixture-skill\\SKILL.md',
      enabled: false,
      operationId: 'operation:skill-disable',
    },
    {
      skill: {
        name: 'fixture-skill',
        description: 'Fixture skill',
        path: 'C:\\workspace\\.codex\\skills\\fixture-skill\\SKILL.md',
        scope: 'workspace',
        format: 'codex',
        enabled: false,
      },
      generation: 2,
      updatedAt: 2,
    },
  ),
  'plugin/list': methodFixture(
    'plugin/list',
    {
      workspace: 'C:\\workspace',
      forceReload: true,
    },
    {
      plugins: [
        {
          id: 'task-planning',
          name: '任务规划',
          version: '1.0.0',
          description: '澄清目标、拆解工作并生成可执行的任务规划。',
          developerName: 'Pidex',
          category: 'Productivity',
          source: 'bundled',
          installationPolicy: 'INSTALLED_BY_DEFAULT',
          installed: true,
          enabled: true,
          status: 'ready',
          capabilities: ['task-planning'],
          skills: ['task-planning'],
        },
      ],
      generation: 1,
      updatedAt: 1,
    },
  ),
  'plugin/getDetails': methodFixture(
    'plugin/getDetails',
    {
      pluginId: 'task-planning',
      workspace: 'C:\\workspace',
    },
    {
      details: {
        pluginId: 'task-planning',
        longDescription: '澄清目标与约束，将复杂工作拆分为里程碑和可执行任务。',
        displayCapabilities: ['Planning'],
        defaultPrompts: ['帮我把这个目标拆解成可执行的任务计划。'],
        skills: [
          {
            id: 'task-planning',
            name: 'task-planning',
            description: 'Clarify goals and constraints.',
          },
        ],
      },
    },
  ),
  'plugin/setEnabled': methodFixture(
    'plugin/setEnabled',
    {
      pluginId: 'task-planning',
      enabled: false,
      operationId: 'operation:plugin-disable',
    },
    {
      plugin: {
        id: 'task-planning',
        name: '任务规划',
        version: '1.0.0',
        description: '澄清目标、拆解工作并生成可执行的任务规划。',
        developerName: 'Pidex',
        category: 'Productivity',
        source: 'bundled',
        installationPolicy: 'INSTALLED_BY_DEFAULT',
        installed: true,
        enabled: false,
        status: 'ready',
        capabilities: ['task-planning'],
        skills: ['task-planning'],
      },
      generation: 2,
      updatedAt: 2,
    },
  ),
  'minimaxCli/status': methodFixture(
    'minimaxCli/status',
    {
      forceReload: true,
    },
    {
      installationStatus: 'installed',
      installedVersion: '1.0.22',
      latestVersion: '1.0.22',
      updateAvailable: false,
      nodeVersion: 'v22.22.1',
      npmVersion: '10.9.4',
      authStatus: 'coding-plan-synced',
      credentialSource: {
        providerId: 'minimax-cn-coding-plan',
        credentialId: 'credential:minimax-cn',
        label: '当前 Coding Plan Key',
        maskedValue: 'sk-****abcd',
        region: 'cn',
      },
      quotaStatus: 'available',
      quotaLabel: '套餐可用',
      generation: 2,
      updatedAt: 2,
    },
  ),
  'minimaxCli/install': methodFixture(
    'minimaxCli/install',
    {
      operationId: 'operation:minimax-install',
    },
    {
      installationStatus: 'installed',
      installedVersion: '1.0.22',
      latestVersion: '1.0.22',
      updateAvailable: false,
      nodeVersion: 'v22.22.1',
      npmVersion: '10.9.4',
      authStatus: 'not-authenticated',
      generation: 2,
      updatedAt: 2,
    },
  ),
  'minimaxCli/uninstall': methodFixture(
    'minimaxCli/uninstall',
    {
      operationId: 'operation:minimax-uninstall',
    },
    {
      installationStatus: 'not-installed',
      updateAvailable: false,
      nodeVersion: 'v22.22.1',
      npmVersion: '10.9.4',
      authStatus: 'not-authenticated',
      generation: 3,
      updatedAt: 3,
    },
  ),
  'mcp/list': methodFixture(
    'mcp/list',
    {
      workspace: 'C:\\workspace',
    },
    {
      servers: [
        {
          server: {
            name: 'fixture',
            scope: 'local',
            enabled: true,
            diagnosticContext: true,
            required: true,
            enabledTools: ['echo', 'read'],
            disabledTools: ['write'],
            defaultToolsApprovalMode: 'writes',
            tools: {
              echo: { approvalMode: 'approve' },
            },
            transport: {
              type: 'stdio',
              command: 'bun',
              args: ['fixture.ts'],
              envFromHost: { MCP_TOKEN: 'PIDEX_MCP_TOKEN' },
            },
            startupTimeoutMs: 10_000,
            toolTimeoutMs: 60_000,
          },
          effective: true,
        },
      ],
      generation: 1,
    },
  ),
  'mcp/status': methodFixture(
    'mcp/status',
    {
      workspace: 'C:\\workspace',
    },
    {
      servers: [
        {
          name: 'fixture',
          scope: 'local',
          type: 'stdio',
          state: 'connected',
          auth: {
            source: 'none',
            canLogin: false,
            canLogout: false,
          },
          toolCount: 1,
          resourceCount: 1,
          promptCount: 1,
        },
      ],
      totalTools: 1,
      totalResources: 1,
      totalPrompts: 1,
      generation: 1,
    },
  ),
  'mcp/save': methodFixture(
    'mcp/save',
    {
      workspace: 'C:\\workspace',
      server: {
        name: 'fixture',
        scope: 'local',
        enabled: true,
        transport: {
          type: 'http',
          url: 'https://example.com/mcp',
          auth: 'oauth',
          scopes: ['mcp:read', 'mcp:write'],
          oauthResource: 'https://example.com/',
          headerFromEnv: { Authorization: 'PIDEX_MCP_AUTHORIZATION' },
        },
      },
      operationId: 'operation:mcp-save:1',
    },
    {
      servers: [
        {
          server: {
            name: 'fixture',
            scope: 'local',
            enabled: true,
            transport: {
              type: 'http',
              url: 'https://example.com/mcp',
              auth: 'oauth',
              scopes: ['mcp:read', 'mcp:write'],
              oauthResource: 'https://example.com/',
              headerFromEnv: { Authorization: 'PIDEX_MCP_AUTHORIZATION' },
            },
          },
          effective: true,
        },
      ],
      generation: 2,
    },
  ),
  'mcp/remove': methodFixture(
    'mcp/remove',
    {
      workspace: 'C:\\workspace',
      scope: 'local',
      name: 'fixture',
      operationId: 'operation:mcp-remove:1',
    },
    {
      servers: [],
      generation: 3,
    },
  ),
  'mcp/setEnabled': methodFixture(
    'mcp/setEnabled',
    {
      workspace: 'C:\\workspace',
      scope: 'local',
      name: 'fixture',
      enabled: false,
      operationId: 'operation:mcp-enabled:1',
    },
    {
      servers: [
        {
          server: {
            name: 'fixture',
            scope: 'local',
            enabled: false,
            transport: {
              type: 'stdio',
              command: 'bun',
            },
          },
          effective: true,
        },
      ],
      generation: 4,
    },
  ),
  'mcp/reload': methodFixture(
    'mcp/reload',
    {
      workspace: 'C:\\workspace',
      operationId: 'operation:mcp-reload:1',
    },
    {
      generation: 5,
      added: ['fixture'],
      replaced: [],
      removed: [],
      unchanged: [],
      failed: [],
    },
  ),
  'mcp/oauth/start': methodFixture(
    'mcp/oauth/start',
    {
      workspace: 'C:\\workspace',
      scope: 'local',
      name: 'fixture',
      operationId: 'operation:mcp-oauth-start:1',
    },
    {
      attemptId: 'mcp-oauth-attempt:1',
      authorizationUrl: 'https://example.com/oauth/authorize',
      expiresAt: 1_800_000_000_000,
    },
  ),
  'mcp/oauth/status': methodFixture(
    'mcp/oauth/status',
    {
      attemptId: 'mcp-oauth-attempt:1',
    },
    {
      state: 'pending',
    },
  ),
  'mcp/oauth/logout': methodFixture(
    'mcp/oauth/logout',
    {
      workspace: 'C:\\workspace',
      scope: 'local',
      name: 'fixture',
      operationId: 'operation:mcp-oauth-logout:1',
    },
    {
      generation: 6,
    },
  ),
  'attachment/import': methodFixture(
    'attachment/import',
    {
      uploads: [
        {
          kind: 'text',
          name: attachment.name,
          mediaType: attachment.mediaType,
          encoding: 'utf8',
          data: 'fixture',
        },
      ],
      operationId: 'operation:attachment-import',
    },
    { attachments: [attachment] },
  ),
  'attachment/read': methodFixture(
    'attachment/read',
    {
      attachmentId: attachment.id,
      range: { offset: 0, length: 7 },
    },
    {
      attachment,
      data: 'fixture',
      encoding: 'utf8',
      range: { offset: 0, length: 7, total: 7 },
    },
  ),
  'artifact/read': methodFixture(
    'artifact/read',
    {
      threadId: threadListItem.id,
      artifactId: 'artifact:1',
    },
    {
      artifact: {
        id: 'artifact:1',
        threadId: threadListItem.id,
        turnId: 'turn:1',
        itemId: 'item:1',
        name: 'preview.png',
        mimeType: 'image/png',
        sizeBytes: 7,
        createdAt: 1,
      },
      data: 'Zml4dHVyZQ==',
      encoding: 'base64',
      sizeBytes: 7,
    },
  ),
  'context/path/import': methodFixture(
    'context/path/import',
    {
      threadId: threadListItem.id,
      paths: [localContextReference.path],
      operationId: 'operation:context-import',
    },
    { references: [localContextReference] },
  ),
  'context/path/read': methodFixture(
    'context/path/read',
    {
      threadId: threadListItem.id,
      referenceId: localContextReference.id,
      range: { offset: 0, length: 7 },
    },
    {
      reference: localContextReference,
      relativePath: null,
      preview: 'text',
      mediaType: 'text/plain; charset=utf-8',
      data: 'fixture',
      encoding: 'utf8',
      range: { offset: 0, length: 7, total: 7 },
    },
  ),
  'context/path/list': methodFixture(
    'context/path/list',
    {
      threadId: threadListItem.id,
      referenceId: localContextReference.id,
      limit: 20,
    },
    {
      reference: localContextReference,
      relativePath: null,
      entries: [],
      nextCursor: null,
    },
  ),
  'speech/status': methodFixture(
    'speech/status',
    {},
    {
      status: {
        state: 'ready',
        provider: 'sensevoice-llamacpp',
        runtimeVersion: '0.1.9',
        model: 'sensevoice-small-q8',
        variant: 'avx2',
        maxDurationMs: 120_000,
        maxAudioBytes: 4_194_304,
      },
    },
  ),
  'speech/install': methodFixture(
    'speech/install',
    { force: true },
    {
      status: {
        state: 'downloading',
        provider: 'sensevoice-llamacpp',
        runtimeVersion: '0.1.9',
        model: 'sensevoice-small-q8',
        variant: null,
        progress: { receivedBytes: 1024, totalBytes: 2048 },
        maxDurationMs: 120_000,
        maxAudioBytes: 4_194_304,
      },
    },
  ),
  'speech/transcribe': methodFixture(
    'speech/transcribe',
    {
      operationId: 'operation:speech-transcribe:1',
      audio: { mediaType: 'audio/wav', encoding: 'base64', data: 'UklGRg==' },
    },
    { text: '你好', detectedLanguage: 'zh', durationMs: 1000 },
  ),
  'speech/cancel': methodFixture(
    'speech/cancel',
    {
      operationId: 'operation:speech-transcribe:1',
    },
    { cancelled: true },
  ),
  'memory/list': methodFixture(
    'memory/list',
    {
      scope: 'project',
      projectId: project.id,
      cursor: 'cursor:1',
      limit: 20,
    },
    { entries: [memoryEntry], nextCursor: null },
  ),
  'memory/read': methodFixture(
    'memory/read',
    {
      scope: 'project',
      projectId: project.id,
      id: memoryEntry.id,
    },
    { entry: memoryEntry },
  ),
  'memory/save': methodFixture(
    'memory/save',
    {
      scope: 'project',
      projectId: project.id,
      id: memoryEntry.id,
      content: memoryEntry.content,
      operationId: 'operation:memory-save',
    },
    { entry: memoryEntry },
  ),
  'memory/delete': methodFixture(
    'memory/delete',
    {
      scope: 'project',
      projectId: project.id,
      id: memoryEntry.id,
      operationId: 'operation:memory-delete',
    },
    { deleted: true, id: memoryEntry.id },
  ),
  'memory/reset': methodFixture(
    'memory/reset',
    {
      scope: 'project',
      projectId: project.id,
      includeEventLog: true,
      operationId: 'operation:memory-reset',
    },
    { deleted: 1 },
  ),
  'task-suggestion/generate': methodFixture(
    'task-suggestion/generate',
    {
      workspace: { kind: 'project', projectId: project.id },
      context: {
        workspaceName: project.name,
        branchName: 'main',
        git: {
          clean: false,
          ahead: 1,
          behind: 0,
          totalFiles: 1,
          files: [
            {
              path: 'src/index.ts',
              status: 'modified',
              stagedStatus: '',
              unstagedStatus: 'M',
            },
          ],
        },
        recentTasks: [
          {
            id: threadListItem.id,
            title: threadListItem.title,
            firstPrompt: 'Implement task suggestions',
            status: 'done',
            updatedAt: 1,
          },
        ],
        localCandidates: [
          {
            id: 'local:1',
            categoryId: 'codex-review',
            label: '审查当前改动',
            prompt: 'Review the current changes',
          },
          {
            id: 'local:2',
            categoryId: 'codex-fix',
            label: '修复失败测试',
            prompt: 'Fix the failing tests',
          },
          {
            id: 'local:3',
            categoryId: 'codex-explore',
            label: '理解当前架构',
            prompt: 'Explore the current architecture',
          },
          {
            id: 'local:4',
            categoryId: 'codex-create',
            label: '继续构建功能',
            prompt: 'Build the next feature',
          },
        ],
      },
    },
    {
      contextKey: 'suggestion-context:1',
      generatedAt: 1,
      suggestions: [
        {
          id: 'suggestion:1',
          categoryId: 'codex-review',
          label: '审查当前任务建议改动',
          prompt: 'Review the current task suggestion implementation',
        },
      ],
    },
  ),
  'subagent/list': methodFixture(
    'subagent/list',
    {
      threadId: threadListItem.id,
      cursor: 'cursor:1',
      limit: 20,
    },
    { subagents: [{ task: subagentTask, currentRun: subagentRun }], nextCursor: null },
  ),
  'subagent/read': methodFixture(
    'subagent/read',
    { taskId: subagentTask.id },
    {
      task: subagentTask,
      currentRun: subagentRun,
      snapshot: threadSnapshot,
      capabilities: subagentCapabilities,
    },
  ),
  'subagent/stop': methodFixture(
    'subagent/stop',
    {
      taskId: subagentTask.id,
      operationId: 'operation:subagent-stop',
    },
    { task: subagentTask, run: subagentRun },
  ),
  'subagent/send': methodFixture(
    'subagent/send',
    { taskId: subagentTask.id, message: '补充', operationId: 'operation:send' },
    { disposition: 'steering', run: subagentRun },
  ),
  'subagent/followup': methodFixture(
    'subagent/followup',
    { taskId: subagentTask.id, message: '后续任务', operationId: 'operation:followup' },
    admission,
  ),
  'subagent/retry': methodFixture(
    'subagent/retry',
    {
      taskId: subagentTask.id,
      operationId: 'operation:subagent-retry',
    },
    { task: subagentTask, run: subagentRun, admission },
  ),
  'subagent/worktree/diff': methodFixture(
    'subagent/worktree/diff',
    {
      taskId: subagentTask.id,
      maxBytes: 64_000,
      contextLines: 3,
    },
    { diff: 'diff --git a/fixture b/fixture', truncated: false },
  ),
  'subagent/worktree/apply': methodFixture(
    'subagent/worktree/apply',
    {
      taskId: subagentTask.id,
      operationId: 'operation:worktree-apply',
    },
    {
      result: {
        taskId: subagentTask.id,
        action: 'apply',
        outcome: 'changed',
        workspace: subagentWorkspace,
      },
    },
  ),
  'subagent/worktree/discard': methodFixture(
    'subagent/worktree/discard',
    {
      taskId: subagentTask.id,
      operationId: 'operation:worktree-discard',
    },
    {
      result: {
        taskId: subagentTask.id,
        action: 'discard',
        outcome: 'unchanged',
        workspace: subagentWorkspace,
      },
    },
  ),
  'subagent/workspace/restore': methodFixture(
    'subagent/workspace/restore',
    {
      taskId: subagentTask.id,
      operationId: 'operation:workspace-restore',
    },
    {
      result: {
        taskId: subagentTask.id,
        action: 'restore',
        outcome: 'changed',
        workspace: subagentWorkspace,
      },
    },
  ),
  'model/list': methodFixture(
    'model/list',
    {
      providerId,
      query: 'fixture',
      enabled: true,
      inputModality: 'text',
      outputModality: 'text',
      cursor: 'model-cursor:1',
      limit: 100,
    },
    modelCatalog,
  ),
  'provider/list': methodFixture('provider/list', {}, providerCatalog),
  'model/refresh': methodFixture(
    'model/refresh',
    { operationId: 'operation:model-refresh' },
    modelCatalog,
  ),
  'model/setDefault': methodFixture(
    'model/setDefault',
    {
      model: modelRef,
      operationId: 'operation:model-default',
    },
    { defaultModel: modelRef, settingsVersion: 2 },
  ),
  'model/setReviewer': methodFixture(
    'model/setReviewer',
    {
      model: modelRef,
      operationId: 'operation:model-reviewer',
    },
    { reviewerModel: modelRef, settingsVersion: 2 },
  ),
  'provider/test': methodFixture(
    'provider/test',
    { providerId, model: modelRef },
    {
      providerId,
      model: modelRef,
      status: 'reachable',
      testedAt: 1,
      latencyMs: 12,
    },
  ),
  'model/health/preview': methodFixture(
    'model/health/preview',
    {},
    {
      totalRequests: 1,
      excludedProviders: [
        {
          providerId,
          reason: 'no-eligible-models',
          modelCount: 0,
        },
      ],
    },
  ),
  'model/health/start': methodFixture(
    'model/health/start',
    {
      operationId: 'operation:model-health',
    },
    {
      run: {
        runId: 'operation:model-health',
        status: 'completed' as const,
        startedAt: 1,
        completedAt: 2,
        counts: {
          total: 1,
          queued: 0,
          running: 0,
          healthy: 1,
          failed: 0,
          cancelled: 0,
        },
        excludedProviders: [],
        items: [
          {
            model: modelRef,
            status: 'healthy' as const,
            startedAt: 1,
            completedAt: 2,
            latencyMs: 12,
          },
        ],
      },
    },
  ),
  'model/health/read': methodFixture(
    'model/health/read',
    {
      runId: 'operation:model-health',
    },
    {
      run: {
        runId: 'operation:model-health',
        status: 'completed' as const,
        startedAt: 1,
        completedAt: 2,
        counts: {
          total: 1,
          queued: 0,
          running: 0,
          healthy: 1,
          failed: 0,
          cancelled: 0,
        },
        excludedProviders: [],
        items: [
          {
            model: modelRef,
            status: 'healthy' as const,
            startedAt: 1,
            completedAt: 2,
            latencyMs: 12,
          },
        ],
      },
    },
  ),
  'model/health/cancel': methodFixture(
    'model/health/cancel',
    {
      runId: 'operation:model-health',
      operationId: 'operation:model-health-cancel',
    },
    {
      run: {
        runId: 'operation:model-health',
        status: 'cancelled' as const,
        startedAt: 1,
        completedAt: 2,
        counts: {
          total: 1,
          queued: 0,
          running: 0,
          healthy: 0,
          failed: 0,
          cancelled: 1,
        },
        excludedProviders: [],
        items: [
          {
            model: modelRef,
            status: 'cancelled' as const,
            completedAt: 2,
          },
        ],
      },
    },
  ),
  'provider/create': methodFixture(
    'provider/create',
    {
      definition: customProviderDefinition,
      operationId: 'operation:provider-create',
    },
    { providerId, catalogVersion: 2 },
  ),
  'provider/update': methodFixture(
    'provider/update',
    {
      providerId,
      definition: customProviderDefinition,
      operationId: 'operation:provider-update',
    },
    { providerId, catalogVersion: 2 },
  ),
  'provider/delete': methodFixture(
    'provider/delete',
    {
      providerId,
      operationId: 'operation:provider-delete',
    },
    { providerId, deleted: true, catalogVersion: 2 },
  ),
  'provider/model/discover': methodFixture(
    'provider/model/discover',
    {
      providerId,
      api: 'openai-completions',
    },
    { models: customProviderDefinition.models },
  ),
  'provider/credential/list': methodFixture(
    'provider/credential/list',
    { providerId },
    {
      credentials: [providerCredentialSummary],
    },
  ),
  'provider/credential/setActive': methodFixture(
    'provider/credential/setActive',
    {
      providerId,
      credentialId,
      operationId: 'operation:credential-active',
    },
    { credential: providerCredentialSummary },
  ),
  'provider/credential/setEnabled': methodFixture(
    'provider/credential/setEnabled',
    {
      credentialId,
      enabled: true,
      operationId: 'operation:credential-enabled',
    },
    { credential: providerCredentialSummary },
  ),
  'provider/credential/delete': methodFixture(
    'provider/credential/delete',
    {
      credentialId,
      operationId: 'operation:credential-delete',
    },
    { credentials: [] },
  ),
  'provider/credential/store/read': methodFixture(
    'provider/credential/store/read',
    {},
    {
      store: 'auth-json',
      portable: true,
      credentialCount: 1,
      migrationRequired: false,
    },
  ),
  'provider/credential/store/update': methodFixture(
    'provider/credential/store/update',
    {
      store: 'encrypted',
      operationId: 'operation:credential-store',
    },
    {
      store: 'encrypted',
      portable: false,
      credentialCount: 1,
      migrationRequired: false,
      migratedCredentials: 1,
    },
  ),
  'provider/apiKey/create': methodFixture(
    'provider/apiKey/create',
    {
      providerId,
      label: 'Fixture API Key',
      key: 'fixture-secret',
      operationId: 'operation:api-key-create',
    },
    { credential: providerCredentialSummary },
  ),
  'provider/apiKey/update': methodFixture(
    'provider/apiKey/update',
    {
      credentialId,
      label: 'Updated API Key',
      key: 'updated-secret',
      operationId: 'operation:api-key-update',
    },
    { credential: { ...providerCredentialSummary, label: 'Updated API Key' } },
  ),
  'provider/apiKey/reorder': methodFixture(
    'provider/apiKey/reorder',
    {
      providerId,
      orderedCredentialIds: [credentialId],
      operationId: 'operation:api-key-reorder',
    },
    { credentials: [providerCredentialSummary] },
  ),
  'provider/apiKey/test': methodFixture(
    'provider/apiKey/test',
    { credentialId },
    { credential: providerCredentialSummary, ok: true, message: 'API Key 可用。' },
  ),
  'auth/session/start': methodFixture(
    'auth/session/start',
    {
      target: { kind: 'provider', providerId },
      operationId: 'operation:auth-start',
    },
    { session: authSession },
  ),
  'auth/session/respond': methodFixture(
    'auth/session/respond',
    {
      sessionId: authSession.id,
      promptId: authSession.prompt.id,
      value: 'fixture-code',
      operationId: 'operation:auth-respond',
    },
    { session: authSession },
  ),
  'auth/session/status': methodFixture(
    'auth/session/status',
    {
      sessionId: authSession.id,
    },
    { session: authSession },
  ),
  'auth/session/cancel': methodFixture(
    'auth/session/cancel',
    {
      sessionId: authSession.id,
      operationId: 'operation:auth-cancel',
    },
    { session: { ...authSession, status: 'cancelled', prompt: undefined } },
  ),
  'github/auth/status': methodFixture('github/auth/status', {}, githubAuth),
  'github/auth/start': methodFixture(
    'github/auth/start',
    {
      mode: 'device',
    },
    githubLogin,
  ),
  'github/auth/poll': methodFixture('github/auth/poll', { loginId: 'github-login:1' }, githubLogin),
  'github/auth/logout': methodFixture(
    'github/auth/logout',
    {},
    {
      configured: true,
      authenticated: false,
      user: null,
    },
  ),
  'github/profile': methodFixture('github/profile', {}, { user: githubUser }),
  'github/profileOverview': methodFixture(
    'github/profileOverview',
    {},
    {
      overview: githubProfileOverview,
    },
  ),
  'github/repositories': methodFixture(
    'github/repositories',
    {},
    {
      repositories: [githubRepository],
    },
  ),
  'github/repository/clone': methodFixture(
    'github/repository/clone',
    {
      repositoryId: githubRepository.id,
      targetParent: 'F:\\Code',
    },
    { project },
  ),
  'github/pullRequest/read': methodFixture(
    'github/pullRequest/read',
    {
      owner: 'octocat',
      repository: 'fixture',
      number: 7,
    },
    { pullRequest: githubPullRequest },
  ),
  'github/pullRequest/create': methodFixture(
    'github/pullRequest/create',
    {
      owner: 'octocat',
      repository: 'fixture',
      title: 'Fixture pull request',
      head: 'feature',
      base: 'main',
      body: 'Fixture body',
      draft: false,
    },
    { pullRequest: githubPullRequest },
  ),
  'github/pullRequest/createForProject': methodFixture(
    'github/pullRequest/createForProject',
    {
      projectId: project.id,
      title: 'Fixture pull request',
      body: 'Fixture body',
      draft: false,
    },
    { pullRequest: githubPullRequest },
  ),
  'github/pullRequest/comment': methodFixture(
    'github/pullRequest/comment',
    {
      owner: 'octocat',
      repository: 'fixture',
      number: 7,
      body: 'Please fix this.',
      path: 'src/index.ts',
      side: 'RIGHT',
      line: 1,
      expectedHeadRevision: 'head-sha',
      commitId: 'head-sha',
    },
    {
      comment: {
        id: 1,
        nodeId: 'comment-node:1',
        htmlUrl: 'https://github.com/octocat/fixture/pull/7#discussion_r1',
        body: 'Please fix this.',
      },
    },
  ),
  'github/pullRequest/resolveThread': methodFixture(
    'github/pullRequest/resolveThread',
    {
      threadId: 'review-thread:1',
      resolved: true,
    },
    { thread: { id: 'review-thread:1', resolved: true } },
  ),
  'github/pullRequest/submitReview': methodFixture(
    'github/pullRequest/submitReview',
    {
      owner: 'octocat',
      repository: 'fixture',
      number: 7,
      event: 'APPROVE',
      expectedHeadRevision: 'head-sha',
    },
    {
      review: {
        id: 1,
        state: 'APPROVED',
        htmlUrl: 'https://github.com/octocat/fixture/pull/7#pullrequestreview-1',
      },
    },
  ),
  'github/push': methodFixture(
    'github/push',
    {
      projectId: project.id,
      remote: 'origin',
      branch: 'feature',
    },
    {
      remote: 'origin',
      branch: 'feature',
      repositoryUrl: 'https://github.com/octocat/fixture',
      status: {
        branchName: 'feature',
        upstream: 'origin/feature',
        ahead: 0,
        behind: 0,
        clean: true,
        files: [],
      },
    },
  ),
  'github/thread/pullRequests': methodFixture(
    'github/thread/pullRequests',
    { threadIds: [project.id] },
    {
      threads: [{ threadId: project.id, items: [githubThreadPullRequestSummary] }],
    },
  ),
  'github/thread/pullRequest/link': methodFixture(
    'github/thread/pullRequest/link',
    { threadId: project.id, url: githubPullRequest.htmlUrl },
    {
      thread: { threadId: project.id, items: [githubThreadPullRequestSummary] },
    },
  ),
  'github/thread/pullRequest/unlink': methodFixture(
    'github/thread/pullRequest/unlink',
    { threadId: project.id, owner: 'octocat', repository: 'fixture', number: 7 },
    { thread: { threadId: project.id, items: [] } },
  ),
  'git/branch/create': methodFixture(
    'git/branch/create',
    {
      projectId: project.id,
      branchName: 'feature/review',
      startPoint: 'main',
    },
    {
      project,
      status: {
        branchName: 'feature/review',
        upstream: null,
        ahead: 0,
        behind: 0,
        clean: true,
        files: [],
      },
    },
  ),
  'git/branch/checkout': methodFixture(
    'git/branch/checkout',
    {
      projectId: project.id,
      branchName: 'main',
    },
    {
      project,
      status: {
        branchName: 'main',
        upstream: 'origin/main',
        ahead: 0,
        behind: 0,
        clean: true,
        files: [],
      },
    },
  ),
  'review/summary': methodFixture(
    'review/summary',
    {
      projectId: project.id,
      source: { kind: 'unstaged' },
    },
    {
      snapshot: {
        projectId: project.id,
        generation: 'generation:1',
        source: { kind: 'unstaged' },
        repositoryRoot: 'F:\\fixture',
        headSha: '0123456789012345678901234567890123456789',
        baseSha: null,
        files: [],
        totals: { files: 0, additions: 0, deletions: 0, changedLines: 0, changedBytes: 0 },
        largeDiffMode: false,
      },
      cacheState: 'stale',
    },
  ),
  'review/fileDiff': methodFixture(
    'review/fileDiff',
    {
      projectId: project.id,
      source: { kind: 'unstaged' },
      generation: 'generation:1',
      path: 'src/index.ts',
      hideWhitespace: false,
    },
    {
      file: {
        path: 'src/index.ts',
        previousPath: null,
        status: 'modified',
        additions: 1,
        deletions: 1,
        changedLines: 2,
        changedBytes: 32,
        binary: false,
        revision: 'revision:1',
      },
      revision: 'revision:1',
      patch: '@@ -1 +1 @@\n-old\n+new',
      hunks: [
        {
          id: 'hunk:1',
          header: '@@ -1 +1 @@',
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          patch: '@@ -1 +1 @@\n-old\n+new',
        },
      ],
      renderable: true,
      tooLargeReason: null,
    },
  ),
  'review/file-diffs': methodFixture(
    'review/file-diffs',
    {
      projectId: project.id,
      source: { kind: 'unstaged' },
      generation: 'generation:1',
      paths: ['src/index.ts'],
      hideWhitespace: false,
    },
    {
      type: 'success',
      generation: 'generation:1',
      files: [
        {
          file: {
            path: 'src/index.ts',
            previousPath: null,
            status: 'modified',
            additions: 1,
            deletions: 1,
            changedLines: 2,
            changedBytes: 32,
            binary: false,
            revision: 'revision:1',
          },
          revision: 'revision:1',
          patch: '@@ -1 +1 @@\n-old\n+new',
          hunks: [
            {
              id: 'hunk:1',
              header: '@@ -1 +1 @@',
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              patch: '@@ -1 +1 @@\n-old\n+new',
            },
          ],
          renderable: true,
          tooLargeReason: null,
        },
      ],
      changedBytes: 23,
    },
  ),
  'review/refresh': methodFixture(
    'review/refresh',
    {
      projectId: project.id,
      source: { kind: 'staged' },
    },
    {
      snapshot: {
        projectId: project.id,
        generation: 'generation:2',
        source: { kind: 'staged' },
        repositoryRoot: 'F:\\fixture',
        headSha: null,
        baseSha: null,
        files: [],
        totals: { files: 0, additions: 0, deletions: 0, changedLines: 0, changedBytes: 0 },
        largeDiffMode: false,
      },
      cacheState: 'fresh',
    },
  ),
  'review/pullRequest/prepare': methodFixture(
    'review/pullRequest/prepare',
    {
      projectId: project.id,
      owner: 'octocat',
      repository: 'fixture',
      number: 7,
    },
    {
      baseSha: 'base-sha',
      headSha: 'head-sha',
    },
  ),
  'review/apply': methodFixture(
    'review/apply',
    {
      projectId: project.id,
      source: { kind: 'unstaged' },
      generation: 'generation:1',
      expectedRevision: 'revision:1',
      action: 'stage',
      target: { kind: 'file', path: 'src/index.ts' },
      atomic: true,
    },
    {
      ok: true,
      action: 'stage',
      path: 'src/index.ts',
      generation: 'generation:2',
    },
  ),
  'review/applyBatch': methodFixture(
    'review/applyBatch',
    {
      projectId: project.id,
      source: { kind: 'unstaged' },
      generation: 'generation:1',
      action: 'stage',
      items: [
        { path: 'src/index.ts', expectedRevision: 'revision:1' },
        { path: 'src/other.ts', expectedRevision: 'revision:2' },
      ],
    },
    {
      ok: true,
      action: 'stage',
      paths: ['src/index.ts', 'src/other.ts'],
      generation: 'generation:2',
      appliedCount: 2,
    },
  ),
  'review/branches': methodFixture(
    'review/branches',
    { projectId: project.id },
    {
      current: 'main',
      branches: [
        {
          name: 'main',
          sha: '0123456789012345678901234567890123456789',
          current: true,
          remote: false,
        },
      ],
    },
  ),
  'review/commits': methodFixture(
    'review/commits',
    { projectId: project.id, limit: 50 },
    {
      commits: [
        {
          sha: '0123456789012345678901234567890123456789',
          shortSha: '0123456',
          subject: 'Fixture commit',
          author: 'Fixture author',
          authoredAt: 1,
        },
      ],
    },
  ),
  'review/status': methodFixture(
    'review/status',
    { projectId: project.id },
    {
      status: {
        branchName: 'main',
        upstream: 'origin/main',
        ahead: 1,
        behind: 0,
        clean: false,
        files: [
          {
            path: 'src/index.ts',
            previousPath: null,
            stagedStatus: 'M',
            unstagedStatus: ' ',
            untracked: false,
          },
        ],
      },
    },
  ),
  'review/commit': methodFixture(
    'review/commit',
    {
      projectId: project.id,
      message: 'Update fixture',
      paths: ['src/index.ts'],
    },
    {
      ok: true,
      headSha: '0123456789012345678901234567890123456789',
      output: '[main 0123456] Update fixture',
      status: {
        branchName: 'main',
        upstream: 'origin/main',
        ahead: 1,
        behind: 0,
        clean: true,
        files: [],
      },
    },
  ),
  'review/comment/list': methodFixture(
    'review/comment/list',
    {
      threadId: threadListItem.id,
      projectId: project.id,
      sourceKey: 'unstaged',
    },
    { comments: [] },
  ),
  'review/comment/save': methodFixture(
    'review/comment/save',
    {
      threadId: threadListItem.id,
      projectId: project.id,
      sourceKey: 'unstaged',
      path: 'src/index.ts',
      side: 'new',
      line: 1,
      hunkId: null,
      revision: 'revision:1',
      body: 'Please verify this change.',
    },
    {
      comment: {
        id: 'comment:1',
        threadId: threadListItem.id,
        projectId: project.id,
        sourceKey: 'unstaged',
        path: 'src/index.ts',
        side: 'new',
        line: 1,
        hunkId: null,
        revision: 'revision:1',
        body: 'Please verify this change.',
        status: 'open',
        githubCommentId: null,
        githubThreadId: null,
        createdAt: 1,
        updatedAt: 1,
      },
    },
  ),
  'review/comment/resolve': methodFixture(
    'review/comment/resolve',
    {
      id: 'comment:1',
      threadId: threadListItem.id,
      projectId: project.id,
    },
    {
      comment: {
        id: 'comment:1',
        threadId: threadListItem.id,
        projectId: project.id,
        sourceKey: 'unstaged',
        path: 'src/index.ts',
        side: 'new',
        line: 1,
        hunkId: null,
        revision: 'revision:1',
        body: 'Please verify this change.',
        status: 'resolved',
        githubCommentId: null,
        githubThreadId: null,
        createdAt: 1,
        updatedAt: 2,
      },
    },
  ),
  'review/comment/delete': methodFixture(
    'review/comment/delete',
    {
      id: 'comment:1',
      threadId: threadListItem.id,
      projectId: project.id,
    },
    { ok: true },
  ),
  'review/ai/start': methodFixture(
    'review/ai/start',
    {
      threadId: threadListItem.id,
      target: { type: 'uncommittedChanges' },
      delivery: 'inline',
    },
    {
      threadId: threadListItem.id,
      turnId: 'turn:review:1',
      delivery: 'inline',
      source: { kind: 'unstaged' },
    },
  ),
  'pet/list': methodFixture(
    'pet/list',
    {},
    {
      pets: [],
    },
  ),
  'pet/catalog/list': methodFixture(
    'pet/catalog/list',
    {
      refresh: false,
    },
    {
      pets: [
        {
          slug: 'sample-pet',
          displayName: '示例宠物',
          englishName: 'Sample Pet',
          description: 'A sample community pet.',
          author: 'Pidex',
          category: 'original-characters',
          categoryLabel: '原创角色',
          spriteVersionNumber: 2,
          license: 'MIT',
          licenseKind: 'permissive',
          previewUrl: '/api/pets/catalog/sample-pet/preview',
          installed: false,
        },
      ],
      fetchedAt: '2026-07-24T00:00:00.000Z',
      cacheState: 'fresh',
    },
  ),
  'pet/catalog/install': methodFixture(
    'pet/catalog/install',
    {
      slug: 'sample-pet',
      acceptedRestrictedLicense: false,
      operationId: 'operation:pet-catalog-install:1',
    },
    {
      pet: {
        id: 'sample-pet',
        displayName: 'Sample Pet',
        spriteVersionNumber: 2,
        spritesheetPath: 'spritesheet.webp',
        spritesheetUrl: '/api/pets/sample-pet/spritesheet',
        installed: true,
      },
    },
  ),
  'pet/install/preview': methodFixture(
    'pet/install/preview',
    {
      url: 'https://example.com/pet.json',
    },
    {
      pet: {
        id: 'sample-pet',
        displayName: 'Sample Pet',
        spriteVersionNumber: 2,
        spritesheetPath: 'spritesheet.webp',
        spritesheetUrl: '/api/pets/sample-pet/spritesheet',
        installed: false,
      },
      sourceUrl: 'https://example.com/pet.json',
      sizeBytes: 1024,
    },
  ),
  'pet/install': methodFixture(
    'pet/install',
    {
      url: 'https://example.com/pet.json',
      operationId: 'operation:pet-install:1',
    },
    {
      pet: {
        id: 'sample-pet',
        displayName: 'Sample Pet',
        spriteVersionNumber: 2,
        spritesheetPath: 'spritesheet.webp',
        spritesheetUrl: '/api/pets/sample-pet/spritesheet',
        installed: true,
      },
    },
  ),
  'pet/remove': methodFixture(
    'pet/remove',
    {
      id: 'sample-pet',
      operationId: 'operation:pet-remove:1',
    },
    {
      id: 'sample-pet',
      removed: true,
    },
  ),
  'release-notes/list': methodFixture(
    'release-notes/list',
    {
      currentVersion: '0.2.0-beta.1',
      refresh: true,
    },
    {
      source: 'github-releases',
      repository: 'codepilotx-dev/Pidex',
      currentVersion: '0.2.0-beta.1',
      currentReleaseFound: true,
      fetchedAt: '2026-07-27T00:00:00.000Z',
      truncated: false,
      releases: [
        {
          tagName: 'v0.2.0-beta.1',
          name: 'Pidex 0.2.0 Beta 1',
          body: '## Added\n\n- 新特性',
          htmlUrl: 'https://github.com/codepilotx-dev/Pidex/releases/tag/v0.2.0-beta.1',
          publishedAt: '2026-07-27T00:00:00.000Z',
          prerelease: true,
        },
      ],
    },
  ),
  'usage/local/get': methodFixture(
    'usage/local/get',
    {
      range: '30d',
      timeZone: 'Asia/Shanghai',
    },
    {
      range: '30d',
      timeZone: 'Asia/Shanghai',
      generatedAt: 1,
      totals: {
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 25,
        totalTokens: 175,
        estimatedCostUsd: '0.0125',
        rootTasks: 1,
        modelResponses: 2,
        providerCalls: 3,
        activeDays: 1,
        currentStreak: 1,
        longestStreak: 1,
      },
      daily: [
        {
          date: '2026-07-26',
          totals: {
            inputTokens: 100,
            outputTokens: 50,
            cachedTokens: 25,
            totalTokens: 175,
            estimatedCostUsd: '0.0125',
          },
          models: [
            {
              providerId,
              modelId,
              displayName: 'Fixture model',
              inputTokens: 100,
              outputTokens: 50,
              cachedTokens: 25,
              totalTokens: 175,
              estimatedCostUsd: '0.0125',
              modelResponses: 2,
            },
          ],
        },
      ],
      models: [
        {
          providerId,
          modelId,
          displayName: 'Fixture model',
          inputTokens: 100,
          outputTokens: 50,
          cachedTokens: 25,
          totalTokens: 175,
          estimatedCostUsd: '0.0125',
          modelResponses: 2,
          sharePercent: 100,
        },
      ],
      heatmap: [
        {
          date: '2026-07-26',
          totalTokens: 175,
          modelResponses: 2,
        },
      ],
    },
  ),
  'local-environment/read': methodFixture(
    'local-environment/read',
    {
      threadId: 'thread:1',
    },
    {
      exists: true,
      filePath: 'F:\\fixture\\.pidex\\environments\\environment.jsonc',
      gitRoot: 'F:\\fixture',
      revision: 'a'.repeat(64),
      configHash: 'a'.repeat(64),
      config: { schema_version: 1, name: 'fixture', actions: [] },
      executionTrusted: false,
    },
  ),
  'local-environment/update': methodFixture(
    'local-environment/update',
    {
      threadId: 'thread:1',
      expectedRevision: 'a'.repeat(64),
      edits: [{ keyPath: ['name'], value: 'Fixture' }],
    },
    {
      filePath: 'F:\\fixture\\.pidex\\environments\\environment.jsonc',
      revision: 'b'.repeat(64),
      configHash: 'b'.repeat(64),
      executionTrusted: false,
    },
  ),
  'local-environment/action/list': methodFixture(
    'local-environment/action/list',
    {
      threadId: 'thread:1',
    },
    {
      revision: 'a'.repeat(64),
      actions: [{ name: 'Dev', icon: 'play', availability: 'available' }],
    },
  ),
  'worktree/eligibility': methodFixture(
    'worktree/eligibility',
    {
      projectId: 'project:1',
    },
    {
      isGitRepository: true,
      availableModes: ['local', 'worktree'],
      defaultMode: 'worktree',
    },
  ),
  'worktree/create': methodFixture(
    'worktree/create',
    {
      projectId: 'project:1',
      startingState: { type: 'branch', branchName: 'feature/fixture' },
      operationId: 'operation:worktree-create',
    },
    {
      worktree: {
        id: 'worktree:1',
        projectId: 'project:1',
        status: 'ready',
        branchName: 'feature/fixture',
        baseCommit: 'abc123',
        headCommit: 'abc123',
        permanent: false,
        pinned: false,
        setupStatus: 'succeeded',
        continuedWithoutSetup: false,
        createdAt: 1,
        updatedAt: 1,
        lastUsedAt: 1,
        deletedAt: null,
      },
      operation: {
        operationId: 'operation:worktree-create',
        worktreeId: 'worktree:1',
        projectId: 'project:1',
        kind: 'create',
        step: 'complete',
        status: 'completed',
        revision: 2,
        errorCode: null,
        warnings: [],
        createdAt: 1,
        updatedAt: 2,
        completedAt: 2,
      },
    },
  ),
  'worktree/list': methodFixture('worktree/list', { projectId: 'project:1' }, { worktrees: [] }),
  'worktree/read': methodFixture(
    'worktree/read',
    { worktreeId: 'worktree:1' },
    {
      id: 'worktree:1',
      projectId: 'project:1',
      status: 'ready',
      branchName: 'feature/fixture',
      baseCommit: 'abc123',
      headCommit: 'abc123',
      permanent: false,
      pinned: false,
      setupStatus: 'succeeded',
      continuedWithoutSetup: false,
      createdAt: 1,
      updatedAt: 1,
      lastUsedAt: 1,
      deletedAt: null,
    },
  ),
  'worktree/retry-setup': methodFixture(
    'worktree/retry-setup',
    {
      worktreeId: 'worktree:1',
      operationId: 'operation:worktree-retry',
    },
    {
      worktree: {
        id: 'worktree:1',
        projectId: 'project:1',
        status: 'ready',
        branchName: 'feature/fixture',
        baseCommit: 'abc123',
        headCommit: 'abc123',
        permanent: false,
        pinned: false,
        setupStatus: 'succeeded',
        continuedWithoutSetup: false,
        createdAt: 1,
        updatedAt: 2,
        lastUsedAt: 2,
        deletedAt: null,
      },
      operation: {
        operationId: 'operation:worktree-retry',
        worktreeId: 'worktree:1',
        projectId: 'project:1',
        kind: 'retry-setup',
        step: 'complete',
        status: 'completed',
        revision: 2,
        errorCode: null,
        warnings: [],
        createdAt: 1,
        updatedAt: 2,
        completedAt: 2,
      },
    },
  ),
  'worktree/continue-without-setup': methodFixture(
    'worktree/continue-without-setup',
    {
      worktreeId: 'worktree:1',
      operationId: 'operation:worktree-continue',
    },
    {
      worktree: {
        id: 'worktree:1',
        projectId: 'project:1',
        status: 'ready',
        branchName: 'feature/fixture',
        baseCommit: 'abc123',
        headCommit: 'abc123',
        permanent: false,
        pinned: false,
        setupStatus: 'skipped',
        continuedWithoutSetup: true,
        createdAt: 1,
        updatedAt: 2,
        lastUsedAt: 2,
        deletedAt: null,
      },
      operation: {
        operationId: 'operation:worktree-continue',
        worktreeId: 'worktree:1',
        projectId: 'project:1',
        kind: 'continue-without-setup',
        step: 'complete',
        status: 'completed',
        revision: 2,
        errorCode: null,
        warnings: [],
        createdAt: 1,
        updatedAt: 2,
        completedAt: 2,
      },
    },
  ),
  'worktree/set-permanent': methodFixture(
    'worktree/set-permanent',
    {
      worktreeId: 'worktree:1',
      permanent: true,
      operationId: 'operation:worktree-permanent',
    },
    {
      worktree: {
        id: 'worktree:1',
        projectId: 'project:1',
        status: 'ready',
        branchName: 'feature/fixture',
        baseCommit: 'abc123',
        headCommit: 'abc123',
        permanent: true,
        pinned: false,
        setupStatus: 'succeeded',
        continuedWithoutSetup: false,
        createdAt: 1,
        updatedAt: 2,
        lastUsedAt: 2,
        deletedAt: null,
      },
      operation: {
        operationId: 'operation:worktree-permanent',
        worktreeId: 'worktree:1',
        projectId: 'project:1',
        kind: 'set-permanent',
        step: 'complete',
        status: 'completed',
        revision: 2,
        errorCode: null,
        warnings: [],
        createdAt: 1,
        updatedAt: 2,
        completedAt: 2,
      },
    },
  ),
  'worktree/delete': methodFixture(
    'worktree/delete',
    {
      worktreeId: 'worktree:1',
      operationId: 'operation:worktree-delete',
    },
    {
      worktree: {
        id: 'worktree:1',
        projectId: 'project:1',
        status: 'cleaned',
        branchName: 'feature/fixture',
        baseCommit: 'abc123',
        headCommit: 'abc123',
        permanent: false,
        pinned: false,
        setupStatus: 'succeeded',
        continuedWithoutSetup: false,
        createdAt: 1,
        updatedAt: 2,
        lastUsedAt: 1,
        deletedAt: 2,
      },
      operation: {
        operationId: 'operation:worktree-delete',
        worktreeId: 'worktree:1',
        projectId: 'project:1',
        kind: 'delete',
        step: 'complete',
        status: 'completed',
        revision: 2,
        errorCode: null,
        warnings: [],
        createdAt: 1,
        updatedAt: 2,
        completedAt: 2,
      },
    },
  ),
  'worktree/restore': methodFixture(
    'worktree/restore',
    {
      worktreeId: 'worktree:1',
      operationId: 'operation:worktree-restore',
    },
    {
      worktree: {
        id: 'worktree:1',
        projectId: 'project:1',
        status: 'ready',
        branchName: 'feature/fixture',
        baseCommit: 'abc123',
        headCommit: 'abc123',
        permanent: false,
        pinned: false,
        setupStatus: 'succeeded',
        continuedWithoutSetup: false,
        createdAt: 1,
        updatedAt: 3,
        lastUsedAt: 3,
        deletedAt: null,
      },
      operation: {
        operationId: 'operation:worktree-restore',
        worktreeId: 'worktree:1',
        projectId: 'project:1',
        kind: 'restore',
        step: 'complete',
        status: 'completed',
        revision: 2,
        errorCode: null,
        warnings: [],
        createdAt: 2,
        updatedAt: 3,
        completedAt: 3,
      },
    },
  ),
  'worktree/operation/status': methodFixture(
    'worktree/operation/status',
    {
      operationId: 'operation:worktree-create',
      afterOutputCursor: 0,
    },
    {
      operation: {
        operationId: 'operation:worktree-create',
        worktreeId: 'worktree:1',
        projectId: 'project:1',
        kind: 'create',
        step: 'complete',
        status: 'completed',
        revision: 2,
        errorCode: null,
        warnings: [],
        createdAt: 1,
        updatedAt: 2,
        completedAt: 2,
      },
      output: { cursor: 1, data: 'setup complete\r\n', truncated: false, complete: true },
    },
  ),
  'thread/handoff/start': methodFixture(
    'thread/handoff/start',
    {
      operationId: 'operation:handoff',
      sourceThreadId: 'thread:1',
      destination: { kind: 'worktree', worktreeId: 'worktree:1' },
    },
    {
      operation: {
        operationId: 'operation:handoff',
        sourceThreadId: 'thread:1',
        targetThreadId: 'thread:2',
        direction: 'local-to-worktree',
        status: 'await-client-transfer',
        step: 'await-client-transfer',
        revision: 10,
        errorCode: null,
        warnings: [],
        createdAt: 1,
        updatedAt: 2,
        completedAt: null,
      },
    },
  ),
  'thread/handoff/status': methodFixture(
    'thread/handoff/status',
    {
      operationId: 'operation:handoff',
      afterRevision: 9,
      waitMs: 100,
    },
    {
      operation: {
        operationId: 'operation:handoff',
        sourceThreadId: 'thread:1',
        targetThreadId: 'thread:2',
        direction: 'local-to-worktree',
        status: 'await-client-transfer',
        step: 'await-client-transfer',
        revision: 10,
        errorCode: null,
        warnings: [],
        createdAt: 1,
        updatedAt: 2,
        completedAt: null,
      },
      changed: true,
    },
  ),
  'thread/handoff/pending': methodFixture(
    'thread/handoff/pending',
    {
      sourceThreadId: 'thread:1',
    },
    {
      operation: {
        operationId: 'operation:handoff',
        sourceThreadId: 'thread:1',
        targetThreadId: 'thread:2',
        direction: 'local-to-worktree',
        status: 'await-client-transfer',
        step: 'await-client-transfer',
        revision: 10,
        errorCode: null,
        warnings: [],
        createdAt: 1,
        updatedAt: 2,
        completedAt: null,
      },
    },
  ),
  'thread/handoff/ack-client-transfer': methodFixture(
    'thread/handoff/ack-client-transfer',
    {
      operationId: 'operation:handoff',
      revision: 10,
    },
    {
      operation: {
        operationId: 'operation:handoff',
        sourceThreadId: 'thread:1',
        targetThreadId: 'thread:2',
        direction: 'local-to-worktree',
        status: 'completed',
        step: 'complete',
        revision: 12,
        errorCode: null,
        warnings: [],
        createdAt: 1,
        updatedAt: 3,
        completedAt: 3,
      },
    },
  ),
  'thread/fork/start': methodFixture(
    'thread/fork/start',
    {
      operationId: 'operation:fork',
      sourceThreadId: 'thread:1',
      lastTurnId: 'turn:1',
      sourceItemId: 'item:result',
      destination: { kind: 'new-worktree' },
    },
    {
      operation: {
        operationId: 'operation:fork',
        sourceThreadId: 'thread:1',
        sourceTurnId: 'turn:1',
        sourceItemId: 'item:result',
        targetThreadId: null,
        targetWorktreeId: 'worktree:2',
        destinationKind: 'new-worktree',
        snapshotMode: 'working-tree',
        status: 'running',
        step: 'setup',
        revision: 2,
        errorCode: null,
        warnings: [],
        createdAt: 1,
        updatedAt: 2,
        completedAt: null,
      },
    },
  ),
  'thread/fork/status': methodFixture(
    'thread/fork/status',
    {
      operationId: 'operation:fork',
      afterRevision: 1,
      afterOutputCursor: 0,
      waitMs: 100,
    },
    {
      operation: {
        operationId: 'operation:fork',
        sourceThreadId: 'thread:1',
        sourceTurnId: 'turn:1',
        sourceItemId: 'item:result',
        targetThreadId: null,
        targetWorktreeId: 'worktree:2',
        destinationKind: 'new-worktree',
        snapshotMode: 'working-tree',
        status: 'running',
        step: 'setup',
        revision: 2,
        errorCode: null,
        warnings: [],
        createdAt: 1,
        updatedAt: 2,
        completedAt: null,
      },
      changed: true,
      output: { cursor: 1, data: 'setup running\r\n', truncated: false, complete: false },
    },
  ),
  'thread/fork/pending': methodFixture(
    'thread/fork/pending',
    {
      sourceThreadId: 'thread:1',
      lastTurnId: 'turn:1',
      sourceItemId: 'item:result',
    },
    {
      operation: null,
    },
  ),
  'thread/fork/retry-setup': methodFixture(
    'thread/fork/retry-setup',
    {
      operationId: 'operation:fork',
      revision: 2,
    },
    {
      operation: {
        operationId: 'operation:fork',
        sourceThreadId: 'thread:1',
        sourceTurnId: 'turn:1',
        sourceItemId: 'item:result',
        targetThreadId: null,
        targetWorktreeId: 'worktree:2',
        destinationKind: 'new-worktree',
        snapshotMode: 'working-tree',
        status: 'running',
        step: 'setup',
        revision: 3,
        errorCode: null,
        warnings: [],
        createdAt: 1,
        updatedAt: 3,
        completedAt: null,
      },
    },
  ),
  'thread/fork/continue-without-setup': methodFixture(
    'thread/fork/continue-without-setup',
    {
      operationId: 'operation:fork',
      revision: 2,
    },
    {
      operation: {
        operationId: 'operation:fork',
        sourceThreadId: 'thread:1',
        sourceTurnId: 'turn:1',
        sourceItemId: 'item:result',
        targetThreadId: 'thread:2',
        targetWorktreeId: 'worktree:2',
        destinationKind: 'new-worktree',
        snapshotMode: 'working-tree',
        status: 'completed',
        step: 'complete',
        revision: 4,
        errorCode: null,
        warnings: ['setup-skipped'],
        createdAt: 1,
        updatedAt: 4,
        completedAt: 4,
      },
    },
  ),
  'thread/fork/abandon': methodFixture(
    'thread/fork/abandon',
    {
      operationId: 'operation:fork',
      revision: 2,
    },
    {
      operation: {
        operationId: 'operation:fork',
        sourceThreadId: 'thread:1',
        sourceTurnId: 'turn:1',
        sourceItemId: 'item:result',
        targetThreadId: null,
        targetWorktreeId: null,
        destinationKind: 'new-worktree',
        snapshotMode: 'working-tree',
        status: 'abandoned',
        step: 'complete',
        revision: 4,
        errorCode: null,
        warnings: [],
        createdAt: 1,
        updatedAt: 4,
        completedAt: 4,
      },
    },
  ),
  'terminal/host/context': methodFixture(
    'terminal/host/context',
    {
      threadId: 'thread:1',
    },
    {
      threadId: 'thread:1',
      bindingId: 'terminal-binding:fixture',
      contextVersion: 'context:1',
      workspaceKind: 'project',
      target: { kind: 'local', cwd: 'F:\\fixture' },
    },
  ),
  'terminal/host/output/reset': methodFixture(
    'terminal/host/output/reset',
    {
      threadId: 'thread:1',
      terminalId: 'terminal:1',
      instanceId: 'instance:1',
      oldestSequence: 0,
      nextSequence: 1,
      chunks: [
        {
          terminalId: 'terminal:1',
          instanceId: 'instance:1',
          sequence: 0,
          data: 'ready\r\n',
        },
      ],
      state: 'running',
      exitCode: null,
    },
    { ok: true },
  ),
  'terminal/host/output/append': methodFixture(
    'terminal/host/output/append',
    {
      threadId: 'thread:1',
      chunk: {
        terminalId: 'terminal:1',
        instanceId: 'instance:1',
        sequence: 1,
        data: 'done\r\n',
      },
    },
    { ok: true },
  ),
  'terminal/host/output/clear': methodFixture(
    'terminal/host/output/clear',
    {
      threadId: 'thread:1',
      terminalId: 'terminal:1',
      instanceId: 'instance:1',
    },
    { ok: true },
  ),
  'terminal/host/environment': methodFixture(
    'terminal/host/environment',
    {
      threadId: 'thread:1',
    },
    {
      revision: 1,
      set: { PATH: 'F:\\fixture\\bin' },
      unset: ['OLD_PATH'],
    },
  ),
  'terminal/host/action/resolve': methodFixture(
    'terminal/host/action/resolve',
    {
      threadId: 'thread:1',
      actionName: 'Dev',
    },
    {
      contextVersion: 'context:1',
      environmentRevision: 1,
      command: 'bun run dev',
    },
  ),
  'taskboard/context/read': methodFixture(
    'taskboard/context/read',
    {
      taskId: taskboardTask.id,
      sections: ['objective'],
      includeEvidence: true,
      includeUnverified: false,
      includeAncestors: true,
      limit: 20,
      offset: 0,
    },
    {
      snapshot: {
        taskId: taskboardTask.id,
        evidenceRevision: 0,
        contextRevision: 1,
        summarizedThroughEvidenceRevision: 0,
        pendingEvidenceCount: 0,
        digest: '目标：任务看板',
        frozen: false,
        frozenAt: null,
        promotedContextRevision: null,
      },
      entries: [],
      evidence: [],
    },
  ),
  'taskboard/context/update': methodFixture(
    'taskboard/context/update',
    {
      taskId: taskboardTask.id,
      expectedContextRevision: 1,
      changes: [{ op: 'add', section: 'objective', title: '目标', content: '实现任务上下文' }],
    },
    {
      snapshot: {
        taskId: taskboardTask.id,
        evidenceRevision: 0,
        contextRevision: 2,
        summarizedThroughEvidenceRevision: 0,
        pendingEvidenceCount: 0,
        digest: '目标：任务看板',
        frozen: false,
        frozenAt: null,
        promotedContextRevision: null,
      },
    },
  ),
  'taskboard/context/ai-preview': methodFixture(
    'taskboard/context/ai-preview',
    { taskId: taskboardTask.id },
    {
      proposal: {
        id: 'proposal:1',
        taskId: taskboardTask.id,
        baseContextRevision: 1,
        throughEvidenceRevision: 0,
        changes: [],
        status: 'draft',
        modelRef: 'provider/model',
        createdAt: 1,
        updatedAt: 1,
      },
    },
  ),
  'taskboard/context/ai-apply': methodFixture(
    'taskboard/context/ai-apply',
    { proposalId: 'proposal:1' },
    {
      proposal: {
        id: 'proposal:1',
        taskId: taskboardTask.id,
        baseContextRevision: 1,
        throughEvidenceRevision: 0,
        changes: [],
        status: 'applied',
        modelRef: 'provider/model',
        createdAt: 1,
        updatedAt: 2,
      },
      snapshot: {
        taskId: taskboardTask.id,
        evidenceRevision: 0,
        contextRevision: 2,
        summarizedThroughEvidenceRevision: 0,
        pendingEvidenceCount: 0,
        digest: '目标：任务看板',
        frozen: false,
        frozenAt: null,
        promotedContextRevision: null,
      },
    },
  ),
  'taskboard/context/ai-discard': methodFixture(
    'taskboard/context/ai-discard',
    { proposalId: 'proposal:1' },
    {
      proposal: {
        id: 'proposal:1',
        taskId: taskboardTask.id,
        baseContextRevision: 1,
        throughEvidenceRevision: 0,
        changes: [],
        status: 'discarded',
        modelRef: null,
        createdAt: 1,
        updatedAt: 2,
      },
    },
  ),
  'taskboard/context/promotion-status': methodFixture(
    'taskboard/context/promotion-status',
    { taskId: taskboardTask.id },
    { promotion: null },
  ),
  'taskboard/planning/roots': methodFixture(
    'taskboard/planning/roots',
    {
      projectId: project.id,
      statuses: ['blocked'],
      archived: false,
      limit: 100,
    },
    {
      roots: [
        { task: { ...taskboardWorkflowTask, threads: [] }, aggregate: taskboardPlanAggregate },
      ],
      unreadCount: 1,
      nextCursor: null,
    },
  ),
  'taskboard/planning/read': methodFixture(
    'taskboard/planning/read',
    {
      taskId: taskboardTask.id,
    },
    { snapshot: taskboardPlanningSnapshot },
  ),
  'taskboard/planning/apply': methodFixture(
    'taskboard/planning/apply',
    {
      parentTaskId: taskboardTask.id,
      expectedVersion: 2,
      operationId: 'operation:plan-apply',
      items: [
        { clientId: 'scan', kind: 'step', title: '扫描代码库', description: '查找可复用实现' },
      ],
      dependencies: [],
    },
    { snapshot: taskboardPlanningSnapshot },
  ),
  'taskboard/planning/step/update': methodFixture(
    'taskboard/planning/step/update',
    {
      operationId: 'operation:step-update',
      itemId: taskboardPlanItem.id,
      expectedVersion: 1,
      patch: { status: 'done' },
    },
    { snapshot: taskboardPlanningSnapshot },
  ),
  'taskboard/planning/step/promote': methodFixture(
    'taskboard/planning/step/promote',
    {
      operationId: 'operation:step-promote',
      itemId: taskboardPlanItem.id,
      expectedVersion: 1,
      task: { status: 'todo', priority: 'high' },
    },
    { snapshot: taskboardPlanningSnapshot },
  ),
  'taskboard/planning/item/reorder': methodFixture(
    'taskboard/planning/item/reorder',
    {
      operationId: 'operation:item-reorder',
      itemId: taskboardPlanItem.id,
      expectedVersion: 1,
      beforeItemId: null,
      afterItemId: null,
    },
    { snapshot: taskboardPlanningSnapshot },
  ),
  'taskboard/planning/child/reparent': methodFixture(
    'taskboard/planning/child/reparent',
    {
      operationId: 'operation:child-reparent',
      childTaskId: 'taskboard-task:2',
      expectedVersion: 1,
      parentTaskId: taskboardTask.id,
    },
    { childTaskId: 'taskboard-task:2', parentTaskId: taskboardTask.id },
  ),
  'taskboard/planning/dependencies/set': methodFixture(
    'taskboard/planning/dependencies/set',
    {
      operationId: 'operation:dependencies-set',
      itemId: taskboardPlanItem.id,
      expectedVersion: 1,
      prerequisiteItemIds: [],
    },
    { snapshot: taskboardPlanningSnapshot },
  ),
  'taskboard/planning/blocker/create': methodFixture(
    'taskboard/planning/blocker/create',
    {
      operationId: 'operation:blocker-create',
      taskId: taskboardTask.id,
      planItemId: taskboardPlanItem.id,
      reason: taskboardBlocker.reason,
    },
    { blocker: taskboardBlocker },
  ),
  'taskboard/planning/blocker/resolve': methodFixture(
    'taskboard/planning/blocker/resolve',
    {
      operationId: 'operation:blocker-resolve',
      blockerId: taskboardBlocker.id,
      expectedVersion: 1,
      resolution: '用户已确认',
    },
    {
      blocker: {
        ...taskboardBlocker,
        status: 'resolved',
        resolution: '用户已确认',
        version: 2,
        resolvedAt: 4,
        updatedAt: 4,
      },
    },
  ),
  'taskboard/planning/attention/mark-read': methodFixture(
    'taskboard/planning/attention/mark-read',
    {
      operationId: 'operation:planning-mark-read',
      taskId: taskboardTask.id,
      itemId: taskboardPlanItem.id,
    },
    { snapshot: taskboardPlanningSnapshot },
  ),
  'taskboard/planning/archive-tree': methodFixture(
    'taskboard/planning/archive-tree',
    {
      operationId: 'operation:archive-tree',
      rootTaskId: taskboardTask.id,
      expectedVersion: 2,
      includeLinkedThreads: false,
    },
    { batchId: 'archive-batch:1', taskIds: [taskboardTask.id] },
  ),
  'taskboard/planning/restore-tree': methodFixture(
    'taskboard/planning/restore-tree',
    {
      operationId: 'operation:restore-tree',
      rootTaskId: taskboardTask.id,
    },
    { batchId: 'archive-batch:1', taskIds: [taskboardTask.id] },
  ),
  'taskboard/planning/delete-tree': methodFixture(
    'taskboard/planning/delete-tree',
    {
      operationId: 'operation:delete-tree',
      rootTaskId: taskboardTask.id,
    },
    { deletedTaskIds: [taskboardTask.id] },
  ),
  'taskboard/task/list': methodFixture(
    'taskboard/task/list',
    {
      projectId: project.id,
      statuses: ['in_progress'],
      priorities: ['high'],
      labelIds: [],
      query: '任务看板',
      archived: false,
      limit: 200,
    },
    {
      tasks: [{ ...taskboardTask, threads: [] }],
      nextCursor: null,
    },
  ),
  'taskboard/task/read': methodFixture(
    'taskboard/task/read',
    {
      taskId: taskboardTask.id,
    },
    { task: taskboardDetails },
  ),
  'taskboard/task/create': methodFixture(
    'taskboard/task/create',
    {
      projectId: project.id,
      title: taskboardTask.title,
      description: taskboardTask.description,
      status: 'backlog',
      priority: 'high',
      labelIds: [],
      operationId: 'operation:taskboard-create',
    },
    { task: taskboardDetails },
  ),
  'taskboard/task/update': methodFixture(
    'taskboard/task/update',
    {
      taskId: taskboardTask.id,
      patch: { title: taskboardTask.title, priority: 'high' },
      expectedVersion: 1,
      operationId: 'operation:taskboard-update',
    },
    { task: taskboardDetails },
  ),
  'taskboard/task/move': methodFixture(
    'taskboard/task/move',
    {
      taskId: taskboardTask.id,
      status: 'in_progress',
      beforeTaskId: null,
      afterTaskId: null,
      expectedVersion: 1,
      operationId: 'operation:taskboard-move',
    },
    { task: taskboardDetails },
  ),
  'taskboard/task/archive': methodFixture(
    'taskboard/task/archive',
    {
      taskId: taskboardTask.id,
      expectedVersion: 2,
      operationId: 'operation:taskboard-archive',
    },
    { task: taskboardDetails },
  ),
  'taskboard/task/restore': methodFixture(
    'taskboard/task/restore',
    {
      taskId: taskboardTask.id,
      expectedVersion: 3,
      operationId: 'operation:taskboard-restore',
    },
    { task: taskboardDetails },
  ),
  'taskboard/task/delete': methodFixture(
    'taskboard/task/delete',
    {
      taskId: taskboardTask.id,
      expectedVersion: 4,
      operationId: 'operation:taskboard-delete',
    },
    { deleted: true, taskId: taskboardTask.id },
  ),
  'taskboard/thread/link': methodFixture(
    'taskboard/thread/link',
    {
      taskId: taskboardTask.id,
      threadId: 'thread:taskboard',
      role: 'primary',
      expectedVersion: 1,
      operationId: 'operation:taskboard-link',
    },
    { task: taskboardDetails },
  ),
  'taskboard/thread/unlink': methodFixture(
    'taskboard/thread/unlink',
    {
      taskId: taskboardTask.id,
      threadId: 'thread:taskboard',
      expectedVersion: 2,
      operationId: 'operation:taskboard-unlink',
    },
    { task: taskboardDetails },
  ),
  'taskboard/thread/set-primary': methodFixture(
    'taskboard/thread/set-primary',
    {
      taskId: taskboardTask.id,
      threadId: 'thread:taskboard',
      expectedVersion: 2,
      operationId: 'operation:taskboard-primary',
    },
    { task: taskboardDetails },
  ),
  'taskboard/comment/create': methodFixture(
    'taskboard/comment/create',
    {
      taskId: taskboardTask.id,
      body: taskboardComment.body,
      expectedVersion: 2,
      operationId: 'operation:taskboard-comment-create',
    },
    { task: taskboardDetails, comment: taskboardComment },
  ),
  'taskboard/comment/update': methodFixture(
    'taskboard/comment/update',
    {
      commentId: taskboardComment.id,
      body: taskboardComment.body,
      expectedVersion: 1,
      operationId: 'operation:taskboard-comment-update',
    },
    { task: taskboardDetails, comment: taskboardComment },
  ),
  'taskboard/comment/delete': methodFixture(
    'taskboard/comment/delete',
    {
      commentId: taskboardComment.id,
      expectedVersion: 1,
      operationId: 'operation:taskboard-comment-delete',
    },
    { task: taskboardDetails, comment: taskboardComment },
  ),
  'taskboard/label/list': methodFixture(
    'taskboard/label/list',
    {
      projectId: project.id,
    },
    { labels: [taskboardLabel] },
  ),
  'taskboard/label/create': methodFixture(
    'taskboard/label/create',
    {
      projectId: project.id,
      name: taskboardLabel.name,
      operationId: 'operation:taskboard-label-create',
    },
    { label: taskboardLabel },
  ),
  'taskboard/label/update': methodFixture(
    'taskboard/label/update',
    {
      labelId: taskboardLabel.id,
      name: taskboardLabel.name,
      expectedVersion: 1,
      operationId: 'operation:taskboard-label-update',
    },
    { label: taskboardLabel },
  ),
  'taskboard/label/delete': methodFixture(
    'taskboard/label/delete',
    {
      labelId: taskboardLabel.id,
      expectedVersion: 1,
      operationId: 'operation:taskboard-label-delete',
    },
    { deleted: true, labelId: taskboardLabel.id },
  ),
  'taskboard/task/start': methodFixture(
    'taskboard/task/start',
    {
      taskId: taskboardTask.id,
      execution: { kind: 'local' },
      operationId: taskboardStartOperation.operationId,
    },
    { operation: taskboardStartOperation },
  ),
  'taskboard/task/start/status': methodFixture(
    'taskboard/task/start/status',
    {
      operationId: taskboardStartOperation.operationId,
      afterRevision: 2,
    },
    { operation: taskboardStartOperation, changed: true },
  ),
  'taskboard/task/start/retry-setup': methodFixture(
    'taskboard/task/start/retry-setup',
    {
      operationId: taskboardStartOperation.operationId,
      revision: 2,
    },
    { operation: taskboardStartOperation },
  ),
  'taskboard/task/start/continue-without-setup': methodFixture(
    'taskboard/task/start/continue-without-setup',
    {
      operationId: taskboardStartOperation.operationId,
      revision: 2,
    },
    { operation: taskboardStartOperation },
  ),
  'taskboard/workflow/list': methodFixture(
    'taskboard/workflow/list',
    {
      projectId: project.id,
      statuses: ['blocked'],
      priorities: ['high'],
      labelIds: [],
      query: '任务工作台',
      archived: false,
      unread: true,
      datePreset: 'due_7_days',
      today: '2026-08-23',
      sort: 'due_date',
      limit: 200,
    },
    {
      tasks: [{ ...taskboardWorkflowTask, threads: [] }],
      unreadCount: 1,
      nextCursor: null,
    },
  ),
  'taskboard/workflow/read': methodFixture(
    'taskboard/workflow/read',
    {
      taskId: taskboardTask.id,
    },
    { task: taskboardWorkflowDetails },
  ),
  'taskboard/workflow/diagnostics': methodFixture(
    'taskboard/workflow/diagnostics',
    {
      taskIds: [taskboardTask.id],
    },
    {
      warnings: [
        {
          code: 'workflow-status-fallback',
          taskId: taskboardTask.id,
          fallbackStatus: 'in_progress',
        },
      ],
    },
  ),
  'taskboard/workflow/create': methodFixture(
    'taskboard/workflow/create',
    {
      operationId: 'operation:workflow-create',
      projectId: project.id,
      title: taskboardTask.title,
      description: taskboardTask.description,
      status: 'in_review',
      priority: 'high',
      labelIds: [],
      startDate: '2026-08-20',
      dueDate: '2026-08-25',
      threadLinks: [{ threadId: 'thread:taskboard', role: 'primary' }],
    },
    { task: taskboardWorkflowDetails },
  ),
  'taskboard/workflow/update': methodFixture(
    'taskboard/workflow/update',
    {
      operationId: 'operation:workflow-update',
      taskId: taskboardTask.id,
      expectedVersion: 2,
      patch: { priority: 'high', startDate: null, dueDate: '2026-08-25' },
    },
    { task: taskboardWorkflowDetails },
  ),
  'taskboard/workflow/move': methodFixture(
    'taskboard/workflow/move',
    {
      operationId: 'operation:workflow-move',
      taskId: taskboardTask.id,
      expectedVersion: 2,
      status: 'blocked',
      beforeTaskId: null,
      afterTaskId: null,
      note: '等待用户确认权限。',
    },
    { task: taskboardWorkflowDetails },
  ),
  'taskboard/workflow/transition': methodFixture(
    'taskboard/workflow/transition',
    {
      operationId: 'operation:workflow-transition',
      taskId: taskboardTask.id,
      expectedVersion: 2,
      action: 'report_blocked',
      note: '等待用户确认权限。',
    },
    { task: taskboardWorkflowDetails },
  ),
  'taskboard/workflow/mark-read': methodFixture(
    'taskboard/workflow/mark-read',
    {
      operationId: 'operation:workflow-mark-read',
      taskId: taskboardTask.id,
      expectedUnreadAt: 3,
    },
    { task: taskboardWorkflowDetails },
  ),
  'taskboard/workflow/thread-candidates': methodFixture(
    'taskboard/workflow/thread-candidates',
    {
      projectId: project.id,
      query: '任务',
      limit: 100,
    },
    {
      threads: [
        {
          threadId: 'thread:taskboard',
          projectId: project.id,
          title: '任务工作台',
          latestTurnStatus: 'completed',
          pendingPlanApproval: false,
          updatedAt: 2,
        },
      ],
      nextCursor: null,
    },
  ),
  'taskboard/workflow/find-by-thread': methodFixture(
    'taskboard/workflow/find-by-thread',
    {
      threadId: 'thread:taskboard',
      projectId: project.id,
    },
    {
      lookup: {
        threadId: 'thread:taskboard',
        taskId: taskboardTask.id,
        eligible: false,
        ineligibleReason: 'already_linked',
      },
    },
  ),
  'taskboard/workflow/link-threads': methodFixture(
    'taskboard/workflow/link-threads',
    {
      operationId: 'operation:workflow-link',
      taskId: taskboardTask.id,
      expectedVersion: 2,
      links: [{ threadId: 'thread:taskboard', role: 'primary' }],
    },
    { task: taskboardWorkflowDetails },
  ),
  'taskboard/workflow/start': methodFixture(
    'taskboard/workflow/start',
    {
      operationId: taskboardStartOperation.operationId,
      taskId: taskboardTask.id,
      expectedVersion: 2,
      execution: { kind: 'local' },
      mode: 'continue_primary',
      authorizeBacklog: true,
    },
    { operation: taskboardStartOperation },
  ),
  'thread/goal/get': methodFixture(
    'thread/goal/get',
    {
      threadId: 'thread:1',
    },
    { goal: null },
  ),
  'thread/goal/set': methodFixture(
    'thread/goal/set',
    {
      threadId: 'thread:1',
      objective: '修复登录失败',
      status: 'active',
      expectedVersion: null,
      operationId: 'operation:thread-goal-set',
    },
    {
      goal: {
        id: 'goal:1',
        threadId: 'thread:1',
        objective: '修复登录失败',
        status: 'active',
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        version: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    },
  ),
  'thread/goal/clear': methodFixture(
    'thread/goal/clear',
    {
      threadId: 'thread:1',
      expectedVersion: 1,
      operationId: 'operation:thread-goal-clear',
    },
    { threadId: 'thread:1', goalId: 'goal:1', clearedAt: 2 },
  ),
  'thread/bookmarks/list': methodFixture(
    'thread/bookmarks/list',
    {
      threadId: 'thread:1',
    },
    { threadId: 'thread:1', inputIds: ['input:1'], version: 1 },
  ),
  'thread/bookmarks/set': methodFixture(
    'thread/bookmarks/set',
    {
      threadId: 'thread:1',
      inputId: 'input:1',
      bookmarked: true,
      expectedVersion: 0,
      operationId: 'operation:thread-bookmarks-set',
    },
    { threadId: 'thread:1', inputIds: ['input:1'], version: 1 },
  ),
  'session-group/list': methodFixture(
    'session-group/list',
    {
      query: '登录',
      limit: 20,
    },
    {
      groups: [],
      nextCursor: null,
    },
  ),
  'session-group/read': methodFixture(
    'session-group/read',
    {
      groupId: 'session-group:1',
    },
    {
      group: {
        id: 'session-group:1',
        name: '登录修复',
        description: '跨项目排查登录问题',
        version: 1,
        memberCount: 0,
        projectLabels: [],
        latestStepAt: null,
        createdAt: 1,
        updatedAt: 1,
      },
      memberships: [],
    },
  ),
  'session-group/create': methodFixture(
    'session-group/create',
    {
      name: '登录修复',
      description: '跨项目排查登录问题',
      operationId: 'operation:session-group-create',
    },
    {
      group: {
        id: 'session-group:1',
        name: '登录修复',
        description: '跨项目排查登录问题',
        version: 1,
        memberCount: 0,
        projectLabels: [],
        latestStepAt: null,
        createdAt: 1,
        updatedAt: 1,
      },
    },
  ),
  'session-group/update': methodFixture(
    'session-group/update',
    {
      groupId: 'session-group:1',
      expectedVersion: 1,
      patch: { name: '登录修复组' },
      operationId: 'operation:session-group-update',
    },
    {
      group: {
        id: 'session-group:1',
        name: '登录修复组',
        description: '跨项目排查登录问题',
        version: 2,
        memberCount: 0,
        projectLabels: [],
        latestStepAt: null,
        createdAt: 1,
        updatedAt: 2,
      },
    },
  ),
  'session-group/delete': methodFixture(
    'session-group/delete',
    {
      groupId: 'session-group:1',
      expectedVersion: 2,
      operationId: 'operation:session-group-delete',
    },
    { groupId: 'session-group:1', deletedAt: 3 },
  ),
  'session-group/membership/set': methodFixture(
    'session-group/membership/set',
    {
      threadId: 'thread:1',
      groupId: 'session-group:1',
      operationId: 'operation:session-group-membership',
    },
    { membership: { groupId: 'session-group:1', threadId: 'thread:1', joinedAt: 2 } },
  ),
  'session-group/context/read': methodFixture(
    'session-group/context/read',
    {
      groupId: 'session-group:1',
      sections: ['objective'],
    },
    {
      state: {
        groupId: 'session-group:1',
        contextRevision: 1,
        summarizedThroughSequence: 0,
        latestSequence: 0,
        digest: '',
        createdAt: 1,
        updatedAt: 1,
      },
      entries: [],
    },
  ),
  'session-group/context/update': methodFixture(
    'session-group/context/update',
    {
      groupId: 'session-group:1',
      expectedContextRevision: 1,
      changes: [{ op: 'add', section: 'objective', title: '目标', content: '修复登录问题' }],
      operationId: 'operation:session-group-context',
    },
    {
      state: {
        groupId: 'session-group:1',
        contextRevision: 2,
        summarizedThroughSequence: 0,
        latestSequence: 0,
        digest: '',
        createdAt: 1,
        updatedAt: 2,
      },
      entries: [],
    },
  ),
  'session-group/step/list': methodFixture(
    'session-group/step/list',
    {
      groupId: 'session-group:1',
      limit: 20,
    },
    { steps: [], nextCursor: null },
  ),
  'session-group/step/diff': methodFixture(
    'session-group/step/diff',
    {
      groupId: 'session-group:1',
      stepId: 'session-group-step:1',
      path: 'src/index.ts',
    },
    { stepId: 'session-group-step:1', files: [] },
  ),
  'workflow/list': methodFixture(
    'workflow/list',
    { query: '登录', limit: 20 },
    { workflows: [], nextCursor: null },
  ),
  'workflow/read': methodFixture(
    'workflow/read',
    { workflowId: 'workflow:1' },
    {
      workflow: {
        id: 'workflow:1',
        name: '登录修复',
        description: '跨项目排查',
        version: 1,
        memberCount: 0,
        projectLabels: [],
        latestStepAt: null,
        createdAt: 1,
        updatedAt: 1,
      },
      memberships: [],
    },
  ),
  'workflow/create': methodFixture(
    'workflow/create',
    { name: '登录修复', operationId: 'operation:workflow-create' },
    {
      workflow: {
        id: 'workflow:1',
        name: '登录修复',
        description: '',
        version: 1,
        memberCount: 0,
        projectLabels: [],
        latestStepAt: null,
        createdAt: 1,
        updatedAt: 1,
      },
    },
  ),
  'workflow/update': methodFixture(
    'workflow/update',
    {
      workflowId: 'workflow:1',
      expectedVersion: 1,
      patch: { name: '登录修复流' },
      operationId: 'operation:workflow-update',
    },
    {
      workflow: {
        id: 'workflow:1',
        name: '登录修复流',
        description: '',
        version: 2,
        memberCount: 0,
        projectLabels: [],
        latestStepAt: null,
        createdAt: 1,
        updatedAt: 2,
      },
    },
  ),
  'workflow/delete': methodFixture(
    'workflow/delete',
    { workflowId: 'workflow:1', expectedVersion: 2, operationId: 'operation:workflow-delete' },
    { workflowId: 'workflow:1', deletedAt: 3 },
  ),
  'workflow/membership/set': methodFixture(
    'workflow/membership/set',
    {
      threadId: 'thread:1',
      workflowId: 'workflow:1',
      operationId: 'operation:workflow-membership',
    },
    { membership: { workflowId: 'workflow:1', threadId: 'thread:1', joinedAt: 2 } },
  ),
  'workflow/context/read': methodFixture(
    'workflow/context/read',
    { workflowId: 'workflow:1', sections: ['objective'] },
    {
      state: {
        workflowId: 'workflow:1',
        contextRevision: 1,
        summarizedThroughSequence: 0,
        latestSequence: 0,
        digest: '',
        createdAt: 1,
        updatedAt: 1,
      },
      entries: [],
    },
  ),
  'workflow/context/update': methodFixture(
    'workflow/context/update',
    {
      workflowId: 'workflow:1',
      expectedContextRevision: 1,
      changes: [{ op: 'add', section: 'objective', title: '目标', content: '修复登录' }],
      operationId: 'operation:workflow-context',
    },
    {
      state: {
        workflowId: 'workflow:1',
        contextRevision: 2,
        summarizedThroughSequence: 0,
        latestSequence: 0,
        digest: '',
        createdAt: 1,
        updatedAt: 2,
      },
      entries: [],
    },
  ),
  'workflow/step/list': methodFixture(
    'workflow/step/list',
    { workflowId: 'workflow:1', limit: 20 },
    { steps: [], nextCursor: null },
  ),
  'workflow/step/diff': methodFixture(
    'workflow/step/diff',
    { workflowId: 'workflow:1', stepId: 'workflow-step:1', path: 'src/index.ts' },
    { stepId: 'workflow-step:1', files: [] },
  ),
  'usage/source/list': methodFixture(
    'usage/source/list',
    {},
    {
      sources: [
        {
          sourceId: 'fixture-key',
          canonicalProviderId: providerId,
          providerIds: [providerId],
          displayName: 'Fixture provider key',
          scope: 'api-key',
          stability: 'official',
          availability: 'queryable',
          capabilities: ['balance', 'quota'],
          queryPolicy: 'cached',
          connection: {
            kind: 'provider-key',
            credentialId,
            maskedValue: '••••test',
            disconnectible: false,
          },
          connectionMethod: {
            kind: 'provider-credential',
          },
        },
      ],
    },
  ),
  'usage/provider/query': methodFixture(
    'usage/provider/query',
    {
      range: '7d',
      timeZone: 'Asia/Shanghai',
      providerIds: [providerId],
      sourceIds: ['fixture-key'],
      force: false,
    },
    {
      range: '7d',
      timeZone: 'Asia/Shanghai',
      generatedAt: 1,
      sources: [
        {
          sourceId: 'fixture-key',
          providerIds: [providerId],
          displayName: 'Fixture provider key',
          scope: 'api-key',
          stability: 'official',
          status: 'available',
          checkedAt: 1,
          connection: {
            kind: 'provider-key',
            credentialId,
            maskedValue: '••••test',
            disconnectible: false,
          },
          groups: [
            {
              id: 'account:fixture',
              label: 'Fixture account',
              balances: [
                {
                  currency: 'USD',
                  total: '10.50',
                  components: [{ label: '赠送余额', amount: '2.50' }],
                },
              ],
              quotaWindows: [
                {
                  id: 'weekly',
                  label: '周额度',
                  unit: 'tokens',
                  limit: 1_000,
                  used: 250,
                  remaining: 750,
                  remainingPercent: 75,
                  resetsAt: 2,
                  state: 'normal',
                },
              ],
              totals: {
                inputTokens: 100,
                outputTokens: 50,
                cachedTokens: 25,
                requests: 2,
                costs: [{ currency: 'USD', amount: '0.0125' }],
              },
              series: [
                {
                  date: '2026-07-26',
                  inputTokens: 100,
                  outputTokens: 50,
                  cachedTokens: 25,
                  requests: 2,
                  costs: [{ currency: 'USD', amount: '0.0125' }],
                },
              ],
              breakdown: [
                {
                  id: 'model:fixture',
                  label: 'Fixture model',
                  kind: 'model',
                  inputTokens: 100,
                  outputTokens: 50,
                  cachedTokens: 25,
                  requests: 2,
                  costs: [{ currency: 'USD', amount: '0.0125' }],
                },
              ],
            },
          ],
        },
      ],
    },
  ),
  'usage/credential/connect': methodFixture(
    'usage/credential/connect',
    {
      sourceId: 'xai-management',
      key: 'xai-management-key',
      teamId: 'team:fixture',
      operationId: 'operation:usage-connect',
    },
    {
      sourceId: 'xai-management',
      connection: {
        kind: 'billing-key',
        credentialId,
        maskedValue: '••••test',
        disconnectible: true,
      },
    },
  ),
  'usage/credential/disconnect': methodFixture(
    'usage/credential/disconnect',
    {
      sourceId: 'xai-management',
      operationId: 'operation:usage-disconnect',
    },
    {
      sourceId: 'xai-management',
      disconnected: true,
    },
  ),
  'system/shrinkMemory': methodFixture(
    'system/shrinkMemory',
    {
      reason: 'manual',
    },
    {
      success: true,
      stats: {
        rss: 120_000_000,
        heapTotal: 60_000_000,
        heapUsed: 40_000_000,
        external: 10_000_000,
        arrayBuffers: 2_000_000,
      },
      freedRssBytes: 15_000_000,
    },
  ),
} satisfies MethodFixtures

describe('RPC method schema contracts', () => {
  test('显式多 Skill 与空正文在 start、steer、queue 中使用同一契约', () => {
    const skills = [
      { name: 'review', path: 'builtin://review/SKILL.md' },
      { name: 'plan', path: 'plugin://tools/skills/plan/SKILL.md' },
    ]
    for (const method of ['turn/start', 'turn/steer', 'queue/add', 'queue/update'] as const) {
      const decode = Schema.decodeUnknownSync(RpcMethods[method].params)
      expect(decode({ ...fixtures[method].params, content: '', skills })).toMatchObject({
        content: '',
        skills,
      })
      expect(() =>
        decode({ ...fixtures[method].params, skills: [{ name: 'review', path: '' }] }),
      ).toThrow()
    }
    expect(Capabilities).toContain('skills.invocation.v1')
  })
  test('会话组使用唯一能力并停止公开任务看板协议', () => {
    const methods = Object.entries(RpcMethods).filter(([method]) =>
      method.startsWith('session-group/'),
    )
    expect(methods).toHaveLength(10)
    expect(methods.every(([, definition]) => definition.capability === 'session-group.v1')).toBe(
      true,
    )
    expect(Object.keys(RpcMethods).some((method) => method.startsWith('taskboard/'))).toBe(false)
    expect(Capabilities).toContain('session-group.v1')
    expect(Capabilities.some((capability) => capability.startsWith('taskboard.'))).toBe(false)

    const decodeCreate = Schema.decodeUnknownSync(RpcMethods['session-group/create'].params)
    expect(() =>
      decodeCreate({
        ...fixtures['session-group/create'].params,
        name: 'x'.repeat(121),
      }),
    ).toThrow()
    expect(() =>
      decodeCreate({
        ...fixtures['session-group/create'].params,
        description: 'x'.repeat(4_001),
      }),
    ).toThrow()
  })

  test('批量 Review Diff 使用独立的向后兼容能力', () => {
    expect(RpcMethods['review/file-diffs'].capability).toBe('git.review.batch.v1')
    expect(Capabilities).toContain('git.review.batch.v1')
    const capability = Schema.decodeUnknownSync(ProtocolCapabilitySchema)('git.review.batch.v1')
    expect(Schema.encodeSync(ProtocolCapabilitySchema)(capability)).toBe('git.review.batch.v1')

    const initialize = Schema.decodeUnknownSync(RpcMethods.initialize.params)({
      ...fixtures.initialize.params,
      capabilities: ['git.review.v1', 'git.review.batch.v1'],
    })
    expect(initialize.capabilities).toEqual(['git.review.v1', 'git.review.batch.v1'])
  })

  test('thread/patch/apply 只接受版本化动作参数', () => {
    const definition = RpcMethods['thread/patch/apply']
    expect(definition.exactParams).toBe(true)
    const decode = Schema.decodeUnknownSync(definition.params, { onExcessProperty: 'error' })
    const valid = fixtures['thread/patch/apply'].params

    expect(decode(valid)).toEqual(valid)
    expect(Object.keys(valid).sort()).toEqual([
      'action',
      'expectedVersion',
      'itemId',
      'operationId',
      'threadId',
    ])
    expect(() => decode({ ...valid, action: 'discard' })).toThrow()
    expect(() => decode({ ...valid, expectedVersion: -1 })).toThrow()
    expect(() => decode({ ...valid, diff: 'arbitrary patch content' })).toThrow()
  })

  test('thread/patch/diff 使用精确的只读请求与安全结果 envelope', () => {
    const definition = RpcMethods['thread/patch/diff']
    expect(definition.mutation).toBe(false)
    expect(definition.exactParams).toBe(true)
    expect(definition.exactResult).toBe(true)
    const decodeParams = Schema.decodeUnknownSync(definition.params, { onExcessProperty: 'error' })
    const valid = fixtures['thread/patch/diff'].params

    expect(decodeParams(valid)).toEqual(valid)
    expect(() => decodeParams({ ...valid, path: '' })).toThrow()
    expect(() => decodeParams({ ...valid, beforeContent: 'secret' })).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(definition.result, { onExcessProperty: 'error' })({
        ...fixtures['thread/patch/diff'].result,
        afterContent: 'secret',
      }),
    ).toThrow()
  })

  test('keeps valid params and results for every formal method decodable', () => {
    const methods = Object.keys(AllRpcMethods) as RpcMethod[]
    expect(methods).toHaveLength(321)
    const activeFixtureKeys = Object.keys(fixtures).filter(
      (method) => !method.startsWith('taskboard/'),
    )
    expect(activeFixtureKeys.sort()).toEqual([...methods].sort())

    for (const method of methods) {
      const definition = AllRpcMethods[method]
      const fixture = fixtures[method]
      const params = Schema.decodeUnknownSync(
        definition.params,
        definition.exactParams ? { onExcessProperty: 'error' } : undefined,
      )(fixture.params)
      const result = Schema.decodeUnknownSync(definition.result)(fixture.result)
      const encodedParams = Schema.encodeSync(definition.params)(params)
      const encodedResult = Schema.encodeSync(definition.result)(result)

      expect(params, `${method} params`).toEqual(fixture.params)
      expect(result, `${method} result`).toEqual(fixture.result)
      expect(encodedParams as unknown, `${method} encoded params`).toEqual(
        fixture.params as unknown,
      )
      expect(encodedResult as unknown, `${method} encoded result`).toEqual(
        fixture.result as unknown,
      )
    }
  })

  test('thread list unread marker stays optional and nullable', () => {
    const decode = Schema.decodeUnknownSync(RpcMethods['thread/list'].result)
    const withoutUnread = structuredClone(fixtures['thread/list'].result)
    delete (withoutUnread.threads[0] as { unreadAt?: number | null }).unreadAt
    expect(decode(withoutUnread).threads[0]?.unreadAt).toBeUndefined()

    const read = structuredClone(fixtures['thread/list'].result)
    ;(read.threads[0] as { unreadAt?: number | null }).unreadAt = null
    expect(decode(read).threads[0]?.unreadAt).toBeNull()
  })

  test('thread list pendingPlanApproval stays optional and decodes present values', () => {
    const decode = Schema.decodeUnknownSync(RpcMethods['thread/list'].result)
    const withoutPlan = structuredClone(fixtures['thread/list'].result)
    delete (withoutPlan.threads[0] as { pendingPlanApproval?: boolean }).pendingPlanApproval
    expect(decode(withoutPlan).threads[0]?.pendingPlanApproval).toBeUndefined()

    const withPlan = structuredClone(fixtures['thread/list'].result)
    ;(withPlan.threads[0] as { pendingPlanApproval?: boolean }).pendingPlanApproval = true
    expect(decode(withPlan).threads[0]?.pendingPlanApproval).toBe(true)
  })

  test('accepts bundled changelog as a release notes source', () => {
    const result = {
      ...fixtures['release-notes/list'].result,
      source: 'bundled-changelog',
    }
    expect(
      Schema.decodeUnknownSync(RpcMethods['release-notes/list'].result, {
        onExcessProperty: 'error',
      })(result).source,
    ).toBe('bundled-changelog')
  })

  test('rejects invalid opaque IDs, limits, and enums', () => {
    expect(() =>
      Schema.decodeUnknownSync(RpcMethods['thread/read'].params)({ threadId: '' }),
    ).toThrow()
    const decodeThreadHistory = Schema.decodeUnknownSync(RpcMethods['thread/history/read'].params)
    expect(decodeThreadHistory({ threadId: 'thread:1' })).toEqual({ threadId: 'thread:1' })
    expect(() => decodeThreadHistory({ threadId: 'thread:1', limit: 0 })).toThrow()
    expect(() => decodeThreadHistory({ threadId: 'thread:1', limit: 51 })).toThrow()

    const decodeProjectList = Schema.decodeUnknownSync(RpcMethods['project/list'].params)
    expect(() => decodeProjectList({ limit: 0 })).toThrow()
    expect(() => decodeProjectList({ limit: 501 })).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(RpcMethods['config/profile/select'].params)({
        profileId: '包含 空格',
      }),
    ).toThrow()

    expect(() =>
      Schema.decodeUnknownSync(RpcMethods.initialize.params)({
        ...fixtures.initialize.params,
        interactionDelivery: 'background',
      }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(RpcMethods['turn/start'].params)({
        ...fixtures['turn/start'].params,
        taskMode: 'execute',
      }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(RpcMethods['turn/interrupt'].params)({
        threadId: threadListItem.id,
        operationId: 'operation:turn-interrupt-without-turn',
      }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(RpcMethods['queue/add'].result)({
        ...fixtures['queue/add'].result,
        admission: 'steered',
      }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(RpcMethods['review/applyBatch'].params)({
        ...fixtures['review/applyBatch'].params,
        items: [],
      }),
    ).toThrow()
    const decodeMcpSave = Schema.decodeUnknownSync(RpcMethods['mcp/save'].params, {
      onExcessProperty: 'error',
    })
    expect(
      decodeMcpSave({
        server: {
          name: 'fixture',
          scope: 'user',
          enabled: true,
          enabledTools: ['', 'read'],
          disabledTools: ['write', ''],
          transport: {
            type: 'http',
            url: 'https://example.com/mcp',
            auth: 'none',
            scopes: ['', 'profile'],
          },
        },
        operationId: 'operation:mcp-save:none',
      }),
    ).toMatchObject({
      server: {
        transport: { auth: 'none' },
      },
    })
    expect(() =>
      decodeMcpSave({
        server: {
          name: 'fixture',
          scope: 'user',
          enabled: true,
          transport: {
            type: 'http',
            url: 'https://example.com/mcp',
            auth: 'chatgpt',
          },
        },
        operationId: 'operation:mcp-save:invalid-auth',
      }),
    ).toThrow()
    const decodeGithubAuthStart = Schema.decodeUnknownSync(RpcMethods['github/auth/start'].params, {
      onExcessProperty: 'error',
    })
    expect(decodeGithubAuthStart({ mode: 'browser' })).toEqual({ mode: 'browser' })
    expect(decodeGithubAuthStart({ mode: 'device' })).toEqual({ mode: 'device' })
    expect(() => decodeGithubAuthStart({})).toThrow()
    expect(() => decodeGithubAuthStart({ mode: 'popup' })).toThrow()
    expect(() =>
      decodeGithubAuthStart({
        mode: 'device',
        clientId: 'legacy-client-id',
      }),
    ).toThrow()
    expect(
      Schema.decodeUnknownSync(RpcMethods['github/auth/start'].result)({
        ...githubLogin,
        mode: 'browser',
        authorizationUrl: 'https://github.com/login/oauth/authorize?client_id=fixture',
        userCode: null,
        verificationUri: null,
      }),
    ).toMatchObject({
      mode: 'browser',
      state: 'awaiting_auth',
      authorizationUrl: expect.stringContaining('github.com/login/oauth/authorize'),
    })

    for (const method of ['review/summary', 'review/refresh'] as const) {
      const result = fixtures[method].result
      expect(
        () =>
          Schema.decodeUnknownSync(RpcMethods[method].result)({
            ...result,
            cacheState: 'warming',
          }),
        `${method} cacheState`,
      ).toThrow()
      const withoutCacheState = { ...result } as Record<string, unknown>
      delete withoutCacheState.cacheState
      expect(
        () => Schema.decodeUnknownSync(RpcMethods[method].result)(withoutCacheState),
        `${method} requires cacheState`,
      ).toThrow()
    }
  })

  test('requires provider auth status without exposing authentication material', () => {
    const decode = Schema.decodeUnknownSync(RpcMethods['provider/list'].result, {
      onExcessProperty: 'error',
    })
    const result = structuredClone(fixtures['provider/list'].result)
    const provider = result.providers[0] as Record<string, unknown>

    delete provider.authConfigured
    expect(() => decode(result)).toThrow()

    provider.authConfigured = true
    provider.apiKey = 'sk-must-not-cross-rpc'
    expect(() => decode(result)).toThrow()
    delete provider.apiKey

    const withModelCount = {
      ...result,
      providers: [
        {
          ...result.providers[0],
          modelCount: 42,
        },
      ],
    }
    const decoded = decode(withModelCount)
    expect(decoded.providers[0]?.modelCount).toBe(42)
  })

  test('decodes builtin and custom provider definitions', () => {
    const providerResult = {
      ...structuredClone(fixtures['provider/list'].result),
      providers: [
        {
          ...fixtures['provider/list'].result.providers[0],
          source: {
            type: 'pi' as const,
            kind: 'builtin' as const,
            apis: ['openai-completions'],
            baseUrl: 'https://api.example.test/v1',
          },
          catalogOrigin: 'pi-bundled' as const,
          availability: { status: 'ready' as const },
          config: {
            kind: 'builtin' as const,
            id: providerId,
            enabled: true,
            allowModels: [],
            denyModels: [],
            models: [],
          },
        },
      ],
    }

    const decoded = Schema.decodeUnknownSync(RpcMethods['provider/list'].result)(providerResult)
    expect(decoded.providers[0]?.config.kind).toBe('builtin')
    expect(decoded.catalogVersion).toBeDefined()
  })

  test('uses explicit FIFO queue methods without reorder or queue-to-steer mutations', () => {
    expect('queue/add' in RpcMethods).toBe(true)
    expect('queue/update' in RpcMethods).toBe(true)
    expect('queue/remove' in RpcMethods).toBe(true)
    expect('queue/resume' in RpcMethods).toBe(true)
    expect('queue/reorder' in RpcMethods).toBe(false)
    expect('queue/steer' in RpcMethods).toBe(false)
  })

  test('accepts bounded deny feedback for approval interactions', () => {
    const decode = Schema.decodeUnknownSync(RpcMethods['interaction/respond'].params)
    const base = {
      interactionId: 'interaction:approval',
      expectedVersion: 1,
      operationId: 'operation:approval-feedback',
    }
    expect(
      decode({
        ...base,
        response: { kind: 'approval', decision: 'deny', feedback: '请改用只读方案' },
      }),
    ).toEqual({
      ...base,
      response: { kind: 'approval', decision: 'deny', feedback: '请改用只读方案' },
    })
    expect(() =>
      decode({
        ...base,
        response: { kind: 'approval', decision: 'deny', feedback: 'x'.repeat(4_001) },
      }),
    ).toThrow()
  })

  test('accepts explicit project and projectless thread workspaces', () => {
    const decode = Schema.decodeUnknownSync(RpcMethods['thread/create'].params, {
      onExcessProperty: 'error',
    })
    const common = {
      title: 'Workspace thread',
      operationId: 'operation:workspace-thread',
    }

    expect(decode({ ...common, workspace: { kind: 'project', projectId: project.id } })).toEqual({
      ...common,
      workspace: { kind: 'project', projectId: project.id },
    })
    expect(
      decode({
        ...common,
        sessionGroupId: 'session-group:1',
        workspace: { kind: 'project', projectId: project.id },
      }),
    ).toEqual({
      ...common,
      sessionGroupId: 'session-group:1',
      workspace: { kind: 'project', projectId: project.id },
    })
    expect(
      decode({
        ...common,
        workspace: {
          kind: 'project',
          projectId: project.id,
          execution: { kind: 'worktree', worktreeId: 'worktree:1' },
        },
      }).workspace,
    ).toEqual({
      kind: 'project',
      projectId: project.id,
      execution: { kind: 'worktree', worktreeId: 'worktree:1' },
    })
    expect(decode({ ...common, workspace: { kind: 'projectless', prompt: '整理需求' } })).toEqual({
      ...common,
      workspace: { kind: 'projectless', prompt: '整理需求' },
    })
    expect(() => decode(common)).toThrow()
    expect(() => decode({ ...common, projectId: project.id })).toThrow()
    expect(() =>
      decode({ ...common, workspace: { kind: 'projectless', execution: { kind: 'local' } } }),
    ).toThrow()
  })

  test('accepts numeric and latest event cursors while rejecting unknown cursor modes', () => {
    const decode = Schema.decodeUnknownSync(RpcMethods['event/subscribe'].params)

    expect(decode({ streams: [{ streamId: 'global', after: 0 }] })).toEqual({
      streams: [{ streamId: 'global', after: 0 }],
    })
    expect(decode({ streams: [{ streamId: 'global', after: 'latest' }] })).toEqual({
      streams: [{ streamId: 'global', after: 'latest' }],
    })
    expect(() => decode({ streams: [{ streamId: 'global', after: 'newest' }] })).toThrow()
  })

  test('rejects excess fields for every security-sensitive exact params schema', () => {
    const exactMethods = (Object.keys(AllRpcMethods) as RpcMethod[]).filter(
      (method) => AllRpcMethods[method].exactParams,
    )
    expect(exactMethods.length).toBeGreaterThan(0)

    for (const method of exactMethods) {
      expect(
        () =>
          Schema.decodeUnknownSync(AllRpcMethods[method].params, { onExcessProperty: 'error' })({
            ...fixtures[method].params,
            unexpectedSensitiveField: 'must-not-pass',
          }),
        method,
      ).toThrow()
    }
  })

  test('公共 runtime 方法表不包含 desktop host terminal schema', () => {
    expect(Object.keys(RpcMethods)).toHaveLength(300)
    expect('terminal/host/context' in RpcMethods).toBe(false)
    expect(Object.keys(AllRpcMethods)).toContain('terminal/host/context')
  })

  test('插件管理使用精确契约并由独立能力保护', () => {
    expect(Capabilities).toContain('plugins.manage.v1')
    expect(Capabilities).toContain('plugins.details.v1')
    expect(Schema.decodeUnknownSync(ProtocolCapabilitySchema)('plugins.manage.v1')).toBe(
      'plugins.manage.v1',
    )
    expect(Schema.decodeUnknownSync(ProtocolCapabilitySchema)('plugins.details.v1')).toBe(
      'plugins.details.v1',
    )
    expect(RpcMethods['plugin/list']).toMatchObject({
      capability: 'plugins.manage.v1',
      mutation: false,
      exactParams: true,
      exactResult: true,
    })
    expect(RpcMethods['plugin/setEnabled']).toMatchObject({
      capability: 'plugins.manage.v1',
      mutation: true,
      exactParams: true,
      exactResult: true,
    })
    expect(RpcMethods['plugin/setEnabled'].errors).toEqual([
      'PLUGIN_NOT_FOUND',
      'PLUGIN_NOT_INSTALLED',
      'PLUGIN_INVALID',
      'CONFLICT',
      'PATH_DENIED',
      'INTERNAL_ERROR',
    ])
    expect(RpcMethods['plugin/getDetails'].errors).toEqual(RpcMethods['plugin/setEnabled'].errors)

    const decodeListParams = Schema.decodeUnknownSync(RpcMethods['plugin/list'].params, {
      onExcessProperty: 'error',
    })
    expect(decodeListParams({})).toEqual({})
    expect(decodeListParams(fixtures['plugin/list'].params)).toEqual(fixtures['plugin/list'].params)

    const decodeDetailsParams = Schema.decodeUnknownSync(RpcMethods['plugin/getDetails'].params, {
      onExcessProperty: 'error',
    })
    expect(decodeDetailsParams(fixtures['plugin/getDetails'].params)).toEqual(
      fixtures['plugin/getDetails'].params,
    )
    expect(() =>
      decodeDetailsParams({ pluginId: 'task-planning', absolutePath: 'C:\\sensitive' }),
    ).toThrow()

    const decodeDetails = Schema.decodeUnknownSync(RpcMethods['plugin/getDetails'].result, {
      onExcessProperty: 'error',
    })
    expect(decodeDetails(fixtures['plugin/getDetails'].result)).toEqual(
      fixtures['plugin/getDetails'].result,
    )
    expect(() =>
      decodeDetails({
        ...fixtures['plugin/getDetails'].result,
        details: { ...fixtures['plugin/getDetails'].result.details, manifestPath: 'C:\\sensitive' },
      }),
    ).toThrow()

    const decodeSetEnabledParams = Schema.decodeUnknownSync(
      RpcMethods['plugin/setEnabled'].params,
      { onExcessProperty: 'error' },
    )
    expect(decodeSetEnabledParams(fixtures['plugin/setEnabled'].params)).toEqual(
      fixtures['plugin/setEnabled'].params,
    )
    expect(() =>
      decodeSetEnabledParams({
        pluginId: 'task-planning',
        enabled: false,
      }),
    ).toThrow()

    const decodeList = Schema.decodeUnknownSync(RpcMethods['plugin/list'].result, {
      onExcessProperty: 'error',
    })
    const valid = fixtures['plugin/list'].result
    expect(decodeList(valid)).toEqual(valid)
    expect(() =>
      decodeList({
        ...valid,
        plugins: [{ ...valid.plugins[0], source: 'codex-cache' }],
      }),
    ).toThrow()
    expect(() =>
      decodeList({
        ...valid,
        plugins: [{ ...valid.plugins[0], absolutePath: 'C:\\sensitive\\plugin' }],
      }),
    ).toThrow()
    expect(() =>
      decodeList({
        ...valid,
        plugins: [{ ...valid.plugins[0], longDescription: 'not part of the summary' }],
      }),
    ).toThrow()
  })

  test('MiniMax CLI 集成使用独立能力、精确 mutation 和可对账事件', () => {
    expect(Capabilities).toContain('integrations.minimax-cli.v1')
    expect(Schema.decodeUnknownSync(ProtocolCapabilitySchema)('integrations.minimax-cli.v1')).toBe(
      'integrations.minimax-cli.v1',
    )
    expect(RpcMethods['minimaxCli/status']).toMatchObject({
      capability: 'integrations.minimax-cli.v1',
      mutation: false,
      exactParams: true,
      exactResult: true,
    })
    expect(RpcMethods['plugin/getDetails']).toMatchObject({
      capability: 'plugins.details.v1',
      mutation: false,
      exactParams: true,
      exactResult: true,
    })
    for (const method of ['minimaxCli/install', 'minimaxCli/uninstall'] as const) {
      expect(RpcMethods[method]).toMatchObject({
        capability: 'integrations.minimax-cli.v1',
        mutation: true,
        exactParams: true,
        exactResult: true,
      })
      const decode = Schema.decodeUnknownSync(RpcMethods[method].params, {
        onExcessProperty: 'error',
      })
      expect(decode(fixtures[method].params)).toEqual(fixtures[method].params)
      expect(() => decode({ operationId: 'operation:minimax', credentialId: 'secret' })).toThrow()
    }
    const status = Schema.decodeUnknownSync(RpcMethods['minimaxCli/status'].result, {
      onExcessProperty: 'error',
    })(fixtures['minimaxCli/status'].result)
    expect(status.credentialSource).toEqual({
      providerId: 'minimax-cn-coding-plan',
      credentialId: 'credential:minimax-cn',
      label: '当前 Coding Plan Key',
      maskedValue: 'sk-****abcd',
      region: 'cn',
    })
    expect(EventManifest['minimaxCli/updated']).toMatchObject({
      version: 1,
      durability: 'live',
      stream: 'global',
      capability: 'integrations.minimax-cli.v1',
      reconcilesWith: 'minimaxCli/status',
    })
  })

  test('requires authorized projectId instead of internal projectKey for project memory', () => {
    for (const method of [
      'memory/list',
      'memory/read',
      'memory/save',
      'memory/delete',
      'memory/reset',
    ] as const) {
      const invalid: Record<string, unknown> = {
        ...(fixtures[method].params as Record<string, unknown>),
        projectKey: 'F:\\private-workspace',
      }
      delete invalid.projectId
      expect(() => Schema.decodeUnknownSync(RpcMethods[method].params)(invalid), method).toThrow()
    }

    for (const method of ['memory/list', 'memory/read', 'memory/save'] as const) {
      const result = structuredClone(fixtures[method].result) as Record<string, unknown>
      const entry =
        method === 'memory/list'
          ? (result.entries as Array<Record<string, unknown>>)[0]
          : (result.entry as Record<string, unknown>)
      if (entry === undefined) throw new Error(`Missing ${method} fixture entry`)
      entry.projectKey = 'F:\\private-workspace'
      expect(
        () =>
          Schema.decodeUnknownSync(RpcMethods[method].result, { onExcessProperty: 'error' })(
            result,
          ),
        `${method} result`,
      ).toThrow()
    }
  })

  test('rejects replacement history from compaction results', () => {
    const result = structuredClone(fixtures['thread/compact'].result)
    expect(() =>
      Schema.decodeUnknownSync(RpcMethods['thread/compact'].result, { onExcessProperty: 'error' })({
        ...result,
        compaction: { ...result.compaction, replacementHistory: [{ from: 'old', to: 'new' }] },
      }),
    ).toThrow()
  })

  test('keeps compaction provenance optional for older method results', () => {
    const result = structuredClone(fixtures['thread/compact'].result)
    const legacyResult = {
      compaction: {
        id: result.compaction.id,
        beforeCount: result.compaction.beforeCount,
        afterCount: result.compaction.afterCount,
        beforeTokens: result.compaction.beforeTokens,
        afterTokens: result.compaction.afterTokens,
        targetTokens: result.compaction.targetTokens,
        usageSampleId: result.compaction.usageSampleId,
        baselineVersion: result.compaction.baselineVersion,
      },
    }

    expect(Schema.decodeUnknownSync(RpcMethods['thread/compact'].result)(legacyResult)).toEqual(
      legacyResult,
    )
  })

  test('rejects sandbox runtime internals from the public result', () => {
    expect(() =>
      Schema.decodeUnknownSync(RpcMethods['sandbox/status'].result, { onExcessProperty: 'error' })({
        sandbox: {
          ...sandboxStatus,
          helperPath: 'C:\\private\\sandbox-helper.exe',
          helperSha256: 'private-helper-hash',
          user: { provisioned: true },
          wfp: { state: 'installed' },
        },
      }),
    ).toThrow()
  })

  test('rejects sensitive headers and keeps API key results secret-free', () => {
    expect(() =>
      Schema.decodeUnknownSync(RpcMethods['provider/create'].params, { onExcessProperty: 'error' })(
        {
          ...fixtures['provider/create'].params,
          definition: {
            ...customProviderDefinition,
            headers: { authorization: 'fixture-secret' },
          },
        },
      ),
    ).toThrow()

    expect(() =>
      Schema.decodeUnknownSync(RpcMethods['provider/create'].result, { onExcessProperty: 'error' })(
        {
          ...fixtures['provider/create'].result,
          apiKey: 'fixture-secret',
        },
      ),
    ).toThrow()

    const createParams = Schema.decodeUnknownSync(RpcMethods['provider/apiKey/create'].params, {
      onExcessProperty: 'error',
    })(fixtures['provider/apiKey/create'].params)
    expect(createParams.key).toBe('fixture-secret')
    expect(() =>
      Schema.decodeUnknownSync(RpcMethods['provider/apiKey/create'].result, {
        onExcessProperty: 'error',
      })({
        ...fixtures['provider/apiKey/create'].result,
        key: 'fixture-secret',
      }),
    ).toThrow()

    const updateParams = Schema.decodeUnknownSync(RpcMethods['provider/apiKey/update'].params, {
      onExcessProperty: 'error',
    })(fixtures['provider/apiKey/update'].params)
    expect(updateParams.key).toBe('updated-secret')
    expect(() =>
      Schema.decodeUnknownSync(RpcMethods['provider/apiKey/update'].result, {
        onExcessProperty: 'error',
      })({
        ...fixtures['provider/apiKey/update'].result,
        key: 'updated-secret',
      }),
    ).toThrow()
  })

  test('keeps Coding as the legacy suggestion surface and accepts Working categories', () => {
    const decode = Schema.decodeUnknownSync(RpcMethods['task-suggestion/generate'].params, {
      onExcessProperty: 'error',
    })
    const legacy = decode(fixtures['task-suggestion/generate'].params)
    expect(legacy.surface).toBeUndefined()

    const working = decode({
      ...fixtures['task-suggestion/generate'].params,
      surface: 'working',
      context: {
        ...fixtures['task-suggestion/generate'].params.context,
        localCandidates: [
          { id: 'working:1', categoryId: 'create', label: '创建', prompt: 'Create a deliverable' },
          { id: 'working:2', categoryId: 'research', label: '调研', prompt: 'Research next steps' },
          {
            id: 'working:3',
            categoryId: 'automate',
            label: '自动化',
            prompt: 'Automate recurring work',
          },
        ],
      },
    })
    expect(working.surface).toBe('working')
    expect(working.context.localCandidates.map((item) => item.categoryId)).toEqual([
      'create',
      'research',
      'automate',
    ])
    const decodeResult = Schema.decodeUnknownSync(RpcMethods['task-suggestion/generate'].result, {
      onExcessProperty: 'error',
    })
    const workingResult = decodeResult({
      ...fixtures['task-suggestion/generate'].result,
      suggestions: working.context.localCandidates.map((item, index) => ({
        ...item,
        id: `working-suggestion:${index + 1}`,
      })),
    })
    expect(workingResult.suggestions.map((item) => item.categoryId)).toEqual([
      'create',
      'research',
      'automate',
    ])
    expect(() =>
      decode({
        ...fixtures['task-suggestion/generate'].params,
        surface: 'chat',
      }),
    ).toThrow()
  })

  test('declares model health capability and gates the new RPC methods', () => {
    expect(Capabilities).toContain('model.health.v1')
    const capability = Schema.decodeUnknownSync(ProtocolCapabilitySchema)('model.health.v1')
    expect(Schema.encodeSync(ProtocolCapabilitySchema)(capability)).toBe('model.health.v1')
    for (const method of [
      'model/health/preview',
      'model/health/start',
      'model/health/read',
      'model/health/cancel',
    ] as const) {
      expect(RpcMethods[method].capability).toBe('model.health.v1')
    }
  })

  test('negotiates DeepSeek protocol configuration and keeps the provider definition exact', () => {
    expect(Capabilities).toContain('provider.deepseekProtocol.v1')
    expect(Schema.decodeUnknownSync(ProtocolCapabilitySchema)('provider.deepseekProtocol.v1')).toBe(
      'provider.deepseekProtocol.v1',
    )

    const decodeUpdate = Schema.decodeUnknownSync(RpcMethods['provider/update'].params)
    const definition = {
      kind: 'builtin' as const,
      id: providerId,
      enabled: true,
      allowModels: [],
      denyModels: [],
      models: [],
      protocol: 'openai-responses' as const,
    }
    expect(
      decodeUpdate({
        providerId,
        definition,
        operationId: 'operation:deepseek-protocol',
      }).definition,
    ).toEqual(definition)
    expect(() =>
      decodeUpdate({
        providerId,
        definition: { ...definition, protocol: 'openai-beta-fim' },
        operationId: 'operation:deepseek-protocol-invalid',
      }),
    ).toThrow()
  })

  test('health run schema rejects invalid states, negative latency, and unknown categories', () => {
    const decodeItem = Schema.decodeUnknownSync(ModelHealthItemSchema)
    expect(
      decodeItem({
        model: modelRef,
        status: 'queued',
      }),
    ).toEqual({ model: modelRef, status: 'queued' })
    expect(
      decodeItem({
        model: modelRef,
        status: 'healthy',
        startedAt: 1,
        completedAt: 2,
        latencyMs: 12,
      }).status,
    ).toBe('healthy')
    expect(() =>
      decodeItem({
        model: modelRef,
        status: 'unknown-state',
      }),
    ).toThrow()
    expect(() =>
      decodeItem({
        model: modelRef,
        status: 'healthy',
        startedAt: 1,
        completedAt: 2,
        latencyMs: -1,
      }),
    ).toThrow()
    expect(() =>
      decodeItem({
        model: modelRef,
        status: 'failed',
        startedAt: 1,
        completedAt: 2,
        category: 'definitely-not-a-category',
        message: 'x',
      }),
    ).toThrow()
    const decodeRun = Schema.decodeUnknownSync(ModelHealthRunSchema)
    expect(() =>
      decodeRun({
        ...fixtures['model/health/start'].result.run,
        status: 'bogus',
      }),
    ).toThrow()
  })

  test('provider/test accepts an optional explicit model and requires match on reachable', () => {
    const decodeParams = Schema.decodeUnknownSync(RpcMethods['provider/test'].params)
    const withoutModel = decodeParams({ providerId })
    expect(withoutModel.model).toBeUndefined()
    const withModel = decodeParams({ providerId, model: modelRef })
    expect(withModel.model).toEqual(modelRef)

    const decodeResult = Schema.decodeUnknownSync(RpcMethods['provider/test'].result)
    const reachable = decodeResult({
      ...fixtures['provider/test'].result,
      status: 'reachable',
    })
    expect(reachable.model).toEqual(modelRef)
    // The legacy method keeps the old category set: internal timeout/provider
    // classifications are mapped to `unknown` before reaching this schema.
    const failed = decodeResult({
      providerId,
      status: 'unavailable',
      testedAt: 1,
      category: 'unknown',
      message: '请求在 15 秒内未完成',
    })
    if (failed.status !== 'unavailable') throw new Error('expected unavailable')
    expect(failed.category).toBe('unknown')
    expect(() =>
      decodeResult({
        providerId,
        status: 'unavailable',
        testedAt: 1,
        category: 'timeout',
        message: 'x',
      }),
    ).toThrow()
    expect(() =>
      decodeResult({
        ...fixtures['provider/test'].result,
        status: 'unreachable',
      }),
    ).toThrow()
  })

  test('model/health/updated is a live global event reconciling with read', () => {
    expect(EventManifest['model/health/updated']).toMatchObject({
      version: 1,
      durability: 'live',
      stream: 'global',
      capability: 'model.health.v1',
      reconcilesWith: 'model/health/read',
    })
    const decode = Schema.decodeUnknownSync(EventManifest['model/health/updated'].payload, {
      onExcessProperty: 'error',
    })
    const payload = {
      runId: 'operation:model-health',
      status: 'running' as const,
      counts: {
        total: 1,
        queued: 0,
        running: 1,
        healthy: 0,
        failed: 0,
        cancelled: 0,
      },
    }
    expect(decode(payload)).toEqual(payload)
    expect(() =>
      decode({
        ...payload,
        latencyMs: 12,
      }),
    ).toThrow()
  })

  test('system/shrinkMemory 声明 system.memory.v1 能力且参数与结果保持精确 envelope', () => {
    expect(Capabilities).toContain('system.memory.v1')
    expect(RpcMethods['system/shrinkMemory']).toMatchObject({
      capability: 'system.memory.v1',
      mutation: true,
      exactParams: true,
      exactResult: true,
    })
    const decodeParams = Schema.decodeUnknownSync(RpcMethods['system/shrinkMemory'].params, {
      onExcessProperty: 'error',
    })
    expect(decodeParams({})).toEqual({})
    expect(decodeParams({ reason: 'idle' })).toEqual({ reason: 'idle' })
    expect(() => decodeParams({ reason: 'unknown' })).toThrow()
    expect(() => decodeParams({ reason: 'manual', extra: 1 })).toThrow()

    const decodeResult = Schema.decodeUnknownSync(RpcMethods['system/shrinkMemory'].result, {
      onExcessProperty: 'error',
    })
    const validResult = {
      success: true,
      stats: {
        rss: 100_000_000,
        heapTotal: 50_000_000,
        heapUsed: 30_000_000,
        external: 5_000_000,
      },
      freedRssBytes: 10_000_000,
    }
    expect(decodeResult(validResult)).toEqual(validResult)
    expect(() => decodeResult({ ...validResult, extra: 1 })).toThrow()
  })
})


test('消息阶段为可选字段，未知阶段降级且事件按独立能力协商', () => {
  const item = { id: 'text', messageID: 'message', turnId: 'turn', agentId: 'agent', type: 'text', placement: 'result', text: '回答', status: 'streaming', createdAt: 1 }
  const decode = Schema.decodeUnknownSync(TextItemSchema)
  expect(decode(item)).not.toHaveProperty('phase')
  expect(decode({ ...item, phase: 'future_phase' }).phase).toBeUndefined()
  for (const phase of ['commentary', 'partial_answer', 'final_answer'] as const)
    expect(decode({ ...item, phase }).phase).toBe(phase)
  const event = EventManifest['item/agentMessage/phaseChanged']
  expect(event.capability).toBe('thread.message-phase.v1')
  expect(event.durability).toBe('durable')
  expect(Schema.decodeUnknownSync(event.payload)({ item: { ...item, phase: 'final_answer' } }).item.id).toBe('text')
})
