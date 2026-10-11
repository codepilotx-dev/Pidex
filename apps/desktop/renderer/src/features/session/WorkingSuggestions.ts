import type { WorkingPlugin } from './composer/ComposerTypes.js'
import type {
  NewSessionRecentTask,
  NewSessionSuggestionGitContext,
  WorkingContextualSuggestionCategoryId,
  WorkingContextualTaskSuggestion,
} from './NewSessionSuggestions.js'

export type WorkingSuggestionCategoryId = 'create' | 'research' | 'automate'

export type WorkingSuggestionTask = {
  id: string
  label: string
  prompt: string
}

export type WorkingContextualSuggestion = {
  id: string
  label: string
  prompt: string
}

export type WorkingSuggestionCategory = {
  id: WorkingSuggestionCategoryId
  label: string
  starterPrompt: string
  tasks: readonly WorkingSuggestionTask[]
}

export type WorkingSuggestionState =
  | { kind: 'root' }
  | { kind: 'templates' }
  | {
      kind: 'category'
      categoryId: WorkingSuggestionCategoryId
      generatedStarter: string
    }
  | { kind: 'hidden'; reason: 'prompt-filled' | 'custom-input' }

const normalizedPrompt = (value: string) =>
  value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US')

const shortTitle = (value: string) => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 26 ? `${normalized.slice(0, 25)}…` : normalized
}

const workingStaticFallbacks = (
  workspaceName: string | null,
): WorkingContextualTaskSuggestion[] => {
  const project = shortTitle(workspaceName?.trim() || '当前工作区')
  return [
    {
      id: 'working-fallback:create',
      categoryId: 'create',
      label: `为 ${project} 创建下一项交付物`,
      prompt: `结合 ${project} 的当前内容，确认目标和交付标准，并创建最有价值的下一项交付物。`,
    },
    {
      id: 'working-fallback:research',
      categoryId: 'research',
      label: `规划 ${project} 的后续步骤`,
      prompt: `调研 ${project} 的当前状态、已有成果和约束，给出按优先级排列的后续步骤。`,
    },
    {
      id: 'working-fallback:automate',
      categoryId: 'automate',
      label: `寻找 ${project} 中可自动化的工作`,
      prompt: `检查 ${project} 中日常或重复性的工作，选择最值得自动化的一项并给出可执行方案。`,
    },
  ]
}

const inferWorkingCategoryId = (value: string): WorkingContextualSuggestionCategoryId => {
  const normalized = value.toLocaleLowerCase()
  if (/\b(?:automat|recurring|repeat|routine)\w*\b|自动|重复|例行/u.test(normalized)) {
    return 'automate'
  }
  if (
    /\b(?:research|plan|review|investigate|explore)\w*\b|调研|规划|审查|分析|排查/u.test(normalized)
  ) {
    return 'research'
  }
  return 'create'
}

/**
 * Working 首页的本地上下文候选。候选只依据当前工作区、Git 与最近会话，
 * 保证模型不可用时仍有三条稳定且可直接预填的建议。
 */
export function buildWorkingContextualTaskSuggestions(input: {
  workspaceName: string | null
  recentTasks: readonly NewSessionRecentTask[]
  git: NewSessionSuggestionGitContext | null
}): WorkingContextualTaskSuggestion[] {
  const candidates: WorkingContextualTaskSuggestion[] = []
  const recentTasks = [...input.recentTasks]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 5)

  const unfinished = recentTasks.find(
    (task) => task.status === 'error' || task.status === 'interrupted',
  )
  if (unfinished) {
    const title = shortTitle(unfinished.title)
    candidates.push({
      id: `working-recent-unfinished:${unfinished.id}`,
      categoryId: 'research',
      label: `继续处理：${title}`,
      prompt: unfinished.firstPrompt
        ? `继续处理上次未完成的工作：${unfinished.firstPrompt}。先核对当前状态和阻塞原因，再完成剩余交付。`
        : `继续处理上次未完成的工作“${unfinished.title}”，先核对当前状态和阻塞原因，再完成剩余交付。`,
    })
  }

  if (input.git && !input.git.clean && input.git.totalFiles > 0) {
    candidates.push({
      id: 'working-git:working-tree',
      categoryId: 'research',
      label: `整理当前 ${input.git.totalFiles} 个文件的工作进展`,
      prompt: '结合当前工作区改动，梳理已经完成的内容、仍需处理的风险和下一项最重要的交付。',
    })
  }

  if (input.git && input.git.behind > 0) {
    candidates.push({
      id: 'working-git:behind',
      categoryId: 'research',
      label: `规划落后 ${input.git.behind} 个提交的同步工作`,
      prompt: '比较当前分支与上游的差异，评估同步影响，并规划安全的后续处理步骤。',
    })
  }

  if (input.git && input.git.ahead > 0) {
    candidates.push({
      id: 'working-git:ahead',
      categoryId: 'research',
      label: `整理待交付的 ${input.git.ahead} 个提交`,
      prompt: '检查当前分支尚未推送的成果，整理交付内容、验证事项和后续安排。',
    })
  }

  for (const task of recentTasks) {
    if (task.status !== 'done') continue
    const title = shortTitle(task.title)
    candidates.push({
      id: `working-recent-completed:${task.id}`,
      categoryId: inferWorkingCategoryId(`${task.title} ${task.firstPrompt ?? ''}`),
      label: `继续推进：${title}`,
      prompt: `基于最近完成的工作“${task.title}”，核对已有成果并完成最有价值的下一步。`,
    })
  }

  candidates.push(...workingStaticFallbacks(input.workspaceName))
  const seen = new Set<string>()
  return candidates
    .flatMap((candidate) => {
      const key = normalizedPrompt(candidate.prompt)
      if (!key || seen.has(key)) return []
      seen.add(key)
      return [candidate]
    })
    .slice(0, 3)
}

/**
 * Codex Work 首页生成代码中可确认的三类直接任务。
 * 第三级 sourceSuggestions 依赖云端插件，Pidex 当前没有对应能力，因此不复制。
 */
export const WORKING_SUGGESTION_CATEGORIES = [
  {
    id: 'create',
    label: '创建文件或搭建网站',
    starterPrompt: '创建',
    tasks: [
      {
        id: 'new-chat-page-create-document',
        label: '创建新文档',
        prompt: '创建一个新文档。先问我它应该是什么主题。',
      },
      {
        id: 'new-chat-page-create-spreadsheet',
        label: '创建新电子表格',
        prompt: '创建一个新电子表格。先问我它应该是什么主题。',
      },
      {
        id: 'new-chat-page-create-presentation',
        label: '创建新演示文稿',
        prompt: '创建一个新演示文稿。先问我它应该是什么主题。',
      },
      {
        id: 'new-chat-page-create-site',
        label: '创建新网站',
        prompt: '创建一个新网站。先问我它应该是什么主题。',
      },
    ],
  },
  {
    id: 'research',
    label: '调研并规划后续步骤',
    starterPrompt: '确定下一步',
    tasks: [
      {
        id: 'new-chat-page-research-topic',
        label: '为我正在探索的主题规划下一步',
        prompt: '确定我正在探索的主题的下一步',
      },
      {
        id: 'new-chat-page-research-options-and-tradeoffs',
        label: '比较选项后确定下一步',
        prompt: '比较选项后确定下一步',
      },
      {
        id: 'new-chat-page-plan-upcoming-meeting',
        label: '确定即将召开的会议的下一步行动',
        prompt: '确定即将召开的会议的后续步骤',
      },
      {
        id: 'new-chat-page-plan-strategy-or-roadmap',
        label: '确定策略或项目的下一步',
        prompt: '确定战略或项目的下一步行动',
      },
    ],
  },
  {
    id: 'automate',
    label: '自动处理日常和重复性工作',
    starterPrompt: '自动化',
    tasks: [
      {
        id: 'new-chat-page-automate-recurring-report',
        label: '自动生成定期报告',
        prompt: '自动生成定期报告',
      },
      {
        id: 'new-chat-page-automate-morning-prep',
        label: '自动安排我的晨间准备',
        prompt: '自动安排我的晨间准备',
      },
      {
        id: 'new-chat-page-automate-triage',
        label: '自动化分诊',
        prompt: '自动分流',
      },
      {
        id: 'new-chat-page-monitor-changes',
        label: '自动监控重要变更',
        prompt: '自动监控重要变更',
      },
    ],
  },
] as const satisfies readonly WorkingSuggestionCategory[]

export function findWorkingSuggestionCategory(
  categoryId: WorkingSuggestionCategoryId,
): WorkingSuggestionCategory {
  return WORKING_SUGGESTION_CATEGORIES.find((category) => category.id === categoryId)!
}

export function createWorkingSuggestionState(composerValue: string): WorkingSuggestionState {
  return composerValue.trim().length > 0
    ? { kind: 'hidden', reason: 'custom-input' }
    : { kind: 'root' }
}

/** 根分类在空草稿时默认可见；输入或选中最终任务后隐藏。 */
export function shouldShowWorkingSuggestions(state: WorkingSuggestionState): boolean {
  return state.kind === 'root' || state.kind === 'templates' || state.kind === 'category'
}

export function syncWorkingSuggestionState(
  state: WorkingSuggestionState,
  composerValue: string,
): WorkingSuggestionState {
  if (composerValue.trim().length === 0) {
    return state.kind === 'templates' ? state : { kind: 'root' }
  }
  if (state.kind === 'category' && composerValue === state.generatedStarter) {
    return state
  }
  if (state.kind === 'hidden' && state.reason === 'prompt-filled') return state
  return { kind: 'hidden', reason: 'custom-input' }
}

export function showWorkingSuggestionTemplates(): WorkingSuggestionState {
  return { kind: 'templates' }
}

export function showContextualWorkingSuggestions(): WorkingSuggestionState {
  return { kind: 'root' }
}

export function selectWorkingSuggestionCategory(
  categoryId: WorkingSuggestionCategoryId,
  starter: string,
): WorkingSuggestionState {
  return { kind: 'category', categoryId, generatedStarter: starter }
}

/**
 * 返回第一层时只移除仍位于草稿开头的系统 starter，保留用户补写的内容。
 */
export function returnToWorkingSuggestionRoot(
  state: WorkingSuggestionState,
  composerValue: string,
): { state: WorkingSuggestionState; composerValue: string } {
  if (state.kind !== 'category') return { state, composerValue }
  const nextValue = composerValue.startsWith(state.generatedStarter)
    ? composerValue.slice(state.generatedStarter.length)
    : composerValue
  return { state: { kind: 'root' }, composerValue: nextValue }
}

/** 从具体模板返回模板分类；清理规则与返回上下文建议时一致。 */
export function returnToWorkingSuggestionTemplates(
  state: WorkingSuggestionState,
  composerValue: string,
): { state: WorkingSuggestionState; composerValue: string } {
  if (state.kind !== 'category') return { state, composerValue }
  const nextValue = composerValue.startsWith(state.generatedStarter)
    ? composerValue.slice(state.generatedStarter.length)
    : composerValue
  return { state: { kind: 'templates' }, composerValue: nextValue }
}

/** 上下文建议只预填草稿，不负责提交。 */
export function selectWorkingContextualSuggestion(suggestion: WorkingContextualSuggestion): {
  state: WorkingSuggestionState
  prompt: string
  plugin: WorkingPlugin | null
} {
  return {
    state: { kind: 'hidden', reason: 'prompt-filled' },
    prompt: suggestion.prompt,
    plugin: null,
  }
}

/**
 * 点击第二层后用完整提示词替换 Composer；
 * 调用方只更新草稿，不自动提交。
 */
export function selectWorkingSuggestionTask(
  state: WorkingSuggestionState,
  taskId: string,
): { state: WorkingSuggestionState; prompt: string; plugin: WorkingPlugin | null } | null {
  if (state.kind !== 'category') return null
  const category = findWorkingSuggestionCategory(state.categoryId)
  const task = category.tasks.find((item) => item.id === taskId)
  if (!task) return null
  return {
    state: { kind: 'hidden', reason: 'prompt-filled' },
    prompt: task.prompt,
    plugin: null,
  }
}
