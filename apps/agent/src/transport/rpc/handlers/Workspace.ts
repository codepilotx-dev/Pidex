import { Effect } from 'effect'
import type { RpcMethod } from '@pidex/agent-protocol'
import type { RpcRouter } from '../RpcRouter'
import { optionalRpcRecord as optionalRecord, rpcRecord as record } from '../Decoders'
import {
  AgentError,
  WorkspaceService,
  decodeOffsetCursor,
  encodeOffsetCursor,
  modelRefOrNull,
  positiveIntegerParam,
  stringParam,
} from '../RpcRouter'
import type { RpcHandlerGroup } from './Types'
import type { RpcRouterContext } from '../RequestContext'
import { ProjectService } from '../../../project/ProjectService'
import type { AttachmentUpload } from '../../../subagent/AttachmentService'

export const workspaceHandlers = {
  name: 'workspace',
  methods: [
    'project/list',
    'project/create',
    'project/open',
    'project/update',
    'project/edit',
    'project/restore',
    'project/remove',
    'project/context/read',
    'project/folder/add',
    'project/folder/remove',
    'project/folder/set-primary',
    'project/source/list',
    'project/source/import',
    'project/source/reference/add',
    'project/source/read',
    'project/source/remove',
    'workspace/file/list',
    'workspace/file/read',
    'workspace/file/save',
    'workspace/file/watch',
    'workspace/file/unwatch',
    'project/settings/update',
  ],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    context: RpcRouterContext,
  ): Promise<unknown> {
    const { db, projectSources } = runtime.dependencies
    const params = optionalRecord(rawParams)
    const projects = new ProjectService(db, projectSources, async (events) => {
      for (const event of events) await Effect.runPromise(runtime.dependencies.hub.publish(event))
    })
    const operationID = () => stringParam(params, 'operationId')
    const expectedVersion = () => {
      if (
        typeof params.expectedVersion !== 'number' ||
        !Number.isInteger(params.expectedVersion) ||
        params.expectedVersion < 0
      ) {
        throw new AgentError('INVALID_REQUEST', 'expectedVersion 参数无效', 400)
      }
      return params.expectedVersion
    }
    const projectWorkspace = async () => {
      const projectID = stringParam(params, 'projectId')
      const folderID = stringParam(params, 'folderId')
      const folder = db.getProjectFolder(projectID, folderID)
      if (!folder) throw new AgentError('PROJECT_FOLDER_NOT_FOUND', '项目目录不存在', 404)
      return { projectID, folderID, workspace: await WorkspaceService.open(folder.path) }
    }
    switch (method) {
      case 'project/list': {
        const offset = decodeOffsetCursor(params.cursor)
        const limit = params.limit === undefined ? 100 : positiveIntegerParam(params, 'limit')
        const all = projects.list({
          ...(typeof params.folderPath === 'string' ? { folderPath: params.folderPath } : {}),
        })
        const page = all.slice(offset, offset + limit)
        return {
          projects: page,
          nextCursor:
            offset + page.length < all.length ? encodeOffsetCursor(offset + page.length) : null,
        }
      }
      case 'project/create':
        return projects.create({
          ...(typeof params.name === 'string' ? { name: params.name } : {}),
          primaryPath: stringParam(params, 'primaryPath'),
          operationID: operationID(),
        })
      case 'project/open':
        return projects.open({
          projectID: stringParam(params, 'projectId'),
          operationID: operationID(),
        })
      case 'project/update':
        return projects.update({
          projectID: stringParam(params, 'projectId'),
          name: stringParam(params, 'name'),
          expectedVersion: expectedVersion(),
          operationID: operationID(),
        })
      case 'project/edit': {
        if (
          !Array.isArray(params.paths) ||
          !params.paths.every((path) => typeof path === 'string' && path.trim())
        )
          throw new AgentError('INVALID_REQUEST', 'paths 参数无效', 400)
        return projects.edit({
          projectID: stringParam(params, 'projectId'),
          name: stringParam(params, 'name'),
          paths: params.paths as string[],
          expectedVersion: expectedVersion(),
          operationID: operationID(),
        })
      }
      case 'project/restore':
        return projects.restore({
          projectID: stringParam(params, 'projectId'),
          removalOperationID: stringParam(params, 'removalOperationId'),
          operationID: operationID(),
        })
      case 'project/remove':
        return projects.remove({
          projectID: stringParam(params, 'projectId'),
          operationID: operationID(),
        })
      case 'project/context/read': {
        const projectID = stringParam(params, 'projectId')
        const project = db.getProject(projectID)
        if (!project || project.removedAt !== null)
          throw new AgentError('PROJECT_NOT_FOUND', '项目不存在', 404)
        const sources = await projectSources.list(projectID, 100, 0)
        return { project, sources: sources.sources }
      }
      case 'project/folder/add':
        return projects.addFolder({
          projectID: stringParam(params, 'projectId'),
          path: stringParam(params, 'path'),
          operationID: operationID(),
        })
      case 'project/folder/remove':
        return projects.removeFolder({
          projectID: stringParam(params, 'projectId'),
          folderID: stringParam(params, 'folderId'),
          operationID: operationID(),
        })
      case 'project/folder/set-primary':
        return projects.setPrimaryFolder({
          projectID: stringParam(params, 'projectId'),
          folderID: stringParam(params, 'folderId'),
          operationID: operationID(),
        })
      case 'workspace/file/list': {
        const { workspace } = await projectWorkspace()
        if (typeof params.path !== 'string')
          throw new AgentError('INVALID_REQUEST', 'path 参数无效', 400)
        return { entries: await workspace.listEditorFiles(params.path) }
      }
      case 'workspace/file/read': {
        const { workspace } = await projectWorkspace()
        return workspace.readEditorFile(stringParam(params, 'path'))
      }
      case 'workspace/file/save': {
        const { workspace } = await projectWorkspace()
        const expectedRevision = record(params.expectedRevision, 'expectedRevision')
        if (typeof params.content !== 'string')
          throw new AgentError('INVALID_REQUEST', 'content 参数无效', 400)
        if (
          typeof expectedRevision.mtimeMs !== 'number' ||
          typeof expectedRevision.sha256 !== 'string'
        ) {
          throw new AgentError('INVALID_REQUEST', 'expectedRevision 参数无效', 400)
        }
        return workspace.saveEditorFile(stringParam(params, 'path'), params.content, {
          mtimeMs: expectedRevision.mtimeMs,
          sha256: expectedRevision.sha256,
        })
      }
      case 'workspace/file/watch': {
        const connectionId = runtime.requireConnection(context)
        const { projectID: projectId, folderID: folderId, workspace } = await projectWorkspace()
        const requestedPath = stringParam(params, 'path')
        const path = await workspace.resolveEditorFilePath(requestedPath)
        const key = `${projectId}\0${folderId}\0${path}`
        if (!runtime.connections.has(connectionId)) {
          return { watching: false, path }
        }
        const current = runtime.workspaceFileWatchers.get(key)
        if (current) {
          current.ownerCounts.set(connectionId, (current.ownerCounts.get(connectionId) ?? 0) + 1)
          return { watching: true, path }
        }
        const watched = await workspace.watchEditorFile(path, (changedPath) => {
          void runtime.emit('workspace/file/changed', {
            projectId,
            folderId,
            path: changedPath,
            changedAt: Date.now(),
          })
        })
        if (!runtime.connections.has(connectionId)) {
          watched.close()
          return { watching: false, path: watched.path }
        }
        const raced = runtime.workspaceFileWatchers.get(key)
        if (raced) {
          watched.close()
          raced.ownerCounts.set(connectionId, (raced.ownerCounts.get(connectionId) ?? 0) + 1)
        } else {
          runtime.workspaceFileWatchers.set(key, {
            close: watched.close,
            ownerCounts: new Map([[connectionId, 1]]),
          })
        }
        return { watching: true, path: watched.path }
      }
      case 'workspace/file/unwatch': {
        const connectionId = runtime.requireConnection(context)
        const { projectID: projectId, folderID: folderId, workspace } = await projectWorkspace()
        const path = await workspace.resolveEditorFilePath(stringParam(params, 'path'))
        const key = `${projectId}\0${folderId}\0${path}`
        const watched = runtime.workspaceFileWatchers.get(key)
        const ownerCount = watched?.ownerCounts.get(connectionId) ?? 0
        if (watched && ownerCount > 0) {
          if (ownerCount === 1) watched.ownerCounts.delete(connectionId)
          else watched.ownerCounts.set(connectionId, ownerCount - 1)
          if (watched.ownerCounts.size === 0) {
            watched.close()
            runtime.workspaceFileWatchers.delete(key)
          }
        }
        return { watching: false, path }
      }
      case 'project/settings/update': {
        const settings = record(params.settings, 'settings')
        return projects.updateSettings({
          projectID: stringParam(params, 'projectId'),
          settings: {
            ...('defaultModel' in settings
              ? { defaultModel: modelRefOrNull(settings.defaultModel) }
              : {}),
            ...(typeof settings.instructions === 'string'
              ? { instructions: settings.instructions }
              : {}),
          },
          expectedVersion: expectedVersion(),
          operationID: operationID(),
        })
      }
      case 'project/source/list': {
        const offset = decodeOffsetCursor(params.cursor)
        const limit = params.limit === undefined ? 100 : positiveIntegerParam(params, 'limit')
        const result = await projectSources.list(stringParam(params, 'projectId'), limit, offset)
        return {
          sources: result.sources,
          nextCursor: result.nextOffset === null ? null : encodeOffsetCursor(result.nextOffset),
        }
      }
      case 'project/source/import': {
        const sourceOperationID = operationID()
        if (!Array.isArray(params.uploads))
          throw new AgentError('INVALID_REQUEST', 'uploads 参数无效', 400)
        const uploads: AttachmentUpload[] = params.uploads.map((entry) => {
          const upload = record(entry, 'upload')
          const kind = upload.kind
          if (kind !== 'text' && kind !== 'image')
            throw new AgentError('INVALID_REQUEST', 'upload.kind 参数无效', 400)
          const encoding = upload.encoding
          if (encoding !== 'utf8' && encoding !== 'base64')
            throw new AgentError('INVALID_REQUEST', 'upload.encoding 参数无效', 400)
          const data = stringParam(upload, 'data')
          return {
            kind,
            name: stringParam(upload, 'name'),
            mimeType: stringParam(upload, 'mediaType'),
            data: encoding === 'base64' ? new Uint8Array(Buffer.from(data, 'base64')) : data,
          }
        })
        return {
          sources: await projectSources.import(
            stringParam(params, 'projectId'),
            uploads,
            sourceOperationID,
          ),
        }
      }
      case 'project/source/reference/add': {
        const sourceOperationID = operationID()
        const source = await projectSources.addReference(
          stringParam(params, 'projectId'),
          stringParam(params, 'folderId'),
          stringParam(params, 'path'),
          sourceOperationID,
        )
        return { sources: [source] }
      }
      case 'project/source/read': {
        const range = params.range === undefined ? undefined : record(params.range, 'range')
        const result = await projectSources.read(
          stringParam(params, 'projectId'),
          stringParam(params, 'sourceId'),
          range === undefined
            ? undefined
            : {
                offset: Number(range.offset),
                length: Number(range.length),
              },
        )
        const encoding = result.source.kind === 'text' ? ('utf8' as const) : ('base64' as const)
        return {
          source: result.source,
          data:
            encoding === 'utf8'
              ? new TextDecoder('utf-8', { fatal: true }).decode(result.data)
              : Buffer.from(result.data).toString('base64'),
          encoding,
          range: result.range,
        }
      }
      case 'project/source/remove': {
        const sourceOperationID = operationID()
        const sourceId = stringParam(params, 'sourceId')
        await projectSources.remove(stringParam(params, 'projectId'), sourceId, sourceOperationID)
        return { sourceId, removed: true }
      }
      default:
        throw new AgentError('METHOD_NOT_FOUND', `未知 RPC 方法：${method}`, 404)
    }
  },
} as const satisfies RpcHandlerGroup
