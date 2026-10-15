import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ToastContent } from '../src/components/toast/ToastContent.js'

test('toast keeps technical details collapsed without losing the original error', () => {
  const message = 'AgentRpcError: Agent 内部错误\n    at Object.call (http://127.0.0.1/AgentRpcClient.ts:98:13)'
  const markup = renderToStaticMarkup(<ToastContent message={message} isError />)
  expect(markup).toContain('Agent 发生内部错误，请重试。')
  expect(markup).toContain('<details')
  expect(markup).not.toContain('<details open')
  expect(markup).toContain('查看详情')
  expect(markup).toContain(message)

  const shortMarkup = renderToStaticMarkup(<ToastContent message="凭据鉴权失败" isError />)
  expect(shortMarkup).toContain('凭据鉴权失败')
  expect(shortMarkup).not.toContain('<details')
  expect(shortMarkup).not.toContain('line-clamp-2')

  const longMarkup = renderToStaticMarkup(<ToastContent message={'长通知'.repeat(70)} isError={false} />)
  expect(longMarkup).toContain('<details')
  expect(longMarkup).toContain('长通知'.repeat(70))

  const actionMarkup = renderToStaticMarkup(<ToastContent message={<span>已归档的聊天</span>} isError={false} />)
  expect(actionMarkup).toContain('<span>已归档的聊天</span>')
  expect(actionMarkup).not.toContain('line-clamp-2')
})
