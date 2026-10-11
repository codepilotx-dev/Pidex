import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import { NonNegativeIntSchema, OpaqueIDSchema, OperationParamsSchema } from '../wire/Primitives'

/** Per-thread monotonic bookmark collection version; 0 means "no bookmarks yet". */
const BookmarkVersionSchema = NonNegativeIntSchema

const BookmarkErrors = [
  'THREAD_NOT_FOUND',
  'INPUT_NOT_FOUND',
  'OPERATION_ID_CONFLICT',
  'CONFLICT',
  'INVALID_REQUEST',
  'INTERNAL_ERROR',
] as const

export const ThreadBookmarksListParamsSchema = Schema.Struct({ threadId: OpaqueIDSchema })
export const ThreadBookmarksListResultSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  inputIds: Schema.Array(OpaqueIDSchema),
  version: BookmarkVersionSchema,
})

export const ThreadBookmarksSetParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  inputId: OpaqueIDSchema,
  bookmarked: Schema.Boolean,
  /** The caller's last observed collection version; a mismatch is a CONFLICT. */
  expectedVersion: BookmarkVersionSchema,
  ...OperationParamsSchema.fields,
})
export const ThreadBookmarksSetResultSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  inputIds: Schema.Array(OpaqueIDSchema),
  version: BookmarkVersionSchema,
})

export const ThreadBookmarkRpcMethods = {
  'thread/bookmarks/list': defineMethod({
    params: ThreadBookmarksListParamsSchema,
    result: ThreadBookmarksListResultSchema,
    errors: BookmarkErrors,
    capability: 'thread.bookmarks.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'thread/bookmarks/set': defineMethod({
    params: ThreadBookmarksSetParamsSchema,
    result: ThreadBookmarksSetResultSchema,
    errors: BookmarkErrors,
    capability: 'thread.bookmarks.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type ThreadBookmarkRpcMethodMap = typeof ThreadBookmarkRpcMethods
