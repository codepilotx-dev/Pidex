import { desktopClient } from '../../services/desktop-client/index.js'

export async function chooseSessionGroupForThread(threadId: string): Promise<void> {
  const groups = await desktopClient.listSessionGroups()
  const choices = groups.map((group, index) => `${index + 1}. ${group.name}`).join('\n')
  const answer = globalThis.prompt(`输入工作流序号；输入 0 移出工作流：\n${choices}`)?.trim()
  if (answer === undefined) return
  const index = Number(answer)
  const groupId = index === 0 ? null : groups[index - 1]?.id
  if (index !== 0 && !groupId) return
  await desktopClient.setSessionGroupMembership({ threadId, groupId })
}
