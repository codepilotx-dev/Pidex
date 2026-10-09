import { expect, mock, test } from 'bun:test'
import { strict as assert } from 'node:assert'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// 模块 mock 在独立 Bun 进程中运行，避免影响其他 Provider/client 测试。
if (process.env.PIDEX_OAUTH_UI_TEST === '1') {
  const originalUseState = React.useState
  let seed: unknown = null
  let writes: unknown[] = []
  mock.module('react', () => ({
    ...React,
    useState(initial: unknown) {
      const [value, setValue] = originalUseState(initial === null ? seed : initial)
      return [
        value,
        (next: unknown) => {
          writes.push(next)
          setValue(next)
        },
      ]
    },
  }))
  const waiting = {
    id: 'auth:fixture',
    status: 'waiting',
    prompt: {
      id: 'prompt:fixture',
      type: 'manual_code',
      message: 'Upstream English callback instructions',
    },
    notices: [
      {
        type: 'auth_url',
        url: 'https://example.test/auth',
        instructions: 'Upstream English browser instructions',
      },
    ],
  }
  const calls: string[] = []
  mock.module('../src/services/desktop-client/index.ts', () => ({
    desktopClient: {
      startAuthSession: async () => {
        calls.push('start')
        return waiting
      },
      openExternalURL: async () => {
        calls.push('open')
      },
    },
  }))
  const { useAuthSession: realUseAuthSession } =
    await import('../src/features/provider-management/UseAuthSession.ts')
  let auth = {
    session: waiting,
    value: '',
    busy: false,
    start: async () => {
      calls.push('start')
    },
    cancel: async () => {},
    respond: async () => {},
    setValue: () => {},
  }
  mock.module('../src/features/provider-management/UseAuthSession.ts', () => ({
    useAuthSession: () => auth,
  }))
  const { Button: BaseButton } = await import('../src/components/ui/Button.tsx')
  let buttons: React.ComponentProps<typeof BaseButton>[] = []
  mock.module('../src/components/ui/Button.tsx', () => ({
    Button: (props: React.ComponentProps<typeof BaseButton>) => {
      buttons.push(props)
      return <BaseButton {...props} />
    },
  }))
  const { OAuthConnection } =
    await import('../src/features/models/provider-management/OAuthConnection.tsx')
  const { LocaleProvider } = await import('../src/features/i18n/LocaleProvider.tsx')
  const render = (providerId = 'openai', preference = 'zh-CN', hideHeader = true) => {
    buttons = []
    return renderToStaticMarkup(
      <LocaleProvider preference={preference}>
        <OAuthConnection
          connected={false}
          description="在浏览器完成授权，连接此供应商。"
          target={{ kind: 'provider', providerId }}
          title="使用 ChatGPT 登录"
          hideHeader={hideHeader}
          onChanged={() => {}}
        />
      </LocaleProvider>,
    )
  }
  const html = render()
  assert(
    html.includes('等待浏览器授权') && html.includes('重新打开浏览器') && html.includes('取消登录'),
  )
  assert(html.includes('aria-expanded="false"') && !html.includes('<input'))
  assert(!html.includes('Upstream English') && !html.includes('<h4') && !html.includes('开始授权'))
  const reopen = buttons.find((button) => button.children?.toString().includes('重新打开浏览器'))
  assert(reopen && !reopen.disabled)
  const english = render('openai', 'en-US')
  assert(
    english.includes('Waiting for browser authorization') &&
      english.includes('Having trouble finishing?'),
  )
  assert(render('openai', 'zh-CN', false).includes('<h4'))

  auth = {
    ...auth,
    session: {
      ...waiting,
      notices: [
        ...waiting.notices,
        { type: 'progress', message: 'Exchanging authorization code for tokens...' },
      ],
    },
  }
  assert(render().includes('正在完成登录…'))
  auth = {
    ...auth,
    session: {
      ...waiting,
      prompt: { ...waiting.prompt, type: 'secret', message: 'Provider password' },
      notices: [
        ...waiting.notices,
        { type: 'device_code', userCode: 'ABCD', verificationUri: 'https://example.test/device' },
      ],
    },
  }
  const otherProvider = render('anthropic')
  assert(otherProvider.includes('Provider password') && otherProvider.includes('type="password"'))
  assert(
    otherProvider.includes('ABCD') &&
      otherProvider.includes('Upstream English browser instructions'),
  )
  auth = {
    ...auth,
    session: {
      ...waiting,
      prompt: {
        ...waiting.prompt,
        type: 'select',
        message: 'Select region',
        options: [{ id: 'cn', label: 'China' }],
      },
    },
  }
  assert(render('anthropic').includes('Select region'))
  auth = { ...auth, session: waiting }
  assert(render('openai-codex').includes('<input'))

  auth = { ...auth, session: { ...waiting, status: 'failed' } }
  seed = 'previous error'
  assert(render().includes('previous error'))
  writes = []
  buttons.find((button) => button.children === '在浏览器登录')!.onClick!(
    {} as React.MouseEvent<HTMLButtonElement>,
  )
  assert.equal(writes[0], null)
  assert.equal(calls.at(-1), 'start')

  seed = auth.session
  let hook: ReturnType<typeof realUseAuthSession>
  function HookHarness() {
    hook = realUseAuthSession({ target: { kind: 'provider', providerId: 'openai' } })
    return null
  }
  renderToStaticMarkup(<HookHarness />)
  writes = []
  await hook!.start()
  assert.deepEqual(writes.slice(0, 3), [null, true, ''])
  console.log('OAuth state, folded callback, locale, provider inputs and retry checks passed')
} else {
  test('OAuth 登录状态、折叠回调、中英文与重试清理回归', async () => {
    const child = Bun.spawn([process.execPath, import.meta.filename], {
      env: { ...process.env, PIDEX_OAUTH_UI_TEST: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(stderr).toBe('')
    expect(code).toBe(0)
    expect(stdout).toContain('checks passed')
  }, 15_000)
}
