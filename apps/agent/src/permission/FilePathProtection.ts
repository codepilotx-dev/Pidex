import { realpath } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { AgentError } from '../Domain'

/** Resolve existing ancestors as well, so new files cannot hide behind a directory link. */
export async function resolveProtectionPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(path) === path) {
      throw new AgentError('WORKSPACE_PATH_UNREADABLE', '无法确认文件的实际路径', 400)
    }
    return resolve(await resolveProtectionPath(dirname(path)), basename(path))
  }
}

export function filePathProtection(canonicalPath: string, displayPath: string) {
  const path = canonicalPath.replaceAll('\\', '/').toLowerCase()
  const name = path.split('/').at(-1) ?? ''
  const sensitiveEnvironment =
    /^\.env(?:\..+)?$/.test(name) && !/^\.env\.(?:example|template)$/.test(name)
  const protectedGit =
    /(?:^|\/)\.git\/config$/.test(path) || /(?:^|\/)\.git\/hooks(?:\/|$)/.test(path)
  const configScope =
    displayPath === '@pidex/config.json'
      ? ('user' as const)
      : /(?:^|\/)\.pidex\/config\.json$/.test(path)
        ? ('project' as const)
        : null
  return {
    sensitiveEnvironment,
    protectedGit,
    configScope,
    requiresApproval: sensitiveEnvironment || protectedGit || configScope !== null,
  }
}
