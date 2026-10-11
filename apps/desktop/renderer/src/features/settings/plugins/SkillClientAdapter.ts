import type {
  DesktopCatalogResult,
  DesktopInstalledSkill,
  DesktopInstalledSkillDetails,
} from '../../../../shared/Types.js'
import { desktopClient } from '../../../services/desktop-client/index.js'

export async function listRuntimeSkills(
  workspacePath: string | null,
  forceReload = false,
): Promise<DesktopCatalogResult<DesktopInstalledSkill[]>> {
  return desktopClient.listRuntimeSkills(workspacePath ?? undefined, {
    forceReload,
  })
}

export async function readRuntimeSkill(
  workspacePath: string | null,
  path: string,
): Promise<DesktopInstalledSkillDetails> {
  return desktopClient.readRuntimeSkill(path, workspacePath ?? undefined)
}

export async function setRuntimeSkillEnabled(
  path: string,
  enabled: boolean,
): Promise<DesktopInstalledSkill> {
  return desktopClient.setRuntimeSkillEnabled(path, enabled)
}
