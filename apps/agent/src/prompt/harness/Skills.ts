import { dirnameEnvPath } from './PathUtils.ts'
import type { Skill } from '../../orchestration/harness/Types.ts'

/** Format a skill invocation prompt, optionally appending additional user instructions. */
export function formatSkillInvocation(skill: Skill, additionalInstructions?: string): string {
  const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${dirnameEnvPath(skill.filePath)}.\n\n${skill.content}\n</skill>`
  return additionalInstructions ? `${skillBlock}\n\n${additionalInstructions}` : skillBlock
}
