# @pidex/session-view

`@pidex/session-view` is the platform-neutral conversation projection for Pidex.

It accepts the durable `SessionSnapshot` from `@pidex/shared` and exposes two pure operations:

- `applySessionEvent(snapshot, envelope)` merges server events into the snapshot.
- `createSessionView(snapshot, { now })` projects the snapshot into ordered `TimelineRow` records.

Desktop, CLI, and TUI clients should render these rows instead of reading `parts`, `runs`, or transport events directly. Every interactive row keeps its source `runID`, `partID`, or `inputID` so an endpoint can attach its own actions without changing this package.
