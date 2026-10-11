import { session } from 'electron'
import type { DesktopLogger } from '../logging/DesktopLogger.js'
import { probeReady } from '../sidecar/Readiness.js'

const AUTH_COOKIE = 'pidex_session'

export async function configureAuthCookie(
  origin: string,
  token: string,
  logger: DesktopLogger,
): Promise<void> {
  await session.defaultSession.cookies.set({
    url: origin,
    name: AUTH_COOKIE,
    value: token,
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'strict',
  })
  logger.info('desktop.auth-cookie-set', { origin })
}

export async function verifyAuthCookie(origin: string, logger: DesktopLogger): Promise<void> {
  await probeReady(
    origin,
    (input, init) => session.defaultSession.fetch(input, init),
    undefined,
    2_000,
  )
  logger.info('desktop.auth-cookie-verified', { origin })
}
