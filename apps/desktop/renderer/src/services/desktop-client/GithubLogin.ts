import type { DesktopGithubAuthMode, DesktopGithubLoginStatus } from '../../../shared/Types.js'

export type GithubLoginClient = {
  startGithubLogin(input: { mode: DesktopGithubAuthMode }): Promise<DesktopGithubLoginStatus>
  openExternalURL(url: string): Promise<void>
}

export async function startGithubLoginFlow(
  client: GithubLoginClient,
  mode: DesktopGithubAuthMode,
): Promise<DesktopGithubLoginStatus> {
  let status: DesktopGithubLoginStatus
  try {
    status = await client.startGithubLogin({ mode })
  } catch (error) {
    return failedGithubLogin(mode, error)
  }
  if (mode !== 'browser' || status.state !== 'awaiting_auth') {
    return status
  }
  if (!status.authorizationUrl) {
    return failedGithubLogin(mode, 'GitHub 登录服务未返回浏览器授权地址，请稍后重试。', status)
  }

  try {
    await client.openExternalURL(status.authorizationUrl)
    return status
  } catch (error) {
    return failedGithubLogin(mode, error, status)
  }
}

function failedGithubLogin(
  mode: DesktopGithubAuthMode,
  error: unknown,
  status?: DesktopGithubLoginStatus,
): DesktopGithubLoginStatus {
  return {
    loginId: status?.loginId ?? null,
    mode,
    state: 'failed',
    authorizationUrl: status?.authorizationUrl ?? null,
    userCode: status?.userCode ?? null,
    verificationUri: status?.verificationUri ?? null,
    expiresAt: status?.expiresAt ?? null,
    error: error instanceof Error ? error.message : String(error),
    auth: status?.auth ?? null,
    elapsedMs: status?.elapsedMs ?? 0,
  }
}
