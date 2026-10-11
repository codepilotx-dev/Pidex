import { createHash } from 'node:crypto'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import type { ConfigEdit, ConfigObject, ConfigValue } from '../../config/ConfigService'
import {
  assertSafeProviderHeaders,
  parsePiProviderCatalog,
  PI_PROVIDER_CONFIG_SCHEMA_VERSION,
  validateCustomProviderBaseUrl,
} from './PiProviderConfig'

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const atPath = (value: ConfigObject, path: readonly string[]) => {
  let cursor: unknown = value
  for (const part of path) {
    if (!isObject(cursor) || !(part in cursor)) return undefined
    cursor = cursor[part]
  }
  return cursor
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

const validEnvironmentNames = (value: unknown) =>
  value === undefined ||
  (Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry)))

const unsupportedKeys = (
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  prefix = '',
) =>
  Object.keys(value)
    .filter((key) => !allowed.has(key))
    .map((key) => `${prefix}${key}`)

const setIfMissing = (
  edits: ConfigEdit[],
  current: ConfigObject,
  keyPath: string[],
  value: ConfigValue,
) => {
  if (atPath(current, keyPath) === undefined) {
    edits.push({ keyPath, value })
  }
}

const issue = (providerID: string, fields: readonly string[]): ConfigValue => ({
  issue_id: createHash('sha256')
    .update(`pi-provider-v2:${providerID}:${[...fields].sort().join(',')}`)
    .digest('hex')
    .slice(0, 16),
  provider_id: providerID,
  fields: [...new Set(fields)].sort(),
})

const setDiagnostic = (
  edits: ConfigEdit[],
  current: ConfigObject,
  keyPath: string[],
  value: ConfigValue,
) => {
  if (JSON.stringify(atPath(current, keyPath)) !== JSON.stringify(value)) {
    edits.push({ keyPath, value, mergeStrategy: 'replace' })
  }
}

const BUILTIN_ALLOWED = new Set([
  'kind',
  'enabled',
  'disabled',
  'allow_models',
  'deny_models',
  'whitelist',
  'blacklist',
  'models',
])

const CUSTOM_ALLOWED = new Set([
  'kind',
  'name',
  'enabled',
  'disabled',
  'base_url',
  'api',
  'npm',
  'auth',
  'env',
  'allow_insecure_http',
  'headers',
  'models',
])

const CUSTOM_MODEL_ALLOWED = new Set([
  'id',
  'api',
  'name',
  'enabled',
  'context_window',
  'max_tokens',
  'reasoning',
  'input',
  'cost',
  'headers',
  'thinking_level_map',
  'compat',
  // Recognized v1 model fields:
  'limit',
  'attachment',
  'modalities',
])

const migrateBuiltin = (
  edits: ConfigEdit[],
  current: ConfigObject,
  providerID: string,
  provider: Record<string, unknown>,
) => {
  const unsupported = unsupportedKeys(provider, BUILTIN_ALLOWED)
  const models = isObject(provider.models) ? provider.models : {}
  for (const [modelID, rawModel] of Object.entries(models)) {
    if (!isObject(rawModel)) {
      unsupported.push(`models.${modelID}`)
      continue
    }
    for (const key of Object.keys(rawModel)) {
      if (key !== 'enabled') unsupported.push(`models.${modelID}.${key}`)
    }
  }
  const prefix = ['model_providers', providerID]
  setIfMissing(edits, current, [...prefix, 'kind'], 'builtin')
  setIfMissing(
    edits,
    current,
    [...prefix, 'enabled'],
    unsupported.length > 0
      ? false
      : typeof provider.enabled === 'boolean'
        ? provider.enabled
        : provider.disabled !== true,
  )
  if (
    unsupported.length > 0 &&
    atPath(current, [...prefix, 'enabled']) !== undefined &&
    atPath(current, [...prefix, 'enabled']) !== false
  ) {
    edits.push({
      keyPath: [...prefix, 'enabled'],
      value: false,
      mergeStrategy: 'replace',
    })
  }
  setIfMissing(
    edits,
    current,
    [...prefix, 'allow_models'],
    strings(provider.allow_models ?? provider.whitelist),
  )
  setIfMissing(
    edits,
    current,
    [...prefix, 'deny_models'],
    strings(provider.deny_models ?? provider.blacklist),
  )
  for (const [modelID, rawModel] of Object.entries(models)) {
    if (!isObject(rawModel) || typeof rawModel.enabled !== 'boolean') continue
    setIfMissing(edits, current, [...prefix, 'models', modelID, 'enabled'], rawModel.enabled)
  }
  return unsupported
}

const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const migrateCustomModel = (
  edits: ConfigEdit[],
  current: ConfigObject,
  providerID: string,
  configuredID: string,
  model: Record<string, unknown>,
  api: string,
) => {
  const unsupported = unsupportedKeys(model, CUSTOM_MODEL_ALLOWED, `models.${configuredID}.`)
  try {
    assertSafeProviderHeaders(model.headers, `model ${providerID}/${configuredID}`)
  } catch {
    unsupported.push(`models.${configuredID}.headers`)
  }
  const limit = isObject(model.limit) ? model.limit : {}
  const modalities = isObject(model.modalities) ? model.modalities : {}
  const rawInput = strings(model.input ?? modalities.input)
  const input = rawInput.filter((item) => item === 'text' || item === 'image')
  if (model.attachment === true && !input.includes('image')) input.push('image')
  const prefix = ['model_providers', providerID, 'models', configuredID]
  setIfMissing(
    edits,
    current,
    [...prefix, 'id'],
    typeof model.id === 'string' ? model.id : configuredID,
  )
  setIfMissing(edits, current, [...prefix, 'api'], api)
  setIfMissing(
    edits,
    current,
    [...prefix, 'name'],
    typeof model.name === 'string' ? model.name : configuredID,
  )
  setIfMissing(edits, current, [...prefix, 'enabled'], model.enabled !== false)
  setIfMissing(
    edits,
    current,
    [...prefix, 'context_window'],
    number(model.context_window ?? limit.context) ?? 32_768,
  )
  setIfMissing(
    edits,
    current,
    [...prefix, 'max_tokens'],
    number(model.max_tokens ?? limit.output) ?? 8_192,
  )
  setIfMissing(edits, current, [...prefix, 'reasoning'], model.reasoning === true)
  setIfMissing(edits, current, [...prefix, 'input'], input.length > 0 ? input : ['text'])
  if (isObject(model.cost)) {
    const safeCost = Object.fromEntries(
      Object.entries(model.cost).flatMap(([key, value]) =>
        typeof value === 'number' && Number.isFinite(value) && value >= 0 ? [[key, value]] : [],
      ),
    )
    if (Object.keys(safeCost).length > 0) {
      setIfMissing(edits, current, [...prefix, 'cost'], safeCost)
    }
  }
  if (isObject(model.headers) && !unsupported.includes(`models.${configuredID}.headers`)) {
    setIfMissing(
      edits,
      current,
      [...prefix, 'headers'],
      model.headers as Record<string, ConfigValue>,
    )
  }
  return unsupported
}

const migrateCustom = (
  edits: ConfigEdit[],
  current: ConfigObject,
  providerID: string,
  provider: Record<string, unknown>,
) => {
  const unsupported = unsupportedKeys(provider, CUSTOM_ALLOWED)
  const npm = typeof provider.npm === 'string' ? provider.npm : undefined
  const inferredApi =
    npm === '@ai-sdk/anthropic'
      ? 'anthropic-messages'
      : npm === undefined || npm === '@ai-sdk/openai-compatible'
        ? 'openai-completions'
        : undefined
  if (!inferredApi) unsupported.push('npm')
  const baseUrl =
    typeof provider.base_url === 'string'
      ? provider.base_url
      : typeof provider.api === 'string'
        ? provider.api
        : undefined
  const allowInsecureHttp = provider.allow_insecure_http === true
  try {
    validateCustomProviderBaseUrl(baseUrl, allowInsecureHttp)
  } catch {
    unsupported.push(baseUrl ? 'api' : 'base_url')
  }
  try {
    assertSafeProviderHeaders(provider.headers, `provider ${providerID}`)
  } catch {
    unsupported.push('headers')
  }
  if (!validEnvironmentNames(provider.env)) unsupported.push('env')
  const models = isObject(provider.models) ? provider.models : {}
  if (Object.keys(models).length === 0) unsupported.push('models')
  if (inferredApi) {
    for (const [modelID, rawModel] of Object.entries(models)) {
      if (!isObject(rawModel)) {
        unsupported.push(`models.${modelID}`)
        continue
      }
      unsupported.push(
        ...migrateCustomModel(edits, current, providerID, modelID, rawModel, inferredApi),
      )
    }
  }
  const prefix = ['model_providers', providerID]
  setIfMissing(edits, current, [...prefix, 'kind'], 'custom')
  setIfMissing(
    edits,
    current,
    [...prefix, 'enabled'],
    unsupported.length > 0 ? false : provider.disabled !== true,
  )
  if (
    unsupported.length > 0 &&
    atPath(current, [...prefix, 'enabled']) !== undefined &&
    atPath(current, [...prefix, 'enabled']) !== false
  ) {
    edits.push({
      keyPath: [...prefix, 'enabled'],
      value: false,
      mergeStrategy: 'replace',
    })
  }
  setIfMissing(
    edits,
    current,
    [...prefix, 'name'],
    typeof provider.name === 'string' ? provider.name : providerID,
  )
  if (baseUrl) {
    setIfMissing(edits, current, [...prefix, 'base_url'], baseUrl)
  }
  setIfMissing(edits, current, [...prefix, 'auth'], provider.auth === 'none' ? 'none' : 'api-key')
  setIfMissing(edits, current, [...prefix, 'env'], strings(provider.env))
  setIfMissing(edits, current, [...prefix, 'allow_insecure_http'], allowInsecureHttp)
  if (isObject(provider.headers) && !unsupported.includes('headers')) {
    setIfMissing(
      edits,
      current,
      [...prefix, 'headers'],
      provider.headers as Record<string, ConfigValue>,
    )
  }
  return unsupported
}

/**
 * Plans a key-path-only migration. Existing v1 keys remain untouched so old
 * and unrecognized values are never discarded.
 */
export const planPiProviderConfigMigration = (current: ConfigObject): readonly ConfigEdit[] => {
  const currentVersion = atPath(current, ['model_catalog', 'schema_version'])
  if (typeof currentVersion === 'number' && currentVersion > PI_PROVIDER_CONFIG_SCHEMA_VERSION) {
    return []
  }
  const edits: ConfigEdit[] = []
  const providers = isObject(current.model_providers) ? current.model_providers : {}
  const builtinIDs = new Set<string>(builtinProviders().map((provider) => provider.id))
  for (const [providerID, rawProvider] of Object.entries(providers)) {
    if (!isObject(rawProvider)) {
      setDiagnostic(
        edits,
        current,
        ['migration', 'unresolved_providers', providerID],
        issue(providerID, ['provider']),
      )
      continue
    }
    let unsupported: string[] = []
    if (rawProvider.kind === 'builtin') {
      unsupported = migrateBuiltin(edits, current, providerID, rawProvider)
    } else if (rawProvider.kind === 'custom') {
      // A previous pass can leave the legacy keys beside the new v2 keys.
      // Continue using the deterministic legacy mapping until those original
      // keys are removed by the user.
      unsupported =
        'npm' in rawProvider || 'api' in rawProvider
          ? migrateCustom(edits, current, providerID, rawProvider)
          : parsePiProviderCatalog({
              schemaVersion: PI_PROVIDER_CONFIG_SCHEMA_VERSION,
              providers: { [providerID]: rawProvider },
            }).issues.map((entry) => `${entry.code}:${entry.path}`)
      if (
        unsupported.length > 0 &&
        atPath(current, ['model_providers', providerID, 'enabled']) !== undefined &&
        atPath(current, ['model_providers', providerID, 'enabled']) !== false
      ) {
        edits.push({
          keyPath: ['model_providers', providerID, 'enabled'],
          value: false,
          mergeStrategy: 'replace',
        })
      }
    } else if (builtinIDs.has(providerID)) {
      unsupported = migrateBuiltin(edits, current, providerID, rawProvider)
    } else {
      unsupported = migrateCustom(edits, current, providerID, rawProvider)
    }
    const diagnosticPath = ['migration', 'unresolved_providers', providerID]
    if (unsupported.length > 0) {
      setDiagnostic(edits, current, diagnosticPath, issue(providerID, unsupported))
    } else if (atPath(current, diagnosticPath) !== undefined) {
      edits.push({ keyPath: diagnosticPath, value: null })
    }
  }
  if (currentVersion !== PI_PROVIDER_CONFIG_SCHEMA_VERSION) {
    edits.push({
      keyPath: ['model_catalog', 'schema_version'],
      value: PI_PROVIDER_CONFIG_SCHEMA_VERSION,
      mergeStrategy: 'replace',
    })
  }
  return edits
}
