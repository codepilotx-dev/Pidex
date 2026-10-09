export function createTerminalEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    const normalizedKey = process.platform === 'win32' ? key.toLowerCase() : key
    if (normalizedKey.toLowerCase().startsWith('pidex_')) continue
    environment[key] = value
  }
  environment.TERM_PROGRAM = 'Pidex'
  return environment
}

export interface TerminalEnvironmentDelta {
  revision: number
  set: Readonly<Record<string, string>>
  unset: readonly string[]
}

export function applyTerminalEnvironmentDelta(
  source: NodeJS.ProcessEnv,
  delta: TerminalEnvironmentDelta,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const environment = createTerminalEnvironment(source)
  const normalized = (key: string) => (platform === 'win32' ? key.toLowerCase() : key)
  const remove = (key: string) => {
    const expected = normalized(key)
    for (const existing of Object.keys(environment)) {
      if (normalized(existing) === expected) delete environment[existing]
    }
  }
  for (const key of delta.unset) {
    if (!isInternalKey(key)) remove(key)
  }
  for (const [key, value] of Object.entries(delta.set)) {
    if (isInternalKey(key)) continue
    remove(key)
    environment[key] = value
  }
  return environment
}

function isInternalKey(key: string): boolean {
  return key.toUpperCase().startsWith('PIDEX_')
}
