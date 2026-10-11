import {
  getActiveSkillTokenQuery,
  getActiveSlashCommandQuery,
  type ComposerTokenQuery,
} from './ComposerSlashCommands.js'

export type ComposerSuggestionRequest = ComposerTokenQuery & {
  kind: 'slash' | 'skill' | 'mention' | 'plus' | 'review'
  input: string
}

export function getActiveComposerMention(
  input: string,
  selectionStart: number | null,
): ComposerTokenQuery | null {
  if (selectionStart == null || selectionStart <= 0) return null
  const before = input.slice(0, selectionStart)
  const match = before.match(/(?:^|[\s([{])@([^\s@]*)$/u)
  if (!match || /^[\p{L}\p{N}_-]/u.test(input.slice(selectionStart))) return null
  return {
    start: selectionStart - (match[1]?.length ?? 0) - 1,
    end: selectionStart,
    query: match[1] ?? '',
  }
}

export function resolveComposerSuggestionRequest(
  input: string,
  cursor: number | null,
  composing: boolean,
): ComposerSuggestionRequest | null {
  if (composing) return null
  const candidates = [
    ['mention', getActiveComposerMention(input, cursor)],
    ['skill', getActiveSkillTokenQuery(input, cursor)],
    ['slash', getActiveSlashCommandQuery(input, cursor)],
  ] as const
  for (const [kind, range] of candidates) {
    if (range) return { ...range, kind, input }
  }
  return null
}

export function composerSuggestionSignature(request: ComposerSuggestionRequest | null): string {
  return request ? `${request.kind}:${request.start}:${request.end}:${request.input}` : ''
}
