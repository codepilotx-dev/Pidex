import {
  applyEdits,
  modify,
  parse,
  printParseErrorCode,
  type FormattingOptions,
  type ParseError,
} from 'jsonc-parser'
import type { ConfigEdit, ConfigObject, ConfigValue } from './ConfigService'

export type JsoncPathSegment = string | number
export type JsoncEdit = Omit<ConfigEdit, 'keyPath'> & {
  keyPath: readonly JsoncPathSegment[]
}

export class JsoncDocumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JsoncDocumentError'
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const mergeObject = (current: ConfigObject, incoming: ConfigObject): ConfigObject => {
  const output = structuredClone(current)
  for (const [key, value] of Object.entries(incoming)) {
    const existing = output[key]
    output[key] =
      isObject(existing) && isObject(value)
        ? mergeObject(existing as ConfigObject, value as ConfigObject)
        : structuredClone(value)
  }
  return output
}

const valueAtPath = (
  config: ConfigObject,
  keyPath: readonly JsoncPathSegment[],
): ConfigValue | undefined => {
  let current: ConfigValue | ConfigObject = config
  for (const key of keyPath) {
    if (typeof key === 'number') {
      if (!Array.isArray(current) || key >= current.length) return undefined
      current = current[key]!
    } else {
      if (!isObject(current) || !(key in current)) return undefined
      current = current[key]!
    }
  }
  return current as ConfigValue
}

const withoutBom = (text: string) =>
  text.charCodeAt(0) === 0xfeff ? { bom: '\uFEFF', body: text.slice(1) } : { bom: '', body: text }

const formatError = (text: string, error: ParseError) => {
  const before = text.slice(0, error.offset)
  const line = before.split(/\r?\n/).length
  const lineStart = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'))
  const column = before.length - lineStart
  return `${printParseErrorCode(error.error)}（第 ${line} 行，第 ${column} 列）`
}

export const parseJsoncObject = (source: string): ConfigObject => {
  const { body } = withoutBom(source)
  if (!body.trim()) return {}
  const errors: ParseError[] = []
  const parsed = parse(body, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown
  if (errors.length > 0) {
    throw new JsoncDocumentError(`JSONC 语法无效：${formatError(body, errors[0]!)}`)
  }
  if (!isObject(parsed)) {
    throw new JsoncDocumentError('配置文档的根值必须是 JSON 对象')
  }
  return parsed as ConfigObject
}

const detectFormatting = (source: string): FormattingOptions => {
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const indentation = source.match(/^(?<indent>[ \t]+)\S/m)?.groups?.indent
  if (indentation?.includes('\t')) {
    return { insertSpaces: false, tabSize: 1, eol }
  }
  return {
    insertSpaces: true,
    tabSize: Math.max(1, indentation?.length ?? 2),
    eol,
  }
}

const assertKeyPath = (keyPath: readonly JsoncPathSegment[]) => {
  if (
    keyPath.length === 0 ||
    keyPath.some((part) =>
      typeof part === 'string' ? !part.trim() : !Number.isSafeInteger(part) || part < 0,
    )
  ) {
    throw new JsoncDocumentError('配置 key path 无效')
  }
}

/**
 * Adapted from OpenCode's JSONC patching approach (MIT): every edit is
 * applied to the current document so comments, ordering and unknown keys stay
 * intact instead of reserializing the whole configuration object.
 */
export const patchJsonc = (source: string, edits: readonly JsoncEdit[]): string => {
  const { bom, body: originalBody } = withoutBom(source)
  let body = originalBody.trim() ? originalBody : '{}\n'
  const formattingOptions = detectFormatting(body)

  for (const edit of edits) {
    assertKeyPath(edit.keyPath)
    const current = parseJsoncObject(body)
    const existing = valueAtPath(current, edit.keyPath)
    const replacement =
      edit.value === null
        ? undefined
        : edit.mergeStrategy === 'upsert' && isObject(existing) && isObject(edit.value)
          ? mergeObject(existing as ConfigObject, edit.value as ConfigObject)
          : edit.value
    body = applyEdits(body, modify(body, [...edit.keyPath], replacement, { formattingOptions }))
  }

  return bom + body
}

export const stringifyConfigJson = (config: ConfigObject) => `${JSON.stringify(config, null, 2)}\n`
