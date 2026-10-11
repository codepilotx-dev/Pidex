const LOOPBACK_CALLBACK_PATH = '/auth/github/callback'
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

export function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return toBase64Url(new Uint8Array(digest))
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left)
  const rightBytes = new TextEncoder().encode(right)
  const maxLength = Math.max(leftBytes.length, rightBytes.length)
  let difference = leftBytes.length ^ rightBytes.length

  for (let index = 0; index < maxLength; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }

  return difference === 0
}

export function isValidPkceChallenge(value: unknown): value is string {
  return typeof value === 'string' && value.length === 43 && /^[A-Za-z0-9_-]+$/u.test(value)
}

export function isValidPkceVerifier(value: unknown): value is string {
  return typeof value === 'string' && PKCE_VERIFIER_PATTERN.test(value)
}

export function normalizeLoopbackRedirect(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 256) {
    return null
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }

  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== LOOPBACK_CALLBACK_PATH ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return null
  }

  const port = Number(url.port)
  if (url.port === '' || !Number.isInteger(port) || port < 1 || port > 65_535) {
    return null
  }

  return url.toString()
}
