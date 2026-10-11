const SECRET_KEY =
  /(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|credential|private[_-]?key)/i
const SECRET_NAME =
  '(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|credential|private[_-]?key)'
const JSON_SECRET = new RegExp(
  `(["']${SECRET_NAME}["']\\s*:\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')`,
  'gi',
)
const QUOTED_ASSIGNMENT = new RegExp(
  `(${SECRET_NAME}\\s*[=:]\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')`,
  'gi',
)
const BARE_ASSIGNMENT = new RegExp(`(${SECRET_NAME}\\s*[=:]\\s*)[^,;\\r\\n]+`, 'gi')
const AUTHORIZATION =
  /(authorization\s*:\s*)(?:(?:bearer|basic|token)\s+)?(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n,;]+)/gi
const KNOWN_TOKEN = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/g

export class SecretScrubber {
  scrubText(value: string) {
    return value
      .replace(JSON_SECRET, '$1"<redacted>"')
      .replace(QUOTED_ASSIGNMENT, '$1<redacted>')
      .replace(BARE_ASSIGNMENT, '$1<redacted>')
      .replace(AUTHORIZATION, '$1<redacted>')
      .replace(KNOWN_TOKEN, '<redacted>')
  }

  /** Opaque SDK state cannot be rewritten without invalidating its integrity. */
  assertSafeOpaqueState(value: string) {
    const scrubbed = this.scrubText(value)
    if (scrubbed !== value) throw new Error('Opaque RunState 包含无法安全持久化的凭据')
    return value
  }

  scrub<T>(value: T): T {
    if (typeof value === 'string') return this.scrubText(value) as T
    if (Array.isArray(value)) return value.map((item) => this.scrub(item)) as T
    if (!value || typeof value !== 'object') return value
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value))
      output[key] = SECRET_KEY.test(key) ? '<redacted>' : this.scrub(item)
    return output as T
  }
}

export const secretScrubber = new SecretScrubber()
