import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { PLAN_APPROVAL_SCHEMA } from '../repositories/PlanApprovalRepository'
import {
  THREAD_GOAL_SCHEMA,
  THREAD_GOAL_SCHEMA_V45,
  migrateThreadGoals45To46,
} from '../repositories/ThreadGoalRepository'
import { THREAD_GOAL_LEDGER_SCHEMA } from '../repositories/ThreadGoalLedgerRepository'
import { THREAD_GOAL_CONTINUATION_SCHEMA } from '../repositories/ThreadGoalContinuationRepository'
import { THREAD_BOOKMARK_SCHEMA } from '../repositories/ThreadBookmarkRepository'
import { BROWSER_SCHEMA } from '../repositories/BrowserRepository'
import { BROWSER_DATA_SCHEMA } from '../repositories/BrowserDataRepository'
import { THREAD_WORKTREE_OPERATION_SCHEMA } from '../repositories/ThreadWorktreeOperationRepository'
import { WORKTREE_SETTINGS_SCHEMA } from '../../worktree/WorktreeRepository'
import { LOCAL_ENVIRONMENT_SELECTION_SCHEMA } from '../../local-environment/LocalEnvironmentRepository'
import { PR_WATCH_SCHEMA } from '../../github/PullRequestWatchService'
import { SUBAGENT_COLLABORATION_SCHEMA } from '../../subagent/SubagentCollaborationRepository'
import { AUTOMATION_HOST_AUDIT_SCHEMA } from '../../automation/AutomationHostAuditRepository'

import { PROFILE_APPLICATION_ID, PROFILE_SCHEMA_VERSION, SCHEMA_VERSION } from './Schema'

const TASK_CONTEXT_SCHEMA = [
  'CREATE TABLE task_context_state (task_id TEXT PRIMARY KEY REFERENCES taskboard_tasks(id) ON DELETE CASCADE, evidence_revision INTEGER NOT NULL DEFAULT 0, context_revision INTEGER NOT NULL DEFAULT 1, summarized_through_evidence_revision INTEGER NOT NULL DEFAULT 0, frozen_at INTEGER, promoted_context_revision INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
  "CREATE TABLE task_context_entries (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES taskboard_tasks(id) ON DELETE CASCADE, section TEXT NOT NULL CHECK(section IN ('objective','code_map','decision','finding','progress','validation','risk')), title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120), content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 2000), status TEXT NOT NULL CHECK(status IN ('active','superseded','retired')), version INTEGER NOT NULL DEFAULT 1, source_kind TEXT NOT NULL CHECK(source_kind IN ('user','agent','system','ai')), source_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL, source_turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL, supersedes_entry_id TEXT REFERENCES task_context_entries(id) ON DELETE SET NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  "CREATE TABLE task_context_evidence (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES taskboard_tasks(id) ON DELETE CASCADE, revision INTEGER NOT NULL, source_kind TEXT NOT NULL CHECK(source_kind IN ('turn','subagent','thread','task')), source_id TEXT NOT NULL, source_thread_id TEXT, source_turn_id TEXT, verified INTEGER NOT NULL CHECK(verified IN (0,1)), summary TEXT NOT NULL CHECK(length(summary) <= 8000), created_at INTEGER NOT NULL, UNIQUE(task_id, source_kind, source_id), UNIQUE(task_id, revision))",
  "CREATE TABLE task_context_ai_proposals (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES taskboard_tasks(id) ON DELETE CASCADE, base_context_revision INTEGER NOT NULL, through_evidence_revision INTEGER NOT NULL, changes TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','applied','discarded','stale')), model_ref TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  'CREATE TABLE task_context_operations (operation_id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES taskboard_tasks(id) ON DELETE CASCADE, method TEXT NOT NULL, request_hash TEXT NOT NULL, result TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
  'CREATE TABLE task_context_memory_promotions (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES taskboard_tasks(id) ON DELETE CASCADE, context_revision INTEGER NOT NULL, memory_entry_id TEXT, content TEXT, content_hash TEXT, supersedes_promotion_id TEXT REFERENCES task_context_memory_promotions(id) ON DELETE SET NULL, created_at INTEGER NOT NULL, completed_at INTEGER)',
  "CREATE TABLE task_context_promotion_jobs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES taskboard_tasks(id) ON DELETE CASCADE, context_revision INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed','retryable')), error TEXT, created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER, updated_at INTEGER NOT NULL, UNIQUE(task_id, context_revision))",
  'CREATE INDEX task_context_entries_task_section ON task_context_entries(task_id, section, status, updated_at DESC)',
  'CREATE INDEX task_context_evidence_pending ON task_context_evidence(task_id, revision)',
  'CREATE INDEX task_context_promotion_jobs_status ON task_context_promotion_jobs(status, created_at)',
] as const

const TASKBOARD_PLANNING_SCHEMA = [
  "CREATE TABLE taskboard_plan_items (id TEXT PRIMARY KEY, parent_task_id TEXT NOT NULL REFERENCES taskboard_tasks(id) ON DELETE CASCADE, item_type TEXT NOT NULL CHECK(item_type IN ('step','task')), child_task_id TEXT UNIQUE REFERENCES taskboard_tasks(id) ON DELETE RESTRICT, step_title TEXT, step_description TEXT, step_status TEXT CHECK(step_status IN ('todo','done','skipped','promoted')), skip_reason TEXT, position REAL NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1), ready_notified_at INTEGER, ready_read_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  'CREATE TABLE taskboard_plan_dependencies (dependent_item_id TEXT NOT NULL REFERENCES taskboard_plan_items(id) ON DELETE CASCADE, prerequisite_item_id TEXT NOT NULL REFERENCES taskboard_plan_items(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, PRIMARY KEY(dependent_item_id, prerequisite_item_id))',
  "CREATE TABLE taskboard_blockers (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES taskboard_tasks(id) ON DELETE CASCADE, plan_item_id TEXT REFERENCES taskboard_plan_items(id) ON DELETE CASCADE, reason TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','resolved')), source_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL, source_turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL, resolution TEXT, version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1), created_at INTEGER NOT NULL, resolved_at INTEGER, updated_at INTEGER NOT NULL)",
  'CREATE TABLE taskboard_archive_batches (id TEXT PRIMARY KEY, root_task_id TEXT NOT NULL, include_linked_threads INTEGER NOT NULL CHECK(include_linked_threads IN (0,1)), created_at INTEGER NOT NULL, restored_at INTEGER)',
  'CREATE TABLE taskboard_archive_batch_tasks (batch_id TEXT NOT NULL REFERENCES taskboard_archive_batches(id) ON DELETE CASCADE, task_id TEXT NOT NULL, PRIMARY KEY(batch_id, task_id))',
  'CREATE INDEX taskboard_plan_items_parent_position ON taskboard_plan_items(parent_task_id, position, id)',
  'CREATE INDEX taskboard_plan_dependencies_prerequisite ON taskboard_plan_dependencies(prerequisite_item_id, dependent_item_id)',
  'CREATE INDEX taskboard_blockers_task_status ON taskboard_blockers(task_id, status, created_at, id)',
  'CREATE INDEX taskboard_archive_batches_root ON taskboard_archive_batches(root_task_id, restored_at, created_at DESC)',
  'CREATE INDEX taskboard_archive_batch_tasks_task ON taskboard_archive_batch_tasks(task_id, batch_id)',
] as const

const SESSION_GROUP_SCHEMA = [
  "CREATE TABLE session_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120), description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 4000), version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  'CREATE TABLE session_group_memberships (group_id TEXT NOT NULL REFERENCES session_groups(id) ON DELETE CASCADE, thread_id TEXT NOT NULL UNIQUE REFERENCES threads(id) ON DELETE CASCADE, joined_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(group_id, thread_id))',
  "CREATE TABLE session_group_steps (id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES session_groups(id) ON DELETE CASCADE, sequence INTEGER NOT NULL, source_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL, source_thread_title TEXT NOT NULL, source_turn_id TEXT NOT NULL UNIQUE, project_id TEXT, workspace_label TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('waiting_permission','waiting_question','completed','failed','interrupted','cancelled')), summary TEXT NOT NULL CHECK(length(summary) <= 8000), checkpoints TEXT NOT NULL DEFAULT '[]', changed_files TEXT NOT NULL DEFAULT '[]', validations TEXT NOT NULL DEFAULT '[]', failure TEXT, revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(group_id, sequence))",
  "CREATE TABLE session_group_context_state (group_id TEXT PRIMARY KEY REFERENCES session_groups(id) ON DELETE CASCADE, context_revision INTEGER NOT NULL DEFAULT 1, summarized_through_sequence INTEGER NOT NULL DEFAULT 0, digest TEXT NOT NULL DEFAULT '' CHECK(length(digest) <= 6000), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  "CREATE TABLE session_group_context_entries (id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES session_groups(id) ON DELETE CASCADE, section TEXT NOT NULL CHECK(section IN ('objective','code_map','decision','finding','progress','validation','risk','fix')), title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120), content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 2000), status TEXT NOT NULL CHECK(status IN ('active','superseded','retired')), version INTEGER NOT NULL DEFAULT 1, source_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL, source_turn_id TEXT, supersedes_entry_id TEXT REFERENCES session_group_context_entries(id) ON DELETE SET NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  'CREATE TABLE session_group_operations (operation_id TEXT PRIMARY KEY, method TEXT NOT NULL, request_hash TEXT NOT NULL, result TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
  'CREATE INDEX session_group_memberships_group_joined ON session_group_memberships(group_id, joined_at, thread_id)',
  'CREATE INDEX session_group_steps_group_sequence ON session_group_steps(group_id, sequence DESC)',
  'CREATE INDEX session_group_context_entries_group_section ON session_group_context_entries(group_id, section, status, updated_at DESC)',
] as const

const AUTOMATION_SCHEMA = [
  "CREATE TABLE automations (id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1), kind TEXT NOT NULL CHECK(kind IN ('standalone','thread')), name TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','paused','deleted')), project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, target_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL, execution TEXT, model_ref TEXT NOT NULL, reasoning_effort TEXT, permission_config TEXT NOT NULL, schedule TEXT NOT NULL, canonical_rrule TEXT NOT NULL, time_zone TEXT NOT NULL, notification_policy TEXT NOT NULL CHECK(notification_policy IN ('all','failures','off')), next_run_at INTEGER, pending_catch_up INTEGER NOT NULL DEFAULT 0 CHECK(pending_catch_up IN (0,1)), active_run_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)",
  "CREATE TABLE automation_runs (id TEXT PRIMARY KEY, automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE RESTRICT, operation_id TEXT NOT NULL UNIQUE, trigger TEXT NOT NULL CHECK(trigger IN ('scheduled','startup-catch-up','overlap-catch-up','manual')), scheduled_for INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('claimed','preparing','queued','running','completed','failed','interrupted')), thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL, turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL, worktree_id TEXT REFERENCES managed_worktrees(id) ON DELETE SET NULL, read_at INTEGER, safe_error_code TEXT, created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER)",
  'CREATE INDEX automations_status_next_run ON automations(status, next_run_at)',
  'CREATE INDEX automation_runs_automation_created ON automation_runs(automation_id, created_at DESC)',
  'CREATE INDEX automation_runs_thread ON automation_runs(thread_id)',
  "CREATE UNIQUE INDEX automation_runs_one_active ON automation_runs(automation_id) WHERE status IN ('claimed','preparing','queued','running')",
] as const

const SCHEDULE_CALENDAR_SCHEMA = [
  "CREATE TABLE schedule_plan_proposals (id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1), operation_id TEXT NOT NULL UNIQUE, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE, tool_call_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL CHECK(status IN ('pending','committed','cancelled')), horizon TEXT NOT NULL CHECK(horizon IN ('day','week','month','year')), defaults TEXT NOT NULL, items TEXT NOT NULL, created_refs TEXT NOT NULL DEFAULT '[]', commit_operation_id TEXT UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, committed_at INTEGER)",
  "CREATE TABLE scheduled_tasks (id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1), operation_id TEXT NOT NULL UNIQUE, manual_run_operation_id TEXT UNIQUE, proposal_id TEXT REFERENCES schedule_plan_proposals(id) ON DELETE SET NULL, kind TEXT NOT NULL CHECK(kind IN ('standalone','thread')), name TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('scheduled','paused','claimed','preparing','queued','running','completed','failed','interrupted','cancelled')), project_id TEXT, target_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL, execution TEXT, model_ref TEXT NOT NULL, reasoning_effort TEXT, permission_config TEXT NOT NULL, scheduled_for INTEGER NOT NULL, time_zone TEXT NOT NULL, notification_policy TEXT NOT NULL CHECK(notification_policy IN ('all','failures','off')), thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL, turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL, worktree_id TEXT REFERENCES managed_worktrees(id) ON DELETE SET NULL, read_at INTEGER, safe_error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER, cancelled_at INTEGER)",
  'CREATE INDEX scheduled_tasks_status_scheduled_for ON scheduled_tasks(status, scheduled_for)',
  'CREATE INDEX scheduled_tasks_thread ON scheduled_tasks(thread_id)',
  'CREATE INDEX schedule_plan_proposals_thread ON schedule_plan_proposals(thread_id)',
] as const

export const FINAL_SCHEMA = [
  'CREATE TABLE thread_project_memberships (thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE, project_id TEXT, removal_operation_id TEXT, updated_at INTEGER NOT NULL)',
  'CREATE TABLE approval_reviews (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, tool_call_id TEXT NOT NULL, invocation TEXT NOT NULL, fingerprint TEXT NOT NULL, decision TEXT NOT NULL, risk TEXT NOT NULL, reason TEXT NOT NULL, retry_operation_id TEXT, retry_consumed_at INTEGER, created_at INTEGER NOT NULL)',
  "CREATE TABLE mcp_elicitations (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE, agent_id TEXT NOT NULL, tool_call_id TEXT NOT NULL, connection_id TEXT NOT NULL, payload TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'pending', response TEXT, created_at INTEGER NOT NULL)",
  'CREATE TABLE agent_checkpoints (\n        agent_id TEXT PRIMARY KEY REFERENCES agent_executions(id) ON DELETE CASCADE,\n        turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,\n        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n        state TEXT NOT NULL,\n        payload TEXT NOT NULL,\n        version INTEGER NOT NULL,\n        created_at INTEGER NOT NULL,\n        updated_at INTEGER NOT NULL\n      )',
  'CREATE TABLE agent_compactions (\n          id TEXT PRIMARY KEY,\n          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,\n          baseline_version INTEGER NOT NULL,\n          before_count INTEGER NOT NULL,\n          after_count INTEGER NOT NULL,\n          summary TEXT NOT NULL,\n          replacement_history TEXT NOT NULL,\n          created_at INTEGER NOT NULL\n        , before_tokens INTEGER NOT NULL DEFAULT 0, after_tokens INTEGER NOT NULL DEFAULT 0, target_tokens INTEGER NOT NULL DEFAULT 0, usage_sample_id TEXT)',
  'CREATE TABLE agent_executions (\n        id TEXT PRIMARY KEY,\n        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n        turn_id TEXT NOT NULL UNIQUE REFERENCES turns(id) ON DELETE CASCADE,\n        parent_agent_id TEXT REFERENCES agent_executions(id) ON DELETE CASCADE,\n        profile TEXT NOT NULL,\n        task TEXT NOT NULL,\n        model_ref TEXT NOT NULL,\n        session_id TEXT NOT NULL,\n        depth INTEGER NOT NULL DEFAULT 0,\n        subagent_run_id TEXT,\n        run_sequence INTEGER NOT NULL DEFAULT 0,\n        status TEXT NOT NULL,\n        error TEXT,\n        created_at INTEGER NOT NULL,\n        updated_at INTEGER NOT NULL\n      )',
  'CREATE TABLE app_settings (\n        key TEXT PRIMARY KEY,\n        value TEXT NOT NULL,\n        updated_at INTEGER NOT NULL\n      )',
  'CREATE TABLE approval_checkpoints (\n          approval_id TEXT PRIMARY KEY REFERENCES approval_requests(id) ON DELETE CASCADE,\n          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,\n          payload TEXT NOT NULL,\n          version INTEGER NOT NULL DEFAULT 1,\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL\n        )',
  'CREATE TABLE approval_requests (\n        id TEXT PRIMARY KEY,\n        thread_id TEXT NOT NULL,\n        turn_id TEXT NOT NULL,\n        agent_id TEXT NOT NULL,\n        tool_call_id TEXT NOT NULL,\n        risk TEXT NOT NULL,\n        reason TEXT NOT NULL,\n        status TEXT NOT NULL,\n        reply TEXT,\n        request_payload TEXT NOT NULL DEFAULT \'{"version":1}\',\n        review_payload TEXT,\n        created_at INTEGER NOT NULL,\n        resolved_at INTEGER\n      )',
  'CREATE TABLE context_usage_samples (\n          id TEXT PRIMARY KEY,\n          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,\n          session_id TEXT,\n          context_fingerprint TEXT NOT NULL,\n          context_window_tokens INTEGER NOT NULL,\n          input_tokens INTEGER NOT NULL,\n          output_tokens INTEGER NOT NULL DEFAULT 0,\n          source TEXT NOT NULL,\n          created_at INTEGER NOT NULL\n        )',
  "CREATE TABLE credential_health (\n          credential_id TEXT PRIMARY KEY REFERENCES credentials(id) ON DELETE CASCADE,\n          status TEXT NOT NULL CHECK (status IN ('untested', 'healthy', 'auth-failed', 'rate-limited', 'error')),\n          last_tested_at INTEGER,\n          last_used_at INTEGER,\n          last_error_category TEXT,\n          cooldown_until INTEGER,\n          updated_at INTEGER NOT NULL\n        )",
  "CREATE TABLE credentials (\n          id TEXT PRIMARY KEY,\n          integration_id TEXT NOT NULL,\n          kind TEXT NOT NULL CHECK (kind IN ('api-key', 'oauth')),\n          method_id TEXT,\n          label TEXT NOT NULL,\n          key_suffix TEXT,\n          fingerprint TEXT,\n          enabled INTEGER NOT NULL DEFAULT 1,\n          priority INTEGER NOT NULL DEFAULT 0,\n          ciphertext TEXT NOT NULL,\n          nonce TEXT NOT NULL,\n          key_version INTEGER NOT NULL,\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL\n        )",
  'CREATE TABLE events (\n        id INTEGER PRIMARY KEY AUTOINCREMENT,\n        thread_id TEXT,\n        turn_id TEXT,\n        method TEXT NOT NULL,\n        params TEXT NOT NULL,\n        created_at INTEGER NOT NULL\n      )',
  "CREATE TABLE guardian_review_sessions (\n          thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,\n          cache_key TEXT NOT NULL,\n          history_version INTEGER NOT NULL DEFAULT 1,\n          evidence_cursor INTEGER NOT NULL DEFAULT 0,\n          history TEXT NOT NULL DEFAULT '[]',\n          updated_at INTEGER NOT NULL\n        )",
  'CREATE TABLE hook_runs (\n          id TEXT PRIMARY KEY,\n          thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,\n          turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,\n          tool_call_id TEXT,\n          event TEXT NOT NULL,\n          hook_id TEXT NOT NULL,\n          status TEXT NOT NULL,\n          input TEXT NOT NULL,\n          output TEXT,\n          error TEXT,\n          started_at INTEGER NOT NULL,\n          finished_at INTEGER\n        , command TEXT, cwd TEXT, evidence_summary TEXT)',
  'CREATE TABLE hook_trust_decisions (\n          workspace_path TEXT NOT NULL,\n          config_hash TEXT NOT NULL,\n          config_path TEXT NOT NULL,\n          decision TEXT NOT NULL,\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL,\n          PRIMARY KEY (workspace_path, config_hash)\n        )',
  'CREATE TABLE hook_trust_requests (\n          id TEXT PRIMARY KEY,\n          thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,\n          turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,\n          workspace_path TEXT NOT NULL,\n          config_path TEXT NOT NULL,\n          config_hash TEXT NOT NULL,\n          status TEXT NOT NULL,\n          audit_summary TEXT NOT NULL,\n          created_at INTEGER NOT NULL,\n          resolved_at INTEGER\n        )',
  'CREATE TABLE hook_trust_waiters (\n          request_id TEXT NOT NULL REFERENCES hook_trust_requests(id) ON DELETE CASCADE,\n          agent_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,\n          turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,\n          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          created_at INTEGER NOT NULL,\n          PRIMARY KEY (request_id, agent_id)\n        )',
  'CREATE TABLE input_attachments (\n          id TEXT PRIMARY KEY,\n          thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,\n          input_id TEXT REFERENCES inputs(id) ON DELETE CASCADE,\n          kind TEXT NOT NULL,\n          name TEXT NOT NULL,\n          media_type TEXT NOT NULL,\n          size_bytes INTEGER NOT NULL,\n          sha256 TEXT NOT NULL,\n          storage_path TEXT NOT NULL,\n          created_at INTEGER NOT NULL,\n          bound_at INTEGER\n        )',
  "CREATE TABLE thread_context_paths (\n          id TEXT PRIMARY KEY,\n          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          name TEXT NOT NULL,\n          path TEXT NOT NULL,\n          path_key TEXT NOT NULL,\n          kind TEXT NOT NULL CHECK(kind IN ('file','directory')),\n          created_at INTEGER NOT NULL,\n          UNIQUE(thread_id, path_key)\n        )",
  'CREATE TABLE input_context_paths (\n          input_id TEXT NOT NULL REFERENCES inputs(id) ON DELETE CASCADE,\n          context_path_id TEXT NOT NULL REFERENCES thread_context_paths(id) ON DELETE CASCADE,\n          sort_order INTEGER NOT NULL DEFAULT 0,\n          created_at INTEGER NOT NULL,\n          PRIMARY KEY(input_id, context_path_id)\n        )',
  'CREATE TABLE context_path_operations (\n          operation_id TEXT PRIMARY KEY,\n          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          request_hash TEXT NOT NULL,\n          reference_ids TEXT NOT NULL,\n          created_at INTEGER NOT NULL\n        )',
  "CREATE TABLE inputs (\n        id TEXT PRIMARY KEY,\n        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n        turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,\n        content TEXT NOT NULL,\n        model_ref TEXT NOT NULL,\n        sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write',\n        approval_policy TEXT NOT NULL DEFAULT 'on-request',\n        approvals_reviewer TEXT NOT NULL DEFAULT 'user',\n        strategy TEXT NOT NULL,\n        task_mode TEXT NOT NULL,\n        status TEXT NOT NULL,\n        created_at INTEGER NOT NULL,\n        origin TEXT CHECK(origin IS NULL OR origin IN ('user','goal-continuation')),\n        skills TEXT\n      )",
  "CREATE TABLE item_artifacts (\n          id TEXT PRIMARY KEY,\n          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,\n          item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,\n          name TEXT NOT NULL,\n          mime_type TEXT NOT NULL,\n          size_bytes INTEGER NOT NULL DEFAULT 0,\n          storage_kind TEXT NOT NULL CHECK(storage_kind IN ('managed')),\n          storage_path TEXT NOT NULL,\n          sha256 TEXT,\n          created_at INTEGER NOT NULL\n        )",
  'CREATE TABLE integration_credential_bindings (\n          integration_id TEXT PRIMARY KEY,\n          credential_id TEXT NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,\n          updated_at INTEGER NOT NULL\n        )',
  'CREATE TABLE interaction_operations (\n          operation_id TEXT PRIMARY KEY,\n          interaction_id TEXT NOT NULL,\n          response TEXT NOT NULL,\n          result TEXT NOT NULL,\n          created_at INTEGER NOT NULL\n        )',
  'CREATE TABLE items (\n        id TEXT PRIMARY KEY,\n        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n        turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,\n        agent_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,\n        type TEXT NOT NULL,\n        status TEXT NOT NULL,\n        data TEXT NOT NULL,\n        ordinal INTEGER NOT NULL,\n        created_at INTEGER NOT NULL,\n        updated_at INTEGER NOT NULL\n      )',
  "CREATE TABLE memory_entries (\n          id TEXT PRIMARY KEY,\n          scope TEXT NOT NULL,\n          project_key TEXT NOT NULL DEFAULT '',\n          content TEXT NOT NULL,\n          source_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,\n          content_hash TEXT NOT NULL,\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL,\n          UNIQUE(scope, project_key, content_hash)\n        )",
  'CREATE TABLE memory_jobs (\n          id TEXT PRIMARY KEY,\n          thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,\n          project_key TEXT,\n          status TEXT NOT NULL,\n          payload TEXT NOT NULL,\n          result TEXT,\n          error TEXT,\n          created_at INTEGER NOT NULL,\n          started_at INTEGER,\n          finished_at INTEGER,\n          updated_at INTEGER NOT NULL\n        )',
  "CREATE TABLE managed_worktrees (\n          id TEXT PRIMARY KEY,\n          project_id TEXT NOT NULL,\n          repository_root TEXT NOT NULL,\n          path TEXT NOT NULL UNIQUE,\n          status TEXT NOT NULL CHECK(status IN ('creating','ready','ready-with-setup-error','deleting','cleaned','restoring','restore-conflict')),\n          branch_name TEXT,\n          base_commit TEXT NOT NULL,\n          head_commit TEXT NOT NULL,\n          permanent INTEGER NOT NULL DEFAULT 0 CHECK(permanent IN (0,1)),\n          pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),\n          bound_once INTEGER NOT NULL DEFAULT 0 CHECK(bound_once IN (0,1)),\n          setup_status TEXT NOT NULL CHECK(setup_status IN ('pending','succeeded','failed','skipped')),\n          environment_revision INTEGER NOT NULL DEFAULT 0,\n          continued_without_setup INTEGER NOT NULL DEFAULT 0 CHECK(continued_without_setup IN (0,1)),\n          restore_snapshot_path TEXT,\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL,\n          last_used_at INTEGER NOT NULL,\n          deleted_at INTEGER\n        )",
  'CREATE TABLE messages (\n        id TEXT PRIMARY KEY,\n        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n        turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,\n        role TEXT NOT NULL,\n        content TEXT NOT NULL,\n        created_at INTEGER NOT NULL\n      , ordinal INTEGER)',
  'CREATE TABLE patches (\n        id TEXT PRIMARY KEY,\n        thread_id TEXT NOT NULL,\n        turn_id TEXT NOT NULL,\n        agent_id TEXT NOT NULL,\n        files TEXT NOT NULL,\n        additions INTEGER NOT NULL DEFAULT 0,\n        deletions INTEGER NOT NULL DEFAULT 0,\n        created_at INTEGER NOT NULL\n      )',
  "CREATE TABLE turn_patch_sets (\n        turn_id TEXT PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,\n        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n        item_id TEXT NOT NULL UNIQUE,\n        apply_state TEXT NOT NULL DEFAULT 'applied' CHECK(apply_state IN ('applied', 'undone')),\n        action_version INTEGER NOT NULL DEFAULT 0,\n        evidence_complete INTEGER NOT NULL DEFAULT 1 CHECK(evidence_complete IN (0, 1)),\n        created_at INTEGER NOT NULL,\n        updated_at INTEGER NOT NULL\n      )",
  'CREATE TABLE turn_patch_batches (\n        turn_id TEXT NOT NULL REFERENCES turn_patch_sets(turn_id) ON DELETE CASCADE,\n        ordinal INTEGER NOT NULL,\n        tool_call_id TEXT NOT NULL UNIQUE,\n        files TEXT NOT NULL,\n        created_at INTEGER NOT NULL,\n        PRIMARY KEY (turn_id, ordinal)\n      )',
  'CREATE TABLE turn_patch_operations (\n        operation_id TEXT PRIMARY KEY,\n        turn_id TEXT NOT NULL REFERENCES turn_patch_sets(turn_id) ON DELETE CASCADE,\n        request_hash TEXT NOT NULL,\n        result TEXT NOT NULL,\n        created_at INTEGER NOT NULL\n      )',
  'CREATE TABLE "pi_session_entries" (\n          session_id TEXT NOT NULL REFERENCES "pi_sessions"(id) ON DELETE CASCADE,\n          sequence INTEGER NOT NULL,\n          id TEXT NOT NULL,\n          parent_id TEXT,\n          type TEXT NOT NULL,\n          payload TEXT NOT NULL,\n          created_at INTEGER NOT NULL,\n          PRIMARY KEY (session_id, sequence),\n          UNIQUE (session_id, id)\n        )',
  'CREATE TABLE runtime_composition_plans (\n        turn_id TEXT PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,\n        agent_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,\n        composition_id TEXT NOT NULL UNIQUE,\n        snapshot_version INTEGER NOT NULL,\n        snapshot_json TEXT NOT NULL,\n        snapshot_hash TEXT NOT NULL,\n        created_at INTEGER NOT NULL\n      )',
  'CREATE TABLE "pi_sessions" (\n          id TEXT PRIMARY KEY,\n          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          agent_id TEXT NOT NULL,\n          leaf_id TEXT,\n          name TEXT,\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL\n        )',
  "CREATE TABLE project_settings (\n        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,\n        default_model TEXT,\n        instructions TEXT NOT NULL DEFAULT '',\n        execution_environment TEXT NOT NULL DEFAULT 'auto' CHECK(execution_environment IN ('auto','local')),\n        version INTEGER NOT NULL DEFAULT 1,\n        updated_at INTEGER NOT NULL\n      )",
  'CREATE TABLE projects (\n        id TEXT PRIMARY KEY,\n        name TEXT NOT NULL,\n        removed_at INTEGER,\n        created_at INTEGER NOT NULL,\n        updated_at INTEGER NOT NULL,\n        last_opened_at INTEGER NOT NULL\n      )',
  "CREATE TABLE project_folders (\n        id TEXT PRIMARY KEY,\n        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,\n        path TEXT NOT NULL,\n        path_key TEXT NOT NULL,\n        role TEXT NOT NULL CHECK(role IN ('primary', 'secondary')),\n        sort_order INTEGER NOT NULL DEFAULT 0,\n        created_at INTEGER NOT NULL,\n        updated_at INTEGER NOT NULL,\n        UNIQUE(project_id, path_key)\n      )",
  "CREATE TABLE project_sources (\n        id TEXT PRIMARY KEY,\n        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,\n        storage_kind TEXT NOT NULL CHECK(storage_kind IN ('managed', 'workspace-file')),\n        content_kind TEXT NOT NULL CHECK(content_kind IN ('text', 'image')),\n        name TEXT NOT NULL,\n        media_type TEXT,\n        size_bytes INTEGER,\n        sha256 TEXT,\n        storage_path TEXT,\n        folder_id TEXT REFERENCES project_folders(id) ON DELETE CASCADE,\n        relative_path TEXT,\n        created_at INTEGER NOT NULL,\n        updated_at INTEGER NOT NULL,\n        CHECK((storage_kind = 'managed' AND media_type IS NOT NULL AND size_bytes IS NOT NULL AND sha256 IS NOT NULL AND storage_path IS NOT NULL AND folder_id IS NULL AND relative_path IS NULL) OR (storage_kind = 'workspace-file' AND folder_id IS NOT NULL AND relative_path IS NOT NULL AND storage_path IS NULL))\n      )",
  "CREATE TABLE project_operations (\n        operation_id TEXT PRIMARY KEY,\n        project_id TEXT,\n        method TEXT NOT NULL,\n        request_hash TEXT NOT NULL,\n        status TEXT NOT NULL CHECK(status IN ('pending', 'completed')),\n        result TEXT,\n        created_at INTEGER NOT NULL,\n        updated_at INTEGER NOT NULL\n      )",
  "CREATE TABLE prompt_session_state (\n          thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,\n          baseline_version INTEGER NOT NULL DEFAULT 1,\n          prompt_version TEXT NOT NULL,\n          base_hash TEXT NOT NULL,\n          context_hash TEXT NOT NULL,\n          cache_key TEXT NOT NULL,\n          fragments TEXT NOT NULL DEFAULT '[]',\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL\n        , context_window_tokens INTEGER NOT NULL DEFAULT 0, usage_tokens INTEGER NOT NULL DEFAULT 0, usage_source TEXT NOT NULL DEFAULT 'estimated', usage_sample_id TEXT, needs_compaction INTEGER NOT NULL DEFAULT 0, auto_compact_failures INTEGER NOT NULL DEFAULT 0, auto_compact_suspended INTEGER NOT NULL DEFAULT 0)",
  'CREATE TABLE provider_settings (\n        provider_id TEXT PRIMARY KEY,\n        payload TEXT NOT NULL,\n        updated_at INTEGER NOT NULL\n      )',
  'CREATE TABLE question_requests (\n        id TEXT PRIMARY KEY,\n        thread_id TEXT NOT NULL,\n        turn_id TEXT NOT NULL,\n        agent_id TEXT NOT NULL,\n        tool_call_id TEXT,\n        payload TEXT NOT NULL,\n        payload_version INTEGER NOT NULL DEFAULT 1,\n        status TEXT NOT NULL,\n        answer TEXT,\n        created_at INTEGER NOT NULL,\n        resolved_at INTEGER\n      )',
  "CREATE TABLE resume_checkpoint_leases (\n        turn_id TEXT PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,\n        agent_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,\n        checkpoint_kind TEXT NOT NULL CHECK(checkpoint_kind IN ('permission','question','hook-trust','subagent-wait')),\n        checkpoint_payload TEXT NOT NULL,\n        permission_grant TEXT,\n        consumer TEXT CHECK(consumer IN ('main','subagent')),\n        lease_id TEXT UNIQUE,\n        status TEXT NOT NULL CHECK(status IN ('available','acquired','completed','interrupted')),\n        created_at INTEGER NOT NULL,\n        acquired_at INTEGER,\n        completed_at INTEGER,\n        updated_at INTEGER NOT NULL\n      )",
  'CREATE TABLE queue_operations (\n          operation_id TEXT PRIMARY KEY,\n          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          method TEXT NOT NULL,\n          event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,\n          created_at INTEGER NOT NULL\n        )',
  "CREATE TABLE review_comments (\n          id TEXT PRIMARY KEY,\n          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,\n          source_key TEXT NOT NULL,\n          path TEXT NOT NULL,\n          side TEXT NOT NULL CHECK(side IN ('old', 'new')),\n          line INTEGER NOT NULL CHECK(line > 0),\n          hunk_id TEXT,\n          revision TEXT NOT NULL,\n          body TEXT NOT NULL,\n          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved')),\n          github_comment_id TEXT,\n          github_thread_id TEXT,\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL\n        )",
  "CREATE TABLE sandbox_escalations (\n      token TEXT PRIMARY KEY,\n      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n      turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,\n      agent_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,\n      tool_call_id TEXT NOT NULL,\n      invocation TEXT NOT NULL,\n      invocation_hash TEXT NOT NULL DEFAULT '',\n      failure TEXT NOT NULL,\n      status TEXT NOT NULL,\n      output TEXT,\n      created_at INTEGER NOT NULL,\n      claimed_at INTEGER,\n      completed_at INTEGER\n    )",
  'CREATE TABLE subagent_controls (\n          id TEXT PRIMARY KEY,\n          task_id TEXT NOT NULL REFERENCES subagent_tasks(id) ON DELETE CASCADE,\n          run_id TEXT REFERENCES subagent_runs(id) ON DELETE CASCADE,\n          action TEXT NOT NULL,\n          payload TEXT NOT NULL,\n          status TEXT NOT NULL,\n          result TEXT,\n          error TEXT,\n          created_at INTEGER NOT NULL,\n          applied_at INTEGER\n        )',
  'CREATE TABLE subagent_runs (\n          id TEXT PRIMARY KEY,\n          task_id TEXT NOT NULL REFERENCES subagent_tasks(id) ON DELETE CASCADE,\n          generation INTEGER NOT NULL,\n          status TEXT NOT NULL,\n          queue_reason TEXT,\n          model_ref TEXT NOT NULL,\n          permission_config TEXT NOT NULL,\n          result TEXT,\n          error TEXT,\n          created_at INTEGER NOT NULL,\n          started_at INTEGER,\n          finished_at INTEGER,\n          updated_at INTEGER NOT NULL,\n          UNIQUE(task_id, generation)\n        )',
  "CREATE TABLE subagent_tasks (\n          id TEXT PRIMARY KEY,\n          parent_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          parent_turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,\n          parent_agent_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,\n          child_thread_id TEXT NOT NULL UNIQUE REFERENCES threads(id) ON DELETE CASCADE,\n          display_name TEXT NOT NULL,\n          profile TEXT NOT NULL,\n          task TEXT NOT NULL,\n          permission_ceiling TEXT NOT NULL,\n          workspace_mode TEXT NOT NULL,\n          workspace_state TEXT NOT NULL DEFAULT '{}',\n          current_run_id TEXT,\n          status TEXT NOT NULL,\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL\n        )",
  "CREATE TABLE threads (\n        id TEXT PRIMARY KEY,\n        title TEXT NOT NULL,\n        kind TEXT NOT NULL DEFAULT 'main',\n        parent_thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,\n        creation_surface TEXT CHECK(creation_surface IS NULL OR creation_surface IN ('coding','working','chat')),\n        task_mode TEXT NOT NULL DEFAULT 'chat',\n        sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write',\n        approval_policy TEXT NOT NULL DEFAULT 'on-request',\n        approvals_reviewer TEXT NOT NULL DEFAULT 'user',\n        created_at INTEGER NOT NULL,\n        updated_at INTEGER NOT NULL\n      , project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, workspace_kind TEXT NOT NULL DEFAULT 'legacy', workspace_root TEXT, workspace_cwd TEXT, workspace_roots TEXT, instruction_sources TEXT, output_directory TEXT, create_operation_id TEXT, create_request_hash TEXT, archived_at INTEGER, preview TEXT, first_user_message TEXT, message_count INTEGER NOT NULL DEFAULT 0, prompt_settings TEXT NOT NULL DEFAULT '{}', queue_version INTEGER NOT NULL DEFAULT 0, queue_pause_reason TEXT, git_branch TEXT, workspace_owner_thread_id TEXT)",
  "CREATE TABLE thread_execution_bindings (\n          thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,\n          binding_id TEXT NOT NULL UNIQUE,\n          kind TEXT NOT NULL CHECK(kind IN ('local','worktree')),\n          project_id TEXT,\n          cwd TEXT NOT NULL,\n          worktree_id TEXT REFERENCES managed_worktrees(id) ON DELETE RESTRICT,\n          revision INTEGER NOT NULL DEFAULT 1,\n          environment_revision INTEGER NOT NULL DEFAULT 0,\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL,\n          CHECK((kind = 'local' AND worktree_id IS NULL) OR (kind = 'worktree' AND project_id IS NOT NULL AND worktree_id IS NOT NULL))\n        )",
  "CREATE TABLE thread_handoff_operations (\n          operation_id TEXT PRIMARY KEY,\n          source_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          target_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,\n          source_binding_id TEXT,\n          target_binding_id TEXT,\n          destination_kind TEXT CHECK(destination_kind IN ('local','worktree')),\n          destination_worktree_id TEXT REFERENCES managed_worktrees(id) ON DELETE SET NULL,\n          direction TEXT NOT NULL CHECK(direction IN ('local-to-worktree','worktree-to-local')),\n          request_hash TEXT NOT NULL,\n          status TEXT NOT NULL CHECK(status IN ('running','await-client-transfer','completed','failed','rollback-failed')),\n          step TEXT NOT NULL,\n          revision INTEGER NOT NULL DEFAULT 1,\n          error_code TEXT,\n          warnings TEXT NOT NULL DEFAULT '[]',\n          rollback_journal TEXT NOT NULL DEFAULT '{}',\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL,\n          completed_at INTEGER\n        )",
  "CREATE TABLE thread_message_fork_operations (\n          operation_id TEXT PRIMARY KEY,\n          source_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          source_turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,\n          source_item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,\n          target_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,\n          target_worktree_id TEXT REFERENCES managed_worktrees(id) ON DELETE SET NULL,\n          worktree_operation_id TEXT REFERENCES worktree_operations(operation_id) ON DELETE SET NULL,\n          destination_kind TEXT NOT NULL CHECK(destination_kind IN ('same-worktree','new-worktree')),\n          snapshot_mode TEXT CHECK(snapshot_mode IN ('shared','head','working-tree')),\n          request_hash TEXT NOT NULL,\n          status TEXT NOT NULL CHECK(status IN ('running','awaiting-setup-decision','completed','failed','abandoned')),\n          step TEXT NOT NULL CHECK(step IN ('preflight','prepare-worktree','setup','fork-history','bind-target','complete')),\n          revision INTEGER NOT NULL DEFAULT 1,\n          error_code TEXT,\n          warnings TEXT NOT NULL DEFAULT '[]',\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL,\n          completed_at INTEGER\n        )",
  'CREATE TABLE thread_message_forks (\n          target_thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,\n          source_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          source_turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,\n          source_item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,\n          operation_id TEXT NOT NULL UNIQUE REFERENCES thread_message_fork_operations(operation_id) ON DELETE CASCADE,\n          created_at INTEGER NOT NULL\n        )',
  'CREATE TABLE thread_side_chats (\n          thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,\n          source_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          inherited_through_turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,\n          reference_text TEXT,\n          operation_id TEXT NOT NULL UNIQUE,\n          created_at INTEGER NOT NULL\n        )',
  'CREATE TABLE thread_forks (\n          target_thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,\n          source_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE RESTRICT,\n          operation_id TEXT NOT NULL UNIQUE REFERENCES thread_handoff_operations(operation_id) ON DELETE RESTRICT,\n          created_at INTEGER NOT NULL\n        )',
  'CREATE TABLE thread_read_state (\n        thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,\n        read_at INTEGER NOT NULL DEFAULT 0,\n        unread_at INTEGER,\n        updated_at INTEGER NOT NULL\n      )',
  'CREATE TABLE tool_calls (\n        id TEXT PRIMARY KEY,\n        thread_id TEXT NOT NULL,\n        turn_id TEXT NOT NULL,\n        agent_id TEXT NOT NULL,\n        tool_name TEXT NOT NULL,\n        input TEXT NOT NULL,\n        output TEXT,\n        status TEXT NOT NULL,\n        started_at INTEGER,\n        finished_at INTEGER,\n        error TEXT\n      )',
  'CREATE TABLE turn_git_snapshots (\n          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,\n          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,\n          repository_root TEXT NOT NULL,\n          before_tree TEXT,\n          after_tree TEXT,\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL,\n          PRIMARY KEY (thread_id, turn_id)\n        )',
  'CREATE TABLE turn_pi_boundaries (\n          turn_id TEXT PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,\n          session_id TEXT NOT NULL,\n          entry_id TEXT NOT NULL,\n          FOREIGN KEY (session_id, entry_id) REFERENCES pi_session_entries(session_id, id) ON DELETE CASCADE\n        )',
  "CREATE TABLE turns (\n        id TEXT PRIMARY KEY,\n        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n        root_agent_id TEXT,\n        status TEXT NOT NULL,\n        mode TEXT NOT NULL,\n        sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write',\n        approval_policy TEXT NOT NULL DEFAULT 'on-request',\n        approvals_reviewer TEXT NOT NULL DEFAULT 'user',\n        model_ref TEXT NOT NULL,\n        strategy TEXT NOT NULL,\n        started_at INTEGER,\n        finished_at INTEGER,\n        created_at INTEGER NOT NULL,\n        updated_at INTEGER NOT NULL\n      , queue_position INTEGER)",
  'CREATE TABLE workspace_writer_leases (\n          workspace_key TEXT PRIMARY KEY,\n          task_id TEXT NOT NULL REFERENCES subagent_tasks(id) ON DELETE CASCADE,\n          run_id TEXT NOT NULL REFERENCES subagent_runs(id) ON DELETE CASCADE,\n          acquired_at INTEGER NOT NULL\n        )',
  "CREATE TABLE worktree_operations (\n          operation_id TEXT PRIMARY KEY,\n          worktree_id TEXT REFERENCES managed_worktrees(id) ON DELETE SET NULL,\n          project_id TEXT NOT NULL,\n          kind TEXT NOT NULL CHECK(kind IN ('create','retry-setup','continue-without-setup','set-permanent','delete','restore','auto-cleanup')),\n          request_hash TEXT NOT NULL,\n          step TEXT NOT NULL,\n          status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed')),\n          revision INTEGER NOT NULL DEFAULT 1,\n          error_code TEXT,\n          warnings TEXT NOT NULL DEFAULT '[]',\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL,\n          completed_at INTEGER\n        )",
  'CREATE TABLE taskboard_project_sequences (\n          project_id TEXT PRIMARY KEY,\n          next_number INTEGER NOT NULL CHECK(next_number >= 1),\n          updated_at INTEGER NOT NULL\n        )',
  "CREATE TABLE taskboard_tasks (\n          id TEXT PRIMARY KEY,\n          project_id TEXT NOT NULL,\n          number INTEGER NOT NULL CHECK(number >= 1),\n          title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),\n          description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 65536),\n          status TEXT NOT NULL CHECK(status IN ('backlog','todo','in_progress','in_review','done')),\n          priority TEXT NOT NULL DEFAULT 'none' CHECK(priority IN ('none','urgent','high','medium','low')),\n          position INTEGER NOT NULL CHECK(position >= 0),\n          version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),\n          archived_at INTEGER,\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL,\n          UNIQUE(project_id, number)\n        )",
  'CREATE TABLE taskboard_labels (\n          id TEXT PRIMARY KEY,\n          project_id TEXT NOT NULL,\n          name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40),\n          normalized_name TEXT NOT NULL,\n          version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL,\n          UNIQUE(project_id, normalized_name)\n        )',
  'CREATE TABLE taskboard_task_labels (\n          task_id TEXT NOT NULL REFERENCES taskboard_tasks(id) ON DELETE CASCADE,\n          label_id TEXT NOT NULL REFERENCES taskboard_labels(id) ON DELETE CASCADE,\n          created_at INTEGER NOT NULL,\n          PRIMARY KEY(task_id, label_id)\n        )',
  "CREATE TABLE taskboard_task_threads (\n          task_id TEXT NOT NULL REFERENCES taskboard_tasks(id) ON DELETE CASCADE,\n          thread_id TEXT NOT NULL UNIQUE REFERENCES threads(id) ON DELETE CASCADE,\n          role TEXT NOT NULL CHECK(role IN ('primary','supporting')),\n          version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),\n          linked_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL,\n          PRIMARY KEY(task_id, thread_id)\n        )",
  "CREATE TABLE taskboard_comments (\n          id TEXT PRIMARY KEY,\n          task_id TEXT NOT NULL REFERENCES taskboard_tasks(id) ON DELETE CASCADE,\n          body TEXT NOT NULL CHECK(length(body) <= 32768),\n          author TEXT NOT NULL CHECK(author IN ('user','agent')),\n          source_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,\n          version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),\n          deleted_at INTEGER,\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL\n        )",
  "CREATE TABLE taskboard_activities (\n          id TEXT PRIMARY KEY,\n          task_id TEXT NOT NULL REFERENCES taskboard_tasks(id) ON DELETE CASCADE,\n          kind TEXT NOT NULL CHECK(kind IN ('task_created','task_updated','task_moved','task_archived','task_restored','comment_created','comment_updated','comment_deleted','thread_linked','thread_unlinked','primary_changed','label_created','label_updated','label_deleted','execution_started')),\n          actor TEXT NOT NULL CHECK(actor IN ('user','agent','system')),\n          source_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,\n          data TEXT NOT NULL DEFAULT '{}',\n          created_at INTEGER NOT NULL\n        )",
  "CREATE TABLE taskboard_operations (\n          operation_id TEXT PRIMARY KEY,\n          project_id TEXT NOT NULL,\n          task_id TEXT,\n          method TEXT NOT NULL,\n          request_hash TEXT NOT NULL,\n          status TEXT NOT NULL CHECK(status IN ('pending','completed')),\n          result TEXT,\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL\n        )",
  "CREATE TABLE taskboard_start_operations (\n          operation_id TEXT PRIMARY KEY,\n          task_id TEXT NOT NULL REFERENCES taskboard_tasks(id) ON DELETE CASCADE,\n          project_id TEXT NOT NULL,\n          thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,\n          worktree_id TEXT REFERENCES managed_worktrees(id) ON DELETE SET NULL,\n          request_hash TEXT NOT NULL,\n          execution TEXT NOT NULL,\n          status TEXT NOT NULL CHECK(status IN ('running','awaiting_setup_decision','completed','failed','rollback_failed')),\n          step TEXT NOT NULL CHECK(step IN ('preflight','prepare_worktree','create_thread','link','complete')),\n          revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),\n          error_code TEXT,\n          warnings TEXT NOT NULL DEFAULT '[]',\n          startup_instruction TEXT,\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL,\n          completed_at INTEGER\n        )",
  "CREATE TABLE taskboard_task_workflows (\n          task_id TEXT PRIMARY KEY REFERENCES taskboard_tasks(id) ON DELETE CASCADE,\n          status TEXT NOT NULL CHECK(status IN ('backlog','todo','in_progress','in_review','blocked','done','canceled')),\n          position REAL NOT NULL,\n          start_date TEXT CHECK(start_date IS NULL OR start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),\n          due_date TEXT CHECK(due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL\n        )",
  "CREATE TABLE taskboard_task_attention (\n          task_id TEXT PRIMARY KEY REFERENCES taskboard_tasks(id) ON DELETE CASCADE,\n          unread INTEGER NOT NULL DEFAULT 0 CHECK(unread IN (0,1)),\n          unread_at INTEGER,\n          read_at INTEGER,\n          reason TEXT CHECK(reason IS NULL OR reason IN ('review_requested','blocked','agent_comment','execution_attention')),\n          updated_at INTEGER NOT NULL\n        )",
  ...TASK_CONTEXT_SCHEMA,
  ...TASKBOARD_PLANNING_SCHEMA,
  ...SESSION_GROUP_SCHEMA,
  ...AUTOMATION_SCHEMA,
  ...SCHEDULE_CALENDAR_SCHEMA,
  ...PLAN_APPROVAL_SCHEMA,
  ...THREAD_GOAL_SCHEMA,
  ...THREAD_GOAL_LEDGER_SCHEMA,
  ...THREAD_GOAL_CONTINUATION_SCHEMA,
  ...THREAD_BOOKMARK_SCHEMA,
  ...THREAD_WORKTREE_OPERATION_SCHEMA,
  ...WORKTREE_SETTINGS_SCHEMA,
  ...LOCAL_ENVIRONMENT_SELECTION_SCHEMA,
  ...PR_WATCH_SCHEMA,
  ...AUTOMATION_HOST_AUDIT_SCHEMA,
  ...SUBAGENT_COLLABORATION_SCHEMA,
  ...BROWSER_SCHEMA,
  ...BROWSER_DATA_SCHEMA,
  'CREATE INDEX agent_checkpoints_thread ON agent_checkpoints(thread_id, updated_at DESC)',
  'CREATE INDEX agent_compactions_thread ON agent_compactions(thread_id, created_at DESC)',
  'CREATE UNIQUE INDEX agent_executions_run_sequence_unique ON agent_executions(subagent_run_id, run_sequence) WHERE subagent_run_id IS NOT NULL',
  'CREATE INDEX agent_executions_subagent_run ON agent_executions(subagent_run_id, run_sequence)',
  'CREATE INDEX agent_executions_thread_updated ON agent_executions(thread_id, updated_at DESC)',
  'CREATE INDEX context_usage_samples_lookup\n          ON context_usage_samples(thread_id, context_fingerprint, source, created_at DESC)',
  "CREATE UNIQUE INDEX credentials_api_key_fingerprint ON credentials(integration_id, fingerprint)\n          WHERE kind = 'api-key' AND fingerprint IS NOT NULL",
  'CREATE INDEX credentials_integration_priority ON credentials(integration_id, kind, priority, created_at)',
  'CREATE INDEX events_thread_id ON events(thread_id, id)',
  'CREATE INDEX hook_runs_thread ON hook_runs(thread_id, started_at DESC)',
  "CREATE UNIQUE INDEX hook_trust_requests_pending\n          ON hook_trust_requests(workspace_path, config_hash) WHERE status = 'pending'",
  'CREATE INDEX input_attachments_thread ON input_attachments(thread_id, created_at)',
  'CREATE INDEX input_context_paths_reference ON input_context_paths(context_path_id, created_at)',
  'CREATE INDEX thread_context_paths_thread ON thread_context_paths(thread_id, created_at)',
  'CREATE INDEX interaction_operations_interaction\n          ON interaction_operations(interaction_id, created_at)',
  'CREATE INDEX items_turn_created ON items(turn_id, created_at)',
  'CREATE INDEX item_artifacts_item ON item_artifacts(item_id, created_at)',
  'CREATE INDEX item_artifacts_thread ON item_artifacts(thread_id, created_at)',
  'CREATE UNIQUE INDEX items_turn_ordinal_unique ON items(turn_id, ordinal)',
  'CREATE INDEX memory_entries_scope ON memory_entries(scope, project_key, updated_at DESC)',
  'CREATE INDEX memory_jobs_status ON memory_jobs(status, created_at)',
  'CREATE INDEX messages_session_ordinal ON messages(thread_id, ordinal, id)',
  'CREATE INDEX pi_session_entries_type\n          ON pi_session_entries(session_id, type, sequence)',
  'CREATE INDEX pi_sessions_thread_agent\n          ON pi_sessions(thread_id, agent_id, updated_at DESC)',
  'CREATE INDEX runtime_composition_plans_agent ON runtime_composition_plans(agent_id, created_at DESC)',
  'CREATE INDEX projects_last_opened ON projects(last_opened_at DESC)',
  "CREATE UNIQUE INDEX project_one_primary ON project_folders(project_id) WHERE role = 'primary'",
  'CREATE INDEX project_folders_project_order ON project_folders(project_id, role, sort_order, created_at)',
  'CREATE INDEX project_folders_path_key ON project_folders(path_key)',
  'CREATE INDEX project_sources_project_created ON project_sources(project_id, created_at, id)',
  'CREATE INDEX project_operations_status ON project_operations(status, created_at)',
  'CREATE INDEX review_comments_scope\n          ON review_comments(thread_id, project_id, source_key, updated_at)',
  'CREATE INDEX sandbox_escalations_turn_status ON sandbox_escalations(turn_id, status, created_at)',
  'CREATE INDEX resume_checkpoint_leases_status ON resume_checkpoint_leases(status, updated_at)',
  'CREATE INDEX subagent_controls_pending ON subagent_controls(run_id, status, created_at)',
  'CREATE INDEX subagent_runs_status_created ON subagent_runs(status, created_at)',
  'CREATE INDEX subagent_tasks_parent_updated ON subagent_tasks(parent_thread_id, updated_at DESC)',
  'CREATE UNIQUE INDEX threads_create_operation_unique\n          ON threads(create_operation_id) WHERE create_operation_id IS NOT NULL',
  'CREATE INDEX threads_parent_kind ON threads(parent_thread_id, kind, updated_at DESC)',
  'CREATE INDEX threads_project_archive_updated ON threads(project_id, archived_at, updated_at DESC, id DESC)',
  'CREATE INDEX threads_project_updated ON threads(project_id, updated_at DESC)',
  'CREATE INDEX idx_thread_execution_worktree ON thread_execution_bindings(worktree_id, updated_at DESC)',
  'CREATE INDEX idx_thread_handoff_source_status ON thread_handoff_operations(source_thread_id, status)',
  'CREATE INDEX idx_thread_message_fork_source_status ON thread_message_fork_operations(source_thread_id, status, updated_at DESC)',
  "CREATE UNIQUE INDEX idx_thread_message_fork_pending_boundary ON thread_message_fork_operations(source_thread_id, source_turn_id, source_item_id) WHERE status IN ('running','awaiting-setup-decision')",
  'CREATE INDEX idx_thread_message_forks_source ON thread_message_forks(source_thread_id, created_at)',
  'CREATE INDEX thread_side_chats_source_created ON thread_side_chats(source_thread_id, created_at)',
  'CREATE INDEX idx_thread_forks_source ON thread_forks(source_thread_id, created_at)',
  'CREATE INDEX turn_git_snapshots_project\n          ON turn_git_snapshots(project_id, updated_at DESC)',
  'CREATE INDEX turns_queue_position ON turns(thread_id, status, queue_position, created_at)',
  'CREATE INDEX turns_thread_history ON turns(thread_id, created_at DESC, id DESC)',
  'CREATE INDEX turns_thread_status ON turns(thread_id, status, created_at)',
  'CREATE INDEX idx_managed_worktrees_project_status ON managed_worktrees(project_id, status, last_used_at)',
  'CREATE INDEX idx_worktree_operations_status ON worktree_operations(status, created_at)',
  'CREATE INDEX taskboard_tasks_project_board ON taskboard_tasks(project_id, archived_at, status, position, id)',
  'CREATE INDEX taskboard_labels_project_name ON taskboard_labels(project_id, normalized_name, id)',
  'CREATE INDEX taskboard_task_labels_label ON taskboard_task_labels(label_id, task_id)',
  "CREATE UNIQUE INDEX taskboard_one_primary_thread ON taskboard_task_threads(task_id) WHERE role = 'primary'",
  'CREATE INDEX taskboard_task_threads_task ON taskboard_task_threads(task_id, role, linked_at, thread_id)',
  'CREATE INDEX taskboard_comments_task_created ON taskboard_comments(task_id, created_at, id)',
  'CREATE INDEX taskboard_activities_task_created ON taskboard_activities(task_id, created_at, id)',
  'CREATE INDEX taskboard_operations_status ON taskboard_operations(status, created_at)',
  'CREATE INDEX taskboard_start_operations_status ON taskboard_start_operations(status, updated_at)',
  'CREATE INDEX taskboard_task_workflows_board ON taskboard_task_workflows(status, task_id)',
  'CREATE INDEX taskboard_task_attention_unread ON taskboard_task_attention(unread, unread_at DESC, task_id)',
  'CREATE TRIGGER taskboard_workflow_after_task_insert\n        AFTER INSERT ON taskboard_tasks\n        BEGIN\n          INSERT OR IGNORE INTO taskboard_task_workflows (task_id, status, position, start_date, due_date, created_at, updated_at)\n            VALUES (NEW.id, NEW.status, NEW.position, NULL, NULL, NEW.created_at, NEW.updated_at);\n          INSERT OR IGNORE INTO taskboard_task_attention (task_id, unread, unread_at, read_at, reason, updated_at)\n            VALUES (NEW.id, 0, NULL, NULL, NULL, NEW.updated_at);\n        END',
  'CREATE TRIGGER taskboard_workflow_after_legacy_status_change\n        AFTER UPDATE OF status ON taskboard_tasks\n        WHEN OLD.status IS NOT NEW.status\n        BEGIN\n          INSERT INTO taskboard_task_workflows (task_id, status, position, start_date, due_date, created_at, updated_at)\n            VALUES (NEW.id, NEW.status, NEW.position, NULL, NULL, NEW.created_at, NEW.updated_at)\n            ON CONFLICT(task_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at;\n        END',
  'CREATE TRIGGER taskboard_workflow_after_legacy_position_change\n        AFTER UPDATE OF position ON taskboard_tasks\n        WHEN OLD.position IS NOT NEW.position\n        BEGIN\n          UPDATE taskboard_task_workflows SET position = NEW.position, updated_at = NEW.updated_at WHERE task_id = NEW.id;\n        END',
  "CREATE TRIGGER taskboard_attention_after_primary_turn_needs_user\n        AFTER UPDATE OF status ON turns\n        WHEN OLD.status IS NOT NEW.status AND NEW.status IN ('waiting_permission','waiting_question','failed')\n        BEGIN\n          UPDATE taskboard_task_attention\n          SET unread = 1, unread_at = MAX(COALESCE(unread_at, 0), NEW.updated_at), reason = 'execution_attention', updated_at = NEW.updated_at\n          WHERE task_id IN (\n            SELECT links.task_id FROM taskboard_task_threads links\n            JOIN taskboard_tasks tasks ON tasks.id = links.task_id\n            WHERE links.thread_id = NEW.thread_id AND links.role = 'primary' AND tasks.archived_at IS NULL\n          );\n        END",
  'CREATE TRIGGER thread_side_chats_delete_with_source\n        BEFORE DELETE ON threads\n        BEGIN\n          DELETE FROM threads\n          WHERE id IN (\n            SELECT thread_id FROM thread_side_chats WHERE source_thread_id = OLD.id\n          ) AND archived_at = -1;\n        END',
  "CREATE TRIGGER threads_workspace_insert_valid\n        BEFORE INSERT ON threads\n        WHEN NOT (\n          (NEW.workspace_kind = 'project' AND NEW.project_id IS NOT NULL\n            AND NEW.workspace_root IS NULL AND NEW.workspace_cwd IS NOT NULL\n            AND NEW.workspace_roots IS NOT NULL AND NEW.instruction_sources IS NOT NULL\n            AND NEW.output_directory IS NULL)\n          OR\n          (NEW.workspace_kind = 'projectless' AND NEW.project_id IS NULL\n            AND NEW.workspace_root IS NOT NULL AND NEW.workspace_cwd IS NOT NULL AND NEW.output_directory IS NOT NULL)\n          OR\n          (NEW.workspace_kind = 'legacy' AND NEW.project_id IS NULL\n            AND NEW.workspace_root IS NULL AND NEW.workspace_cwd IS NULL AND NEW.output_directory IS NULL)\n        )\n        BEGIN\n          SELECT RAISE(ABORT, 'invalid thread workspace descriptor');\n        END",
  "CREATE TRIGGER threads_workspace_update_valid\n        BEFORE UPDATE OF project_id, workspace_kind, workspace_root, workspace_cwd, workspace_roots, instruction_sources, output_directory ON threads\n        WHEN NOT (\n          (NEW.workspace_kind = 'project' AND NEW.project_id IS NOT NULL\n            AND NEW.workspace_root IS NULL AND NEW.workspace_cwd IS NOT NULL\n            AND NEW.workspace_roots IS NOT NULL AND NEW.instruction_sources IS NOT NULL\n            AND NEW.output_directory IS NULL)\n          OR\n          (NEW.workspace_kind = 'projectless' AND NEW.project_id IS NULL\n            AND NEW.workspace_root IS NOT NULL AND NEW.workspace_cwd IS NOT NULL AND NEW.output_directory IS NOT NULL)\n          OR\n          (NEW.workspace_kind = 'legacy' AND NEW.project_id IS NULL\n            AND NEW.workspace_root IS NULL AND NEW.workspace_cwd IS NULL AND NEW.output_directory IS NULL)\n        )\n        BEGIN\n          SELECT RAISE(ABORT, 'invalid thread workspace descriptor');\n        END",
] as const

const PROFILE_TABLES = new Set([
  'app_settings',
  'projects',
  'project_settings',
  'project_folders',
  'project_sources',
  'project_operations',
  'provider_settings',
  'credentials',
  'credential_health',
  'integration_credential_bindings',
  'hook_trust_decisions',
  'memory_entries',
])

const tableName = (statement: string) => {
  const match = statement.match(/^CREATE TABLE\s+(?:"([^"]+)"|([^\s(]+))/)
  return match?.[1] ?? match?.[2] ?? null
}

const indexTable = (statement: string) => {
  const match = statement.match(/\sON\s+(?:"([^"]+)"|([^\s(]+))/)
  return match?.[1] ?? match?.[2] ?? null
}

type RecoverableEventItem = {
  id: string
  turnID: string
  agentID: string
  type: string
  status: string
  data: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

const recoverableEventItem = (
  value: unknown,
  fallbackTurnID: string | null,
  eventCreatedAt: number,
): RecoverableEventItem | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  const id = typeof item.id === 'string' ? item.id : null
  const turnID =
    typeof item.turnID === 'string'
      ? item.turnID
      : typeof item.turnId === 'string'
        ? item.turnId
        : fallbackTurnID
  const agentID =
    typeof item.agentID === 'string'
      ? item.agentID
      : typeof item.agentId === 'string'
        ? item.agentId
        : null
  const type = typeof item.type === 'string' ? item.type : null
  if (!id || !turnID || !agentID || !type) return null
  const data =
    item.data && typeof item.data === 'object' && !Array.isArray(item.data)
      ? (item.data as Record<string, unknown>)
      : type === 'text'
        ? {
            placement: item.placement === 'process' ? 'process' : 'result',
            text: typeof item.text === 'string' ? item.text : '',
          }
        : {}
  return {
    id,
    turnID,
    agentID,
    type,
    status:
      typeof item.status === 'string' ? item.status : type === 'tool' ? 'completed' : 'completed',
    data,
    createdAt: typeof item.createdAt === 'number' ? item.createdAt : eventCreatedAt,
    updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : eventCreatedAt,
  }
}

const migrateHistory18To19 = (sqlite: Database) => {
  sqlite.exec('ALTER TABLE items ADD COLUMN ordinal INTEGER')
  const eventRows = sqlite
    .query(
      `
    SELECT id, thread_id, turn_id, method, params, created_at
    FROM events
    WHERE method IN ('item/started', 'item/completed', 'tool/callStarted')
    ORDER BY id
  `,
    )
    .all() as Array<{
    id: number
    thread_id: string | null
    turn_id: string | null
    method: string
    params: string
    created_at: number
  }>
  const textSnapshots = new Map<
    string,
    Array<{ eventID: number; threadID: string; item: RecoverableEventItem }>
  >()

  for (const row of eventRows) {
    let params: Record<string, unknown>
    try {
      const parsed = JSON.parse(row.params)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      params = parsed as Record<string, unknown>
    } catch {
      continue
    }
    const item = recoverableEventItem(params.item, row.turn_id, row.created_at)
    if (!item || item.type !== 'text' || row.method !== 'item/completed' || !row.thread_id) continue
    const text = typeof item.data.text === 'string' ? item.data.text : ''
    if (!text.trim()) continue
    const key = `${item.turnID}\u0000${item.id}`
    textSnapshots.set(key, [
      ...(textSnapshots.get(key) ?? []),
      { eventID: row.id, threadID: row.thread_id, item },
    ])
  }

  for (const snapshots of textSnapshots.values()) {
    if (snapshots.length < 2) continue
    const originalID = snapshots[0]!.item.id
    const original = sqlite.query('SELECT type, data FROM items WHERE id = ?').get(originalID) as {
      type: string
      data: string
    } | null
    let originalText: string | null = null
    try {
      const data = original ? (JSON.parse(original.data) as Record<string, unknown>) : null
      originalText = typeof data?.text === 'string' ? data.text : null
    } catch {
      originalText = null
    }
    const fullyReplaced =
      original?.type === 'text' &&
      originalText !== null &&
      snapshots.some((snapshot) => snapshot.item.data.text === originalText)
    if (fullyReplaced) sqlite.query('DELETE FROM items WHERE id = ?').run(originalID)
    for (const snapshot of snapshots) {
      const item = snapshot.item
      const recoveredID = `${item.id}:history:${snapshot.eventID}`
      sqlite
        .query(
          `
        INSERT OR IGNORE INTO items
          (id, thread_id, turn_id, agent_id, type, status, data, ordinal, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'text', ?, ?, NULL, ?, ?)
      `,
        )
        .run(
          recoveredID,
          snapshot.threadID,
          item.turnID,
          item.agentID,
          item.status,
          JSON.stringify(item.data),
          item.createdAt,
          item.updatedAt,
        )
    }
  }

  const turns = sqlite.query('SELECT DISTINCT turn_id FROM items ORDER BY turn_id').all() as Array<{
    turn_id: string
  }>
  for (const { turn_id: turnID } of turns) {
    const rows = sqlite
      .query(
        `
      SELECT id, type, created_at
      FROM items
      WHERE turn_id = ?
      ORDER BY created_at, id
    `,
      )
      .all(turnID) as Array<{ id: string; type: string; created_at: number }>
    rows.sort((left, right) => {
      const created = left.created_at - right.created_at
      if (created !== 0) return created
      const priority = (type: string) =>
        type === 'text' ? 0 : type === 'reasoning' ? 1 : type === 'tool' ? 2 : 3
      return priority(left.type) - priority(right.type) || left.id.localeCompare(right.id)
    })
    rows.forEach((row, ordinal) => {
      sqlite.query('UPDATE items SET ordinal = ? WHERE id = ?').run(ordinal, row.id)
    })
  }
  sqlite.exec('CREATE UNIQUE INDEX items_turn_ordinal_unique ON items(turn_id, ordinal)')
}

const migrateHistory19To20 = (sqlite: Database) => {
  sqlite.exec('ALTER TABLE threads ADD COLUMN git_branch TEXT')
}

const legacyProjectMemoryKey = (workspacePath: string) =>
  createHash('sha256')
    .update(workspacePath.replaceAll('\\', '/').replace(/\/$/, '').toLocaleLowerCase('en-US'))
    .digest('hex')

const projectPathKey = (workspacePath: string) => {
  const normalized = resolve(workspacePath).replaceAll('\\', '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

const migrateProfile3To4 = (sqlite: Database) => {
  const columns = new Set(
    (sqlite.query('PRAGMA table_info(project_settings)').all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  )
  if (columns.size === 0 || columns.has('execution_environment')) return
  // Additive with a default, so existing projects keep their previous behaviour.
  sqlite.exec(
    "ALTER TABLE project_settings ADD COLUMN execution_environment TEXT NOT NULL DEFAULT 'auto' CHECK(execution_environment IN ('auto','local'))",
  )
}

const migrateProfile2To3 = (sqlite: Database) => {
  const projects = sqlite
    .query(
      `
    SELECT id, name, root_path, created_at, updated_at, last_opened_at
    FROM projects
  `,
    )
    .all() as Array<{
    id: string
    name: string
    root_path: string
    created_at: number
    updated_at: number
    last_opened_at: number
  }>
  const settings = sqlite
    .query(
      `
    SELECT project_id, default_model, updated_at FROM project_settings
  `,
    )
    .all() as Array<{ project_id: string; default_model: string | null; updated_at: number }>

  sqlite.exec('ALTER TABLE project_settings RENAME TO project_settings_v2')
  sqlite.exec('ALTER TABLE projects RENAME TO projects_v2')
  sqlite.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      removed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_opened_at INTEGER NOT NULL
    );
    CREATE TABLE project_settings (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      default_model TEXT,
      instructions TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE project_folders (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      path_key TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('primary', 'secondary')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id, path_key)
    );
    CREATE TABLE project_sources (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      storage_kind TEXT NOT NULL CHECK(storage_kind IN ('managed', 'workspace-file')),
      content_kind TEXT NOT NULL CHECK(content_kind IN ('text', 'image')),
      name TEXT NOT NULL,
      media_type TEXT,
      size_bytes INTEGER,
      sha256 TEXT,
      storage_path TEXT,
      folder_id TEXT REFERENCES project_folders(id) ON DELETE CASCADE,
      relative_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK((storage_kind = 'managed' AND media_type IS NOT NULL AND size_bytes IS NOT NULL AND sha256 IS NOT NULL AND storage_path IS NOT NULL AND folder_id IS NULL AND relative_path IS NULL) OR (storage_kind = 'workspace-file' AND folder_id IS NOT NULL AND relative_path IS NOT NULL AND storage_path IS NULL))
    );
    CREATE TABLE project_operations (
      operation_id TEXT PRIMARY KEY,
      project_id TEXT,
      method TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'completed')),
      result TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  for (const project of projects) {
    sqlite
      .query(
        `
      INSERT INTO projects (id, name, removed_at, created_at, updated_at, last_opened_at)
      VALUES (?, ?, NULL, ?, ?, ?)
    `,
      )
      .run(project.id, project.name, project.created_at, project.updated_at, project.last_opened_at)
    sqlite
      .query(
        `
      INSERT INTO project_folders (
        id, project_id, path, path_key, role, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'primary', 0, ?, ?)
    `,
      )
      .run(
        crypto.randomUUID(),
        project.id,
        resolve(project.root_path),
        projectPathKey(project.root_path),
        project.created_at,
        project.updated_at,
      )
    sqlite
      .query(
        `
      UPDATE memory_entries SET project_key = ?
      WHERE scope = 'project' AND project_key = ?
    `,
      )
      .run(`project:${project.id}`, legacyProjectMemoryKey(project.root_path))
  }
  for (const setting of settings) {
    sqlite
      .query(
        `
      INSERT INTO project_settings (
        project_id, default_model, instructions, version, updated_at
      ) VALUES (?, ?, '', 1, ?)
    `,
      )
      .run(setting.project_id, setting.default_model, setting.updated_at)
  }
  sqlite.exec(`
    DROP TABLE project_settings_v2;
    DROP TABLE projects_v2;
    CREATE INDEX projects_last_opened ON projects(last_opened_at DESC);
    CREATE UNIQUE INDEX project_one_primary ON project_folders(project_id) WHERE role = 'primary';
    CREATE INDEX project_folders_project_order ON project_folders(project_id, role, sort_order, created_at);
    CREATE INDEX project_folders_path_key ON project_folders(path_key);
    CREATE INDEX project_sources_project_created ON project_sources(project_id, created_at, id);
    CREATE INDEX project_operations_status ON project_operations(status, created_at);
  `)
}

const migrateHistory20To21 = (sqlite: Database) => {
  sqlite.exec(`
    DROP TRIGGER IF EXISTS threads_workspace_insert_valid;
    DROP TRIGGER IF EXISTS threads_workspace_update_valid;
    ALTER TABLE threads ADD COLUMN workspace_roots TEXT;
    ALTER TABLE threads ADD COLUMN instruction_sources TEXT;
    CREATE TRIGGER threads_workspace_insert_valid
      BEFORE INSERT ON threads
      WHEN NOT (
        (NEW.workspace_kind = 'project' AND NEW.project_id IS NOT NULL
          AND NEW.workspace_root IS NULL AND NEW.workspace_cwd IS NOT NULL
          AND NEW.workspace_roots IS NOT NULL AND NEW.instruction_sources IS NOT NULL
          AND NEW.output_directory IS NULL)
        OR
        (NEW.workspace_kind = 'projectless' AND NEW.project_id IS NULL
          AND NEW.workspace_root IS NOT NULL AND NEW.workspace_cwd IS NOT NULL
          AND NEW.output_directory IS NOT NULL)
        OR
        (NEW.workspace_kind = 'legacy' AND NEW.project_id IS NULL
          AND NEW.workspace_root IS NULL AND NEW.workspace_cwd IS NULL
          AND NEW.output_directory IS NULL)
      )
      BEGIN
        SELECT RAISE(ABORT, 'invalid thread workspace descriptor');
      END;
    CREATE TRIGGER threads_workspace_update_valid
      BEFORE UPDATE OF project_id, workspace_kind, workspace_root, workspace_cwd,
        workspace_roots, instruction_sources, output_directory ON threads
      WHEN NOT (
        (NEW.workspace_kind = 'project' AND NEW.project_id IS NOT NULL
          AND NEW.workspace_root IS NULL AND NEW.workspace_cwd IS NOT NULL
          AND NEW.workspace_roots IS NOT NULL AND NEW.instruction_sources IS NOT NULL
          AND NEW.output_directory IS NULL)
        OR
        (NEW.workspace_kind = 'projectless' AND NEW.project_id IS NULL
          AND NEW.workspace_root IS NOT NULL AND NEW.workspace_cwd IS NOT NULL
          AND NEW.output_directory IS NOT NULL)
        OR
        (NEW.workspace_kind = 'legacy' AND NEW.project_id IS NULL
          AND NEW.workspace_root IS NULL AND NEW.workspace_cwd IS NULL
          AND NEW.output_directory IS NULL)
      )
      BEGIN
        SELECT RAISE(ABORT, 'invalid thread workspace descriptor');
      END;
  `)
}

const migrateHistory21To22 = (sqlite: Database) => {
  sqlite.exec(`
    UPDATE threads
    SET updated_at = COALESCE(
      (
        SELECT MAX(messages.created_at)
        FROM messages
        WHERE messages.thread_id = threads.id
      ),
      threads.created_at
    )
    WHERE threads.kind = 'main'
      AND EXISTS (
        SELECT 1
        FROM events
        WHERE events.thread_id = threads.id
          AND events.method = 'thread/updated'
          AND json_valid(events.params)
          AND json_type(events.params, '$.patch.title') IS NOT NULL
          AND json_type(events.params, '$.patch.archived') IS NULL
          AND CAST(json_extract(events.params, '$.updatedAt') AS INTEGER) = threads.updated_at
      )
  `)
}

const migrateHistory22To23 = (sqlite: Database) => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS thread_read_state (
      thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
      read_at INTEGER NOT NULL DEFAULT 0,
      unread_at INTEGER,
      updated_at INTEGER NOT NULL
    )
  `)
}

const migrateHistory23To24 = (sqlite: Database) => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS turn_patch_sets (
      turn_id TEXT PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL UNIQUE,
      apply_state TEXT NOT NULL DEFAULT 'applied' CHECK(apply_state IN ('applied', 'undone')),
      action_version INTEGER NOT NULL DEFAULT 0,
      evidence_complete INTEGER NOT NULL DEFAULT 1 CHECK(evidence_complete IN (0, 1)),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS turn_patch_batches (
      turn_id TEXT NOT NULL REFERENCES turn_patch_sets(turn_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      tool_call_id TEXT NOT NULL UNIQUE,
      files TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (turn_id, ordinal)
    );
    CREATE TABLE IF NOT EXISTS turn_patch_operations (
      operation_id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL REFERENCES turn_patch_sets(turn_id) ON DELETE CASCADE,
      request_hash TEXT NOT NULL,
      result TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
}

const migrateHistory24To25 = (sqlite: Database) => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS managed_worktrees (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      repository_root TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK(status IN ('creating','ready','ready-with-setup-error','deleting','cleaned','restoring','restore-conflict')),
      branch_name TEXT,
      base_commit TEXT NOT NULL,
      head_commit TEXT NOT NULL,
      permanent INTEGER NOT NULL DEFAULT 0 CHECK(permanent IN (0,1)),
      pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
      bound_once INTEGER NOT NULL DEFAULT 0 CHECK(bound_once IN (0,1)),
      setup_status TEXT NOT NULL CHECK(setup_status IN ('pending','succeeded','failed','skipped')),
      environment_revision INTEGER NOT NULL DEFAULT 0,
      continued_without_setup INTEGER NOT NULL DEFAULT 0 CHECK(continued_without_setup IN (0,1)),
      restore_snapshot_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS thread_execution_bindings (
      thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
      binding_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK(kind IN ('local','worktree')),
      project_id TEXT,
      cwd TEXT NOT NULL,
      worktree_id TEXT REFERENCES managed_worktrees(id) ON DELETE RESTRICT,
      revision INTEGER NOT NULL DEFAULT 1,
      environment_revision INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK((kind = 'local' AND worktree_id IS NULL) OR (kind = 'worktree' AND project_id IS NOT NULL AND worktree_id IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS worktree_operations (
      operation_id TEXT PRIMARY KEY,
      worktree_id TEXT REFERENCES managed_worktrees(id) ON DELETE SET NULL,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('create','retry-setup','continue-without-setup','set-permanent','delete','restore','auto-cleanup')),
      request_hash TEXT NOT NULL,
      step TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed')),
      revision INTEGER NOT NULL DEFAULT 1,
      error_code TEXT,
      warnings TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS thread_handoff_operations (
      operation_id TEXT PRIMARY KEY,
      source_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      target_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
      source_binding_id TEXT,
      target_binding_id TEXT,
      destination_kind TEXT CHECK(destination_kind IN ('local','worktree')),
      destination_worktree_id TEXT REFERENCES managed_worktrees(id) ON DELETE SET NULL,
      direction TEXT NOT NULL CHECK(direction IN ('local-to-worktree','worktree-to-local')),
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running','await-client-transfer','completed','failed','rollback-failed')),
      step TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      error_code TEXT,
      warnings TEXT NOT NULL DEFAULT '[]',
      rollback_journal TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS thread_forks (
      target_thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
      source_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE RESTRICT,
      operation_id TEXT NOT NULL UNIQUE REFERENCES thread_handoff_operations(operation_id) ON DELETE RESTRICT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_managed_worktrees_project_status ON managed_worktrees(project_id, status, last_used_at);
    CREATE INDEX IF NOT EXISTS idx_thread_execution_worktree ON thread_execution_bindings(worktree_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_worktree_operations_status ON worktree_operations(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_thread_handoff_source_status ON thread_handoff_operations(source_thread_id,status);
    CREATE INDEX IF NOT EXISTS idx_thread_forks_source ON thread_forks(source_thread_id,created_at);
  `)
}

const migrateHistory25To26 = (sqlite: Database) => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS thread_message_fork_operations (
      operation_id TEXT PRIMARY KEY,
      source_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      source_turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
      source_item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      target_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
      target_worktree_id TEXT REFERENCES managed_worktrees(id) ON DELETE SET NULL,
      worktree_operation_id TEXT REFERENCES worktree_operations(operation_id) ON DELETE SET NULL,
      destination_kind TEXT NOT NULL CHECK(destination_kind IN ('same-worktree','new-worktree')),
      snapshot_mode TEXT CHECK(snapshot_mode IN ('shared','head','working-tree')),
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running','awaiting-setup-decision','completed','failed','abandoned')),
      step TEXT NOT NULL CHECK(step IN ('preflight','prepare-worktree','setup','fork-history','bind-target','complete')),
      revision INTEGER NOT NULL DEFAULT 1,
      error_code TEXT,
      warnings TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS thread_message_forks (
      target_thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
      source_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      source_turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
      source_item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      operation_id TEXT NOT NULL UNIQUE REFERENCES thread_message_fork_operations(operation_id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS turn_pi_boundaries (
      turn_id TEXT PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      FOREIGN KEY (session_id, entry_id) REFERENCES pi_session_entries(session_id, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_thread_message_fork_source_status
      ON thread_message_fork_operations(source_thread_id, status, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_message_fork_pending_boundary
      ON thread_message_fork_operations(source_thread_id, source_turn_id, source_item_id)
      WHERE status IN ('running','awaiting-setup-decision');
    CREATE INDEX IF NOT EXISTS idx_thread_message_forks_source
      ON thread_message_forks(source_thread_id, created_at);
  `)
}

const migrateHistory26To27 = (sqlite: Database) => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS resume_checkpoint_leases (
      turn_id TEXT PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
      checkpoint_kind TEXT NOT NULL CHECK(checkpoint_kind IN ('permission','question','hook-trust','subagent-wait')),
      checkpoint_payload TEXT NOT NULL,
      permission_grant TEXT,
      consumer TEXT CHECK(consumer IN ('main','subagent')),
      lease_id TEXT UNIQUE,
      status TEXT NOT NULL CHECK(status IN ('available','acquired','completed','interrupted')),
      created_at INTEGER NOT NULL,
      acquired_at INTEGER,
      completed_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS resume_checkpoint_leases_status
      ON resume_checkpoint_leases(status, updated_at);
  `)
}

const migrateHistory27To28 = (sqlite: Database) => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS thread_side_chats (
      thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
      source_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      inherited_through_turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
      reference_text TEXT,
      operation_id TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS thread_side_chats_source_created
      ON thread_side_chats(source_thread_id, created_at);
    CREATE TRIGGER IF NOT EXISTS thread_side_chats_delete_with_source
      BEFORE DELETE ON threads
      BEGIN
        DELETE FROM threads
        WHERE id IN (
          SELECT thread_id FROM thread_side_chats WHERE source_thread_id = OLD.id
        ) AND archived_at = -1;
      END;
  `)
}

const migrateHistory28To29 = (sqlite: Database) => {
  const table = sqlite
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'prompt_session_state'")
    .get()
  if (!table) return
  const columns = new Set(
    (sqlite.query('PRAGMA table_info(prompt_session_state)').all() as Array<{ name: string }>).map(
      ({ name }) => name,
    ),
  )
  if (!columns.has('auto_compact_failures')) {
    sqlite.exec(
      'ALTER TABLE prompt_session_state ADD COLUMN auto_compact_failures INTEGER NOT NULL DEFAULT 0',
    )
  }
  if (!columns.has('auto_compact_suspended')) {
    sqlite.exec(
      'ALTER TABLE prompt_session_state ADD COLUMN auto_compact_suspended INTEGER NOT NULL DEFAULT 0',
    )
  }
}

const migrateHistory29To30 = (sqlite: Database) => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS thread_context_paths (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      path_key TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('file','directory')),
      created_at INTEGER NOT NULL,
      UNIQUE(thread_id, path_key)
    );
    CREATE TABLE IF NOT EXISTS input_context_paths (
      input_id TEXT NOT NULL REFERENCES inputs(id) ON DELETE CASCADE,
      context_path_id TEXT NOT NULL REFERENCES thread_context_paths(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(input_id, context_path_id)
    );
    CREATE TABLE IF NOT EXISTS context_path_operations (
      operation_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      request_hash TEXT NOT NULL,
      reference_ids TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS input_context_paths_reference
      ON input_context_paths(context_path_id, created_at);
    CREATE INDEX IF NOT EXISTS thread_context_paths_thread
      ON thread_context_paths(thread_id, created_at);
  `)
}

const migrateHistory30To31 = (sqlite: Database) => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS taskboard_project_sequences (
      project_id TEXT PRIMARY KEY,
      next_number INTEGER NOT NULL CHECK(next_number >= 1),
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS taskboard_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      number INTEGER NOT NULL CHECK(number >= 1),
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
      description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 65536),
      status TEXT NOT NULL CHECK(status IN ('backlog','todo','in_progress','in_review','done')),
      priority TEXT NOT NULL DEFAULT 'none' CHECK(priority IN ('none','urgent','high','medium','low')),
      position INTEGER NOT NULL CHECK(position >= 0),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      archived_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id, number)
    );
    CREATE TABLE IF NOT EXISTS taskboard_labels (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
      normalized_name TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id, normalized_name)
    );
    CREATE TABLE IF NOT EXISTS taskboard_task_labels (
      task_id TEXT NOT NULL REFERENCES taskboard_tasks(id) ON DELETE CASCADE,
      label_id TEXT NOT NULL REFERENCES taskboard_labels(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(task_id, label_id)
    );
    CREATE TABLE IF NOT EXISTS taskboard_task_threads (
      task_id TEXT NOT NULL REFERENCES taskboard_tasks(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL UNIQUE REFERENCES threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('primary','supporting')),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      linked_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(task_id, thread_id)
    );
    CREATE TABLE IF NOT EXISTS taskboard_comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES taskboard_tasks(id) ON DELETE CASCADE,
      body TEXT NOT NULL CHECK(length(body) <= 32768),
      author TEXT NOT NULL CHECK(author IN ('user','agent')),
      source_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      deleted_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS taskboard_activities (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES taskboard_tasks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('task_created','task_updated','task_moved','task_archived','task_restored','comment_created','comment_updated','comment_deleted','thread_linked','thread_unlinked','primary_changed','label_created','label_updated','label_deleted','execution_started')),
      actor TEXT NOT NULL CHECK(actor IN ('user','agent','system')),
      source_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
      data TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS taskboard_operations (
      operation_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT,
      method TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','completed')),
      result TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS taskboard_start_operations (
      operation_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES taskboard_tasks(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL,
      thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
      worktree_id TEXT REFERENCES managed_worktrees(id) ON DELETE SET NULL,
      request_hash TEXT NOT NULL,
      execution TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running','awaiting_setup_decision','completed','failed','rollback_failed')),
      step TEXT NOT NULL CHECK(step IN ('preflight','prepare_worktree','create_thread','link','complete')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
      error_code TEXT,
      warnings TEXT NOT NULL DEFAULT '[]',
      startup_instruction TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS taskboard_tasks_project_board
      ON taskboard_tasks(project_id, archived_at, status, position, id);
    CREATE INDEX IF NOT EXISTS taskboard_labels_project_name
      ON taskboard_labels(project_id, normalized_name, id);
    CREATE INDEX IF NOT EXISTS taskboard_task_labels_label
      ON taskboard_task_labels(label_id, task_id);
    CREATE UNIQUE INDEX IF NOT EXISTS taskboard_one_primary_thread
      ON taskboard_task_threads(task_id) WHERE role = 'primary';
    CREATE INDEX IF NOT EXISTS taskboard_task_threads_task
      ON taskboard_task_threads(task_id, role, linked_at, thread_id);
    CREATE INDEX IF NOT EXISTS taskboard_comments_task_created
      ON taskboard_comments(task_id, created_at, id);
    CREATE INDEX IF NOT EXISTS taskboard_activities_task_created
      ON taskboard_activities(task_id, created_at, id);
    CREATE INDEX IF NOT EXISTS taskboard_operations_status
      ON taskboard_operations(status, created_at);
    CREATE INDEX IF NOT EXISTS taskboard_start_operations_status
      ON taskboard_start_operations(status, updated_at);
  `)
}

const migrateHistory31To32 = (sqlite: Database) => {
  const columns = sqlite.query('PRAGMA table_info(threads)').all() as Array<{ name: string }>
  if (!columns.some((col) => col.name === 'creation_surface')) {
    sqlite.exec(
      "ALTER TABLE threads ADD COLUMN creation_surface TEXT CHECK(creation_surface IS NULL OR creation_surface IN ('coding','working','chat'))",
    )
  }
}

const migrateHistory32To33 = (sqlite: Database) => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS item_artifacts (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      storage_kind TEXT NOT NULL CHECK(storage_kind IN ('managed')),
      storage_path TEXT NOT NULL,
      sha256 TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS item_artifacts_item ON item_artifacts(item_id, created_at);
    CREATE INDEX IF NOT EXISTS item_artifacts_thread ON item_artifacts(thread_id, created_at);
  `)
}

const migrateHistory33To34 = (sqlite: Database) => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS runtime_composition_plans (
      turn_id TEXT PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
      composition_id TEXT NOT NULL UNIQUE,
      snapshot_version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS runtime_composition_plans_agent
      ON runtime_composition_plans(agent_id, created_at DESC);
  `)
}

const migrateHistory34To35 = (sqlite: Database) => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS taskboard_task_workflows (
      task_id TEXT PRIMARY KEY REFERENCES taskboard_tasks(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('backlog','todo','in_progress','in_review','blocked','done','canceled')),
      position REAL NOT NULL,
      start_date TEXT CHECK(start_date IS NULL OR start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      due_date TEXT CHECK(due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS taskboard_task_attention (
      task_id TEXT PRIMARY KEY REFERENCES taskboard_tasks(id) ON DELETE CASCADE,
      unread INTEGER NOT NULL DEFAULT 0 CHECK(unread IN (0,1)),
      unread_at INTEGER,
      read_at INTEGER,
      reason TEXT CHECK(reason IS NULL OR reason IN ('review_requested','blocked','agent_comment','execution_attention')),
      updated_at INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO taskboard_task_workflows (task_id, status, position, start_date, due_date, created_at, updated_at)
      SELECT id, status, position, NULL, NULL, created_at, updated_at FROM taskboard_tasks;
    INSERT OR IGNORE INTO taskboard_task_attention (task_id, unread, unread_at, read_at, reason, updated_at)
      SELECT id, 0, NULL, NULL, NULL, updated_at FROM taskboard_tasks;
    CREATE INDEX IF NOT EXISTS taskboard_task_workflows_board
      ON taskboard_task_workflows(status, task_id);
    CREATE INDEX IF NOT EXISTS taskboard_task_attention_unread
      ON taskboard_task_attention(unread, unread_at DESC, task_id);
    CREATE TRIGGER IF NOT EXISTS taskboard_workflow_after_task_insert
      AFTER INSERT ON taskboard_tasks
      BEGIN
        INSERT OR IGNORE INTO taskboard_task_workflows (task_id, status, position, start_date, due_date, created_at, updated_at)
          VALUES (NEW.id, NEW.status, NEW.position, NULL, NULL, NEW.created_at, NEW.updated_at);
        INSERT OR IGNORE INTO taskboard_task_attention (task_id, unread, unread_at, read_at, reason, updated_at)
          VALUES (NEW.id, 0, NULL, NULL, NULL, NEW.updated_at);
      END;
    CREATE TRIGGER IF NOT EXISTS taskboard_workflow_after_legacy_status_change
      AFTER UPDATE OF status ON taskboard_tasks
      WHEN OLD.status IS NOT NEW.status
      BEGIN
        INSERT INTO taskboard_task_workflows (task_id, status, position, start_date, due_date, created_at, updated_at)
          VALUES (NEW.id, NEW.status, NEW.position, NULL, NULL, NEW.created_at, NEW.updated_at)
          ON CONFLICT(task_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at;
      END;
    CREATE TRIGGER IF NOT EXISTS taskboard_workflow_after_legacy_position_change
      AFTER UPDATE OF position ON taskboard_tasks
      WHEN OLD.position IS NOT NEW.position
      BEGIN
        UPDATE taskboard_task_workflows SET position = NEW.position, updated_at = NEW.updated_at WHERE task_id = NEW.id;
      END;
  `)
  const hasTurns = sqlite
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'turns'")
    .get()
  if (hasTurns)
    sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS taskboard_attention_after_primary_turn_needs_user
      AFTER UPDATE OF status ON turns
      WHEN OLD.status IS NOT NEW.status AND NEW.status IN ('waiting_permission','waiting_question','failed')
      BEGIN
        UPDATE taskboard_task_attention
        SET unread = 1, unread_at = MAX(COALESCE(unread_at, 0), NEW.updated_at), reason = 'execution_attention', updated_at = NEW.updated_at
        WHERE task_id IN (
          SELECT links.task_id FROM taskboard_task_threads links
          JOIN taskboard_tasks tasks ON tasks.id = links.task_id
          WHERE links.thread_id = NEW.thread_id AND links.role = 'primary' AND tasks.archived_at IS NULL
        );
      END;
  `)
}

const migrateHistory35To36 = (sqlite: Database) => {
  const workflowColumns = sqlite
    .query('PRAGMA table_info(taskboard_task_workflows)')
    .all() as Array<{ name: string }>
  if (!workflowColumns.some(({ name }) => name === 'position')) {
    sqlite.exec('ALTER TABLE taskboard_task_workflows ADD COLUMN position REAL NOT NULL DEFAULT 0')
  }
  sqlite.exec(`
    UPDATE taskboard_task_workflows
    SET position = COALESCE(
      (SELECT tasks.position FROM taskboard_tasks tasks WHERE tasks.id = taskboard_task_workflows.task_id),
      position
    );
  `)
}

const migrateHistory36To37 = (sqlite: Database) => {
  sqlite.exec(`DROP VIEW IF EXISTS ${SEMANTIC_VIEW_NAME}`)
  sqlite.exec(SEMANTIC_VIEW_SQL)
}

const migrateHistory37To38 = (sqlite: Database) =>
  sqlite.exec(
    TASK_CONTEXT_SCHEMA.map((statement) =>
      statement
        .replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS ')
        .replace(/^CREATE INDEX /, 'CREATE INDEX IF NOT EXISTS '),
    ).join(';\n'),
  )

const migrateHistory38To39 = (sqlite: Database) =>
  sqlite.exec(
    TASKBOARD_PLANNING_SCHEMA.map((statement) =>
      statement
        .replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS ')
        .replace(/^CREATE INDEX /, 'CREATE INDEX IF NOT EXISTS '),
    ).join(';\n'),
  )

const migrateHistory39To40 = (sqlite: Database) =>
  sqlite.exec(
    SESSION_GROUP_SCHEMA.map((statement) =>
      statement
        .replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS ')
        .replace(/^CREATE INDEX /, 'CREATE INDEX IF NOT EXISTS '),
    ).join(';\n'),
  )

// Some prerelease v40 stores were opened after the version bump but before the
// session-group schema landed. Re-run the additive schema idempotently so those
// stores are repaired without replacing or rewriting existing data.
const migrateHistory40To41 = migrateHistory39To40

const migrateHistory41To42 = (sqlite: Database) =>
  sqlite.exec(
    AUTOMATION_SCHEMA.map((statement) =>
      statement
        .replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS ')
        .replace(/^CREATE INDEX /, 'CREATE INDEX IF NOT EXISTS ')
        .replace(/^CREATE UNIQUE INDEX /, 'CREATE UNIQUE INDEX IF NOT EXISTS '),
    ).join(';\n'),
  )

const migrateHistory42To43 = (sqlite: Database) =>
  sqlite.exec(
    SCHEDULE_CALENDAR_SCHEMA.map((statement) =>
      statement
        .replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS ')
        .replace(/^CREATE INDEX /, 'CREATE INDEX IF NOT EXISTS ')
        .replace(/^CREATE UNIQUE INDEX /, 'CREATE UNIQUE INDEX IF NOT EXISTS '),
    ).join(';\n'),
  )

export const backfillProjectThreadWorkspaces = (history: Database, profile: Database) => {
  const projects = profile.query('SELECT id FROM projects').all() as Array<{ id: string }>
  for (const { id } of projects) {
    const folders = profile
      .query(
        `
      SELECT id, path, role
      FROM project_folders
      WHERE project_id = ?
      ORDER BY CASE role WHEN 'primary' THEN 0 ELSE 1 END, sort_order, created_at, id
    `,
      )
      .all(id) as Array<{ id: string; path: string; role: 'primary' | 'secondary' }>
    const primary = folders.find((folder) => folder.role === 'primary')
    if (!primary) continue
    const roots = JSON.stringify(
      folders.map((folder) => ({
        folderId: folder.id,
        path: folder.path,
        role: folder.role,
      })),
    )
    history
      .query(
        `
      UPDATE threads
      SET workspace_cwd = COALESCE(workspace_cwd, ?),
        workspace_roots = COALESCE(workspace_roots, ?),
        instruction_sources = COALESCE(instruction_sources, '[]')
      WHERE project_id = ? AND workspace_kind = 'project'
    `,
      )
      .run(primary.path, roots, id)
    history
      .query(
        `
      UPDATE memory_jobs SET project_key = ?
      WHERE project_key = ?
    `,
      )
      .run(`project:${id}`, legacyProjectMemoryKey(primary.path))
  }
}

/**
 * Read-only semantic history view (schema 37). Exposes the user inputs and the
 * assistant's result texts, plans and tool calls as a stable, JSON-safe,
 * chronologically ordered projection. Views never carry write triggers.
 */
const SEMANTIC_VIEW_NAME = 'thread_semantic_history_v1'

const SEMANTIC_VIEW_SQL = `
  CREATE VIEW ${SEMANTIC_VIEW_NAME} AS
  WITH semantic_history_rows AS (
    SELECT
      threads.id AS thread_id,
      threads.title AS thread_title,
      threads.workspace_cwd AS workspace_cwd,
      inputs.turn_id AS turn_id,
      boundaries.entry_id AS entry_id,
      NULL AS agent_id,
      'user' AS role,
      'message' AS kind,
      inputs.status AS status,
      inputs.content AS content,
      '{}' AS metadata_json,
      inputs.created_at AS created_at,
      0 AS source_rank,
      0 AS ordinal_rank,
      inputs.id AS row_id
    FROM inputs
    JOIN threads ON threads.id = inputs.thread_id
    LEFT JOIN turns ON turns.id = inputs.turn_id
    LEFT JOIN turn_pi_boundaries AS boundaries ON boundaries.turn_id = turns.id

    UNION ALL

    SELECT
      threads.id AS thread_id,
      threads.title AS thread_title,
      threads.workspace_cwd AS workspace_cwd,
      items.turn_id AS turn_id,
      boundaries.entry_id AS entry_id,
      items.agent_id AS agent_id,
      'assistant' AS role,
      CASE items.type
        WHEN 'text' THEN 'text'
        WHEN 'plan' THEN 'plan'
        WHEN 'tool' THEN 'tool'
        ELSE items.type
      END AS kind,
      items.status AS status,
      CASE items.type
        WHEN 'plan' THEN json_extract(items.data, '$.markdown')
        WHEN 'tool' THEN json_extract(items.data, '$.title')
        ELSE json_extract(items.data, '$.text')
      END AS content,
      CASE items.type
        WHEN 'tool' THEN
          '{' || '"output_summary":' || json_quote(
            CASE
              WHEN json_type(items.data, '$.output') = 'text'
                THEN substr(json_extract(items.data, '$.output'), 1, 4000)
              ELSE ''
            END
          ) || ',"output_truncated":' ||
          CASE
            WHEN json_type(items.data, '$.output') = 'text'
              AND length(json_extract(items.data, '$.output')) > 4000
              THEN 'true'
            ELSE 'false'
          END || '}'
        ELSE '{}'
      END AS metadata_json,
      items.created_at AS created_at,
      1 AS source_rank,
      COALESCE(items.ordinal, 0) AS ordinal_rank,
      items.id AS row_id
    FROM items
    JOIN threads ON threads.id = items.thread_id
    LEFT JOIN turn_pi_boundaries AS boundaries ON boundaries.turn_id = items.turn_id
    WHERE items.type IN ('text', 'plan', 'tool')
      AND (items.type <> 'text' OR json_extract(items.data, '$.placement') = 'result')
  )
  SELECT
    thread_id,
    thread_title,
    workspace_cwd,
    turn_id,
    entry_id,
    agent_id,
    role,
    kind,
    status,
    content,
    metadata_json,
    created_at,
    ROW_NUMBER() OVER (
      ORDER BY created_at ASC, source_rank ASC, ordinal_rank ASC, row_id ASC
    ) AS sort_order
  FROM semantic_history_rows
`

export const PROFILE_SCHEMA = FINAL_SCHEMA.filter((statement) => {
  const table = tableName(statement) ?? indexTable(statement)
  return table !== null && PROFILE_TABLES.has(table)
}).map((statement) =>
  statement.replace(
    'source_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL',
    'source_thread_id TEXT',
  ),
)

export const HISTORY_SCHEMA = [
  ...FINAL_SCHEMA.filter((statement) => {
    const table = tableName(statement) ?? indexTable(statement)
    return table === null || !PROFILE_TABLES.has(table)
  }).map((statement) =>
    statement
      .replaceAll(' REFERENCES projects(id) ON DELETE SET NULL', '')
      .replaceAll(' REFERENCES projects(id) ON DELETE CASCADE', ''),
  ),
  SEMANTIC_VIEW_SQL,
]

class SchemaInitializer {
  constructor(
    readonly sqlite: Database,
    readonly kind: 'history' | 'profile',
  ) {}

  initialize() {
    const expectedVersion = this.kind === 'history' ? SCHEMA_VERSION : PROFILE_SCHEMA_VERSION
    const currentVersion = (
      this.sqlite.query('PRAGMA user_version').get() as { user_version: number }
    ).user_version
    if (currentVersion === expectedVersion) {
      // A prerelease profile build could advance user_version to 4 before the
      // additive execution_environment column was installed. Repair that
      // known compatible shape instead of leaving every project read broken.
      if (this.kind === 'profile' && currentVersion === 4) migrateProfile3To4(this.sqlite)
      return
    }
    if (currentVersion > expectedVersion) {
      // Schema 21/profile 3 are forward-compatible baselines. A patched older
      // client uses only its known tables and columns, leaving future additive
      // storage untouched and preserving the newer user_version.
      return
    }
    if (currentVersion !== 0) {
      this.migrate(currentVersion, expectedVersion)
      return
    }

    this.sqlite.transaction(() => {
      const schema = this.kind === 'history' ? HISTORY_SCHEMA : PROFILE_SCHEMA
      this.sqlite.exec(schema.join(';\n'))
      this.sqlite.exec(`PRAGMA user_version = ${expectedVersion}`)
      if (this.kind === 'profile') {
        this.sqlite.exec(`PRAGMA application_id = ${PROFILE_APPLICATION_ID}`)
      }
    })()
  }

  private migrate(from: number, target: number) {
    const migrations: Record<number, () => void> =
      this.kind === 'history'
        ? {
            // prepareStorage rebuilds former mixed v17 databases. Keep the
            // sequential registry entry for already-split prerelease stores.
            17: () => undefined,
            18: () => migrateHistory18To19(this.sqlite),
            19: () => migrateHistory19To20(this.sqlite),
            20: () => migrateHistory20To21(this.sqlite),
            21: () => migrateHistory21To22(this.sqlite),
            22: () => migrateHistory22To23(this.sqlite),
            23: () => migrateHistory23To24(this.sqlite),
            24: () => migrateHistory24To25(this.sqlite),
            25: () => migrateHistory25To26(this.sqlite),
            26: () => migrateHistory26To27(this.sqlite),
            27: () => migrateHistory27To28(this.sqlite),
            28: () => migrateHistory28To29(this.sqlite),
            29: () => migrateHistory29To30(this.sqlite),
            30: () => migrateHistory30To31(this.sqlite),
            31: () => migrateHistory31To32(this.sqlite),
            32: () => migrateHistory32To33(this.sqlite),
            33: () => migrateHistory33To34(this.sqlite),
            34: () => migrateHistory34To35(this.sqlite),
            35: () => migrateHistory35To36(this.sqlite),
            36: () => migrateHistory36To37(this.sqlite),
            37: () => migrateHistory37To38(this.sqlite),
            38: () => migrateHistory38To39(this.sqlite),
            39: () => migrateHistory39To40(this.sqlite),
            40: () => migrateHistory40To41(this.sqlite),
            41: () => migrateHistory41To42(this.sqlite),
            42: () => migrateHistory42To43(this.sqlite),
            43: () =>
              this.sqlite.exec(
                PLAN_APPROVAL_SCHEMA.map((statement) =>
                  statement
                    .replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ')
                    .replace('CREATE UNIQUE INDEX ', 'CREATE UNIQUE INDEX IF NOT EXISTS '),
                ).join(';'),
              ),
            44: () =>
              this.sqlite.exec(
                THREAD_GOAL_SCHEMA_V45.map((statement) =>
                  statement.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS '),
                ).join(';'),
              ),
            45: () => migrateThreadGoals45To46(this.sqlite),
            46: () =>
              this.sqlite.exec(
                THREAD_GOAL_LEDGER_SCHEMA.map((statement) =>
                  statement
                    .replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ')
                    .replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS '),
                ).join(';'),
              ),
            47: () => {
              this.sqlite.exec(
                THREAD_GOAL_CONTINUATION_SCHEMA.map((statement) =>
                  statement
                    .replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ')
                    .replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS '),
                ).join(';'),
              )
              const inputColumns = new Set(
                (
                  this.sqlite.query('PRAGMA table_info(inputs)').all() as Array<{ name: string }>
                ).map(({ name }) => name),
              )
              if (inputColumns.size > 0 && !inputColumns.has('origin'))
                this.sqlite.exec(
                  "ALTER TABLE inputs ADD COLUMN origin TEXT CHECK(origin IS NULL OR origin IN ('user','goal-continuation'))",
                )
            },
            48: () =>
              this.sqlite.exec(
                THREAD_WORKTREE_OPERATION_SCHEMA.map((statement) =>
                  statement.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS '),
                ).join(';'),
              ),
            49: () => {
              const columns = this.sqlite.query('PRAGMA table_info(inputs)').all() as Array<{
                name: string
              }>
              if (columns.length && !columns.some((column) => column.name === 'skills'))
                this.sqlite.exec('ALTER TABLE inputs ADD COLUMN skills TEXT')
            },
            51: () => this.sqlite.exec(BROWSER_DATA_SCHEMA.join(';')),
            53: () =>
              this.sqlite.exec(
                FINAL_SCHEMA.find((statement) =>
                  statement.startsWith('CREATE TABLE thread_project_memberships '),
                )!.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS'),
              ),
            54: () =>
              this.sqlite.exec(
                THREAD_BOOKMARK_SCHEMA.map((statement) =>
                  statement
                    .replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ')
                    .replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS '),
                ).join(';'),
              ),
            55: () => {
              const columns = this.sqlite.query('PRAGMA table_info(threads)').all() as Array<{
                name: string
              }>
              if (!columns.some((column) => column.name === 'workspace_owner_thread_id'))
                this.sqlite.exec('ALTER TABLE threads ADD COLUMN workspace_owner_thread_id TEXT')
            },
            57: () => this.sqlite.exec(SUBAGENT_COLLABORATION_SCHEMA.join(';')),
            56: () =>
              this.sqlite.exec(
                [
                  ...WORKTREE_SETTINGS_SCHEMA,
                  ...LOCAL_ENVIRONMENT_SELECTION_SCHEMA,
                  ...PR_WATCH_SCHEMA,
                  ...AUTOMATION_HOST_AUDIT_SCHEMA,
                ]
                  .map((statement) =>
                    statement.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS '),
                  )
                  .join(';'),
              ),
            52: () =>
              this.sqlite.exec(
                FINAL_SCHEMA.filter((statement) =>
                  /^CREATE TABLE (?:mcp_elicitations|approval_reviews) /u.test(statement),
                )
                  .map((statement) =>
                    statement.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS '),
                  )
                  .join(';'),
              ),
            50: () =>
              this.sqlite.exec(
                BROWSER_SCHEMA.map((statement) =>
                  statement.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS '),
                ).join(';'),
              ),
          }
        : {
            // v2 moved durable preferences to the external configuration file. The file migration
            // runs after both profile/config paths are available in bootstrap.
            1: () => undefined,
            2: () => migrateProfile2To3(this.sqlite),
            3: () => migrateProfile3To4(this.sqlite),
          }
    let version = from
    while (version < target) {
      const migration = migrations[version]
      if (!migration) throw new Error(`${this.kind} 数据库缺少 ${version} → ${version + 1} 迁移`)
      const rebuildsProfileProjects = this.kind === 'profile' && version === 2
      if (rebuildsProfileProjects) this.sqlite.exec('PRAGMA foreign_keys = OFF')
      try {
        this.sqlite.transaction(() => {
          migration()
          this.sqlite.exec(`PRAGMA user_version = ${version + 1}`)
        })()
      } catch (cause) {
        throw new Error(`${this.kind} 数据库 ${version} → ${version + 1} 迁移失败`, { cause })
      } finally {
        if (rebuildsProfileProjects) this.sqlite.exec('PRAGMA foreign_keys = ON')
      }
      version += 1
    }
  }
}

export const initializeSchema = (sqlite: Database, kind: 'history' | 'profile' = 'history') =>
  new SchemaInitializer(sqlite, kind).initialize()
