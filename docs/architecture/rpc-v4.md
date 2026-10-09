# ADR: Thread RPC v4 architecture

Status: Accepted

Date: 2026-07-16

Decision owners: Pidex Agent, protocol, Electron, and Renderer boundaries

## Context

Pidex v2 already uses HTTP JSON-RPC for commands and SSE for notifications.
It also has a SQLite event table that supports cursor replay. The principal v2
limitations are contractual and reliability-related rather than a lack of RPC:

- The shared contract strictly enumerates method names, but public `params` and
  `result` values are still `Record<string, unknown>` and `unknown`.
- The Agent uses a hand-written method switch and clients use caller-supplied
  generic casts, so server and client schemas can drift.
- The durable cursor exists in the SSE `id:` line but not in the JSON-RPC
  notification. A direct WebSocket replacement would therefore lose recovery
  metadata.
- Durable state changes and live token/progress deltas share one unversioned
  event table and cannot be distinguished from the public definition.
- Approval, question, plan, and Hook trust interactions are represented as
  notifications plus client calls rather than typed bidirectional requests.
- `turn/start` does not have a durable client input admission contract, so a
  timeout followed by a retry can create ambiguous duplicate work.
- Desktop-only settings are exposed through the Agent protocol even though they
  are not part of a multi-end Agent contract.

The local OpenCode reference is useful for schema ownership, event manifests,
durable sequence handling, admission/wake separation, and inferred clients.
The Codex app-server model is useful for initialization and bidirectional
requests. Neither transport topology is copied wholesale.

## Decision

### 1. Layering

RPC v4 is split into four layers with one-way dependencies:

```text
@pidex/agent-protocol
        |
        v
Agent typed dispatcher and application services
        |
        v
HTTP/SSE v2 compatibility | WebSocket v3 | in-process test adapters
        |
        v
Electron main bridge | browser client | future CLI client
```

`@pidex/agent-protocol` is browser-safe. It owns schemas, method maps,
server-request maps, event definitions, envelopes, errors, and capability
names. It does not import Bun, Electron, SQLite, Hono, React, or Agent services.

Package dependencies remain acyclic:

```text
@pidex/model-schema
        |
        v
@pidex/shared domain schemas
        |
        v
@pidex/agent-protocol wire contracts
        |
        v
Agent and client adapters
```

`@pidex/shared` owns domain schemas, while `@pidex/agent-protocol`
is the sole owner of v4 wire contracts. Shared must not import or re-export the
protocol package because that would create a dependency cycle.

The dispatcher owns method semantics but no transport state. Transport adapters
authenticate, decode frames, enforce connection state, call the dispatcher, and
encode results. They do not perform business mutations directly.

### 2. Wire and product versions

- JSON-RPC wire messages keep `jsonrpc: "2.0"`.
- The product protocol is identified as `thread-rpc-v4`.
- The v3 WebSocket endpoint is `/rpc/ws`.
- Every connection must complete `initialize` and then `initialized` before any
  non-initialization call, subscription, or server request.
- `initialize` exchanges client identity, supported protocol versions, and
  capabilities. The server returns the selected version, server identity,
  limits, and negotiated capabilities.
- Authentication remains a transport concern and is completed before protocol
  initialization. Credentials are never part of an event or protocol error.

### 3. Typed method contract

The protocol package defines:

```ts
type RpcMethodMap = {
  'thread/read': {
    params: ThreadReadParams
    result: ThreadReadResult
    errors: ThreadReadError
  }
}
```

The method key determines request params, result, and declared application error
codes. Unknown methods, malformed params, malformed results, and undeclared
events fail at the protocol boundary. Public clients cannot call arbitrary
strings or supply their own result type assertion.

The complete v3 contract is implemented in one browser-safe package. Effect
Schema method, server-request, and event maps are the only runtime truth;
clients, handlers, dispatcher types, event payloads, and server request types
are inferred directly from those maps. No generated source directory or code
generation step is used. Params are always JSON objects, including `{}` for
methods with no logical arguments.

Each v3 WebSocket frame contains exactly one JSON-RPC message. Batch messages
are rejected as invalid requests. This does not change the existing v2 HTTP
batch compatibility behavior.

### 4. Error model

JSON-RPC standard codes retain their standard meaning:

- `-32700`: parse error.
- `-32600`: invalid request or invalid connection phase.
- `-32601`: method not found.
- `-32602`: invalid params.
- `-32603`: internal error.

Application failures use the reserved server range and include sanitized data:

```ts
type RpcApplicationErrorData = {
  code: string
  retryable: boolean
  requestId?: string
  details?: unknown
}
```

Stable application codes include `PROTOCOL_VERSION_UNSUPPORTED`,
`CAPABILITY_REQUIRED`, `CONFLICT`, `CURSOR_EXPIRED`,
`SUBSCRIPTION_OVERFLOW`, `REQUEST_NOT_PENDING`, `CHECKPOINT_UNAVAILABLE`,
`RATE_LIMITED`, and `INTERNAL_ERROR`. HTTP adapters map these errors to HTTP
status only after RPC semantics have been decided.

### 5. Durable event envelope

V3 uses one notification method, `event/next`, whose payload contains a typed
event envelope:

```ts
type EventEnvelopeBase<E extends EventDefinition> = {
  eventId: string
  streamId: string
  type: E['type']
  version: E['version']
  occurredAt: number
  threadId?: string
  turnId?: string
  payload: E['payload']
}

type DurableEventEnvelope<E extends EventDefinition> = EventEnvelopeBase<E> & {
  durability: 'durable'
  sequence: number
}

type LiveEventEnvelope<E extends EventDefinition> = EventEnvelopeBase<E> & {
  durability: 'live'
  sequence: null
  afterSequence: number
}
```

The initial stream forms are `global` and `thread/<threadId>`. Directory-level
Thread lifecycle, catalog, and integration events use `global`; Turn, Item,
interaction, and Thread execution state use the Thread stream. Every durable
event belongs to exactly one stream and has a gap-free sequence within that
stream. `eventId` is globally unique and supports deduplication; a durable
event's `sequence` is the replay cursor. A client that needs Thread directory
and selected Thread activity subscribes to both streams and keeps one durable
cursor per stream.

Each event definition explicitly declares type, version, durability, payload,
and stream scope. Durability is never inferred from the method string.

Durable events are committed with their business state and can be replayed.
Live events are bounded, may be dropped during disconnection or overflow, and
must never be required to reconstruct authoritative state. Terminal events
carry a complete value or identify a snapshot that can be read immediately. A
live event never consumes a durable sequence; `afterSequence` identifies the
latest durable stream position that causally precedes it.

### 6. Subscription and replay

`event/subscribe` accepts one or more `{ streamId, after }` positions. `after`
is either a durable sequence number or the literal `"latest"`. A numeric
cursor replays durable events after that position. `"latest"` is resolved to
the stream's current high-watermark when the subscription is registered, so it
starts with a snapshot-aligned live tail instead of replaying retained history.
The server returns a subscription ID and the captured high-watermark for every
stream.

For each stream the server:

1. Installs a wake subscription.
2. Reads durable events after the requested cursor through the captured
   high-watermark.
3. Sends replayed events in sequence order.
4. Continues tailing the database when woken.
5. Sends eligible live events only after replay has caught up.

Each connection has a finite outbound queue. On overflow, the server terminates
the affected subscription with `SUBSCRIPTION_OVERFLOW`; it does not silently
skip durable events. The client reconnects using its last acknowledged durable
sequence and reconciles pending requests and snapshots.

Cursor expiry is allowed only after an explicit retention policy exists. The
server returns `CURSOR_EXPIRED` with the stream's low and high watermarks. The
client may re-subscribe with `"latest"` only after arranging authoritative
snapshot reconciliation; snapshots, not skipped events, restore current state.

### 7. Input admission and execution wake

`turn/start` requires a client-generated `inputId`. The Agent stores a canonical
request hash and admission result before waking execution.

- Same `inputId` and same canonical request returns the original admission with
  disposition `duplicate`.
- Same `inputId` and different canonical request returns `CONFLICT`.
- Execution wake happens only after the admission transaction commits.
- Repeated wakes for one Thread are coalesced; one Thread executes serially
  while different Threads may execute concurrently.

The response acknowledges durable admission, not model completion.

### 8. Bidirectional interactions

Approval, question, plan confirmation, and Hook trust are typed server requests.
The JSON-RPC request ID is the stable persisted interaction ID. Resolution is
idempotent and commits the checkpoint transition and durable resolution event
in one transaction.

During `initialize`, a client declares interaction delivery as `active` or
`observe`. The server sends live requests only to authorized active connections
that negotiated the matching capability. Observer connections receive durable
projection events but cannot resolve interactions. Multiple active clients may
receive the same stable request ID; the first valid resolution wins.

Because a reconnecting or second client may not own the original live request,
v3 also provides `interaction/listPending` and `interaction/respond`. A direct
JSON-RPC response and `interaction/respond` enter the same resolution service.
The first valid resolution wins; later responses receive
`REQUEST_NOT_PENDING` with the current terminal state.

### 9. Desktop and other clients

- Electron main owns the desktop WebSocket and authentication material.
- Preload exposes narrow typed `call`, `subscribe`, `respond`, and connection
  state operations. It does not expose raw WebSocket, arbitrary IPC, URLs,
  tokens, Node.js, or filesystem access.
- Renderer consumes the same protocol types through the preload adapter.
- A same-origin browser client may connect directly using the authenticated Web
  adapter.
- A future CLI uses Bearer authentication and the same inferred client.
- Desktop-only window and settings operations stay in the desktop IPC contract,
  not the multi-end Agent protocol.

### 10. Compatibility and rollout

- Existing `POST /rpc` and `GET /rpc/events` remain available as v2 transports
  during rollout. V4 connection semantics are exposed by `/rpc/ws`.
- The v2 adapter maps v2 requests to the typed dispatcher and maps v3 durable
  events back to the current notification shape and SSE IDs where possible.
- WebSocket is added only after typed HTTP dispatch and database replay pass.
- V2 and v3 run against the same business services; no duplicate execution
  implementation is allowed.
- V2 removal requires contract parity, cursor recovery, desktop E2E, restart,
  multi-client, slow-consumer, and security tests.

### 11. Sensitive and internal wire boundaries

- Full Prompt Preview remains an explicit active request and is exposed only
  when `prompt.preview.sensitive.v1` is negotiated. Its diagnostics are owned by
  the protocol package and do not import `@openai/agents`.
- Sandbox results expose only state, platform, architecture, runtime version,
  sanitized error text, and allowed operations. Helper paths, Windows user
  objects, WFP internals, and installation implementation details are private.
- Memory wire identity uses `projectId`, never the internal `projectKey`.
- Compaction results expose counts, token totals, baseline identity, and usage
  metadata, never replacement history.

## Consequences

Positive consequences:

- Server, Electron, Renderer, browser, and future CLI share one contract.
- WebSocket adds bidirectional interaction without sacrificing replay.
- Durable state is versioned and migration-safe.
- Client retries become exact instead of heuristic.
- Transport changes no longer require business-layer rewrites.

Costs and constraints:

- Database v10 is required before reliable v3 subscriptions can ship.
- Electron gains connection management but no Agent business logic.
- A dual-stack period increases test surface.
- Event definitions require deliberate versioning and terminal snapshots.
- Live deltas need explicit backpressure and loss-tolerant UI behavior.

## Rejected alternatives

1. Change the JSON-RPC wire version to `3.0`. Rejected because JSON-RPC 2.0 is
   the standard; product protocol versioning is separate.
2. Replace SSE with memory-only WebSocket PubSub. Rejected because it regresses
   durable replay and crash recovery.
3. Let Renderer connect directly to the sidecar in Desktop. Rejected because it
   exposes transport/authentication concerns and weakens the preload boundary.
4. Copy OpenCode's global live-only event stream. Rejected because v3 requires
   explicit per-stream cursors and reconnect replay.
5. Generate a second business server for WebSocket. Rejected because all
   transports must share one typed dispatcher and application service layer.
6. Persist every token and stdout delta. Rejected because unbounded delta logs
   increase SQLite cost without improving authoritative recovery.
