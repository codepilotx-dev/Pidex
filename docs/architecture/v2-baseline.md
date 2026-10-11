# Pidex v2 stability baseline

Status: Frozen for RPC v4 design

Recorded: 2026-07-16 (Asia/Shanghai)

Git base: `86f622b70b92f96c8b2fc046b7e1f0ec2f3a00b2` (`main`)

Working-tree content digest: `1b100cb2cac764fd8d6e8e1f766589a5ed803e27`

## Purpose

This document freezes the accepted v2 behavior before RPC v4 work starts. It
does not turn the uncommitted working tree into a release or a Git commit. It
defines the implementation and verification boundary that v3 must preserve.

The content digest was calculated from the sorted SHA-256 hashes and relative
paths of all tracked modifications and untracked files. Documentation added
after this record is intentionally outside that digest.

## Change surface

At the time of the record, the working tree contained:

- 40 modified tracked files (`+2738/-588`).
- 20 untracked files, including the prompt, context, memory, hook, permission,
  security, and regression-test additions.
- No staged changes.
- A clean `git diff --check`, apart from Git's existing LF/CRLF notices.

The accepted implementation includes:

- Prompt engine v2, thread-level prompt snapshots, preview, and refresh.
- Context compaction, retry, rollback, and side-effect recovery evidence.
- User and project memory with project binding and secret rejection.
- Hook discovery, lifecycle execution, and persistent path/hash trust.
- Full `PermissionConfig`, granular approval gates, Guardian review state, and
  restart-safe approval checkpoints.
- Sandbox PATH hardening and command-bound escalation tokens.
- Tool catalog capabilities, generated SDK definitions, and Skill tool gates.
- Database schema v9 and the temporary v2 event/RPC contracts.
- Renderer settings migration to the complete permission configuration.

## Accepted verification

The implementation thread reported the following successful checks:

- Agent tests: 118 passed, 0 failed.
- Renderer tests: 16 passed, 0 failed.
- Shared, Session View, Agent, and Renderer typechecks passed.
- Agent and Renderer production builds passed.
- `git diff --check` passed.

The Renderer build still reports the existing single-chunk size warning above
500 KiB. It is not a v2 acceptance failure and is not part of RPC v4.

## Preserved invariants

RPC v4 must not regress these properties:

1. Business state and durable outbox events are committed in the same SQLite
   transaction wherever the v2 implementation already guarantees it. V3 must
   close remaining non-atomic paths rather than weaken existing ones.
2. SQLite WAL, foreign keys, busy timeout, deterministic migrations, and
   interrupted-turn recovery remain enabled.
3. A disconnected client can recover durable thread activity from a cursor.
   WebSocket migration must not replace database replay with memory-only PubSub.
4. Renderer code remains isolated from Node.js, credentials, the filesystem,
   and direct database access.
5. Electron preload remains minimal and typed. Electron does not acquire Agent
   business logic.
6. Agent access keeps the same-origin check and the existing HttpOnly cookie or
   Bearer-token authentication boundary.
7. API keys and secret values never enter SQLite events, checkpoints, logs, or
   RPC errors. Opaque state that cannot be scrubbed remains non-persistable.
8. Permission decisions use the complete `PermissionConfig`; legacy
   `permissionMode` is migration input or derived display only.
9. Sandbox escalation remains bound to the final command, cwd, permissions,
   and invocation hash and is revalidated immediately before execution.
10. Approval, question, Hook trust, context recovery, queued Turn, and subagent
    recovery semantics remain restart-safe at their accepted v2 level.
11. Project, workspace, thread, parent/subagent, and worktree ownership checks
    cannot be bypassed by a transport adapter.
12. Completed Item and terminal Turn state remain authoritative even when live
    token, reasoning, progress, or stdout deltas are lost.

## Baseline policy

- Stage 0-2 work may add architecture documentation only.
- Runtime, database, shared-contract, desktop, and lock files remain unchanged
  until the RPC v4 ADR and contract inventory are accepted.
- Before the first implementation change, rerun the status/digest check and
  either create an explicitly requested baseline commit or record a restorable
  patch artifact outside the repository.
- Each later milestone must state which preserved invariants it exercises.
