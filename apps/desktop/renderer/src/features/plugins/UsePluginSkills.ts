import { useEffect, useState } from 'react'
import type { DesktopInstalledSkill } from '../../../shared/Types.js'
import { desktopClient } from '../../services/desktop-client/index.js'

export function usePluginSkills(pluginId: string, enabled: boolean, workspacePath?: string | null) {
  const [skills, setSkills] = useState<DesktopInstalledSkill[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!enabled) return
    const load = async () => {
      try {
        const result = await desktopClient.listRuntimeSkills(workspacePath ?? undefined)
        if (cancelled) return
        setSkills(
          (result.data ?? []).filter((skill) =>
            skill.path.startsWith(`plugin://${pluginId}/skills/`),
          ),
        )
        setError(result.state === 'ready' ? null : result.error)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '技能状态读取失败。')
      }
    }
    void load()
    const unsubscribe = desktopClient.onRuntimeSkillsUpdated(() => void load())
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [pluginId, enabled, workspacePath])

  async function setEnabled(path: string, value: boolean) {
    setPending(true)
    setError(null)
    try {
      const updated = await desktopClient.setRuntimeSkillEnabled(path, value)
      setSkills((current) => current.map((skill) => (skill.path === path ? updated : skill)))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '技能状态更新失败。')
    } finally {
      setPending(false)
    }
  }

  return { skills: enabled ? skills : [], pending, error: enabled ? error : null, setEnabled }
}
