import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Automation, AutomationRun } from '@pidex/shared/automation'
import type { DesktopSessionListItem, DesktopWorkspace } from '../../../shared/Types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import {
  automationScheduleSummary,
  automationTargetLabel,
  automationToDraft,
  hasActiveAutomationRun,
  isCompletedAutomation,
  validateAutomationDraft,
  type AutomationDraft,
  type AutomationFilter,
} from './AutomationModel.js'
const errorMessage = (cause: unknown): string =>
  rawErrorMessage(cause) || '自动化操作失败，请重试。'
import { errorMessageOf as rawErrorMessage } from '@pidex/shared/errors'

type SaveState = 'idle' | 'saving' | 'saved' | 'failed' | 'conflict'

export type AutomationController = {
  supported: boolean | null
  loading: boolean
  error: string | null
  automations: readonly Automation[]
  filteredAutomations: readonly Automation[]
  runs: readonly AutomationRun[]
  projects: readonly DesktopWorkspace[]
  sessions: readonly DesktopSessionListItem[]
  selected: Automation | null
  draft: AutomationDraft | null
  draftError: string | null
  scheduleError: string | null
  scheduleSummary: string | null
  saveState: SaveState
  query: string
  filter: AutomationFilter
  unreadCount: number
  setQuery: (value: string) => void
  setFilter: (value: AutomationFilter) => void
  setDraft: (value: AutomationDraft) => void
  refresh: () => Promise<void>
  beginCreate: (draft: AutomationDraft) => void
  cancelDraft: () => void
  create: () => Promise<string | null>
  retrySave: () => void
  runNow: (id: string) => Promise<void>
  setPaused: (automation: Automation, paused: boolean) => Promise<void>
  remove: (automation: Automation) => Promise<void>
  markRunRead: (runId: string) => Promise<void>
  markAllRunsRead: () => Promise<void>
  targetLabel: (automation: Automation) => string
}

export function useAutomationController(
  selectedId: string | null,
  enabled = true,
): AutomationController {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [automations, setAutomations] = useState<readonly Automation[]>([])
  const [runs, setRuns] = useState<readonly AutomationRun[]>([])
  const [projects, setProjects] = useState<readonly DesktopWorkspace[]>([])
  const [sessions, setSessions] = useState<readonly DesktopSessionListItem[]>([])
  const [draft, setDraftState] = useState<AutomationDraft | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [scheduleSummary, setScheduleSummary] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<AutomationFilter>('all')
  const refreshSequence = useRef(0)
  const saveSequence = useRef(0)
  const selected = automations.find((item) => item.id === selectedId) ?? null

  const refresh = useCallback(async (): Promise<void> => {
    const sequence = ++refreshSequence.current
    setLoading(true)
    setError(null)
    try {
      const capabilities = await desktopClient.getRuntimeCapabilities()
      const available = capabilities.includes('automation.manage.v1')
      if (sequence !== refreshSequence.current) return
      setSupported(available)
      if (!available) {
        setLoading(false)
        return
      }
      const [list, runList, projectList, sessionList] = await Promise.all([
        desktopClient.listAutomations({ statuses: ['active', 'paused'] }),
        desktopClient.listAutomationRuns({ limit: 200 }),
        desktopClient.listProjects(),
        desktopClient.listSessions(),
      ])
      if (sequence !== refreshSequence.current) return
      setAutomations(list.automations)
      setRuns(runList.runs)
      setProjects(projectList.filter((project) => Boolean(project.projectId)))
      setSessions(sessionList.map((snapshot) => snapshot.item).filter((item) => !item.archivedAt))
      setLoading(false)
    } catch (cause) {
      if (sequence !== refreshSequence.current) return
      setSupported((current) => current ?? true)
      setLoading(false)
      setError(errorMessage(cause))
    }
  }, [])

  useEffect(() => {
    if (enabled) void refresh()
  }, [enabled, refresh])
  useEffect(
    () =>
      enabled
        ? desktopClient.subscribeAgentEventEnvelopes({ liveEventTypes: [] }, (events) => {
            if (
              events.some(
                (event) =>
                  event.type === 'automation/changed' || event.type === 'automation/runChanged',
              )
            ) {
              void refresh()
            }
          })
        : undefined,
    [enabled, refresh],
  )

  useEffect(() => {
    if (!selected) return
    if (saveState === 'conflict' && draft) return
    setDraftState(automationToDraft(selected))
    setSaveState('idle')
    setScheduleError(null)
    setScheduleSummary(selected.canonicalRrule)
  }, [selected?.id, selected?.revision])

  const setDraft = useCallback((value: AutomationDraft): void => {
    setDraftState(value)
    setSaveState('idle')
  }, [])

  const previewSchedule = useCallback(async (value: AutomationDraft): Promise<boolean> => {
    try {
      const result = await desktopClient.previewAutomationSchedule({
        schedule: value.schedule,
        timeZone: value.timeZone,
        count: 4,
      })
      setScheduleError(null)
      setScheduleSummary(result.summary)
      return true
    } catch (cause) {
      setScheduleError(errorMessage(cause))
      return false
    }
  }, [])

  const saveSelected = useCallback(
    async (value: AutomationDraft): Promise<void> => {
      if (!selected) return
      const sequence = ++saveSequence.current
      setSaveState('saving')
      if (!(await previewSchedule(value))) {
        if (sequence === saveSequence.current) setSaveState('failed')
        return
      }
      try {
        const result = await desktopClient.updateAutomation({
          automationId: selected.id,
          expectedRevision: selected.revision,
          patch: value,
        })
        if (sequence !== saveSequence.current) return
        setAutomations((items) =>
          items.map((item) => (item.id === result.automation.id ? result.automation : item)),
        )
        setSaveState('saved')
      } catch (cause) {
        if (sequence !== saveSequence.current) return
        const message = errorMessage(cause)
        setSaveState(
          message.includes('CONFLICT') || message.includes('冲突') ? 'conflict' : 'failed',
        )
        setError(message)
      }
    },
    [previewSchedule, selected],
  )

  useEffect(() => {
    if (!selected || !draft || validateAutomationDraft(draft)) return
    const baseline = JSON.stringify(automationToDraft(selected))
    if (
      JSON.stringify(draft) === baseline ||
      saveState === 'saving' ||
      saveState === 'failed' ||
      saveState === 'conflict'
    )
      return
    const timer = window.setTimeout(() => {
      void saveSelected(draft)
    }, 600)
    return () => window.clearTimeout(timer)
  }, [draft, saveSelected, saveState, selected])

  const filteredAutomations = useMemo(() => {
    const projectNames = new Map(
      projects.flatMap((project) =>
        project.projectId ? [[project.projectId, project.name] as const] : [],
      ),
    )
    const needle = query.trim().toLocaleLowerCase()
    const unreadByAutomation = new Set(
      runs.filter((run) => !run.readAt && isTerminal(run)).map((run) => run.automationId),
    )
    return automations
      .filter((item) => {
        if (filter === 'all') return true
        if (filter === 'paused') return item.status === 'paused'
        if (filter === 'completed') return isCompletedAutomation(item, runs)
        return (
          item.status === 'active' &&
          (item.nextRunAt !== null || hasActiveAutomationRun(item.id, runs))
        )
      })
      .filter(
        (item) =>
          !needle ||
          [
            item.name,
            item.prompt,
            item.canonicalRrule,
            automationScheduleSummary(item.schedule),
            automationTargetLabel(item, projectNames, sessions),
          ]
            .join('\n')
            .toLocaleLowerCase()
            .includes(needle),
      )
      .slice()
      .sort((left, right) => {
        const unread =
          Number(unreadByAutomation.has(right.id)) - Number(unreadByAutomation.has(left.id))
        if (unread) return unread
        const status = automationSortRank(left, runs) - automationSortRank(right, runs)
        if (status) return status
        if (
          left.status === 'active' &&
          right.status === 'active' &&
          !isCompletedAutomation(left, runs) &&
          !isCompletedAutomation(right, runs)
        ) {
          const next =
            (left.nextRunAt ?? Number.MAX_SAFE_INTEGER) -
            (right.nextRunAt ?? Number.MAX_SAFE_INTEGER)
          if (next) return next
        }
        return left.name.localeCompare(right.name, 'zh-CN')
      })
  }, [automations, filter, projects, query, runs, sessions])

  const beginCreate = useCallback((value: AutomationDraft): void => {
    saveSequence.current += 1
    setDraftState(value)
    setSaveState('idle')
    setScheduleError(null)
    setScheduleSummary(null)
  }, [])

  const cancelDraft = useCallback((): void => {
    saveSequence.current += 1
    setDraftState(null)
    setSaveState('idle')
    setScheduleError(null)
  }, [])

  const create = useCallback(async (): Promise<string | null> => {
    if (!draft || selected) return null
    const validation = validateAutomationDraft(draft)
    if (validation) return null
    setSaveState('saving')
    if (!(await previewSchedule(draft))) {
      setSaveState('failed')
      return null
    }
    try {
      const result = await desktopClient.createAutomation(draft)
      setAutomations((items) => [result.automation, ...items])
      setDraftState(automationToDraft(result.automation))
      setSaveState('saved')
      return result.automation.id
    } catch (cause) {
      setError(errorMessage(cause))
      setSaveState('failed')
      return null
    }
  }, [draft, previewSchedule, selected])

  const mutate = useCallback(
    async (operation: () => Promise<unknown>): Promise<void> => {
      setError(null)
      try {
        await operation()
        await refresh()
      } catch (cause) {
        setError(errorMessage(cause))
      }
    },
    [refresh],
  )

  const projectNames = useMemo(
    () =>
      new Map(
        projects.flatMap((project) =>
          project.projectId ? [[project.projectId, project.name] as const] : [],
        ),
      ),
    [projects],
  )
  return {
    supported,
    loading,
    error,
    automations,
    filteredAutomations,
    runs,
    projects,
    sessions,
    selected,
    draft,
    draftError: draft ? validateAutomationDraft(draft) : null,
    scheduleError,
    scheduleSummary,
    saveState,
    query,
    filter,
    unreadCount: runs.filter((run) => !run.readAt && isTerminal(run)).length,
    setQuery,
    setFilter,
    setDraft,
    refresh,
    beginCreate,
    cancelDraft,
    create,
    retrySave: () => {
      if (selected && draft) void saveSelected(draft)
    },
    runNow: (id) => mutate(() => desktopClient.runAutomation({ automationId: id })),
    setPaused: (automation, paused) =>
      mutate(() =>
        desktopClient.updateAutomation({
          automationId: automation.id,
          expectedRevision: automation.revision,
          patch: { status: paused ? 'paused' : 'active' },
        }),
      ),
    remove: (automation) =>
      mutate(() =>
        desktopClient.deleteAutomation({
          automationId: automation.id,
          expectedRevision: automation.revision,
        }),
      ),
    markRunRead: (runId) => mutate(() => desktopClient.markAutomationRunRead({ runId })),
    markAllRunsRead: () => mutate(() => desktopClient.markAllAutomationRunsRead({})),
    targetLabel: (automation) => automationTargetLabel(automation, projectNames, sessions),
  }
}

function automationSortRank(automation: Automation, runs: readonly AutomationRun[]): number {
  if (isCompletedAutomation(automation, runs)) return 2
  return automation.status === 'paused' ? 1 : 0
}

function isTerminal(run: AutomationRun): boolean {
  return run.status === 'completed' || run.status === 'failed' || run.status === 'interrupted'
}
