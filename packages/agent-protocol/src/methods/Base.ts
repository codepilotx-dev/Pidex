import { ConfigRpcMethods } from './Config'
import { CoreRpcMethods } from './Core'
import { ExtendedRpcMethods } from './Extended'
import { GitRpcMethods } from './Git'
import { GithubRpcMethods } from './Github'
import { McpRpcMethods } from './Mcp'
import { MiniMaxCliRpcMethods } from './MinimaxCli'
import { PetRpcMethods } from './Pet'
import { PluginRpcMethods } from './Plugins'
import { ReleaseNotesRpcMethods } from './ReleaseNotes'
import { ReviewRpcMethods } from './Review'
import { SkillRpcMethods } from './Skills'
import { SuggestionRpcMethods } from './Suggestions'
import { ToolingRpcMethods } from './Tooling'
import { UsageRpcMethods } from './Usage'
import { SpeechRpcMethods } from './Speech'

/**
 * Public methods required by the always-loaded desktop session client. Optional
 * environment/worktree/Handoff schemas are resolved lazily by runtime/client.
 */
export const BaseRpcMethods = {
  ...CoreRpcMethods,
  ...ConfigRpcMethods,
  ...ExtendedRpcMethods,
  ...GitRpcMethods,
  ...GithubRpcMethods,
  ...McpRpcMethods,
  ...MiniMaxCliRpcMethods,
  ...PetRpcMethods,
  ...PluginRpcMethods,
  ...ReleaseNotesRpcMethods,
  ...ReviewRpcMethods,
  ...SkillRpcMethods,
  ...SuggestionRpcMethods,
  ...ToolingRpcMethods,
  ...UsageRpcMethods,
  ...SpeechRpcMethods,
} as const
