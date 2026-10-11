import type { Session, WebContents } from 'electron'

export interface MicrophoneMediaPermissionInput {
  permission: string
  requestedMediaTypes: readonly string[] | undefined
  requestingUrl: string | undefined
  securityOrigin: string | undefined
  isMainFrame: boolean
  isMainWindowSender: boolean
  allowedApplicationOrigin: string | undefined
}

interface MicrophoneMediaPermissionDependencies {
  session: Pick<Session, 'setPermissionCheckHandler' | 'setPermissionRequestHandler'>
  getAllowedApplicationOrigin: () => string | undefined
  isMainWindowSender: (sender: WebContents) => boolean
}

export function isMicrophoneMediaPermissionAllowed(input: MicrophoneMediaPermissionInput): boolean {
  if (input.permission === 'local-fonts') {
    return isTrustedMainWindowPermissionRequest(input)
  }
  if (
    input.permission !== 'media' ||
    !input.isMainFrame ||
    !input.isMainWindowSender ||
    input.requestedMediaTypes?.length !== 1 ||
    input.requestedMediaTypes[0] !== 'audio'
  ) {
    return false
  }

  return isTrustedMainWindowPermissionRequest(input)
}

function isTrustedMainWindowPermissionRequest(input: MicrophoneMediaPermissionInput): boolean {
  if (!input.isMainFrame || !input.isMainWindowSender) return false
  const allowedOrigin = parseOrigin(input.allowedApplicationOrigin)
  const requestingOrigin = parseOrigin(input.requestingUrl)
  if (!allowedOrigin || requestingOrigin !== allowedOrigin) return false
  return input.securityOrigin === undefined || parseOrigin(input.securityOrigin) === allowedOrigin
}

export function registerMicrophoneMediaPermissions(
  dependencies: MicrophoneMediaPermissionDependencies,
): void {
  const { session, getAllowedApplicationOrigin, isMainWindowSender } = dependencies

  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(
      isMicrophoneMediaPermissionAllowed({
        permission,
        requestedMediaTypes: 'mediaTypes' in details ? details.mediaTypes : undefined,
        requestingUrl: details.requestingUrl,
        securityOrigin: 'securityOrigin' in details ? details.securityOrigin : undefined,
        isMainFrame: details.isMainFrame,
        isMainWindowSender: isMainWindowSender(webContents),
        allowedApplicationOrigin: getAllowedApplicationOrigin(),
      }),
    )
  })

  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) =>
    isMicrophoneMediaPermissionAllowed({
      permission,
      requestedMediaTypes: details.mediaType ? [details.mediaType] : undefined,
      requestingUrl: details.requestingUrl ?? requestingOrigin,
      securityOrigin: details.securityOrigin ?? requestingOrigin,
      isMainFrame: details.isMainFrame,
      isMainWindowSender: webContents !== null && isMainWindowSender(webContents),
      allowedApplicationOrigin: getAllowedApplicationOrigin(),
    }),
  )
}

function parseOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return undefined
    }
    return url.origin
  } catch {
    return undefined
  }
}
