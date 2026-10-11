import { expect, test } from '@playwright/test'

test('tool file links and disclosure support independent mouse and keyboard actions', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    // Visual fixtures have no Agent backend; retain all other runtime errors.
    if (
      message.location().url.endsWith('/rpc') &&
      message.text() ===
        'Failed to load resource: the server responded with a status of 404 (Not Found)'
    )
      return
    errors.push(message.text())
  })
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.goto('/?visualCase=rich#/threads/visual-rich')
  await expect(page.getByText('已完成工作台结构梳理。', { exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const modulePath = '/src/services/desktop-client/index.ts'
    const { desktopClient } = await import(modulePath)
    const listWorkspaceFiles = desktopClient.listWorkspaceFiles
    // The generic browser fixture returns [] even when a file is probed as a directory.
    desktopClient.listWorkspaceFiles = (...args: Parameters<typeof listWorkspaceFiles>) => {
      if (args[1] === 'src/ConversationPage.tsx') {
        return Promise.reject(new Error('Not a directory'))
      }
      return listWorkspaceFiles(...args)
    }
  })

  await page.locator('.canonical-turn-activity__summary').first().click()
  const group = page.locator('.cpx-agent-activity[data-expandable="true"]').first()
  await group.locator(':scope > .cpx-agent-activity__header').click()

  const item = group.locator('.cpx-agent-activity__item').filter({
    has: page.getByRole('button', { name: '打开文件 src/ConversationPage.tsx', exact: true }),
  })
  const header = item.locator(':scope > .cpx-agent-activity__item-header')
  const toggle = header.locator('.cpx-agent-activity__item-toggle')
  const fileLink = header.getByRole('button', {
    name: '打开文件 src/ConversationPage.tsx',
    exact: true,
  })
  await expect(fileLink).toBeVisible()
  await expect(item.locator('button button')).toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')

  await fileLink.click()
  await expect(page.locator('.right-dock-file-preview')).toBeVisible()
  await expect(item).toHaveAttribute('data-expanded', 'false')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')

  await header.click({ position: { x: 8, y: 8 } })
  await expect(item).toHaveAttribute('data-expanded', 'true')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(item.locator('.cpx-agent-activity__details')).toBeVisible()

  await toggle.focus()
  await toggle.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.press('Space')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await toggle.press('Tab')
  await expect(fileLink).toBeFocused()
  expect(errors).toEqual([])
})
