export type ProposedPlanChunk = { kind: 'text'; delta: string } | { kind: 'plan'; delta: string }

const OPEN_TAG = /^\s*<proposed_plan>\s*$/
const CLOSE_TAG = /^\s*<\/proposed_plan>\s*$/

/**
 * Incrementally removes proposed-plan wrapper lines while preserving all other
 * assistant text. A completed later block replaces an earlier block as the
 * authoritative plan, matching Codex's final-item reconciliation semantics.
 */
export class ProposedPlanStreamParser {
  private buffer = ''
  private mode: 'text' | 'plan' = 'text'
  private text = ''
  private currentPlan = ''
  private completedPlan: string | null = null

  push(delta: string): ProposedPlanChunk[] {
    if (!delta) return []
    this.buffer += delta
    const chunks: ProposedPlanChunk[] = []
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline + 1)
      this.buffer = this.buffer.slice(newline + 1)
      this.consumeLine(line, chunks)
      newline = this.buffer.indexOf('\n')
    }
    return chunks
  }

  finish(): { chunks: ProposedPlanChunk[]; text: string; plan: string | null } {
    const chunks: ProposedPlanChunk[] = []
    if (this.buffer) {
      this.consumeLine(this.buffer, chunks)
      this.buffer = ''
    }
    if (this.mode === 'plan') this.completeCurrentPlan()
    const plan = this.completedPlan?.trim()
    return {
      chunks,
      text: this.text.trim(),
      plan: plan ? plan : null,
    }
  }

  private consumeLine(line: string, chunks: ProposedPlanChunk[]) {
    const withoutNewline = line.replace(/\r?\n$/, '')
    if (OPEN_TAG.test(withoutNewline)) {
      if (this.mode === 'plan') this.completeCurrentPlan()
      this.mode = 'plan'
      this.currentPlan = ''
      return
    }
    if (CLOSE_TAG.test(withoutNewline) && this.mode === 'plan') {
      this.completeCurrentPlan()
      this.mode = 'text'
      return
    }
    if (this.mode === 'plan') {
      this.currentPlan += line
      chunks.push({ kind: 'plan', delta: line })
      return
    }
    this.text += line
    chunks.push({ kind: 'text', delta: line })
  }

  private completeCurrentPlan() {
    if (this.currentPlan.trim()) this.completedPlan = this.currentPlan
  }
}

export const proposedPlanTitle = (markdown: string) => {
  const heading = markdown.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim()
  return heading || '实施计划'
}
