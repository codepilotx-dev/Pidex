import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { LocalContextPathService } from '../src/local-context/LocalContextPathService'
import { LocalContextPathRepository } from '../src/storage/repositories/LocalContextPathRepository'
import { WorkspaceService } from '../src/workspace/WorkspaceService'
import { removeFixturePaths } from './FixtureCleanup'
import { Model, Provider } from '@pidex/model-schema'

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)))

describe('本地路径上下文', () => {
  test('导入保持惰性，输入绑定后才成为任务级只读授权', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-local-context-'))
    paths.push(root)
    const workspaceRoot = join(root, 'workspace')
    const outside = join(root, 'outside')
    await mkdir(workspaceRoot)
    await mkdir(outside)
    const outsideFile = join(outside, 'fixture.txt')
    await writeFile(outsideFile, 'outside fixture', 'utf8')
    const db = new AgentDatabase(join(root, 'agent.sqlite'))
    const thread = db.createThread()
    const repository = new LocalContextPathRepository(db)
    const service = new LocalContextPathService(repository)

    const [reference] = await service.import(thread.id, [outsideFile], 'operation:context:1')
    expect(reference?.kind).toBe('file')
    expect(repository.listAuthorized(thread.id)).toEqual([])
    await expect(
      service.read({ threadID: thread.id, referenceID: reference!.id }),
    ).rejects.toMatchObject({ code: 'LOCAL_CONTEXT_NOT_FOUND' })

    const turn = db.createTurn(
      thread.id,
      {
        content: 'read context',
        model: Model.Ref.make({
          providerID: Provider.ID.make('openai'),
          id: Model.ID.make('fixture'),
        }),
        permissionConfig: {
          sandboxMode: 'workspace-write',
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        },
        strategy: 'start',
        taskMode: 'chat',
      },
      'queued',
    )
    repository.bindInput(thread.id, turn.inputID, [reference!.id])
    expect(repository.listAuthorized(thread.id)).toHaveLength(1)

    const workspace = await WorkspaceService.open(workspaceRoot)
    workspace.grantReadOnlyPaths([{ path: reference!.path, kind: reference!.kind }])
    expect(await workspace.read(reference!.path)).toBe('outside fixture')
    await expect(
      workspace.applyPatch({
        operation: 'update',
        path: reference!.path,
        before: 'fixture',
        after: 'changed',
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FILE_READONLY' })
    db.close()
  })

  test('目录列表和预览不能通过相对遍历逃逸', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-local-context-list-'))
    paths.push(root)
    const directory = join(root, 'selected')
    await mkdir(directory)
    await writeFile(join(directory, 'fixture.txt'), 'fixture', 'utf8')
    const db = new AgentDatabase(join(root, 'agent.sqlite'))
    const thread = db.createThread()
    const service = new LocalContextPathService(new LocalContextPathRepository(db))
    const [reference] = await service.import(thread.id, [directory], 'operation:context:2')
    const turn = db.createTurn(
      thread.id,
      {
        content: 'browse context',
        model: Model.Ref.make({
          providerID: Provider.ID.make('openai'),
          id: Model.ID.make('fixture'),
        }),
        permissionConfig: {
          sandboxMode: 'workspace-write',
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        },
        strategy: 'start',
        taskMode: 'chat',
      },
      'queued',
    )
    service.repository.bindInput(thread.id, turn.inputID, [reference!.id])

    const listed = await service.list({ threadID: thread.id, referenceID: reference!.id })
    expect(listed.entries).toEqual([
      expect.objectContaining({ name: 'fixture.txt', relativePath: 'fixture.txt' }),
    ])
    const preview = await service.read({
      threadID: thread.id,
      referenceID: reference!.id,
      relativePath: 'fixture.txt',
    })
    expect(preview).toMatchObject({ preview: 'text', data: 'fixture' })
    await expect(
      service.read({
        threadID: thread.id,
        referenceID: reference!.id,
        relativePath: '../outside.txt',
      }),
    ).rejects.toMatchObject({ code: 'PATH_DENIED' })
    db.close()
  })
})
