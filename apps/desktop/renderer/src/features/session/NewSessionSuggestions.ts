export type NewSessionSuggestionCategoryId =
  'codex-explore' | 'codex-create' | 'codex-review' | 'codex-fix'

export type WorkingContextualSuggestionCategoryId = 'create' | 'research' | 'automate'

export type ContextualTaskSuggestionSurface = 'coding' | 'working'

export type NewSessionSuggestionTone = 'blue' | 'purple' | 'green' | 'orange'

export type NewSessionSuggestionTask = {
  id: string
  label: string
  prompt: string
}

export type NewSessionTaskSuggestion = NewSessionSuggestionTask & {
  categoryId: NewSessionSuggestionCategoryId
}

export type WorkingContextualTaskSuggestion = NewSessionSuggestionTask & {
  categoryId: WorkingContextualSuggestionCategoryId
}

export type NewSessionRecentTask = {
  id: string
  title: string
  firstPrompt: string | null
  status: 'idle' | 'queued' | 'waiting' | 'running' | 'done' | 'error' | 'interrupted' | 'cancelled'
  updatedAt: number
}

export type NewSessionSuggestionGitContext = {
  clean: boolean
  ahead: number
  behind: number
  totalFiles: number
  files: Array<{
    path: string
    status: string
    stagedStatus: string
    unstagedStatus: string
  }>
}

export type NewSessionSuggestionCategory = {
  id: NewSessionSuggestionCategoryId
  label: string
  starter: string
  tone: NewSessionSuggestionTone
  tasks: readonly NewSessionSuggestionTask[]
}

export const NEW_SESSION_SUGGESTIONS = [
  {
    id: 'codex-explore',
    label: '探索并理解代码',
    starter: 'Explore ',
    tone: 'blue',
    tasks: [
      {
        id: 'explore-feature',
        label: '某项功能如何工作',
        prompt: 'Explore how a feature works in this codebase',
      },
      {
        id: 'explore-options',
        label: '比较几种实现方案',
        prompt: 'Explore implementation options for a change in this codebase',
      },
      {
        id: 'explore-architecture',
        label: '梳理架构权衡',
        prompt: 'Explore the architectural tradeoffs in this codebase',
      },
      {
        id: 'explore-api',
        label: '了解一个 API 并补充文档',
        prompt: 'Explore an API in this codebase and document how it works',
      },
    ],
  },
  {
    id: 'codex-create',
    label: '构建新功能、应用或工具',
    starter: 'Build ',
    tone: 'purple',
    tasks: [
      {
        id: 'create-feature',
        label: '构建一项新功能',
        prompt: 'Build a new feature in this codebase',
      },
      {
        id: 'create-ui',
        label: '实现一组界面改动',
        prompt: 'Build a set of UI changes in this codebase',
      },
      {
        id: 'create-prototype',
        label: '搭建一个可运行原型',
        prompt: 'Build a working prototype in this codebase',
      },
      {
        id: 'create-tool',
        label: '创建一个内部工具',
        prompt: 'Build an internal tool for this codebase',
      },
    ],
  },
  {
    id: 'codex-review',
    label: '审查代码并提出修改建议',
    starter: 'Review ',
    tone: 'green',
    tasks: [
      {
        id: 'review-changes',
        label: '审查当前改动',
        prompt: 'Review my current changes and suggest improvements',
      },
      {
        id: 'review-pr',
        label: '审查一个拉取请求',
        prompt: 'Review a pull request and suggest improvements',
      },
      {
        id: 'review-tests',
        label: '检查测试覆盖',
        prompt: 'Review the test coverage for the current changes',
      },
      {
        id: 'review-refactor',
        label: '评估一次重构',
        prompt: 'Review a refactor and identify risks or improvements',
      },
    ],
  },
  {
    id: 'codex-fix',
    label: '修复问题和失败',
    starter: 'Fix ',
    tone: 'orange',
    tasks: [
      {
        id: 'fix-bug',
        label: '修复一个缺陷',
        prompt: 'Fix a bug in this codebase',
      },
      {
        id: 'fix-tests',
        label: '修复失败的测试',
        prompt: 'Fix the failing tests in this codebase',
      },
      {
        id: 'fix-ci',
        label: '排查 CI 失败',
        prompt: 'Fix the CI failures in this codebase',
      },
      {
        id: 'fix-conflicts',
        label: '解决合并冲突',
        prompt: 'Fix the merge conflicts in this codebase',
      },
    ],
  },
] as const satisfies readonly NewSessionSuggestionCategory[]

export function findNewSessionSuggestionCategory(
  categoryId: NewSessionSuggestionCategoryId,
): NewSessionSuggestionCategory {
  return NEW_SESSION_SUGGESTIONS.find((category) => category.id === categoryId)!
}

const normalizedPrompt = (value: string) =>
  value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US')

const shortTitle = (value: string) => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 26 ? `${normalized.slice(0, 25)}…` : normalized
}

const inferCategoryId = (value: string): NewSessionSuggestionCategoryId => {
  const normalized = value.toLocaleLowerCase()
  if (/\b(?:fix|debug|repair)\b|修复|排查|错误|失败/u.test(normalized)) {
    return 'codex-fix'
  }
  if (/\b(?:review|audit|inspect)\b|审查|检查|评估/u.test(normalized)) {
    return 'codex-review'
  }
  if (/\b(?:explore|understand|research)\b|探索|理解|调研/u.test(normalized)) {
    return 'codex-explore'
  }
  return 'codex-create'
}

const staticFallbacks = (hasWorkspace = true): NewSessionTaskSuggestion[] =>
  NEW_SESSION_SUGGESTIONS.map((category) => {
    const task = category.tasks[0]!
    if (hasWorkspace) {
      return {
        ...task,
        categoryId: category.id,
      }
    }
    const genericPromptMap: Record<NewSessionSuggestionCategoryId, string> = {
      'codex-explore': 'Explore how a feature or concept works',
      'codex-create': 'Build a new application, feature, or script',
      'codex-review': 'Review code or text and suggest improvements',
      'codex-fix': 'Fix a bug, error, or failing logic',
    }
    return {
      ...task,
      categoryId: category.id,
      prompt: genericPromptMap[category.id] ?? task.prompt,
    }
  })

export function buildContextualTaskSuggestions(input: {
  recentTasks: readonly NewSessionRecentTask[]
  git: NewSessionSuggestionGitContext | null
  hasWorkspace?: boolean
}): NewSessionTaskSuggestion[] {
  const hasWorkspace = input.hasWorkspace ?? true
  const candidates: NewSessionTaskSuggestion[] = []
  const recentTasks = [...input.recentTasks]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 5)
  const unfinished = recentTasks.find(
    (task) => task.status === 'error' || task.status === 'interrupted',
  )
  if (unfinished) {
    const title = shortTitle(unfinished.title)
    candidates.push({
      id: `recent-unfinished:${unfinished.id}`,
      categoryId: 'codex-fix',
      label: `继续处理：${title}`,
      prompt: unfinished.firstPrompt
        ? `继续处理上次未完成的任务：${unfinished.firstPrompt}`
        : `继续处理上次未完成的任务“${unfinished.title}”，先确认当前状态，再完成剩余工作。`,
    })
  }

  if (input.git && !input.git.clean && input.git.totalFiles > 0) {
    candidates.push({
      id: 'git:working-tree',
      categoryId: 'codex-review',
      label: `审查当前 ${input.git.totalFiles} 个文件的改动`,
      prompt: '审查当前工作区改动，指出风险、遗漏和可以直接改进的地方。',
    })
  }

  if (input.git && input.git.behind > 0) {
    candidates.push({
      id: 'git:behind',
      categoryId: 'codex-explore',
      label: `检查落后的 ${input.git.behind} 个提交`,
      prompt: '检查当前分支与上游分支的差异，说明同步风险并给出安全的处理方案。',
    })
  }

  if (input.git && input.git.ahead > 0) {
    candidates.push({
      id: 'git:ahead',
      categoryId: 'codex-review',
      label: `检查待推送的 ${input.git.ahead} 个提交`,
      prompt: '审查当前分支尚未推送的提交，检查风险、测试覆盖和提交完整性。',
    })
  }

  for (const task of recentTasks) {
    if (task.status !== 'done') continue
    const title = shortTitle(task.title)
    candidates.push({
      id: `recent-completed:${task.id}`,
      categoryId: inferCategoryId(`${task.title} ${task.firstPrompt ?? ''}`),
      label: `继续完善：${title}`,
      prompt: `基于最近完成的任务“${task.title}”，检查当前实现并完成最有价值的下一步改进。`,
    })
  }

  candidates.push(...staticFallbacks(hasWorkspace))
  const seen = new Set<string>()
  return candidates
    .flatMap((candidate) => {
      const key = normalizedPrompt(candidate.prompt)
      if (!key || seen.has(key)) return []
      seen.add(key)
      return [candidate]
    })
    .slice(0, 4)
}
