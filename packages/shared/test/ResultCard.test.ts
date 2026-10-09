import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { ResultCardEnvelopeSchema, ToolResultBlockSchema } from '@pidex/shared/thread'
import {
  RESULT_CARD_ENVELOPE_KIND,
  RESULT_CARD_ENVELOPE_VERSION,
  RESULT_CARD_MAX_ITEMS,
  RESULT_CARD_MAX_REFERENCES,
  RESULT_CARD_MAX_SECTIONS,
  RESULT_CARD_TEXT_MAX_LENGTH,
  RESULT_CARD_TITLE_MAX_LENGTH,
  decodeResultCardEnvelope,
} from '@pidex/shared/thread-result-card'

const card = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  title: '任务已完成',
  summary: '完成查询工具回归并修复参数校验',
  tone: 'success',
  sections: [
    {
      title: '关键结论',
      items: [{ label: '修复了校验边界', value: '空参数不再通过', tone: 'neutral' }],
    },
  ],
  references: [{ kind: 'file', value: 'src/tool/tool.ts', label: '改动文件' }],
  ...overrides,
})

const envelope = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: RESULT_CARD_ENVELOPE_KIND,
  version: RESULT_CARD_ENVELOPE_VERSION,
  card: card(),
  ...overrides,
})

const decodeEnvelopeSchema = Schema.decodeUnknownSync(ResultCardEnvelopeSchema)

describe('result card envelope contract', () => {
  test('合法 v1 信封按共享 schema 与归一化解码器同时通过', () => {
    const decoded = decodeResultCardEnvelope(envelope())
    expect(decoded).toEqual({
      kind: RESULT_CARD_ENVELOPE_KIND,
      version: 1,
      card: card(),
    })
    expect(decodeEnvelopeSchema(envelope())).toEqual(decoded)
  })

  test('错误 marker、未知 version、空标题和不完整结构被拒绝', () => {
    const rejected: unknown[] = [
      envelope({ kind: 'pidex.other-card' }),
      envelope({ version: 2 }),
      envelope({ version: '1' }),
      envelope({ card: card({ title: '   ' }) }),
      envelope({ card: card({ title: undefined }) }),
      envelope({ card: card({ summary: '' }) }),
      envelope({ card: undefined }),
      { kind: RESULT_CARD_ENVELOPE_KIND, version: RESULT_CARD_ENVELOPE_VERSION },
      [envelope()],
      'pidex.result-card',
      null,
    ]
    for (const value of rejected) {
      expect(decodeResultCardEnvelope(value)).toBeNull()
      expect(() => decodeEnvelopeSchema(value)).toThrow()
    }
    // 缺失非必需字段时归一化解码器补默认值，严格 schema 仍然拒绝。
    const sparse = decodeResultCardEnvelope({
      kind: RESULT_CARD_ENVELOPE_KIND,
      version: RESULT_CARD_ENVELOPE_VERSION,
      card: { title: '任务受阻', summary: '缺少可选字段' },
    })
    expect(sparse).toEqual({
      kind: RESULT_CARD_ENVELOPE_KIND,
      version: 1,
      card: {
        title: '任务受阻',
        summary: '缺少可选字段',
        tone: 'neutral',
        sections: [],
        references: [],
      },
    })
    expect(() =>
      decodeEnvelopeSchema({
        kind: RESULT_CARD_ENVELOPE_KIND,
        version: RESULT_CARD_ENVELOPE_VERSION,
        card: { title: '任务受阻', summary: '缺少可选字段' },
      }),
    ).toThrow()
  })

  test('去首尾空白并裁剪超长文本与超量列表', () => {
    const decoded = decodeResultCardEnvelope(
      envelope({
        card: card({
          title: `  ${'标'.repeat(RESULT_CARD_TITLE_MAX_LENGTH + 50)}  `,
          summary: `  ${'摘'.repeat(RESULT_CARD_TEXT_MAX_LENGTH + 50)}  `,
          sections: Array.from({ length: RESULT_CARD_MAX_SECTIONS + 5 }, (_, section) => ({
            title: `第 ${section} 节`,
            items: Array.from({ length: RESULT_CARD_MAX_ITEMS + 5 }, (_, item) => ({
              label: `条目 ${item}`,
              value: `值 ${item}`,
            })),
          })),
          references: Array.from({ length: RESULT_CARD_MAX_REFERENCES + 5 }, (_, index) => ({
            kind: 'url',
            value: `https://example.com/${index}`,
          })),
        }),
      }),
    )
    expect(decoded).not.toBeNull()
    expect(decoded!.card.title).toHaveLength(RESULT_CARD_TITLE_MAX_LENGTH)
    expect(decoded!.card.summary).toHaveLength(RESULT_CARD_TEXT_MAX_LENGTH)
    expect(decoded!.card.sections).toHaveLength(RESULT_CARD_MAX_SECTIONS)
    expect(decoded!.card.sections[0]!.items).toHaveLength(RESULT_CARD_MAX_ITEMS)
    expect(decoded!.card.references).toHaveLength(RESULT_CARD_MAX_REFERENCES)
    expect(decoded!.card.title.startsWith('标')).toBe(true)
    expect(decoded!.card.summary.startsWith('摘')).toBe(true)
  })

  test('畸形条目被丢弃，空 section 不输出', () => {
    const decoded = decodeResultCardEnvelope(
      envelope({
        card: card({
          tone: 'unknown-tone',
          sections: [
            { title: '有效', items: [{ label: '保留' }, { value: '只有值' }, '', null] },
            { title: '  ', items: [{ label: '不保留' }] },
            { title: '空节', items: [] },
          ],
          references: [
            { kind: 'file', value: 'src/a.ts' },
            { kind: 'shell', value: 'rm -rf /' },
            { kind: 'url', value: '' },
            { value: 'https://example.com' },
          ],
        }),
      }),
    )
    expect(decoded!.card.tone).toBe('neutral')
    expect(decoded!.card.sections).toEqual([{ title: '有效', items: [{ label: '保留' }] }])
    expect(decoded!.card.references).toEqual([{ kind: 'file', value: 'src/a.ts' }])
  })

  test('普通 JSON 不会被识别为卡片，且仍是合法的 json 结果块', () => {
    const plain = { items: [{ id: 1, ok: true }] }
    expect(decodeResultCardEnvelope(plain)).toBeNull()
    expect(decodeResultCardEnvelope(undefined)).toBeNull()
    expect(decodeResultCardEnvelope({ kind: RESULT_CARD_ENVELOPE_KIND })).toBeNull()
    expect(Schema.decodeUnknownSync(ToolResultBlockSchema)({ type: 'json', value: plain })).toEqual(
      { type: 'json', value: plain },
    )
  })
})
