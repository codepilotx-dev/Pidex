import type { RpcResult } from '@pidex/agent-protocol'
import type { DesktopReleaseNotesApi } from '../../services/desktop-client/index.js'

export type ReleaseNotesViewError =
  'not-public' | 'rate-limited' | 'unavailable' | 'invalid-response'

export function loadReleaseNotes(
  client: DesktopReleaseNotesApi,
  refresh = false,
): Promise<RpcResult<'release-notes/list'>> {
  return client.listReleaseNotes(refresh ? { refresh: true } : undefined)
}

export function releaseNotesViewError(error: unknown): ReleaseNotesViewError {
  const errorCode = readErrorCode(error)
  if (errorCode === 'RELEASE_NOTES_NOT_PUBLIC') return 'not-public'
  if (errorCode === 'RELEASE_NOTES_RATE_LIMITED') return 'rate-limited'
  if (errorCode === 'RELEASE_NOTES_INVALID_RESPONSE') return 'invalid-response'
  return 'unavailable'
}

export function releaseNotesErrorMessage(error: ReleaseNotesViewError): {
  title: string
  description: string
} {
  if (error === 'not-public') {
    return {
      title: '更新日志仓库尚未公开',
      description: 'Pidex 仍在调试阶段。仓库公开后，这里会自动显示 GitHub Releases 中的更新记录。',
    }
  }
  if (error === 'rate-limited') {
    return {
      title: 'GitHub 暂时限制了访问',
      description: 'GitHub 请求已达到访问上限，请稍后重试。',
    }
  }
  if (error === 'invalid-response') {
    return {
      title: '更新日志暂时无法解析',
      description: 'GitHub 返回了无法识别的内容，请稍后重试。',
    }
  }
  return {
    title: '暂时无法获取更新日志',
    description: '请检查网络连接，稍后重试。',
  }
}

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const direct = (error as { errorCode?: unknown }).errorCode
  if (typeof direct === 'string') return direct
  const data = (error as { data?: unknown }).data
  if (!data || typeof data !== 'object') return null
  const nested = (data as { code?: unknown }).code
  return typeof nested === 'string' ? nested : null
}
