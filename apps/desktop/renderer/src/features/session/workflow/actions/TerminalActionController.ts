import type { LocalEnvironmentActionMetadata } from '@pidex/agent-protocol'
import type { EnvironmentDomainClient } from '../../../../services/desktop-client/EnvironmentDomainClient.js'
import type { DesktopTerminalClient } from '../../../../services/desktop-client/TerminalClient.js'
import {
  OPEN_TERMINAL_EVENT,
  type OpenTerminalEventDetail,
} from '../../../terminal/OpenTerminalEvent.js'

export { OPEN_TERMINAL_EVENT }

export async function listTerminalActions(
  client: Pick<EnvironmentDomainClient, 'listActions'>,
  threadId: string,
): Promise<readonly LocalEnvironmentActionMetadata[]> {
  return (await client.listActions(threadId)).actions
}

export async function runTerminalAction(input: {
  terminal: Pick<DesktopTerminalClient, 'runTerminalAction'>
  threadId: string
  action: LocalEnvironmentActionMetadata
  profileId: string | null
  dispatch?: (event: Event) => boolean
}): Promise<void> {
  if (input.action.availability !== 'available') {
    throw new Error('该 Action 不支持当前平台。')
  }
  const snapshot = await input.terminal.runTerminalAction({
    threadId: input.threadId,
    actionName: input.action.name,
    profileId: input.profileId,
    cols: 120,
    rows: 30,
  })
  const event = new CustomEvent<OpenTerminalEventDetail>(OPEN_TERMINAL_EVENT, {
    detail: { threadId: input.threadId, snapshot },
  })
  ;(input.dispatch ?? window.dispatchEvent.bind(window))(event)
}
