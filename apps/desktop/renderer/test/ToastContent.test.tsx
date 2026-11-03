import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ToastContent } from '../src/components/toast/ToastContent.js'
import { createToastStore } from '../src/components/toast/ToastState.js'

test('错误原文移入详情，Toast 仅渲染短摘要且不使用长文本悬浮提示', () => {
  const message =
    'AgentRpcError: Agent 内部错误\n    at Object.call (http://127.0.0.1/AgentRpcClient.ts:98:13)'
  const store = createToastStore()
  store.show({ message })
  const item = store.getState().toasts[0]!
  expect(item.message).toBe('Agent 发生内部错误，请重试。')
  expect(item.details).toBe(message)
  const markup = renderToStaticMarkup(<ToastContent message={item.message} />)
  expect(markup).toContain('Agent 发生内部错误，请重试。')
  expect(markup).not.toContain('<details')
  expect(markup).not.toContain('title=')
  expect(markup).not.toContain('AgentRpcClient.ts')
})

test('普通长通知保留原文作为详情，自定义正文仍按传入内容渲染', () => {
  const store = createToastStore()
  const original = '长通知'.repeat(70)
  store.show({ tone: 'info', message: original })
  expect(store.getState().toasts[0]).toMatchObject({
    message: '操作结果已更新，点击查看详情',
    details: original,
  })
  const markup = renderToStaticMarkup(<ToastContent message={<span>已归档的聊天</span>} />)
  expect(markup).toContain('<span>已归档的聊天</span>')
})
