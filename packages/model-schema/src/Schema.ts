import { Option, Schema, SchemaGetter } from 'effect'

export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const optional = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(schema).pipe(
    Schema.decodeTo(Schema.optional(Schema.toType(schema)), {
      decode: SchemaGetter.passthrough({ strict: false }),
      encode: SchemaGetter.transformOptional(Option.filter((value) => value !== undefined)),
    }),
  )

export const statics =
  <S extends object, M extends Record<string, unknown>>(methods: (schema: S) => M) =>
  (schema: S): S & M =>
    Object.assign(schema, methods(schema))
