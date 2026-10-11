import { useSyncExternalStore } from 'react'
import type { DesktopFilePreview, DesktopFileRevision } from '../../../shared/Types.js'
import { desktopClient, WORKSPACE_FILE_CHANGED_EVENT } from '../../services/desktop-client/index.js'
import { AgentRpcError } from '../../services/AgentRpcClient.js'

const AUTOSAVE_DELAY_MS = 3_000
const EXTERNAL_CHECK_INTERVAL_MS = 4_000

export type FileDocumentConflict = {
  diskContent: string
  diskRevision: DesktopFileRevision
}

export type FileDocumentExternalCheckResult =
  { status: 'skipped' } | { status: 'available' } | { status: 'unavailable'; error: Error }

export type FileDocumentExternalCheckOptions = {
  onLoadError?: (error: Error) => void
}

export type FileDocumentSnapshot = {
  key: string
  workspacePath: string
  projectId?: string
  folderId?: string
  path: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  baseContent: string
  draftContent: string
  revision: DesktopFileRevision | null
  sizeBytes: number
  readonly: boolean
  saving: boolean
  saveError: string | null
  loadError: string | null
  loadErrorCode: string | null
  conflict: FileDocumentConflict | null
  dirty: boolean
}

type Listener = () => void

const documents = new Map<string, FileDocumentSnapshot>()
const listeners = new Map<string, Set<Listener>>()
const loadPromises = new Map<string, Promise<FileDocumentSnapshot>>()
const savePromises = new Map<string, Promise<boolean>>()
const autosaveTimers = new Map<string, number>()

export type FileDocumentScope = {
  projectId?: string
  folderId?: string
}

export function fileDocumentKey(
  workspacePath: string,
  path: string,
  scope: FileDocumentScope = {},
): string {
  const prefix =
    scope.projectId || scope.folderId
      ? `${scope.projectId ?? ''}\u0000${scope.folderId ?? ''}\u0000`
      : ''
  return `${prefix}${workspacePath.replace(/\\/g, '/').toLowerCase()}\u0000${path
    .replace(/\\/g, '/')
    .toLowerCase()}`
}

function initialSnapshot(
  workspacePath: string,
  path: string,
  scope: FileDocumentScope = {},
): FileDocumentSnapshot {
  return {
    key: fileDocumentKey(workspacePath, path, scope),
    workspacePath,
    ...(scope.projectId ? { projectId: scope.projectId } : {}),
    ...(scope.folderId ? { folderId: scope.folderId } : {}),
    path,
    status: 'idle',
    baseContent: '',
    draftContent: '',
    revision: null,
    sizeBytes: 0,
    readonly: false,
    saving: false,
    saveError: null,
    loadError: null,
    loadErrorCode: null,
    conflict: null,
    dirty: false,
  }
}

function snapshotFor(
  workspacePath: string,
  path: string,
  scope: FileDocumentScope = {},
): FileDocumentSnapshot {
  const key = fileDocumentKey(workspacePath, path, scope)
  const existing = documents.get(key)
  if (existing) {
    return existing
  }

  const initial = initialSnapshot(workspacePath, path, scope)
  documents.set(key, initial)
  return initial
}

function publish(next: FileDocumentSnapshot): FileDocumentSnapshot {
  documents.set(next.key, next)
  for (const listener of listeners.get(next.key) ?? []) listener()
  return next
}

function fromPreview(
  current: FileDocumentSnapshot,
  preview: DesktopFilePreview,
): FileDocumentSnapshot {
  return {
    ...current,
    path: preview.path,
    status: 'ready',
    baseContent: preview.content,
    draftContent: preview.content,
    revision: preview.revision,
    sizeBytes: preview.sizeBytes,
    readonly: preview.readonly,
    saving: false,
    saveError: null,
    loadError: null,
    loadErrorCode: null,
    conflict: null,
    dirty: false,
  }
}

export function prefetchFileDocument(
  workspacePath: string,
  path: string,
  scope: FileDocumentScope = {},
): Promise<FileDocumentSnapshot> {
  const current = snapshotFor(workspacePath, path, scope)
  if (current.status === 'ready') return Promise.resolve(current)
  const existing = loadPromises.get(current.key)
  if (existing) return existing

  publish({ ...current, status: 'loading', loadError: null })
  const read =
    scope.projectId || scope.folderId
      ? desktopClient.readWorkspaceFile(workspacePath, path, scope.folderId, scope.projectId)
      : desktopClient.readWorkspaceFile(workspacePath, path)
  const request = read
    .then((preview) => fromPreview(snapshotFor(workspacePath, path, scope), preview))
    .then(publish)
    .catch((error) => {
      const loadError = toError(error)
      const failed = publish({
        ...snapshotFor(workspacePath, path, scope),
        status: 'error',
        loadError: loadError.message,
        loadErrorCode: loadError instanceof AgentRpcError ? loadError.errorCode : null,
      })
      throw loadError
    })
    .finally(() => loadPromises.delete(current.key))
  loadPromises.set(current.key, request)
  return request
}

export function updateFileDocument(
  workspacePath: string,
  path: string,
  content: string,
  scope: FileDocumentScope = {},
): void {
  const current = snapshotFor(workspacePath, path, scope)
  if (current.status !== 'ready' || current.readonly) return
  const next = publish({
    ...current,
    draftContent: content,
    dirty: content !== current.baseContent,
    saveError: null,
  })
  scheduleAutosave(next)
}

function scheduleAutosave(document: FileDocumentSnapshot): void {
  const previous = autosaveTimers.get(document.key)
  if (previous !== undefined) window.clearTimeout(previous)
  if (!document.dirty || document.conflict || document.readonly) {
    autosaveTimers.delete(document.key)
    return
  }
  const timer = window.setTimeout(() => {
    autosaveTimers.delete(document.key)
    void saveFileDocument(document.workspacePath, document.path, {
      projectId: document.projectId,
      folderId: document.folderId,
    })
  }, AUTOSAVE_DELAY_MS)
  autosaveTimers.set(document.key, timer)
}

export async function saveFileDocument(
  workspacePath: string,
  path: string,
  scope: FileDocumentScope = {},
): Promise<boolean> {
  const key = fileDocumentKey(workspacePath, path, scope)
  const existing = savePromises.get(key)
  if (existing) return existing

  const request = saveUntilClean(workspacePath, path, scope).finally(() => savePromises.delete(key))
  savePromises.set(key, request)
  return request
}

async function saveUntilClean(
  workspacePath: string,
  path: string,
  scope: FileDocumentScope,
): Promise<boolean> {
  const current = snapshotFor(workspacePath, path, scope)
  if (current.status !== 'ready' || current.readonly || current.conflict || !current.revision) {
    return !current.dirty
  }
  if (!current.dirty) return true

  const content = current.draftContent
  const expectedRevision = current.revision
  publish({ ...current, saving: true, saveError: null })
  try {
    const result = await desktopClient.saveWorkspaceFile({
      workspacePath,
      ...(scope.projectId ? { projectId: scope.projectId } : {}),
      ...(scope.folderId ? { folderId: scope.folderId } : {}),
      filePath: path,
      content,
      expectedRevision,
    })
    const latest = snapshotFor(workspacePath, path, scope)
    if (result.outcome === 'conflict') {
      publish({
        ...latest,
        saving: false,
        conflict: {
          diskContent: result.content,
          diskRevision: result.revision,
        },
        saveError: '文件已在磁盘上发生变化。',
      })
      return false
    }

    const next = publish({
      ...latest,
      baseContent: content,
      revision: result.revision,
      saving: false,
      saveError: null,
      dirty: latest.draftContent !== content,
    })
    return next.dirty ? saveUntilClean(workspacePath, path, scope) : true
  } catch (error) {
    publish({
      ...snapshotFor(workspacePath, path, scope),
      saving: false,
      saveError: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

export async function checkFileDocumentForExternalChange(
  workspacePath: string,
  path: string,
  scope: FileDocumentScope = {},
): Promise<FileDocumentExternalCheckResult> {
  const before = snapshotFor(workspacePath, path, scope)
  if (before.status !== 'ready' || before.saving || before.conflict) {
    return { status: 'skipped' }
  }
  try {
    const disk =
      scope.projectId || scope.folderId
        ? await desktopClient.readWorkspaceFile(
            workspacePath,
            path,
            scope.folderId,
            scope.projectId,
          )
        : await desktopClient.readWorkspaceFile(workspacePath, path)
    const current = snapshotFor(workspacePath, path, scope)
    if (current.status !== 'ready' || current.saving || current.conflict) {
      return { status: 'skipped' }
    }
    if (
      !current.revision ||
      (disk.revision.mtimeMs === current.revision.mtimeMs &&
        disk.revision.sha256 === current.revision.sha256)
    ) {
      return { status: 'available' }
    }
    if (disk.content === current.baseContent) {
      publish({ ...current, revision: disk.revision, sizeBytes: disk.sizeBytes })
    } else if (disk.content === current.draftContent) {
      publish(fromPreview(current, disk))
    } else {
      publish({
        ...current,
        conflict: {
          diskContent: disk.content,
          diskRevision: disk.revision,
        },
        saveError: '文件已在外部修改。',
      })
    }
    return { status: 'available' }
  } catch (error) {
    return { status: 'unavailable', error: toError(error) }
  }
}

export function useFileDocument(
  workspacePath: string,
  path: string,
  scope: FileDocumentScope = {},
): FileDocumentSnapshot {
  const key = fileDocumentKey(workspacePath, path, scope)
  return useSyncExternalStore(
    (listener) => {
      const bucket = listeners.get(key) ?? new Set<Listener>()
      bucket.add(listener)
      listeners.set(key, bucket)
      return () => {
        bucket.delete(listener)
        if (bucket.size === 0) listeners.delete(key)
      }
    },
    () => snapshotFor(workspacePath, path, scope),
    () => snapshotFor(workspacePath, path, scope),
  )
}

export function startFileDocumentExternalChecks(
  workspacePath: string,
  path: string,
  options: FileDocumentExternalCheckOptions = {},
  scope: FileDocumentScope = {},
): () => void {
  let stopped = false
  let unavailableNotified = false
  let checkPromise: Promise<void> | null = null
  const check = (): void => {
    if (!stopped && !checkPromise && document.visibilityState !== 'hidden') {
      checkPromise = checkFileDocumentForExternalChange(workspacePath, path, scope)
        .then((result) => {
          if (stopped) return
          if (result.status === 'available') {
            unavailableNotified = false
          } else if (result.status === 'unavailable' && !unavailableNotified) {
            unavailableNotified = true
            options.onLoadError?.(result.error)
          }
        })
        .finally(() => {
          checkPromise = null
        })
    }
  }
  const onChanged = (event: Event): void => {
    const detail = (
      event as CustomEvent<{
        path?: unknown
        projectId?: unknown
        folderId?: unknown
      }>
    ).detail
    if (
      typeof detail?.path === 'string' &&
      (!scope.projectId || detail.projectId === scope.projectId) &&
      (!scope.folderId || detail.folderId === scope.folderId) &&
      detail.path.replace(/\\/g, '/').toLowerCase() === path.replace(/\\/g, '/').toLowerCase()
    ) {
      check()
    }
  }
  const watch =
    scope.projectId || scope.folderId
      ? desktopClient.watchWorkspaceFile(workspacePath, path, scope.folderId, scope.projectId)
      : desktopClient.watchWorkspaceFile(workspacePath, path)
  let watchReady = false
  let released = false
  const releaseWatch = (): void => {
    if (released) return
    released = true
    const unwatch =
      scope.projectId || scope.folderId
        ? desktopClient.unwatchWorkspaceFile(workspacePath, path, scope.folderId, scope.projectId)
        : desktopClient.unwatchWorkspaceFile(workspacePath, path)
    void unwatch.catch(() => undefined)
  }
  void watch.then(
    () => {
      watchReady = true
      if (stopped) releaseWatch()
    },
    () => undefined,
  )
  const timer = window.setInterval(check, EXTERNAL_CHECK_INTERVAL_MS)
  window.addEventListener('focus', check)
  window.addEventListener(WORKSPACE_FILE_CHANGED_EVENT, onChanged)
  return () => {
    stopped = true
    window.clearInterval(timer)
    window.removeEventListener('focus', check)
    window.removeEventListener(WORKSPACE_FILE_CHANGED_EVENT, onChanged)
    if (watchReady) releaseWatch()
  }
}

export function resolveFileDocumentConflict(
  workspacePath: string,
  path: string,
  resolution: 'disk' | 'local' | 'edit',
  mergedContent?: string,
  scope: FileDocumentScope = {},
): void {
  const current = snapshotFor(workspacePath, path, scope)
  const conflict = current.conflict
  if (!conflict) return

  if (resolution === 'disk') {
    publish({
      ...current,
      baseContent: conflict.diskContent,
      draftContent: conflict.diskContent,
      revision: conflict.diskRevision,
      conflict: null,
      dirty: false,
      saveError: null,
    })
    return
  }

  const draftContent =
    resolution === 'edit' ? (mergedContent ?? current.draftContent) : current.draftContent
  const next = publish({
    ...current,
    baseContent: conflict.diskContent,
    draftContent,
    revision: conflict.diskRevision,
    conflict: null,
    dirty: draftContent !== conflict.diskContent,
    saveError: null,
  })
  if (resolution === 'local') {
    void saveFileDocument(workspacePath, path, scope)
  } else {
    scheduleAutosave(next)
  }
}

export async function saveAllFileDocuments(): Promise<boolean> {
  const dirty = [...documents.values()].filter((document) => document.dirty)
  const results = await Promise.all(
    dirty.map((document) =>
      saveFileDocument(document.workspacePath, document.path, {
        projectId: document.projectId,
        folderId: document.folderId,
      }),
    ),
  )
  return results.every(Boolean)
}

export function hasDirtyFileDocuments(): boolean {
  return [...documents.values()].some((document) => document.dirty)
}

export function isFileDocumentDirty(
  workspacePath: string,
  path: string,
  scope: FileDocumentScope = {},
): boolean {
  return snapshotFor(workspacePath, path, scope).dirty
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function fileDocumentLoadErrorMessage(
  errorCode: string | null,
  fallback: string | null,
): { code?: string; message: string; retryable: boolean } {
  const messages: Record<string, string> = {
    PROJECT_NOT_FOUND: '当前项目已失效，请重新打开项目后再试。',
    PROJECT_REMOVED: '当前项目已移除，请重新打开项目后再试。',
    PROJECT_FOLDER_NOT_FOUND: '文件所属的项目目录已失效，请重新打开项目后再试。',
    FILE_NOT_FOUND: '文件不存在或已被移动。',
    FILE_TOO_LARGE: '文件过大，无法在内置编辑器中打开。',
    FILE_NOT_TEXT: '该文件不是受支持的文本文件。',
    PATH_DENIED: '该路径不在当前项目允许访问的目录中。',
    PERMISSION_DENIED: '没有读取该文件的权限。',
    CAPABILITY_REQUIRED: '当前 Agent 不支持读取项目文件。',
  }
  const message = errorCode ? messages[errorCode] : undefined
  return {
    ...(errorCode ? { code: errorCode } : {}),
    message: message ?? fallback ?? '读取文件失败，请重试。',
    retryable: !['FILE_TOO_LARGE', 'FILE_NOT_TEXT'].includes(errorCode ?? ''),
  }
}
