/**
 * Display-neutral result-card envelope shared by the Agent and every client.
 *
 * A provider tool result (or an agent delivery result) may carry an explicit
 * Pidex envelope inside its JSON result block. Clients only render a card
 * for data that carries the exact marker below and survives the normalization
 * in `decodeResultCardEnvelope`; every other JSON value keeps the existing
 * code-block presentation, so no client ever guesses a schema from arbitrary
 * JSON.
 *
 * This module is intentionally dependency-free: the renderer and the Electron
 * main process import it directly through the `@pidex/shared/thread-result-card`
 * entry so a JSON projection never pulls the Effect runtime into a UI bundle.
 */

export const RESULT_CARD_ENVELOPE_KIND = 'pidex.result-card'
export const RESULT_CARD_ENVELOPE_VERSION = 1

/** Titles are bounded tighter than free text to keep card headers single-line. */
export const RESULT_CARD_TITLE_MAX_LENGTH = 120
export const RESULT_CARD_TEXT_MAX_LENGTH = 4_000

/** Upper bound per collection so untrusted tools cannot produce unbounded UI. */
export const RESULT_CARD_MAX_SECTIONS = 20
export const RESULT_CARD_MAX_ITEMS = 20
export const RESULT_CARD_MAX_REFERENCES = 20

export type ResultCardTone = 'neutral' | 'success' | 'warning' | 'danger'

export const RESULT_CARD_TONES: readonly ResultCardTone[] = [
  'neutral',
  'success',
  'warning',
  'danger',
]

export type ResultCardReferenceKind = 'file' | 'url' | 'thread' | 'subagent'

export const RESULT_CARD_REFERENCE_KINDS: readonly ResultCardReferenceKind[] = [
  'file',
  'url',
  'thread',
  'subagent',
]

export type ResultCardItem = {
  label: string
  value?: string
  tone?: ResultCardTone
}

export type ResultCardSection = {
  title: string
  items: ResultCardItem[]
}

export type ResultCardReference = {
  kind: ResultCardReferenceKind
  value: string
  label?: string
}

export type ResultCard = {
  title: string
  summary: string
  tone: ResultCardTone
  sections: ResultCardSection[]
  references: ResultCardReference[]
}

export type ResultCardEnvelope = {
  kind: typeof RESULT_CARD_ENVELOPE_KIND
  version: typeof RESULT_CARD_ENVELOPE_VERSION
  card: ResultCard
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** Trimmed, non-empty, length-clamped text; `null` when nothing usable remains. */
const requiredText = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

const optionalText = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

const decodeTone = (value: unknown): ResultCardTone | null =>
  typeof value === 'string' && (RESULT_CARD_TONES as readonly string[]).includes(value)
    ? (value as ResultCardTone)
    : null

const decodeItem = (value: unknown): ResultCardItem | null => {
  const source = record(value)
  if (!source) return null
  const label = requiredText(source.label, RESULT_CARD_TITLE_MAX_LENGTH)
  if (!label) return null
  const itemValue = optionalText(source.value, RESULT_CARD_TEXT_MAX_LENGTH)
  const tone = decodeTone(source.tone)
  return {
    label,
    ...(itemValue === undefined ? {} : { value: itemValue }),
    ...(tone === null ? {} : { tone }),
  }
}

/** Sections without a usable item are dropped so the card never renders an empty list. */
const decodeSection = (value: unknown): ResultCardSection | null => {
  const source = record(value)
  if (!source) return null
  const title = requiredText(source.title, RESULT_CARD_TITLE_MAX_LENGTH)
  if (!title) return null
  const candidates = Array.isArray(source.items) ? source.items : []
  const items = candidates
    .flatMap((candidate) => {
      const item = decodeItem(candidate)
      return item ? [item] : []
    })
    .slice(0, RESULT_CARD_MAX_ITEMS)
  return items.length ? { title, items } : null
}

const decodeReference = (value: unknown): ResultCardReference | null => {
  const source = record(value)
  if (!source) return null
  const kind =
    typeof source.kind === 'string' &&
    (RESULT_CARD_REFERENCE_KINDS as readonly string[]).includes(source.kind)
      ? (source.kind as ResultCardReferenceKind)
      : null
  if (kind === null) return null
  const referenceValue = requiredText(source.value, RESULT_CARD_TEXT_MAX_LENGTH)
  if (!referenceValue) return null
  const label = optionalText(source.label, RESULT_CARD_TITLE_MAX_LENGTH)
  return {
    kind,
    value: referenceValue,
    ...(label === undefined ? {} : { label }),
  }
}

/**
 * Normalizing decoder for the result-card envelope.
 *
 * Returns the canonical card when the value carries the exact `kind` and
 * `version` marker plus non-empty title and summary; returns `null` for every
 * other value (plain JSON, forged marker, unknown version, invalid shape), so
 * callers degrade to the existing raw JSON presentation instead of throwing.
 * Text is trimmed and clamped, collections are bounded and malformed entries
 * are dropped — the returned envelope is always safe to render.
 */
export const decodeResultCardEnvelope = (value: unknown): ResultCardEnvelope | null => {
  const source = record(value)
  if (!source) return null
  if (source.kind !== RESULT_CARD_ENVELOPE_KIND) return null
  if (source.version !== RESULT_CARD_ENVELOPE_VERSION) return null
  const card = record(source.card)
  if (!card) return null
  const title = requiredText(card.title, RESULT_CARD_TITLE_MAX_LENGTH)
  if (!title) return null
  const summary = requiredText(card.summary, RESULT_CARD_TEXT_MAX_LENGTH)
  if (!summary) return null
  const sections = (Array.isArray(card.sections) ? card.sections : [])
    .flatMap((candidate) => {
      const section = decodeSection(candidate)
      return section ? [section] : []
    })
    .slice(0, RESULT_CARD_MAX_SECTIONS)
  const references = (Array.isArray(card.references) ? card.references : [])
    .flatMap((candidate) => {
      const reference = decodeReference(candidate)
      return reference ? [reference] : []
    })
    .slice(0, RESULT_CARD_MAX_REFERENCES)
  return {
    kind: RESULT_CARD_ENVELOPE_KIND,
    version: RESULT_CARD_ENVELOPE_VERSION,
    card: {
      title,
      summary,
      tone: decodeTone(card.tone) ?? 'neutral',
      sections,
      references,
    },
  }
}
