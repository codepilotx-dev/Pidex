/**
 * Canonical structured delivery result shared by the finalize_result tool
 * declaration (model-facing schema), its runtime validation and the readable
 * delivery text. The validation reuses the shared domain schema so the runtime
 * does not carry a private duplicate of the field contract.
 */

import { Schema } from 'effect'
import { SubagentResultSchema } from '@pidex/shared/thread'
import {
  RESULT_CARD_ENVELOPE_KIND,
  RESULT_CARD_ENVELOPE_VERSION,
  decodeResultCardEnvelope,
  type ResultCardEnvelope,
  type ResultCardSection,
  type ResultCardTone,
} from '@pidex/shared/thread-result-card'
import { Type } from '@earendil-works/pi-ai'
import { AgentError, type SubagentResult } from '../../Domain'

/** Field names of the canonical shared domain schema, for the mirror check. */
export const structuredResultDomainFields = Object.keys(SubagentResultSchema.fields).sort()

const decodeStructuredResult = Schema.decodeUnknownSync(SubagentResultSchema)

/**
 * Parse and validate a raw finalize_result submission. Returns the canonical
 * structured result; throws an AgentError with a model-actionable message on
 * invalid shape or an empty summary. Constraint applies to new submissions
 * only and never rewrites historical data.
 */
export const parseStructuredResult = (input: unknown): SubagentResult => {
  let decoded: unknown
  try {
    decoded = decodeStructuredResult(input)
  } catch {
    throw new AgentError('INVALID_TOOL_INPUT', '结构化结果参数无效：字段缺失或不符合约束', 400)
  }
  // Decoded values are plain JSON arrays/objects; the Effect type is readonly,
  // so the canonical domain shape is restored at the decode boundary.
  const parsed = decoded as SubagentResult
  if (!parsed.summary.trim()) {
    throw new AgentError(
      'INVALID_TOOL_INPUT',
      '结构化结果参数无效：summary 必须是非空的一段交付摘要',
      400,
    )
  }
  return parsed
}

const outcomeLabel: Record<SubagentResult['outcome'], string> = {
  succeeded: '已完成',
  partial: '部分完成',
  blocked: '受阻',
}

const validationLabel: Record<SubagentResult['validation'][number]['status'], string> = {
  passed: '通过',
  failed: '失败',
  skipped: '跳过',
}

/**
 * Deterministic readable delivery text projected from the validated result.
 * Plain summary/validation/risks only; the full arrays stay available in the
 * structured JSON block. Never adds a model call.
 */
export const formatStructuredResult = (result: SubagentResult): string => {
  const lines = [
    `已提交结构化结果（outcome: ${result.outcome} · ${outcomeLabel[result.outcome]}）`,
    `摘要：${result.summary}`,
  ]
  if (result.validation.length > 0) {
    lines.push('验证：')
    for (const item of result.validation) {
      lines.push(`- ${item.command}（${validationLabel[item.status]}）`)
    }
  }
  if (result.risks.length > 0) {
    lines.push('风险：')
    for (const risk of result.risks) lines.push(`- ${risk}`)
  }
  return lines.join('\n')
}

const cardOutcome: Record<SubagentResult['outcome'], { title: string; tone: ResultCardTone }> = {
  succeeded: { title: '任务已完成', tone: 'success' },
  partial: { title: '任务部分完成', tone: 'warning' },
  blocked: { title: '任务受阻', tone: 'danger' },
}

const findingTone: Record<SubagentResult['findings'][number]['severity'], ResultCardTone> = {
  info: 'neutral',
  warning: 'warning',
  error: 'danger',
}

const validationTone: Record<SubagentResult['validation'][number]['status'], ResultCardTone> = {
  passed: 'success',
  failed: 'danger',
  skipped: 'neutral',
}

/**
 * Result-card envelope projected from an already validated and redacted
 * structured result. Pure mapping of existing fields: no new facts, no model
 * call, and empty lists produce no section. The envelope is normalized by the
 * shared decoder so titles, text and collection sizes stay bounded; `null`
 * means the caller must keep the raw structured result instead.
 */
export const resultCardEnvelopeFromStructuredResult = (
  result: SubagentResult,
): ResultCardEnvelope | null => {
  const sections: ResultCardSection[] = []
  if (result.findings.length > 0) {
    sections.push({
      title: '关键结论',
      items: result.findings.map((finding) => ({
        label: finding.title,
        value: finding.detail,
        tone: findingTone[finding.severity],
      })),
    })
  }
  if (result.changedFiles.length > 0) {
    sections.push({
      title: '改动文件',
      items: result.changedFiles.map((file) => ({
        label: file.path,
        value: file.summary,
      })),
    })
  }
  if (result.validation.length > 0) {
    sections.push({
      title: '验证',
      items: result.validation.map((item) => ({
        label: item.command,
        ...(item.output ? { value: item.output } : {}),
        tone: validationTone[item.status],
      })),
    })
  }
  if (result.risks.length > 0) {
    sections.push({
      title: '风险与未决事项',
      items: result.risks.map((risk) => ({ label: risk, tone: 'warning' as ResultCardTone })),
    })
  }
  const outcome = cardOutcome[result.outcome]
  return decodeResultCardEnvelope({
    kind: RESULT_CARD_ENVELOPE_KIND,
    version: RESULT_CARD_ENVELOPE_VERSION,
    card: {
      title: outcome.title,
      summary: result.summary,
      tone: outcome.tone,
      sections,
      references: result.references,
    },
  })
}

/**
 * Full model-facing field schema of the structured result, replacing the old
 * arbitrary-object declaration so the model sees every field up front.
 */
export const structuredResultParameters = Type.Object(
  {
    outcome: Type.Union(
      [Type.Literal('succeeded'), Type.Literal('partial'), Type.Literal('blocked')],
      {
        description:
          '你对任务结果的陈述：succeeded=已完成；partial=部分完成；blocked=受阻或无法继续',
      },
    ),
    summary: Type.String({
      minLength: 1,
      description: '非空的一段交付摘要，说明做了什么、结果如何',
    }),
    findings: Type.Array(
      Type.Object({
        title: Type.String({ description: '结论标题' }),
        detail: Type.String({ description: '结论说明' }),
        severity: Type.Union([
          Type.Literal('info'),
          Type.Literal('warning'),
          Type.Literal('error'),
        ]),
      }),
      { description: '关键结论；没有内容时提交空数组' },
    ),
    changedFiles: Type.Array(
      Type.Object({
        path: Type.String({ description: '改动文件路径' }),
        summary: Type.String({ description: '改动说明' }),
      }),
      { description: '实际改动过的文件；没有内容时提交空数组' },
    ),
    validation: Type.Array(
      Type.Object({
        command: Type.String({ description: '执行的验证命令或验证项' }),
        status: Type.Union([
          Type.Literal('passed'),
          Type.Literal('failed'),
          Type.Literal('skipped'),
        ]),
        output: Type.Optional(Type.String({ description: '验证输出的关键摘要' })),
      }),
      { description: '实际执行过的验证及其结果，禁止编造未执行的验证为通过；没有内容时提交空数组' },
    ),
    risks: Type.Array(Type.String(), { description: '遗留风险或未决事项；没有时提交空数组' }),
    references: Type.Array(
      Type.Object({
        kind: Type.Union([
          Type.Literal('file'),
          Type.Literal('url'),
          Type.Literal('thread'),
          Type.Literal('subagent'),
        ]),
        value: Type.String({ description: '引用地址' }),
        label: Type.Optional(Type.String({ description: '引用标签' })),
      }),
      { description: '结论引用的文件、链接、会话或子 Agent；没有时提交空数组' },
    ),
  },
  {
    description: '结构化交付结果：所有数组字段都必须提供，没有内容就提交空数组',
    additionalProperties: false,
  },
)
