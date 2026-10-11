# Thread RPC v4 contract inventory

Status: Accepted

Depends on: [Thread RPC v4 architecture](./rpc-v4.md)

Baseline: [Pidex v2 stability baseline](./v2-baseline.md)

## Purpose

This inventory is the implementation contract for
`@pidex/agent-protocol`. It covers every v2 RPC method and event and states
its v3 disposition. Exact Effect Schema syntax is deferred to the protocol
package, but method names, ownership, result shapes, durability, and migration
rules are fixed here for review.

## Contract conventions

- All entity IDs are non-empty opaque strings. The protocol does not infer
  entity type from UUID format.
- Timestamps are Unix epoch milliseconds.
- Query cursors are opaque strings and are specific to a method and filter set.
- Event cursors are per-stream non-negative durable sequences and are never
  reused as query cursors. Live events do not advance them.
- List methods accept `cursor?` and a bounded `limit?`; results return
  `{ items, nextCursor }` using a domain-specific item property where useful.
- Mutations that can be retried accept an `operationId`. `turn/start` uses the
  stronger `inputId` admission contract.
- Every result is an object. Empty success is `{ ok: true }` or a more specific
  terminal value, never `undefined`.
- Schema decoders reject unknown enum variants. Additive object fields remain
  forward-compatible unless a security-sensitive schema opts into exact mode.
- Secret inputs are write-only and are absent from results, events, errors, and
  logs.

### Declared application error sets

| Method family                        | Declared stable application errors                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Initialization and capability checks | `PROTOCOL_VERSION_UNSUPPORTED`, `CAPABILITY_REQUIRED`, `UNAUTHORIZED`                                                         |
| Event subscription                   | `CURSOR_EXPIRED`, `SUBSCRIPTION_NOT_FOUND`, `SUBSCRIPTION_OVERFLOW`, `CAPABILITY_REQUIRED`                                    |
| Interaction resolution               | `REQUEST_NOT_PENDING`, `CONFLICT`, `CHECKPOINT_UNAVAILABLE`, `CAPABILITY_REQUIRED`                                            |
| Project and workspace                | `PROJECT_NOT_FOUND`, `PATH_DENIED`, `CONFLICT`                                                                                |
| Thread, prompt, and Turn             | `THREAD_NOT_FOUND`, `TURN_NOT_FOUND`, `CONFLICT`, `CHECKPOINT_UNAVAILABLE`, `MODEL_UNAVAILABLE`                               |
| Sandbox and tools                    | `SANDBOX_UNAVAILABLE`, `PERMISSION_DENIED`, `CONFLICT`                                                                        |
| Attachment and memory                | `ATTACHMENT_NOT_FOUND`, `ATTACHMENT_LIMIT`, `MEMORY_NOT_FOUND`, `MEMORY_REJECTED`, `PERMISSION_DENIED`                        |
| Subagent and workspace operations    | `SUBAGENT_NOT_FOUND`, `WORKSPACE_CONFLICT`, `PERMISSION_DENIED`, `CONFLICT`                                                   |
| Model, provider, and auth            | `MODEL_UNAVAILABLE`, `PROVIDER_NOT_FOUND`, `PROVIDER_UNAVAILABLE`, `CREDENTIAL_NOT_FOUND`, `AUTHORIZATION_FAILED`, `CONFLICT` |

All families may return `RATE_LIMITED` or a sanitized `INTERNAL_ERROR`. Schema
validation failures use JSON-RPC `-32602` instead of a domain error.

## Connection and control

| Method                    | Params                                                                                                    | Result                                                               | Notes                                                                                                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initialize`              | `clientInfo`, supported `protocols`, requested `capabilities`, interaction delivery `active` or `observe` | selected protocol, server info, capabilities, limits, `connectionId` | First request on every connection. Selects `thread-rpc-v4`.                                                                                                                                                            |
| `initialized`             | negotiated protocol and optional restored client instance ID                                              | none; client notification                                            | Opens the connection for normal calls and server requests.                                                                                                                                                             |
| `shutdown`                | `operationId`                                                                                             | `{ ok, acceptedAt }`                                                 | Requires `agent.shutdown` and desktop-managed Agent capability.                                                                                                                                                        |
| `event/subscribe`         | array of `{ streamId, after: number \| "latest" }`, optional live event filters                           | `subscriptionId`, per-stream high-watermarks                         | A number resumes durable replay; `"latest"` is normalized to the captured high-watermark for snapshot-aligned live tailing. After `CURSOR_EXPIRED`, clients reconcile authoritative snapshots before using `"latest"`. |
| `event/ack`               | `subscriptionId`, per-stream acknowledged durable positions                                               | acknowledged positions                                               | Controls connection backpressure; does not delete events.                                                                                                                                                              |
| `event/unsubscribe`       | `subscriptionId`                                                                                          | `{ ok }`                                                             | Idempotent.                                                                                                                                                                                                            |
| `interaction/listPending` | optional `threadId`, `kinds`, query cursor, limit                                                         | page of pending interactions                                         | Required after reconnect and before enabling interaction UI.                                                                                                                                                           |
| `interaction/respond`     | `interactionId`, `expectedVersion`, typed response, `operationId`                                         | terminal interaction state                                           | Recovery and multi-client response path. First valid response wins.                                                                                                                                                    |

Transport-native WebSocket ping/pong is used for liveness. It is not a durable
domain event and does not enter the RPC method map.

## Project methods

| Method                    | Params                                           | Result                             | V2 disposition                                          |
| ------------------------- | ------------------------------------------------ | ---------------------------------- | ------------------------------------------------------- |
| `project/list`            | query cursor, limit                              | `{ projects, nextCursor }`         | Keep; add real pagination.                              |
| `project/open`            | `rootPath`, `operationId`                        | `{ project }`                      | Keep; canonicalize and authorize path in Agent service. |
| `project/settings/update` | `projectId`, typed settings patch, `operationId` | `{ projectId, settings, version }` | Rename v2 `project/updateSettings`.                     |

Desktop window and application preferences are not Project methods.
`desktop/settings/get` and `desktop/settings/save` remain v2 compatibility calls
until their consumers move to the typed Electron desktop contract; they are not
exported by `@pidex/agent-protocol` v3.

## Thread, prompt, and Turn methods

| Method                   | Params                                                                                  | Result                                                                     | V2 disposition                                                    |
| ------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `thread/list`            | `projectId?`, `archived?`, query cursor, limit                                          | `{ threads, nextCursor }`                                                  | Keep; replace fixed `nextCursor: null`.                           |
| `thread/create`          | `projectId`, `title?`, typed settings, `operationId`                                    | `{ snapshot, streamPosition }`                                             | Keep; position supports immediate subscription catch-up.          |
| `thread/read`            | `threadId`                                                                              | `{ snapshot, streamPosition }`                                             | Keep; position supports snapshot plus event catch-up.             |
| `thread/update`          | `threadId`, title/archive patch, `expectedVersion?`, `operationId`                      | `{ thread }`                                                               | Keep with optimistic version support.                             |
| `thread/settings/update` | `threadId`, typed settings patch, `expectedVersion?`, `operationId`                     | `{ threadId, settings, version }`                                          | Keep.                                                             |
| `thread/delete`          | `threadId`, `operationId`                                                               | `{ threadId, deletedAt }`                                                  | Keep; idempotent tombstone result.                                |
| `prompt/preview`         | `threadId`                                                                              | `{ threadId, preview, cacheKey }`                                          | Keep; preview is reconstructed from persisted snapshot.           |
| `prompt/refresh`         | `threadId`, `operationId`                                                               | `{ threadId, settings, cacheKey }`                                         | Keep.                                                             |
| `thread/compact`         | `threadId`, `operationId`                                                               | `{ compaction }`                                                           | Keep; compaction result identifies new durable context baseline.  |
| `turn/start`             | `threadId`, client `inputId`, content, model, permission config, task mode, attachments | durable admission with `inputId`, `turnId`, `disposition`, stream sequence | Remove `strategy`; commit admission before wake.                  |
| `turn/steer`             | `threadId`, `turnId`, client `inputId`, content, attachments                            | durable steer admission and disposition                                    | Replaces v2 `strategy: "guide"`. Requires active compatible Turn. |
| `turn/interrupt`         | `threadId`, optional `turnId`, `operationId`                                            | `{ threadId, turnId?, status }`                                            | Keep; terminal or already-terminal response is idempotent.        |
| `turn/resume`            | `threadId`, `turnId`, `operationId`                                                     | `{ threadId, turnId, status }`                                             | Keep as checkpoint recovery operation, not general retry.         |

V2 `turn/submitPlanDecision` is removed. Plan output is regular assistant
content and does not create a pending interaction; users continue by sending a
new Turn.

`turn/start` canonical admission data includes all fields that can change model
behavior. Attachments must be validated and bound in the same admission
transaction or the admission must fail without waking execution.

## Sandbox methods

| Method              | Params                         | Result        | Notes                                          |
| ------------------- | ------------------------------ | ------------- | ---------------------------------------------- |
| `sandbox/status`    | none                           | `{ sandbox }` | Read-only.                                     |
| `sandbox/install`   | `operationId`                  | `{ sandbox }` | Privileged Agent operation.                    |
| `sandbox/repair`    | `operationId`                  | `{ sandbox }` | Separate method despite shared implementation. |
| `sandbox/uninstall` | `confirm: true`, `operationId` | `{ sandbox }` | Exact security-sensitive params schema.        |

Sandbox command escalation remains an Approval interaction bound to the final
command, cwd, permissions, and invocation hash. It is not a generic sandbox
method accepting an arbitrary token and command pair.

## Attachment methods

| Method              | Params                                                                          | Result                                     | Notes                                                                      |
| ------------------- | ------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `attachment/import` | bounded text/image uploads with name, media type, encoding, data; `operationId` | `{ attachments }`                          | Transport adapters may add binary framing later; logical schema is stable. |
| `attachment/read`   | `attachmentId`, optional byte/text range                                        | attachment metadata, data, encoding, range | Add bounded reads for large text and future remote clients.                |

Attachment binding remains an Agent-owned state transition and cannot be
performed by a desktop-only API.

## Memory methods

| Method          | Params                                                      | Result                    | Notes                                                     |
| --------------- | ----------------------------------------------------------- | ------------------------- | --------------------------------------------------------- |
| `memory/list`   | scope, project identity when required, query cursor, limit  | `{ entries, nextCursor }` | Project identity is resolved and authorized by the Agent. |
| `memory/read`   | memory ID, scope, project identity when required            | `{ entry }`               | Never accepts an arbitrary filesystem path.               |
| `memory/save`   | memory ID?, scope, project identity, content, `operationId` | `{ entry }`               | Secret scrub and atomic file update remain mandatory.     |
| `memory/delete` | memory ID, scope, project identity, `operationId`           | `{ deleted, id }`         | Idempotent.                                               |
| `memory/reset`  | scope, project identity, `includeEventLog`, `operationId`   | `{ deleted }`             | Exact scope authorization.                                |

## Subagent methods

| Method                       | Params                                                                        | Result                                          | Notes                                                       |
| ---------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| `subagent/list`              | parent `threadId`, query cursor, limit                                        | `{ subagents, nextCursor }`                     | Keep.                                                       |
| `subagent/read`              | `taskId`                                                                      | task, current run, child snapshot, capabilities | Keep; capabilities are typed booleans.                      |
| `subagent/send`              | `taskId`, message, model?, permission config?, attachments?, client `inputId` | durable admission                               | Replace generic `requestId` with input admission semantics. |
| `subagent/stop`              | `taskId`, `operationId`                                                       | task/run terminal state                         | Keep and make retry-exact.                                  |
| `subagent/retry`             | `taskId`, `operationId`                                                       | new run and admission                           | Keep.                                                       |
| `subagent/worktree/diff`     | `taskId`, bounded diff options                                                | `{ diff, truncated }`                           | Keep; bounded output.                                       |
| `subagent/worktree/apply`    | `taskId`, `operationId`                                                       | `{ result }`                                    | Keep workspace ownership checks.                            |
| `subagent/worktree/discard`  | `taskId`, `operationId`                                                       | `{ result }`                                    | Keep workspace ownership checks.                            |
| `subagent/workspace/restore` | `taskId`, `operationId`                                                       | `{ result }`                                    | Keep baseline/ref validation.                               |

## Model, provider, credential, and auth methods

| Method                           | Params                                                          | Result                                  | Notes                                                                              |
| -------------------------------- | --------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| `model/list`                     | optional provider/filter query                                  | typed model catalog and catalog version | Keep.                                                                              |
| `model/refresh`                  | `operationId`                                                   | typed model catalog and catalog version | Keep.                                                                              |
| `model/setDefault`               | model reference or null, `operationId`                          | effective default and settings version  | Keep; validate model before commit.                                                |
| `model/setReviewer`              | model reference or null, `operationId`                          | effective reviewer and settings version | Keep.                                                                              |
| `provider/test`                  | provider ID                                                     | typed test result                       | Keep; errors are scrubbed.                                                         |
| `provider/create`                | complete custom Provider definition, `operationId`              | provider ID and catalog version         | Custom Provider IDs are immutable.                                                 |
| `provider/update`                | provider ID, complete builtin/custom definition, `operationId`  | provider ID and catalog version         | Built-ins only accept enablement and model filters.                                |
| `provider/delete`                | custom provider ID, `operationId`                               | deletion result and catalog version     | Rejects default/reviewer references; credentials and historical references remain. |
| `provider/model/discover`        | provider ID and target API                                      | bounded candidate list                  | OpenAI-compatible endpoints only; confirmation is separate.                        |
| `provider/credential/list`       | optional provider ID                                            | safe API Key/OAuth summaries            | Reconciliation authority for active credentials.                                   |
| `provider/credential/setActive`  | provider ID and credential ID                                   | updated summaries                       | Manual selection only; failures never switch credentials.                          |
| `provider/credential/setEnabled` | credential ID and enabled flag                                  | updated summaries                       | Disabling the active credential clears the binding.                                |
| `provider/credential/delete`     | credential ID, `operationId`                                    | updated summaries                       | Deleting the active credential clears the binding.                                 |
| `provider/apiKey/create`         | provider ID, label, write-only key, `operationId`               | safe credential summary                 | Never echoes key material.                                                         |
| `provider/apiKey/update`         | credential ID, label and optional write-only key, `operationId` | safe credential summary                 | Preserves the active binding.                                                      |
| `provider/apiKey/reorder`        | provider ID and ordered credential IDs, `operationId`           | safe summaries                          | Order is display-only, never request routing.                                      |
| `provider/apiKey/test`           | credential ID                                                   | explicit test result                    | Test failures never change the active binding.                                     |
| `auth/session/start`             | Provider or usage target, `operationId`                         | auth session snapshot                   | Pi owns the OAuth protocol and prompt flow.                                        |
| `auth/session/respond`           | session ID, prompt ID and typed response                        | auth session snapshot                   | Secret responses are never persisted or emitted.                                   |
| `auth/session/status`            | session ID                                                      | auth session snapshot                   | Reconciliation source after reconnect.                                             |
| `auth/session/cancel`            | session ID, `operationId`                                       | terminal auth session snapshot          | Dialog/window closure cancels the session.                                         |

## Server requests

Server requests use persisted interaction IDs as JSON-RPC request IDs. Their
result schemas are also accepted by `interaction/respond`.

| Method              | Params                                                                                                          | Client result                                                         | Persistence                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| `approval/request`  | interaction metadata, Thread/Turn/Agent/tool IDs, risk, reason, requested permissions, allowed choices, version | decision `allow-once`, `deny`, or `stop`; optional safe remember rule | Request, checkpoint, and resolution are durable.    |
| `question/request`  | interaction metadata, one or more typed questions, answer constraints, version                                  | typed answers or `ignored`                                            | Request, answer, and resume checkpoint are durable. |
| `hookTrust/request` | interaction metadata, canonical config path, SHA-256, Hook summary, version                                     | `allow` or `block`                                                    | Trust decision is bound to path/hash and durable.   |

Every server request includes `interactionId`, `kind`, `threadId`, `turnId`,
`agentId`, `createdAt`, and `version`. Tool or Hook details are additive typed
fields. Secret values, raw environment blocks, and opaque model RunState are
never included.

## Server notifications

These notifications control a connection and are not domain events:

| Method                     | Payload                                         | Meaning                                                         |
| -------------------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| `event/next`               | `subscriptionId` and typed event envelope       | Delivers replayed or live event.                                |
| `event/replayComplete`     | `subscriptionId`, stream positions              | All requested streams reached their captured high-watermarks.   |
| `event/subscriptionClosed` | `subscriptionId`, stable reason, last positions | Subscription ended; overflow requires cursor-based resubscribe. |

## Event manifest

Version starts at 1 for the first v3 schema. A payload shape change that cannot
be decoded by the old schema requires a new version. Event type strings remain
stable across versions.

| Event type                       | Stream | Durability | Authority and v2 disposition                                                          |
| -------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------- |
| `thread/created`                 | Global | Durable    | Complete Thread summary for directory synchronization; keep.                          |
| `thread/updated`                 | Global | Durable    | Complete updated Thread summary for directory synchronization; keep.                  |
| `thread/settings/updated`        | Thread | Durable    | Effective settings and version; keep.                                                 |
| `thread/prompt-settings/updated` | Thread | Durable    | Prompt snapshot/cache identity, not secret prompt content; keep.                      |
| `thread/deleted`                 | Global | Durable    | Tombstone with deletion time for directory synchronization; keep.                     |
| `turn/queued`                    | Thread | Durable    | Complete queued Turn summary; keep.                                                   |
| `turn/started`                   | Thread | Durable    | Complete started Turn summary; keep.                                                  |
| `turn/statusChanged`             | Thread | Durable    | Complete current status and reason; keep.                                             |
| `turn/completed`                 | Thread | Durable    | Complete terminal Turn summary; keep.                                                 |
| `turn/failed`                    | Thread | Durable    | Sanitized terminal failure and Turn summary; keep.                                    |
| `turn/interrupted`               | Thread | Durable    | Terminal reason and recovery metadata; keep.                                          |
| `agent/upserted`                 | Thread | Durable    | Complete Agent execution projection; keep.                                            |
| `subagent/created`               | Thread | Durable    | Complete task/run projection; keep.                                                   |
| `subagent/updated`               | Thread | Durable    | Complete task/run projection; keep.                                                   |
| `subagent/workspaceUpdated`      | Thread | Durable    | Workspace state/result projection; keep.                                              |
| `item/started`                   | Thread | Durable    | Complete started Item projection; keep.                                               |
| `item/completed`                 | Thread | Durable    | Complete authoritative Item projection; keep.                                         |
| `item/agentMessage/delta`        | Thread | Live       | Display-only text delta; final Item is authoritative.                                 |
| `reasoning/textDelta`            | Thread | Live       | Display-only reasoning delta.                                                         |
| `reasoning/summaryPartAdded`     | Thread | Live       | Display-only structure; completed Item is authoritative.                              |
| `reasoning/summaryTextDelta`     | Thread | Live       | Display-only summary delta.                                                           |
| `plan/delta`                     | Thread | Live       | Display-only plan delta.                                                              |
| `turn/plan/updated`              | Thread | Durable    | Complete execution-plan Item projection; the newest snapshot is authoritative.        |
| `tool/callStarted`               | Thread | Durable    | Tool identity, sanitized input summary, and Item state.                               |
| `tool/outputDelta`               | Thread | Live       | Bounded display output; final tool Item is authoritative.                             |
| `tool/callCompleted`             | Thread | Durable    | Complete sanitized terminal Tool Item.                                                |
| `tool/error`                     | Thread | Durable    | Complete sanitized terminal Tool Item and stable error.                               |
| `approval/requested`             | Thread | Durable    | Audit/projection event paired with `approval/request`.                                |
| `approval/cancelled`             | Thread | Durable    | Terminal cancellation and reason.                                                     |
| `question/requested`             | Thread | Durable    | Audit/projection event paired with `question/request`.                                |
| `interaction/resolved`           | Thread | Durable    | Safe terminal `{ result, resolvedAt }`; hydrate/reconciliation remains authoritative. |
| `context/compacted`              | Thread | Durable    | Old/new context baseline identity and compaction result.                              |
| `context/recoveryRequired`       | Thread | Durable    | Side-effect evidence and recovery requirement, scrubbed.                              |
| `hook/trust/requested`           | Thread | Durable    | Audit/projection event paired with `hookTrust/request`.                               |
| `hook/trust/resolved`            | Thread | Durable    | Bound path/hash decision and resumed state.                                           |
| `queue/updated`                  | Thread | Durable    | Complete queue projection, not only an incremental action.                            |
| `catalog/updated`                | Global | Live       | Invalidation only; `model/list` plus catalog version reconciles.                      |
| `provider/credential/updated`    | Global | Live       | Invalidation only; `provider/credential/list` reconciles.                             |
| `auth/session/updated`           | Global | Live       | Safe auth-session invalidation/status; `auth/session/status` reconciles.              |

V2 `thread/snapshot` is removed from the event manifest. Snapshots are query
results with a stream position, not historical events. V2 `heartbeat` is
replaced by transport ping/pong and subscription control notifications.

## Capability names

The first v3 capability registry includes:

- `rpc.typed.v1`
- `events.replay.v1`
- `events.live.v1`
- `interactions.serverRequests.v1`
- `interaction.recovery.v1`
- `turn.admission.v1`
- `turn.steer.v1`
- `turn.resume.v1`
- `attachments.v1`
- `memory.v2`
- `context.compact.v1`
- `hooks.trust.v1`
- `subagents.v1`
- `sandbox.management.v1`
- `agent.shutdown.v1`
- `prompt.preview.sensitive.v1`
- `prompt.refresh.v1`
- `provider.config.pi.v1`
- `provider.auth.pi.v1`

Capabilities are negotiated, not inferred from client type. A method requiring
an unavailable capability fails with `CAPABILITY_REQUIRED` before mutation.

## Migration map

| V2 surface                                   | V3 surface                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| Method name enum plus unknown params/results | `RpcMethodMap` with schemas for params, result, and errors                             |
| Caller-supplied `call<T>(method)` cast       | Generated/inferred typed client                                                        |
| Hand-written router string switch boundary   | Generated typed dispatcher registration                                                |
| SSE `id:` cursor                             | Durable event envelope `streamId + sequence`; live events use `afterSequence`          |
| One global event row ID                      | Globally unique `eventId` plus per-stream gap-free sequence                            |
| All notifications persisted                  | Manifest-declared durable events; bounded live deltas                                  |
| `turn/start strategy: guide`                 | `turn/steer`                                                                           |
| `turn/submitPlanDecision`                    | Removed; Plan is regular assistant content and the next user message starts a new Turn |
| `approval/respond`                           | `approval/request` response or `interaction/respond`                                   |
| `question/respond`                           | `question/request` response or `interaction/respond`                                   |
| `hook/trust/respond`                         | `hookTrust/request` response or `interaction/respond`                                  |
| `serverRequest/resolved` event               | Typed `interaction/resolved` event                                                     |
| `thread/snapshot` event                      | `thread/read` result plus stream position                                              |
| `heartbeat` event                            | WebSocket ping/pong and subscription control                                           |
| `desktop/settings/*` Agent RPC               | Typed Electron desktop IPC contract                                                    |

## Acceptance record

Review accepted the following implementation constraints:

1. The event envelope and per-stream cursor model are accepted.
2. Desktop settings are intentionally outside the Agent v3 contract.
3. Interaction server requests retain the reconnect-safe generic response path.
4. `turn/steer` is separate from input admission.
5. Durable/live assignments provide an authoritative snapshot or terminal
   value for every live delta family.
6. Database v10 can implement the stream and admission constraints without
   deleting or rewriting accepted v2 history.
7. The first package establishes the complete contract while leaving Agent,
   Renderer, database, SSE, HTTP, WebSocket, and Electron runtime migration for
   later batches.
8. Effect Schema maps remain the sole truth and all public TypeScript APIs are
   inferred without generated source files.
9. V3 WebSocket frames do not support JSON-RPC batch; v2 HTTP compatibility is
   unchanged.
10. Full Prompt Preview requires `prompt.preview.sensitive.v1`, and Sandbox,
    Memory, Provider, and Compaction wires exclude internal or secret state.
