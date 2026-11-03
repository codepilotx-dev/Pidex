/**
 * 双层模型参数的协议映射边界。
 *
 * 复用 ZCode 的受限 CEL + JSON Merge Patch 实现（见 ./option-map），
 * 在协议序列化完成后把选中的 reasoningLevel / maxOutputTokens 值转换成
 * 当前协议请求体字段。显式 map 是对应参数最终请求字段的唯一权威：
 * 应用前先删除该参数的旧字段残留，避免同一语义出现重复字段。
 */
import type { Model } from '@pidex/model-schema'
import {
  applyOrderedJsonMergePatches,
  compileModelOptionMap,
  type JsonObject,
  type NamedJsonMergePatch,
} from './option-map'

export interface CompiledOptionSpecs {
  readonly reasoningLevel?: { readonly evaluate: (value: string) => JsonObject }
  readonly maxOutputTokens?: { readonly evaluate: (value: number) => JsonObject }
}

export interface ModelOptionSelection {
  readonly reasoningLevel?: string | undefined
  readonly maxOutputTokens?: number | undefined
}

/**
 * 编译 optionSpecs 中显式提供的 map；未提供任何 map 时返回 undefined。
 * 编译在有效模型配置建立时调用一次（调用方按模型对象缓存）。
 * 表达式非法时抛出 RestrictedCelError / ModelOptionMapError（安全、不含凭据）。
 */
export const compileOptionSpecs = (
  specs: Model.OptionSpecs | undefined,
): CompiledOptionSpecs | undefined => {
  if (!specs) return undefined
  const reasoningSource = specs.reasoningLevel?.map
  const maxSource = specs.maxOutputTokens?.map
  const reasoningLevel = reasoningSource
    ? compileModelOptionMap(reasoningSource, 'reasoningLevel')
    : undefined
  const maxOutputTokens = maxSource
    ? compileModelOptionMap(maxSource, 'maxOutputTokens')
    : undefined
  if (!reasoningLevel && !maxOutputTokens) return undefined
  return {
    ...(reasoningLevel ? { reasoningLevel } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
  }
}

/**
 * 每个参数对应的旧协议字段。显式 map 生效时，未被 map 写入的旧字段会被删除，
 * 由 map 成为该参数最终请求字段的唯一权威。
 */
const LEGACY_FIELDS: Record<'reasoningLevel' | 'maxOutputTokens', readonly string[]> = {
  reasoningLevel: [
    'reasoning',
    'reasoning_effort',
    'reasoningEffort',
    'thinking',
    'thinking_budget',
    'thinking_budget_tokens',
    'thinking_token_budget',
  ],
  maxOutputTokens: ['max_tokens', 'max_completion_tokens', 'max_output_tokens'],
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * 在已序列化的请求体上应用 optionSpecs 映射。
 * - 只应用存在且有选中值的参数；
 * - 每个参数独立 merge，先清旧字段再 apply；
 * - 任何异常都不应让请求失败：调用方负责捕获并回退到原 body。
 */
export const applyModelOptionMap = (
  payload: unknown,
  compiled: CompiledOptionSpecs,
  selection: ModelOptionSelection,
): unknown => {
  if (!isRecord(payload)) return payload
  const patches: NamedJsonMergePatch[] = []
  if (compiled.reasoningLevel && selection.reasoningLevel !== undefined) {
    patches.push({
      option: 'reasoningLevel',
      patch: compiled.reasoningLevel.evaluate(selection.reasoningLevel),
    })
  }
  if (compiled.maxOutputTokens && selection.maxOutputTokens !== undefined) {
    patches.push({
      option: 'maxOutputTokens',
      patch: compiled.maxOutputTokens.evaluate(selection.maxOutputTokens),
    })
  }
  if (!patches.length) return payload
  let result: JsonObject = { ...(payload as JsonObject) }
  for (const patch of patches) {
    const mutable: Record<string, unknown> = { ...result }
    const written = new Set(Object.keys(patch.patch))
    for (const legacy of LEGACY_FIELDS[patch.option as 'reasoningLevel' | 'maxOutputTokens']) {
      if (!written.has(legacy)) delete mutable[legacy]
    }
    result = applyOrderedJsonMergePatches(mutable as JsonObject, [patch])
  }
  return result
}
