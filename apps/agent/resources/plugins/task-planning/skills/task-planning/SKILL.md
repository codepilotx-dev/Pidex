---
name: task-planning
description: Clarify goals and constraints, then turn complex work into an actionable plan with milestones, dependencies, risks, and acceptance criteria; optionally arrange the plan to run on a schedule.
---

# Task Planning

Clarify the intended outcome, audience, constraints, and success criteria before finalizing a plan. Resolve discoverable facts from available context and ask only about choices that materially change the result.

Break the work into concrete milestones and tasks. Make dependencies and ordering explicit, identify meaningful risks or blockers, and give each deliverable observable acceptance criteria. Keep the plan proportional to the request and avoid inventing requirements or capabilities.

## Arranging a plan to run later

When the user asks to arrange this work on a schedule, on a recurring cadence, or after another task finishes, treat it as a two-part draft: a **task plan** and an **execution arrangement**.

First decide which entry applies, and say which one you took:

1. **The user already gave a definite Plan** (a plan item in this chat, pasted text, or a file they pointed at). Reuse that content as the fixed task plan and only fill in the missing execution arrangement. Do not re-plan the task or rewrite its scope. When several plans are plausible and the reference is ambiguous, ask which one instead of guessing the latest.
2. **There is no definite Plan yet.** Investigate what is discoverable from the repository and context first, then form the task plan, then fill in the execution arrangement.

Then settle the arrangement with the fewest questions that actually change the result:

- Resolve trigger, target project or chat, time zone, execution environment, unattended permission boundary, acceptance method, and notification needs from the request and context.
- Ask only about what is still missing and materially changes the arrangement. Use the ordinary question flow: one question at a time by default, at most three independent questions in one batch, two or three options with concrete trade-offs, or a free-text question when no reasonable options exist.
- Ask what should happen when a condition is not met (skip this run, or wait and re-check), and how the result is accepted: human acceptance, or the checks the host can actually verify (a file exists and is not empty, a document section exists, a command's exit code).
- Appearance, experience, or subjective quality standards are human acceptance. Never present them as automatic checks.

Submit one complete draft with `submit_schedule_plan`:

- It is the only tool call in that reply and ends the planning turn. Complete the investigation and clarification first.
- It saves a reviewable draft only. It does not schedule, create, or execute anything, and it does not start the scheduler.
- Do not also call `submit_plan` for the same work, and do not call `automation_create` or `schedule_plan_propose`: the user confirms the draft once, in the card, and that single confirmation arranges the task.
- Never claim a task is arranged, scheduled, automated, or running before the user confirms the card. After confirmation the card shows the real state; report that state, not your expectation.

## What this version does not support yet

- Only one-off times and recurring rules can currently activate a run. Internal events ("an upstream task finished successfully", "an upstream task passed acceptance") can be saved in drafts but cannot activate a run yet.
- External events (GitHub, mail, file changes) are not connected. If the user asks for one, say plainly that this version cannot watch external events, and offer a supported alternative (a recurring check the host runs, or human acceptance) instead of silently turning it into polling.
- Drafts that depend on automatic acceptance or event triggers cannot be confirmed yet. Keep such a draft unconfirmed and tell the user the arrangement is not yet activatable, rather than dropping the condition and creating a plain automation.
- Execution dependencies, environment conditions, time windows, waiting and re-checking, and skipping missed runs can also be saved in drafts but cannot be confirmed yet. For an activatable time-based draft, use empty conditions, `requireEnvironment: false`, null time-window bounds, `conditionFallback: skip`, and `missedRuns: catch-up`; never replace the user's requested rules without their agreement.

For ordinary planning requests that do not ask for scheduling, keep returning planning guidance only. Never claim that tasks were persisted, scheduled, automated, or executed unless those actions completed through the corresponding capability and were authorized by the user.
