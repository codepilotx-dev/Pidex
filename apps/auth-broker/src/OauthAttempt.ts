import type { DurableObjectState, DurableObjectTransaction, Env } from './Cloudflare.ts'
import { constantTimeEqual, isValidPkceVerifier, sha256Base64Url } from './Security.ts'

const RECORD_KEY = 'attempt'

interface AttemptRecord {
  stateHash: string
  codeChallenge: string
  redirectUri: string
  expiresAt: number
  status: 'pending' | 'exchanging'
}

interface CreateAttemptRequest {
  stateHash: string
  codeChallenge: string
  redirectUri: string
  expiresAt: number
}

interface BeginExchangeRequest {
  state: string
  codeVerifier: string
  redirectUri: string
}

function internalJson(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status })
}

async function parseInternalJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

export class OAuthAttempt {
  constructor(
    private readonly state: DurableObjectState,
    _env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method !== 'POST') {
      return internalJson({ error: 'method_not_allowed' }, 405)
    }

    if (url.pathname === '/create') {
      return await this.create(request)
    }
    if (url.pathname === '/begin-exchange') {
      return await this.beginExchange(request)
    }
    if (url.pathname === '/finish') {
      await this.state.storage.deleteAll()
      return internalJson({ ok: true })
    }

    return internalJson({ error: 'not_found' }, 404)
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll()
  }

  private async create(request: Request): Promise<Response> {
    const body = await parseInternalJson<CreateAttemptRequest>(request)
    if (
      body === null ||
      typeof body.stateHash !== 'string' ||
      typeof body.codeChallenge !== 'string' ||
      typeof body.redirectUri !== 'string' ||
      typeof body.expiresAt !== 'number'
    ) {
      return internalJson({ error: 'invalid_request' }, 400)
    }

    const record: AttemptRecord = {
      stateHash: body.stateHash,
      codeChallenge: body.codeChallenge,
      redirectUri: body.redirectUri,
      expiresAt: body.expiresAt,
      status: 'pending',
    }
    await this.state.storage.put(RECORD_KEY, record)
    await this.state.storage.setAlarm(body.expiresAt)
    return internalJson({ ok: true })
  }

  private async beginExchange(request: Request): Promise<Response> {
    const body = await parseInternalJson<BeginExchangeRequest>(request)
    if (
      body === null ||
      typeof body.state !== 'string' ||
      !isValidPkceVerifier(body.codeVerifier) ||
      typeof body.redirectUri !== 'string'
    ) {
      return internalJson({ error: 'invalid_request' }, 400)
    }

    const [providedStateHash, providedChallenge] = await Promise.all([
      sha256Base64Url(body.state),
      sha256Base64Url(body.codeVerifier),
    ])

    const result = await this.state.storage.transaction(
      async (transaction: DurableObjectTransaction) => {
        const record = await transaction.get<AttemptRecord>(RECORD_KEY)
        if (record === undefined) {
          return { error: 'attempt_not_found', status: 404 }
        }
        if (record.expiresAt <= Date.now()) {
          return { error: 'attempt_expired', status: 410 }
        }
        if (record.status !== 'pending') {
          return { error: 'attempt_consumed', status: 409 }
        }
        if (
          !constantTimeEqual(record.stateHash, providedStateHash) ||
          !constantTimeEqual(record.codeChallenge, providedChallenge) ||
          !constantTimeEqual(record.redirectUri, body.redirectUri)
        ) {
          return { error: 'attempt_mismatch', status: 400 }
        }

        await transaction.put(RECORD_KEY, {
          ...record,
          status: 'exchanging',
        } satisfies AttemptRecord)
        return { ok: true as const }
      },
    )

    if (!('ok' in result)) {
      if (result.error === 'attempt_expired') {
        await this.state.storage.deleteAll()
      }
      return internalJson({ error: result.error }, result.status)
    }
    return internalJson({ ok: true })
  }
}
