# dashi-taskboard upstream

- Project: [dashi-taskboard](https://github.com/chuspeeism/dashi-taskboard)
- Imported commit: `9b2aeb53bfe8d40eb5d65feecdfc2cc235928066`
- License: Apache License 2.0
- Imported on: 2026-08-14

CodePilotX adapts the upstream task status and priority model, optimistic
concurrency approach, ranked column ordering, the `BoardColumn.tsx`
drop-before calculation, conversation activity ordering, and the
read/claim/verify/comment/review lifecycle described by the upstream
taskboard skill.

The implementation was rewritten around CodePilotX's native
`thread-rpc-v4`, history SQLite storage, transaction outbox, managed
worktrees, thread execution bindings, tool permissions, and React renderer.
No upstream HTTP service, separate taskboard database, CDP/CSP injection,
Tauri launcher, Cloudflare or Jira integration, bundled AI process, fonts,
screenshots, or OpenAI/Codex/Linear/Figma brand assets are included.
