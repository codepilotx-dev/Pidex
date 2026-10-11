import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import { JsonValueSchema, OpaqueIDSchema, OkResultSchema } from '../wire/Primitives'

const Url = Schema.String.check(Schema.isMaxLength(8192))
const NullableID = Schema.NullOr(OpaqueIDSchema)
export const BrowserPermissionSchema = Schema.Struct({
  origin: Url,
  decision: Schema.Literals(['allow', 'deny']),
  updatedAt: Schema.String,
})
export const BrowserTabSchema = Schema.Struct({
  historyEpoch: Schema.optional(Schema.Int),
  zoomFactor: Schema.optional(Schema.Number),
  device: Schema.optional(
    Schema.Struct({
      mode: Schema.Literals(['desktop', 'mobile', 'tablet', 'custom']),
      width: Schema.Int,
      height: Schema.Int,
    }),
  ),
  tabId: OpaqueIDSchema,
  windowId: OpaqueIDSchema,
  sourceThreadId: NullableID,
  controlThreadId: NullableID,
  url: Url,
  title: Schema.String,
  state: Schema.Literals(['parked', 'live', 'suspended', 'crashed']),
  loading: Schema.Boolean,
  busy: Schema.Boolean,
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
  generation: OpaqueIDSchema,
  documentId: OpaqueIDSchema,
  history: Schema.optional(
    Schema.Array(Schema.Struct({ url: Url, title: Schema.String })).check(Schema.isMaxLength(500)),
  ),
  historyIndex: Schema.optional(Schema.Int),
  viewport: Schema.Struct({ width: Schema.Int, height: Schema.Int }),
  panel: Schema.Literals(['right', 'bottom']),
  order: Schema.Number,
  lastUsedAt: Schema.Number,
  revision: Schema.Int,
})
export type BrowserTab = typeof BrowserTabSchema.Type
export type BrowserPermission = typeof BrowserPermissionSchema.Type
export const BrowserVisitSchema = Schema.Struct({
  id: OpaqueIDSchema,
  tabId: OpaqueIDSchema,
  sourceThreadId: NullableID,
  url: Url,
  title: Schema.String,
  visitedAt: Schema.Number,
})
export type BrowserVisit = typeof BrowserVisitSchema.Type
export const BrowserDownloadSchema = Schema.Struct({
  id: OpaqueIDSchema,
  tabId: OpaqueIDSchema,
  profileId: OpaqueIDSchema,
  runId: OpaqueIDSchema,
  fileName: Schema.String,
  url: Url,
  state: Schema.Literals(['progressing', 'paused', 'completed', 'cancelled', 'interrupted']),
  receivedBytes: Schema.Number,
  totalBytes: Schema.Number,
  startedAt: Schema.Number,
  updatedAt: Schema.Number,
  resumable: Schema.Boolean,
})
export type BrowserDownload = typeof BrowserDownloadSchema.Type
export const BrowserPreferencesSchema = Schema.Struct({
  downloadSaveMode: Schema.Literals(['downloads', 'ask']),
})
export type BrowserPreferences = typeof BrowserPreferencesSchema.Type
export const BrowserTargetSchema = Schema.Struct({
  selector: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
  ref: Schema.optional(Schema.String),
  documentId: Schema.optional(OpaqueIDSchema),
  frameId: Schema.optional(OpaqueIDSchema),
})
export const BrowserOperationSchema = Schema.Struct({
  action: Schema.Literals([
    'navigate',
    'back',
    'forward',
    'reload',
    'stop',
    'snapshot',
    'screenshot',
    'click',
    'hover',
    'fill',
    'select',
    'check',
    'key',
    'scroll',
    'dialog',
    'viewport',
  ]),
  url: Schema.optional(Url),
  target: Schema.optional(BrowserTargetSchema),
  text: Schema.optional(Schema.String.check(Schema.isMaxLength(32000))),
  key: Schema.optional(Schema.String),
  checked: Schema.optional(Schema.Boolean),
  x: Schema.optional(Schema.Number),
  y: Schema.optional(Schema.Number),
  width: Schema.optional(Schema.Int),
  height: Schema.optional(Schema.Int),
  accept: Schema.optional(Schema.Boolean),
})
export type BrowserOperation = typeof BrowserOperationSchema.Type
export const BrowserCommandSchema = Schema.Struct({
  requestId: OpaqueIDSchema,
  tabId: OpaqueIDSchema,
  generation: OpaqueIDSchema,
  operation: BrowserOperationSchema,
  allowedOrigins: Schema.Array(Schema.String),
  deniedOrigins: Schema.optional(Schema.Array(Schema.String)),
  allowAllSites: Schema.optional(Schema.Boolean),
})
export type BrowserCommand = typeof BrowserCommandSchema.Type
export const BrowserResultSchema = Schema.Struct({
  text: Schema.String,
  image: Schema.optional(
    Schema.Struct({
      mimeType: Schema.Literal('image/png'),
      data: Schema.String.check(Schema.isMaxLength(12_000_000)),
    }),
  ),
})
export type BrowserResult = typeof BrowserResultSchema.Type
const errors = [
  'INVALID_REQUEST',
  'PERMISSION_DENIED',
  'CAPABILITY_REQUIRED',
  'INTERNAL_ERROR',
] as const
const tabInput = Schema.Struct({ tabId: OpaqueIDSchema })
const emptyInput = Schema.Struct({}).check(
  Schema.makeFilter((value) => Object.keys(value).length === 0, { expected: 'an empty object' }),
)
const method = <P extends Schema.Top, R extends Schema.Top>(
  params: P,
  result: R,
  mutation = true,
  host = false,
) =>
  defineMethod({
    params,
    result,
    errors,
    capability: host ? 'browser.host.v1' : 'browser.manage.v1',
    mutation,
    exactParams: true,
    exactResult: true,
  })
export const BrowserRpcMethods = {
  'browser/history/list': defineMethod({
    params: Schema.Struct({
      query: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
      cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(1000))),
      limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
    }),
    result: Schema.Struct({
      visits: Schema.Array(BrowserVisitSchema),
      nextCursor: Schema.NullOr(Schema.String),
    }),
    errors,
    capability: 'browser.data.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'browser/history/remove': defineMethod({
    params: Schema.Struct({ id: Schema.optional(OpaqueIDSchema) }),
    result: OkResultSchema,
    errors,
    capability: 'browser.data.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'browser/downloads/list': defineMethod({
    params: emptyInput,
    result: Schema.Struct({ downloads: Schema.Array(BrowserDownloadSchema) }),
    errors,
    capability: 'browser.data.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'browser/downloads/remove': defineMethod({
    params: Schema.Struct({ id: Schema.optional(OpaqueIDSchema) }),
    result: OkResultSchema,
    errors,
    capability: 'browser.data.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'browser/preferences/get': defineMethod({
    ...method(emptyInput, BrowserPreferencesSchema, false),
    capability: 'browser.data.v1',
  }),
  'browser/preferences/set': defineMethod({
    ...method(BrowserPreferencesSchema, BrowserPreferencesSchema),
    capability: 'browser.data.v1',
  }),
  'browser/list': method(
    Schema.Struct({}).check(
      Schema.makeFilter((value) => Object.keys(value).length === 0, {
        expected: 'an empty object',
      }),
    ),
    Schema.Struct({
      tabs: Schema.Array(BrowserTabSchema),
      permissions: Schema.Array(BrowserPermissionSchema),
    }),
    false,
  ),
  'browser/create': method(
    Schema.Struct({
      tabId: OpaqueIDSchema,
      windowId: OpaqueIDSchema,
      sourceThreadId: NullableID,
      url: Url,
    }),
    BrowserTabSchema,
  ),
  'browser/close': method(tabInput, OkResultSchema),
  'browser/control': method(
    Schema.Struct({ tabId: OpaqueIDSchema, threadId: NullableID }),
    BrowserTabSchema,
  ),
  'browser/layout': method(
    Schema.Struct({
      tabId: OpaqueIDSchema,
      panel: Schema.Literals(['right', 'bottom']),
      order: Schema.Number,
    }),
    BrowserTabSchema,
  ),
  'browser/permissions': method(
    Schema.Struct({
      origin: Schema.optional(Url),
      decision: Schema.optional(Schema.Literals(['allow', 'deny', 'remove', 'clear'])),
    }),
    Schema.Struct({ permissions: Schema.Array(BrowserPermissionSchema) }),
  ),
} as const satisfies MethodMap
export const BrowserHostRpcMethods = {
  'browser/host/visit': method(
    Schema.Struct({
      windowId: OpaqueIDSchema,
      instanceId: OpaqueIDSchema,
      generation: OpaqueIDSchema,
      historyEpoch: Schema.Int,
      updateOnly: Schema.optional(Schema.Boolean),
      visit: BrowserVisitSchema,
    }),
    OkResultSchema,
    true,
    true,
  ),
  'browser/host/download': method(
    Schema.Struct({
      windowId: OpaqueIDSchema,
      instanceId: OpaqueIDSchema,
      download: BrowserDownloadSchema,
      filePath: Schema.optional(Schema.String),
    }),
    OkResultSchema,
    true,
    true,
  ),
  'browser/host/download-path': method(
    Schema.Struct({ windowId: OpaqueIDSchema, instanceId: OpaqueIDSchema, id: OpaqueIDSchema }),
    Schema.Struct({ filePath: Schema.NullOr(Schema.String) }),
    false,
    true,
  ),
  'browser/host/download-recover': method(
    Schema.Struct({
      windowId: OpaqueIDSchema,
      instanceId: OpaqueIDSchema,
      profileId: OpaqueIDSchema,
      runId: OpaqueIDSchema,
    }),
    OkResultSchema,
    true,
    true,
  ),
  'browser/host/restore': method(
    Schema.Struct({
      windowId: OpaqueIDSchema,
      instanceId: OpaqueIDSchema,
      tabId: OpaqueIDSchema,
      generation: OpaqueIDSchema,
    }),
    BrowserTabSchema,
    true,
    true,
  ),
  'browser/host/register': method(
    Schema.Struct({ windowId: OpaqueIDSchema, instanceId: OpaqueIDSchema }),
    Schema.Struct({ tabs: Schema.Array(BrowserTabSchema) }),
    true,
    true,
  ),
  'browser/host/next': method(
    Schema.Struct({ windowId: OpaqueIDSchema, instanceId: OpaqueIDSchema }),
    Schema.Struct({
      command: Schema.NullOr(BrowserCommandSchema),
      dataRevision: Schema.optional(Schema.Int),
      tabs: Schema.Array(BrowserTabSchema),
      permissions: Schema.Array(BrowserPermissionSchema),
    }),
    false,
    true,
  ),
  'browser/host/complete': method(
    Schema.Struct({
      windowId: OpaqueIDSchema,
      instanceId: OpaqueIDSchema,
      requestId: OpaqueIDSchema,
      generation: OpaqueIDSchema,
      result: Schema.optional(BrowserResultSchema),
      error: Schema.optional(Schema.String),
    }),
    OkResultSchema,
    true,
    true,
  ),
  'browser/host/report': method(
    Schema.Struct({
      windowId: OpaqueIDSchema,
      instanceId: OpaqueIDSchema,
      tabId: OpaqueIDSchema,
      generation: OpaqueIDSchema,
      patch: JsonValueSchema,
    }),
    BrowserTabSchema,
    true,
    true,
  ),
  'browser/host/release': method(
    Schema.Struct({ windowId: OpaqueIDSchema, instanceId: OpaqueIDSchema }),
    OkResultSchema,
    true,
    true,
  ),
} as const satisfies MethodMap
export type BrowserHostRpcMethodMap = typeof BrowserHostRpcMethods
