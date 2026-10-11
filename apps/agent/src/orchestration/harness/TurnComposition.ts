import type { Model } from '@earendil-works/pi-ai'
import type { ThinkingLevel } from './AgentTypes.ts'
import type { AgentHarnessStreamOptions, AgentHarnessTool, AgentHarnessResources } from './Types.ts'
import type { Skill, PromptTemplate } from './Types.ts'

const COMPOSITION_VERSION = 1
const HASH_TRUNCATE_LENGTH = 16

function sortedUnique(names: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(names)].sort())
}

async function hashString(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

function truncateHash(hash: string): string {
  return hash.slice(0, HASH_TRUNCATE_LENGTH)
}

interface CanonicalIdentityInput {
  modelProvider: string
  modelApi: string
  modelId: string
  thinkingLevel: string
  systemPromptHash: string
  registeredNames: readonly string[]
  initialActiveNames: readonly string[]
  deferredAllowedNames: readonly string[]
  skillHashes: string
  templateHashes: string
  timeoutMs: number | undefined
  maxRetries: number | undefined
  maxRetryDelayMs: number | undefined
  transport: string | undefined
  cacheRetention: string | undefined
}

async function buildCompositionIdentityInternal(input: CanonicalIdentityInput): Promise<{
  id: string
  version: number
  hash: string
}> {
  const canonical = JSON.stringify(input, Object.keys(input).sort())
  const hash = await hashString(canonical)
  return {
    id: `v${COMPOSITION_VERSION}-${truncateHash(hash)}`,
    version: COMPOSITION_VERSION,
    hash,
  }
}

export interface HarnessCompositionIdentity {
  readonly id: string
  readonly version: number
  readonly hash: string
}

export interface HarnessToolComposition {
  readonly registeredNames: readonly string[]
  readonly initialActiveNames: readonly string[]
  readonly deferredAllowedNames: readonly string[]
}

export interface HarnessTurnComposition<
  TContext extends object | undefined = undefined,
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
  TTool extends AgentHarnessTool<TContext> = AgentHarnessTool<TContext>,
> {
  readonly identity: HarnessCompositionIdentity
  readonly model: Model<any>
  readonly thinkingLevel: ThinkingLevel
  readonly systemPrompt: string
  readonly tools: readonly TTool[]
  readonly activeToolNames: readonly string[]
  readonly toolPolicy: HarnessToolComposition
  readonly resources: AgentHarnessResources<TSkill, TPromptTemplate>
  readonly toolContext: TContext
  readonly streamOptions: Readonly<AgentHarnessStreamOptions>
}

export interface HarnessTurnContext {
  readonly compositionId: string
  readonly compositionHash: string
  readonly stepIndex: number
  readonly model: Model<any>
  readonly thinkingLevel: ThinkingLevel
  readonly systemPrompt: string
  readonly activeToolNames: readonly string[]
  readonly streamOptions: Readonly<AgentHarnessStreamOptions>
}

export interface HarnessStepContext {
  readonly stepIndex: number
  readonly currentActiveNames: readonly string[]
  readonly isRegisteredTool: (name: string) => boolean
  readonly isActiveTool: (name: string) => boolean
  readonly isDeferredTool: (name: string) => boolean
}

function canonicalizeCacheRetention(
  cacheRetention: AgentHarnessStreamOptions['cacheRetention'],
): string | undefined {
  if (cacheRetention === undefined) return undefined
  if (typeof cacheRetention === 'string') return cacheRetention
  if (typeof cacheRetention === 'object' && cacheRetention !== null) {
    return JSON.stringify(cacheRetention)
  }
  return String(cacheRetention)
}

function cloneStreamOptions(
  options?: AgentHarnessStreamOptions,
): Readonly<AgentHarnessStreamOptions> | undefined {
  if (!options) return undefined
  return Object.freeze({
    ...options,
    ...(options.headers ? { headers: Object.freeze({ ...options.headers }) } : {}),
    ...(options.metadata ? { metadata: Object.freeze({ ...options.metadata }) } : {}),
  })
}

export async function buildHarnessTurnComposition<
  TContext extends object | undefined,
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentHarnessTool<TContext>,
>(params: {
  model: Model<any>
  thinkingLevel: ThinkingLevel
  systemPrompt: string
  tools: readonly TTool[]
  initialActiveToolNames?: readonly string[]
  deferredToolNames?: readonly string[]
  resources?: AgentHarnessResources<TSkill, TPromptTemplate>
  toolContext: TContext
  streamOptions?: AgentHarnessStreamOptions
}): Promise<Readonly<HarnessTurnComposition<TContext, TSkill, TPromptTemplate, TTool>>> {
  const {
    model,
    thinkingLevel,
    systemPrompt,
    tools,
    initialActiveToolNames,
    deferredToolNames = [],
    resources,
    toolContext,
    streamOptions,
  } = params

  const registeredNames = sortedUnique(tools.map((t) => t.name))
  const initialActive = initialActiveToolNames
    ? sortedUnique(initialActiveToolNames)
    : registeredNames

  const deferredAllowedNames = sortedUnique(deferredToolNames)

  const unknownInitial = initialActive.filter((n) => !registeredNames.includes(n))
  if (unknownInitial.length > 0) {
    throw new Error(`Initial active tools not registered: ${unknownInitial.join(', ')}`)
  }

  const overlap = initialActive.filter((n) => deferredAllowedNames.includes(n))
  if (overlap.length > 0) {
    throw new Error(`Tools cannot be both active and deferred: ${overlap.join(', ')}`)
  }

  const dupRegistered = registeredNames.length !== [...new Set(registeredNames)].length
  if (dupRegistered) {
    throw new Error('Duplicate tool names in registered tools')
  }

  const systemPromptHash = await hashString(systemPrompt)

  const skillHashEntries = await Promise.all(
    (resources?.skills ?? []).map(async (s) => ({
      name: s.name,
      contentHash: await hashString(s.content),
    })),
  )
  const templateHashEntries = await Promise.all(
    (resources?.promptTemplates ?? []).map(async (t) => ({
      name: t.name,
      contentHash: await hashString(t.content),
    })),
  )

  const canonicalSkillInput = skillHashEntries
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => `${s.name}:${s.contentHash}`)
    .join('|')
  const canonicalTemplateInput = templateHashEntries
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => `${t.name}:${t.contentHash}`)
    .join('|')

  const snapshotStreamOptions = cloneStreamOptions(streamOptions)

  const identity = Object.freeze(
    await buildCompositionIdentityInternal({
      modelProvider: model.provider,
      modelApi: model.api,
      modelId: model.id,
      thinkingLevel,
      systemPromptHash,
      registeredNames,
      initialActiveNames: initialActive,
      deferredAllowedNames,
      skillHashes: canonicalSkillInput,
      templateHashes: canonicalTemplateInput,
      timeoutMs: streamOptions?.timeoutMs,
      maxRetries: streamOptions?.maxRetries,
      maxRetryDelayMs: streamOptions?.maxRetryDelayMs,
      transport: streamOptions?.transport,
      cacheRetention: canonicalizeCacheRetention(streamOptions?.cacheRetention),
    }),
  )

  const toolPolicy: HarnessToolComposition = Object.freeze({
    registeredNames,
    initialActiveNames: initialActive,
    deferredAllowedNames,
  })

  return Object.freeze({
    identity,
    model,
    thinkingLevel,
    systemPrompt,
    tools,
    activeToolNames: initialActive,
    toolPolicy,
    resources: resources ?? Object.freeze({}),
    toolContext,
    streamOptions: snapshotStreamOptions ?? Object.freeze({}),
  })
}

export async function computeCompositionIdentity(params: {
  model: Model<any>
  thinkingLevel: ThinkingLevel
  systemPrompt: string
  registeredToolNames: readonly string[]
  initialActiveToolNames?: readonly string[]
  deferredToolNames?: readonly string[]
  resources?: AgentHarnessResources
  streamOptions?: AgentHarnessStreamOptions
}): Promise<HarnessCompositionIdentity> {
  const {
    model,
    thinkingLevel,
    systemPrompt,
    registeredToolNames,
    initialActiveToolNames,
    deferredToolNames = [],
    resources,
    streamOptions,
  } = params

  const registeredNames = sortedUnique(registeredToolNames)
  const initialActive = initialActiveToolNames
    ? sortedUnique(initialActiveToolNames)
    : registeredNames
  const deferredAllowedNames = sortedUnique(deferredToolNames)

  const systemPromptHash = await hashString(systemPrompt)

  const skillHashEntries = await Promise.all(
    (resources?.skills ?? []).map(async (s) => ({
      name: s.name,
      contentHash: await hashString(s.content),
    })),
  )
  const templateHashEntries = await Promise.all(
    (resources?.promptTemplates ?? []).map(async (t) => ({
      name: t.name,
      contentHash: await hashString(t.content),
    })),
  )

  const canonicalSkillInput = skillHashEntries
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => `${s.name}:${s.contentHash}`)
    .join('|')
  const canonicalTemplateInput = templateHashEntries
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => `${t.name}:${t.contentHash}`)
    .join('|')

  return buildCompositionIdentityInternal({
    modelProvider: model.provider,
    modelApi: model.api,
    modelId: model.id,
    thinkingLevel,
    systemPromptHash,
    registeredNames,
    initialActiveNames: initialActive,
    deferredAllowedNames,
    skillHashes: canonicalSkillInput,
    templateHashes: canonicalTemplateInput,
    timeoutMs: streamOptions?.timeoutMs,
    maxRetries: streamOptions?.maxRetries,
    maxRetryDelayMs: streamOptions?.maxRetryDelayMs,
    transport: streamOptions?.transport,
    cacheRetention: canonicalizeCacheRetention(streamOptions?.cacheRetention),
  })
}

export function buildTurnContext(params: {
  composition: Readonly<HarnessTurnComposition<any, any, any, any>>
  stepIndex: number
  currentActiveToolNames?: readonly string[]
}): HarnessTurnContext {
  const { composition, stepIndex, currentActiveToolNames } = params
  return Object.freeze({
    compositionId: composition.identity.id,
    compositionHash: composition.identity.hash,
    stepIndex,
    model: composition.model,
    thinkingLevel: composition.thinkingLevel,
    systemPrompt: composition.systemPrompt,
    activeToolNames: currentActiveToolNames ?? composition.activeToolNames,
    streamOptions: composition.streamOptions,
  })
}

export function buildStepContext(params: {
  stepIndex: number
  currentActiveNames: readonly string[]
  toolPolicy: HarnessToolComposition
}): HarnessStepContext {
  const { stepIndex, currentActiveNames, toolPolicy } = params
  const activeSet = new Set(currentActiveNames)
  const deferredSet = new Set(toolPolicy.deferredAllowedNames)
  const registeredSet = new Set(toolPolicy.registeredNames)

  return Object.freeze({
    stepIndex,
    currentActiveNames: sortedUnique(currentActiveNames),
    isRegisteredTool: (name: string) => registeredSet.has(name),
    isActiveTool: (name: string) => activeSet.has(name),
    isDeferredTool: (name: string) => deferredSet.has(name),
  })
}

export function validateToolEnvelope(
  names: readonly string[],
  toolPolicy: HarnessToolComposition,
): void {
  const dupes = names.filter((n, i) => names.indexOf(n) !== i)
  if (dupes.length > 0) {
    throw new Error(`Duplicate tool names: ${dupes.join(', ')}`)
  }

  const notRegistered = names.filter(
    (n) => !toolPolicy.registeredNames.includes(n) && !toolPolicy.deferredAllowedNames.includes(n),
  )
  if (notRegistered.length > 0) {
    throw new Error(`Unknown tool(s): ${notRegistered.join(', ')}`)
  }

  const conflict = names.filter(
    (n) => toolPolicy.registeredNames.includes(n) && toolPolicy.deferredAllowedNames.includes(n),
  )
  if (conflict.length > 0) {
    throw new Error(
      `Tools cannot be validated as registered envelope and deferred simultaneously: ${conflict.join(', ')}`,
    )
  }
}

export function validateDeferredActivation(
  newNames: readonly string[],
  toolPolicy: HarnessToolComposition,
): void {
  const dupes = newNames.filter((n, i) => newNames.indexOf(n) !== i)
  if (dupes.length > 0) {
    throw new Error(`Duplicate activation names: ${dupes.join(', ')}`)
  }

  const notAllowed = newNames.filter((n) => !toolPolicy.deferredAllowedNames.includes(n))
  if (notAllowed.length > 0) {
    throw new Error(`Deferred activation not allowed for: ${notAllowed.join(', ')}`)
  }
}
