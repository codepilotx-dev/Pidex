import type {
  DesktopApi,
  DesktopGithubAuthStatus,
  DesktopGithubProfileOverview,
} from '../../../shared/Types.js'

const CACHE_TTL_MS = 5 * 60 * 1000

type GithubAccountSnapshot = {
  auth: DesktopGithubAuthStatus | null
  overview: DesktopGithubProfileOverview | null
}

type GithubClient = Pick<
  DesktopApi,
  | 'getGithubAuthStatus'
  | 'getGithubProfileOverview'
  | 'startGithubLogin'
  | 'pollGithubLogin'
  | 'logoutGithub'
  | 'setGithubUserStatus'
  | 'clearGithubUserStatus'
>

export function createGithubAccountCache(client: GithubClient, now = Date.now) {
  let snapshot: GithubAccountSnapshot = { auth: null, overview: null }
  const listeners = new Set<() => void>()
  const publish = (change: Partial<GithubAccountSnapshot>): void => {
    snapshot = { ...snapshot, ...change }
    for (const listener of listeners) listener()
  }

  function cachedRead<T>(
    load: () => Promise<T>,
    successful: (value: T) => boolean,
    commit: (value: T) => void,
  ) {
    let value: T | null = null
    let updatedAt = 0
    let pending: Promise<T> | null = null
    let generation = 0
    return {
      seed(result: T): void {
        value = result
        updatedAt = now()
        commit(result)
      },
      clear(): void {
        generation += 1
        value = null
        pending = null
      },
      read(options?: { force?: boolean }): Promise<T> {
        if (!options?.force && value !== null && now() - updatedAt < CACHE_TTL_MS) {
          return Promise.resolve(value)
        }
        if (pending) return pending
        const requestGeneration = generation
        const request = load()
          .then((result) => {
            if (generation === requestGeneration && successful(result)) {
              value = result
              updatedAt = now()
              commit(result)
            }
            return result
          })
          .finally(() => {
            if (pending === request) pending = null
          })
        pending = request
        return request
      },
    }
  }

  const overview = cachedRead(
    () => client.getGithubProfileOverview(),
    (result) => result.ok,
    (result) => {
      if (result.ok) publish({ overview: result.overview })
    },
  )
  const clearOverview = (): void => {
    overview.clear()
    publish({ overview: null })
  }
  const auth = cachedRead(
    () => client.getGithubAuthStatus(),
    (result) => !result.error,
    (result) => {
      if (
        !result.authenticated ||
        (result.user && snapshot.overview && result.user.id !== snapshot.overview.user.id)
      )
        clearOverview()
      publish({ auth: result })
    },
  )
  const clearAccount = (): void => {
    auth.clear()
    overview.clear()
    publish({ auth: null, overview: null })
  }
  const acceptLogin = (status: Awaited<ReturnType<GithubClient['pollGithubLogin']>>): void => {
    if (status.state === 'completed' && status.auth) {
      clearAccount()
      auth.seed(status.auth)
    }
  }

  return {
    getGithubAccountSnapshot: (): GithubAccountSnapshot => snapshot,
    onGithubAccountChange(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getGithubAuthStatus: auth.read,
    getGithubProfileOverview: overview.read,
    async startGithubLogin(input: Parameters<GithubClient['startGithubLogin']>[0]) {
      clearAccount()
      const status = await client.startGithubLogin(input)
      acceptLogin(status)
      return status
    },
    async pollGithubLogin() {
      const status = await client.pollGithubLogin()
      acceptLogin(status)
      return status
    },
    async logoutGithub() {
      clearAccount()
      const status = await client.logoutGithub()
      clearAccount()
      if (!status.error) auth.seed(status)
      return status
    },
    async setGithubUserStatus(input: Parameters<GithubClient['setGithubUserStatus']>[0]) {
      const result = await client.setGithubUserStatus(input)
      if (result.ok) clearOverview()
      return result
    },
    async clearGithubUserStatus() {
      const result = await client.clearGithubUserStatus()
      if (result.ok) clearOverview()
      return result
    },
  }
}
