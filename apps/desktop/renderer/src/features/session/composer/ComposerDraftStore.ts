import { createStore, type StoreApi } from 'zustand/vanilla'
import type {
  ComposerDocument,
  ComposerDraft,
  ComposerDraftKey,
  ComposerSkillInvocation,
  ComposerSubmitOutcome,
} from './ComposerTypes.js'
import { createComposerDocument } from './ComposerTypes.js'
import { skillInvocationsFromComposerDocument } from './ComposerSkillToken.js'

type CreateClientId = () => string

type ComposerDraftHandoff = {
  submitted: ComposerDraft
  replacement: ComposerDraft
}

type ComposerDraftState = {
  drafts: Readonly<Record<string, ComposerDraft>>
  submitOutcomes: Readonly<Record<string, ComposerSubmitOutcome>>
}

/**
 * 会话内共享的草稿注册表。状态可订阅；草稿读取保持深拷贝，
 * 避免调用方直接改写 Store 内对象。
 */
export class ComposerDraftStore {
  readonly #store: StoreApi<ComposerDraftState>
  readonly #createClientId: CreateClientId
  /** 仅由 get() 惰性创建、尚未写入的草稿；不参与订阅快照。 */
  readonly #lazy = new Map<ComposerDraftKey, ComposerDraft>()

  constructor(createClientId: CreateClientId = defaultCreateClientId) {
    this.#createClientId = createClientId
    this.#store = createStore<ComposerDraftState>()(() => ({
      drafts: {},
      submitOutcomes: {},
    }))
  }

  get store(): StoreApi<ComposerDraftState> {
    return this.#store
  }

  subscribe = (listener: () => void): (() => void) => this.#store.subscribe(listener)

  #read(key: ComposerDraftKey): ComposerDraft | undefined {
    return this.#store.getState().drafts[key] ?? this.#lazy.get(key)
  }

  #write(key: ComposerDraftKey, draft: ComposerDraft): ComposerDraft {
    const next = cloneDraft(draft)
    this.#lazy.delete(key)
    this.#store.setState((state) => ({ drafts: { ...state.drafts, [key]: next } }))
    return cloneDraft(next)
  }

  get(key: ComposerDraftKey): ComposerDraft {
    const existing = this.#read(key)
    if (existing) return cloneDraft(existing)
    // 读取即创建属于初始化而非内容变更：先留在本地，首次写入才进入 Store。
    const created = createEmptyComposerDraft(this.#createClientId())
    this.#lazy.set(key, created)
    return cloneDraft(created)
  }

  peek(key: ComposerDraftKey): ComposerDraft | undefined {
    const draft = this.#read(key)
    return draft ? cloneDraft(draft) : undefined
  }

  set(key: ComposerDraftKey, draft: ComposerDraft): ComposerDraft {
    return this.#write(key, draft)
  }

  update(key: ComposerDraftKey, update: (draft: ComposerDraft) => ComposerDraft): ComposerDraft {
    return this.set(key, update(this.get(key)))
  }
  updateBrowserAnnotations(
    key: ComposerDraftKey,
    update: (draft: ComposerDraft) => ComposerDraft,
  ): ComposerDraft {
    const next = this.update(key, update)
    return next
  }

  prefillTextIfEmpty(key: ComposerDraftKey, text: string): ComposerDraft {
    const current = this.get(key)
    if (current.document.text.trim()) return current
    const next = this.set(key, {
      ...current,
      document: {
        text,
        tokens: [],
      },
    })
    return next
  }

  setSkillInvocation(
    key: ComposerDraftKey,
    skillInvocation: ComposerSkillInvocation | undefined,
  ): ComposerDraft {
    const next = this.update(key, (current) => ({
      ...current,
      skillInvocation,
      skills: skillInvocation ? [{ ...skillInvocation }] : [],
    }))
    return next
  }

  /** Hand a draft to its new session and rotate the source identity atomically. */
  handoff(from: ComposerDraftKey, to: ComposerDraftKey): ComposerDraftHandoff | undefined {
    const submitted = this.#read(from)
    if (!submitted) return undefined
    const replacement = createEmptyComposerDraft(this.#createClientId())
    this.#lazy.delete(from)
    this.#lazy.delete(to)
    this.#store.setState((state) => ({
      drafts: { ...state.drafts, [to]: submitted, [from]: replacement },
    }))
    return {
      submitted: cloneDraft(submitted),
      replacement: cloneDraft(replacement),
    }
  }

  clear(key: ComposerDraftKey): ComposerDraft {
    const next = createEmptyComposerDraft(this.#createClientId())
    this.#lazy.delete(key)
    this.#store.setState((state) => ({ drafts: { ...state.drafts, [key]: next } }))
    return cloneDraft(next)
  }

  setSkills(key: ComposerDraftKey, skills: ComposerSkillInvocation[]): ComposerDraft {
    const next = this.update(key, (current) => ({ ...current, skills, skillInvocation: undefined }))
    return next
  }

  addSkill(key: ComposerDraftKey, skill: ComposerSkillInvocation): ComposerDraft {
    const current = this.get(key)
    const skills =
      current.skills ??
      (current.skillInvocation
        ? [current.skillInvocation]
        : skillInvocationsFromComposerDocument(current.document))
    return this.setSkills(
      key,
      skills.some((selected) => selected.path === skill.path) ? skills : [...skills, skill],
    )
  }

  completeSubmission(
    key: ComposerDraftKey,
    consumedClientId: string,
    options: { clearContent: boolean; browserAnnotations?: ComposerDraft['browserAnnotations'] },
  ): ComposerDraft {
    const current = this.#read(key)
    if (!current || current.clientId !== consumedClientId) {
      return current ? cloneDraft(current) : this.get(key)
    }
    const nextClientId = this.#createClientId()
    const remaining = (current.browserAnnotations ?? []).filter(
      (annotation) =>
        current.browserAnnotationFeedback?.[annotation.id] !== undefined ||
        !options.browserAnnotations?.some(
          (consumed) => JSON.stringify(consumed) === JSON.stringify(annotation),
        ),
    )
    const next = options.clearContent
      ? createEmptyComposerDraft(nextClientId)
      : { ...current, clientId: nextClientId }
    next.browserAnnotations = remaining
    next.browserAnnotationImages = (current.browserAnnotationImages ?? []).filter((image) =>
      remaining.some((annotation) => annotation.screenshotName === image.name),
    )
    next.browserAnnotationEditors = current.browserAnnotationEditors
    next.browserAnnotationFeedback = Object.fromEntries(
      Object.entries(current.browserAnnotationFeedback ?? {}).filter(([id]) =>
        remaining.some((annotation) => annotation.id === id),
      ),
    )
    this.#store.setState((state) => ({ drafts: { ...state.drafts, [key]: next } }))
    return cloneDraft(next)
  }

  delete(key: ComposerDraftKey): void {
    this.#lazy.delete(key)
    this.#store.setState((state) => {
      if (!(key in state.drafts) && !(key in state.submitOutcomes)) return state
      const { [key]: _draft, ...drafts } = state.drafts
      const { [key]: _outcome, ...submitOutcomes } = state.submitOutcomes
      return { drafts, submitOutcomes }
    })
  }

  getSubmitOutcome(key: ComposerDraftKey): ComposerSubmitOutcome | null {
    return this.#store.getState().submitOutcomes[key] ?? null
  }

  setSubmitOutcome(key: ComposerDraftKey, outcome: ComposerSubmitOutcome): void {
    this.#store.setState((state) => ({
      submitOutcomes: { ...state.submitOutcomes, [key]: outcome },
    }))
  }

  clearSubmitOutcome(key: ComposerDraftKey): void {
    if (!(key in this.#store.getState().submitOutcomes)) return
    this.#store.setState((state) => {
      const { [key]: _removed, ...submitOutcomes } = state.submitOutcomes
      return { submitOutcomes }
    })
  }

}

/** Session-memory draft registry shared by every Composer placement. */
export const composerDraftStore = new ComposerDraftStore()

export function createEmptyComposerDraft(clientId: string): ComposerDraft {
  return {
    clientId,
    document: createComposerDocument(),
    attachments: [],
    collaborationMode: 'default',
  }
}

export function resolveActivatedSessionComposerInput(
  currentInput: string | undefined,
  draftText: string | undefined,
): string {
  return currentInput?.trim() ? currentInput : (draftText ?? currentInput ?? '')
}

function cloneDocument(document: ComposerDocument): ComposerDocument {
  return {
    text: document.text,
    tokens: document.tokens.map((token) => ({ ...token })),
  }
}

export function cloneDraft(draft: ComposerDraft): ComposerDraft {
  return {
    ...draft,
    document: cloneDocument(draft.document),
    attachments: draft.attachments.map((attachment) => ({ ...attachment })),
    browserAnnotations: draft.browserAnnotations
      ? structuredClone(draft.browserAnnotations)
      : undefined,
    browserAnnotationImages: draft.browserAnnotationImages?.map((image) => ({ ...image })),
    browserAnnotationFeedback: draft.browserAnnotationFeedback
      ? { ...draft.browserAnnotationFeedback }
      : undefined,
    browserAnnotationEditors: draft.browserAnnotationEditors
      ? structuredClone(draft.browserAnnotationEditors)
      : undefined,
    skills: draft.skills?.map((skill) => ({ ...skill })),
    skillInvocation: draft.skillInvocation ? { ...draft.skillInvocation } : undefined,
  }
}

function defaultCreateClientId(): string {
  return globalThis.crypto.randomUUID()
}
