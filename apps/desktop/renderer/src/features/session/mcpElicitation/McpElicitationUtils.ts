import type {
  McpElicitationBooleanSchema,
  McpElicitationConstOption,
  McpElicitationEnumSchema,
  McpElicitationMultiSelectEnumSchema,
  McpElicitationNumberSchema,
  McpElicitationPrimitiveSchema,
  McpElicitationSchema,
  McpElicitationSingleSelectEnumSchema,
  McpElicitationStringSchema,
} from './McpElicitationTypes.js'

// ── Schema parsing ───────────────────────────────────────────

/**
 * Validate and parse raw `requestedSchema` from an MCP elicitation
 * request. Returns `null` when the value is missing or does not
 * match the expected object-schema shape.
 */
export function parseMcpElicitationSchema(raw: unknown): McpElicitationSchema | null {
  if (!raw || typeof raw !== 'object') return null

  const obj = raw as Record<string, unknown>
  if (obj.type !== 'object') return null

  const properties = obj.properties
  if (!properties || typeof properties !== 'object') return null

  const parsed: McpElicitationSchema = {
    $schema: typeof obj.$schema === 'string' ? obj.$schema : undefined,
    type: 'object',
    properties: {},
    required: Array.isArray(obj.required)
      ? obj.required.filter((r): r is string => typeof r === 'string')
      : undefined,
  }

  const propKeys = Object.keys(properties)
  for (const key of propKeys) {
    const prop = (properties as Record<string, unknown>)[key]
    const field = parsePrimitiveSchema(prop)
    if (field) {
      parsed.properties[key] = field
    }
    // Silently skip unrecognised field schemas
  }

  return Object.keys(parsed.properties).length > 0 || propKeys.length === 0 ? parsed : null
}

// ── Field-level parsing ──────────────────────────────────────

function parsePrimitiveSchema(raw: unknown): McpElicitationPrimitiveSchema | null {
  if (!raw || typeof raw !== 'object') return null

  const obj = raw as Record<string, unknown>
  const type = obj.type

  if (type === 'string') {
    return parseStringOrEnumSchema(obj)
  }
  if (type === 'number' || type === 'integer') {
    return parseNumberSchema(obj)
  }
  if (type === 'boolean') {
    return parseBooleanSchema(obj)
  }
  if (type === 'array') {
    return parseMultiSelectSchema(obj)
  }

  return null
}

function parseStringOrEnumSchema(
  obj: Record<string, unknown>,
): McpElicitationStringSchema | McpElicitationSingleSelectEnumSchema {
  // Has enum/oneOf options → treat as single-select
  if (Array.isArray(obj.enum) || Array.isArray(obj.oneOf)) {
    return {
      type: 'string',
      title: optionalString(obj.title),
      description: optionalString(obj.description),
      default: optionalString(obj.default),
      enum: Array.isArray(obj.enum)
        ? obj.enum.filter((e): e is string => typeof e === 'string')
        : undefined,
      oneOf: Array.isArray(obj.oneOf) ? parseConstOptions(obj.oneOf) : undefined,
    }
  }

  // Plain string
  return {
    type: 'string',
    title: optionalString(obj.title),
    description: optionalString(obj.description),
    minLength: optionalNumber(obj.minLength),
    maxLength: optionalNumber(obj.maxLength),
    format: optionalString(obj.format) as 'email' | 'uri' | 'date' | 'date-time' | undefined,
    default: optionalString(obj.default),
  }
}

function parseNumberSchema(obj: Record<string, unknown>): McpElicitationNumberSchema {
  return {
    type: obj.type === 'integer' ? 'integer' : 'number',
    title: optionalString(obj.title),
    description: optionalString(obj.description),
    minimum: optionalNumber(obj.minimum),
    maximum: optionalNumber(obj.maximum),
    default: optionalNumber(obj.default),
  }
}

function parseBooleanSchema(obj: Record<string, unknown>): McpElicitationBooleanSchema {
  return {
    type: 'boolean',
    title: optionalString(obj.title),
    description: optionalString(obj.description),
    default: typeof obj.default === 'boolean' ? obj.default : undefined,
  }
}

function parseMultiSelectSchema(
  obj: Record<string, unknown>,
): McpElicitationMultiSelectEnumSchema | null {
  const items = obj.items
  if (!items || typeof items !== 'object') return null

  const itemsObj = items as Record<string, unknown>

  // Titled multi-select: items.anyOf
  if (Array.isArray(itemsObj.anyOf)) {
    return {
      type: 'array',
      title: optionalString(obj.title),
      description: optionalString(obj.description),
      minItems: optionalNumber(obj.minItems),
      maxItems: optionalNumber(obj.maxItems),
      default: Array.isArray(obj.default)
        ? obj.default.filter((d): d is string => typeof d === 'string')
        : undefined,
      items: {
        anyOf: parseConstOptions(itemsObj.anyOf),
      },
    }
  }

  // Untitled multi-select: items.type === 'string' && items.enum
  if (itemsObj.type === 'string' && Array.isArray(itemsObj.enum)) {
    return {
      type: 'array',
      title: optionalString(obj.title),
      description: optionalString(obj.description),
      minItems: optionalNumber(obj.minItems),
      maxItems: optionalNumber(obj.maxItems),
      default: Array.isArray(obj.default)
        ? obj.default.filter((d): d is string => typeof d === 'string')
        : undefined,
      items: {
        type: 'string',
        enum: itemsObj.enum.filter((e: unknown): e is string => typeof e === 'string'),
      },
    }
  }

  return null
}

function parseConstOptions(arr: unknown[]): McpElicitationConstOption[] {
  return arr
    .filter(
      (item): item is McpElicitationConstOption =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).const === 'string' &&
        typeof (item as Record<string, unknown>).title === 'string',
    )
    .map((item) => ({
      const: (item as Record<string, unknown>).const as string,
      title: (item as Record<string, unknown>).title as string,
    }))
}

// ── Default value extraction ─────────────────────────────────

export function getFieldDefault(schema: McpElicitationPrimitiveSchema): unknown {
  switch (schema.type) {
    case 'string':
      return schema.default ?? ''
    case 'number':
    case 'integer':
      return schema.default ?? null
    case 'boolean':
      return schema.default ?? false
    case 'array':
      return schema.default ?? []
    default:
      return null
  }
}

// ── Field validation ─────────────────────────────────────────

export function validateField(
  schema: McpElicitationPrimitiveSchema,
  value: unknown,
  required: boolean,
): string | null {
  // Required check
  if (required && isEmptyValue(value, schema)) {
    return '此字段为必填项'
  }
  if (isEmptyValue(value, schema)) {
    return null
  }

  switch (schema.type) {
    case 'string': {
      // Single-select enums have no length constraints; choice is validated
      // by the radio/select UI itself.
      if (isSingleSelectEnum(schema)) return null
      const strSchema = schema as McpElicitationStringSchema
      const str = String(value ?? '')
      if (strSchema.minLength !== undefined && str.length < strSchema.minLength) {
        return `最少需要 ${strSchema.minLength} 个字符`
      }
      if (strSchema.maxLength !== undefined && str.length > strSchema.maxLength) {
        return `最多 ${strSchema.maxLength} 个字符`
      }
      return null
    }
    case 'number':
    case 'integer': {
      const num = Number(value)
      if (Number.isNaN(num)) return '请输入有效数字'
      if (schema.minimum !== undefined && num < schema.minimum) {
        return `最小值 ${schema.minimum}`
      }
      if (schema.maximum !== undefined && num > schema.maximum) {
        return `最大值 ${schema.maximum}`
      }
      if (schema.type === 'integer' && !Number.isInteger(num)) {
        return '请输入整数'
      }
      return null
    }
    case 'boolean': {
      return typeof value === 'boolean' ? null : '请选择'
    }
    case 'array': {
      if (!Array.isArray(value)) return '请选择至少一个选项'
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        return `至少选择 ${schema.minItems} 项`
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        return `最多选择 ${schema.maxItems} 项`
      }
      return null
    }
    default:
      return null
  }
}

function isEmptyValue(value: unknown, schema: McpElicitationPrimitiveSchema): boolean {
  if (value === null || value === undefined) return true
  if (
    (schema.type === 'string' || schema.type === 'number' || schema.type === 'integer') &&
    value === ''
  )
    return true
  if (schema.type === 'array' && Array.isArray(value) && value.length === 0) return true
  return false
}

// ── Mode detection ───────────────────────────────────────────

/**
 * Detect whether a raw MCP elicitation request should be rendered
 * as a fillable form or as an unsupported-mode safe fallback.
 */
export function getSchemaMode(
  rawRequest: Record<string, unknown> | undefined,
): 'form' | 'unsupported' {
  if (!rawRequest || typeof rawRequest !== 'object') return 'unsupported'

  const mode = rawRequest.mode

  // Only "form" mode with a valid schema gets the interactive form
  if (mode === 'form' || mode === undefined) {
    const schema = parseMcpElicitationSchema(rawRequest.requestedSchema)
    return schema ? 'form' : 'unsupported'
  }

  // "openai/form", "url", missing, or unknown → unsupported
  return 'unsupported'
}

// ── Helpers ──────────────────────────────────────────────────

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && !Number.isNaN(value) ? value : undefined
}

/** Type guard: is the string-typed schema a single-select enum? */
function isSingleSelectEnum(schema: McpElicitationPrimitiveSchema): boolean {
  if (schema.type !== 'string') return false
  const maybe = schema as unknown as McpElicitationSingleSelectEnumSchema
  return Array.isArray(maybe.enum) || Array.isArray(maybe.oneOf)
}
