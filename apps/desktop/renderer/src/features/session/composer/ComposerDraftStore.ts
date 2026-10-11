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

export class ComposerDraftStore {
  readonly #drafts = new Map<ComposerDraftKey, ComposerDraft>()
  readonly #submitOutcomes = new Map<ComposerDraftKey, ComposerSubmitOutcome>()
  readonly #listeners = new Set<() => void>()
  readonly #createClientId: CreateClientId

  constructor(createClientId: CreateClientId = defaultCreateClientId) {
    this.#createClientId = createClientId
  }

  get(key: ComposerDraftKey): ComposerDraft {
    const existing = this.#drafts.get(key)
    if (existing) return cloneDraft(existing)
    const created = createEmptyComposerDraft(this.#createClientId())
    this.#drafts.set(key, created)
    return cloneDraft(created)
  }

  peek(key: ComposerDraftKey): ComposerDraft | undefined {
    const draft = this.#drafts.get(key)
    return draft ? cloneDraft(draft) : undefined
  }

  set(key: ComposerDraftKey, draft: ComposerDraft): ComposerDraft {
    const next = cloneDraft(draft)
    this.#drafts.set(key, next)
    return cloneDraft(next)
  }

  update(key: ComposerDraftKey, update: (draft: ComposerDraft) => ComposerDraft): ComposerDraft {
    return this.set(key, update(this.get(key)))
  }
  updateBrowserAnnotations(
    key: ComposerDraftKey,
    update: (draft: ComposerDraft) => ComposerDraft,
  ): ComposerDraft {
    const next = this.update(key, update)
    this.#emit()
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
    this.#emit()
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
    this.#emit()
    return next
  }

  /** Hand a draft to its new session and rotate the source identity atomically. */
  handoff(from: ComposerDraftKey, to: ComposerDraftKey): ComposerDraftHandoff | undefined {
    const submitted = this.#drafts.get(from)
    if (!submitted) return undefined
    const replacement = createEmptyComposerDraft(this.#createClientId())
    this.#drafts.set(to, submitted)
    this.#drafts.set(from, replacement)
    this.#emit()
    return {
      submitted: cloneDraft(submitted),
      replacement: cloneDraft(replacement),
    }
  }

  clear(key: ComposerDraftKey): ComposerDraft {
    const next = createEmptyComposerDraft(this.#createClientId())
    this.#drafts.set(key, next)
    return cloneDraft(next)
  }

  setSkills(key: ComposerDraftKey, skills: ComposerSkillInvocation[]): ComposerDraft {
    const next = this.update(key, (current) => ({ ...current, skills, skillInvocation: undefined }))
    this.#emit()
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
    const current = this.#drafts.get(key)
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
    this.#drafts.set(key, next)
    this.#emit()
    return cloneDraft(next)
  }

  delete(key: ComposerDraftKey): void {
    this.#drafts.delete(key)
    this.clearSubmitOutcome(key)
  }

  getSubmitOutcome(key: ComposerDraftKey): ComposerSubmitOutcome | null {
    return this.#submitOutcomes.get(key) ?? null
  }

  setSubmitOutcome(key: ComposerDraftKey, outcome: ComposerSubmitOutcome): void {
    this.#submitOutcomes.set(key, outcome)
    this.#emit()
  }

  clearSubmitOutcome(key: ComposerDraftKey): void {
    if (!this.#submitOutcomes.delete(key)) return
    this.#emit()
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #emit(): void {
    for (const listener of this.#listeners) listener()
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
