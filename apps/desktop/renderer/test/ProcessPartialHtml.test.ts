import { describe, expect, test } from 'bun:test'
import { processPartialHtml } from '../src/features/visualization/ProcessPartialHtml'

describe('processPartialHtml', () => {
  test('drops a trailing incomplete tag so a half-streamed tag never renders', () => {
    expect(processPartialHtml('<p>done</p><div class="car')).toBe('<p>done</p>')
    expect(processPartialHtml('<p>complete</p>')).toBe('<p>complete</p>')
  })

  test('removes container blocks whether closed or still streaming', () => {
    expect(processPartialHtml('<style>a{}</style><p>hi</p>')).toBe('<p>hi</p>')
    expect(processPartialHtml('<script>var a = 1')).toBe('')
    expect(processPartialHtml('<head><title>t</title></head><b>ok</b>')).toBe('<b>ok</b>')
    expect(processPartialHtml('text<style>x</style>')).toBe('text')
  })

  test('keeps only the body when the stream already emitted one', () => {
    expect(processPartialHtml('<html><body><p>a</p></body></html>')).toBe('<p>a</p>')
    expect(processPartialHtml('<body><p>streaming')).toBe('<p>streaming')
  })

  test('nested tags do not survive a single replacement pass', () => {
    // 旧的一次性 `<[^>]*>` 替换会在嵌套标签上把内部内容整段吃掉。
    expect(processPartialHtml('<p><span>a</span></p>')).toBe('<p><span>a</span></p>')
    expect(processPartialHtml('<scr<script>ipt>x</script>')).toBe('<scr<script>ipt>x</script>')
  })

  test('drops a trailing incomplete entity reference', () => {
    expect(processPartialHtml('<p>keep&am')).toBe('<p>keep')
  })
})
