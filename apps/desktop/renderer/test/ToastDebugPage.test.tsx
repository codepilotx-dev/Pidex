import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ToastDebugPage } from '../src/components/toast/ToastDebugPage.js'
import { toastStore } from '../src/components/toast/ToastState.js'

test('平铺预览不占用或淘汰全局业务通知', () => {
  const id = toastStore.show({ id: 'debug-page-business-notice', tone: 'status', message: '真实业务通知' })
  const before = toastStore.getState().toasts
  try {
    const markup = renderToStaticMarkup(<MemoryRouter><ToastDebugPage /></MemoryRouter>)
    expect(markup).toContain('Toast 调试')
    expect(toastStore.getState().toasts).toBe(before)
  } finally {
    toastStore.dismiss(id)
  }
})
