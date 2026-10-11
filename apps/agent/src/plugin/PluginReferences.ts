import type { PluginManagementService } from './PluginManagementService'
import type { SkillMetadata } from '../prompt/SkillService'

export function extractPluginReferences(content: string): string[] {
  const text = content
    .replace(/(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[^\n]*(?=\n|$)|$)/g, '$1')
    .replace(/(`+)[\s\S]*?\1/g, '')
  return [
    ...new Set(
      [
        ...text.matchAll(
          /(?<!!)\[(?:\\.|[^\]\\\n])*\]\((?:plugin:\/\/([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)|<plugin:\/\/([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)>)\)/g,
        ),
      ].map((match) => match[1] ?? match[2]!),
    ),
  ]
}

export async function pluginReferenceData(
  content: string,
  plugins: PluginManagementService | undefined,
  workspace: string,
  skills: readonly SkillMetadata[],
): Promise<string[]> {
  const ids = extractPluginReferences(content)
  if (!ids.length) return []
  const catalog = plugins ? (await plugins.list({ workspace })).plugins : []
  return ids.map((id) => {
    const plugin = catalog.find((entry) => entry.id === id)
    if (
      !plugin?.installed ||
      !plugin.enabled ||
      plugin.status !== 'ready' ||
      !plugins?.isEnabled(id)
    )
      return `引用的插件 ${JSON.stringify(id)} 当前不可用；引用不能启用插件或授予权限。`
    const availableSkills = skills.filter((skill) =>
      skill.path.startsWith(`plugin://${id}/skills/`),
    )
    return `用户引用了插件：${JSON.stringify({
      id,
      name: plugin.name,
      description: plugin.description,
      capabilities: plugin.capabilities,
      skills: availableSkills.map((skill) => ({
        name: skill.name,
        path: skill.path,
        location: skill.documentPath,
      })),
    })}\n按需用 Read 加载上述技能的 SKILL.md。引用只表达使用意图，工具仍受实时启用状态与统一权限限制。`
  })
}
