/**
 * ZCode 静态模型参数规则的查询层。
 *
 * 只贡献模型事实中的 `optionSpecs`（reasoningLevel.values/map、maxOutputTokens.max/map），
 * 不引入 ZCode 的供应商账号、认证或运行时。规则按 ZCode 的通用层顺序
 * （modelRules → modelApiRules → providerSiteRules）依次覆盖，后匹配者胜出。
 * 数据见 ./data/zcode-model-options.ts（含来源 revision 与许可证说明）。
 */
import type { Model } from '@pidex/model-schema'
import { ZCODE_MODEL_OPTION_RULES, type ZCodeOptionRule } from './data/zcode-model-options'

const API_ALIASES: Record<string, string> = {
  'openai-chat-completions': 'openai-completions',
}

const normalizeApi = (api: string): string => API_ALIASES[api] ?? api

const matches = (pattern: string, value: string, ignoreCase = true): boolean => {
  try {
    return new RegExp(`^(?:${pattern})$`, ignoreCase ? 'i' : undefined).test(value)
  } catch {
    return false
  }
}

const overlayReasoning = (
  base: Model.OptionSpecs['reasoningLevel'],
  next: ZCodeOptionRule['optionSpecs']['reasoningLevel'],
): Model.OptionSpecs['reasoningLevel'] => {
  if (!next) return base
  const values = next.values !== undefined ? [...next.values] : base?.values
  const map = next.map !== undefined ? next.map : base?.map
  if (values === undefined && map === undefined) return base
  return {
    ...(values !== undefined ? { values } : {}),
    ...(map !== undefined ? { map } : {}),
  }
}

const overlayMax = (
  base: Model.OptionSpecs['maxOutputTokens'],
  next: ZCodeOptionRule['optionSpecs']['maxOutputTokens'],
): Model.OptionSpecs['maxOutputTokens'] => {
  if (!next) return base
  const max = next.max !== undefined ? next.max : base?.max
  const map = next.map !== undefined ? next.map : base?.map
  if (max === undefined && map === undefined) return base
  return {
    ...(max !== undefined ? { max } : {}),
    ...(map !== undefined ? { map } : {}),
  }
}

const overlay = (
  base: Model.OptionSpecs | undefined,
  next: ZCodeOptionRule['optionSpecs'],
): Model.OptionSpecs => {
  const reasoningLevel = overlayReasoning(base?.reasoningLevel, next.reasoningLevel)
  const maxOutputTokens = overlayMax(base?.maxOutputTokens, next.maxOutputTokens)
  return {
    ...(reasoningLevel ? { reasoningLevel } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
  }
}

const ruleMatches = (
  rule: ZCodeOptionRule,
  input: { modelId: string; api: string; baseUrl?: string | undefined },
): boolean => {
  if (!matches(rule.modelMatch, input.modelId)) return false
  if (rule.apiTypeMatch !== undefined && rule.apiTypeMatch !== '.*') {
    const pattern = normalizeApi(rule.apiTypeMatch)
    if (!matches(pattern, normalizeApi(input.api))) return false
  }
  if (
    rule.baseUrlMatch !== undefined &&
    !(input.baseUrl && matches(rule.baseUrlMatch, input.baseUrl))
  )
    return false
  return true
}

const resolveFrom = (
  rules: readonly ZCodeOptionRule[],
  input: { modelId: string; api: string; baseUrl?: string | undefined },
): Model.OptionSpecs | undefined => {
  let result: Model.OptionSpecs | undefined
  for (const rule of rules) {
    if (!ruleMatches(rule, input)) continue
    result = overlay(result, rule.optionSpecs)
  }
  return result && (result.reasoningLevel || result.maxOutputTokens) ? result : undefined
}

export interface ZCodeOptionInput {
  readonly modelId: string
  readonly api: string
  readonly baseUrl?: string | undefined
}

/**
 * 解析模型命中的 ZCode optionSpecs（通用层 + api/baseUrl 细化层，后匹配者覆盖）。
 * 规则是逐条正则覆盖，不做裸名模糊匹配，避免把相似模型误合并。
 */
export const resolveZCodeOptionSpecs = (input: ZCodeOptionInput): Model.OptionSpecs | undefined =>
  resolveFrom(ZCODE_MODEL_OPTION_RULES, input)

/** 允许测试注入自定义规则集（默认使用生成的静态数据）。 */
export const resolveZCodeOptionSpecsFrom = (
  rules: readonly ZCodeOptionRule[],
  input: ZCodeOptionInput,
): Model.OptionSpecs | undefined => resolveFrom(rules, input)
