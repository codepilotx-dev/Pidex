import { useOutletContext } from 'react-router-dom'
import type { DesktopInstalledSkill } from '../../../../shared/Types.js'

export type DesktopLayoutOutletContextValue = {
  workspacePath: string | null
  useSkill: (skill: DesktopInstalledSkill) => void
  openSkillPreview: (skill: DesktopInstalledSkill) => void
}

export function useDesktopLayoutOutletContext(): DesktopLayoutOutletContextValue {
  return useOutletContext<DesktopLayoutOutletContextValue>()
}
