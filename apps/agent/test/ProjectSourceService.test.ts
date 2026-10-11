import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { ProjectSourceService } from '../src/project/ProjectSourceService'
import { ProjectService } from '../src/project/ProjectService'
import { createLifecycleTools } from '../src/orchestration/pi/PiToolAdapter'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { ContentBlobStore } from '../src/storage/ContentBlobStore'
import { AttachmentService } from '../src/subagent/AttachmentService'
import { SqliteAttachmentCatalog } from '../src/subagent/SqliteAttachmentCatalog'

const roots: string[] = []

afterEach(async () => {
  await removeFixturePaths(roots.splice(0))
})

const fixture = async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'pidex-project-sources-'))
  roots.push(dataDir)
  const workspace = join(dataDir, 'workspace')
  await mkdir(workspace)
  const db = new AgentDatabase(join(dataDir, 'history.sqlite'))
  const project = db.createProject({ primaryPath: workspace })
  const sources = await ProjectSourceService.open(dataDir, db)
  return { dataDir, workspace, db, project, sources }
}

describe('ProjectSourceService', () => {
  test('启动恢复继续 pending 项目移除并保留来源与源码目录供撤销', async () => {
    const { dataDir, workspace, db, project, sources } = await fixture()
    try {
      const [source] = await sources.import(project.id, [
        {
          kind: 'text',
          name: 'removal.txt',
          mimeType: 'text/plain',
          data: 'remove catalog only',
        },
      ])
      if (!source || source.storage !== 'managed') throw new Error('expected managed source')
      const operationID = crypto.randomUUID()
      const hash = createHash('sha256')
        .update(JSON.stringify({ projectID: project.id }))
        .digest('hex')
      db.beginProjectOperation({
        operationID,
        projectID: project.id,
        method: 'project/remove',
        requestHash: hash,
      })

      expect(await new ProjectService(db, sources).recoverPendingRemovals()).toEqual([operationID])
      expect(db.getProject(project.id)?.removedAt).toBeNumber()
      expect(db.projectOperation(operationID)?.status).toBe('completed')
      expect((await stat(workspace)).isDirectory()).toBe(true)
      expect(await (await ContentBlobStore.open(dataDir)).read(source.sha256)).toBeDefined()
    } finally {
      db.close()
    }
  })

  test('模型读取图片来源时返回真正的 image content block', async () => {
    const [tool] = createLifecycleTools(
      {
        projectSourceRead: async () => ({
          source: { id: 'source-image', name: 'preview.png', kind: 'image' },
          data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
          mediaType: 'image/png',
          range: { offset: 0, length: 8, total: 8 },
        }),
      },
      { exposedTools: ['project_source_read'] } as never,
    )
    const result = await tool!.execute(
      'tool-call',
      { sourceId: 'source-image' },
      undefined,
      undefined,
    )
    expect(result.content).toContainEqual({
      type: 'image',
      data: 'iVBORw0KGgo=',
      mimeType: 'image/png',
    })
  })

  test('路径来源实时刷新 revision、支持文本范围读取并保留失效状态', async () => {
    const { workspace, db, project, sources } = await fixture()
    try {
      const path = join(workspace, 'notes.md')
      await writeFile(path, 'hello project source', 'utf8')
      const folder = project.folders[0]!
      const source = await sources.addReference(project.id, folder.id, 'notes.md')
      expect(source).toMatchObject({
        storage: 'workspace-file',
        folderId: folder.id,
        path: 'notes.md',
        status: 'available',
      })

      const first = await sources.read(project.id, source.id, { offset: 6, length: 7 })
      expect(new TextDecoder().decode(first.data)).toBe('project')
      expect(first.range).toEqual({ offset: 6, length: 7, total: 20 })

      const initialRevision = source.storage === 'workspace-file' ? source.revision?.sha256 : null
      await writeFile(path, 'updated', 'utf8')
      const refreshed = (await sources.list(project.id)).sources[0]
      expect(refreshed?.status).toBe('available')
      expect(refreshed?.storage === 'workspace-file' ? refreshed.revision?.sha256 : null).not.toBe(
        initialRevision,
      )

      await unlink(path)
      expect((await sources.list(project.id)).sources[0]).toMatchObject({
        id: source.id,
        status: 'missing',
        revision: null,
      })
    } finally {
      db.close()
    }
  })

  test('托管来源与输入附件共享 Blob 引用，且禁止跨项目读取', async () => {
    const { dataDir, workspace, db, project, sources } = await fixture()
    try {
      const attachments = await AttachmentService.open(dataDir, {
        catalog: new SqliteAttachmentCatalog(db),
      })
      const [attachment] = await attachments.store([
        {
          kind: 'text',
          name: 'shared.txt',
          mimeType: 'text/plain',
          data: 'shared content',
        },
      ])
      const sourceOperationID = crypto.randomUUID()
      const uploads = [
        {
          kind: 'text',
          name: 'shared.txt',
          mimeType: 'text/plain',
          data: 'shared content',
        },
      ] as const
      const [source] = await sources.import(project.id, uploads, sourceOperationID)
      const [duplicate] = await sources.import(project.id, uploads, sourceOperationID)
      expect(duplicate?.id).toBe(source?.id)
      expect((await sources.list(project.id)).total).toBe(1)
      expect(source).toMatchObject({
        storage: 'managed',
        sha256: attachment!.sha256,
      })

      const otherWorkspace = join(dataDir, 'other')
      await mkdir(otherWorkspace)
      const otherProject = db.createProject({ primaryPath: otherWorkspace })
      await expect(sources.read(otherProject.id, source!.id)).rejects.toMatchObject({
        code: 'PROJECT_SOURCE_UNAVAILABLE',
      })

      await sources.remove(project.id, source!.id)
      expect((await attachments.readText(attachment!.id)).text).toBe('shared content')
      expect(await sources.catalog(project.id)).toMatchObject({
        included: 0,
        total: 0,
      })
      expect(workspace).toBe(project.rootPath)
    } finally {
      db.close()
    }
  })
})
