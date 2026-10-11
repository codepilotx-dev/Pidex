import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DesktopGitStatus, DesktopTaskSuggestion } from '../../../shared/Types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import {
  buildContextualTaskSuggestions,
  type ContextualTaskSuggestionSurface,
  type NewSessionRecentTask,
  type NewSessionTaskSuggestion,
  type WorkingContextualTaskSuggestion,
} from './NewSessionSuggestions.js'

const windowsAbsolutePath = /(?:[A-Za-z]:[\\/]|\\\\)[^\s"'<>]+/gu

export const sanitizeTaskSuggestionContextText = (value: string, limit: number) =>
  value.replace(windowsAbsolutePath, '[路径]').replace(/\s+/g, ' ').trim().slice(0, limit)

const safeRecentPrompt = (value: string | null) => {
  if (!value) return null
  return sanitizeTaskSuggestionContextText(value, 500) || null
}

const normalizedGitContext = (gitStatus: DesktopGitStatus | null) =>
  gitStatus
    ? {
        clean: gitStatus.clean,
        ahead: gitStatus.ahead,
        behind: gitStatus.behind,
        totalFiles: gitStatus.files.length,
        files: gitStatus.files.slice(0, 30).map((file) => ({
          path: sanitizeTaskSuggestionContextText(file.path, 500) || '[路径]',
          status: sanitizeTaskSuggestionContextText(file.status, 80),
          stagedStatus: sanitizeTaskSuggestionContextText(file.stagedStatus, 80),
          unstagedStatus: sanitizeTaskSuggestionContextText(file.unstagedStatus, 80),
        })),
      }
    : null

const codingDesktopSuggestion = (suggestion: DesktopTaskSuggestion): NewSessionTaskSuggestion => ({
  id: suggestion.id,
  categoryId: suggestion.categoryId as NewSessionTaskSuggestion['categoryId'],
  label: suggestion.label,
  prompt: suggestion.prompt,
})

const workingDesktopSuggestion = (
  suggestion: DesktopTaskSuggestion,
): WorkingContextualTaskSuggestion => ({
  id: suggestion.id,
  categoryId: suggestion.categoryId as WorkingContextualTaskSuggestion['categoryId'],
  label: suggestion.label,
  prompt: suggestion.prompt,
})

const codingCategoryIds = new Set(['codex-explore', 'codex-create', 'codex-review', 'codex-fix'])
const workingCategoryIds = new Set(['create', 'research', 'automate'])

export const normalizeGeneratedSuggestionsForSurface = (
  suggestions: readonly DesktopTaskSuggestion[],
  surface: ContextualTaskSuggestionSurface,
): readonly NewSessionTaskSuggestion[] | readonly WorkingContextualTaskSuggestion[] | null => {
  const allowed = surface === 'working' ? workingCategoryIds : codingCategoryIds
  if (suggestions.some((suggestion) => !allowed.has(suggestion.categoryId))) {
    return null
  }
  if (surface === 'working') {
    return suggestions.length === 3 ? suggestions.map(workingDesktopSuggestion) : null
  }
  return suggestions.length >= 3 ? suggestions.slice(0, 4).map(codingDesktopSuggestion) : null
}

export const shouldApplyGeneratedSuggestions = (input: {
  request: number
  currentRequest: number
  interactionVersion: number
  currentInteractionVersion: number
  active: boolean
}) =>
  input.request === input.currentRequest &&
  input.interactionVersion === input.currentInteractionVersion &&
  input.active

type ContextualTaskSuggestionsInput = {
  surface?: ContextualTaskSuggestionSurface
  active: boolean
  workspaceName: string | null
  workspacePath: string | null
  branchName: string | null
  gitStatus: DesktopGitStatus | null
  recentTasks: readonly NewSessionRecentTask[]
  buildWorkingSuggestions?: (input: {
    workspaceName: string | null
    recentTasks: readonly NewSessionRecentTask[]
    git: ReturnType<typeof normalizedGitContext>
  }) => readonly WorkingContextualTaskSuggestion[]
}

export function useContextualTaskSuggestions(
  input: ContextualTaskSuggestionsInput & {
    surface: 'working'
    buildWorkingSuggestions: NonNullable<ContextualTaskSuggestionsInput['buildWorkingSuggestions']>
  },
): {
  suggestions: readonly WorkingContextualTaskSuggestion[]
  markInteracted: () => void
}
export function useContextualTaskSuggestions(
  input: ContextualTaskSuggestionsInput & { surface?: 'coding' },
): {
  suggestions: readonly NewSessionTaskSuggestion[]
  markInteracted: () => void
}
export function useContextualTaskSuggestions(input: ContextualTaskSuggestionsInput) {
  const surface = input.surface ?? 'coding'
  const workspaceName = useMemo(
    () =>
      input.workspaceName
        ? sanitizeTaskSuggestionContextText(input.workspaceName, 160) || null
        : null,
    [input.workspaceName],
  )
  const branchName = useMemo(
    () =>
      input.branchName ? sanitizeTaskSuggestionContextText(input.branchName, 200) || null : null,
    [input.branchName],
  )
  const git = useMemo(() => normalizedGitContext(input.gitStatus), [input.gitStatus])
  const recentTasks = useMemo(
    () =>
      input.recentTasks.slice(0, 5).map((task) => ({
        ...task,
        title: sanitizeTaskSuggestionContextText(task.title, 160) || '未命名任务',
        firstPrompt: safeRecentPrompt(task.firstPrompt),
      })),
    [input.recentTasks],
  )
  const localSuggestions = useMemo(
    () =>
      surface === 'working'
        ? input.buildWorkingSuggestions!({
            workspaceName,
            recentTasks,
            git,
          })
        : buildContextualTaskSuggestions({
            recentTasks,
            git,
            hasWorkspace: Boolean(input.workspacePath || workspaceName),
          }),
    [git, input.buildWorkingSuggestions, input.workspacePath, recentTasks, surface, workspaceName],
  )
  const context = useMemo(
    () => ({
      workspaceName,
      branchName,
      git,
      recentTasks,
      localCandidates: localSuggestions,
    }),
    [branchName, git, localSuggestions, recentTasks, workspaceName],
  )
  const [suggestions, setSuggestions] =
    useState<readonly (NewSessionTaskSuggestion | WorkingContextualTaskSuggestion)[]>(
      localSuggestions,
    )
  const interactionVersionRef = useRef(0)
  const activeRef = useRef(input.active)
  const requestRef = useRef(0)

  activeRef.current = input.active

  const markInteracted = useCallback(() => {
    interactionVersionRef.current += 1
  }, [])

  useEffect(() => {
    setSuggestions(localSuggestions)
    if (!input.active) return
    const request = ++requestRef.current
    const interactionVersion = interactionVersionRef.current
    void desktopClient
      .generateTaskSuggestions({
        surface,
        workspacePath: input.workspacePath,
        context,
      })
      .then((result) => {
        if (
          !shouldApplyGeneratedSuggestions({
            request,
            currentRequest: requestRef.current,
            interactionVersion,
            currentInteractionVersion: interactionVersionRef.current,
            active: activeRef.current,
          })
        ) {
          return
        }
        const generated = normalizeGeneratedSuggestionsForSurface(result.suggestions, surface)
        if (generated) setSuggestions(generated)
      })
      .catch(() => {
        // Local rules remain available when the Agent or model is unavailable.
      })
    return () => {
      if (requestRef.current === request) requestRef.current += 1
    }
  }, [context, input.active, input.workspacePath, localSuggestions, surface])

  return { suggestions, markInteracted }
}
