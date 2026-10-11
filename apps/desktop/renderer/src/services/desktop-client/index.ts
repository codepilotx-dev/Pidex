import { createAgentSessionDesktopClient } from './AgentSessionClient.js'
import { createLazyBrowserMockClient } from './LazyBrowserMockClient.js'
import { defaultDesktopClientEnvironment } from './Environment.js'
import { createGithubAccountCache } from './GithubAccountCache.js'
import type {
  DesktopAttachmentApi,
  DesktopLocalContextApi,
  DesktopClientEnvironment,
} from './Types.js'

export {
  CONFIG_UPDATED_EVENT,
  WORKSPACE_FILE_CHANGED_EVENT,
  WORKSPACE_GIT_CHANGED_EVENT,
} from './AgentSessionClient.js'
export { startGithubLoginFlow } from './GithubLogin.js'
export { desktopClipboard } from './ClipboardClient.js'
export type { DesktopClipboard } from './ClipboardClient.js'
export type { DesktopTerminalClient } from './TerminalClient.js'
export type { DesktopBrowserClient } from './DesktopBrowserClient.js'

let terminalClientPromise: Promise<import('./TerminalClient.js').DesktopTerminalClient> | null =
  null

export function loadDesktopTerminalClient(): Promise<
  import('./TerminalClient.js').DesktopTerminalClient
> {
  terminalClientPromise ??= import('./TerminalClient.js')
    .then((module) => module.terminalClient)
    .catch((error) => {
      terminalClientPromise = null
      throw error
    })
  return terminalClientPromise
}
export type { GithubLoginClient } from './GithubLogin.js'

export type {
  DesktopClient,
  DesktopAgentEventEnvelopeApi,
  DesktopAgentReviewApi,
  DesktopAgentThreadTitleApi,
  DesktopClientEnvironment,
  DesktopReleaseNotesApi,
  DesktopRuntimeCapabilityApi,
  DesktopAutomationApi,
  DesktopCalendarApi,
  DesktopPluginApi,
  DesktopMiniMaxCliApi,
  DesktopSessionGroupApi,
  DesktopSessionGroup,
  DesktopSessionGroupDetail,
  DesktopSessionGroupStep,
  DesktopLocalContextApi,
  DesktopSpeechApi,
  DesktopSpeechStatus,
  DesktopUsageApi,
  DesktopReviewAgentComment,
  DesktopReviewAgentFileDiff,
  DesktopReviewAgentFileSummary,
  DesktopReviewAgentSummary,
  DesktopReviewAgentSummaryResult,
} from './Types.js'

export function createDesktopClient(
  environment: DesktopClientEnvironment = defaultDesktopClientEnvironment(),
) {
  const fallbackClient = createLazyBrowserMockClient(environment.localStorage)
  const client = createAgentSessionDesktopClient(
    environment,
    fallbackClient,
    environment.window?.DesktopBridge === undefined,
  )
  return { ...client, ...createGithubAccountCache(client) }
}

export const desktopClient = createDesktopClient()
