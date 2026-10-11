import type { ProviderStreams } from '@earendil-works/pi-ai'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import type { CustomProviderApi } from './PiProviderConfig'

/** Stream adapters keyed by wire protocol, shared by custom and builtin providers. */
export const piProviderApiStreams: Readonly<Record<CustomProviderApi, () => ProviderStreams>> = {
  'anthropic-messages': anthropicMessagesApi,
  'openai-completions': openAICompletionsApi,
  'openai-responses': openAIResponsesApi,
}
