import type {
  ComposerDocument,
  ComposerDocumentToken,
  ComposerSkillInvocation,
} from './ComposerTypes.js'
import { BUILTIN_SKILL_PRESENTATIONS } from '../../plugins/BuiltinSkillPresentation.js'

/**
 * Keep existing inline positions; externally selected skills start at offset zero.
 */
export function createComposerDocumentWithSkill(
  text: string,
  skillInvocation?: ComposerSkillInvocation | readonly ComposerSkillInvocation[],
  existingTokens: readonly ComposerDocumentToken[] = [],
): ComposerDocument {
  const skills = skillInvocation
    ? (Array.isArray(skillInvocation)
        ? skillInvocation
        : [skillInvocation as ComposerSkillInvocation]
      ).map(createComposerSkillToken)
    : []
  return {
    text,
    tokens: [
      ...existingTokens.filter(
        (token) => token.kind !== 'skill' || skills.some((skill) => skill.value === token.value),
      ),
      ...skills.filter(
        (skill) =>
          !existingTokens.some((token) => token.kind === 'skill' && token.value === skill.value),
      ),
    ],
  }
}

export function createComposerSkillToken(skill: ComposerSkillInvocation): ComposerDocumentToken {
  return {
    id: `skill:${skill.name}:${skill.path}`,
    kind: 'skill',
    name: skill.name,
    label: BUILTIN_SKILL_PRESENTATIONS[skill.name]?.label ?? skill.name,
    value: skill.path,
    from: 0,
    to: 0,
  }
}

export function skillInvocationFromComposerToken(
  token: ComposerDocumentToken,
): ComposerSkillInvocation | null {
  const name = token.name ?? token.label
  if (token.kind !== 'skill' || !name || !token.value) return null
  return { name, path: token.value }
}

export function skillInvocationFromComposerDocument(
  document: ComposerDocument,
): ComposerSkillInvocation | null {
  const token = document.tokens.find((candidate) => candidate.kind === 'skill')
  return token ? skillInvocationFromComposerToken(token) : null
}

export function skillInvocationsFromComposerDocument(
  document: ComposerDocument,
): ComposerSkillInvocation[] {
  return document.tokens.flatMap((token) => {
    const skill = skillInvocationFromComposerToken(token)
    return skill ? [skill] : []
  })
}

export function composerDocumentsEqual(left: ComposerDocument, right: ComposerDocument): boolean {
  if (left.text !== right.text || left.tokens.length !== right.tokens.length) {
    return false
  }
  return left.tokens.every((token, index) => {
    const other = right.tokens[index]
    return (
      token.id === other?.id &&
      token.kind === other.kind &&
      token.name === other.name &&
      token.label === other.label &&
      token.value === other.value &&
      token.from === other.from &&
      token.to === other.to
    )
  })
}
