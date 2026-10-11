import type { createAgentRpcClient } from '../AgentRpcClient.js'
import type { DesktopSpeechApi } from './Types.js'

export function createAgentSpeechApi(
  rpc: ReturnType<typeof createAgentRpcClient>,
  hasCapability: () => boolean,
): Pick<
  DesktopSpeechApi,
  'getSpeechStatus' | 'installSpeech' | 'transcribeSpeech' | 'cancelSpeech'
> {
  const requireSpeech = (): void => {
    if (!hasCapability()) {
      throw new Error('当前 Agent 不支持本地语音转写。')
    }
  }
  return {
    getSpeechStatus: async () => {
      requireSpeech()
      return (await rpc.call('speech/status', {})).status
    },
    installSpeech: async (force = false) => {
      requireSpeech()
      return (await rpc.call('speech/install', force ? { force } : {})).status
    },
    transcribeSpeech: async (input) => {
      requireSpeech()
      return rpc.call('speech/transcribe', input)
    },
    cancelSpeech: async (operationId) => {
      requireSpeech()
      return (await rpc.call('speech/cancel', { operationId })).cancelled
    },
  }
}
