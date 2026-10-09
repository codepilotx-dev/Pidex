export function mergeProcessEnvironment(
  base: NodeJS.ProcessEnv,
  additions: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const merged = { ...base }
  for (const [key, value] of Object.entries(additions)) {
    const normalized = key.toLowerCase()
    for (const existing of Object.keys(merged)) {
      if (existing.toLowerCase() === normalized) delete merged[existing]
    }
    merged[key] = value
  }
  return merged
}

export function createIsolatedProcessEnvironment(
  base: NodeJS.ProcessEnv,
  additions: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(
    Object.entries(base).filter(
      ([key, value]) => value !== undefined && !isReleaseRunnerInternalKey(key),
    ),
  )
  return mergeProcessEnvironment(inherited, additions)
}

function isReleaseRunnerInternalKey(key: string): boolean {
  const normalized = key.toLowerCase()
  return (
    normalized.startsWith('pidex_') ||
    normalized.startsWith('github_') ||
    normalized.startsWith('runner_') ||
    normalized.startsWith('actions_') ||
    normalized === 'ci' ||
    normalized === 'csc_link' ||
    normalized === 'csc_key_password' ||
    normalized === 'win_csc_link' ||
    normalized === 'win_csc_key_password'
  )
}
