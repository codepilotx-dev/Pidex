import { describe, expect, spyOn, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Tokens } from 'marked'
import { lexMarkdown } from '../src/features/markdown/Parser.js'
import {
  MarkdownMessage,
  markdownTableToCsv,
  saveMarkdownTableCsv,
} from '../src/features/markdown/MarkdownMessage.js'
import { CodeBlock, copyCodeText } from '../src/features/syntax/CodeBlock.js'
import {
  readCodeWrapPreference,
  setCodeWrapPreference,
  subscribeCodeWrapPreference,
} from '../src/features/syntax/WrapPreference.js'
import { desktopClient, desktopClipboard } from '../src/services/desktop-client/index.js'

describe('conversation rich text', () => {
  test('exports Chinese and rich cell text with CSV escaping and formula protection', () => {
    const [token] = lexMarkdown(
      '| 名称 | 内容 |\n| --- | --- |\n| **中文** | a,"b" |\n| 公式 | =SUM(A1) |\n',
    )
    const table = token as Tokens.Table
    table.rows.push([
      { text: '换行', tokens: [{ type: 'text', raw: '换行', text: '换行' }] },
      {
        text: '第一行\n第二行',
        tokens: [{ type: 'text', raw: '第一行\n第二行', text: '第一行\n第二行' }],
      },
    ])
    expect(markdownTableToCsv(table)).toBe(
      '\uFEFF名称,内容\r\n中文,"a,""b"""\r\n公式,\'=SUM(A1)\r\n换行,"第一行\n第二行"',
    )
    table.rows = ['+1', '-1', '@cmd', '  =1', '\tplain'].map((text) => [
      { text, tokens: [{ type: 'text', raw: text, text }] },
    ])
    expect(markdownTableToCsv(table).split('\r\n').slice(1)).toEqual([
      "'+1",
      "'-1",
      "'@cmd",
      "'  =1",
      "'\tplain",
    ])
  })

  test('downloads the complete table through the existing desktop client', async () => {
    const [table] = lexMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |')
    const save = spyOn(desktopClient, 'saveAttachmentToDownloads').mockResolvedValue({
      fileName: 'table.csv',
    })
    try {
      await saveMarkdownTableCsv(table as Tokens.Table)
      expect(save).toHaveBeenCalledWith({
        kind: 'text',
        name: 'table.csv',
        mediaType: 'text/csv',
        encoding: 'utf8',
        data: '\uFEFFA,B\r\n1,2',
      })
      save.mockRejectedValueOnce(new Error('unavailable'))
      await expect(saveMarkdownTableCsv(table as Tokens.Table)).rejects.toThrow('unavailable')
    } finally {
      save.mockRestore()
    }
  })

  test('limits new table controls to conversation presentation', () => {
    const text = '| A |\n| --- |\n| 值 |'
    expect(renderToStaticMarkup(<MarkdownMessage text={text} />)).not.toContain('下载 CSV')
    const html = renderToStaticMarkup(<MarkdownMessage presentation="conversation" text={text} />)
    expect(html).toContain('md-body--conversation')
    expect(html).toContain('下载 CSV')
    expect(html).toContain('scope="col"')
  })

  test('shares wrap preference between subscribers and copies original code', async () => {
    setCodeWrapPreference(false)
    let first = 0
    let second = 0
    const unsubscribeFirst = subscribeCodeWrapPreference(() => {
      first++
    })
    const unsubscribeSecond = subscribeCodeWrapPreference(() => {
      second++
    })
    const copy = spyOn(desktopClipboard, 'writeText').mockResolvedValue(undefined)
    try {
      setCodeWrapPreference(true)
      expect(readCodeWrapPreference()).toBe(true)
      expect([first, second]).toEqual([1, 1])
      unsubscribeFirst()
      setCodeWrapPreference(false)
      expect([first, second]).toEqual([1, 2])
      const code = '  long code\n\tsecond line\n'
      await copyCodeText(code)
      expect(copy).toHaveBeenCalledWith(code)
      expect(renderToStaticMarkup(<CodeBlock code={code} />)).not.toContain('代码自动换行')
      expect(renderToStaticMarkup(<CodeBlock code={code} showWrapControl />)).toContain(
        'aria-pressed="false"',
      )
    } finally {
      unsubscribeFirst()
      unsubscribeSecond()
      setCodeWrapPreference(false)
      copy.mockRestore()
    }
  })
})
