import type { RpcMethod } from '@pidex/agent-protocol'
import { Provider } from '@pidex/model-schema'
import {
  PiProviderConfigValidationError,
  serializePiProviderDefinition,
} from '../../../provider/pi'
import type { PiProviderDefinitionInput } from '../../../provider/pi'
import type { ModelHealthFailureCategory } from '../../../provider/ModelHealthService'
import type { RpcRouter } from '../RpcRouter'
import type { RpcRouterContext } from '../RequestContext'
import { optionalRpcRecord as optionalRecord } from '../Decoders'
import { AgentError, booleanParam, modelRefOrNull, stringParam } from '../RpcRouter'
import type { RpcHandlerGroup } from './Types'

const providerMethods = [
  'provider/list',
  'model/list',
  'model/refresh',
  'model/setDefault',
  'model/setReviewer',
  'provider/test',
  'model/health/preview',
  'model/health/start',
  'model/health/read',
  'model/health/cancel',
  'provider/create',
  'provider/update',
  'provider/delete',
  'provider/model/discover',
  'provider/credential/list',
  'provider/credential/setActive',
  'provider/credential/setEnabled',
  'provider/credential/delete',
  'provider/credential/store/read',
  'provider/credential/store/update',
  'provider/apiKey/create',
  'provider/apiKey/update',
  'provider/apiKey/reorder',
  'provider/apiKey/test',
  'auth/session/start',
  'auth/session/respond',
  'auth/session/status',
  'auth/session/cancel',
] as const

const object = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentError('INVALID_REQUEST', `${name} 参数无效`, 400)
  }
  return value as Record<string, unknown>
}

const stringArray = (value: unknown, name: string): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new AgentError('INVALID_REQUEST', `${name} 参数无效`, 400)
  }
  return value as string[]
}

const recentNewThreadModel = (
  snapshot: Record<string, unknown>,
): { providerID: string; id: string; variant?: string } | null => {
  const desktop = snapshot.desktop
  if (!desktop || typeof desktop !== 'object' || Array.isArray(desktop)) return null
  const recent = (desktop as Record<string, unknown>).recent_new_thread_model
  if (!recent || typeof recent !== 'object' || Array.isArray(recent)) return null
  const record = recent as Record<string, unknown>
  const providerID = typeof record.providerID === 'string' ? record.providerID : ''
  const id = typeof record.id === 'string' ? record.id : ''
  if (!providerID || !id) return null
  return {
    providerID,
    id,
    ...(typeof record.variant === 'string' && record.variant ? { variant: record.variant } : {}),
  }
}

const emitCredentialUpdated = async (runtime: RpcRouter, providerID: string) => {
  await runtime.emit('provider/credential/updated', { providerId: providerID })
  await runtime.dependencies.minimaxCli.credentialChanged(providerID)
}

const assertCredentialProviderAvailable = async (
  providers: RpcRouter['dependencies']['providers'],
  providerID: string,
) => {
  const provider = (await providers.list()).find((candidate) => String(candidate.id) === providerID)
  if (!provider) {
    throw new AgentError('PROVIDER_NOT_FOUND', `Provider ${providerID} 不存在`, 404)
  }
  if (provider.availability?.status === 'unavailable') {
    throw new AgentError('PROVIDER_UNAVAILABLE', `Provider ${providerID} 协议暂未适配`, 400)
  }
}

// The legacy provider/test wire contract only exposes the old category set;
// timeout/provider are mapped to unknown while keeping a safe, specific message.
const legacyTestCategory = (
  category: ModelHealthFailureCategory,
): 'authentication' | 'configuration' | 'network' | 'rate-limit' | 'unknown' =>
  category === 'timeout' || category === 'provider' ? 'unknown' : category

export const providerHandlers = {
  name: 'provider',
  methods: providerMethods,
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ): Promise<unknown> {
    const {
      config,
      providers,
      piModels,
      apiKeys,
      providerCredentials,
      providerCredentialStore,
      authSessions,
      modelHealth,
    } = runtime.dependencies
    const params = optionalRecord(rawParams)
    switch (method) {
      case 'provider/list': {
        const [result, definitions, issues] = await Promise.all([
          runtime.providerList(),
          piModels.providerDefinitions(),
          piModels.configIssues(),
        ])
        const definitionsByID = new Map(
          definitions.map((definition) => [definition.id, definition]),
        )
        return {
          ...result,
          providers: await Promise.all(
            result.providers.map(async (provider) => {
              const configured = definitionsByID.get(String(provider.id))
              if (!configured && provider.source.kind === 'custom') {
                throw new AgentError('INTERNAL_ERROR', '自定义 Provider 缺少可编辑配置', 500)
              }
              return {
                ...provider,
                authConfigured:
                  provider.disabled !== true &&
                  (await piModels.isAuthConfigured(String(provider.id))),
                config: configured ?? {
                  kind: 'builtin',
                  id: provider.id,
                  enabled: provider.disabled !== true,
                  allowModels: [],
                  denyModels: [],
                  models: [],
                },
              }
            }),
          ),
          issues: issues.map((issue) => ({
            providerId: issue.providerID,
            path: issue.path,
            code: issue.code,
          })),
        }
      }
      case 'model/list':
        return runtime.modelCatalog(params)
      case 'model/refresh':
        await providers.refresh(true)
        return runtime.publishCatalogUpdated()
      case 'model/setDefault': {
        const model = modelRefOrNull(params.model)
        if (model) await providers.resolve(model)
        // 兼容外壳：旧客户端的“默认模型”语义现在映射为新建任务最近选择。
        await config.batchWrite({
          edits: [
            {
              keyPath: ['desktop', 'recent_new_thread_model'],
              value: model
                ? {
                    providerID: String(model.providerID),
                    id: String(model.id),
                    ...(model.variant ? { variant: String(model.variant) } : {}),
                  }
                : null,
            },
          ],
        })
        const catalog = await runtime.publishCatalogUpdated(false)
        return { defaultModel: model, settingsVersion: catalog.catalogVersion }
      }
      case 'model/setReviewer': {
        const model = modelRefOrNull(params.model)
        if (model) await providers.resolve(model)
        await config.batchWrite({
          edits: [
            {
              keyPath: ['specialized_models', 'security'],
              value: model ? `${String(model.providerID)}/${String(model.id)}` : null,
            },
          ],
        })
        const catalog = await runtime.publishCatalogUpdated(false)
        return { reviewerModel: model, settingsVersion: catalog.catalogVersion }
      }
      case 'provider/test': {
        const providerID = stringParam(params, 'providerId')
        const explicitModel = params.model ? modelRefOrNull(params.model) : null
        if (explicitModel && String(explicitModel.providerID) !== providerID) {
          throw new AgentError('INVALID_REQUEST', '显式传入的模型与 Provider 不匹配', 400)
        }
        const testedAt = Date.now()
        let ref = explicitModel
        if (!ref) {
          const recent = recentNewThreadModel(config.snapshot())
          const recentForProvider =
            recent && recent.providerID === providerID
              ? modelRefOrNull({
                  providerID: recent.providerID,
                  id: recent.id,
                  ...(recent.variant ? { variant: recent.variant } : {}),
                })
              : null
          const models = await providers.models(Provider.ID.make(providerID))
          const firstEnabled = models.find((model) => model.enabled)
          const recentAvailable =
            recentForProvider &&
            models.some((model) => String(model.id) === String(recentForProvider.id))
              ? recentForProvider
              : null
          ref =
            recentAvailable ??
            (firstEnabled ? modelRefOrNull({ providerID, id: firstEnabled.id }) : null)
        }
        if (!ref) {
          return {
            providerId: providerID,
            status: 'unavailable',
            testedAt,
            category: 'configuration',
            message: `Provider ${providerID} 没有可用模型`,
          }
        }
        const probe = await modelHealth.probe(ref)
        // The legacy method only carries `model` when the caller asked for it;
        // old clients without the field keep receiving the old shape.
        const modelField = explicitModel ? { model: ref } : {}
        if (!probe.ok) {
          return {
            providerId: providerID,
            ...modelField,
            status: 'unavailable',
            testedAt,
            category: legacyTestCategory(probe.category),
            message: probe.message,
          }
        }
        return {
          providerId: providerID,
          ...modelField,
          status: 'reachable',
          testedAt,
          latencyMs: probe.latencyMs,
        }
      }
      case 'model/health/preview': {
        const preview = await modelHealth.preview()
        return preview
      }
      case 'model/health/start': {
        const operationId = stringParam(params, 'operationId')
        const run = await modelHealth.start(operationId)
        return { run }
      }
      case 'model/health/read': {
        const runId = stringParam(params, 'runId')
        const run = await modelHealth.read(runId)
        return { run }
      }
      case 'model/health/cancel': {
        const runId = stringParam(params, 'runId')
        const operationId = stringParam(params, 'operationId')
        const run = await modelHealth.cancel(runId, operationId)
        return { run }
      }
      case 'provider/create':
      case 'provider/update': {
        const definition = object(params.definition, 'definition')
        const providerID =
          method === 'provider/create'
            ? stringParam(definition, 'id')
            : stringParam(params, 'providerId')
        if (stringParam(definition, 'id') !== providerID) {
          throw new AgentError('CONFLICT', 'Provider ID 创建后不可修改', 409)
        }
        if (method === 'provider/create' && definition.kind !== 'custom') {
          throw new AgentError('INVALID_REQUEST', '只能创建自定义 Provider', 400)
        }
        const configured = object(config.snapshot().model_providers ?? {}, 'model_providers')
        if (method === 'provider/create' && providerID in configured) {
          throw new AgentError('CONFLICT', `Provider ${providerID} 已存在`, 409)
        }
        let serialized: ReturnType<typeof serializePiProviderDefinition>
        try {
          serialized = serializePiProviderDefinition(
            definition as unknown as PiProviderDefinitionInput,
          )
        } catch (cause) {
          if (cause instanceof PiProviderConfigValidationError) {
            const firstIssue = cause.issues[0]
            const detail =
              firstIssue?.code === 'BUILTIN_OVERRIDE'
                ? `Provider ID "${providerID}" 与系统内置 Provider 重名，请使用其他 ID（如 custom-${providerID}）`
                : firstIssue?.code === 'UNSAFE_URL'
                  ? 'Base URL 格式无效，或明文 HTTP 需要开启允许非 loopback 明文 HTTP'
                  : firstIssue?.code === 'SENSITIVE_HEADER'
                    ? '自定义 Provider 请求头中不能包含敏感认证凭据'
                    : firstIssue?.code === 'INVALID_MODEL'
                      ? '模型配置不合法，请检查模型 ID 与参数设置'
                      : 'Provider 配置不合法'
            throw new AgentError('INVALID_REQUEST', `Provider 配置不合法：${detail}`, 400, {
              issues: cause.issues.map((issue) => ({
                providerId: issue.providerID,
                path: issue.path,
                code: issue.code,
              })),
            })
          }
          throw cause
        }
        await config.batchWrite({
          edits: [
            { keyPath: ['model_catalog', 'schema_version'], value: 2 },
            { keyPath: ['model_providers', providerID], value: serialized.value as never },
          ],
        })
        await providers.reload()
        const catalog = await runtime.publishCatalogUpdated()
        return { providerId: providerID, catalogVersion: catalog.catalogVersion }
      }
      case 'provider/delete': {
        const providerID = stringParam(params, 'providerId')
        const snapshot = config.snapshot()
        const configured = object(snapshot.model_providers ?? {}, 'model_providers')
        if (!(providerID in configured)) {
          throw new AgentError('PROVIDER_NOT_FOUND', `Provider ${providerID} 不存在`, 404)
        }
        const definition = object(configured[providerID], `model_providers.${providerID}`)
        if (definition.kind !== 'custom') {
          throw new AgentError('CONFLICT', '只能删除自定义 Provider', 409)
        }
        const specializedModels =
          snapshot.specialized_models && typeof snapshot.specialized_models === 'object'
            ? (snapshot.specialized_models as Record<string, unknown>)
            : {}
        // 裸模型 ID 已由迁移改写为完整引用，这里只认真实的 providerID/modelID 引用。
        const specializedReferencesProvider = Object.values(specializedModels).some(
          (value) => typeof value === 'string' && value.startsWith(`${providerID}/`),
        )
        const recent = recentNewThreadModel(snapshot)
        if (recent?.providerID === providerID || specializedReferencesProvider) {
          throw new AgentError('CONFLICT', 'Provider 仍被最近模型或专用模型引用', 409)
        }
        await config.batchWrite({
          edits: [{ keyPath: ['model_providers', providerID], value: null }],
        })
        await providers.reload()
        const catalog = await runtime.publishCatalogUpdated()
        return { providerId: providerID, deleted: true, catalogVersion: catalog.catalogVersion }
      }
      case 'provider/model/discover': {
        const providerID = stringParam(params, 'providerId')
        const api = stringParam(params, 'api') as
          'openai-completions' | 'openai-responses' | 'anthropic-messages'
        if (api === 'anthropic-messages') {
          throw new AgentError('PROVIDER_UNAVAILABLE', 'Anthropic 兼容端点不支持自动发现', 400)
        }
        const discovered = await piModels.discoverModels(providerID)
        return {
          models: discovered.map((model) => ({
            id: model.id,
            name: model.name,
            api,
            enabled: true,
            contextWindow: 32_768,
            maxTokens: 8_192,
            reasoning: false,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          })),
        }
      }
      case 'provider/credential/list':
        return {
          credentials: await providerCredentials.list(
            typeof params.providerId === 'string' ? params.providerId : undefined,
          ),
        }
      case 'provider/credential/setActive': {
        const providerID = stringParam(params, 'providerId')
        const credential = await providerCredentials.setActive(
          providerID,
          stringParam(params, 'credentialId'),
        )
        await providers.reload()
        await emitCredentialUpdated(runtime, providerID)
        await runtime.publishCatalogUpdated()
        return { credential }
      }
      case 'provider/credential/setEnabled': {
        const credential = await providerCredentials.setEnabled(
          stringParam(params, 'credentialId'),
          booleanParam(params, 'enabled'),
        )
        await providers.reload()
        await emitCredentialUpdated(runtime, String(credential.providerId))
        await runtime.publishCatalogUpdated()
        return { credential }
      }
      case 'provider/credential/delete': {
        const credentialID = stringParam(params, 'credentialId')
        const before = (await providerCredentials.list()).find(
          (item) => String(item.id) === credentialID,
        )
        const credentials = await providerCredentials.delete(credentialID)
        await providers.reload()
        if (before) await emitCredentialUpdated(runtime, String(before.providerId))
        await runtime.publishCatalogUpdated()
        return { credentials }
      }
      case 'provider/credential/store/read':
        return providerCredentialStore.status()
      case 'provider/credential/store/update': {
        const store = stringParam(params, 'store')
        if (store !== 'auth-json' && store !== 'encrypted') {
          throw new AgentError('INVALID_REQUEST', 'Provider 凭据仓库类型无效', 400)
        }
        const result = await providerCredentialStore.updateStore(
          store,
          stringParam(params, 'operationId'),
        )
        await providers.reload()
        for (const provider of await providers.list()) {
          await emitCredentialUpdated(runtime, String(provider.id))
        }
        await runtime.publishCatalogUpdated()
        return result
      }
      case 'provider/apiKey/create': {
        const providerID = stringParam(params, 'providerId')
        await assertCredentialProviderAvailable(providers, providerID)
        const credential = await apiKeys.create({
          providerID,
          label: stringParam(params, 'label'),
          key: stringParam(params, 'key'),
        })
        await providers.reload()
        await emitCredentialUpdated(runtime, providerID)
        await runtime.publishCatalogUpdated()
        return { credential }
      }
      case 'provider/apiKey/update': {
        const credentialID = stringParam(params, 'credentialId')
        const existing = (await providerCredentials.list()).find(
          (credential) => String(credential.id) === credentialID,
        )
        if (existing) {
          await assertCredentialProviderAvailable(providers, String(existing.providerId))
        }
        const credential = await apiKeys.update({
          credentialID,
          ...(typeof params.label === 'string' ? { label: params.label } : {}),
          ...(typeof params.key === 'string' ? { key: params.key } : {}),
        })
        await providers.reload()
        await emitCredentialUpdated(runtime, String(credential.providerId))
        await runtime.publishCatalogUpdated()
        return { credential }
      }
      case 'provider/apiKey/reorder': {
        const providerID = stringParam(params, 'providerId')
        await assertCredentialProviderAvailable(providers, providerID)
        await apiKeys.reorder(
          providerID,
          stringArray(params.orderedCredentialIds, 'orderedCredentialIds'),
        )
        await emitCredentialUpdated(runtime, providerID)
        return { credentials: await providerCredentials.list(providerID) }
      }
      case 'provider/apiKey/test': {
        const credentialID = stringParam(params, 'credentialId')
        const existing = (await providerCredentials.list()).find(
          (credential) => String(credential.id) === credentialID,
        )
        if (existing) {
          await assertCredentialProviderAvailable(providers, String(existing.providerId))
        }
        const result = await apiKeys.test(credentialID)
        await emitCredentialUpdated(runtime, String(result.credential.providerId))
        return result
      }
      case 'auth/session/start':
        return { session: await authSessions.start(object(params.target, 'target') as never) }
      case 'auth/session/respond':
        return {
          session: await authSessions.respond(
            stringParam(params, 'sessionId'),
            stringParam(params, 'promptId'),
            stringParam(params, 'value'),
          ),
        }
      case 'auth/session/status':
        return { session: authSessions.status(stringParam(params, 'sessionId')) }
      case 'auth/session/cancel':
        return { session: await authSessions.cancel(stringParam(params, 'sessionId')) }
      default:
        throw new AgentError('METHOD_NOT_FOUND', `未知 RPC 方法：${method}`, 404)
    }
  },
} as const satisfies RpcHandlerGroup
