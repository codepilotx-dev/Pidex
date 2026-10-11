import { describe, expect, test } from 'bun:test'
import { loadCachedRuntimeSkills } from '../src/features/session/composer/DesktopComposer.js'
import {
  getActiveComposerMention,
  resolveComposerSubmitIntent,
  shouldSubmitComposerKey,
} from '../src/features/session/composer/ComposerCard.js'
import {
  filterComposerCommands,
  getActiveSlashCommandQuery,
  getActiveSkillTokenQuery,
  mergeSlashCommands,
  parseSlashInvocation,
  skillToComposerCommand,
  type ComposerSlashCommand,
} from '../src/features/session/composer/ComposerSlashCommands.js'
import {
  removeGeneratedSuggestionStarter,
  selectNewSessionSuggestionCategory,
  showContextualNewSessionSuggestions,
  showNewSessionSuggestionTemplates,
  syncNewSessionSuggestionState,
} from '../src/features/session/NewSessionSuggestionState.js'
import { buildContextualTaskSuggestions } from '../src/features/session/NewSessionSuggestions.js'
import {
  normalizeGeneratedSuggestionsForSurface,
  sanitizeTaskSuggestionContextText,
  shouldApplyGeneratedSuggestions,
} from '../src/features/session/UseContextualTaskSuggestions.js'
import {
  buildWorkingContextualTaskSuggestions,
  createWorkingSuggestionState,
  returnToWorkingSuggestionRoot,
  selectWorkingSuggestionCategory,
  selectWorkingSuggestionTask,
  shouldShowWorkingSuggestions,
  syncWorkingSuggestionState,
  WORKING_SUGGESTION_CATEGORIES,
} from '../src/features/session/WorkingSuggestions.js'

describe('composer suggestions', () => {
  test('技能刷新不复用旧请求，晚到的目录不会覆盖新缓存', async () => {
    const workspace = `race-${crypto.randomUUID()}`
    const resolvers: Array<(skills: ReturnType<typeof installedSkill>[]) => void> = []
    const loader = () =>
      new Promise<ReturnType<typeof installedSkill>[]>((resolve) => {
        resolvers.push(resolve)
      })
    const old = loadCachedRuntimeSkills(workspace, false, loader)
    const fresh = loadCachedRuntimeSkills(workspace, true, loader)
    resolvers[1]!([installedSkill('fresh')])
    await fresh
    resolvers[0]!([installedSkill('old')])
    await old
    expect(
      (await loadCachedRuntimeSkills(workspace, false, loader)).map((skill) => skill.name),
    ).toEqual(['fresh'])
  })
  test('loads enabled runtime skills once per workspace and refreshes on demand', async () => {
    let calls = 0
    const loader = async () => {
      calls += 1
      return [installedSkill('review'), { ...installedSkill('disabled'), enabled: false }]
    }
    const workspace = `workspace-${crypto.randomUUID()}`

    const [first, second] = await Promise.all([
      loadCachedRuntimeSkills(workspace, false, loader),
      loadCachedRuntimeSkills(workspace, false, loader),
    ])

    expect(calls).toBe(1)
    expect(second).toEqual(first)
    expect(first.map((skill) => skill.name)).toEqual(['review'])

    await loadCachedRuntimeSkills(workspace, true, loader)
    expect(calls).toBe(2)
  })

  test('merges available commands with skills and keeps builtins on trigger collisions', () => {
    const builtins = [
      builtin('model', '模型', '选择模型'),
      builtin('status', '状态', '显示上下文用量'),
    ]
    const skills = [
      skillToComposerCommand(installedSkill('model')),
      skillToComposerCommand(installedSkill('review')),
    ]

    const merged = mergeSlashCommands(builtins, skills)
    expect(merged.map((command) => command.id)).toEqual(['model', 'status', 'skill:review'])
    expect(filterComposerCommands(merged, '上下文').map((item) => item.id)).toEqual(['status'])
  })

  test('keeps temporarily disabled commands and hides commands outside the environment', () => {
    const disabled = builtin('compact', '压缩', '压缩上下文', false)
    const hidden = {
      ...builtin('side', '侧边聊天', '打开侧边聊天'),
      availability: { visible: false, enabled: true },
    }
    expect(mergeSlashCommands([disabled, hidden], []).map((item) => item.id)).toEqual(['compact'])
  })

  test('detects a slash command query at the cursor without replacing the draft', () => {
    expect(getActiveSlashCommandQuery('继续处理 /rev 后续', 9)).toEqual({
      start: 5,
      end: 9,
      query: 'rev',
    })
    expect(getActiveSlashCommandQuery('https://example.com', 8)).toBeNull()
  })

  test('parses only exact registered slash commands', async () => {
    let executions = 0
    const status = builtin('status', '状态', '显示状态', true, () => {
      executions += 1
    })
    const compact = builtin(
      'compact',
      '压缩',
      '压缩上下文',
      false,
      () => {},
      '任务运行期间不能压缩上下文',
    )

    const parsed = parseSlashInvocation('/status', [status, compact])
    expect(parsed.kind).toBe('builtin')
    if (parsed.kind === 'builtin') await parsed.command.execute()
    expect(executions).toBe(1)
    expect(parseSlashInvocation('/status abc', [status]).kind).toBe('unknown')
    expect(parseSlashInvocation('/foo', [status]).kind).toBe('unknown')
    expect(parseSlashInvocation('/compact', [compact])).toMatchObject({
      kind: 'disabled',
      reason: '任务运行期间不能压缩上下文',
    })
  })

  test('detects the skill token under the cursor', () => {
    expect(getActiveSkillTokenQuery('请用 $review', 10)).toEqual({
      start: 3,
      end: 10,
      query: 'review',
    })
    expect(getActiveSkillTokenQuery('$review 后续', 7)).toEqual({
      start: 0,
      end: 7,
      query: 'review',
    })
    expect(getActiveSkillTokenQuery('价格$review', 9)).toBeNull()
  })

  test('recognizes only the mention under the cursor', () => {
    expect(getActiveComposerMention('检查 @review', 10)).toEqual({
      start: 3,
      end: 10,
      query: 'review',
    })
    expect(getActiveComposerMention('检查 @review-more', 10)).toBeNull()
    expect(getActiveComposerMention('email@example.com', 9)).toBeNull()
  })

  test('keeps category suggestions while editing and only removes generated starter text', () => {
    const category = selectNewSessionSuggestionCategory('codex-explore')
    expect(syncNewSessionSuggestionState(category, '继续补充细节')).toEqual(category)
    expect(removeGeneratedSuggestionStarter('Explore repository tests', 'Explore ')).toBe(
      'repository tests',
    )
    expect(removeGeneratedSuggestionStarter('用户自己的内容', 'Explore ')).toBe('用户自己的内容')
  })

  test('prioritizes unfinished work and git context before static fallbacks', () => {
    const suggestions = buildContextualTaskSuggestions({
      recentTasks: [
        {
          id: 'thread:failed',
          title: '修复登录失败',
          firstPrompt: '修复登录页失败',
          status: 'error',
          updatedAt: 2,
        },
        {
          id: 'thread:done',
          title: '构建设置页',
          firstPrompt: 'Build settings',
          status: 'done',
          updatedAt: 1,
        },
      ],
      git: {
        clean: false,
        ahead: 1,
        behind: 2,
        totalFiles: 3,
        files: [],
      },
    })

    expect(suggestions).toHaveLength(4)
    expect(suggestions.map((item) => item.id)).toEqual([
      'recent-unfinished:thread:failed',
      'git:working-tree',
      'git:behind',
      'git:ahead',
    ])
    expect(new Set(suggestions.map((item) => item.prompt)).size).toBe(4)
  })

  test('fills contextual suggestions with the four stable task categories', () => {
    const suggestions = buildContextualTaskSuggestions({
      recentTasks: [],
      git: null,
    })
    expect(suggestions).toHaveLength(4)
    expect(new Set(suggestions.map((item) => item.categoryId))).toEqual(
      new Set(['codex-explore', 'codex-create', 'codex-review', 'codex-fix']),
    )
  })

  test('uses generic prompts without assuming repository when hasWorkspace is false', () => {
    const suggestions = buildContextualTaskSuggestions({
      recentTasks: [],
      git: null,
      hasWorkspace: false,
    })
    expect(suggestions).toHaveLength(4)
    expect(suggestions.every((item) => !item.prompt.includes('this codebase'))).toBe(true)
  })

  test('builds three Working suggestions from unfinished, Git, and completed work', () => {
    const suggestions = buildWorkingContextualTaskSuggestions({
      workspaceName: 'Pidex',
      recentTasks: [
        {
          id: 'thread:failed',
          title: '整理发布说明',
          firstPrompt: '补齐本周发布说明',
          status: 'interrupted',
          updatedAt: 3,
        },
        {
          id: 'thread:done',
          title: '自动生成周报',
          firstPrompt: 'Automate weekly report',
          status: 'done',
          updatedAt: 2,
        },
      ],
      git: {
        clean: false,
        ahead: 0,
        behind: 0,
        totalFiles: 6,
        files: [],
      },
    })

    expect(suggestions).toHaveLength(3)
    expect(suggestions.map((item) => item.id)).toEqual([
      'working-recent-unfinished:thread:failed',
      'working-git:working-tree',
      'working-recent-completed:thread:done',
    ])
    expect(suggestions[2]?.categoryId).toBe('automate')
  })

  test('keeps three project-specific Working fallbacks without context', () => {
    const suggestions = buildWorkingContextualTaskSuggestions({
      workspaceName: '演示项目',
      recentTasks: [],
      git: null,
    })

    expect(suggestions).toHaveLength(3)
    expect(suggestions.map((item) => item.categoryId)).toEqual(['create', 'research', 'automate'])
    expect(suggestions.every((item) => item.label.includes('演示项目'))).toBeTrue()
  })

  test('accepts only the generated categories and count for each surface', () => {
    const working = [
      generatedSuggestion('create', '创建交付物'),
      generatedSuggestion('research', '规划下一步'),
      generatedSuggestion('automate', '自动生成周报'),
    ]
    expect(normalizeGeneratedSuggestionsForSurface(working, 'working')).toHaveLength(3)
    expect(normalizeGeneratedSuggestionsForSurface(working.slice(0, 2), 'working')).toBeNull()
    expect(normalizeGeneratedSuggestionsForSurface(working, 'coding')).toBeNull()
  })

  test('removes absolute Windows paths before building suggestion context', () => {
    const sanitized = sanitizeTaskSuggestionContextText(
      '检查 C:\\Users\\XiaoHi\\repo\\secret.txt 和 \\\\server\\share\\plan.md',
      500,
    )
    expect(sanitized).toBe('检查 [路径] 和 [路径]')
    expect(sanitized).not.toContain('XiaoHi')
  })

  test('supports contextual, template, and category navigation states', () => {
    expect(showNewSessionSuggestionTemplates()).toEqual({ kind: 'templates' })
    expect(showContextualNewSessionSuggestions()).toEqual({ kind: 'root' })
    expect(selectNewSessionSuggestionCategory('codex-review')).toEqual({
      kind: 'category',
      categoryId: 'codex-review',
    })
  })

  test('rejects late AI suggestions after any request or user interaction change', () => {
    const baseline = {
      request: 2,
      currentRequest: 2,
      interactionVersion: 3,
      currentInteractionVersion: 3,
      active: true,
    }
    expect(shouldApplyGeneratedSuggestions(baseline)).toBe(true)
    expect(
      shouldApplyGeneratedSuggestions({
        ...baseline,
        currentInteractionVersion: 4,
      }),
    ).toBe(false)
    expect(
      shouldApplyGeneratedSuggestions({
        ...baseline,
        currentRequest: 3,
      }),
    ).toBe(false)
    expect(
      shouldApplyGeneratedSuggestions({
        ...baseline,
        active: false,
      }),
    ).toBe(false)
  })

  test('supports Enter and both Ctrl+Enter submission modes without breaking IME', () => {
    const event = {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      isComposing: false,
      keyCode: 13,
    }
    expect(shouldSubmitComposerKey(event, 'enter', '单行')).toBe(true)
    expect(shouldSubmitComposerKey(event, 'multiline-ctrl-enter', '一\n二')).toBe(false)
    expect(
      shouldSubmitComposerKey({ ...event, ctrlKey: true }, 'multiline-ctrl-enter', '一\n二'),
    ).toBe(true)
    expect(shouldSubmitComposerKey(event, 'ctrl-enter', '单行')).toBe(false)
    expect(shouldSubmitComposerKey({ ...event, isComposing: true }, 'enter', '输入中')).toBe(false)
    expect(resolveComposerSubmitIntent(event, 'enter', '单行')).toBe('default')
    expect(resolveComposerSubmitIntent({ ...event, ctrlKey: true }, 'enter', '下一轮')).toBe(
      'follow-up',
    )
    expect(
      resolveComposerSubmitIntent({ ...event, isComposing: true }, 'enter', '输入中'),
    ).toBeNull()
  })
})

describe('working suggestions', () => {
  const categoryState = selectWorkingSuggestionCategory('create', '创建')

  test('空输入进入第一层，键入内容隐藏建议', () => {
    expect(createWorkingSuggestionState('')).toEqual({ kind: 'root' })
    expect(createWorkingSuggestionState('  ')).toEqual({ kind: 'root' })
    expect(createWorkingSuggestionState('自定义输入')).toEqual({
      kind: 'hidden',
      reason: 'custom-input',
    })
  })

  test('第一层到第二层的状态转换并记录 starter', () => {
    expect(categoryState).toEqual({
      kind: 'category',
      categoryId: 'create',
      generatedStarter: '创建',
    })
    expect(syncWorkingSuggestionState(categoryState, '创建')).toEqual(categoryState)
    expect(syncWorkingSuggestionState(categoryState, '创建一个文档')).toEqual({
      kind: 'hidden',
      reason: 'custom-input',
    })
  })

  test('返回时只移除草稿开头的系统 starter，保留用户补写内容', () => {
    expect(returnToWorkingSuggestionRoot(categoryState, '创建')).toEqual({
      state: { kind: 'root' },
      composerValue: '',
    })
    expect(returnToWorkingSuggestionRoot(categoryState, '创建一个项目说明')).toEqual({
      state: { kind: 'root' },
      composerValue: '一个项目说明',
    })
    expect(returnToWorkingSuggestionRoot({ kind: 'root' }, '自定义')).toEqual({
      state: { kind: 'root' },
      composerValue: '自定义',
    })
  })

  test('使用三类 Codex Work 直接任务，不包含第三级插件占位符', () => {
    expect(
      WORKING_SUGGESTION_CATEGORIES.map((category) => ({
        id: category.id,
        label: category.label,
        starterPrompt: category.starterPrompt,
        taskCount: category.tasks.length,
      })),
    ).toEqual([
      {
        id: 'create',
        label: '创建文件或搭建网站',
        starterPrompt: '创建',
        taskCount: 4,
      },
      {
        id: 'research',
        label: '调研并规划后续步骤',
        starterPrompt: '确定下一步',
        taskCount: 4,
      },
      {
        id: 'automate',
        label: '自动处理日常和重复性工作',
        starterPrompt: '自动化',
        taskCount: 4,
      },
    ])
    const prompts = WORKING_SUGGESTION_CATEGORIES.flatMap((category) =>
      category.tasks.map((task) => task.prompt),
    )
    expect(prompts.some((prompt) => /\{(?:artifact|plugin)\}/.test(prompt))).toBeFalse()
  })

  test('每类最终建议映射直接提示词并选择规划任务插件', () => {
    expect(selectWorkingSuggestionTask(categoryState, 'new-chat-page-create-document')).toEqual({
      state: { kind: 'hidden', reason: 'prompt-filled' },
      prompt: '创建一个新文档。先问我它应该是什么主题。',
      plugin: null,
    })
    expect(
      selectWorkingSuggestionTask(
        selectWorkingSuggestionCategory('research', '确定下一步'),
        'new-chat-page-research-options-and-tradeoffs',
      )?.prompt,
    ).toBe('比较选项后确定下一步')
    expect(
      selectWorkingSuggestionTask(
        selectWorkingSuggestionCategory('automate', '自动化'),
        'new-chat-page-monitor-changes',
      )?.prompt,
    ).toBe('自动监控重要变更')
  })

  test('未知任务或非分类状态返回 null', () => {
    expect(selectWorkingSuggestionTask(categoryState, 'missing')).toBeNull()
    expect(
      selectWorkingSuggestionTask({ kind: 'root' }, 'new-chat-page-create-document'),
    ).toBeNull()
  })

  test('空草稿时默认显示建议，用户输入后隐藏，清空后恢复根分类', () => {
    expect(shouldShowWorkingSuggestions({ kind: 'root' })).toBeTrue()
    expect(shouldShowWorkingSuggestions(categoryState)).toBeTrue()
    const hidden = syncWorkingSuggestionState({ kind: 'root' }, '自定义')
    expect(shouldShowWorkingSuggestions(hidden)).toBeFalse()
    expect(syncWorkingSuggestionState(hidden, '')).toEqual({ kind: 'root' })
  })

  test('最终任务填充后隐藏建议，清空草稿时恢复', () => {
    const promptFilled = { kind: 'hidden', reason: 'prompt-filled' } as const
    expect(shouldShowWorkingSuggestions(promptFilled)).toBeFalse()
    expect(syncWorkingSuggestionState(promptFilled, '自动监控重要变更')).toEqual(promptFilled)
    expect(syncWorkingSuggestionState(promptFilled, '')).toEqual({ kind: 'root' })
  })
})

function installedSkill(name: string) {
  return {
    name,
    description: `${name} skill`,
    path: `F:\\skills\\${name}\\SKILL.md`,
    scope: 'repo' as const,
    source: 'workspace' as const,
    format: 'agents' as const,
    enabled: true,
  }
}

function generatedSuggestion(categoryId: 'create' | 'research' | 'automate', label: string) {
  return {
    id: `generated:${categoryId}`,
    categoryId,
    label,
    prompt: `${label}的完整提示词`,
  }
}

function builtin(
  id: ComposerSlashCommand['id'],
  title: string,
  description: string,
  enabled = true,
  execute: () => void | Promise<void> = () => {},
  disabledReason?: string,
): ComposerSlashCommand {
  return {
    id,
    trigger: id,
    title,
    description,
    source: 'builtin',
    availability: {
      visible: true,
      enabled,
      ...(disabledReason ? { disabledReason } : {}),
    },
    execute,
  }
}
