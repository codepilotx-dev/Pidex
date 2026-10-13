import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import {
  ManagedProjectlessWorkspaceService,
  projectlessWorkspaceSlug,
} from '../src/workspace/ManagedProjectlessWorkspaceService'
import { ThreadWorkspaceResolver } from '../src/workspace/ThreadWorkspaceResolver'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { ThreadService } from '../src/session/ThreadService'

const roots: string[] = []

afterEach(async () => {
  await removeFixturePaths(roots.splice(0))
})

describe('ManagedProjectlessWorkspaceService', () => {
  test('使用 Codex 风格 slug，并为中文回退 new-chat', () => {
    expect(projectlessWorkspaceSlug('Analyze the session start logic right now please')).toBe(
      'analyze-the-session-start-logic-right',
    )
    expect(projectlessWorkspaceSlug('分析发起会话逻辑')).toBe('new-chat')
  })

  test('创建隔离的 work/outputs，并原子处理同名碰撞', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-projectless-test-'))
    roots.push(root)
    const documents = join(root, 'Documents')
    await mkdir(documents)
    const service = new ManagedProjectlessWorkspaceService(documents)
    const now = new Date('2026-07-22T08:00:00.000Z')
    const first = await service.allocate({
      workspaceID: crypto.randomUUID(),
      threadID: crypto.randomUUID(),
      prompt: 'Build report',
      now,
    })
    await service.activate(first)
    const validated = await service.validatePersisted({
      threadID: first.threadID,
      sessionRoot: first.sessionRoot,
      cwd: first.cwd,
      outputDirectory: first.outputDirectory,
    })
    expect(basename(validated.cwd)).toBe('work')
    expect(basename(validated.outputDirectory)).toBe('outputs')

    const second = await service.allocate({
      workspaceID: crypto.randomUUID(),
      threadID: crypto.randomUUID(),
      prompt: 'Build report',
      now,
    })
    expect(basename(first.sessionRoot)).toBe('build-report')
    expect(basename(second.sessionRoot)).toBe('build-report-2')
    await service.rollback(second)
  })

  test('ThreadService 原子创建 projectless thread，并按 operationId 幂等返回', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-projectless-thread-test-'))
    roots.push(root)
    const documents = join(root, 'Documents')
    await mkdir(documents)
    const db = new AgentDatabase(join(root, 'agent.sqlite'))
    const managed = new ManagedProjectlessWorkspaceService(documents)
    const resolver = new ThreadWorkspaceResolver(db, managed)
    const questions = { setResumeHandler: () => undefined }
    const subagents = { setParentResumeHandler: () => undefined }
    const threads = new ThreadService(
      db,
      null as never,
      null as never,
      null as never,
      questions as never,
      null as never,
      subagents as never,
      null as never,
      { dataRoot: root, userHome: root },
      null as never,
      null as never,
      resolver,
    )
    try {
      const operationID = crypto.randomUUID()
      const first = await threads.create({
        operationID,
        workspace: { kind: 'projectless', prompt: 'Build report' },
      })
      const descriptor = db.threadWorkspace(first.id)
      expect(descriptor).toMatchObject({ kind: 'projectless', projectID: null })
      if (descriptor?.kind !== 'projectless') throw new Error('expected projectless workspace')
      expect(basename(descriptor.cwd)).toBe('work')
      expect(basename(descriptor.outputDirectory)).toBe('outputs')
      expect((await resolver.resolve(first.id)).cwd).toBe(descriptor.cwd)

      const duplicate = await threads.create({
        operationID,
        workspace: { kind: 'projectless', prompt: 'Build report' },
      })
      expect(duplicate.id).toBe(first.id)
      const project = db.createProject({ primaryPath: root, name: 'Empty' })
      db.editProject({
        projectID: project.id,
        paths: [],
        name: 'Empty',
        expectedVersion: project.updatedAt,
      })
      const failedOperation = crypto.randomUUID()
      await expect(
        threads.create({
          operationID: failedOperation,
          workspace: { kind: 'project', projectID: project.id },
          bindExecution: () => {
            throw new Error('binding failed')
          },
        }),
      ).rejects.toThrow('binding failed')
      expect(db.threadForCreateOperation(failedOperation)).toBeNull()
      const emptyOperation = crypto.randomUUID()
      const emptyThread = await threads.create({
        operationID: emptyOperation,
        workspace: { kind: 'project', projectID: project.id },
      })
      expect(db.threadWorkspace(emptyThread.id)?.kind).toBe('projectless')
      expect(db.projectMembership(emptyThread.id)).toBe(project.id)
      expect(basename((await resolver.resolve(emptyThread.id)).cwd)).toBe('work')
      expect(
        (
          await threads.create({
            operationID: emptyOperation,
            workspace: { kind: 'project', projectID: project.id },
          })
        ).id,
      ).toBe(emptyThread.id)

      await expect(
        threads.create({ operationID, workspace: { kind: 'projectless', prompt: 'Different' } }),
      ).rejects.toThrow('operationId')
    } finally {
      db.close()
    }
  })

  test('项目 resolver 以持久 roots 为执行范围，显式空 roots 不扩大项目目录', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-project-workspace-test-'))
    roots.push(root)
    const primary = join(root, 'primary')
    const secondary = join(root, 'secondary')
    const missing = join(root, 'missing')
    const cwd = join(secondary, 'work')
    await Promise.all([mkdir(primary), mkdir(cwd, { recursive: true })])
    const project = {
      id: 'project',
      primaryFolderId: 'primary',
      rootPath: primary,
      folders: [
        {
          id: 'primary',
          path: primary,
          role: 'primary' as const,
          availability: 'available' as const,
        },
        {
          id: 'secondary',
          path: secondary,
          role: 'secondary' as const,
          availability: 'available' as const,
        },
        {
          id: 'missing',
          path: missing,
          role: 'secondary' as const,
          availability: 'missing' as const,
        },
      ],
    }
    const db = {
      threadWorkspace: () => ({
        kind: 'project' as const,
        projectID: 'project',
        cwd,
        runtimeWorkspaceRoots: [],
        instructionSources: [join(primary, 'AGENTS.md')],
        outputDirectory: null,
      }),
      getProject: () => project,
    }

    // Explicitly empty roots stay on the persisted cwd; the project's other
    // folders are not silently added to this thread's scope.
    const emptyRoots = await new ThreadWorkspaceResolver(db as never, null as never).resolve(
      'thread',
    )
    expect(emptyRoots.cwd).toBe(resolve(cwd))
    expect(emptyRoots.workspaceRoot).toBe(resolve(cwd))
    expect(emptyRoots.workspace.roots).toEqual([resolve(cwd)])
    expect(emptyRoots.runtimeWorkspaceRoots).toEqual([
      { folderId: resolve(cwd), path: resolve(cwd), role: 'primary' },
    ])

    const snapshot = {
      ...db.threadWorkspace(),
      runtimeWorkspaceRoots: [
        { folderId: 'primary', path: primary, role: 'primary' as const },
        { folderId: 'secondary', path: secondary, role: 'secondary' as const },
      ],
    }
    const pinned = await new ThreadWorkspaceResolver(
      { ...db, threadWorkspace: () => snapshot } as never,
      null as never,
    ).resolve('thread')
    expect(pinned.workspaceRoot).toBe(resolve(primary))
    expect(pinned.cwd).toBe(resolve(cwd))
    expect(pinned.instructionSources).toEqual([join(primary, 'AGENTS.md')])

    // Switching the project's primary folder leaves the thread's scope where it was.
    const changed = new ThreadWorkspaceResolver(
      {
        ...db,
        threadWorkspace: () => snapshot,
        getProject: () => ({ ...project, primaryFolderId: 'secondary', rootPath: secondary }),
      } as never,
      null as never,
    )
    expect((await changed.resolve('thread')).workspaceRoot).toBe(resolve(primary))

    // A temporarily missing secondary root drops out of this execution view but
    // stays in the persisted description, so recovering it keeps the directory usable.
    const resolvedWithMissing = await new ThreadWorkspaceResolver(
      {
        ...db,
        threadWorkspace: () => ({
          ...snapshot,
          runtimeWorkspaceRoots: [
            ...snapshot.runtimeWorkspaceRoots,
            { folderId: 'missing', path: missing, role: 'secondary' as const },
          ],
        }),
      } as never,
      null as never,
    ).resolve('thread')
    expect(resolvedWithMissing.workspace.roots).toEqual([resolve(primary), resolve(secondary)])
    expect(resolvedWithMissing.runtimeWorkspaceRoots.map(({ folderId }) => folderId)).toEqual([
      'primary',
      'secondary',
      'missing',
    ])
  })
})
