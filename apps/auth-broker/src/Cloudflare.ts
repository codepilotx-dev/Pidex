export interface DurableObjectTransaction {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
}

export interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  deleteAll(): Promise<void>
  setAlarm(scheduledTime: number): Promise<void>
  transaction<T>(closure: (transaction: DurableObjectTransaction) => Promise<T>): Promise<T>
}

export interface DurableObjectState {
  readonly storage: DurableObjectStorage
}

export interface DurableObjectStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export interface DurableObjectNamespace {
  idFromName(name: string): unknown
  get(id: unknown): DurableObjectStub
}

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export interface Env {
  GITHUB_OAUTH_CLIENT_ID: string
  GITHUB_OAUTH_CLIENT_SECRET: string
  OAUTH_ATTEMPTS: DurableObjectNamespace
  OAUTH_RATE_LIMITER: RateLimitBinding
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
