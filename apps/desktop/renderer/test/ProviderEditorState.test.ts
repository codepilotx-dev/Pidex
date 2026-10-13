import { describe, expect, test } from 'bun:test'
import {
  newCustomProviderId,
  providerApiFormat,
} from '../src/features/models/provider-management/ProviderEditorState.js'
import { updateModelCenterSearchParams } from '../src/features/models/ModelCenterState.js'

describe('custom provider draft identity and protocol', () => {
  test('automatic IDs avoid existing identities and preset duplicates', () => {
    expect(newCustomProviderId(['CUSTOM-PROVIDER', 'custom-provider-2'])).toBe('custom-provider-3')
    expect(newCustomProviderId(['custom-ollama'], 'custom-ollama')).toBe('custom-ollama-2')
  })

  test('mixed protocols stay per model while an empty list uses the new-model default', () => {
    const models = [{ api: 'openai-completions' }, { api: 'anthropic-messages' }] as const
    expect(providerApiFormat(models, 'openai-responses')).toBe('per-model')
    expect(models.map((model) => model.api)).toEqual(['openai-completions', 'anthropic-messages'])
    expect(providerApiFormat([], 'anthropic-messages')).toBe('anthropic-messages')
  })

  test('selecting a persisted provider removes the temporary creation route', () => {
    const params = new URLSearchParams('newProvider=1&other=keep')
    expect(
      updateModelCenterSearchParams(params, { providerId: 'custom-provider' }).toString(),
    ).toBe('other=keep&provider=custom-provider')
    expect(updateModelCenterSearchParams(params, { providerId: null }).toString()).toBe(
      'other=keep',
    )
    expect(params.get('newProvider')).toBe('1')
  })
})
