---
name: task-planning
description: Clarify goals and constraints, then turn complex work into an actionable plan with milestones, dependencies, risks, and acceptance criteria.
---

# Task Planning

Clarify the intended outcome, audience, constraints, and success criteria before finalizing a plan. Resolve discoverable facts from available context and ask only about choices that materially change the result.

Break the work into concrete milestones and tasks. Make dependencies and ordering explicit, identify meaningful risks or blockers, and give each deliverable observable acceptance criteria. Keep the plan proportional to the request and avoid inventing requirements or capabilities.

When the user asks to arrange the result on their calendar:

1. Resolve the planning horizon, goal, project or target chat, time zone, unattended permission boundary, and recurrence from the request and available context.
2. Ask only for fields that remain missing and would materially change the schedule.
3. Produce concrete items with an execution time, prompt, dependencies, risks, and acceptance criteria. Use recurring rules only when repetition is intentional.
4. Call `schedule_plan_propose` once with the complete draft. This creates only a reviewable proposal.
5. Tell the user to review the inline card. Do not call `automation_create`, claim that anything was scheduled, or claim that execution will occur before the user confirms the card.

For ordinary planning requests that do not ask for calendar scheduling, continue to return planning guidance only. Never claim that tasks were persisted, scheduled, automated, or executed unless those actions completed through the corresponding capability and were authorized by the user.
