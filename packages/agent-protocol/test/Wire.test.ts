import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import {
  ApplicationErrorCodeSchema,
  JsonValueSchema,
  LimitSchema,
  RpcResponseSchema,
  SequenceSchema,
} from '../src/index'

describe('protocol wire primitives', () => {
  test('accepts recursive JSON but rejects non-JSON values', () => {
    const decode = Schema.decodeUnknownSync(JsonValueSchema)
    expect(decode({ nested: [1, true, null, 'value'] })).toEqual({
      nested: [1, true, null, 'value'],
    })
    expect(() => decode({ invalid: undefined })).toThrow()
  })

  test('bounds list limits and durable sequences', () => {
    const limit = Schema.decodeUnknownSync(LimitSchema)
    const sequence = Schema.decodeUnknownSync(SequenceSchema)
    expect(limit(1)).toBe(1)
    expect(limit(500)).toBe(500)
    expect(() => limit(0)).toThrow()
    expect(() => limit(501)).toThrow()
    expect(sequence(0)).toBe(0)
    expect(() => sequence(-1)).toThrow()
  })

  test('keeps application errors and JSON-RPC envelopes structured', () => {
    expect(Schema.decodeUnknownSync(ApplicationErrorCodeSchema)('CONFLICT')).toBe('CONFLICT')
    const response = Schema.decodeUnknownSync(RpcResponseSchema)({
      jsonrpc: '2.0',
      id: 'request:1',
      error: {
        code: -32000,
        message: 'conflict',
        data: { code: 'CONFLICT', retryable: false },
      },
    })
    expect(response).toMatchObject({ id: 'request:1', error: { data: { code: 'CONFLICT' } } })
  })
})
