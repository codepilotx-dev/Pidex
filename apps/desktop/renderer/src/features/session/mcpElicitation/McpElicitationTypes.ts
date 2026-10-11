/**
 * Minimal type definitions for MCP elicitation form schema.
 *
 * These types describe the shape of `requestedSchema` from MCP
 * `ElicitRequestFormParams` (2025-11-25). They are deliberately
 * kept as a renderer-only subset — not a copy of the full Rust
 * generated types — to avoid a maintenance dependency on codegen.
 */

// ── Root schema ──────────────────────────────────────────────

export type McpElicitationSchema = {
  $schema?: string
  type: 'object'
  properties: Record<string, McpElicitationPrimitiveSchema>
  required?: Array<string>
}

// ── Primitive field union ────────────────────────────────────

export type McpElicitationPrimitiveSchema =
  | McpElicitationStringSchema
  | McpElicitationNumberSchema
  | McpElicitationBooleanSchema
  | McpElicitationEnumSchema

// ── String ────────────────────────────────────────────────────

export type McpElicitationStringSchema = {
  type: 'string'
  title?: string
  description?: string
  minLength?: number
  maxLength?: number
  format?: 'email' | 'uri' | 'date' | 'date-time'
  default?: string
}

// ── Number / Integer ──────────────────────────────────────────

export type McpElicitationNumberSchema = {
  type: 'number' | 'integer'
  title?: string
  description?: string
  minimum?: number
  maximum?: number
  default?: number
}

// ── Boolean ───────────────────────────────────────────────────

export type McpElicitationBooleanSchema = {
  type: 'boolean'
  title?: string
  description?: string
  default?: boolean
}

// ── Enum (single / multi select) ──────────────────────────────

export type McpElicitationEnumSchema =
  McpElicitationSingleSelectEnumSchema | McpElicitationMultiSelectEnumSchema

/** Single-select: either untitled (`enum: string[]`) or titled (`oneOf: ConstOption[]`). */
export type McpElicitationSingleSelectEnumSchema = {
  type: 'string'
  title?: string
  description?: string
  default?: string
  enum?: Array<string>
  oneOf?: Array<McpElicitationConstOption>
}

/** Multi-select: either untitled (`items.enum`) or titled (`items.anyOf`). */
export type McpElicitationMultiSelectEnumSchema = {
  type: 'array'
  title?: string
  description?: string
  minItems?: number
  maxItems?: number
  default?: Array<string>
  items: { type: 'string'; enum: Array<string> } | { anyOf: Array<McpElicitationConstOption> }
}

export type McpElicitationConstOption = {
  const: string
  title: string
}
