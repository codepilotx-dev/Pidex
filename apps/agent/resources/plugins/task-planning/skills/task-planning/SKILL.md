---
name: task-planning
description: Arrange task time before execution details are known, develop fixed plans, and associate existing conversations for execution and acceptance.
---

# Task Planning

Resolve discoverable facts first; ask only about missing information that materially changes the result. Choose between arranging time, developing a plan, and preparing execution. Reuse an existing task identity instead of creating a second task or automation.

## Arrange time first

Task names are enough. Do not demand a plan, project, model or permissions before arranging time. Discover task_schedule_view and read existing tasks, arrangements, dependencies and proposals. Read the calendar too, including task-schedule sources only when task.schedule.v1 is advertised.

In Chat mode, task_schedule_create creates requested tasks without running them. task_schedule_propose saves a reviewable batch arrangement; the user confirms it in the automation page. Preserve existing arrangements unless the user requested changing them. Use available hours, estimates, priority, deadlines and dependencies. Missing estimates use explicitly labeled provisional 30-minute blocks. Do not overlap work or force it past deadlines; include unscheduled tasks and reasons.

In Plan mode, Chat-only mutation tools remain unavailable. Use submit_task_schedule to save a time-only draft for confirmation in the automation page; it may contain existing task IDs or new task names. It must be the only tool call in that reply and ends the planning turn. For a complete plan and execution arrangement, investigate and clarify first, then submit_schedule_plan as the only tool call in the reply; it ends planning and does not activate execution. Do not also submit another plan or create an automation for the same work.

## Develop and select a plan

A task can own multiple planning and execution conversations. Association alone never sends a message or starts execution. Reuse an already definite plan without rewriting its scope. The task page lets the user open a planning conversation, associate an existing one, and select a completed plan item or paste a plan. Selection fixes the exact content; later conversation edits do not replace it.

Prepared tasks added before their execution time default to executing then, with a visible option to only remind. At the scheduled time, missing plans generate a strong reminder. Plans or conversations added after that time default to no automatic execution: the user starts them or arranges a future time. Execution sends “开始执行” with the selected plan through the ordinary conversation queue and permission chain. Never expand permissions or claim a task is arranged before confirmation succeeds.

## Rules, results and acceptance

Use host rules for time and recurring schedules, internal task success and acceptance triggers, dependencies, environment readiness, start windows, waiting or skipping, and missed-run policy. Skill prose cannot enforce these rules.

“需要人工验收” is independent and defaults to enabled for new tasks. Automatic checks can coexist with human acceptance. Supported checks are nonempty files, Markdown sections and command exit codes; subjective quality requires human acceptance.

Successful execution does not complete a task that requires human acceptance. It enters 待验收 and creates the same priority of strong reminder as a due task missing its plan. Viewing results, opening conversations, dismissing notifications and snoozing do not accept results. Only explicit acceptance completes the task. Returning feedback does not restart execution; sending feedback to a conversation requires an explicit user action. Each recurring run is accepted separately. Acceptance-dependent tasks wait for actual acceptance.

External GitHub, mail and file-change triggers are outside this version. Local scheduling and reminders require the host to run. If a capability is absent, explain the limitation without discarding rules or pretending the task is scheduled.
