import { expect, test } from 'bun:test'
import { parseBrowserAnnotations, type BrowserAnnotation } from '@pidex/shared/browser-annotation'
import { ComposerDraftStore } from '../src/features/session/composer/ComposerDraftStore.js'
import {
  annotationAttachments,
  saveBrowserAnnotation,
  deleteBrowserAnnotation,
  retainBrowserAnnotationEditor,
} from '../src/features/browser/BrowserAnnotationDraft.js'
import {
  executeComposerSubmitTransaction,
  prepareComposerSubmission,
} from '../src/features/session/composer/ComposerSubmitTransaction.js'

const annotation = (id: string): BrowserAnnotation => ({
  id,
  tabId: 'tab',
  documentId: 'doc',
  body: '调整按钮',
  anchors: [
    {
      kind: 'element',
      pageUrl: 'https://example.com',
      pageTitle: 'Example',
      frameUrl: 'https://example.com',
      framePath: [],
      runtimeId: id,
      name: '提交',
      tagName: 'button',
      text: '提交',
      nearbyText: '表单',
      rect: { x: 1, y: 2, width: 40, height: 20 },
      scroll: { x: 0, y: 0 },
      scrollContainers: [],
      style: { color: 'red' },
      attributes: {},
    },
  ],
})
const image = { data: 'iVBORw0KGgo=', mimeType: 'image/png' as const }

test('批注与图片原子保存、联动删除，容量不足不修改原草稿', () => {
  const store = new ComposerDraftStore()
  const empty = store.get('home')
  const next = saveBrowserAnnotation(empty, annotation('one'), image)
  expect(empty.browserAnnotations).toBeUndefined()
  expect(annotationAttachments(next)).toHaveLength(2)
  expect(next.browserAnnotations?.[0]?.screenshotName).toBe(next.browserAnnotationImages?.[0]?.name)
  const full = {
    ...next,
    attachments: Array.from({ length: 7 }, (_, i) => ({
      id: String(i),
      name: `${i}.txt`,
      path: '',
      mediaType: 'text/plain',
      kind: 'text' as const,
      status: 'ready' as const,
      sizeBytes: 1,
    })),
  }
  expect(() => saveBrowserAnnotation(full, annotation('two'), image)).toThrow('最多 8')
  expect(full.browserAnnotations).toHaveLength(1)
  const removed = deleteBrowserAnnotation(next, 'one')
  expect(removed.browserAnnotationImages).toHaveLength(0)
  expect(annotationAttachments(removed)).toHaveLength(0)
})

test('聊天切换、克隆与新聊天 handoff 保留反馈，提交失败保留整组', async () => {
  const store = new ComposerDraftStore()
  store.set(
    'home',
    retainBrowserAnnotationEditor(
      saveBrowserAnnotation(store.get('home'), annotation('one'), image),
      'tab',
      'doc',
      { id: 'pending', body: '未保存反馈', anchors: [], includeHtml: false },
    ),
  )
  const snapshot = store.get('home')
  snapshot.browserAnnotations![0]!.anchors[0]!.name = '不能改真源'
  expect(store.get('home').browserAnnotations![0]!.anchors[0]!.name).toBe('提交')
  expect(store.get('session:other').browserAnnotations).toBeUndefined()
  store.handoff('home', 'session:created')
  const moved = store.get('session:created')
  const outcome = await executeComposerSubmitTransaction({
    draft: moved,
    targetSessionId: 'created',
    submitToSession: async () => {
      throw new Error('失败')
    },
  })
  expect(outcome.status).toBe('failed')
  expect(store.get('session:created').browserAnnotations).toHaveLength(1)
  expect(store.get('session:created').browserAnnotationEditors?.tab?.editor.body).toBe('未保存反馈')
  expect(store.get('home').browserAnnotations).toBeUndefined()
})

test('清单可独立发送，成功清理已提交批注并保留等待期间新增批注', () => {
  const store = new ComposerDraftStore()
  store.set('home', saveBrowserAnnotation(store.get('home'), annotation('one'), image))
  const submitted = store.get('home'),
    prepared = prepareComposerSubmission(submitted)
  expect('input' in prepared).toBe(true)
  if (!('input' in prepared)) return
  const manifest = prepared.input.attachments!.find((a) => a.mediaType === 'application/json')!
  expect(parseBrowserAnnotations(manifest.textContent!)?.[0]?.id).toBe('one')
  store.set('home', saveBrowserAnnotation(store.get('home'), annotation('two'), image))
  store.completeSubmission('home', submitted.clientId, {
    clearContent: true,
    browserAnnotations: submitted.browserAnnotations,
  })
  const remaining = store.get('home')
  expect(remaining.browserAnnotations?.map((a) => a.id)).toEqual(['two'])
  expect(remaining.browserAnnotationImages).toHaveLength(1)
  expect(
    parseBrowserAnnotations('{"format":"unknown","schemaVersion":1,"annotations":[]}'),
  ).toBeNull()
  expect(
    parseBrowserAnnotations(
      manifest.textContent!.replace('"schemaVersion":1', '"schemaVersion":2'),
    ),
  ).toBeNull()
})
test('未完成的卡片反馈编辑沿聊天草稿保留，发送不会悄悄使用旧反馈', () => {
  const store = new ComposerDraftStore()
  const next = saveBrowserAnnotation(store.get('home'), annotation('one'), image)
  next.browserAnnotationFeedback = { one: '未完成的反馈' }
  store.set('home', next)
  store.handoff('home', 'session:created')
  expect(store.get('session:created').browserAnnotationFeedback).toEqual({ one: '未完成的反馈' })
  expect(prepareComposerSubmission(store.get('session:created'))).toMatchObject({
    status: 'failed',
    phase: 'prepare',
  })
  expect(
    deleteBrowserAnnotation(store.get('session:created'), 'one').browserAnnotationFeedback,
  ).toEqual({})
})
