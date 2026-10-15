import React from 'react'
import type { Item } from '@pidex/shared/thread'
import type { RpcParams } from '@pidex/agent-protocol'
import { visualizationFromBlocks, type VisualizationEnvelope } from '@pidex/shared/visualization'
import { desktopClient } from '../../services/desktop-client/index.js'
import { Button } from '../../components/ui/Button.js'
import { Spinner } from '../../components/ui/Spinner.js'
import { processPartialHtml } from './ProcessPartialHtml.js'

type FollowUp = { text: string; selection?: RpcParams<'visualization/submitFollowUp'>['selection'] }
export function VisualizationView({
  item,
  threadId,
}: {
  item: Extract<Item, { type: 'tool' }>
  threadId?: string
}) {
  const envelope = React.useMemo(
    () => (item.state === 'completed' ? visualizationFromBlocks(item.resultBlocks) : null),
    [item.state, item.resultBlocks],
  )
  const preview = item.visualizationPreview
  const document = envelope?.document
  const title = document?.title ?? preview?.title ?? '交互界面'
  const summary = document?.summary ?? preview?.summary ?? ''
  const [reload, setReload] = React.useState(0)
  const [libraries, setLibraries] = React.useState<string[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [height, setHeight] = React.useState(
    document?.initialHeight ?? preview?.initialHeight ?? 240,
  )
  const [ready, setReady] = React.useState(false)
  const [followUp, setFollowUp] = React.useState<FollowUp | null>(null)
  const [sending, setSending] = React.useState(false)
  const [theme, setTheme] = React.useState<Record<string, string>>({})
  const frame = React.useRef<HTMLIFrameElement>(null)
  const channel = React.useRef<MessageChannel | null>(null)
  const connectionTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const revision = React.useRef(0)
  const busy = React.useRef(false)
  const submission = React.useRef<{ key: string; inputId: string } | null>(null)
  const payload = React.useRef<Record<string, unknown> | null>(null)
  const visible = Boolean(document || (preview?.cssComplete && preview.html))
  const failed = item.state === 'error' || item.state === 'interrupted'

  React.useEffect(() => {
    let cancelled = false
    setLibraries(null)
    setError(null)
    setReady(false)
    setFollowUp(null)
    if (!envelope) return
    if (!threadId) {
      setError('无法确定界面所属聊天。')
      return
    }
    void loadLibraries(envelope, threadId).then(
      (sources) => {
        if (!cancelled) setLibraries(sources)
      },
      () => {
        if (!cancelled) setError('图形库加载失败，请重新加载。')
      },
    )
    return () => {
      cancelled = true
    }
  }, [envelope, threadId, reload])

  React.useEffect(() => {
    const update = () => {
      const style = getComputedStyle(globalThis.document.documentElement)
      const value = (token: string, fallback: string) =>
        style.getPropertyValue(token).trim() || fallback
      setTheme({
        background: value('--cpx-sys-color-surface-canvas', '#ffffff'),
        foreground: value('--cpx-sys-color-fg-primary', '#1f1f1f'),
        secondary: value('--cpx-sys-color-fg-secondary', '#666666'),
        accent: value('--cpx-sys-color-accent-fg', '#208452'),
        border: value('--cpx-sys-color-border-subtle', '#dddddd'),
        scheme: style.colorScheme.includes('dark') ? 'dark' : 'light',
      })
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(globalThis.document.documentElement, { attributes: true })
    return () => observer.disconnect()
  }, [])

  const render = React.useCallback(() => {
    const port = channel.current?.port1
    if (payload.current) port?.postMessage({ ...payload.current, revision: ++revision.current })
  }, [])
  React.useEffect(() => {
    payload.current = {
      type: 'render',
      theme,
      css: document?.css ?? (preview?.cssComplete ? preview.css : ''),
      html: document?.html ?? processPartialHtml(preview?.html ?? ''),
      final: Boolean(envelope && libraries !== null),
      libraries: libraries ?? [],
      jsFunctions: document?.jsFunctions ?? '',
      jsExpressions: document?.jsExpressions ?? [],
    }
    render()
  }, [document, envelope, preview, libraries, render, theme])
  React.useEffect(() => {
    channel.current?.port1.postMessage({ type: 'theme', theme })
  }, [theme])
  React.useEffect(
    () => () => {
      if (connectionTimeout.current) clearTimeout(connectionTimeout.current)
      channel.current?.port1.close()
      channel.current?.port2.close()
      channel.current = null
    },
    [reload, item.id, threadId],
  )

  const connect = () => {
    if (connectionTimeout.current) clearTimeout(connectionTimeout.current)
    channel.current?.port1.close()
    channel.current?.port2.close()
    const next = new MessageChannel()
    channel.current = next
    connectionTimeout.current = setTimeout(() => setError('交互界面加载失败，请重新加载。'), 10000)
    next.port1.onmessage = (event) => {
      if (channel.current !== next) return
      const data = event.data
      if (!data || typeof data !== 'object') return
      if (data.type === 'connected') {
        if (connectionTimeout.current) clearTimeout(connectionTimeout.current)
        connectionTimeout.current = null
        render()
      } else if (
        data.type === 'height' &&
        typeof data.height === 'number' &&
        Number.isFinite(data.height)
      )
        setHeight(Math.max(50, Math.min(4000, Math.ceil(data.height))))
      else if (data.type === 'ready') setReady(true)
      else if (data.type === 'error') setError('交互界面运行失败，可以重新加载或让 AI 修复。')
      else if (data.type === 'followup') {
        try {
          if (
            typeof data.text !== 'string' ||
            !data.text.trim() ||
            data.text.length > 4000 ||
            JSON.stringify(data.selection ?? null).length > 16000
          )
            return
          setFollowUp({
            text: data.text.trim(),
            selection: JSON.parse(JSON.stringify(data.selection ?? null)),
          })
        } catch {
          /* Invalid iframe data never reaches RPC. */
        }
      }
    }
    next.port1.start()
    frame.current?.contentWindow?.postMessage({ type: 'pidex:initialize' }, '*', [next.port2])
  }
  const submit = async (repair = false) => {
    if (!threadId || busy.current) return
    busy.current = true
    setSending(true)
    const request = repair
      ? {
          text: '请修复这个交互界面。界面未能正常运行，请生成一个可用的新版本。',
          selection: { error: error ?? item.error ?? '界面生成中断' },
        }
      : (followUp ?? { text: '请基于这个交互界面继续分析。' })
    const key = JSON.stringify({ threadId, itemId: item.id, ...request, repair })
    if (submission.current?.key !== key) submission.current = { key, inputId: crypto.randomUUID() }
    try {
      await desktopClient.submitVisualizationFollowUp({
        threadId,
        itemId: item.id,
        turnId: item.turnId,
        inputId: submission.current.inputId,
        text: request.text,
        selection: request.selection,
        repair,
      })
      submission.current = null
    } catch {
      setError('追问提交失败，请重试。')
    } finally {
      busy.current = false
      setSending(false)
    }
  }
  return (
    <section
      className="tw:grid tw:gap-3 tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-panel tw:p-4"
      aria-label={`交互界面：${title}`}
    >
      <header className="tw:grid tw:gap-1">
        <strong>{title}</strong>
        {summary ? <p className="tw:m-0 tw:text-app-text-soft">{summary}</p> : null}
      </header>
      {visible ? (
        <iframe
          key={`${threadId}:${item.id}:${reload}`}
          ref={frame}
          src="/visualization-frame.html"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          title={title}
          onLoad={connect}
          className="tw:w-full tw:border-0"
          style={{ height }}
        />
      ) : null}
      {!ready && !error && !failed ? (
        <div role="status" className="tw:flex tw:items-center tw:gap-2 tw:text-app-text-soft">
          <Spinner />
          {visible ? '正在完成交互逻辑…' : '正在生成交互界面…'}
        </div>
      ) : null}
      {error || failed ? (
        <p role="alert" className="tw:m-0 tw:text-app-text-soft">
          {error ?? item.error ?? (failed ? '界面生成中断，预览暂时无法交互。' : '')}
        </p>
      ) : null}
      <footer className="tw:flex tw:flex-wrap tw:gap-2">
        {ready && envelope ? (
          <Button size="sm" variant="secondary" disabled={sending} onClick={() => void submit()}>
            继续分析
          </Button>
        ) : null}
        {error && visible ? (
          <Button size="sm" variant="outline" onClick={() => setReload((value) => value + 1)}>
            重新加载
          </Button>
        ) : null}
        {(error || failed) && item.state !== 'pending' ? (
          <Button size="sm" variant="outline" disabled={sending} onClick={() => void submit(true)}>
            让 AI 修复
          </Button>
        ) : null}
      </footer>
    </section>
  )
}

async function loadLibraries(envelope: VisualizationEnvelope, threadId: string) {
  return Promise.all(
    envelope.resources.map(async (resource) => {
      const result = await desktopClient.readArtifact(threadId, resource.artifactId)
      if (
        result.artifact.mimeType !== 'text/javascript' ||
        result.artifact.sizeBytes > 2 * 1024 * 1024
      )
        throw new Error('Invalid library artifact')
      return new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(atob(result.data), (value) => value.charCodeAt(0)),
      )
    }),
  )
}
