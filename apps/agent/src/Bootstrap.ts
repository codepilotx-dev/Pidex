import { ComputerUseService } from './computer/ComputerUseService'
import { LocalEnvironmentRepository } from './local-environment/LocalEnvironmentRepository'
import { LocalEnvironmentCatalog } from './local-environment/LocalEnvironmentCatalog'
import { computerToolDefinitions } from './tool/Computer/Definition'
import { Effect } from 'effect'
import { loadConfig } from './config/Config'
import { ConfigService } from './config/ConfigService'
import { SqliteProjectTrustStore } from './config/ProjectTrustStore'
import { ConfigMigrationService } from './config/ConfigMigrationService'
import { ConfigMigrationRepository } from './storage/repositories/ConfigMigrationRepository'
import { AgentDatabase } from './storage/database/AgentDatabase'
import { InterruptedRunRecoveryCoordinator } from './storage/recovery/InterruptedRunRecovery'
import { StartupRecoveryCoordinator } from './storage/recovery/StartupRecoveryCoordinator'
import { recoverThreadWorktreeOperations } from './storage/recovery/ThreadWorktreeRecovery'
import { EventHub } from './storage/events/EventHub'
import { publishAgentEvent } from './storage/events/EventPublisher'
import { EncryptedCredentialRepository } from './auth/EncryptedCredentialRepository'
import { AuthJsonCredentialRepository } from './auth/AuthJsonCredentialRepository'
import { ProviderCredentialStoreManager } from './auth/ProviderCredentialStoreManager'
import { PiAuthSessionService } from './auth/PiAuthSessionService'
import { ToolRegistry } from './tool/ToolRegistry'
import { ToolExecutor } from './tool/ToolExecutor'
import { getToolingManager } from './tool/ToolingManager'
import { ApprovalService } from './permission/ApprovalService'
import { ReviewerService } from './permission/ReviewerService'
import { QuestionService } from './session/QuestionService'
import { ResumeCheckpointResolver } from './interaction/ResumeCheckpointResolver'
import { ThreadService } from './session/ThreadService'
import { PlanApprovalService } from './session/plan/PlanApprovalService'
import { ThreadHistoryService } from './session/ThreadHistoryService'
import { AgentRuntimeService } from './orchestration/AgentRuntimeService'
import { ContextCompactionService } from './context/ContextCompactionService'
import { EncryptedCredentialStore, PiModelService, PiModelsFileStore } from './provider/pi'
import { generatePiObject } from './provider/pi/PiStructuredOutput'
import { resolveSpecializedPiModel } from './provider/pi/PiSpecializedModelResolver'
import { createApp } from './transport/Server'
import { AgentLogger } from './observability/AgentLogger'
import { ExecutionLogObserver, HarnessLogObserver } from './observability/ExecutionLogObserver'
import { normalizeShellSecurityLevel } from './security/ShellRiskClassifier'
import { ApiKeyService } from './provider/ApiKeyService'
import { ModelHealthService } from './provider/ModelHealthService'
import { ProviderCredentialService } from './provider/ProviderCredentialService'
import { SubagentService } from './subagent/SubagentService'
import { SubagentWorkspaceCoordinator } from './subagent/SubagentWorkspaceCoordinator'
import { AttachmentService } from './subagent/AttachmentService'
import { ArtifactService } from './storage/ArtifactService'
import { SpeechTranscriptionService } from './speech/SpeechTranscriptionService'
import { SqliteAttachmentCatalog } from './subagent/SqliteAttachmentCatalog'
import { LocalContextPathRepository } from './storage/repositories/LocalContextPathRepository'
import { LocalContextPathService } from './local-context/LocalContextPathService'
import { ProjectSourceService } from './project/ProjectSourceService'
import { ProjectService } from './project/ProjectService'
import { MemoryService } from './memory/MemoryService'
import { secretScrubber } from './security/SecretScrubber'
import { HookService } from './hooks/HookService'
import { z } from 'zod'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserService } from './browser/BrowserService'
import { browserToolDefinitions } from './tool/Browser/Definition'
import { MemoryManager } from './resource/MemoryManager'
import { GitReviewService } from './review/GitReviewService'
import { GithubService } from './github/GithubService'
import { PullRequestWatchService } from './github/PullRequestWatchService'
import { AutomationHostAuditRepository } from './automation/AutomationHostAuditRepository'
import { GitWorkspaceService } from './git/GitWorkspaceService'
import type { Models } from '@earendil-works/pi-ai'
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import { ManagedProjectlessWorkspaceService } from './workspace/ManagedProjectlessWorkspaceService'
import { ThreadWorkspaceResolver } from './workspace/ThreadWorkspaceResolver'
import { PetService } from './pet/PetService'
import { ReleaseNotesService } from './release-notes/ReleaseNotesService'
import { migrateLegacyAgentData, relocateAgentDataRoot } from './config/DataDirectoryMigration'
import { SkillManagementService } from './prompt/SkillManagementService'
import { SkillSettingsRepository } from './storage/repositories/SkillSettingsRepository'
import { PluginSettingsRepository } from './storage/repositories/PluginSettingsRepository'
import { PluginManagementService } from './plugin/PluginManagementService'
import { MiniMaxCliSettingsRepository } from './storage/repositories/MinimaxCliSettingsRepository'
import { MiniMaxCliIntegrationService } from './integration/minimax-cli/MiniMaxCliIntegrationService'
import { McpSettingsRepository } from './storage/repositories/McpSettingsRepository'
import { McpConfigService } from './mcp/McpConfigService'
import { McpElicitationService } from './mcp/McpElicitationService'
import { McpConnectionManager } from './mcp/McpConnectionManager'
import { McpRuntimeService } from './mcp/McpRuntimeService'
import { McpDiagnosticContextProvider } from './mcp/McpDiagnosticContextProvider'
import { McpClientFactory } from './mcp/McpClientFactory'
import { McpOAuthCredentialRepository } from './mcp/McpOAuthCredentialRepository'
import { McpOAuthCoordinator } from './mcp/McpOAuthCoordinator'
import { McpOAuthService } from './mcp/McpOAuthService'
import { ThreadProjection } from './transport/ThreadProjection'
import { TaskSuggestionService } from './suggestion/TaskSuggestionService'
import { ThreadTitleService } from './session/ThreadTitleService'
import { UsageService } from './usage/UsageService'
import { UsageRepository } from './storage/repositories/UsageRepository'
import { TurnPatchService } from './patch/TurnPatchService'
import { TerminalContextService } from './terminal/TerminalContextService'
import { TerminalOutputMirror } from './terminal/TerminalOutputMirror'
import { createTerminalReadDefinition } from './tool/TerminalRead/Definition'
import { GitCommandRunner } from './git/GitCommandRunner'
import {
  EnvironmentDeltaStore,
  FileProjectTrustStore,
  LocalEnvironmentDiscovery,
  LocalEnvironmentRunner,
  LocalEnvironmentService,
  LocalEnvironmentWorktreeLifecycle,
} from './local-environment'
import { WorktreeRepository } from './worktree/WorktreeRepository'
import { TaskExecutionBindingService } from './worktree/TaskExecutionBindingService'
import { ManagedWorktreeService } from './worktree/ManagedWorktreeService'
import { ThreadExecutionPreparationService } from './worktree/ThreadExecutionPreparationService'
import { SessionGroupService } from './session-group/SessionGroupService'
import { DEFAULT_GOAL_TOKEN_BUDGET, ThreadGoalService } from './session/ThreadGoalService'
import { ThreadBookmarkService } from './session/ThreadBookmarkService'
import { createAutomationDefinitions } from './tool/Automation/Definitions'
import { createSchedulePlanDefinition } from './tool/SchedulePlan/Definition'
import {
  AutomationRunCoordinator,
  AutomationScheduler,
  AutomationService,
  ThreadAutomationRunExecutor,
} from './automation'
import {
  CalendarService,
  SchedulePlanService,
  ScheduledTaskCoordinator,
  ScheduledTaskService,
} from './calendar'
import {
  probeAutomationStorageCapabilities,
  probeScheduleCalendarStorageCapabilities,
} from './storage/database/StorageCapabilities'
import { createThreadReadDefinition } from './tool/ThreadRead/Definition'
import { ThreadReadViewRepository } from './session/ThreadReadViewRepository'
import {
  BindingHandoffWorkspace,
  HandoffLifecycle,
  HandoffRepository,
  HandoffService,
  ThreadForkRepository,
} from './handoff'
import { ConversationHistoryForkRepository } from './session/fork/ConversationHistoryForkRepository'
import { ThreadForkWorkspaceService } from './session/fork/ThreadForkWorkspaceService'
import { ThreadMessageForkRepository } from './session/fork/ThreadMessageForkRepository'
import { ThreadMessageForkService } from './session/fork/ThreadMessageForkService'
import { SideChatService } from './session/side-chat/SideChatService'
import { SideChatEnvironmentCleanup } from './session/side-chat/SideChatEnvironmentCleanup'

registerBunOAuthFlows()

export interface BootstrapOptions {
  models?: Models
  initializeDatabase?: (db: AgentDatabase) => void
  onReviewGitCommand?: (args: readonly string[]) => void
}

export const createBootstrap = (options: BootstrapOptions = {}) =>
  Effect.gen(function* () {
    const config = yield* loadConfig
    if (config.relocationSourceDir && config.relocationOperationId) {
      yield* Effect.promise(() =>
        relocateAgentDataRoot({
          sourceDir: config.relocationSourceDir!,
          targetDir: config.dataDir,
          operationId: config.relocationOperationId!,
        }),
      )
    }
    yield* Effect.promise(() =>
      migrateLegacyAgentData({
        dataDir: config.dataDir,
        legacyDataDir: config.legacyDataDir,
        legacyPetsDir: config.legacyPetsDir,
      }),
    )
    const logger = new AgentLogger(config.logDir)
    const db = new AgentDatabase({
      historyPath: config.historyDatabasePath,
      profilePath: config.profileDatabasePath,
      legacyPath: config.legacyDatabasePath,
    })
    options.initializeDatabase?.(db)
    const configService = new ConfigService(
      config.storage.userConfig,
      {},
      new SqliteProjectTrustStore(db),
    )
    yield* Effect.promise(() => configService.initialize())
    yield* Effect.promise(() =>
      new ConfigMigrationService(
        configService,
        new ConfigMigrationRepository(db),
        config.legacyAppearanceSettingsPath,
        join(config.storage.toolingRoot, 'v2', 'settings.json'),
      ).run(),
    )
    const projectlessWorkspaces = new ManagedProjectlessWorkspaceService(config.documentsDir)
    const worktreeRepository = new WorktreeRepository(db.sqlite)
    const executionBindings = new TaskExecutionBindingService(worktreeRepository)
    const workspaceResolver = new ThreadWorkspaceResolver(
      db,
      projectlessWorkspaces,
      executionBindings,
    )
    const terminalContext = new TerminalContextService(workspaceResolver)
    const terminalOutput = new TerminalOutputMirror()
    const environmentDeltas = new EnvironmentDeltaStore(config.dataDir)
    const threadExecutions = new ThreadExecutionPreparationService(
      db,
      executionBindings,
      environmentDeltas,
    )
    const localEnvironmentRunner = new LocalEnvironmentRunner(environmentDeltas)
    const environmentRepository = new LocalEnvironmentRepository(db.sqlite)
    const environmentDiscovery = new LocalEnvironmentDiscovery(
        new GitCommandRunner({
          maxOutputBytes: 64 * 1024,
          timeoutMs: 20_000,
        }),
        (cwd) => {
          const frozen = environmentRepository.snapshotForCwd(cwd)
          if (frozen) return { filePath: frozen.snapshot_path, frozen: true, revision: frozen.revision, trustIdentity: frozen.trust_identity }
          const selected = environmentRepository.selectedForCwd(cwd)
          return selected ? { filePath: selected.config_path } : null
        },
      )
    const localEnvironment = new LocalEnvironmentService(
      environmentDiscovery,
      new FileProjectTrustStore(config.dataDir),
      localEnvironmentRunner,
      async (threadId) => {
        const context = await terminalContext.resolve(threadId)
        return {
          bindingId: context.bindingId,
          contextVersion: context.contextVersion,
          cwd: context.target.cwd,
          workspaceKind: context.workspaceKind,
        }
      },
      async (cwd) => {
        const snapshot = environmentRepository.snapshotForCwd(cwd)
        const root = snapshot ? db.getProject(snapshot.project_id)?.rootPath : cwd
        return root ? (await configService.trustRead(root)).trustLevel === 'trusted' : false
      },
    )
    if (environmentRepository.available()) localEnvironment.catalog = new LocalEnvironmentCatalog(localEnvironment, environmentDiscovery, environmentRepository,
      (projectId) => db.getProject(projectId)?.rootPath ?? null, join(config.dataDir, 'managed-worktree-state', 'environments'))
    const worktrees = yield* Effect.promise(() =>
      ManagedWorktreeService.open({
        repository: worktreeRepository,
        managedRoot: join(config.dataDir, 'managed-worktrees'),
        stateRoot: join(config.dataDir, 'managed-worktree-state'),
        settings: () => {
          const desktop = configService.snapshot().desktop as Record<string, unknown> | undefined
          return { root: typeof desktop?.worktreeRoot === 'string' ? desktop.worktreeRoot : '', fetchUpstream: desktop?.worktreeFetchUpstream === true }
        },
        resolveProjectRoot: (projectId) => db.getProject(projectId)?.rootPath ?? null,
        environment: new LocalEnvironmentWorktreeLifecycle(localEnvironment),
        autoDeletePolicy: () => {
          const desktop = configService.snapshot().desktop as Record<string, unknown> | undefined
          const rawLimit = desktop?.gitAutoDeleteWorktreeLimit
          return {
            enabled: desktop?.gitAutoDeleteWorktree !== false,
            limit:
              typeof rawLimit === 'number' && Number.isSafeInteger(rawLimit)
                ? Math.min(100, Math.max(1, rawLimit))
                : 15,
          }
        },
      }),
    )
    const hub = yield* EventHub.make
    const sessionGroups = new SessionGroupService(db, hub)
    queueMicrotask(() => {
      void sessionGroups.recoverMissingSteps()
    })
    const threadGoals = new ThreadGoalService(db, hub, () => {
      const agent = configService.snapshot().agent as Record<string, unknown> | undefined
      const goal = agent?.goal as Record<string, unknown> | undefined
      const budget = goal?.default_token_budget
      // Unknown or malformed configuration falls back to the documented default
      // instead of disabling the budget or throwing during startup.
      return typeof budget === 'number' && Number.isSafeInteger(budget) && budget > 0
        ? budget
        : DEFAULT_GOAL_TOKEN_BUDGET
    })
    const threadBookmarks = new ThreadBookmarkService(db, hub)
    const speech = new SpeechTranscriptionService(config.storage.speechRoot, async (status) => {
      await publishAgentEvent(db, hub, null, null, 'speech/statusChanged', { status })
    })
    yield* Effect.promise(() => speech.initialize())
    const turnPatches = new TurnPatchService(
      db,
      hub,
      async (threadID) => (await workspaceResolver.resolve(threadID)).workspace,
    )
    const unsubscribeConfig = configService.subscribe(async (event) => {
      await publishAgentEvent(db, hub, null, null, 'config/updated', {
        version: event.version,
        changedKeyPaths: event.changedKeyPaths,
        scope: event.scope,
        diagnostics: event.diagnostics.map(({ severity, code, message }) => ({
          severity,
          code,
          message,
        })),
        ...(event.profileState ? { profileState: event.profileState } : {}),
      })
    })
    const executionLogs = new ExecutionLogObserver(logger)
    const harnessLogs = new HarnessLogObserver(logger)
    const unsubscribeExecutionLogs = hub.listen((signal) => {
      executionLogs.observeSignal(signal)
      if (
        signal.event.turnId &&
        ['turn/completed', 'turn/failed', 'turn/interrupted'].includes(signal.event.method)
      ) {
        harnessLogs.finishTurn(signal.event.turnId)
      }
    })
    const desktopSettings = configService.snapshot().desktop as Record<string, unknown> | undefined
    const configuredTooling =
      desktopSettings?.tooling &&
      typeof desktopSettings.tooling === 'object' &&
      !Array.isArray(desktopSettings.tooling)
        ? (desktopSettings.tooling as Record<string, unknown>)
        : {}
    const configuredToolingPreferences = Object.fromEntries(
      ['nodejs', 'python', 'git-bash', 'ripgrep'].flatMap((id) => {
        const preference = configuredTooling[id]
        return preference === 'managed' || preference === 'system' ? [[id, preference]] : []
      }),
    )
    const legacyToolingPreference =
      desktopSettings?.workspaceDependenciesMigrated === true
        ? undefined
        : typeof desktopSettings?.installPidexDependencies === 'boolean'
          ? desktopSettings.installPidexDependencies
          : undefined
    const toolingPreferences =
      Object.keys(configuredToolingPreferences).length > 0
        ? configuredToolingPreferences
        : legacyToolingPreference === undefined
          ? {}
          : {
              nodejs: legacyToolingPreference ? 'managed' : 'system',
              python: legacyToolingPreference ? 'managed' : 'system',
            }
    const tooling = getToolingManager(
      legacyToolingPreference === undefined
        ? {
            root: config.storage.toolingRoot,
            preferences: toolingPreferences,
            persistPreferences: false,
          }
        : {
            root: config.storage.toolingRoot,
            legacyInstallPidexDependencies: legacyToolingPreference,
            preferences: toolingPreferences,
            persistPreferences: false,
          },
    )
    const pets = new PetService(config.petsDir)
    const plugins = new PluginManagementService(new PluginSettingsRepository(db), {
      builtinPluginsRoot: config.builtinPluginsRoot,
      userHome: homedir(),
    })
    plugins.initializeComputerUse(
      (
        configService.snapshotLayers().find((layer) => layer.kind === 'user')?.config.desktop as
          Record<string, unknown> | undefined
      )?.computerUseEnabled === true,
    )
    yield* Effect.promise(() => plugins.list())
    const unsubscribePlugins = plugins.subscribe((_pluginId, generation) => {
      void publishAgentEvent(db, hub, null, null, 'plugins/updated', { generation }).catch(() =>
        logger.warn('plugins.status.publish.failed', { error: 'PLUGIN_STATUS_PUBLISH_FAILED' }),
      )
    })
    let minimaxCli: MiniMaxCliIntegrationService
    const skills = new SkillManagementService(
      new SkillSettingsRepository(db),
      {
        dataRoot: config.dataDir,
        userHome: homedir(),
        builtinSkillsRoot: config.builtinSkillsRoot,
      },
      configService,
      async (workspace?: string) => [
        ...(await plugins.enabledSkillRoots(workspace)),
        ...((await minimaxCli?.enabledSkillRoots()) ?? []),
      ],
    )
    const unsubscribeTooling = tooling.subscribe((status) => {
      void publishAgentEvent(db, hub, null, null, 'tooling/updated', { status }).catch((cause) =>
        logger.warn('tooling.status.publish.failed', {
          id: status.id,
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      )
    })
    void tooling.refreshStatuses().catch(() =>
      logger.warn('tooling.status.warmup.failed', {
        error: 'TOOLING_WARMUP_FAILED',
      }),
    )
    const credentials = new EncryptedCredentialRepository(db)
    yield* credentials.validateAll()
    yield* credentials.backfillApiKeyMetadata()
    const providerCredentialStore = new ProviderCredentialStoreManager(
      db,
      credentials,
      new AuthJsonCredentialRepository(join(config.dataDir, 'auth.json')),
      {
        read: () => {
          const value = configService.snapshot().provider_credentials
          if (!value || typeof value !== 'object' || Array.isArray(value)) return null
          const store = (value as Record<string, unknown>).store
          return store === 'auth-json' || store === 'encrypted' ? store : null
        },
        write: async (store) => {
          await configService.batchWrite({
            edits: [
              {
                keyPath: ['provider_credentials', 'store'],
                value: store,
              },
            ],
          })
        },
      },
    )
    yield* providerCredentialStore.initialize()
    minimaxCli = new MiniMaxCliIntegrationService(
      new MiniMaxCliSettingsRepository(db),
      providerCredentialStore,
      {
        userHome: homedir(),
        integrationRoot: join(config.builtinIntegrationsRoot, 'minimax-cli'),
      },
    )
    const unsubscribeMiniMaxCli = minimaxCli.subscribe((status) => {
      void publishAgentEvent(db, hub, null, null, 'minimaxCli/updated', { status }).catch(() =>
        logger.warn('minimax-cli.status.publish.failed', {
          error: 'MINIMAX_CLI_STATUS_PUBLISH_FAILED',
        }),
      )
    })
    void minimaxCli.status().catch(() =>
      logger.warn('minimax-cli.status.warmup.failed', {
        error: 'MINIMAX_CLI_STATUS_WARMUP_FAILED',
      }),
    )
    const github = new GithubService(credentials, {
      getConfiguredClientId: () => config.githubOAuthClientId,
      getBrokerURL: () => config.githubAuthBrokerURL,
      getCallbackURL: () =>
        config.port > 0 ? `http://127.0.0.1:${config.port}/auth/github/callback` : null,
    })
    const releaseNotes = new ReleaseNotesService({
      getAccessToken: () => github.optionalAccessToken(),
    })
    const review = new GitReviewService(
      db,
      async (projectId) => {
        await publishAgentEvent(db, hub, null, null, 'workspace/git/changed', {
          projectId,
          changedAt: Date.now(),
        })
      },
      (input) => github.preparedPullRequestComparison(input),
      options.onReviewGitCommand,
      logger,
    )
    const memoryManager = new MemoryManager({ logger })
    memoryManager.registerHook('sqlite', () => db.shrinkMemory())
    memoryManager.registerHook('git_review', () => review.shrink())
    const git = new GitWorkspaceService(db)
    const piModels = new PiModelService(providerCredentialStore, {
      ...(options.models ? { models: options.models } : {}),
      modelsStore: new PiModelsFileStore(config.piModelCachePath),
      config: () => {
        const snapshot = configService.snapshot()
        const modelCatalog = snapshot.model_catalog as Record<string, unknown> | undefined
        const schemaVersion =
          typeof modelCatalog?.schema_version === 'number' ? modelCatalog.schema_version : undefined
        return {
          ...(schemaVersion !== undefined ? { schemaVersion } : {}),
          providers: (snapshot.model_providers as Record<string, unknown> | undefined) ?? {},
        }
      },
    })
    const providers = piModels
    const modelHealth = new ModelHealthService(piModels, async (payload) => {
      await publishAgentEvent(db, hub, null, null, 'model/health/updated', payload)
    })
    const apiKeys = new ApiKeyService(piModels, providerCredentialStore, modelHealth)
    const providerCredentials = new ProviderCredentialService(piModels, providerCredentialStore)
    const anthropicUsageModels = builtinModels({
      credentials: new EncryptedCredentialStore(credentials, {
        integrationID: () => 'usage.anthropic.subscription',
        providerID: (integrationID) =>
          integrationID === 'usage.anthropic.subscription' ? 'anthropic' : undefined,
        oauthMethodID: () => 'anthropic:oauth',
      }),
      authContext: {
        env: async () => undefined,
        fileExists: async () => false,
      },
    })
    const authSessions = new PiAuthSessionService({
      getDeviceId: () => db.getProviderAuthDeviceId(),
      resolveTarget: (target) => {
        if (target.kind === 'usage') {
          if (
            target.sourceId !== 'anthropic-subscription' &&
            target.sourceId !== 'usage.anthropic.subscription'
          ) {
            throw new Error(`Usage OAuth source ${target.sourceId} 尚未配置`)
          }
          return { models: anthropicUsageModels, providerID: 'anthropic' }
        }
        return { models: piModels.pi, providerID: target.providerId }
      },
      onUpdated: async (session) => {
        await publishAgentEvent(db, hub, null, null, 'auth/session/updated', { session })
      },
      onCompleted: async (target) => {
        if (target.kind === 'provider') {
          await providers.reload()
          await publishAgentEvent(db, hub, null, null, 'provider/credential/updated', {
            providerId: target.providerId,
          })
        } else {
          await publishAgentEvent(db, hub, null, null, 'usage/source/updated', {
            sourceId: 'anthropic-subscription',
            changedAt: Date.now(),
          })
        }
      },
    })
    yield* Effect.promise(async () => {
      await providers.models()
      await providers.reload()
    })
    const browser = new BrowserService(db, hub, configService)
    const tools = new ToolRegistry()
    const computer = new ComputerUseService(configService, db, hub, plugins)
    yield* Effect.promise(() => computer.initialize())
    for (const definition of computerToolDefinitions(computer)) tools.register(definition)
    if (browser.available())
      for (const definition of browserToolDefinitions(browser)) tools.register(definition)
    tools.register(createTerminalReadDefinition(terminalOutput))
    tools.register(createThreadReadDefinition(new ThreadReadViewRepository(db)))
    const mcpConfigs = new McpConfigService(new McpSettingsRepository(db), configService)
    const usage = new UsageService(new UsageRepository(db), providers, piModels, credentials, {
      subscriptionModels: anthropicUsageModels,
      providerCredentials: providerCredentialStore,
    })
    const mcpOAuthCoordinator = new McpOAuthCoordinator(
      new McpOAuthCredentialRepository(credentials),
      `http://127.0.0.1:${config.port}/auth/mcp/callback`,
    )
    const mcpElicitations = new McpElicitationService(db, hub)
    yield* Effect.promise(() => mcpElicitations.restore())
    const mcpConnections = new McpConnectionManager(
      mcpConfigs,
      tools,
      new McpClientFactory(
        mcpOAuthCoordinator,
        (connectionId, server, tool, identity, params, signal) =>
          mcpElicitations.request(connectionId, server, tool, identity, params, signal),
      ),
      async (generation) => {
        await publishAgentEvent(db, hub, null, null, 'mcp/updated', {
          generation,
        })
      },
      new McpDiagnosticContextProvider(new ThreadProjection(db)),
      mcpOAuthCoordinator,
    )
    const mcpOAuth = new McpOAuthService(mcpConfigs, mcpConnections, mcpOAuthCoordinator)
    const mcp = new McpRuntimeService(mcpConfigs, mcpConnections, mcpOAuth)
    const reviewer = new ReviewerService(db, piModels, configService)
    const approvals = new ApprovalService(
      db,
      hub,
      tools,
      (invocation, signal) => reviewer.review(invocation, signal),
      configService,
      browser,
    )
    let toolExecutor!: ToolExecutor
    const hostToolAudit = new AutomationHostAuditRepository(db.sqlite)
    const hostTurnInputs = new Map<string, Pick<NonNullable<ReturnType<AgentDatabase['getTurnInput']>>, 'taskMode' | 'permissionConfig' | 'model'>>()
    const hooks = new HookService(
      db,
      {
        run: async (input) => {
          if (!input.threadID || !input.turnID)
            throw new Error('Hook command 缺少 thread/turn 上下文')
          const turn = db.getTurnInput(input.turnID) ?? hostTurnInputs.get(input.turnID)
          if (!turn) throw new Error('Hook command 无法解析权限快照')
          const runtime = await workspaceResolver.resolve(input.threadID)
          const workspace = runtime.workspace
          const evidenceDir = await mkdtemp(join(tmpdir(), 'pidex-hook-evidence-'))
          const evidencePath = join(evidenceDir, 'evidence.json')
          await writeFile(evidencePath, input.evidence, 'utf8')
          const quotedEvidencePath = evidencePath.replaceAll("'", "''")
          try {
            const result = await toolExecutor.execute<{
              stdout: string
              stderr: string
            }>(
              'PowerShell',
              {
                command: `Get-Content -Raw -LiteralPath '${quotedEvidencePath}' | & { ${input.command} }`,
                timeout: input.timeoutMs,
                description: `执行 Hook ${input.hookID}`,
              },
              {
                threadID: input.threadID,
                turnID: input.turnID,
                taskMode: turn.taskMode,
                signal: new AbortController().signal,
                workspace,
                defaultCwd: runtime.cwd,
                permissionConfig: turn.permissionConfig,
                model: turn.model,
                taskSummary: `Hook ${input.hookID}`,
                skipHooks: true,
              },
            )
            return {
              output: `${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`.trim(),
            }
          } finally {
            await rm(evidenceDir, { recursive: true, force: true }).catch(() => undefined)
          }
        },
      },
      (value) => secretScrubber.scrubText(value),
      async (event) => {
        await Effect.runPromise(hub.publish(event))
      },
      configService,
    )
    toolExecutor = new ToolExecutor(tools, {
      dataDir: config.dataDir,
      userConfigPath: config.storage.userConfig,
      validateConfigDocument: (text, scope) => configService.validateDocument(text, scope),
      resolveTooling: (id, resolveOptions) => tooling.resolve(id, resolveOptions),
      resolveToolingEnvironment: (required, resolveOptions) =>
        tooling.resolveEnvironment(required, resolveOptions),
      resolveMiniMaxCliPathEntries: () => minimaxCli.shellPathEntries(),
      resolveShellSecurityLevel: () =>
        normalizeShellSecurityLevel(configService.snapshot().shell_security_level),
      authorizeShell: (invocation, signal) => approvals.authorize(invocation, signal),
      recordToolCall: (invocation, status, output, error, startedAt) =>
        hostTurnInputs.has(invocation.turnID) ? hostToolAudit.record(invocation, status, output, error, startedAt) : db.upsertToolCall(invocation, status, output, error, startedAt),
      completedToolCall: (toolCallID) => db.completedToolCall(toolCallID) ?? hostToolAudit.completed(toolCallID),
      logger,
      hooks,
      fileSaved: ({ workspaceRoot, filePath }) =>
        configService.notifyFileSaved(workspaceRoot, filePath),
      recordMutation: (batch) => Promise.resolve(hostTurnInputs.has(batch.turnID) ? hostToolAudit.recordMutation(batch) : db.repositories.turnPatches.recordBatch(batch)),
      discardMutationEvidence: async ({ threadID, turnID }) => {
        if (hostTurnInputs.has(turnID)) { hostToolAudit.discardMutationEvidence(turnID); return }
        const events = db.repositories.turnPatches.markIncomplete(threadID, turnID)
        for (const event of events) await Effect.runPromise(hub.publish(event))
      },
    })
    const questions = new QuestionService(db, hub, false)
    const artifacts = yield* Effect.promise(() => ArtifactService.open(config.dataDir, db))
    const orchestrator = new AgentRuntimeService({
      db,
      hub,
      models: piModels.pi,
      toolExecutor,
      contextCompaction: new ContextCompactionService(db),
      artifacts,
      memoryManager,
      observeHarnessEvent: (context, event) =>
        harnessLogs.observe(
          {
            threadId: context.threadID,
            turnId: context.turnID,
            agentId: context.agentID,
          },
          event,
        ),
    })
    const attachments = yield* Effect.promise(() =>
      AttachmentService.open(config.dataDir, {
        catalog: new SqliteAttachmentCatalog(db),
      }),
    )
    const projectSources = yield* Effect.promise(() =>
      ProjectSourceService.open(config.dataDir, db),
    )
    yield* Effect.promise(() => new ProjectService(db, projectSources).recoverPendingRemovals())
    const memory = new MemoryService(db, {
      enabled: () =>
        (configService.snapshot().features as Record<string, unknown> | undefined)?.memory ===
          true ||
        (configService.snapshot().desktop as Record<string, unknown> | undefined)?.enableMemory ===
          true,
      scrub: (value) => secretScrubber.scrubText(value),
      extractor: {
        extract: async ({ transcript, projectKey, signal }) => {
          const projectId = projectKey?.startsWith('project:')
            ? projectKey.slice('project:'.length)
            : undefined
          const selected = await resolveSpecializedPiModel({
            purpose: 'organization',
            db,
            models: piModels,
            configService,
            ...(projectId ? { projectId } : {}),
          })
          if (!selected) return []
          const object = await generatePiObject({
            models: piModels.pi,
            model: selected.model,
            ...(signal ? { signal } : {}),
            schema: z.object({
              memories: z
                .array(
                  z.object({
                    scope: z.enum(['user', 'project']),
                    content: z.string().min(1).max(2_000),
                  }),
                )
                .max(10),
            }),
            schemaName: 'local_memory_extraction',
            system:
              '从对话中只提炼长期稳定、未来有用的偏好或项目事实。不要保存凭据、临时错误、完整对话或大段源码。无法确定时返回空数组。',
            prompt: `<untrusted_transcript project=${JSON.stringify(projectKey)}>${transcript}</untrusted_transcript>`,
          })
          return object.memories
        },
      },
    })
    const suggestions = new TaskSuggestionService(db, piModels, memory, logger, {}, configService)
    const sideChatEnvironmentCleanup = new SideChatEnvironmentCleanup(
      db.repositories.sideChats,
      environmentDeltas,
    )
    const localContextPaths = new LocalContextPathService(new LocalContextPathRepository(db))
    const history = new ThreadHistoryService(db, hub, (threadID) => {
      return sideChatEnvironmentCleanup.prepareSource(
        threadID,
        review.prepareThreadSnapshotCleanup(threadID),
      )
    })
    const threadTitles = new ThreadTitleService(db, history, piModels, logger, configService)
    const subagentWorkspaces = new SubagentWorkspaceCoordinator(db, config.storage.workspacesRoot)
    const resumeCheckpoints = new ResumeCheckpointResolver(db, approvals)
    const subagents = new SubagentService(
      db,
      hub,
      providers,
      approvals,
      questions,
      orchestrator,
      attachments,
      subagentWorkspaces,
      {
        dataRoot: config.dataDir,
        userHome: homedir(),
      },
      memory,
      skills,
      mcpConnections,
      projectSources,
      resumeCheckpoints,
      false,
      localContextPaths,
    )
    resumeCheckpoints.setResolvedSubagentWait((turnID) => subagents.resolvedWaitCheckpoint(turnID))
    const threads = new ThreadService(
      db,
      hub,
      providers,
      approvals,
      questions,
      orchestrator,
      subagents,
      attachments,
      {
        dataRoot: config.dataDir,
        userHome: homedir(),
      },
      memory,
      hooks,
      workspaceResolver,
      review,
      skills,
      mcpConnections,
      configService,
      projectSources,
      threadTitles,
      resumeCheckpoints,
      false,
      localContextPaths,
      sessionGroups,
      threadGoals,
      computer,
      plugins,
    )
    const automationStorage = probeAutomationStorageCapabilities(db.sqlite)
    const planApprovals = new PlanApprovalService(
      db,
      hub,
      threads,
      new ThreadForkWorkspaceService(
        workspaceResolver,
        executionBindings,
        worktreeRepository,
        environmentDeltas,
      ),
    )
    const automationEnabled = automationStorage.automations && automationStorage.automationRuns
    const calendarStorage = probeScheduleCalendarStorageCapabilities(db.sqlite)
    const calendarEnabled =
      automationEnabled && calendarStorage.scheduledTasks && calendarStorage.schedulePlanProposals
    const automationRepository = db.repositories.automations
    const scheduledTaskRepository = db.repositories.scheduledTasks
    const automationExecutor = new ThreadAutomationRunExecutor(
      automationRepository,
      threads,
      worktrees,
      threadExecutions,
    )
    let prWatches!: PullRequestWatchService
    const automationRuns = new AutomationRunCoordinator(automationRepository, { start: (work, run) => prWatches.run(work, run) }, {
      getTurnStatus: (turnId) => {
        const status = db.repositories.executions.getTurnStatus(turnId)
        if (status === 'completed' || status === 'failed' || status === 'interrupted') return status
        if (status === 'queued' || status === 'running') return status
        return status ? 'waiting' : null
      },
      runChanged: async (run) => {
        await prWatches?.onRunChanged(run)
        await publishAgentEvent(db, hub, null, run.turnId, 'automation/runChanged', {
          automationId: run.automationId,
          runId: run.id,
          status: run.status,
          changedAt: Date.now(),
        })
      },
    })
    const scheduledTaskRuns = new ScheduledTaskCoordinator(
      scheduledTaskRepository,
      automationExecutor,
      {
        getTurnStatus: (turnId) => {
          const status = db.repositories.executions.getTurnStatus(turnId)
          if (status === 'completed' || status === 'failed' || status === 'interrupted')
            return status
          if (status === 'queued' || status === 'running') return status
          return status ? 'waiting' : null
        },
        taskChanged: (task) =>
          publishAgentEvent(db, hub, null, task.turnId, 'scheduled-task/changed', {
            scheduledTaskId: task.id,
            revision: task.revision,
            status: task.status,
            changedAt: Date.now(),
          }).then(() => undefined),
      },
    )
    let automationScheduler: AutomationScheduler | null = null
    const automation = new AutomationService(automationRepository, {
      changed: (value) =>
        publishAgentEvent(db, hub, null, null, 'automation/changed', {
          automationId: value.id,
          revision: value.revision,
          status: value.status,
          changedAt: Date.now(),
        }).then(() => undefined),
      claimed: (run) => automationRuns.startRun(run),
      wakeScheduler: () => automationScheduler?.wake(),
    })
    prWatches = new PullRequestWatchService({ sqlite: db.sqlite, github, automation, repository: automationRepository, worktrees, executions: threadExecutions, threads, executor: automationExecutor,
      projectRoot: (id) => db.getProject(id)?.rootPath ?? null,
      preferences: () => { const desktop = configService.snapshot().desktop as Record<string, unknown> | undefined; return { autoMerge: desktop?.prWatchAutoMerge === true, instructions: typeof desktop?.prWatchInstructions === 'string' ? desktop.prWatchInstructions : '', mergeMethod: desktop?.gitPrMergeMethod === 'squash' ? 'squash' : 'merge' } },
      execute: async (name, input, watch, work, runId) => {
        const runtime = await workspaceResolver.resolve(watch.thread_id)
        const turnID = `automation-host:${runId}`
        hostTurnInputs.set(turnID, { taskMode: 'chat', permissionConfig: work.permissionConfig, model: work.model })
        try { return await toolExecutor.execute(name, input, { threadID: watch.thread_id, turnID, taskMode: 'chat', signal: AbortSignal.timeout(120_000), workspace: runtime.workspace, defaultCwd: runtime.cwd, permissionConfig: work.permissionConfig, model: work.model, taskSummary: 'PR 监控宿主操作' }) }
        finally { hostTurnInputs.delete(turnID) }
      },
    })
    for (const definition of prWatches.definitions()) tools.register(definition)
    const scheduledTasks = new ScheduledTaskService(scheduledTaskRepository, automationRepository, {
      claimed: (task) => scheduledTaskRuns.startTask(task),
      wakeScheduler: () => automationScheduler?.wake(),
      changed: (task) =>
        publishAgentEvent(db, hub, null, task.turnId, 'scheduled-task/changed', {
          scheduledTaskId: task.id,
          revision: task.revision,
          status: task.status,
          changedAt: Date.now(),
        }).then(() => undefined),
    })
    const calendar = new CalendarService(automationRepository, scheduledTaskRepository)
    const schedulePlans = new SchedulePlanService(
      db,
      db.repositories.schedulePlanProposals,
      scheduledTaskRepository,
      automationRepository,
      {
        wakeScheduler: () => automationScheduler?.wake(),
        automationChanged: (value) =>
          publishAgentEvent(db, hub, null, null, 'automation/changed', {
            automationId: value.id,
            revision: value.revision,
            status: value.status,
            changedAt: Date.now(),
          }).then(() => undefined),
        scheduledTaskChanged: (task) =>
          publishAgentEvent(db, hub, null, task.turnId, 'scheduled-task/changed', {
            scheduledTaskId: task.id,
            revision: task.revision,
            status: task.status,
            changedAt: Date.now(),
          }).then(() => undefined),
        proposalChanged: (proposal) =>
          publishAgentEvent(db, hub, null, proposal.turnId, 'schedule-plan/changed', {
            proposalId: proposal.id,
            revision: proposal.revision,
            status: proposal.status,
            changedAt: Date.now(),
          }).then(() => undefined),
      },
    )
    automationScheduler = new AutomationScheduler(automationRepository, {
      onClaimed: (runs) => automationRuns.startRuns(runs),
      ...(calendarEnabled
        ? {
            scheduledTasks: {
              repository: scheduledTaskRepository,
              onClaimed: (tasks) => scheduledTaskRuns.startTasks(tasks),
            },
          }
        : {}),
      onError: () => undefined,
    })
    if (automationEnabled) {
      for (const definition of createAutomationDefinitions(automation)) tools.register(definition)
    }
    if (calendarEnabled) {
      tools.register(
        createSchedulePlanDefinition(
          schedulePlans,
          (threadId) => db.threadProjectID(threadId) ?? null,
        ),
      )
    }
    const unsubscribeAutomationEvents = hub.listen((signal) => {
      if (!automationEnabled || signal.kind !== 'durable' || !signal.event.turnId) return
      if (signal.event.method === 'turn/started')
        void automationRuns.handleTurnRunning(signal.event.turnId)
      else if (signal.event.method === 'turn/completed')
        void automationRuns.handleTurnTerminal(signal.event.turnId, 'completed')
      else if (signal.event.method === 'turn/failed')
        void automationRuns.handleTurnTerminal(signal.event.turnId, 'failed', 'TURN_FAILED')
      else if (signal.event.method === 'turn/interrupted')
        void automationRuns.handleTurnTerminal(
          signal.event.turnId,
          'interrupted',
          'TURN_INTERRUPTED',
        )
      if (!calendarEnabled) return
      if (signal.event.method === 'turn/started')
        void scheduledTaskRuns.handleTurnRunning(signal.event.turnId)
      else if (signal.event.method === 'turn/completed')
        void scheduledTaskRuns.handleTurnTerminal(signal.event.turnId, 'completed')
      else if (signal.event.method === 'turn/failed')
        void scheduledTaskRuns.handleTurnTerminal(signal.event.turnId, 'failed', 'TURN_FAILED')
      else if (signal.event.method === 'turn/interrupted')
        void scheduledTaskRuns.handleTurnTerminal(
          signal.event.turnId,
          'interrupted',
          'TURN_INTERRUPTED',
        )
    })
    const handoffOperations = new HandoffRepository(db)
    const handoff = new HandoffService(
      handoffOperations,
      new ThreadForkRepository(db),
      new BindingHandoffWorkspace(
        db,
        workspaceResolver,
        executionBindings,
        worktreeRepository,
        handoffOperations,
        environmentDeltas,
      ),
      new HandoffLifecycle(
        db,
        threads,
        async (threadId) => terminalOutput.read({ threadId }) === null,
      ),
    )
    const threadForkOperations = new ThreadMessageForkRepository(db)
    const threadFork = new ThreadMessageForkService(
      threadForkOperations,
      new ConversationHistoryForkRepository(db),
      new ThreadForkWorkspaceService(
        workspaceResolver,
        executionBindings,
        worktreeRepository,
        environmentDeltas,
      ),
      worktrees,
      worktreeRepository,
    )
    const sideChats = new SideChatService(
      db.repositories.sideChats,
      new ConversationHistoryForkRepository(db),
      new ThreadForkWorkspaceService(
        workspaceResolver,
        executionBindings,
        worktreeRepository,
        environmentDeltas,
      ),
      threads,
      executionBindings,
      (threadID) => review.prepareThreadSnapshotCleanup(threadID),
    )
    const startupRecovery = new StartupRecoveryCoordinator({
      recoverInterruptedRuns: () => new InterruptedRunRecoveryCoordinator(db).run(),
      discardRecoveredSideChats: () => sideChats.discardAll(),
      recoverResumeLeases: () => {
        resumeCheckpoints.recoverInterruptedLeases()
      },
      restoreQuestionTimers: () => questions.restoreAutoResolutions(),
      recoverSubagents: () => subagents.recoverStartup(),
      recoverHandoffs: async () => {
        for (const operationId of handoffOperations.runningOperationIDs())
          await handoff.recover(operationId)
        for (const operationId of handoffOperations.pendingFinalizationIDs()) {
          const operation = handoffOperations.get(operationId)
          await handoff.acknowledgeClientTransfer(operationId, operation.revision)
        }
      },
      recoverForks: async () => {
        for (const operationId of threadForkOperations.runningOperationIDs())
          await threadFork.recover(operationId)
      },
      recoverThreadWorktrees: async () => {
        await recoverThreadWorktreeOperations({
          database: db.repositories.threadWorktreeOperations,
          deleteWorktree: (input) => worktrees.delete(input),
        })
      },
      recoverAutomations: async () => {
        if (automationEnabled) await automationRuns.recover()
        if (calendarEnabled) await scheduledTaskRuns.recover()
      },
      startQueues: () => {
        threads.startRecoveredQueues()
        if (automationEnabled) automationScheduler?.start()
      },
    })
    yield* Effect.promise(() => startupRecovery.run())
    let disposed = false
    const app = createApp({
      mcpElicitations,
      config,
      configService,
      db,
      hub,
      threads,
      planApprovals,
      history,
      approvals,
      questions,
      subagents,
      attachments,
      artifacts,
      localContextPaths,
      projectSources,
      providers,
      piModels,
      apiKeys,
      modelHealth,
      providerCredentials,
      providerCredentialStore,
      authSessions,
      memory,
      hooks,
      logger,
      review,
      github,
      prWatches,
      git,
      tooling,
      pets,
      releaseNotes,
      skills,
      plugins,
      minimaxCli,
      mcp,
      suggestions,
      usage,
      turnPatches,
      computer,
      browser,
      terminalContext,
      terminalOutput,
      localEnvironment,
      worktrees,
      handoff,
      threadFork,
      sideChats,
      executionBindings,
      worktreeRepository,
      environmentDeltas,
      speech,
      threadExecutions,
      sessionGroups,
      threadGoals,
      threadBookmarks,
      automation,
      calendar,
      scheduledTasks,
      schedulePlans,
      memoryManager,
    })
    const initialCatalogRevision = providers.catalogRevision?.() ?? 0
    void providers
      .refresh(false)
      .catch(() => undefined)
      .then(async () => {
        const nextCatalogRevision = providers.catalogRevision?.() ?? 0
        if (disposed || nextCatalogRevision === initialCatalogRevision) return
        await publishAgentEvent(db, hub, null, null, 'catalog/updated', {
          catalogVersion: Math.max(1, nextCatalogRevision),
        })
      })
      .catch(() => undefined)
    const dispose = async () => {
      if (disposed) return
      disposed = true
      computer.dispose()
      unsubscribePlugins()
      browser.dispose()
      await speech.dispose()
      automationScheduler?.dispose()
      unsubscribeAutomationEvents()
      unsubscribeExecutionLogs()
      unsubscribeTooling()
      unsubscribeMiniMaxCli()
      unsubscribeConfig()
      await sideChats.discardAll(true)
      await orchestrator.dispose()
      memoryManager.dispose()
      await configService.dispose()
      await mcpConnections.dispose()
      // Stop background model-health workers before tearing down the provider,
      // so no batch keeps publishing events after the database is closing.
      await modelHealth.dispose()
      await providers.dispose()
    }
    return { config, db, app, logger, providers, dispose }
  })

export const bootstrap = createBootstrap()
