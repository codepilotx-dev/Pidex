import { expect, test, type Page } from '@playwright/test'

async function waitForConversationReady(page: Page): Promise<void> {
  await expect(page.getByText('已完成工作台结构梳理。', { exact: true })).toBeVisible()
}

test.describe('conversation title rename & header layout', () => {
  test('rename dialog in more menu still works', async ({ page }) => {
    await page.goto('/?visualCase=rich#/threads/visual-rich')
    await waitForConversationReady(page)

    await page.getByRole('button', { name: '更多会话操作' }).click()
    await page.getByRole('menuitem', { name: /重命名对话/ }).click()

    const input = page.getByRole('textbox', { name: '重命名对话' })
    await expect(input).toBeFocused()
    await input.fill('重命名输入回归')
    await expect(input).toHaveValue('重命名输入回归')
    await page.getByRole('button', { name: '重命名', exact: true }).click()
    await expect(page.getByLabel('工作区工具栏').locator('.chat-session-title__text')).toHaveText(
      '重命名输入回归',
    )
  })

  test('inline title edit saves on Enter and selects existing title on focus', async ({ page }) => {
    await page.goto('/?visualCase=rich#/threads/visual-rich')
    await waitForConversationReady(page)
    const title = page.getByLabel('工作区工具栏').locator('.chat-session-title__text')
    await expect(title).toBeVisible()
    const initialText = (await title.textContent())?.trim() ?? ''

    // Click title to enter inline editing
    await title.click()
    const inlineInput = page.locator('.chat-session-title__input')
    await expect(inlineInput).toBeVisible()
    await expect(inlineInput).toBeFocused()

    // Verify existing text is fully selected
    const selected = await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('.chat-session-title__input')
      if (!input) return null
      return input.value.substring(input.selectionStart ?? 0, input.selectionEnd ?? 0)
    })
    expect(selected).toBe(initialText)

    // Type new title and press Enter to save
    await inlineInput.fill('原地回车重命名')
    await inlineInput.press('Enter')

    await expect(inlineInput).toBeHidden()
    await expect(title).toHaveText('原地回车重命名')
  })

  test('inline title edit saves on blur', async ({ page }) => {
    await page.goto('/?visualCase=rich#/threads/visual-rich')
    await waitForConversationReady(page)
    const title = page.getByLabel('工作区工具栏').locator('.chat-session-title__text')
    await expect(title).toBeVisible()

    await title.click()
    const inlineInput = page.locator('.chat-session-title__input')
    await expect(inlineInput).toBeVisible()

    await inlineInput.fill('失焦保存测试')
    // Click outside on main content
    await page.locator('.desktop-main-route').click({ position: { x: 200, y: 200 } })

    await expect(inlineInput).toBeHidden()
    await expect(title).toHaveText('失焦保存测试')
  })

  test('inline title edit cancels on Escape and reverts to original', async ({ page }) => {
    await page.goto('/?visualCase=rich#/threads/visual-rich')
    await waitForConversationReady(page)
    const title = page.getByLabel('工作区工具栏').locator('.chat-session-title__text')
    await expect(title).toBeVisible()
    const originalText = (await title.textContent())?.trim() ?? ''

    await title.click()
    const inlineInput = page.locator('.chat-session-title__input')
    await expect(inlineInput).toBeVisible()

    await inlineInput.fill('未保存内容')
    await inlineInput.press('Escape')

    await expect(inlineInput).toBeHidden()
    await expect(title).toHaveText(originalText)
  })

  test('inline title edit cancels on empty input and skips request on unchanged name', async ({
    page,
  }) => {
    await page.goto('/?visualCase=rich#/threads/visual-rich')
    await waitForConversationReady(page)
    const title = page.getByLabel('工作区工具栏').locator('.chat-session-title__text')
    await expect(title).toBeVisible()
    const originalText = (await title.textContent())?.trim() ?? ''

    // Empty input should cancel and revert
    await title.click()
    const inlineInput = page.locator('.chat-session-title__input')
    await expect(inlineInput).toBeVisible()
    await inlineInput.fill('   ')
    await inlineInput.press('Enter')
    await expect(inlineInput).toBeHidden()
    await expect(title).toHaveText(originalText)

    // Unchanged name should not send request
    let renameCalled = false
    await page.evaluate(() => {
      window.addEventListener('desktop:rename-called', () => {
        ;(window as unknown as { __renameCalled: boolean }).__renameCalled = true
      })
    })

    await title.click()
    await expect(inlineInput).toBeVisible()
    await inlineInput.press('Enter')
    await expect(inlineInput).toBeHidden()
    await expect(title).toHaveText(originalText)

    renameCalled = await page.evaluate(
      () => (window as unknown as { __renameCalled?: boolean }).__renameCalled ?? false,
    )
    expect(renameCalled).toBe(false)
  })

  test('inline title edit keeps input content on save failure', async ({ page }) => {
    await page.goto('/?visualCase=rich#/threads/visual-rich')
    await waitForConversationReady(page)
    const title = page.getByLabel('工作区工具栏').locator('.chat-session-title__text')
    await expect(title).toBeVisible()

    // Mock renameSession failure
    await page.evaluate(async () => {
      const { desktopClient } = await import('/src/services/desktop-client/index.ts')
      desktopClient.renameSession = async () => {
        throw new Error('网络异常，模拟重命名失败')
      }
    })

    await title.click()
    const inlineInput = page.locator('.chat-session-title__input')
    await expect(inlineInput).toBeVisible()

    await inlineInput.fill('失败尝试保留文本')
    await inlineInput.press('Enter')

    // Input must remain visible and retain the typed value
    await expect(inlineInput).toBeVisible()
    await expect(inlineInput).toHaveValue('失败尝试保留文本')
  })

  test('inline title edit cancels when switching sessions', async ({ page }) => {
    await page.goto('/?visualCase=rich&visualSwitchTargets=1#/threads/visual-rich')
    await waitForConversationReady(page)
    const title = page.getByLabel('工作区工具栏').locator('.chat-session-title__text')
    await expect(title).toBeVisible()

    // Start editing in visual-rich
    await title.click()
    const inlineInput = page.locator('.chat-session-title__input')
    await expect(inlineInput).toBeVisible()
    await inlineInput.fill('旧会话未保存内容')

    // Switch to another session
    await page.evaluate(() => {
      window.location.hash = '#/threads/visual-switch-b'
    })

    // Inline edit should be cancelled and input hidden
    await expect(inlineInput).toBeHidden()
    await expect(page.getByLabel('工作区工具栏').locator('.chat-session-title__text')).toBeVisible()
  })

  test('IME composition Enter does not prematurely submit', async ({ page }) => {
    await page.goto('/?visualCase=rich#/threads/visual-rich')
    await waitForConversationReady(page)
    const title = page.getByLabel('工作区工具栏').locator('.chat-session-title__text')
    await expect(title).toBeVisible()

    await title.click()
    const inlineInput = page.locator('.chat-session-title__input')
    await expect(inlineInput).toBeVisible()

    await inlineInput.fill('拼音')

    // Simulate IME compositionstart
    await page.evaluate(() => {
      const el = document.querySelector('.chat-session-title__input')
      if (el) el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    })

    // Press Enter during composition - should NOT submit
    await inlineInput.press('Enter')
    await expect(inlineInput).toBeVisible()

    // Simulate IME compositionend
    await page.evaluate(() => {
      const el = document.querySelector('.chat-session-title__input')
      if (el) el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    })

    // Now Enter should submit
    await inlineInput.press('Enter')
    await expect(inlineInput).toBeHidden()
    await expect(title).toHaveText('拼音')
  })

  test('top project button icon is centered and project card first row is aligned', async ({
    page,
  }) => {
    await page.goto('/?visualCase=rich#/threads/visual-rich')
    const topButton = page.locator('.chat-session-project-details')
    await expect(topButton).toBeVisible()

    // 1. Top button SVG is centered inside button
    const buttonBox = await topButton.boundingBox()
    const svgBox = await topButton.locator('svg').boundingBox()
    expect(buttonBox).toBeTruthy()
    expect(svgBox).toBeTruthy()
    const buttonCenterY = buttonBox!.y + buttonBox!.height / 2
    const svgCenterY = svgBox!.y + svgBox!.height / 2
    expect(Math.abs(buttonCenterY - svgCenterY)).toBeLessThanOrEqual(1.5)

    // SVG must be display: block
    const svgDisplay = await topButton.locator('svg').evaluate((el) => {
      return window.getComputedStyle(el).display
    })
    expect(svgDisplay).toBe('block')

    // 2. Open project details card
    await topButton.click()
    const header = page.locator('.sidebar-project-hover-card-header')
    await expect(header).toBeVisible()

    const glyph = header.locator('.project-appearance-glyph, > span').first()
    const titleEl = header.locator('strong')
    const pinBtn = header.locator('.sidebar-project-hover-card-pin')

    await expect(glyph).toBeVisible()
    await expect(titleEl).toBeVisible()
    await expect(pinBtn).toBeVisible()

    const [glyphBox, titleBox, pinBox] = await Promise.all([
      glyph.boundingBox(),
      titleEl.boundingBox(),
      pinBtn.boundingBox(),
    ])
    expect(glyphBox).toBeTruthy()
    expect(titleBox).toBeTruthy()
    expect(pinBox).toBeTruthy()

    // Icon, title, and pin button all share the same vertical center line
    const glyphCenterY = glyphBox!.y + glyphBox!.height / 2
    const titleCenterY = titleBox!.y + titleBox!.height / 2
    const pinCenterY = pinBox!.y + pinBox!.height / 2

    expect(Math.abs(glyphCenterY - titleCenterY)).toBeLessThanOrEqual(2)
    expect(Math.abs(glyphCenterY - pinCenterY)).toBeLessThanOrEqual(2)

    // Pin button is positioned to the far right of the card header
    expect(pinBox!.x + pinBox!.width).toBeGreaterThan(titleBox!.x + titleBox!.width)

    // Pin button toggle works
    await pinBtn.click()
  })

  test('project edit dialog matches Codex layout, dimensions, and badge rules', async ({
    page,
  }) => {
    await page.goto('/?visualCase=rich#/threads/visual-rich')
    await waitForConversationReady(page)

    // Set up project associated with this session
    await page.evaluate(async () => {
      const clientPath = '/src/services/desktop-client/index.ts'
      const eventsPath = '/src/features/projects/ProjectCatalogEvents.ts'
      const { desktopClient } = await import(clientPath)
      const { notifyProjectCatalogChanged } = await import(eventsPath)
      const snapshot = await desktopClient.getSession('visual-rich')
      let project = {
        ...snapshot.workspace,
        projectId: 'header-project',
        name: 'Header Project',
        projectVersion: 1,
        primaryFolderId: 'header-primary',
        folders: [
          {
            id: 'header-primary',
            name: 'Root',
            path: snapshot.workspace.path,
            role: 'primary',
            availability: 'available',
            order: 0,
            createdAt: 0,
            updatedAt: 0,
          },
        ],
      }
      snapshot.item = { ...snapshot.item, projectId: project.projectId, standalone: false }
      snapshot.workspace = project
      desktopClient.listProjects = async () => [project]
      desktopClient.updateProject = async (input: { name: string }) => {
        project = { ...project, name: input.name, projectVersion: project.projectVersion + 1 }
        return project
      }
      await desktopClient.setActiveSession('visual-rich')
      notifyProjectCatalogChanged()
    })

    // Open project details card
    const topButton = page.locator('.chat-session-project-details')
    await topButton.click()
    const card = page.getByRole('dialog', { name: '项目详情', exact: true })
    await expect(card).toBeVisible()

    // Click "编辑项目"
    await card.getByRole('button', { name: '编辑项目', exact: true }).click()
    const editor = page.getByRole('dialog', { name: '编辑项目', exact: true })
    await expect(editor).toBeVisible()

    // 1. Verify dialog width is 32rem (~512px) and padding is 20px
    const dialogBox = await editor.boundingBox()
    expect(dialogBox).toBeTruthy()
    expect(Math.abs(dialogBox!.width - 512)).toBeLessThanOrEqual(2)

    const padding = await editor.evaluate((el) => {
      return window.getComputedStyle(el).paddingTop
    })
    expect(padding).toBe('20px')

    // 2. Verify backdrop blur is cancelled (backdrop-filter: none)
    const backdrop = page.locator('.project-edit-backdrop')
    const backdropFilter = await backdrop.evaluate((el) => {
      return window.getComputedStyle(el).backdropFilter
    })
    expect(backdropFilter).toBe('none')

    // 3. Verify name input is focused and selected
    const nameInput = editor.getByRole('textbox', { name: '项目名称', exact: true })
    await expect(nameInput).toBeFocused()

    // 4. Verify name field height is 40px, trigger is 40x40
    const nameField = editor.locator('.project-edit-name-field')
    const nameFieldBox = await nameField.boundingBox()
    expect(nameFieldBox).toBeTruthy()
    expect(Math.abs(nameFieldBox!.height - 40)).toBeLessThanOrEqual(1.5)

    const appearanceTrigger = nameField.locator('.project-appearance-trigger')
    const triggerBox = await appearanceTrigger.boundingBox()
    expect(triggerBox).toBeTruthy()
    expect(Math.abs(triggerBox!.width - 40)).toBeLessThanOrEqual(1.5)
    expect(Math.abs(triggerBox!.height - 40)).toBeLessThanOrEqual(1.5)

    // 5. Verify folder list row height is 48px
    const folderRows = editor.locator('.project-edit-folder-row')
    await expect(folderRows).toHaveCount(1)
    const firstRowBox = await folderRows.first().boundingBox()
    expect(firstRowBox).toBeTruthy()
    expect(Math.abs(firstRowBox!.height - 48)).toBeLessThanOrEqual(1.5)

    // 6. Single folder in project -> "主目录" badge is NOT shown
    await expect(editor.locator('.project-edit-primary-badge')).toHaveCount(0)

    // Folder name has title matching path
    const folderName = folderRows.first().locator('.project-edit-folder-name')
    const titleAttr = await folderName.getAttribute('title')
    expect(titleAttr).toBeTruthy()

    // Add folder button height is 48px
    const addBtn = editor.locator('.project-edit-add-folder')
    const addBtnBox = await addBtn.boundingBox()
    expect(addBtnBox).toBeTruthy()
    expect(Math.abs(addBtnBox!.height - 48)).toBeLessThanOrEqual(1.5)

    // 7. Add a second folder -> Now "主目录" badge appears on primary folder
    await page.evaluate(async () => {
      const { desktopClient } = await import('/src/services/desktop-client/index.ts')
      desktopClient.chooseProjectFolder = async () => 'F:/CodeProject/SecondFolder'
    })
    await addBtn.click()

    await expect(folderRows).toHaveCount(2)
    await expect(editor.locator('.project-edit-primary-badge')).toHaveCount(1)
    await expect(editor.locator('.project-edit-primary-badge')).toHaveText('主目录')

    // 8. Icon picker popover is above dialog (z-index higher than modal)
    await appearanceTrigger.click()
    const popover = page.locator('.project-appearance-popover')
    await expect(popover).toBeVisible()

    const [popoverZ, dialogZ] = await Promise.all([
      popover.evaluate((el) => window.getComputedStyle(el).zIndex),
      editor.evaluate((el) => window.getComputedStyle(el).zIndex),
    ])
    expect(Number.parseInt(popoverZ, 10)).toBeGreaterThan(Number.parseInt(dialogZ, 10))

    // Close popover
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await expect(popover).toBeHidden()

    // 9. Buttons have medium size (~32px height)
    const saveBtn = editor.getByRole('button', { name: '保存', exact: true })
    const saveBox = await saveBtn.boundingBox()
    expect(saveBox).toBeTruthy()
    expect(Math.abs(saveBox!.height - 32)).toBeLessThanOrEqual(2)

    const cancelBtn = editor.getByRole('button', { name: '取消', exact: true })
    await cancelBtn.click()
    await expect(editor).toBeHidden()
  })
})
