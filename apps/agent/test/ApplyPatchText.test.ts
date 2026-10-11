import { describe, expect, test } from 'bun:test'
import { applyPatchText } from '../src/tool/ApplyPatch/ApplyPatchText'
import { parseApplyPatch } from '../src/tool/ApplyPatch/ParseApplyPatch'

describe('apply_patch parser', () => {
  test('parses Add File and multi-hunk Update File with CRLF input', () => {
    const operations = parseApplyPatch(
      [
        '*** Begin Patch',
        '*** Add File: added.txt',
        '+first',
        '+second',
        '*** Update File: source.txt',
        '@@ first',
        '-old',
        '+new',
        '@@',
        ' tail',
        '+after',
        '*** End of File',
        '*** End Patch',
        '',
      ].join('\r\n'),
    )

    expect(operations).toEqual([
      { type: 'add', path: 'added.txt', content: 'first\nsecond\n' },
      {
        type: 'update',
        path: 'source.txt',
        chunks: [
          {
            changeContext: 'first',
            oldLines: ['old'],
            newLines: ['new'],
            additions: 1,
            deletions: 1,
            patchLine: 6,
          },
          {
            oldLines: ['tail'],
            newLines: ['tail', 'after'],
            additions: 1,
            deletions: 0,
            endOfFile: true,
            patchLine: 9,
          },
        ],
      },
    ])
  })

  test('rejects unsupported delete and move operations', () => {
    expect(() =>
      parseApplyPatch(['*** Begin Patch', '*** Delete File: old.txt', '*** End Patch'].join('\n')),
    ).toThrow(expect.objectContaining({ code: 'PATCH_UNSUPPORTED_OPERATION' }))

    expect(() =>
      parseApplyPatch(
        [
          '*** Begin Patch',
          '*** Update File: old.txt',
          '*** Move to: next.txt',
          '@@',
          '-old',
          '+next',
          '*** End Patch',
        ].join('\n'),
      ),
    ).toThrow(expect.objectContaining({ code: 'PATCH_UNSUPPORTED_OPERATION' }))
  })

  test('rejects duplicate normalized paths and trailing garbage', () => {
    expect(() =>
      parseApplyPatch(
        [
          '*** Begin Patch',
          '*** Add File: ./same.txt',
          '+one',
          '*** Update File: same.txt',
          '@@',
          '-one',
          '+two',
          '*** End Patch',
        ].join('\n'),
      ),
    ).toThrow(expect.objectContaining({ code: 'PATCH_DUPLICATE_PATH' }))

    expect(() =>
      parseApplyPatch(
        ['*** Begin Patch', '*** Add File: file.txt', '+content', '*** End Patch', 'garbage'].join(
          '\n',
        ),
      ),
    ).toThrow(expect.objectContaining({ code: 'PATCH_PARSE_ERROR' }))
  })

  test('rejects an unanchored insertion hunk', () => {
    expect(() =>
      parseApplyPatch(
        ['*** Begin Patch', '*** Update File: source.txt', '@@', '+inserted', '*** End Patch'].join(
          '\n',
        ),
      ),
    ).toThrow(expect.objectContaining({ code: 'PATCH_PARSE_ERROR' }))
  })

  test('parses a standard unified hunk header without treating its section as change context', () => {
    const operation = parseApplyPatch(
      [
        '*** Begin Patch',
        '*** Update File: source.txt',
        '@@ -29,3 +29,2 @@ function section',
        ' before',
        '-old',
        ' after',
        '*** End Patch',
      ].join('\n'),
    )[0]

    expect(operation).toEqual({
      type: 'update',
      path: 'source.txt',
      chunks: [
        {
          oldStartLine: 29,
          oldLines: ['before', 'old', 'after'],
          newLines: ['before', 'after'],
          additions: 0,
          deletions: 1,
          patchLine: 3,
        },
      ],
    })
    if (operation?.type !== 'update') throw new Error('expected update')
    expect(applyPatchText('source.txt', operation.chunks, 'before\nold\nafter\n').content).toBe(
      'before\nafter\n',
    )
  })

  test('validates the old and new line counts declared by a unified hunk header', () => {
    expect(() =>
      parseApplyPatch(
        [
          '*** Begin Patch',
          '*** Update File: source.txt',
          '@@ -2,2 +2,1 @@',
          '-old',
          '+new',
          '*** End Patch',
        ].join('\n'),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'PATCH_PARSE_ERROR',
        message: expect.stringContaining('旧文件 2 行'),
      }),
    )

    expect(() =>
      parseApplyPatch(
        [
          '*** Begin Patch',
          '*** Update File: source.txt',
          '@@ -2 +2,2 @@',
          '-old',
          '+new',
          '*** End Patch',
        ].join('\n'),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'PATCH_PARSE_ERROR',
        message: expect.stringContaining('新文件 2 行'),
      }),
    )
  })
})

describe('apply_patch deterministic matcher', () => {
  test('applies multiple exact hunks while preserving BOM and local CRLF', () => {
    const operation = parseApplyPatch(
      [
        '*** Begin Patch',
        '*** Update File: source.txt',
        '@@ alpha',
        '-old',
        '+new',
        '@@',
        '-tail',
        '+after',
        '*** End of File',
        '*** End Patch',
      ].join('\n'),
    )[0]
    if (operation?.type !== 'update') throw new Error('expected update')

    const result = applyPatchText(
      'source.txt',
      operation.chunks,
      '\uFEFFalpha\r\nold\r\nmiddle\r\ntail\r\n',
    )
    expect(result.content).toBe('\uFEFFalpha\r\nnew\r\nmiddle\r\nafter\r\n')
    expect(result.changes).toEqual([
      { hunk: 1, startLine: 2, endLine: 2 },
      { hunk: 2, startLine: 4, endLine: 4 },
    ])
  })

  test('uses End of File to target the final exact occurrence', () => {
    const result = applyPatchText(
      'source.txt',
      [
        {
          oldLines: ['same', 'tail'],
          newLines: ['last'],
          additions: 1,
          deletions: 2,
          endOfFile: true,
          patchLine: 1,
        },
      ],
      'same\ntail\nsame\ntail\n',
    )
    expect(result.content).toBe('same\ntail\nlast\n')
  })

  test('rejects ambiguous exact context instead of taking the first match', () => {
    expect(() =>
      applyPatchText(
        'source.txt',
        [
          {
            oldLines: ['same'],
            newLines: ['next'],
            additions: 1,
            deletions: 1,
            patchLine: 1,
          },
        ],
        'same\nmiddle\nsame\n',
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'PATCH_CONTEXT_AMBIGUOUS',
        message: expect.stringContaining('命中 2 处'),
      }),
    )
  })

  test('uses an exact unified old-line hint to disambiguate exact context matches', () => {
    const result = applyPatchText(
      'source.txt',
      [
        {
          oldStartLine: 3,
          oldLines: ['same'],
          newLines: ['next'],
          additions: 1,
          deletions: 1,
          patchLine: 1,
        },
      ],
      'same\nmiddle\nsame\n',
    )

    expect(result.content).toBe('same\nmiddle\nnext\n')
  })

  test('does not use an inexact unified line hint to choose an ambiguous match', () => {
    expect(() =>
      applyPatchText(
        'source.txt',
        [
          {
            oldStartLine: 2,
            oldLines: ['same'],
            newLines: ['next'],
            additions: 1,
            deletions: 1,
            patchLine: 1,
          },
        ],
        'same\nmiddle\nsame\n',
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'PATCH_CONTEXT_AMBIGUOUS',
        message: expect.stringContaining('命中 2 处'),
      }),
    )
  })

  test('rejects overlapping hunks with a dedicated error', () => {
    expect(() =>
      applyPatchText(
        'source.txt',
        [
          { oldLines: ['b', 'c'], newLines: ['bc'], additions: 1, deletions: 2, patchLine: 1 },
          { oldLines: ['c', 'd'], newLines: ['cd'], additions: 1, deletions: 2, patchLine: 2 },
        ],
        'a\nb\nc\nd\n',
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'PATCH_OVERLAPPING_HUNKS',
      }),
    )
  })

  test('does not use whitespace or Unicode fuzzy matching', () => {
    expect(() =>
      applyPatchText(
        'source.txt',
        [
          {
            oldLines: ['target'],
            newLines: ['next'],
            additions: 1,
            deletions: 1,
            patchLine: 1,
          },
        ],
        ' target \n',
      ),
    ).toThrow(expect.objectContaining({ code: 'PATCH_CONTEXT_NOT_FOUND' }))
  })
})
