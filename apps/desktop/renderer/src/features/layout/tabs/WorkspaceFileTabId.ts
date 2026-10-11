export function createWorkspaceFileTabId(
  workspacePath: string,
  relativePath: string,
  projectId = '',
  folderId = '',
): `file:${string}` {
  const normalizedWorkspace = workspacePath.replace(/\\/g, '/').toLowerCase()
  const normalizedFile = relativePath.replace(/\\/g, '/').toLowerCase()
  const scope = projectId || folderId ? `${projectId}\u0000${folderId}\u0000` : ''
  return `file:${encodeURIComponent(`${scope}${normalizedWorkspace}\u0000${normalizedFile}`)}`
}
