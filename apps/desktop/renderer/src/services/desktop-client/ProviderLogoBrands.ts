/**
 * Brand registry for the models.dev provider icons used across the renderer.
 *
 * models.dev serves one icon per brand, so every Pi builtin entry that fronts
 * the same product family has to resolve to that brand's icon id. The icon id
 * cannot be derived from the Provider ID or the display name and cannot be
 * confirmed by requesting the URL: an unknown id still answers HTTP 200 with a
 * generic placeholder sprite. Brand membership is therefore declared here once
 * and every surface keeps consuming the `logoURL` the catalogue already emits.
 *
 * Each group lists its full Provider ID set explicitly. Provider IDs that appear
 * in no group resolve to their own id, so user created providers and builtin
 * entries that models.dev already keys by Provider ID keep working. `google-vertex`
 * and `opencode-go` stay out of their parent brand group on purpose: models.dev
 * ships a distinct icon for each of them.
 */
export const PROVIDER_LOGO_BRANDS: Readonly<Record<string, readonly string[]>> = {
  openai: ['openai', 'openai-codex'],
  zai: ['zai', 'zai-coding-cn'],
  minimax: ['minimax', 'minimax-cn'],
  moonshotai: ['moonshotai', 'moonshotai-cn', 'kimi-coding'],
  xiaomi: ['xiaomi', 'xiaomi-token-plan-ams', 'xiaomi-token-plan-cn', 'xiaomi-token-plan-sgp'],
  'cloudflare-workers-ai': ['cloudflare-ai-gateway', 'cloudflare-workers-ai'],
  alibaba: ['qwen-token-plan', 'qwen-token-plan-cn', 'qwen-token-plan-individual'],
  azure: ['azure-openai-responses'],
}

const PROVIDER_LOGO_BRAND_BY_PROVIDER_ID = new Map<string, string>(
  Object.entries(PROVIDER_LOGO_BRANDS).flatMap(([brandID, providerIDs]) =>
    providerIDs.map((providerID) => [providerID, brandID] as const),
  ),
)

/** models.dev icon id that carries the brand mark for `providerID`. */
export function providerLogoBrandID(providerID: string): string {
  return PROVIDER_LOGO_BRAND_BY_PROVIDER_ID.get(providerID) ?? providerID
}

const MODELS_DEV_LOGO_BASE_URL = 'https://models.dev/logos/'

export function modelsDevLogoURL(providerID: string): string {
  return `${MODELS_DEV_LOGO_BASE_URL}${encodeURIComponent(providerLogoBrandID(providerID))}.svg`
}
