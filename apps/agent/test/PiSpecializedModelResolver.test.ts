import { afterEach, describe, expect, test } from 'bun:test'
import type { Api, Model as PiModel } from '@earendil-works/pi-ai'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Model, Provider } from '@pidex/model-schema'
import { ConfigService } from '../src/config/ConfigService'
import { resolveSpecializedPiModel } from '../src/provider/pi/PiSpecializedModelResolver'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { removeFixturePaths } from './FixtureCleanup'

const roots: string[] = []
afterEach(async () => {
  await removeFixturePaths(roots.splice(0))
})

const piModel = (provider: string, id: string) =>
  ({
    provider,
    id,
  }) as unknown as PiModel<Api>

describe('resolveSpecializedPiModel', () => {
  test('完整引用保留模型 ID 中的斜杠且不可用时回退主模型', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-specialized-model-'))
    roots.push(root)
    const config = new ConfigService(join(root, 'config.json'), {
      model_provider: 'provider:main',
      model: 'main',
      desktop: { recent_new_thread_model: { providerID: 'provider:main', id: 'main' } },
      specialized_models: { generation: 'provider:special/models/generate' },
    })
    await config.initialize()
    const db = new AgentDatabase({
      historyPath: join(root, 'history.sqlite'),
      profilePath: join(root, 'profile.sqlite'),
    })
    const attempted: Model.Ref[] = []
    const selected = await resolveSpecializedPiModel({
      purpose: 'generation',
      db,
      configService: config,
      models: {
        getPiModel: async (ref) => {
          attempted.push(ref)
          if (String(ref.providerID) === 'provider:special') throw new Error('unavailable')
          return piModel(String(ref.providerID), String(ref.id))
        },
      },
    })

    expect(attempted.map((ref) => [String(ref.providerID), String(ref.id)])).toEqual([
      ['provider:special', 'models/generate'],
      ['provider:main', 'main'],
    ])
    expect(selected?.ref).toMatchObject({ providerID: 'provider:main', id: 'main' })
    await config.dispose()
    db.close()
  })

  test('项目专用模型裸 ID 继承项目有效 Provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-specialized-project-'))
    roots.push(root)
    const data = join(root, 'data')
    const workspace = join(root, 'workspace')
    await mkdir(join(workspace, '.pidex'), { recursive: true })
    await writeFile(
      join(workspace, '.pidex', 'config.json'),
      JSON.stringify({
        model_provider: 'provider:project',
        model: 'project-main',
        specialized_models: { organization: 'project-organizer' },
      }),
      'utf8',
    )
    const config = new ConfigService(join(data, 'config.json'), {
      model_provider: 'provider:user',
      model: 'user-main',
    })
    await config.initialize()
    await config.trustUpdate(workspace, 'trusted')
    const db = new AgentDatabase({
      historyPath: join(data, 'history.sqlite'),
      profilePath: join(data, 'profile.sqlite'),
    })
    const project = db.createProject({ rootPath: workspace })
    const selected = await resolveSpecializedPiModel({
      purpose: 'organization',
      db,
      projectId: project.id,
      configService: config,
      models: {
        getPiModel: async (ref) => piModel(String(ref.providerID), String(ref.id)),
      },
    })

    expect(selected?.ref).toMatchObject({
      providerID: 'provider:project',
      id: 'project-organizer',
    })
    await config.dispose()
    db.close()
  })

  test('调用方回退位于主模型之前且可关闭主模型回退', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-specialized-fallback-'))
    roots.push(root)
    const config = new ConfigService(join(root, 'config.json'), {
      model_provider: 'provider:main',
      model: 'main',
      specialized_models: { security: 'provider:special/security' },
    })
    await config.initialize()
    const db = new AgentDatabase({
      historyPath: join(root, 'history.sqlite'),
      profilePath: join(root, 'profile.sqlite'),
    })
    const attempted: string[] = []
    const fallbackRef = Model.Ref.make({
      providerID: Provider.ID.make('provider:task'),
      id: Model.ID.make('task-model'),
    })
    const selected = await resolveSpecializedPiModel({
      purpose: 'security',
      db,
      configService: config,
      fallbackRefs: [fallbackRef, fallbackRef],
      includeMainFallback: false,
      models: {
        getPiModel: async (ref) => {
          attempted.push(`${ref.providerID}/${ref.id}`)
          if (String(ref.providerID) === 'provider:special') throw new Error('unavailable')
          return piModel(String(ref.providerID), String(ref.id))
        },
      },
    })

    expect(attempted).toEqual(['provider:special/security', 'provider:task/task-model'])
    expect(selected?.ref).toEqual(fallbackRef)
    await config.dispose()
    db.close()
  })
})
