import { ListChecks } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import type { DesktopInstalledSkill } from '../../../shared/Types.js'

export type BuiltinSkillPresentation = {
  label: string
  icon: string
}

/**
 * Presentation metadata belongs to the renderer instead of SKILL.md so an
 * application-provided skill can remain a portable, text-only resource.
 */
export const BUILTIN_SKILL_PRESENTATIONS: Readonly<Record<string, BuiltinSkillPresentation>> = {}

export function isBuiltinSkill(
  skill: Pick<DesktopInstalledSkill, 'path' | 'source' | 'scope'>,
): boolean {
  return (
    skill.path.startsWith('builtin://') || (skill.source === 'system' && skill.scope === 'system')
  )
}

export function getBuiltinSkillPresentation(
  skill: Pick<DesktopInstalledSkill, 'name' | 'path' | 'source' | 'scope'>,
): BuiltinSkillPresentation | null {
  if (!isBuiltinSkill(skill)) return null
  return BUILTIN_SKILL_PRESENTATIONS[skill.name] ?? null
}

type BuiltinSkillIconProps = {
  skill: Pick<DesktopInstalledSkill, 'name' | 'path' | 'source' | 'scope'>
  size?: number
  className?: string
}

/** A compact image icon with a deterministic Lucide fallback for failed loads. */
export function BuiltinSkillIcon({
  skill,
  size = 14,
  className,
}: BuiltinSkillIconProps): React.ReactNode {
  const [failed, setFailed] = useState(false)
  const presentation = getBuiltinSkillPresentation(skill)

  if (!presentation || failed) {
    return (
      <ListChecks
        aria-hidden="true"
        className={className}
        size={size}
        data-icon-kind="artwork"
        strokeWidth={2}
      />
    )
  }

  return (
    <img
      alt=""
      aria-hidden="true"
      className={['tw:shrink-0 tw:object-contain tw:object-center', className ?? '']
        .filter(Boolean)
        .join(' ')}
      height={size}
      onError={() => setFailed(true)}
      src={presentation.icon}
      width={size}
    />
  )
}

export function skillScopeLabel(scope: DesktopInstalledSkill['scope']): string {
  switch (scope) {
    case 'repo':
      return '团队'
    case 'user':
      return '个人'
    case 'system':
      return '内置'
    case 'admin':
      return '管理员安装'
  }
}
