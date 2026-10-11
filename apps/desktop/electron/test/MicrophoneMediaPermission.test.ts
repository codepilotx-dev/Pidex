import { describe, expect, test } from 'bun:test'
import type { Session, WebContents } from 'electron'
import {
  isMicrophoneMediaPermissionAllowed,
  registerMicrophoneMediaPermissions,
  type MicrophoneMediaPermissionInput,
} from '../src/security/MicrophoneMediaPermission'

const allowedOrigin = 'http://127.0.0.1:43120'
const allowed: MicrophoneMediaPermissionInput = {
  permission: 'media',
  requestedMediaTypes: ['audio'],
  requestingUrl: `${allowedOrigin}/session/thread-1`,
  securityOrigin: allowedOrigin,
  isMainFrame: true,
  isMainWindowSender: true,
  allowedApplicationOrigin: allowedOrigin,
}

describe('microphone media permission policy', () => {
  test('only permits main-window audio access from the current application origin', () => {
    expect(isMicrophoneMediaPermissionAllowed(allowed)).toBe(true)
    expect(
      isMicrophoneMediaPermissionAllowed({
        ...allowed,
        securityOrigin: undefined,
      }),
    ).toBe(true)
  })

  test('permits local fonts only for the trusted main application frame', () => {
    const localFonts = {
      ...allowed,
      permission: 'local-fonts',
      requestedMediaTypes: undefined,
    }
    expect(isMicrophoneMediaPermissionAllowed(localFonts)).toBe(true)
    expect(
      isMicrophoneMediaPermissionAllowed({
        ...localFonts,
        isMainWindowSender: false,
      }),
    ).toBe(false)
    expect(
      isMicrophoneMediaPermissionAllowed({
        ...localFonts,
        requestingUrl: 'http://127.0.0.1:43121/',
      }),
    ).toBe(false)
  })

  test('rejects clipboard-sanitized-write for every frame and origin', () => {
    const sanitizedWrite = {
      ...allowed,
      permission: 'clipboard-sanitized-write',
      requestedMediaTypes: undefined,
    }
    expect(isMicrophoneMediaPermissionAllowed(sanitizedWrite)).toBe(false)
    expect(
      isMicrophoneMediaPermissionAllowed({
        ...sanitizedWrite,
        isMainWindowSender: false,
      }),
    ).toBe(false)
    expect(
      isMicrophoneMediaPermissionAllowed({
        ...sanitizedWrite,
        isMainFrame: false,
      }),
    ).toBe(false)
    expect(
      isMicrophoneMediaPermissionAllowed({
        ...sanitizedWrite,
        requestingUrl: 'http://127.0.0.1:43121/',
      }),
    ).toBe(false)
    expect(
      isMicrophoneMediaPermissionAllowed({
        ...sanitizedWrite,
        securityOrigin: 'http://127.0.0.1:43121',
      }),
    ).toBe(false)
    expect(
      isMicrophoneMediaPermissionAllowed({
        ...sanitizedWrite,
        allowedApplicationOrigin: undefined,
      }),
    ).toBe(false)
    expect(
      isMicrophoneMediaPermissionAllowed({
        ...sanitizedWrite,
        requestingUrl: 'data:text/html,starting',
      }),
    ).toBe(false)
  })

  test.each([
    ['video', { requestedMediaTypes: ['video'] }],
    ['mixed media', { requestedMediaTypes: ['audio', 'video'] }],
    ['clipboard read', { permission: 'clipboard-read', requestedMediaTypes: undefined }],
    ['display capture', { permission: 'display-capture' }],
    ['unknown media', { requestedMediaTypes: ['unknown'] }],
    ['pet or other window', { isMainWindowSender: false }],
    ['subframe', { isMainFrame: false }],
    ['cross-origin URL', { requestingUrl: 'http://127.0.0.1:43121/' }],
    ['cross-origin security origin', { securityOrigin: 'http://127.0.0.1:43121' }],
    ['invalid security origin', { securityOrigin: 'data:text/html,starting' }],
    ['startup data page', { requestingUrl: 'data:text/html,starting' }],
    ['missing application origin', { allowedApplicationOrigin: undefined }],
  ] satisfies Array<[string, Partial<MicrophoneMediaPermissionInput>]>)(
    'rejects %s',
    (_label, change) => {
      expect(isMicrophoneMediaPermissionAllowed({ ...allowed, ...change })).toBe(false)
    },
  )

  test('installs both request and check handlers', () => {
    let requestHandler: Parameters<Session['setPermissionRequestHandler']>[0]
    let checkHandler: Parameters<Session['setPermissionCheckHandler']>[0]
    const mockSession = {
      setPermissionRequestHandler: (handler: typeof requestHandler) => {
        requestHandler = handler
      },
      setPermissionCheckHandler: (handler: typeof checkHandler) => {
        checkHandler = handler
      },
    } as Pick<Session, 'setPermissionCheckHandler' | 'setPermissionRequestHandler'>

    const mainWindow = {} as WebContents
    registerMicrophoneMediaPermissions({
      session: mockSession,
      getAllowedApplicationOrigin: () => allowedOrigin,
      isMainWindowSender: (sender) => sender === mainWindow,
    })

    expect(requestHandler!).toBeFunction()
    expect(checkHandler!).toBeFunction()

    let requestGranted: boolean | undefined
    requestHandler!(
      mainWindow,
      'media',
      (granted) => {
        requestGranted = granted
      },
      {
        isMainFrame: true,
        requestingUrl: `${allowedOrigin}/session/thread-1`,
        mediaTypes: ['audio'],
        securityOrigin: allowedOrigin,
      },
    )
    expect(requestGranted).toBe(true)
    requestHandler!(
      mainWindow,
      'local-fonts',
      (granted) => {
        requestGranted = granted
      },
      {
        isMainFrame: true,
        requestingUrl: `${allowedOrigin}/settings/appearance`,
        securityOrigin: allowedOrigin,
      },
    )
    expect(requestGranted).toBe(true)
    requestHandler!(
      mainWindow,
      'clipboard-sanitized-write',
      (granted) => {
        requestGranted = granted
      },
      {
        isMainFrame: true,
        requestingUrl: `${allowedOrigin}/session/thread-1`,
        securityOrigin: allowedOrigin,
      },
    )
    expect(requestGranted).toBe(false)
    requestHandler!(
      mainWindow,
      'clipboard-read',
      (granted) => {
        requestGranted = granted
      },
      {
        isMainFrame: true,
        requestingUrl: `${allowedOrigin}/session/thread-1`,
        securityOrigin: allowedOrigin,
      },
    )
    expect(requestGranted).toBe(false)
    expect(
      checkHandler!(mainWindow, 'clipboard-sanitized-write', allowedOrigin, {
        isMainFrame: true,
        requestingUrl: `${allowedOrigin}/session/thread-1`,
        securityOrigin: allowedOrigin,
      }),
    ).toBe(false)
    expect(
      checkHandler!(mainWindow, 'clipboard-read', allowedOrigin, {
        isMainFrame: true,
        requestingUrl: `${allowedOrigin}/session/thread-1`,
        securityOrigin: allowedOrigin,
      }),
    ).toBe(false)
    expect(
      checkHandler!(mainWindow, 'local-fonts', allowedOrigin, {
        isMainFrame: true,
        requestingUrl: `${allowedOrigin}/settings/appearance`,
        securityOrigin: allowedOrigin,
      }),
    ).toBe(true)
    expect(
      checkHandler!(mainWindow, 'media', allowedOrigin, {
        isMainFrame: true,
        requestingUrl: `${allowedOrigin}/session/thread-1`,
        mediaType: 'audio',
        securityOrigin: allowedOrigin,
      }),
    ).toBe(true)
    expect(
      checkHandler!(null, 'media', allowedOrigin, {
        isMainFrame: true,
        requestingUrl: `${allowedOrigin}/session/thread-1`,
        mediaType: 'audio',
        securityOrigin: allowedOrigin,
      }),
    ).toBe(false)
  })
})
