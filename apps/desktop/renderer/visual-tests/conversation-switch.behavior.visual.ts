import { expect, test } from '@playwright/test'

test('conversation switch removes the previous timeline while canonical history loads', async ({
  page,
}) => {
  await page.goto(
    '/?visualCase=rich&visualSessionReadDelayMs=250&visualSwitchTargets=1#/threads/visual-rich',
  )
  const previousReply = page.getByText('已完成工作台结构梳理。', {
    exact: true,
  })
  await expect(previousReply).toBeVisible()

  await page.evaluate(() => {
    window.location.hash = '#/threads/visual-switch-b'
  })
  await expect(previousReply).toBeHidden()
  await expect(page.getByText('正在加载会话内容…', { exact: true })).toBeVisible()
  await expect(page.getByText('会话 B 已加载。', { exact: true })).toBeVisible()

  await page.evaluate(() => {
    window.location.hash = '#/threads/visual-switch-c'
  })
  await expect(page.getByText('会话 B 已加载。', { exact: true })).toBeHidden()
  await page.evaluate(() => {
    window.location.hash = '#/threads/visual-rich'
  })
  await expect(page.getByText('会话 C 已加载。', { exact: true })).toBeHidden()
  await expect(page.getByText('正在加载会话内容…', { exact: true })).toBeVisible()
  await expect(previousReply).toBeVisible()
  await expect(page.getByText('会话 B 已加载。', { exact: true })).toBeHidden()
  await expect(page.getByText('会话 C 已加载。', { exact: true })).toBeHidden()
})
