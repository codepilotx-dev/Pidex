import { Schema } from 'effect'
import {
  SessionGroupSchema,
  SessionGroupMembershipSchema,
  SessionGroupStepSchema,
  SessionGroupContextEntrySchema,
  SessionGroupContextStateSchema,
  SessionGroupContextChangeSchema,
  SessionGroupContextSectionSchema,
} from './SessionGroup'

/** Canonical public names over the existing session_group storage generation. */
export const WorkflowSchema = SessionGroupSchema
export type Workflow = typeof WorkflowSchema.Type

const { groupId: _membershipGroupId, ...membershipFields } = SessionGroupMembershipSchema.fields
export const WorkflowMembershipSchema = Schema.Struct({
  workflowId: Schema.String,
  ...membershipFields,
})
export type WorkflowMembership = typeof WorkflowMembershipSchema.Type

const { groupId: _stepGroupId, ...stepFields } = SessionGroupStepSchema.fields
export const WorkflowStepSchema = Schema.Struct({ workflowId: Schema.String, ...stepFields })
export type WorkflowStep = typeof WorkflowStepSchema.Type

const { groupId: _entryGroupId, ...entryFields } = SessionGroupContextEntrySchema.fields
export const WorkflowContextEntrySchema = Schema.Struct({
  workflowId: Schema.String,
  ...entryFields,
})
export type WorkflowContextEntry = typeof WorkflowContextEntrySchema.Type

const { groupId: _stateGroupId, ...stateFields } = SessionGroupContextStateSchema.fields
export const WorkflowContextStateSchema = Schema.Struct({
  workflowId: Schema.String,
  ...stateFields,
})
export type WorkflowContextState = typeof WorkflowContextStateSchema.Type

export const WorkflowContextChangeSchema = SessionGroupContextChangeSchema
export const WorkflowContextSectionSchema = SessionGroupContextSectionSchema
