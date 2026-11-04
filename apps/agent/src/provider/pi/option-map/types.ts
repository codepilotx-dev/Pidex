// Ported from ZCode `packages/model-option-map/src/types.ts` (Apache-2.0).
// Upstream revision: 3c5b227649371507ddc4eb46ac5133afe6db1cab.
// See ./NOTICE.md for provenance and license details.

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[]

export interface JsonObject {
  readonly [key: string]: JsonValue
}

export type RestrictedCelValue = string | number
export type ModelOptionName = 'reasoningLevel' | 'maxOutputTokens'

export interface RestrictedCelProgram {
  readonly source: string
  evaluate(input: RestrictedCelValue): JsonValue
}

export interface ModelOptionMapProgram {
  readonly source: string
  evaluate(input: RestrictedCelValue): JsonObject
}

export class RestrictedCelError extends Error {
  readonly offset: number

  constructor(message: string, offset: number) {
    super(`${message} at offset ${offset}`)
    this.name = 'RestrictedCelError'
    this.offset = offset
  }
}

export class ModelOptionMapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelOptionMapError'
  }
}
