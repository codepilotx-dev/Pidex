// Ported from ZCode `packages/model-option-map/src/option-maps.ts` (Apache-2.0).
// Upstream revision: 3c5b227649371507ddc4eb46ac5133afe6db1cab.
// See ./NOTICE.md for provenance and license details.

import { compileModelOptionMap } from './compiler'
import { applyOrderedJsonMergePatches, type NamedJsonMergePatch } from './merge-patch'
import { ModelOptionMapError, type JsonObject, type ModelOptionMapProgram } from './types'

export interface ModelOptionMapSpecs {
  readonly reasoningLevel: { readonly map: string }
  readonly maxOutputTokens: { readonly map: string }
}

export interface ModelOptionValues {
  /**
   * Effective reasoning level for the current request. Declared reasoning maps
   * fail closed when this is absent, so it is modeled as optional.
   */
  readonly reasoningLevel?: string
  readonly maxOutputTokens: number
}

export interface CompiledModelOptionMaps {
  apply(body: JsonObject, values: ModelOptionValues): JsonObject
}

/** Compile once at model creation; each request only binds its frozen option values. */
export function compileModelOptionMaps(specs: ModelOptionMapSpecs): CompiledModelOptionMaps {
  const reasoningLevel = compileModelOptionMap(specs.reasoningLevel.map, 'reasoningLevel')
  const maxOutputTokens = compileModelOptionMap(specs.maxOutputTokens.map, 'maxOutputTokens')
  return Object.freeze({
    apply(body: JsonObject, values: ModelOptionValues): JsonObject {
      const patches: NamedJsonMergePatch[] = []
      const reasoningLevelValue = values.reasoningLevel
      if (reasoningLevelValue === undefined) {
        throw new ModelOptionMapError('reasoningLevel requires an effective value')
      }
      patches.push(optionPatch('reasoningLevel', reasoningLevel, reasoningLevelValue))
      patches.push(optionPatch('maxOutputTokens', maxOutputTokens, values.maxOutputTokens))
      return applyOrderedJsonMergePatches(body, patches)
    },
  })
}

function optionPatch(
  option: string,
  program: ModelOptionMapProgram,
  value: string | number,
): NamedJsonMergePatch {
  return { option, patch: program.evaluate(value) }
}
