// Run: bun apps/desktop/renderer/test/ThreadScrollLifecycle.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { compileEntryStyles } from './helpers/RendererStyles.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const timeline = JSON.stringify(
  resolve(root, 'src/features/session/timeline/SessionTimelineView.tsx').replaceAll('\\', '/'),
)
const layout = JSON.stringify(
  resolve(root, 'src/features/session/conversation/ThreadScrollLayout.tsx').replaceAll('\\', '/'),
)
const summary = JSON.stringify(
  resolve(root, 'src/features/session/composer/ComposerChangeSummary.tsx').replaceAll('\\', '/'),
)
const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {SessionTimelineView} from ${timeline};
import {ThreadScrollLayout} from ${layout};
import {ComposerChangeSummary} from ${summary};
const fixture = window.fixture = {};
function App() {
  const [session, setSession] = React.useState('a');
  const [loaded, setLoaded] = React.useState(true);
  const [active, setActive] = React.useState(true);
  const [canReturn, setCanReturn] = React.useState(false);
  const scrollRef = React.useRef(null);
  const footerRef = React.useRef(null);
  const navigationRef = React.useRef(null);
  fixture.switchSession = (id, ready = true) => { setSession(id); setLoaded(ready); };
  fixture.load = () => setLoaded(true);
  fixture.idle = () => setActive(false);
  fixture.bottom = () => navigationRef.current.returnToBottom();
  const items = React.useMemo(() => loaded ? Array.from({length:80}, (_, i) => i) : [], [loaded]);
  return <div className="conversation-page" style={{height:400, display:'flex', flexDirection:'column'}}>
    <ThreadScrollLayout scrollRef={scrollRef} footerRef={footerRef} footer={<div>
      {canReturn ? <ComposerChangeSummary executionPlan={null} changedFiles={[]} active={active}
        failed={false} additions={null} deletions={null} canReturnToBottom
        onOpenReview={() => {}} onOpenReviewFile={() => {}}
        onReturnToBottom={() => navigationRef.current.returnToBottom()}/> : null}
      <div style={{height:100}}>composer</div></div>}>
    <SessionTimelineView key={session} sessionKey={session} scrollRef={scrollRef}
      navigationRef={navigationRef} items={items} count={items.length} scrollToBottom={active}
      onCanReturnToBottomChange={setCanReturn}
      renderItem={i => <div key={i} style={{height:80}} data-turn-navigation-id={'turn-'+i}>row {i}</div>}/>
    </ThreadScrollLayout></div>;
}
createRoot(document.getElementById('root')).render(<App/>);
`
async function serveFixture() {
  console.log('Building scroll lifecycle fixture')
  const build = await Bun.build({
    entrypoints: ['scroll-lifecycle-fixture'],
    target: 'browser',
    format: 'iife',
    define: {
      'process.env.NODE_ENV': '"development"',
      'import.meta.env': '{"DEV":true}',
      'import.meta.hot': 'undefined',
    },
    plugins: [
      {
        name: 'fixture',
        setup(builder) {
          builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (args) => ({
            path: Bun.resolveSync(args.path, root),
            namespace: 'file',
          }))
          builder.onResolve({ filter: /^scroll-lifecycle-fixture$/ }, () => ({
            path: 'fixture',
            namespace: 'fixture',
          }))
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: source,
            loader: 'jsx',
            resolveDir: root,
          }))
        },
      },
    ],
  })
  assert.ok(build.success, String(build.logs))
  console.log('Launching scroll lifecycle browser')
  const script = await build.outputs[0]!.text()
  const styles = await compileEntryStyles()
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === '/fixture.js'
        ? new Response(script, { headers: { 'content-type': 'text/javascript; charset=utf-8' } })
        : new Response(
            `<html><style>${styles}</style><div id="root"></div><script src="/fixture.js"></script></html>`,
            { headers: { 'content-type': 'text/html; charset=utf-8' } },
          ),
  })
  try {
    const child = Bun.spawn(['node', fileURLToPath(import.meta.url)], {
      env: { ...process.env, PIDEX_SCROLL_TEST_URL: `http://127.0.0.1:${server.port}` },
      stdout: 'inherit',
      stderr: 'inherit',
    })
    assert.equal(await child.exited, 0)
  } finally {
    server.stop(true)
  }
}

async function checkFixture(url: string) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce' })
    const errors: string[] = []
    page.on('pageerror', (error) => {
      errors.push(error.message)
      console.error(error.message)
    })
    await page.goto(url)
    await page.waitForFunction(
      () => (document.querySelector('.thread-scroll-layout')?.scrollHeight ?? 0) > 3000,
    )
    const settle = () =>
      page.evaluate(
        () =>
          new Promise<void>((done) => {
            requestAnimationFrame(() =>
              requestAnimationFrame(() => requestAnimationFrame(() => done())),
            )
          }),
      )
    await settle()
    const failures: string[] = []
    await page.evaluate(() => (window as any).fixture.bottom())
    await settle()
    await page.waitForTimeout(220)
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('.conversation-page')!.style.height = '240px'
    })
    await settle()
    const resizeDistance = await page.evaluate(() => {
      const e = document.querySelector('.thread-scroll-layout')!
      return e.scrollHeight - e.clientHeight - e.scrollTop
    })
    if (resizeDistance > 24) failures.push(`viewport resize lost bottom: ${resizeDistance}px`)

    await page.evaluate(() => {
      ;(window as any).fixture.idle()
      document.querySelector('.thread-scroll-layout')!.scrollTop = 1200
    })
    await settle()
    await page.waitForTimeout(220)
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('.conversation-page')!.style.height = '360px'
    })
    await settle()
    const readingOffset = await page.evaluate(
      () => document.querySelector('.thread-scroll-layout')!.scrollTop,
    )
    if (Math.abs(readingOffset - 1200) > 24)
      failures.push(`static reader pulled during resize: ${readingOffset}px`)
    await page.evaluate(() => (window as any).fixture.switchSession('b'))
    await settle()
    await page.evaluate(() => (window as any).fixture.switchSession('a', false))
    await settle()
    await page.evaluate(() => (window as any).fixture.load())
    await settle()
    const restored = await page.evaluate(
      () => document.querySelector('.thread-scroll-layout')!.scrollTop,
    )
    if (Math.abs(restored - 1200) > 24)
      failures.push(`delayed history lost reading position: ${restored}px, expected 1200px`)
    assert.deepEqual(errors, [])
    assert.deepEqual(failures, [])
    const controls = await browser.newPage({ reducedMotion: 'no-preference' })
    await controls.goto(url)
    await controls.waitForFunction(
      () => (document.querySelector('.thread-scroll-layout')?.scrollHeight ?? 0) > 3000,
    )
    await controls.waitForTimeout(250)
    const leaveBottom = () =>
      controls.evaluate(() => {
        ;(window as any).fixture.idle()
        document.querySelector('.thread-scroll-layout')!.scrollTop = 1200
      })
    const bottomReached = () =>
      controls.waitForFunction(
        () => {
          const e = document.querySelector('.thread-scroll-layout')!
          return e.scrollHeight - e.clientHeight - e.scrollTop <= 24
        },
        {},
        { timeout: 2500 },
      )
    await leaveBottom()
    const button = controls.getByRole('button', { name: '回到底部', exact: true })
    await button.click({ timeout: 2500 })
    await bottomReached()
    await leaveBottom()
    await button.focus({ timeout: 2500 })
    await controls.keyboard.press('Enter')
    await bottomReached()
    console.log('Thread scroll following, static resize and delayed-history restoration passed')
    console.log(
      'Return button is accessible and works by pointer and keyboard without entry animation',
    )
  } finally {
    await browser.close()
  }
}

if (process.env.PIDEX_SCROLL_TEST_URL) await checkFixture(process.env.PIDEX_SCROLL_TEST_URL)
else await serveFixture()
