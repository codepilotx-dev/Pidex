import type { DesktopProviderModelDefinition } from '../../../../shared/Types.js'

export function newCustomProviderId(
  existingIds: readonly string[],
  seed = 'custom-provider',
): string {
  const occupied = new Set(existingIds.map((id) => id.toLowerCase()))
  let id = seed
  for (let suffix = 2; occupied.has(id.toLowerCase()); suffix += 1) id = `${seed}-${suffix}`
  return id
}

export function providerApiFormat(
  models: readonly Pick<DesktopProviderModelDefinition, 'api'>[],
  defaultApi: DesktopProviderModelDefinition['api'],
): DesktopProviderModelDefinition['api'] | 'per-model' {
  const formats = new Set(models.map((model) => model.api))
  return formats.size > 1 ? 'per-model' : (models[0]?.api ?? defaultApi)
}
