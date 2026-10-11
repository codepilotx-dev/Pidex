import type { DesktopSkillCatalogItem } from '../../../shared/Types.js'

export type SkillDisplayGroups = {
  installed: DesktopSkillCatalogItem[]
  recommended: DesktopSkillCatalogItem[]
}

export function groupSkillsForDisplay(
  skills: readonly DesktopSkillCatalogItem[],
): SkillDisplayGroups {
  const installed: DesktopSkillCatalogItem[] = []
  const recommended: DesktopSkillCatalogItem[] = []

  for (const skill of skills) {
    if (skill.installed) installed.push(skill)
    else recommended.push(skill)
  }

  return { installed, recommended }
}
