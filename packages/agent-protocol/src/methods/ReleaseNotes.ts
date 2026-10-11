import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import { NonEmptyStringSchema } from '../wire/Primitives'

const VersionSchema = Schema.String.check(Schema.isPattern(/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/))

const ReleaseNotesErrors = [
  'RELEASE_NOTES_NOT_PUBLIC',
  'RELEASE_NOTES_UNAVAILABLE',
  'RELEASE_NOTES_RATE_LIMITED',
  'RELEASE_NOTES_INVALID_RESPONSE',
  'INTERNAL_ERROR',
] as const

export const ReleaseNotesListParamsSchema = Schema.Struct({
  currentVersion: VersionSchema,
  refresh: Schema.optional(Schema.Boolean),
})

export const ReleaseNoteSchema = Schema.Struct({
  tagName: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  body: Schema.String,
  htmlUrl: NonEmptyStringSchema,
  publishedAt: Schema.NullOr(NonEmptyStringSchema),
  prerelease: Schema.Boolean,
})

export const ReleaseNotesListResultSchema = Schema.Struct({
  source: Schema.Literals(['github-releases', 'bundled-changelog']),
  repository: Schema.Literal('codepilotx-dev/Pidex'),
  currentVersion: VersionSchema,
  currentReleaseFound: Schema.Boolean,
  fetchedAt: NonEmptyStringSchema,
  truncated: Schema.Boolean,
  releases: Schema.Array(ReleaseNoteSchema),
})

export type ReleaseNotesListParams = typeof ReleaseNotesListParamsSchema.Type
export type ReleaseNote = typeof ReleaseNoteSchema.Type
export type ReleaseNotesListResult = typeof ReleaseNotesListResultSchema.Type

export const ReleaseNotesRpcMethods = {
  'release-notes/list': defineMethod({
    params: ReleaseNotesListParamsSchema,
    result: ReleaseNotesListResultSchema,
    errors: ReleaseNotesErrors,
    capability: 'release-notes.read.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type ReleaseNotesRpcMethod = keyof typeof ReleaseNotesRpcMethods
