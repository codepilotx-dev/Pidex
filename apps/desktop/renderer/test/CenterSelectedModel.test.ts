import { expect, test } from 'bun:test'
import { centeredScrollTop } from '../src/features/session/composer/CenterSelectedModel.js'

test('选中模型在可视区下方时向上滚动到中间', () => {
  expect(
    centeredScrollTop({
      scrollTop: 0,
      scrollHeight: 1_000,
      listTop: 100,
      listClientHeight: 300,
      rowTop: 460,
      rowHeight: 36,
    }),
  ).toBe(228)
})

test('滚动结果夹在 0 与最大滚动距离之间', () => {
  // 选中行在列表顶部时不会出现负滚动。
  expect(
    centeredScrollTop({
      scrollTop: 0,
      scrollHeight: 1_000,
      listTop: 100,
      listClientHeight: 300,
      rowTop: 100,
      rowHeight: 36,
    }),
  ).toBe(0)
  // 选中行在列表很靠后时不会超过最大滚动距离。
  expect(
    centeredScrollTop({
      scrollTop: 0,
      scrollHeight: 1_000,
      listTop: 100,
      listClientHeight: 300,
      rowTop: 1_500,
      rowHeight: 36,
    }),
  ).toBe(700)
  // 列表不足一屏时保持顶部。
  expect(
    centeredScrollTop({
      scrollTop: 0,
      scrollHeight: 200,
      listTop: 0,
      listClientHeight: 300,
      rowTop: 120,
      rowHeight: 36,
    }),
  ).toBe(0)
})
