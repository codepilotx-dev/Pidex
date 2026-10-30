import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { InstructionDiscoveryService } from '../src/prompt/InstructionDiscoveryService'
import { PromptComposer } from '../src/prompt/PromptComposer'
import {
  inferPromptCacheCapability,
  inferPromptCacheRuntimePolicy,
} from '../src/prompt/PromptCache'
import { createPromptSections } from '../src/prompt/Sections'
import {
  buildCapabilityCatalogSection,
  CAPABILITY_CATALOG_MAX_CHARS,
  CAPABILITY_DESCRIPTION_MAX_CHARS,
} from '../src/prompt/CapabilityCatalog'
import { SkillService } from '../src/prompt/SkillService'
import { applyPromptCacheRuntimePolicy } from '../src/orchestration/pi/PiPromptCacheAdapter'

const paths: string[] = []
const temporaryDirectory = async () => {
  const path = await mkdtemp(join(tmpdir(), 'pidex-prompt-'))
  paths.push(path)
  return path
}
afterEach(async () => removeFixturePaths(paths.splice(0)))

describe('项目指令发现', () => {
  test('从根到 cwd 分层，并在每层选择最高优先级文件', async () => {
    const root = await temporaryDirectory()
    const cwd = join(root, 'packages', 'feature')
    await mkdir(cwd, { recursive: true })
    await writeFile(join(root, 'AGENTS.md'), 'root agents', 'utf8')
    await writeFile(join(root, 'CLAUDE.md'), 'ignored', 'utf8')
    await writeFile(join(root, 'packages', 'AGENTS.override.md'), 'package override', 'utf8')
    await writeFile(join(root, 'packages', 'AGENTS.md'), 'ignored package', 'utf8')
    await writeFile(join(cwd, 'CLAUDE.md'), 'feature claude', 'utf8')

    const result = await new InstructionDiscoveryService().discover(root, cwd)
    expect(result.sources.map((source) => [source.scope, source.content])).toEqual([
      ['.', 'root agents'],
      ['packages', 'package override'],
      ['packages\\feature', 'feature claude'],
    ])
  })

  test('执行 UTF-8 fatal 校验并限制总预算', async () => {
    const root = await temporaryDirectory()
    await writeFile(join(root, 'AGENTS.md'), '你好世界', 'utf8')
    const result = await new InstructionDiscoveryService().discover(root, root, { budgetBytes: 7 })
    expect(result.totalBytes).toBeLessThanOrEqual(7)
    expect(result.sources[0]?.content).toBe('你好')
    expect(result.truncated).toBe(true)
    await writeFile(join(root, 'AGENTS.md'), Uint8Array.from([0xc3, 0x28]))
    await expect(new InstructionDiscoveryService().discover(root)).rejects.toThrow()
  })
})

describe('能力目录', () => {
  const summary = (name: string, description: string, source?: string) => ({
    name,
    description,
    ...(source ? { source } : {}),
  })

  test('标明 MCP 来源、限制单条描述长度并给出分页发现提示', () => {
    const section = buildCapabilityCatalogSection([
      summary('mcp_report', '生成 MCP 报告', 'mcp:demo-server'),
      summary('long_entry', 'x'.repeat(400)),
    ])
    expect(section.id).toBe('capabilities.catalog')
    expect(section.content).toContain('- mcp_report: 生成 MCP 报告 [mcp:demo-server]')
    const rendered = section.content.split('\n').find((line) => line.startsWith('- long_entry'))!
    expect(rendered.length).toBeLessThan(CAPABILITY_DESCRIPTION_MAX_CHARS + 20)
    expect(rendered).toContain('…')
    expect(section.content).toContain('offset')
    expect(section.content).toContain('不是本轮全部工具')
  })

  test('超出总预算时明确说明还有未展示能力', () => {
    const section = buildCapabilityCatalogSection(
      Array.from({ length: 200 }, (_, index) => summary(`tool_${index}`, '描述'.repeat(60))),
    )
    expect(section.content.length).toBeLessThanOrEqual(CAPABILITY_CATALOG_MAX_CHARS)
    expect(section.content).toContain('还有')
    expect(section.content).toContain('ToolSearch')
    expect(section.content).not.toContain('- tool_199')
  })

  test('没有可发现能力时给出空目录而不是省略说明', () => {
    expect(buildCapabilityCatalogSection([]).content).toContain('当前没有可发现的延迟工具')
  })
})

describe('Skills catalog', () => {
  const writeSkill = async (
    base: string,
    compatibility: string,
    directory: string,
    document: string,
  ) => {
    const root = join(base, compatibility, 'skills', directory)
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'SKILL.md'), document, 'utf8')
    return root
  }

  test('多选优先、文本提及去重、代码示例不触发，身份失效不退回同名项', async () => {
    const root = await temporaryDirectory()
    await writeSkill(
      root,
      '.agents',
      'review',
      '---\nname: review\ndescription: review changes\n---\nreview body',
    )
    await writeSkill(
      root,
      '.agents',
      'plan',
      '---\nname: plan\ndescription: plan changes\ndisable-model-invocation: true\n---\nplan body',
    )
    const service = new SkillService()
    const { skills } = await service.scan({ workspaceRoot: root, dataRoot: root, userHome: root })
    const plan = skills.find((skill) => skill.name === 'plan')!
    expect(
      service
        .resolveInvocations('先 $review，再 $plan 和 $review', [
          { name: plan.name, path: plan.path },
        ])
        .map((skill) => skill.name),
    ).toEqual(['plan', 'review'])
    expect(service.resolveInvocations('`$review`\n```ts\n$plan\n```\n$unknown')).toEqual([])
    expect(service.resolveInvocations('$plan').map((skill) => skill.name)).toEqual(['plan'])
    expect(() =>
      service.resolveInvocations('$plan', [{ name: 'plan', path: 'other/SKILL.md' }]),
    ).toThrow('所选 Skill')
    const catalog = createPromptSections({
      mode: 'chat',
      profile: 'main',
      permissionInstructions: 'read-only',
      skills,
      userMessage: 'hello',
    }).find((section) => section.id === 'skills.catalog')!.content
    expect(catalog).toContain('use Read')
    expect(catalog).toContain(
      skills.find((skill) => skill.name === 'review')!.documentPath.replaceAll('\\', '\\\\'),
    )
    expect(catalog).not.toContain('$plan:')
    const loaded = await service.invocationData('$review')
    expect(loaded[0]).toContain('review body')
    const explicit = await service.invocationData('你好', [{ name: plan.name, path: plan.path }])
    expect(explicit[0]).toContain('plan body')
    await writeFile(
      skills.find((skill) => skill.name === 'review')!.documentPath,
      'changed',
      'utf8',
    )
    await expect(service.read('review')).rejects.toThrow('Skill 内容已变化')
  })

  test('workspace 和原生目录优先，并可按需读取正文', async () => {
    const workspace = await temporaryDirectory()
    const user = await temporaryDirectory()
    await writeSkill(user, '', 'deploy', '---\nname: deploy\ndescription: user native\n---\nuser')
    await writeSkill(
      workspace,
      '.claude',
      'deploy',
      '---\nname: deploy\ndescription: workspace compatible\n---\nworkspace',
    )
    await writeSkill(
      workspace,
      '.pidex',
      'deploy-native',
      '---\nname: deploy\ndescription: >-\n  workspace\n  native\nmetadata:\n  category: release\n---\nnative',
    )

    const service = new SkillService()
    const catalog = await service.scan({ workspaceRoot: workspace, dataRoot: user, userHome: user })
    expect(catalog.skills).toHaveLength(1)
    expect(catalog.skills[0]?.description).toBe('workspace native')
    expect(catalog.shadowed).toHaveLength(2)
    expect((await service.read('deploy')).body.trim()).toBe('native')
    expect(service.resolveInvocation('/deploy now')?.name).toBe('deploy')
    expect(service.resolveInvocation('$deploy')?.name).toBe('deploy')
    expect(service.resolveInvocation('please deploy')).toBeNull()
  })

  test('内置 Skill 使用稳定身份，且优先级低于工作区和用户 Skill', async () => {
    const workspace = await temporaryDirectory()
    const user = await temporaryDirectory()
    const builtin = await temporaryDirectory()
    const builtinRoot = join(builtin, 'builtin-helper')
    await mkdir(builtinRoot, { recursive: true })
    await writeFile(
      join(builtinRoot, 'SKILL.md'),
      [
        '---',
        'name: builtin-helper',
        'description: builtin planner',
        'allowed-tools:',
        '  - request_user_input',
        '  - taskboard_create',
        '---',
        'builtin body',
      ].join('\n'),
      'utf8',
    )
    await writeSkill(
      user,
      '.agents',
      'builtin-helper',
      '---\nname: builtin-helper\ndescription: user planner\n---\nuser body',
    )

    const userService = new SkillService()
    const userCatalog = await userService.scan({
      workspaceRoot: workspace,
      dataRoot: user,
      userHome: user,
      builtinSkillsRoot: builtin,
    })
    expect(userCatalog.skills).toMatchObject([
      {
        name: 'builtin-helper',
        origin: 'user',
        description: 'user planner',
      },
    ])
    expect(userCatalog.shadowed).toContainEqual(
      expect.objectContaining({
        name: 'builtin-helper',
        ignoredPath: 'builtin://builtin-helper/SKILL.md',
      }),
    )

    await writeSkill(
      workspace,
      '.pidex',
      'builtin-helper',
      '---\nname: builtin-helper\ndescription: workspace planner\n---\nworkspace body',
    )
    const workspaceService = new SkillService()
    const workspaceCatalog = await workspaceService.scan({
      workspaceRoot: workspace,
      dataRoot: user,
      userHome: user,
      builtinSkillsRoot: builtin,
    })
    expect(workspaceCatalog.skills[0]).toMatchObject({
      name: 'builtin-helper',
      origin: 'workspace',
      description: 'workspace planner',
    })

    const builtinOnly = new SkillService()
    const builtinCatalog = await builtinOnly.scan({
      workspaceRoot: await temporaryDirectory(),
      dataRoot: await temporaryDirectory(),
      userHome: await temporaryDirectory(),
      builtinSkillsRoot: builtin,
    })
    expect(builtinCatalog.skills[0]).toMatchObject({
      name: 'builtin-helper',
      path: 'builtin://builtin-helper/SKILL.md',
      origin: 'builtin',
      allowedTools: ['request_user_input', 'taskboard_create'],
    })
    expect((await builtinOnly.read('builtin-helper')).body.trim()).toBe('builtin body')
  })

  test('使用 YAML 解析复杂 frontmatter 并读取 allowedTools ceiling', async () => {
    const workspace = await temporaryDirectory()
    const user = await temporaryDirectory()
    await writeSkill(
      workspace,
      '.pidex',
      'audit',
      [
        '---',
        'name: audit',
        'description: |',
        '  first line',
        '  second line',
        'allowedTools:',
        '  - Read',
        '  - workspace_search',
        'metadata:',
        '  nested: true',
        '---',
        'body',
      ].join('\n'),
    )
    const service = new SkillService()
    const catalog = await service.scan({ workspaceRoot: workspace, dataRoot: user, userHome: user })
    expect(catalog.skills[0]?.description).toBe('first line\nsecond line\n')
    expect(catalog.skills[0]?.metadata.metadata).toEqual({ nested: true })
    expect(service.allowedTools('audit')).toEqual(['Read', 'workspace_search'])
  })

  test('安全去重指向另一个已配置技能根的 Junction 别名', async () => {
    const workspace = await temporaryDirectory()
    const user = await temporaryDirectory()
    const source = await writeSkill(
      user,
      '.agents',
      'shared',
      '---\nname: shared\ndescription: shared skill\n---\nbody',
    )
    const aliasRoot = join(user, '.claude', 'skills')
    await mkdir(aliasRoot, { recursive: true })
    await symlink(source, join(aliasRoot, 'shared'), 'junction')

    const service = new SkillService()
    const catalog = await service.scan({ workspaceRoot: workspace, dataRoot: user, userHome: user })

    expect(
      catalog.skills.map((skill) => ({
        name: skill.name,
        origin: skill.origin,
        format: skill.format,
      })),
    ).toEqual([
      {
        name: 'shared',
        origin: 'user',
        format: 'agents',
      },
    ])
    expect(catalog.shadowed).toEqual([])
  })

  test('拒绝指向所有已配置技能根之外的 Junction', async () => {
    const workspace = await temporaryDirectory()
    const user = await temporaryDirectory()
    const outside = await temporaryDirectory()
    const source = await writeSkill(outside, '', 'escape', '---\nname: escape\n---\nbody')
    const aliasRoot = join(user, '.claude', 'skills')
    await mkdir(aliasRoot, { recursive: true })
    await symlink(source, join(aliasRoot, 'escape'), 'junction')

    await expect(
      new SkillService().scan({
        workspaceRoot: workspace,
        dataRoot: user,
        userHome: user,
      }),
    ).rejects.toThrow('Skill 目录逃出 Skills 根')
  })

  test('相对资源被限制在 Skill 根目录内', async () => {
    const workspace = await temporaryDirectory()
    const user = await temporaryDirectory()
    const root = await writeSkill(workspace, '.pidex', 'safe', '---\nname: safe\n---\nbody')
    await writeFile(join(root, 'reference.txt'), 'ok', 'utf8')
    const service = new SkillService()
    await service.scan({ workspaceRoot: workspace, dataRoot: user, userHome: user })
    expect(await service.resolveResource('safe', 'reference.txt')).toBe(join(root, 'reference.txt'))
    await expect(service.resolveResource('safe', '../SKILL.md')).rejects.toThrow('逃出')
  })

  test('拒绝通过链接逃出 Skill 根', async () => {
    const workspace = await temporaryDirectory()
    const user = await temporaryDirectory()
    const outside = await temporaryDirectory()
    const root = await writeSkill(workspace, '.pidex', 'safe', '---\nname: safe\n---\nbody')
    await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8')
    await symlink(outside, join(root, 'outside'), 'junction')
    const service = new SkillService()
    await service.scan({ workspaceRoot: workspace, dataRoot: user, userHome: user })
    await expect(service.resolveResource('safe', 'outside/secret.txt')).rejects.toThrow('链接逃出')
  })
})

describe('PromptComposer', () => {
  test('安全前缀不可被 systemPrompt 替换，项目内容只进入 contextual-user', () => {
    const sections = createPromptSections({
      permissionInstructions: 'resolved permission',
      mode: 'chat',
      profile: 'main',
      toolGuidance: [
        { name: 'shell', content: 'shell guidance' },
        { name: 'hidden', content: 'hidden guidance' },
      ],
      systemPrompt: 'custom working style',
      projectInstructions: [
        {
          path: 'F:\\repo\\AGENTS.md',
          scope: '.',
          content: 'project evidence',
          hash: 'x',
          bytes: 16,
          truncated: false,
        },
      ],
      userMessage: 'do work',
    })
    const bundle = new PromptComposer().compose({
      threadID: 'thread-1',
      mode: 'chat',
      profile: 'main',
      exposedTools: ['shell'],
      sections,
    })
    expect(bundle.instructions).toContain('Pidex')
    expect(bundle.instructions).toContain('resolved permission')
    expect(bundle.instructions).toContain('custom working style')
    expect(bundle.instructions).toContain('shell guidance')
    expect(bundle.instructions).not.toContain('hidden guidance')
    expect(bundle.instructions).not.toContain('project evidence')
    expect(JSON.stringify(bundle.contextItems)).toContain('project evidence')
    expect(bundle.cacheKey).toMatch(/^cpx_[a-f0-9]{60}$/)
    expect(bundle.cacheKey).not.toContain('thread-1')
    expect(bundle.stableContextText).toContain('project evidence')
    expect(bundle.stableContextText).not.toContain('do work')
    expect(bundle.diagnostics.find((item) => item.id === 'tool.hidden')?.reason).toBe(
      'required-tools',
    )
    expect(
      bundle.cacheSegments
        .filter((segment) => segment.role === 'context')
        .map((segment) => segment.cacheable),
    ).toEqual([true, false])
    expect(bundle.cacheBoundaries.map((boundary) => boundary.cache)).toEqual([
      'global-stable',
      'session-stable',
    ])
    expect(bundle.cacheHash).toHaveLength(64)
  })

  test('稳定 contextual 总是在动态内容之前，且只随稳定内容变化', () => {
    const compose = (threadID: string, project: string, userMessage: string) =>
      new PromptComposer().compose({
        threadID,
        mode: 'chat',
        profile: 'main',
        exposedTools: [],
        sections: createPromptSections({
          permissionInstructions: 'resolved',
          mode: 'chat',
          profile: 'main',
          environment: 'dynamic environment',
          projectInstructions: [
            {
              path: 'F:\\repo\\AGENTS.md',
              scope: '.',
              content: project,
              hash: 'x',
              bytes: project.length,
              truncated: false,
            },
          ],
          stableExternalData: ['stable project catalog'],
          externalData: ['dynamic hook output'],
          userMessage,
        }),
      })
    const first = compose('thread-1', 'project v1', 'turn one')
    const nextTurn = compose('thread-1', 'project v1', 'turn two')
    const changedProject = compose('thread-1', 'project v2', 'turn two')
    const otherThread = compose('thread-2', 'project v1', 'turn one')

    expect(first.contextItems.map((item) => item.content[0]!.text)).toEqual([
      expect.stringContaining('project v1'),
      expect.stringContaining('stable project catalog'),
      expect.stringContaining('dynamic environment'),
      expect.stringContaining('dynamic hook output'),
      expect.stringContaining('turn one'),
    ])
    expect(nextTurn.stableContextText).toBe(first.stableContextText)
    expect(changedProject.stableContextText).not.toBe(first.stableContextText)
    expect(nextTurn.cacheKey).toBe(first.cacheKey)
    expect(otherThread.cacheKey).not.toBe(first.cacheKey)
  })

  test('按 provider 推导缓存能力', () => {
    expect(inferPromptCacheCapability('openai.responses').strategy).toBe('prompt-cache-key')
    expect(inferPromptCacheCapability('anthropic.messages').strategy).toBe('explicit-ephemeral')
    expect(inferPromptCacheCapability('openai-compatible.chat').strategy).toBe('stable-prefix')
  })
})

describe('Prompt cache runtime policy', () => {
  const model = (
    overrides: Partial<{
      provider: string
      api: string
      id: string
      baseUrl: string
      compat: unknown
    }> = {},
  ) => ({
    provider: 'openai',
    api: 'openai-responses',
    id: 'gpt-5.6-sol',
    baseUrl: 'https://api.openai.com/v1',
    compat: { supportsExplicitPromptCacheMode: true },
    ...overrides,
  })

  test('仅以官方 OpenAI endpoint 和 capability flag 启用显式模式', () => {
    expect(inferPromptCacheRuntimePolicy(model(), 'cache-key')).toEqual({
      strategy: 'openai-explicit',
      cacheRetention: 'short',
      cacheKey: 'cache-key',
    })
    expect(
      inferPromptCacheRuntimePolicy(
        model({
          id: 'gpt-5.5',
          compat: {},
        }),
        'cache-key',
      ).strategy,
    ).toBe('openai-automatic')
    expect(
      inferPromptCacheRuntimePolicy(
        model({
          baseUrl: 'https://openai-compatible.example/v1',
        }),
        'cache-key',
      ),
    ).toEqual({
      strategy: 'upstream-managed',
      cacheRetention: 'short',
    })
  })

  test('仅 MiniMax M3 和 Kimi Coding 官方 Anthropic endpoint 禁用主动 marker', () => {
    const policy = (overrides: Parameters<typeof model>[0]) =>
      inferPromptCacheRuntimePolicy(model(overrides), 'cache-key')
    expect(
      policy({
        provider: 'minimax',
        api: 'anthropic-messages',
        id: 'MiniMax-M3',
        baseUrl: 'https://api.minimax.io/anthropic',
      }).cacheRetention,
    ).toBe('none')
    expect(
      policy({
        provider: 'minimax-cn',
        api: 'anthropic-messages',
        id: 'MiniMax-M2.7',
        baseUrl: 'https://api.minimaxi.com/anthropic',
      }).cacheRetention,
    ).toBe('short')
    expect(
      policy({
        provider: 'kimi-coding',
        api: 'anthropic-messages',
        id: 'kimi-for-coding',
        baseUrl: 'https://api.kimi.com/coding',
      }).cacheRetention,
    ).toBe('none')
    expect(
      policy({
        provider: 'anthropic',
        api: 'anthropic-messages',
        id: 'claude',
        baseUrl: 'https://api.anthropic.com',
      }).cacheRetention,
    ).toBe('short')
    expect(
      policy({
        provider: 'deepseek',
        api: 'openai-completions',
        id: 'deepseek-chat',
        baseUrl: 'https://api.deepseek.com',
      }).cacheRetention,
    ).toBe('short')
  })

  test('自动缓存供应商不进入 OpenAI 本地适配', () => {
    const providers = [
      {
        provider: 'deepseek',
        api: 'openai-completions',
        id: 'deepseek-chat',
        baseUrl: 'https://api.deepseek.com',
      },
      {
        provider: 'zhipuai',
        api: 'openai-completions',
        id: 'glm-5',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      },
      {
        provider: 'xiaomi',
        api: 'openai-completions',
        id: 'mimo-v2.5',
        baseUrl: 'https://api.xiaomimimo.com/v1',
      },
      {
        provider: 'moonshotai',
        api: 'openai-completions',
        id: 'kimi-k2.5',
        baseUrl: 'https://api.moonshot.cn/v1',
      },
    ]
    for (const providerModel of providers) {
      expect(inferPromptCacheRuntimePolicy(model(providerModel), 'cache-key')).toEqual({
        strategy: 'upstream-managed',
        cacheRetention: 'short',
      })
    }
  })

  test('OpenAI Responses 显式模式写入单断点且保持原 payload 不变', () => {
    const stableContextText = '<context_data>stable</context_data>'
    const payload = {
      model: 'gpt-5.6-sol',
      input: [
        { role: 'developer', content: 'system instructions' },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `${stableContextText}\n\ndynamic turn`,
              businessField: 'preserved',
            },
          ],
        },
      ],
      prompt_cache_key: 'raw-session-id',
      prompt_cache_retention: '24h',
      businessField: { nested: true },
    }
    const original = structuredClone(payload)
    const result = applyPromptCacheRuntimePolicy(
      payload,
      {
        strategy: 'openai-explicit',
        cacheRetention: 'short',
        cacheKey: 'cpx_opaque',
      },
      stableContextText,
    )
    const applied = result.payload as Record<string, unknown>

    expect(payload).toEqual(original)
    expect(applied.prompt_cache_key).toBe('cpx_opaque')
    expect(applied.prompt_cache_retention).toBeUndefined()
    expect(applied.prompt_cache_options).toEqual({ mode: 'explicit', ttl: '30m' })
    expect(JSON.stringify(applied).match(/prompt_cache_breakpoint/g)).toHaveLength(1)
    expect(JSON.stringify(applied)).toContain('businessField')
    expect(result.appliedBreakpoints).toBe(1)

    const toolLoop = applyPromptCacheRuntimePolicy(
      {
        ...payload,
        input: [
          ...payload.input,
          { role: 'assistant', content: [{ type: 'input_text', text: 'tool call' }] },
          { role: 'tool', content: [{ type: 'input_text', text: 'tool result' }] },
        ],
      },
      {
        strategy: 'openai-explicit',
        cacheRetention: 'short',
        cacheKey: 'cpx_opaque',
      },
      stableContextText,
    )
    expect(JSON.stringify(toolLoop.payload).match(/prompt_cache_breakpoint/g)).toHaveLength(1)
    expect(JSON.stringify(toolLoop.payload).indexOf('prompt_cache_breakpoint')).toBeLessThan(
      JSON.stringify(toolLoop.payload).indexOf('tool call'),
    )
  })

  test('OpenAI Chat 在无稳定 contextual 时标记 system，无法标记时回退 implicit', () => {
    const policy = {
      strategy: 'openai-explicit' as const,
      cacheRetention: 'short' as const,
      cacheKey: 'cpx_opaque',
    }
    const chat = applyPromptCacheRuntimePolicy(
      {
        messages: [
          { role: 'system', content: 'system instructions' },
          { role: 'user', content: 'dynamic turn' },
        ],
        prompt_cache_retention: '24h',
      },
      policy,
      '',
    )
    expect((chat.payload as Record<string, unknown>).prompt_cache_options).toEqual({
      mode: 'explicit',
      ttl: '30m',
    })
    expect(JSON.stringify(chat.payload).match(/prompt_cache_breakpoint/g)).toHaveLength(1)

    const fallback = applyPromptCacheRuntimePolicy(
      {
        messages: [{ role: 'user', content: 'dynamic turn' }],
        prompt_cache_retention: '24h',
        prompt_cache_options: { mode: 'explicit' },
      },
      policy,
      'missing stable prefix',
    )
    expect((fallback.payload as Record<string, unknown>).prompt_cache_key).toBe('cpx_opaque')
    expect((fallback.payload as Record<string, unknown>).prompt_cache_retention).toBeUndefined()
    expect((fallback.payload as Record<string, unknown>).prompt_cache_options).toBeUndefined()
    expect(fallback.appliedBreakpoints).toBe(0)
  })

  test('旧 OpenAI 只覆盖 opaque key，非 OpenAI payload 完全 no-op', () => {
    const automaticPayload = {
      messages: [{ role: 'user', content: 'hello' }],
      prompt_cache_key: 'raw-session',
      prompt_cache_retention: '24h',
    }
    const automatic = applyPromptCacheRuntimePolicy(
      automaticPayload,
      {
        strategy: 'openai-automatic',
        cacheRetention: 'short',
        cacheKey: 'cpx_opaque',
      },
      '',
    )
    expect(automatic.payload).toEqual({
      ...automaticPayload,
      prompt_cache_key: 'cpx_opaque',
    })
    expect(automaticPayload.prompt_cache_key).toBe('raw-session')

    const upstreamPayload = {
      messages: [{ role: 'user', content: 'hello' }],
      cache_control: { type: 'ephemeral' },
    }
    const upstream = applyPromptCacheRuntimePolicy(
      upstreamPayload,
      { strategy: 'upstream-managed', cacheRetention: 'short' },
      '',
    )
    expect(upstream.payload).toBe(upstreamPayload)
  })
})

describe('电脑控制提示', () => {
  const compose = (state: { enabled(): boolean; available(): boolean } | undefined) =>
    new PromptComposer().compose({
      threadID: 'thread-computer',
      mode: 'chat',
      profile: 'main',
      exposedTools: [],
      sections: createPromptSections({
        permissionInstructions: 'resolved permission',
        mode: 'chat',
        profile: 'main',
        ...(state ? { computerControl: state } : {}),
        userMessage: 'work',
      }),
    }).instructions

  test('就绪时告知能力与延迟工具入口', () => {
    const instructions = compose({ enabled: () => true, available: () => true })
    expect(instructions).toContain('本机电脑控制已就绪')
    expect(instructions).toContain('ToolSearch')
    expect(instructions).toContain('ComputerApps')
    expect(instructions).toContain('Read')
    expect(instructions).toContain('computer-use SKILL.md')
    expect(instructions).toContain('插件启用不改变应用授权与工具权限')
    expect(instructions).not.toContain('未开启')
  })

  test('已开启但运行时未连接时指出需要重启桌面应用', () => {
    const instructions = compose({ enabled: () => true, available: () => false })
    expect(instructions).toContain('原生运行时尚未连接')
    expect(instructions).toContain('重启 Pidex 桌面应用')
    expect(instructions).not.toContain('本机电脑控制已就绪')
  })

  test('未开启时告诉模型入口而不是否认能力', () => {
    const instructions = compose({ enabled: () => false, available: () => false })
    expect(instructions).toContain('当前未开启')
    expect(instructions).toContain('设置 → 集成 → 电脑控制')
    expect(instructions).toContain('不要回答本机不具备该能力')
  })

  test('没有电脑控制服务时不注入该提示', () => {
    expect(compose(undefined)).not.toContain('电脑控制')
  })
})

describe('协作模式提示', () => {
  const mode = (taskMode: 'chat' | 'plan' | 'grill'): string =>
    createPromptSections({
      permissionInstructions: '',
      mode: taskMode,
      profile: 'main',
      userMessage: '你好',
    }).find((section) => section.id === `mode.${taskMode}`)!.content

  test('Grill 模式要求设计树、暂定假设与无默认出口门禁', () => {
    expect(mode('grill')).toContain('设计树')
    expect(mode('grill')).toContain('概念层 Frontier')
    expect(mode('grill')).toContain('[依赖暂定假设')
    expect(mode('grill')).toContain('需求共识清单')
    expect(mode('grill')).toContain('三个选项都不得标记 recommended')
    expect(mode('grill')).toContain('不设置 autoResolutionMs')
    expect(mode('grill')).toContain('这两个出口都只确认需求，不是实施授权')
    expect(mode('grill')).toContain('不要仅凭延迟目录或历史会话')
  })

  test('Plan 模式选项与题数上限与工具契约一致', () => {
    expect(mode('plan')).toContain('最多五题')
    expect(mode('plan')).toContain('选项二至五个')
    expect(mode('plan')).toContain('multiSelect')
  })
})
