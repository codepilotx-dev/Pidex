import { expect, test, type Locator, type Page } from '@playwright/test'
import { prepareVisualTheme } from './VisualTestHelpers.js'

type VisualScenario = {
  id: 'empty' | 'rich' | 'permission' | 'review'
  route: string
  readyText: string
  prepare?: (page: Page) => Promise<void>
}

const SCENARIOS: readonly VisualScenario[] = [
  {
    id: 'empty',
    route: '/?visualCase=empty#/new',
    readyText: '我们该构建什么？',
  },
  {
    id: 'rich',
    route: '/?visualCase=rich#/threads/visual-rich',
    readyText: '已完成工作台结构梳理。',
  },
  {
    id: 'permission',
    route: '/?visualCase=permission#/threads/visual-permission',
    readyText: '已完成工作台结构梳理。',
  },
  {
    id: 'review',
    route: '/?visualCase=review#/threads/visual-review',
    readyText: '已完成工作台结构梳理。',
    prepare: async (page) => {
      await page.getByRole('button', { name: '显示右侧面板' }).click()
      await expect(page.getByRole('complementary', { name: '右侧面板' })).toBeVisible()
      await page
        .getByRole('complementary', { name: '右侧面板' })
        .getByRole('button', { name: /^审阅/ })
        .click()
      await expect(
        page
          .getByRole('complementary', { name: '右侧面板' })
          .locator('[data-review-syntax-state="ready"]')
          .first(),
      ).toBeVisible({ timeout: 10_000 })
    },
  },
] as const

const MODES = ['light', 'dark'] as const
const VIEWPORTS = [
  { id: 'desktop', width: 1440, height: 920 },
  { id: 'compact', width: 960, height: 640 },
] as const

const MARKDOWN_TYPOGRAPHY_CASES = [
  { id: 'desktop-light', mode: 'light', width: 1440, height: 920 },
  { id: 'compact-dark', mode: 'dark', width: 960, height: 640 },
] as const

async function maskTransparentStopCount(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element)
    const mask = style.maskImage || style.webkitMaskImage
    return mask.match(/rgba\(0, 0, 0, 0\)|transparent/g)?.length ?? 0
  })
}

test('canonical thread stays active through StrictMode effect replay', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await gotoWorkbenchFixture(page, '/?visualCase=rich#/threads/visual-rich')

  await expect(page.locator('[data-canonical-thread-id="visual-rich"]')).toBeVisible()
  await expect(page.getByText('canonical thread ingestion coordinator 已停止。')).toHaveCount(0)
  await expect(page.getByText('已完成工作台结构梳理。', { exact: true })).toBeVisible()
})

test('side chat matches the temporary multi-tab workbench flow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await gotoWorkbenchFixture(
    page,
    '/?visualCase=rich&visualSideChatSecondMessage=1#/threads/visual-rich',
  )
  await closeTransientErrorToast(page)

  await page.getByRole('button', { name: '更多会话操作' }).click()
  await page.getByRole('menuitem', { name: '打开侧边聊天' }).click()
  const rightPanel = page.getByRole('complementary', { name: '右侧面板' })
  await expect(rightPanel).toBeVisible()
  await expect(rightPanel.getByRole('region', { name: '侧边聊天' })).toContainText(
    '侧边聊天是临时聊天，关闭应用后会消失。',
  )
  await expect(rightPanel.locator('.composer-utility-strip')).toHaveCount(0)

  const mainComposerDock = page.locator(
    '.conversation-page [data-component="thread-composer-dock"]',
  )
  const sideComposerDock = rightPanel.locator('[data-component="thread-composer-dock"]')
  await expect(mainComposerDock).toHaveCount(1)
  await expect(sideComposerDock).toHaveCount(1)
  await expect(mainComposerDock.locator('.composer-stack')).toHaveAttribute(
    'data-placement',
    'thread',
  )
  await expect(sideComposerDock.locator('.composer-stack')).toHaveAttribute(
    'data-placement',
    'thread',
  )

  const readStackShadow = async (composer: Locator) =>
    composer.locator('.composer-stack').evaluate((element) => getComputedStyle(element).boxShadow)
  const mainStackShadow = await readStackShadow(mainComposerDock)
  expect(await readStackShadow(sideComposerDock)).toBe(mainStackShadow)
  expect(mainStackShadow).toBe('none')

  const readComposerStyles = async (composer: Locator) =>
    composer.locator('.composer-input-surface').evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        background: style.background,
        border: style.border,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
        minHeight: style.minHeight,
        padding: style.padding,
      }
    })
  expect(await readComposerStyles(sideComposerDock)).toEqual(
    await readComposerStyles(mainComposerDock),
  )

  const readSendButtonSize = async (composer: Locator) =>
    composer.locator('.send-button').evaluate((element) => {
      const style = getComputedStyle(element)
      return { height: style.height, width: style.width }
    })
  expect(await readSendButtonSize(sideComposerDock)).toEqual(
    await readSendButtonSize(mainComposerDock),
  )

  const sideComposerFooter = rightPanel.locator('.thread-scroll-layout__footer')
  await expect(sideComposerFooter).toHaveCSS('padding-left', '16px')
  await expect(sideComposerFooter).toHaveCSS('padding-right', '16px')
  await expect(sideComposerFooter).toHaveCSS('padding-bottom', '16px')
  await expect(rightPanel).toHaveScreenshot('side-chat-thread-composer.png', {
    animations: 'disabled',
    caret: 'hide',
  })

  await rightPanel.getByRole('button', { name: '添加标签' }).click()
  await page.getByRole('menuitemradio', { name: '侧边聊天 Ctrl+Alt+S' }).click()
  await expect(rightPanel.getByRole('region', { name: '侧边聊天 2' })).toContainText(
    '已检查：空输入和分页边界都需要单独处理。',
  )
  await expect(rightPanel.getByRole('button', { name: /侧边聊天 2/ })).toBeVisible()
})

test('empty right dock matches Codex launcher', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await gotoWorkbenchFixture(page, '/?visualCase=rich#/threads/visual-rich')
  await closeTransientErrorToast(page)

  await page.getByRole('button', { name: '显示右侧面板' }).click()
  const rightPanel = page.getByRole('complementary', { name: '右侧面板' })
  const launcher = rightPanel.getByLabel('可用面板标签')
  const actions = launcher.locator('.right-panel-tabs-empty-state__actions')
  const items = actions.locator('.right-panel-tabs-empty-state__item')

  await expect(rightPanel).toBeVisible()
  await expect(rightPanel.getByRole('button', { name: '添加标签' })).toHaveCount(0)
  await expect(items).toHaveCount(5)
  await expect(items.locator('strong')).toHaveText(['审阅', '终端', '浏览器', '文件', '侧边聊天'])
  await expect(items.locator('kbd')).toHaveText(['Ctrl+Shift+G', 'Ctrl+T', 'Ctrl+P', 'Ctrl+Alt+S'])
  await expect(items.nth(1).locator('kbd')).toHaveCount(0)
  await expect(items.nth(0).locator('.lucide-square-plus')).toHaveCount(1)
  await expect(items.nth(3).locator('.lucide-folder')).toHaveCount(1)
  await expect(items.first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

  const [panelBox, launcherBox, actionsBox] = await Promise.all([
    rightPanel.boundingBox(),
    launcher.boundingBox(),
    actions.boundingBox(),
  ])
  expect(panelBox).not.toBeNull()
  expect(launcherBox).not.toBeNull()
  expect(actionsBox).not.toBeNull()
  expect(panelBox!.width).toBeCloseTo(400, 0)
  expect(
    actionsBox!.y + actionsBox!.height / 2 - (launcherBox!.y + launcherBox!.height / 2),
  ).toBeCloseTo(0, 0)

  await expect(rightPanel).toHaveScreenshot('empty-right-dock-codex-launcher.png', {
    animations: 'disabled',
    caret: 'hide',
  })

  await rightPanel.getByRole('button', { name: '侧边聊天 Ctrl+Alt+S' }).click()
  await expect(rightPanel.getByRole('tab', { name: '侧边聊天' })).toBeVisible()
  await rightPanel.getByRole('button', { name: '添加标签' }).click()
  await expect(page.getByRole('menuitemradio', { name: '审阅 Ctrl+Shift+G' })).toBeVisible()
  await page.keyboard.press('Escape')
  await rightPanel.getByRole('button', { name: '关闭 侧边聊天' }).click()
  await expect(rightPanel.getByLabel('可用面板标签')).toBeVisible()
})

for (const visualCase of MARKDOWN_TYPOGRAPHY_CASES) {
  test(`Markdown typography follows the Codex-like rhythm in ${visualCase.id}`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: visualCase.width,
      height: visualCase.height,
    })
    await page.emulateMedia({
      colorScheme: visualCase.mode,
      forcedColors: 'none',
      reducedMotion: 'reduce',
    })
    await gotoWorkbenchFixture(page, '/?visualCase=rich#/threads/visual-rich')
    await closeTransientErrorToast(page)
    await expect(page.getByText('已完成工作台结构梳理。', { exact: true })).toBeVisible()

    if (visualCase.id === 'compact-dark') {
      await page.getByRole('button', { name: '显示右侧面板' }).click()
      await expect(page.getByRole('complementary', { name: '右侧面板' })).toBeVisible()
    }

    const markdown = page.locator('.canonical-text-item--result > .md-body').first()
    const routeCode = markdown.locator('code').filter({ hasText: '/new' })
    const sourceReference = markdown.getByRole('button', {
      name: '打开文件 ../../components/ui/Tooltip.js',
    })
    await expect(routeCode).toHaveText('/new')
    await expect(sourceReference).toBeVisible()
    await expect(sourceReference.locator('.md-file-reference__icon')).toBeVisible()
    const fileReferenceCenterDelta = await sourceReference.evaluate((element) => {
      const icon = element.querySelector<HTMLElement>('.md-file-reference__icon')
      const label = element.querySelector<HTMLElement>('.md-file-reference__label')
      if (!icon || !label) return Number.POSITIVE_INFINITY
      const iconBox = icon.getBoundingClientRect()
      const labelBox = label.getBoundingClientRect()
      return Math.abs(iconBox.top + iconBox.height / 2 - (labelBox.top + labelBox.height / 2))
    })
    expect(fileReferenceCenterDelta).toBeLessThanOrEqual(1)
    const userTurnLocator = page.locator('.canonical-turn__user').first()
    const userBubbleLocator = userTurnLocator.locator('[data-user-message-bubble]')
    const imageAttachmentRow = userTurnLocator.getByRole('group', {
      name: '图片附件',
    })
    const fileAttachmentRow = userTurnLocator.getByRole('group', {
      name: '文件附件',
    })
    await expect(imageAttachmentRow).toBeVisible()
    await expect(fileAttachmentRow).toBeVisible()
    await expect(imageAttachmentRow.locator('.attachment-image-tile')).toHaveCount(3)
    await expect(fileAttachmentRow.locator('.attachment-file-pill')).toHaveCount(2)
    await expect(
      imageAttachmentRow.locator('.attachment-image-tile[data-status="error"]'),
    ).toHaveCount(1)
    await expect(userBubbleLocator.getByRole('button', { name: '显示更多' })).toBeVisible()
    await expect(markdown.getByRole('heading', { level: 1 })).toHaveText('Markdown 阅读排版')
    await expect(markdown.getByRole('heading', { level: 2 })).toHaveText('阅读节奏')
    await expect(markdown.getByRole('heading', { level: 3 })).toHaveText('结构清单')
    await expect(markdown.locator('blockquote')).toBeVisible()
    await expect(markdown.locator('.md-table-block table')).toBeVisible()
    const nestedCodeWideHost = markdown.locator('.md-wide-block').filter({
      hasText: 'nestedWideBlock',
    })
    const codeWideHost = markdown.locator('.md-wide-block').filter({
      hasText: 'responsiveFixturePath',
    })
    await nestedCodeWideHost.scrollIntoViewIfNeeded()
    await expect(nestedCodeWideHost.locator('.md-code-block:not(.md-table-block)')).toBeVisible()
    await expect(codeWideHost.locator('.md-code-block:not(.md-table-block)')).toBeVisible()
    const tableBlock = markdown.locator('.md-table-block')
    const tableCopy = tableBlock.getByRole('button', { name: '复制表格' })
    await expect(tableBlock).not.toHaveClass(/md-code-block/)
    await expect(tableBlock).not.toHaveClass(/md-wide-block/)
    await expect(tableBlock.locator('.md-table-toolbar')).toHaveCount(0)
    await expect(tableCopy).toHaveCSS('opacity', '0')

    const metrics = await markdown.evaluate((element) => {
      const select = <T extends HTMLElement>(selector: string): T => {
        const target = element.querySelector<T>(selector)
        if (!target) throw new Error(`Missing Markdown fixture element: ${selector}`)
        return target
      }
      const style = (selector: string): CSSStyleDeclaration => getComputedStyle(select(selector))
      const px = (value: string): number => Number.parseFloat(value)
      const rootSize = px(getComputedStyle(document.documentElement).fontSize)
      const body = getComputedStyle(element)
      const bodySize = px(body.fontSize)
      const paragraph = style('p')
      const h1 = style('h1')
      const h2 = style('h2')
      const h3 = style('h3')
      const quote = style('blockquote')
      const strong = style('strong')
      const inlineCode = style('p code')
      const list = style('ul')
      const listItem = style('li')
      const listItemElement = select<HTMLElement>(':scope > ul > li')
      const spacedListItem = style(':scope > ul > li + li')
      const nestedSpacedListItem = style(':scope > ul > li > ul > li + li')
      const directListParagraph = style(':scope > ul > li > p')
      const secondListParagraph = style(':scope > ul > li > p + p')
      const nestedList = style(':scope > ul > li > ul')
      const codeBlock = style('.md-code-block:not(.md-table-block)')
      const codeBlockElement = Array.from(
        element.querySelectorAll<HTMLElement>('.md-wide-block'),
      ).find((target) => target.textContent?.includes('responsiveFixturePath'))
      const nestedCodeBlockElement = Array.from(
        element.querySelectorAll<HTMLElement>('.md-wide-block'),
      ).find((target) => target.textContent?.includes('nestedWideBlock'))
      if (!codeBlockElement || !nestedCodeBlockElement) {
        throw new Error('Missing top-level or nested Markdown code fixture')
      }
      const codePreElement = select<HTMLElement>('.md-code-block:not(.md-table-block) .md-code-pre')
      const codePre = style('.md-code-block:not(.md-table-block) .md-code-pre')
      const tableScroll = select<HTMLElement>('.md-table-scroll')
      const tableBlockElement = select<HTMLElement>('.md-table-block')
      const tableBlockStyle = getComputedStyle(tableBlockElement)
      const table = style('.md-table-block table')
      const tableHeading = style('.md-table-block th')
      const lastTableHeading = style('.md-table-block th:last-child')
      const tableCell = style('.md-table-block td')
      const lastTableCell = style('.md-table-block td:last-child')
      const longPathCell = Array.from(
        element.querySelectorAll<HTMLElement>('.md-table-block td'),
      ).find((cell) =>
        cell.textContent?.includes('WorkbenchPanelPresenceWithExtremelyLongUnbrokenFilename'),
      )
      if (!longPathCell) {
        throw new Error('Missing long-path Markdown table fixture cell')
      }
      const longPathCellStyle = getComputedStyle(longPathCell)
      const threadScroller = document.querySelector<HTMLElement>(
        '[data-component="thread-scroll-layout"]',
      )
      const timeline = document.querySelector<HTMLElement>('.session-timeline-container')
      const composer = document.querySelector<HTMLElement>('.workflow-page__composer-inner')
      const mainRoute = document.querySelector<HTMLElement>('.desktop-main-route')
      const canonicalTurn = element.closest<HTMLElement>('.canonical-turn')
      const processSection = canonicalTurn?.querySelector<HTMLElement>('.canonical-turn__process')
      const processSummary = processSection?.querySelector<HTMLElement>(
        '.cpx-agent-activity__header',
      )
      const resultSection = canonicalTurn?.querySelector<HTMLElement>('.canonical-turn__result')
      const postSection = canonicalTurn?.querySelector<HTMLElement>('.canonical-turn__post')
      const patchCard = postSection?.querySelector<HTMLElement>('.canonical-patch-card')
      const userTurn = document.querySelector<HTMLElement>('.canonical-turn__user')
      const userMessage = document.querySelector<HTMLElement>('.canonical-user-message')
      const userBubble = document.querySelector<HTMLElement>('[data-user-message-bubble]')
      if (
        !threadScroller ||
        !timeline ||
        !composer ||
        !mainRoute ||
        !canonicalTurn ||
        !processSection ||
        !processSummary ||
        !resultSection ||
        !postSection ||
        !patchCard ||
        !userTurn ||
        !userMessage ||
        !userBubble
      ) {
        throw new Error('Missing responsive conversation fixture element')
      }
      const userMessageRect = userMessage.getBoundingClientRect()
      const rectMetrics = (target: HTMLElement) => {
        const rect = target.getBoundingClientRect()
        return {
          center: rect.left + rect.width / 2,
          left: rect.left,
          width: rect.width,
        }
      }
      const canonicalTurnRect = rectMetrics(canonicalTurn)
      const processSectionRect = rectMetrics(processSection)
      const processSummaryRect = rectMetrics(processSummary)
      const resultSectionRect = rectMetrics(resultSection)
      const postSectionRect = rectMetrics(postSection)
      const patchCardRect = rectMetrics(patchCard)
      const leadDescription = select<HTMLElement>('.md-lead-description')
      const leadTitle = style('.md-lead-description__title')
      const leadDetailElement = select<HTMLElement>('.md-lead-description__detail')
      const leadDetail = getComputedStyle(leadDetailElement)
      const normalSoftBreak = Array.from(element.querySelectorAll('p')).find((paragraphElement) =>
        paragraphElement.textContent?.includes('普通软换行继续保留 breaks: true'),
      )
      if (!normalSoftBreak) {
        throw new Error('Missing ordinary soft-break Markdown fixture paragraph')
      }

      return {
        bodyFontSize: body.fontSize,
        bodyFontWeight: body.fontWeight,
        bodyLineHeight: body.lineHeight,
        bodyLineHeightRatio: px(body.lineHeight) / bodySize,
        canonicalTurnCenter: canonicalTurnRect.center,
        canonicalTurnClientWidth: canonicalTurn.clientWidth,
        canonicalTurnScrollWidth: canonicalTurn.scrollWidth,
        canonicalTurnWidth: canonicalTurnRect.width,
        codeBlockBorderRadius: codeBlock.borderTopLeftRadius,
        codeBlockCenter:
          codeBlockElement.getBoundingClientRect().left +
          codeBlockElement.getBoundingClientRect().width / 2,
        codeBlockWidth: codeBlockElement.getBoundingClientRect().width,
        codeBlockLeft: codeBlockElement.getBoundingClientRect().left,
        codeBlockMarginBottom: px(codeBlock.marginBottom),
        codeBlockMarginTop: px(codeBlock.marginTop),
        codePreFontSize: codePre.fontSize,
        codePreLineHeightRatio: px(codePre.lineHeight) / px(codePre.fontSize),
        codePreClientWidth: codePreElement.clientWidth,
        codePreOverflowX: codePre.overflowX,
        codePrePaddingBottomRatio: px(codePre.paddingBottom) / rootSize,
        codePrePaddingInlineRatio: px(codePre.paddingLeft) / rootSize,
        codePrePaddingTopRatio: px(codePre.paddingTop) / rootSize,
        codePreScrollWidth: codePreElement.scrollWidth,
        composerCenter:
          composer.getBoundingClientRect().left + composer.getBoundingClientRect().width / 2,
        composerWidth: composer.getBoundingClientRect().width,
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        h1BorderBottomWidth: h1.borderBottomWidth,
        h1FontSize: h1.fontSize,
        h1FontSizeRatio: px(h1.fontSize) / bodySize,
        h1FontWeight: h1.fontWeight,
        h1LineHeight: h1.lineHeight,
        h1PaddingBottom: px(h1.paddingBottom),
        h2FontSize: h2.fontSize,
        h2FontSizeRatio: px(h2.fontSize) / bodySize,
        h2FontWeight: h2.fontWeight,
        h2LineHeight: h2.lineHeight,
        h2MarginBottomRatio: px(h2.marginBottom) / rootSize,
        h2MarginTopRatio: px(h2.marginTop) / rootSize,
        h3FontSize: h3.fontSize,
        h3FontSizeRatio: px(h3.fontSize) / bodySize,
        h3FontWeight: h3.fontWeight,
        h3LineHeight: h3.lineHeight,
        inlineCodeBorderRadius: inlineCode.borderTopLeftRadius,
        inlineCodeBorderWidth: inlineCode.borderTopWidth,
        inlineCodeFontSizeRatio: px(inlineCode.fontSize) / bodySize,
        leadDescriptionChildCount: leadDescription.children.length,
        leadDescriptionDirectBreakCount: Array.from(leadDescription.children).filter(
          (child) => child.tagName === 'BR',
        ).length,
        leadDetailBreakCount: leadDetailElement.querySelectorAll('br').length,
        leadDetailDisplay: leadDetail.display,
        leadDetailMarginTopRatio: px(leadDetail.marginTop) / bodySize,
        leadTitleDisplay: leadTitle.display,
        listItemMarginBottom: px(listItem.marginBottom),
        listItemMarginTop: px(listItem.marginTop),
        listItemLeft: listItemElement.getBoundingClientRect().left,
        listItemSiblingMarginTopRatio: px(spacedListItem.marginTop) / bodySize,
        listDirectParagraphMarginBottom: px(directListParagraph.marginBottom),
        listDirectParagraphMarginTop: px(directListParagraph.marginTop),
        listNestedItemSiblingMarginTopRatio: px(nestedSpacedListItem.marginTop) / bodySize,
        listNestedMarginBottom: px(nestedList.marginBottom),
        listNestedMarginTopRatio: px(nestedList.marginTop) / bodySize,
        listPaddingRatio: px(list.paddingLeft) / bodySize,
        listSecondParagraphMarginTopRatio: px(secondListParagraph.marginTop) / bodySize,
        longPathCellClientWidth: longPathCell.clientWidth,
        longPathCellOverflowWrap: longPathCellStyle.overflowWrap,
        longPathCellScrollWidth: longPathCell.scrollWidth,
        longPathCellWhiteSpace: longPathCellStyle.whiteSpace,
        mainRouteWidth: mainRoute.getBoundingClientRect().width,
        markdownWidth: element.getBoundingClientRect().width,
        paragraphMarginRatio: px(paragraph.marginTop) / bodySize,
        patchCardCenter: patchCardRect.center,
        patchCardWidth: patchCardRect.width,
        postSectionCenter: postSectionRect.center,
        postSectionWidth: postSectionRect.width,
        processSectionCenter: processSectionRect.center,
        processSectionWidth: processSectionRect.width,
        processSummaryLeft: processSummaryRect.left,
        readingBlockCenter:
          select<HTMLElement>('p').getBoundingClientRect().left +
          select<HTMLElement>('p').getBoundingClientRect().width / 2,
        readingBlockWidth: select<HTMLElement>('p').getBoundingClientRect().width,
        readingBlockLeft: select<HTMLElement>('p').getBoundingClientRect().left,
        resultSectionCenter: resultSectionRect.center,
        resultSectionWidth: resultSectionRect.width,
        normalSoftBreakCount: normalSoftBreak.querySelectorAll('br').length,
        normalSoftBreakLeadDescriptionCount: normalSoftBreak.classList.contains(
          'md-lead-description',
        )
          ? 1
          : 0,
        nestedCodeBlockLeft: nestedCodeBlockElement.getBoundingClientRect().left,
        nestedCodeBlockWidth: nestedCodeBlockElement.getBoundingClientRect().width,
        quoteBorderRadius: quote.borderTopLeftRadius,
        quoteBorderWidth: quote.borderLeftWidth,
        quotePaddingBlockRatio: px(quote.paddingTop) / rootSize,
        quotePaddingInlineRatio: px(quote.paddingLeft) / rootSize,
        strongFontWeight: strong.fontWeight,
        tableBackgroundColor: tableBlockStyle.backgroundColor,
        tableBlockBorderRadius: tableBlockStyle.borderTopLeftRadius,
        tableBlockBorderWidth: tableBlockStyle.borderTopWidth,
        tableBlockWidth: tableBlockElement.getBoundingClientRect().width,
        tableBorderRightWidth: tableCell.borderRightWidth,
        tableFirstCellWidth: select<HTMLElement>(
          '.md-table-block td:first-child',
        ).getBoundingClientRect().width,
        tableFontSize: table.fontSize,
        tableFontSizeRatio: px(table.fontSize) / bodySize,
        tableHeadingPaddingBottom: px(tableHeading.paddingBottom),
        tableHeadingPaddingLeft: px(tableHeading.paddingLeft),
        tableHeadingPaddingRight: px(tableHeading.paddingRight),
        tableHeadingPaddingTop: px(tableHeading.paddingTop),
        tableHeadingFontWeight: tableHeading.fontWeight,
        tableHeadingLineHeightRatio: px(tableHeading.lineHeight) / px(tableHeading.fontSize),
        tableHeadingTextAlign: tableHeading.textAlign,
        tableHeadingVerticalAlign: tableHeading.verticalAlign,
        tableLastHeadingPaddingRight: px(lastTableHeading.paddingRight),
        tableLastCellPaddingRight: px(lastTableCell.paddingRight),
        tableLayout: table.tableLayout,
        tableLineHeightRatio: px(tableCell.lineHeight) / px(tableCell.fontSize),
        tablePaddingBottom: px(tableCell.paddingBottom),
        tablePaddingLeft: px(tableCell.paddingLeft),
        tablePaddingRight: px(tableCell.paddingRight),
        tablePaddingTop: px(tableCell.paddingTop),
        tableTextAlign: tableCell.textAlign,
        tableVerticalAlign: tableCell.verticalAlign,
        tableWrapperClientWidth: tableScroll.clientWidth,
        tableWrapperOverflowX: getComputedStyle(tableScroll).overflowX,
        tableWrapperScrollWidth: tableScroll.scrollWidth,
        threadClientWidth: threadScroller.clientWidth,
        threadScrollWidth: threadScroller.scrollWidth,
        timelineWidth: timeline.getBoundingClientRect().width,
        userBubbleMaxWidth: getComputedStyle(userBubble).maxWidth,
        userBubbleWidth: userBubble.getBoundingClientRect().width,
        userMessageCenter: userMessageRect.left + userMessageRect.width / 2,
        userMessageLeft: userMessageRect.left,
        userMessageWidth: userMessageRect.width,
        userTurnCenter:
          userTurn.getBoundingClientRect().left + userTurn.getBoundingClientRect().width / 2,
        userTurnWidth: userTurn.getBoundingClientRect().width,
      }
    })

    expect(metrics.bodyFontSize).toBe('14px')
    expect(metrics.bodyFontWeight).toBe('400')
    expect(metrics.bodyLineHeight).toBe('24px')
    expect(metrics.bodyLineHeightRatio).toBeCloseTo(24 / 14, 2)
    expect(metrics.paragraphMarginRatio).toBeCloseTo(14 / 14, 2)
    expect(metrics.h1FontSize).toBe('24px')
    expect(metrics.h1LineHeight).toBe('30px')
    expect(metrics.h1FontWeight).toBe('600')
    expect(metrics.h1FontSizeRatio).toBeCloseTo(24 / 14, 2)
    expect(metrics.h1BorderBottomWidth).toBe('0px')
    expect(metrics.h1PaddingBottom).toBe(0)
    expect(metrics.h2FontSize).toBe('20px')
    expect(metrics.h2LineHeight).toBe('28px')
    expect(metrics.h2FontWeight).toBe('600')
    expect(metrics.h2FontSizeRatio).toBeCloseTo(20 / 14, 2)
    expect(metrics.h2MarginTopRatio).toBeCloseTo(26 / 16, 2)
    expect(metrics.h2MarginBottomRatio).toBeCloseTo(10 / 16, 2)
    expect(metrics.h3FontSize).toBe('16px')
    expect(metrics.h3LineHeight).toBe('22px')
    expect(metrics.h3FontWeight).toBe('600')
    expect(metrics.h3FontSizeRatio).toBeCloseTo(16 / 14, 2)
    expect(metrics.strongFontWeight).toBe('600')
    expect(metrics.listPaddingRatio).toBeCloseTo(1.45, 2)
    expect(metrics.listItemMarginTop).toBe(0)
    expect(metrics.listItemMarginBottom).toBe(0)
    expect(metrics.listItemSiblingMarginTopRatio).toBeCloseTo(10 / 14, 2)
    expect(metrics.listNestedItemSiblingMarginTopRatio).toBeCloseTo(10 / 14, 2)
    expect(metrics.listDirectParagraphMarginTop).toBe(0)
    expect(metrics.listDirectParagraphMarginBottom).toBe(0)
    expect(metrics.listSecondParagraphMarginTopRatio).toBeCloseTo(12 / 14, 2)
    expect(metrics.listNestedMarginTopRatio).toBeCloseTo(10 / 14, 2)
    expect(metrics.listNestedMarginBottom).toBe(0)
    expect(metrics.quoteBorderWidth).toBe('2px')
    expect(metrics.quoteBorderRadius).toBe('12px')
    expect(metrics.quotePaddingBlockRatio).toBeCloseTo(0.55, 2)
    expect(metrics.quotePaddingInlineRatio).toBeCloseTo(1, 2)
    expect(metrics.inlineCodeBorderWidth).toBe('0px')
    expect(metrics.inlineCodeBorderRadius).toBe('4px')
    expect(metrics.inlineCodeFontSizeRatio).toBeCloseTo(13 / 14, 2)
    expect(metrics.leadDescriptionChildCount).toBe(2)
    expect(metrics.leadDescriptionDirectBreakCount).toBe(0)
    expect(metrics.leadTitleDisplay).toBe('block')
    expect(metrics.leadDetailDisplay).toBe('block')
    expect(metrics.leadDetailBreakCount).toBe(1)
    expect(metrics.leadDetailMarginTopRatio).toBeCloseTo(0.3, 2)
    expect(metrics.normalSoftBreakCount).toBe(1)
    expect(metrics.normalSoftBreakLeadDescriptionCount).toBe(0)
    expect(metrics.codeBlockMarginTop).toBe(14)
    expect(metrics.codeBlockMarginBottom).toBe(18)
    expect(metrics.codeBlockBorderRadius).toBe('12px')
    expect(metrics.codePreLineHeightRatio).toBeCloseTo(20 / 13, 2)
    expect(metrics.codePrePaddingTopRatio).toBeCloseTo(0.9, 2)
    expect(metrics.codePrePaddingInlineRatio).toBeCloseTo(1, 2)
    expect(metrics.codePrePaddingBottomRatio).toBeCloseTo(0.85, 2)
    expect(metrics.codePreFontSize).toBe('13px')
    expect(metrics.codePreOverflowX).toBe('auto')
    expect(metrics.codePreScrollWidth).toBeGreaterThan(metrics.codePreClientWidth)
    expect(metrics.tableBackgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(metrics.tableBlockBorderRadius).toBe('0px')
    expect(metrics.tableBlockBorderWidth).toBe('0px')
    expect(metrics.tableFirstCellWidth).toBeGreaterThanOrEqual(90)
    expect(metrics.tableFontSize).toBe('14px')
    expect(metrics.tableFontSizeRatio).toBeCloseTo(1, 2)
    expect(metrics.tableBorderRightWidth).toBe('0px')
    expect(metrics.tableHeadingFontWeight).toBe('500')
    expect(metrics.tableHeadingLineHeightRatio).toBeCloseTo(24 / 14, 2)
    expect(metrics.tableHeadingPaddingTop).toBe(8)
    expect(metrics.tableHeadingPaddingRight).toBe(24)
    expect(metrics.tableHeadingPaddingBottom).toBe(8)
    expect(metrics.tableHeadingPaddingLeft).toBe(0)
    expect(metrics.tableHeadingTextAlign).toBe('left')
    expect(metrics.tableHeadingVerticalAlign).toBe('top')
    expect(metrics.tableLastHeadingPaddingRight).toBe(40)
    expect(metrics.tableLayout).toBe('auto')
    expect(metrics.tableLineHeightRatio).toBeCloseTo(24 / 14, 2)
    expect(metrics.tablePaddingTop).toBe(10)
    expect(metrics.tablePaddingRight).toBe(24)
    expect(metrics.tablePaddingBottom).toBe(10)
    expect(metrics.tablePaddingLeft).toBe(0)
    expect(metrics.tableLastCellPaddingRight).toBe(0)
    expect(metrics.tableTextAlign).toBe('left')
    expect(metrics.tableVerticalAlign).toBe('top')
    expect(metrics.tableWrapperOverflowX).toBe('auto')
    expect(metrics.tableWrapperScrollWidth).toBeGreaterThanOrEqual(metrics.tableWrapperClientWidth)
    expect(metrics.longPathCellScrollWidth).toBeGreaterThanOrEqual(metrics.longPathCellClientWidth)
    expect(metrics.longPathCellWhiteSpace).toBe('normal')
    expect(metrics.longPathCellOverflowWrap).toBe('normal')
    expect(metrics.threadScrollWidth).toBeLessThanOrEqual(metrics.threadClientWidth + 1)
    expect(metrics.timelineWidth).toBeLessThanOrEqual(metrics.mainRouteWidth)
    expect(metrics.composerWidth).toBeLessThanOrEqual(metrics.mainRouteWidth)
    expect(metrics.readingBlockWidth).toBeLessThanOrEqual(1009)
    expect(metrics.canonicalTurnWidth).toBeCloseTo(metrics.readingBlockWidth, 0)
    expect(metrics.processSectionWidth).toBeCloseTo(metrics.readingBlockWidth, 0)
    expect(metrics.resultSectionWidth).toBeCloseTo(metrics.readingBlockWidth, 0)
    expect(metrics.postSectionWidth).toBeCloseTo(metrics.readingBlockWidth, 0)
    expect(metrics.codeBlockWidth).toBeCloseTo(metrics.readingBlockWidth, 0)
    expect(metrics.codeBlockLeft).toBeCloseTo(metrics.readingBlockLeft, 0)
    expect(metrics.nestedCodeBlockWidth).toBeCloseTo(metrics.readingBlockWidth, 0)
    expect(metrics.nestedCodeBlockLeft).toBeCloseTo(metrics.readingBlockLeft, 0)
    expect(metrics.listItemLeft).toBeGreaterThan(metrics.readingBlockLeft)
    expect(metrics.composerWidth).toBeLessThanOrEqual(1009)
    expect(metrics.tableBlockWidth).toBeLessThanOrEqual(1009)
    expect(metrics.tableBlockWidth).toBeCloseTo(metrics.readingBlockWidth, 0)
    expect(metrics.patchCardWidth).toBeCloseTo(metrics.readingBlockWidth, 0)
    for (const center of [
      metrics.canonicalTurnCenter,
      metrics.processSectionCenter,
      metrics.resultSectionCenter,
      metrics.postSectionCenter,
      metrics.codeBlockCenter,
      metrics.patchCardCenter,
      metrics.composerCenter,
    ]) {
      expect(Math.abs(center - metrics.readingBlockCenter)).toBeLessThanOrEqual(1)
    }
    expect(Math.abs(metrics.processSummaryLeft - metrics.readingBlockLeft)).toBeLessThanOrEqual(1)
    expect(metrics.userTurnWidth).toBeLessThanOrEqual(1009)
    expect(metrics.userMessageWidth).toBeCloseTo(metrics.userTurnWidth, 0)
    expect(metrics.userBubbleMaxWidth).toBe('77%')
    expect(metrics.userBubbleWidth).toBeLessThanOrEqual(metrics.userMessageWidth * 0.77 + 1)
    expect(metrics.userBubbleWidth).toBeLessThan(metrics.userMessageWidth)
    expect(Math.abs(metrics.userTurnCenter - metrics.readingBlockCenter)).toBeLessThanOrEqual(1)
    expect(Math.abs(metrics.composerCenter - metrics.readingBlockCenter)).toBeLessThanOrEqual(1)
    if (visualCase.id === 'desktop-light') {
      expect(metrics.readingBlockWidth).toBeCloseTo(1009, 0)
      expect(metrics.canonicalTurnWidth).toBeCloseTo(1009, 0)
      expect(metrics.processSectionWidth).toBeCloseTo(1009, 0)
      expect(metrics.resultSectionWidth).toBeCloseTo(1009, 0)
      expect(metrics.postSectionWidth).toBeCloseTo(1009, 0)
      expect(metrics.codeBlockWidth).toBeCloseTo(1009, 0)
      expect(metrics.composerWidth).toBeCloseTo(1009, 0)
      expect(metrics.tableBlockWidth).toBeCloseTo(1009, 0)
      expect(metrics.patchCardWidth).toBeCloseTo(1009, 0)
      expect(metrics.timelineWidth).toBeGreaterThan(metrics.composerWidth)
    }
    expect(metrics.canonicalTurnScrollWidth).toBeLessThanOrEqual(
      metrics.canonicalTurnClientWidth + 1,
    )
    expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.documentClientWidth)

    await tableBlock.hover()
    await expect(tableCopy).toHaveCSS('opacity', '1')
    await tableCopy.focus()
    await expect(tableCopy).toBeFocused()
    await expect(tableCopy).toHaveCSS('opacity', '1')

    const attachmentMetrics = await userTurnLocator.evaluate((element) => {
      const imageTiles = Array.from(element.querySelectorAll<HTMLElement>('.attachment-image-tile'))
      const readyImage = imageTiles.find((tile) => tile.dataset.status === 'ready')
      const failedImage = imageTiles.find((tile) => tile.dataset.status === 'error')
      const filePill = element.querySelector<HTMLElement>('.attachment-file-pill')
      const imageRow = element.querySelector<HTMLElement>('[aria-label="图片附件"]')
      const fileRow = element.querySelector<HTMLElement>('[aria-label="文件附件"]')
      const bubble = element.querySelector<HTMLElement>('[data-user-message-bubble]')
      if (!readyImage || !failedImage || !filePill || !imageRow || !fileRow || !bubble) {
        throw new Error('Missing attachment layout fixture elements')
      }
      const bubbleRect = bubble.getBoundingClientRect()
      return {
        bubbleTop: bubbleRect.top,
        failedImageHeight: failedImage.getBoundingClientRect().height,
        failedImageWidth: failedImage.getBoundingClientRect().width,
        filePillMaxWidth: getComputedStyle(filePill).maxWidth,
        fileRowOverflowX: getComputedStyle(fileRow).overflowX,
        fileRowTop: fileRow.getBoundingClientRect().top,
        imageHeight: readyImage.getBoundingClientRect().height,
        imageRowOverflowX: getComputedStyle(imageRow).overflowX,
        imageRowTop: imageRow.getBoundingClientRect().top,
        imageWidth: readyImage.getBoundingClientRect().width,
      }
    })
    expect(attachmentMetrics.imageWidth).toBe(80)
    expect(attachmentMetrics.imageHeight).toBe(80)
    expect(attachmentMetrics.failedImageWidth).toBe(64)
    expect(attachmentMetrics.failedImageHeight).toBe(64)
    expect(attachmentMetrics.filePillMaxWidth).toBe('320px')
    expect(attachmentMetrics.imageRowOverflowX).toBe('auto')
    expect(attachmentMetrics.fileRowOverflowX).toBe('auto')
    expect(attachmentMetrics.imageRowTop).toBeLessThan(attachmentMetrics.bubbleTop)
    expect(attachmentMetrics.fileRowTop).toBeLessThan(attachmentMetrics.bubbleTop)

    if (visualCase.id === 'desktop-light') {
      const patchCard = page.locator('.canonical-patch-card').first()
      await expect(patchCard).toBeVisible()
      const patchMetrics = await patchCard.evaluate((element) => {
        const fileRow = element.querySelector<HTMLElement>('.canonical-patch-card__file')
        const disclosure = element.querySelector<HTMLElement>('.canonical-patch-card__disclosure')
        if (!fileRow || !disclosure) {
          throw new Error('Missing patch card rows')
        }
        return {
          center: element.getBoundingClientRect().left + element.getBoundingClientRect().width / 2,
          disclosureHeight: disclosure.getBoundingClientRect().height,
          fileRowHeight: fileRow.getBoundingClientRect().height,
          width: element.getBoundingClientRect().width,
        }
      })
      expect(patchMetrics.width).toBeCloseTo(metrics.readingBlockWidth, 0)
      expect(patchMetrics.fileRowHeight).toBe(36)
      expect(patchMetrics.disclosureHeight).toBe(36)
      expect(Math.abs(patchMetrics.center - metrics.readingBlockCenter)).toBeLessThanOrEqual(1)

      await userBubbleLocator.getByRole('button', { name: '显示更多' }).click()
      await expect(userBubbleLocator.getByRole('button', { name: '收起' })).toBeVisible()
      await userTurnLocator.getByRole('button', { name: '修改并重新发送' }).click()
      const editorSurface = userTurnLocator.locator('.canonical-user-message__editor-surface')
      await expect(editorSurface).toBeVisible()
      await expect(editorSurface.getByRole('group', { name: '图片附件' })).toBeVisible()
      await expect(editorSurface.getByRole('group', { name: '文件附件' })).toBeVisible()
      const editMetrics = await editorSurface.evaluate((element) => {
        const editingMessage = element.closest<HTMLElement>('.canonical-user-message--editing')
        const turn = element.closest<HTMLElement>('.canonical-turn__user')
        if (!editingMessage || !turn) throw new Error('Missing edited message axis')
        return {
          messageWidth: editingMessage.getBoundingClientRect().width,
          turnWidth: turn.getBoundingClientRect().width,
        }
      })
      expect(editMetrics.messageWidth).toBeCloseTo(editMetrics.turnWidth, 0)
      const originalAttachmentCount = await editorSurface
        .locator('.attachment-image-tile, .attachment-file-pill')
        .count()
      await editorSurface.getByRole('button', { name: '移除 工作台布局.png' }).click()
      await expect(
        editorSurface.locator('.attachment-image-tile, .attachment-file-pill'),
      ).toHaveCount(originalAttachmentCount - 1)
      await editorSurface.getByRole('button', { name: '取消' }).click()
      await expect(userTurnLocator.locator('.attachment-image-tile')).toHaveCount(3)
    }
  })
}

for (const viewport of VIEWPORTS) {
  for (const mode of MODES) {
    for (const scenario of SCENARIOS) {
      test(`${viewport.id} ${mode} ${scenario.id}`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await page.emulateMedia({
          colorScheme: mode,
          forcedColors: 'none',
          reducedMotion: 'reduce',
        })
        await page.goto(scenario.route)
        await closeTransientErrorToast(page)
        await expect(page.getByText(scenario.readyText, { exact: true })).toBeVisible()
        await scenario.prepare?.(page)
        await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
        await expect(page.locator('html')).toHaveAttribute(
          'data-code-theme-id',
          mode === 'light' ? 'codex-light' : 'codex-dark',
        )
        await closeTransientErrorToast(page, 3_000)
        await waitForMaterialIcons(page)
        await expect(page.locator('body')).toHaveScreenshot(
          `${viewport.id}-${mode}-${scenario.id}.png`,
          {
            animations: 'disabled',
            caret: 'hide',
            scale: 'css',
          },
        )
        const overflow = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }))
        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
      })
    }
  }
}

for (const viewport of VIEWPORTS) {
  for (const mode of MODES) {
    test(`${viewport.id} ${mode} appearance page`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/?visualCase=empty#/settings/appearance')
      await closeTransientErrorToast(page)
      await page
        .getByRole('radiogroup', { name: '外观模式' })
        .getByRole('radio', { name: mode === 'light' ? '浅色' : '深色' })
        .click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
      await expect(page.getByRole('heading', { name: '外观' })).toBeVisible()
      await closeTransientErrorToast(page, 1_500)
      await expect(page.locator('body')).toHaveScreenshot(`${viewport.id}-${mode}-appearance.png`, {
        animations: 'disabled',
        caret: 'hide',
        fullPage: true,
        scale: 'css',
      })
      const overflow = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
    })
  }
}

for (const mode of MODES) {
  test(`open file empty state ${mode}`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.emulateMedia({
      colorScheme: mode,
      forcedColors: 'none',
      reducedMotion: 'reduce',
    })
    await page.goto('/?visualCase=rich#/threads/visual-rich')
    await closeTransientErrorToast(page)
    await expect(page.getByText('已完成工作台结构梳理。', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '显示右侧面板' }).click()
    const rightPanel = page.getByRole('complementary', {
      name: '右侧面板',
    })
    await rightPanel.getByRole('button', { name: '文件 Ctrl+P' }).click()

    await expect(rightPanel.getByRole('tab', { name: '打开文件' })).toBeVisible()
    await expect(rightPanel.getByRole('region', { name: '打开文件' })).toBeVisible()
    await expect(rightPanel.getByLabel('文件路径：工作区根目录')).toContainText('/')
    await expect(rightPanel.getByRole('complementary', { name: '工作区文件树' })).toBeVisible()
    await expect(rightPanel.getByText('README.md', { exact: true })).toBeVisible()
    await expect(rightPanel.getByText('没有匹配的文件。', { exact: true })).toBeHidden()
    await expect(rightPanel.getByRole('button', { name: '隐藏文件树' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(rightPanel.getByRole('searchbox', { name: '筛选文件' })).toBeFocused()
    await expect(rightPanel.locator('.right-dock-header')).toHaveCSS('height', '46px')
    await expect(rightPanel.locator('.file-breadcrumb-toolbar')).toHaveCSS('height', '40px')
    await expect(rightPanel.locator('.right-dock-search')).toHaveCSS('height', '28px')
    await expect(rightPanel.locator('.right-dock-tabs-viewport')).toHaveCSS('overflow-x', 'auto')
    await expect(
      rightPanel.locator('.right-dock-tabs-viewport .right-dock-add-button'),
    ).toHaveCount(0)
    const appsDirectory = rightPanel.getByRole('treeitem', { name: 'apps' })
    await expect(appsDirectory).toHaveAttribute('aria-expanded', 'false')
    await expect(rightPanel.locator('[data-file-tree-virtualized-scroll="true"]')).toBeVisible()
    await expect(rightPanel).toHaveScreenshot(`open-file-empty-${mode}.png`, {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    })

    await appsDirectory.click()
    await expect(appsDirectory).toHaveAttribute('aria-expanded', 'true')
    await expect(rightPanel.getByRole('treeitem', { name: 'desktop' })).toBeVisible()
    await rightPanel.getByText('README.md', { exact: true }).click()
    await expect(rightPanel.getByRole('tab', { name: 'README.md' })).toBeVisible()
    await expect(rightPanel.locator('.file-breadcrumb-toolbar__path button')).toHaveCount(0)
  })
}

test('Markdown file switches between rich and source presentations', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/?visualCase=rich#/threads/visual-rich')
  await closeTransientErrorToast(page)
  await expect(page.getByText('已完成工作台结构梳理。', { exact: true })).toBeVisible()
  await expect(page.getByRole('switch', { name: '调试模式' })).toHaveCount(0)
  const assistantActions = page.locator('.canonical-message-actions--assistant').first()
  await expect(assistantActions).toBeVisible()
  await expect(assistantActions.getByRole('button', { name: '复制' })).toBeVisible()
  await page.getByRole('button', { name: '显示右侧面板' }).click()

  const rightPanel = page.getByRole('complementary', { name: '右侧面板' })
  await rightPanel.getByRole('button', { name: '文件 Ctrl+P' }).click()
  await rightPanel.getByText('README.md', { exact: true }).click()

  await expect(rightPanel.getByRole('tab', { name: 'README.md' })).toBeVisible()
  await expect(rightPanel.getByRole('button', { name: '查看源代码' })).toBeVisible()
  await expect(rightPanel.locator('.cm-editor.cm-markdown-rich')).toBeVisible()
  await expect(rightPanel.locator('.cm-md-rich-h1')).toHaveText('Pidex')
  await expect(rightPanel.locator('.cm-md-rich-list-marker')).toHaveText('•')
  await expect(rightPanel.locator('.cm-md-rich-table-widget table')).toBeVisible()
  await expect(rightPanel.locator('.cm-md-rich-table-widget th')).toHaveText(['优化点', '说明'])
  await expect(rightPanel.locator('.cm-md-rich-table-widget td')).toHaveText([
    '缓存命中优化',
    '稳定复用前缀',
  ])
  await expect(rightPanel.locator('.cm-md-rich-code-block').first()).toBeVisible()
  const richBlockBackgrounds = await rightPanel.evaluate((panel) => {
    const table = panel.querySelector<HTMLElement>('.cm-md-rich-table-widget')
    const codeLines = panel.querySelectorAll<HTMLElement>('.cm-md-rich-code-block')
    const firstCodeLine = codeLines.item(0)
    const lastCodeLine = codeLines.item(codeLines.length - 1)
    if (!table || !firstCodeLine || !lastCodeLine) return null
    const probe = document.createElement('span')
    probe.style.backgroundColor = 'var(--surface-code-block)'
    probe.style.borderRadius = 'var(--radius-lg, var(--radius-5))'
    panel.append(probe)
    const probeStyle = getComputedStyle(probe)
    const expected = probeStyle.backgroundColor
    const expectedRadius = probeStyle.borderTopLeftRadius
    probe.remove()
    return {
      code: getComputedStyle(firstCodeLine).backgroundColor,
      codeBottomRadius: getComputedStyle(lastCodeLine).borderBottomLeftRadius,
      codeTopRadius: getComputedStyle(firstCodeLine).borderTopLeftRadius,
      expected,
      expectedRadius,
      table: getComputedStyle(table).backgroundColor,
      tableRadius: getComputedStyle(table).borderTopLeftRadius,
    }
  })
  expect(richBlockBackgrounds).toEqual({
    code: richBlockBackgrounds?.expected,
    codeBottomRadius: richBlockBackgrounds?.expectedRadius,
    codeTopRadius: richBlockBackgrounds?.expectedRadius,
    expected: richBlockBackgrounds?.expected,
    expectedRadius: richBlockBackgrounds?.expectedRadius,
    table: richBlockBackgrounds?.expected,
    tableRadius: richBlockBackgrounds?.expectedRadius,
  })
  await expect(rightPanel.locator('.cm-activeLine')).toHaveCount(0)
  await expect(rightPanel.locator('.cm-gutters')).toHaveCount(0)
  await expect(rightPanel.locator('.cm-foldGutter')).toHaveCount(0)

  await rightPanel.locator('.cm-md-rich-table-widget').click()
  await expect(rightPanel.locator('.cm-md-rich-table-widget')).toHaveCount(0)
  await expect(rightPanel.locator('.cm-content')).toContainText('| 优化点 | 说明 |')

  await rightPanel.getByRole('button', { name: '查看源代码' }).click()

  await expect(rightPanel.getByRole('button', { name: '查看预览' })).toBeVisible()
  await expect(rightPanel.locator('.cm-editor.cm-markdown-rich')).toHaveCount(0)
  await expect(rightPanel.locator('.cm-gutters')).toBeVisible()
  await expect(rightPanel.locator('.cm-content')).toContainText('# Pidex')
  await expect(rightPanel.locator('.cm-foldGutter')).toHaveCount(0)
})

test('session header aligns with the right panel and bottom panel spans the workspace', async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 920 })
  await gotoWorkbenchFixture(page, '/?visualCase=rich#/threads/visual-rich')
  await closeTransientErrorToast(page)
  await expect(page.getByText('已完成工作台结构梳理。', { exact: true })).toBeVisible()

  const header = page.locator('.desktop-main-route__header-spacer')
  const workflow = page.locator('.workflow-page')
  const scrollArea = page.locator('[data-component="thread-scroll-layout"]')
  const initialHeader = await header.boundingBox()
  const initialWorkflow = await workflow.boundingBox()
  expect(initialHeader).not.toBeNull()
  expect(initialWorkflow).not.toBeNull()
  expect(initialHeader!.x).toBeCloseTo(initialWorkflow!.x, 0)
  expect(initialHeader!.width).toBeCloseTo(initialWorkflow!.width, 0)

  await scrollArea.evaluate((element) => {
    element.scrollTop = 0
  })
  const scrolledHeader = await header.boundingBox()
  expect(scrolledHeader!.y).toBeCloseTo(initialHeader!.y, 0)
  expect(scrolledHeader!.height).toBeCloseTo(initialHeader!.height, 0)

  const bottomPanelButton = page.getByRole('button', {
    name: '打开集成终端 (Ctrl+`)',
  })
  const rightDockButton = page.getByRole('button', {
    name: '显示右侧面板',
  })
  await expect(bottomPanelButton).toHaveAttribute('aria-pressed', 'false')
  await expect(rightDockButton).toHaveAttribute('aria-pressed', 'false')

  const rightDockButtonBefore = await rightDockButton.boundingBox()
  await rightDockButton.click()
  const activeRightDockButton = page.getByRole('button', {
    name: '关闭右侧面板',
  })
  await expect(activeRightDockButton).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('complementary', { name: '右侧面板' })).toBeVisible()
  await expect(
    page.getByRole('complementary', { name: '右侧面板' }).getByLabel('可用面板标签'),
  ).toBeVisible()
  await page
    .getByRole('complementary', { name: '右侧面板' })
    .getByRole('button', { name: /^审阅/ })
    .click()

  const headerWithDock = await header.boundingBox()
  const dock = await page.getByRole('complementary', { name: '右侧面板' }).boundingBox()
  const dockHeader = await page.locator('.right-dock-header').boundingBox()
  const upper = await page.locator('.desktop-workspace__upper').boundingBox()
  const rightDockButtonAfter = await activeRightDockButton.boundingBox()
  expect(headerWithDock!.width).toBeLessThan(initialHeader!.width)
  expect(dock!.y).toBeCloseTo(headerWithDock!.y, 0)
  expect(dockHeader!.height).toBeCloseTo(headerWithDock!.height, 0)
  expect(headerWithDock!.width + dock!.width).toBeCloseTo(upper!.width, 0)
  expect(rightDockButtonAfter!.x).toBeCloseTo(rightDockButtonBefore!.x, 0)

  await bottomPanelButton.click()
  const activeBottomPanelButton = page.getByRole('button', {
    name: '隐藏集成终端',
  })
  await expect(activeBottomPanelButton).toHaveAttribute('aria-pressed', 'true')
  const bottomPanelElement = page.getByRole('complementary', {
    name: '底部面板',
  })
  const bottomPanelShell = page.locator('.desktop-workspace-panel--bottom')
  const bottomPanelSurface = bottomPanelShell.locator('.desktop-workspace-panel__surface')
  const bottomPanelSpacer = page.locator('.desktop-workspace-panel-spacer--bottom')
  const bottomUpperRegion = page.locator('.desktop-workspace__upper')
  await expect(bottomPanelElement).toBeVisible()
  const bottomPanel = await bottomPanelElement.boundingBox()
  const workspace = await page.locator('.desktop-workspace').boundingBox()
  const [bottomShellBox, bottomSurfaceBox, bottomSpacerBox, bottomUpperBox] = await Promise.all([
    bottomPanelShell.boundingBox(),
    bottomPanelSurface.boundingBox(),
    bottomPanelSpacer.boundingBox(),
    bottomUpperRegion.boundingBox(),
  ])
  expect(bottomShellBox).not.toBeNull()
  expect(bottomSurfaceBox).not.toBeNull()
  expect(bottomSpacerBox).not.toBeNull()
  expect(bottomUpperBox).not.toBeNull()
  expect(bottomPanel!.x).toBeCloseTo(workspace!.x, 0)
  expect(bottomPanel!.width).toBeCloseTo(workspace!.width, 0)
  expect(bottomShellBox!.y + bottomShellBox!.height).toBeCloseTo(
    workspace!.y + workspace!.height,
    0,
  )
  expect(bottomSpacerBox!.y).toBeCloseTo(bottomShellBox!.y, 0)
  expect(bottomSpacerBox!.height).toBeCloseTo(bottomShellBox!.height, 0)
  expect(Math.abs(bottomSurfaceBox!.height - bottomShellBox!.height)).toBeLessThanOrEqual(1)
  await expect(bottomPanelShell).toHaveCSS('position', 'absolute')
  await expect(bottomPanelSurface).toHaveCSS('display', 'flex')
  await expect(bottomPanelSurface).toHaveCSS('flex-direction', 'column')
  await expect(bottomPanelSurface).toHaveCSS('overflow', 'hidden')
  const bottomSeparator = page.getByRole('separator', {
    name: '调整底部面板高度',
  })
  const bottomSeparatorBox = await bottomSeparator.boundingBox()
  expect(bottomSeparatorBox).not.toBeNull()
  await page.mouse.move(
    bottomSeparatorBox!.x + bottomSeparatorBox!.width / 2,
    bottomSeparatorBox!.y + bottomSeparatorBox!.height / 2,
  )
  const bottomPointerDownStartedAt = Date.now()
  await page.mouse.down()
  expect(Date.now() - bottomPointerDownStartedAt).toBeLessThan(200)
  await page.mouse.move(bottomSeparatorBox!.x + 40, bottomSeparatorBox!.y - 80, {
    steps: 6,
  })
  await expect
    .poll(async () => (await bottomPanelElement.boundingBox())?.height)
    .toBeGreaterThan(bottomPanel!.height + 48)
  const [liveBottomShellBox, liveBottomSurfaceBox, liveBottomSpacerBox, liveBottomUpperBox] =
    await Promise.all([
      bottomPanelShell.boundingBox(),
      bottomPanelSurface.boundingBox(),
      bottomPanelSpacer.boundingBox(),
      bottomUpperRegion.boundingBox(),
    ])
  expect(liveBottomShellBox).not.toBeNull()
  expect(liveBottomSurfaceBox).not.toBeNull()
  expect(liveBottomSpacerBox).not.toBeNull()
  expect(liveBottomUpperBox).not.toBeNull()
  expect(Math.abs(liveBottomSurfaceBox!.height - liveBottomShellBox!.height)).toBeLessThanOrEqual(1)
  expect(liveBottomSpacerBox!.height).toBeCloseTo(liveBottomShellBox!.height, 0)
  expect(liveBottomSpacerBox!.y).toBeCloseTo(liveBottomShellBox!.y, 0)
  expect(liveBottomUpperBox!.height).toBeLessThan(bottomUpperBox!.height - 48)
  expect(bottomUpperBox!.height - liveBottomUpperBox!.height).toBeCloseTo(
    liveBottomShellBox!.height - bottomShellBox!.height,
    0,
  )
  expect(liveBottomShellBox!.y + liveBottomShellBox!.height).toBeCloseTo(
    workspace!.y + workspace!.height,
    0,
  )
  await expect(page.locator('.workbench-resize-guide')).toHaveCount(0)
  await expect(bottomPanelElement.locator('.workbench-panel-content')).toHaveCSS('filter', 'none')
  await expect(bottomPanelElement.locator('.workbench-panel-header')).toHaveCSS('filter', 'none')
  const bottomPointerUpStartedAt = Date.now()
  await page.mouse.up()
  expect(Date.now() - bottomPointerUpStartedAt).toBeLessThan(200)
  await expect
    .poll(async () => (await bottomPanelElement.boundingBox())?.height)
    .toBeGreaterThan(bottomPanel!.height)
  await expect(bottomPanelElement.locator('.workbench-panel-content')).toHaveCSS('filter', 'none')
  await bottomSeparator.dblclick()

  const sessionMenuButton = page.getByRole('button', {
    name: '更多会话操作',
  })
  await sessionMenuButton.click()
  await expect(page.getByRole('menuitem', { name: /显示 workflow 事件/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(sessionMenuButton).toBeFocused()

  await page.getByRole('menuitem', { name: '窗口', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: '最小化' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /调试/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
})

test('right panel scales with its workspace and keeps a constrained manual override', async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 920 })
  await gotoWorkbenchFixture(page, '/?visualCase=review#/threads/visual-review')
  await closeTransientErrorToast(page)
  await expect(page.getByText('已完成工作台结构梳理。', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '显示右侧面板' }).click()
  const rightPanel = page.getByRole('complementary', { name: '右侧面板' })
  const rightPanelShell = page.locator('.desktop-workspace-panel--right')
  const rightPanelSurface = rightPanelShell.locator('.desktop-workspace-panel__surface')
  const rightPanelSpacer = page.locator('.desktop-workspace-panel-spacer--right')
  const mainRoute = page.locator('.desktop-main-route')
  const upperRegion = page.locator('.desktop-workspace__upper')
  await expect(rightPanel).toBeVisible()
  await expect(rightPanelShell).toHaveCSS('position', 'absolute')
  await expect(rightPanelSurface).toHaveCSS('display', 'flex')
  await expect(rightPanelSurface).toHaveCSS('flex-direction', 'column')
  await expect(rightPanelSurface).toHaveCSS('overflow', 'hidden')
  await rightPanel.getByRole('button', { name: '审阅 Ctrl+Shift+G' }).click()
  const sourceMenu = await openAndAssertReviewSourceMenu(page, rightPanel)
  await page.keyboard.press('Escape')
  await expect(sourceMenu).toBeHidden()
  const smallDiffSection = rightPanel.getByLabel(
    'apps/desktop/renderer/test/CodexStyleContracts.test.ts diff',
  )
  await expect(smallDiffSection).toBeVisible({ timeout: 10_000 })
  const regularDiff = smallDiffSection.locator(
    '.review-codex-diff:not(.review-codex-diff--virtual)',
  )
  await expect(regularDiff).toBeVisible({ timeout: 10_000 })
  await expect(regularDiff).toHaveAttribute('data-review-syntax-state', 'ready', {
    timeout: 10_000,
  })
  await expect(smallDiffSection.locator('.review-codex-diff--virtual')).toHaveCount(0)
  await expect(regularDiff.locator('[data-diff-sync-row]')).toHaveCount(0)
  const splitRowAlignment = await regularDiff.evaluate((element) => {
    const leftRows = Array.from(
      element.querySelectorAll<HTMLElement>(':scope > [data-deletions] > [data-content] > *'),
    )
    const rightRows = Array.from(
      element.querySelectorAll<HTMLElement>(':scope > [data-additions] > [data-content] > *'),
    )
    return {
      aligned: leftRows.every((row, index) => {
        const peer = rightRows[index]
        if (!peer) return false
        const leftRect = row.getBoundingClientRect()
        const rightRect = peer.getBoundingClientRect()
        return (
          Math.abs(leftRect.top - rightRect.top) <= 1 &&
          Math.abs(leftRect.bottom - rightRect.bottom) <= 1
        )
      }),
      leftCount: leftRows.length,
      rightCount: rightRows.length,
    }
  })
  expect(splitRowAlignment.leftCount).toBeGreaterThan(0)
  expect(splitRowAlignment.rightCount).toBe(splitRowAlignment.leftCount)
  expect(splitRowAlignment.aligned).toBe(true)
  await expect.poll(async () => rightPanel.locator('.review-diff-word').count()).toBeGreaterThan(0)

  const addedRow = rightPanel
    .locator('.review-codex-diff__line[data-line-type="change-addition"]')
    .first()
  await expect(addedRow).toBeVisible()
  const diffColors = await addedRow.evaluate((row) => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--color-decoration-added)'
    document.body.append(probe)
    const colors = {
      lineBackground: getComputedStyle(row).backgroundColor,
      rawAdded: getComputedStyle(probe).color,
    }
    probe.remove()
    return colors
  })
  expect(diffColors.lineBackground).not.toBe(diffColors.rawAdded)

  await rightPanel.locator('.review-sidebar-actions').getByRole('button', { name: '更多' }).click()
  const textDiffCheckbox = page.getByRole('menuitemcheckbox', {
    name: '文字差异',
  })
  await expectCompactInteractiveRow(textDiffCheckbox, {
    borderRadius: '8px',
    fontSize: '14px',
    height: 32,
    lineHeight: '20px',
    paddingInline: '8px',
  })
  await textDiffCheckbox.click()
  await expect(rightPanel.locator('.review-diff-word')).toHaveCount(0)
  await smallDiffSection.locator('.preview-header').click()

  const reviewFileTree = rightPanel.getByRole('region', {
    name: '审查文件导航',
  })
  await expect(reviewFileTree).toBeVisible()
  const searchRegion = reviewFileTree.locator('.review-file-search-region')
  const searchInput = searchRegion.locator('.review-file-search')
  await expect(searchRegion).toBeVisible()
  await expect(searchInput).toHaveCSS('border-radius', '8px')
  await expect(searchInput).toHaveCSS('border-top-width', '1px')
  const [searchRegionBox, searchInputBox] = await Promise.all([
    searchRegion.boundingBox(),
    searchInput.boundingBox(),
  ])
  expect(searchRegionBox).not.toBeNull()
  expect(searchInputBox).not.toBeNull()
  expect(searchInputBox!.x - searchRegionBox!.x).toBeGreaterThanOrEqual(10)
  await expect(reviewFileTree.locator('[data-git-status="added"]')).toBeVisible()
  await expect(reviewFileTree.locator('[data-git-status="modified"]').first()).toBeVisible()
  await expect(reviewFileTree.locator('[data-git-status="deleted"]')).toBeVisible()
  await expect(reviewFileTree.locator('.review-file-tree-directory-status').first()).toBeVisible()
  await expect(reviewFileTree.locator('.review-file-counts')).toHaveCount(0)
  const [directoryStatusBox, fileStatusBox] = await Promise.all([
    reviewFileTree.locator('.review-file-tree-directory-status').first().boundingBox(),
    reviewFileTree.locator('[data-git-status="added"]').boundingBox(),
  ])
  expect(directoryStatusBox).not.toBeNull()
  expect(fileStatusBox).not.toBeNull()
  expect(directoryStatusBox!.x + directoryStatusBox!.width / 2).toBeCloseTo(
    fileStatusBox!.x + fileStatusBox!.width / 2,
    0,
  )
  const gitStatusColors = await reviewFileTree
    .locator('[data-git-status="added"], [data-git-status="modified"], [data-git-status="deleted"]')
    .evaluateAll((nodes) => Array.from(new Set(nodes.map((node) => getComputedStyle(node).color))))
  expect(gitStatusColors).toHaveLength(3)
  await reviewFileTree.getByRole('treeitem', { name: /WorkspaceReviewDiff\.tsx/ }).click()
  const largeDiffSection = rightPanel.getByLabel(
    'apps/desktop/renderer/src/features/review/diff/WorkspaceReviewDiff.tsx diff',
  )
  await rightPanel.locator('.review-diff-scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await largeDiffSection.evaluate((element) => element.scrollIntoView({ block: 'nearest' }))
  await expect(largeDiffSection).toBeVisible({ timeout: 10_000 })
  await expect
    .poll(async () =>
      rightPanel.locator('.review-codex-diff--virtual .review-codex-diff__virtual-row').count(),
    )
    .toBeGreaterThan(10)
  expect(
    await rightPanel.locator('.review-codex-diff--virtual .review-codex-diff__virtual-row').count(),
  ).toBeLessThan(100)
  const reviewDiffPreview = rightPanel.locator('.review-diff-preview')
  await expect(rightPanel.locator('[data-resize-skeleton-target]')).toHaveCount(0)
  await expect(page.locator('.workbench-resize-guide')).toHaveCount(0)
  const initialWidth = (await rightPanel.boundingBox())?.width
  expect(initialWidth).toBeGreaterThan(320)
  const rightSeparator = page.getByRole('separator', {
    name: '调整右侧面板宽度',
  })
  await expect(rightSeparator).toHaveAttribute('aria-valuemin', '320')
  expect(Number(await rightSeparator.getAttribute('aria-valuemax'))).toBeGreaterThan(320)
  await rightSeparator.focus()
  await page.keyboard.press('Shift+ArrowLeft')
  await expect
    .poll(async () => (await rightPanel.boundingBox())?.width)
    .toBeGreaterThan(initialWidth!)
  const keyboardWidth = (await rightPanel.boundingBox())?.width
  await rightSeparator.press('Home')
  await expect
    .poll(async () => (await rightPanel.boundingBox())?.width)
    .not.toBeCloseTo(keyboardWidth!, 0)
  const resetWidth = (await rightPanel.boundingBox())?.width
  expect(resetWidth).toBeGreaterThan(320)
  const [resetShellBox, resetSpacerBox, resetMainBox, upperRegionBox] = await Promise.all([
    rightPanelShell.boundingBox(),
    rightPanelSpacer.boundingBox(),
    mainRoute.boundingBox(),
    upperRegion.boundingBox(),
  ])
  expect(resetShellBox).not.toBeNull()
  expect(resetSpacerBox).not.toBeNull()
  expect(resetMainBox).not.toBeNull()
  expect(upperRegionBox).not.toBeNull()
  expect(resetSpacerBox!.width).toBeCloseTo(resetShellBox!.width, 0)
  await expect
    .poll(async () => Number(await rightSeparator.getAttribute('aria-valuenow')))
    .toBeCloseTo(resetWidth!, 0)

  const separatorBox = await rightSeparator.boundingBox()
  expect(separatorBox).not.toBeNull()
  await page.mouse.move(
    separatorBox!.x + separatorBox!.width / 2,
    separatorBox!.y + separatorBox!.height / 2,
  )
  await page.evaluate(() => {
    const resizeWindow = window as Window & {
      __resizeLongTaskDurations?: number[]
      __resizeLongTaskObserver?: PerformanceObserver
    }
    resizeWindow.__resizeLongTaskObserver?.disconnect()
    resizeWindow.__resizeLongTaskDurations = []
    resizeWindow.__resizeLongTaskObserver = new PerformanceObserver((list) => {
      resizeWindow.__resizeLongTaskDurations?.push(
        ...list.getEntries().map((entry) => entry.duration),
      )
    })
    resizeWindow.__resizeLongTaskObserver.observe({ type: 'longtask' })
  })
  await page.mouse.down()
  for (let step = 1; step <= 60; step += 1) {
    await page.mouse.move(separatorBox!.x - (96 * step) / 60, separatorBox!.y + 40)
  }
  await expect
    .poll(async () => (await rightPanelShell.boundingBox())?.width)
    .toBeGreaterThan(resetWidth! + 48)
  await expect
    .poll(async () => (await rightPanel.boundingBox())?.width)
    .toBeGreaterThan(resetWidth! + 48)
  const [
    liveRightPanelBox,
    liveRightPanelShellBox,
    liveRightPanelSurfaceBox,
    liveRightPanelSpacerBox,
    liveMainRouteBox,
  ] = await Promise.all([
    rightPanel.boundingBox(),
    rightPanelShell.boundingBox(),
    rightPanelSurface.boundingBox(),
    rightPanelSpacer.boundingBox(),
    mainRoute.boundingBox(),
  ])
  expect(liveRightPanelBox).not.toBeNull()
  expect(liveRightPanelShellBox).not.toBeNull()
  expect(liveRightPanelSurfaceBox).not.toBeNull()
  expect(liveRightPanelSpacerBox).not.toBeNull()
  expect(liveMainRouteBox).not.toBeNull()
  expect(liveRightPanelBox!.x).toBeCloseTo(liveRightPanelShellBox!.x, 0)
  expect(liveRightPanelSurfaceBox!.width).toBeCloseTo(liveRightPanelShellBox!.width, 0)
  expect(liveRightPanelSpacerBox!.width).toBeCloseTo(liveRightPanelShellBox!.width, 0)
  expect(liveRightPanelSpacerBox!.x).toBeCloseTo(liveRightPanelShellBox!.x, 0)
  expect(liveMainRouteBox!.x + liveMainRouteBox!.width).toBeCloseTo(liveRightPanelSpacerBox!.x, 0)
  expect(liveRightPanelShellBox!.x + liveRightPanelShellBox!.width).toBeCloseTo(
    upperRegionBox!.x + upperRegionBox!.width,
    0,
  )
  expect(liveMainRouteBox!.width).toBeLessThan(resetMainBox!.width - 48)
  expect(resetMainBox!.width - liveMainRouteBox!.width).toBeCloseTo(
    liveRightPanelShellBox!.width - resetShellBox!.width,
    0,
  )
  await expect(reviewDiffPreview).toBeVisible()
  await expect(reviewFileTree).toBeVisible()
  await expect(rightPanel.locator('.workbench-panel-content')).toHaveCSS('filter', 'none')
  await expect(rightPanel.locator('.workbench-panel-header')).toHaveCSS('filter', 'none')
  await page.mouse.up()
  await expect
    .poll(async () => (await rightPanel.boundingBox())?.width)
    .toBeGreaterThan(resetWidth!)
  await expect(reviewDiffPreview).toBeVisible()
  await expect(rightPanel.locator('.workbench-panel-content')).toHaveCSS('filter', 'none')
  const resizeLongTaskDurations = await page.evaluate(() => {
    const resizeWindow = window as Window & {
      __resizeLongTaskDurations?: number[]
      __resizeLongTaskObserver?: PerformanceObserver
    }
    resizeWindow.__resizeLongTaskObserver?.disconnect()
    return resizeWindow.__resizeLongTaskDurations ?? []
  })
  expect(Math.max(0, ...resizeLongTaskDurations)).toBeLessThan(50)
  await rightSeparator.dblclick()
  await expect.poll(async () => (await rightPanel.boundingBox())?.width).toBeCloseTo(resetWidth!, 0)

  const beginCancelledResize = async (): Promise<void> => {
    const box = await rightSeparator.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x - 64, box!.y + 30, { steps: 4 })
    await expect
      .poll(async () => (await rightPanelShell.boundingBox())?.width)
      .toBeGreaterThan(resetWidth! + 32)
    await expect
      .poll(async () => (await rightPanel.boundingBox())?.width)
      .toBeGreaterThan(resetWidth! + 32)
    const [
      cancelPreviewPanelBox,
      cancelPreviewShellBox,
      cancelPreviewSurfaceBox,
      cancelPreviewSpacerBox,
    ] = await Promise.all([
      rightPanel.boundingBox(),
      rightPanelShell.boundingBox(),
      rightPanelSurface.boundingBox(),
      rightPanelSpacer.boundingBox(),
    ])
    expect(cancelPreviewPanelBox).not.toBeNull()
    expect(cancelPreviewShellBox).not.toBeNull()
    expect(cancelPreviewSurfaceBox).not.toBeNull()
    expect(cancelPreviewSpacerBox).not.toBeNull()
    expect(cancelPreviewPanelBox!.x).toBeCloseTo(cancelPreviewShellBox!.x, 0)
    expect(cancelPreviewPanelBox!.width).toBeCloseTo(cancelPreviewShellBox!.width, 0)
    expect(cancelPreviewSurfaceBox!.width).toBeCloseTo(cancelPreviewShellBox!.width, 0)
    expect(cancelPreviewSpacerBox!.width).toBeCloseTo(cancelPreviewShellBox!.width, 0)
    await expect(reviewDiffPreview).toBeVisible()
  }
  await beginCancelledResize()
  await rightSeparator.dispatchEvent('pointercancel', { pointerId: 1 })
  await page.mouse.up()
  await expect.poll(async () => (await rightPanel.boundingBox())?.width).toBeCloseTo(resetWidth!, 0)
  await expect
    .poll(async () => (await rightPanelSpacer.boundingBox())?.width)
    .toBeCloseTo(resetWidth!, 0)
  await expect
    .poll(async () => (await mainRoute.boundingBox())?.width)
    .toBeCloseTo(resetMainBox!.width, 0)
  await expect(reviewDiffPreview).toBeVisible()
  await expect(rightPanel.locator('.workbench-panel-content')).toHaveCSS('filter', 'none')

  await beginCancelledResize()
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.mouse.up()
  await expect.poll(async () => (await rightPanel.boundingBox())?.width).toBeCloseTo(resetWidth!, 0)
  await expect
    .poll(async () => (await rightPanelSpacer.boundingBox())?.width)
    .toBeCloseTo(resetWidth!, 0)
  await expect
    .poll(async () => (await mainRoute.boundingBox())?.width)
    .toBeCloseTo(resetMainBox!.width, 0)
  await expect(reviewDiffPreview).toBeVisible()
  await expect(rightPanel.locator('.workbench-panel-content')).toHaveCSS('filter', 'none')

  const fileTreeSeparator = rightPanel.getByRole('separator', {
    name: '调整审查文件导航宽度',
  })
  const initialFileTreeWidth = (await reviewFileTree.boundingBox())?.width
  const initialDiffPreviewWidth = (await reviewDiffPreview.boundingBox())?.width
  const fileTreeSeparatorBox = await fileTreeSeparator.boundingBox()
  expect(initialFileTreeWidth).toBeGreaterThan(239)
  expect(initialDiffPreviewWidth).toBeGreaterThan(0)
  expect(fileTreeSeparatorBox).not.toBeNull()
  await page.mouse.move(
    fileTreeSeparatorBox!.x + fileTreeSeparatorBox!.width / 2,
    fileTreeSeparatorBox!.y + fileTreeSeparatorBox!.height / 2,
  )
  await page.mouse.down()
  for (let step = 1; step <= 60; step += 1) {
    await page.mouse.move(fileTreeSeparatorBox!.x - (72 * step) / 60, fileTreeSeparatorBox!.y + 36)
  }
  await expect
    .poll(async () => (await reviewFileTree.boundingBox())?.width)
    .toBeGreaterThan(initialFileTreeWidth! + 48)
  await expect
    .poll(async () => (await reviewDiffPreview.boundingBox())?.width)
    .toBeLessThan(initialDiffPreviewWidth! - 48)
  await expect(reviewFileTree).toBeVisible()
  await expect(reviewDiffPreview).toBeVisible()
  await page.mouse.up()
  await expect
    .poll(async () => (await reviewFileTree.boundingBox())?.width)
    .toBeGreaterThan(initialFileTreeWidth!)

  await fileTreeSeparator.focus()
  await fileTreeSeparator.press('Home')
  const minimumFileTreeWidth = Number(await fileTreeSeparator.getAttribute('aria-valuemin'))
  await expect
    .poll(async () => (await reviewFileTree.boundingBox())?.width)
    .toBeCloseTo(minimumFileTreeWidth, 0)
  const cancelledFileTreeWidth = (await reviewFileTree.boundingBox())?.width
  const cancelledFileTreeSeparatorBox = await fileTreeSeparator.boundingBox()
  expect(cancelledFileTreeSeparatorBox).not.toBeNull()
  await page.mouse.move(
    cancelledFileTreeSeparatorBox!.x + cancelledFileTreeSeparatorBox!.width / 2,
    cancelledFileTreeSeparatorBox!.y + cancelledFileTreeSeparatorBox!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    cancelledFileTreeSeparatorBox!.x - 48,
    cancelledFileTreeSeparatorBox!.y + 24,
    { steps: 4 },
  )
  await expect
    .poll(async () => (await reviewFileTree.boundingBox())?.width)
    .toBeGreaterThan(cancelledFileTreeWidth! + 24)
  await expect(reviewDiffPreview).toBeVisible()
  await fileTreeSeparator.dispatchEvent('pointercancel', { pointerId: 1 })
  await page.mouse.up()
  await expect
    .poll(async () => (await reviewFileTree.boundingBox())?.width)
    .toBeCloseTo(cancelledFileTreeWidth!, 0)

  const shrinkSeparatorBox = await rightSeparator.boundingBox()
  expect(shrinkSeparatorBox).not.toBeNull()
  await page.mouse.move(
    shrinkSeparatorBox!.x + shrinkSeparatorBox!.width / 2,
    shrinkSeparatorBox!.y + shrinkSeparatorBox!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(shrinkSeparatorBox!.x + 64, shrinkSeparatorBox!.y + 30)
  await expect
    .poll(async () => (await rightPanelShell.boundingBox())?.width)
    .toBeLessThan(resetWidth! - 32)
  const [shrunkShellBox, shrunkPanelBox, shrunkSurfaceBox, shrunkSpacerBox] = await Promise.all([
    rightPanelShell.boundingBox(),
    rightPanel.boundingBox(),
    rightPanelSurface.boundingBox(),
    rightPanelSpacer.boundingBox(),
  ])
  expect(shrunkShellBox).not.toBeNull()
  expect(shrunkPanelBox).not.toBeNull()
  expect(shrunkSurfaceBox).not.toBeNull()
  expect(shrunkSpacerBox).not.toBeNull()
  expect(shrunkPanelBox!.width).toBeCloseTo(shrunkShellBox!.width, 0)
  expect(shrunkSurfaceBox!.width).toBeCloseTo(shrunkShellBox!.width, 0)
  expect(shrunkSpacerBox!.width).toBeCloseTo(shrunkShellBox!.width, 0)
  expect(shrunkPanelBox!.width).toBeLessThan(resetWidth! - 32)
  await rightSeparator.dispatchEvent('pointercancel', { pointerId: 1 })
  await page.mouse.up()

  await page.setViewportSize({ width: 960, height: 640 })
  await expect(rightPanel).toBeVisible()
  await expect.poll(async () => (await rightPanel.boundingBox())?.width).toBeLessThan(resetWidth!)
  await expect(reviewFileTree).toBeHidden()

  await page.setViewportSize({ width: 1440, height: 920 })
  await expect.poll(async () => (await rightPanel.boundingBox())?.width).toBeCloseTo(resetWidth!, 0)
  await expect(reviewFileTree).toBeVisible()

  const sidebarSeparator = page.getByRole('separator', {
    name: '调整任务侧栏宽度',
  })
  await sidebarSeparator.focus()
  await page.keyboard.press('End')
  await page.setViewportSize({ width: 960, height: 640 })
  await expect(rightPanel).toHaveCount(0)

  await page.getByRole('button', { name: '显示右侧面板' }).click()
  const forcedRightPanel = page.getByRole('complementary', {
    name: '右侧面板',
  })
  await expect(forcedRightPanel).toBeVisible()
  await expect
    .poll(async () => (await page.locator('.desktop-main-route').boundingBox())?.width)
    .toBeLessThan(352)

  await page.setViewportSize({ width: 1000, height: 680 })
  await expect(forcedRightPanel).toBeVisible()
  await page.getByRole('button', { name: '关闭右侧面板' }).click()
  await page.setViewportSize({ width: 1440, height: 920 })
  await expect(forcedRightPanel).toHaveCount(0)
})

test('Review resizes live when moved to the bottom panel', async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 920 })
  await gotoWorkbenchFixture(page, '/?visualCase=review#/threads/visual-review')
  await closeTransientErrorToast(page)
  await expect(page.getByText('已完成工作台结构梳理。', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '显示右侧面板' }).click()
  const rightPanel = page.getByRole('complementary', { name: '右侧面板' })
  await rightPanel.getByRole('button', { name: '审阅 Ctrl+Shift+G' }).click()
  await expect(rightPanel.locator('.review-diff-preview')).toBeVisible()
  await rightPanel.locator('[data-panel-tab="review"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '移到底部面板' }).click()

  const bottomPanel = page.getByRole('complementary', { name: '底部面板' })
  const bottomReviewDiff = bottomPanel.locator('.review-diff-preview')
  const bottomReviewFileTree = bottomPanel.getByRole('region', {
    name: '审查文件导航',
  })
  await expect(bottomReviewDiff).toBeVisible()
  await expect(bottomReviewFileTree).toBeVisible()

  const bottomHeight = (await bottomPanel.boundingBox())?.height
  const bottomSeparator = page.getByRole('separator', {
    name: '调整底部面板高度',
  })
  const bottomSeparatorBox = await bottomSeparator.boundingBox()
  expect(bottomHeight).toBeGreaterThan(160)
  expect(bottomSeparatorBox).not.toBeNull()
  await page.mouse.move(
    bottomSeparatorBox!.x + bottomSeparatorBox!.width / 2,
    bottomSeparatorBox!.y + bottomSeparatorBox!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(bottomSeparatorBox!.x + 48, bottomSeparatorBox!.y - 72, { steps: 8 })
  await expect
    .poll(async () => (await bottomPanel.boundingBox())?.height)
    .toBeGreaterThan(bottomHeight! + 48)
  await expect(bottomReviewDiff).toBeVisible()
  await expect(bottomReviewFileTree).toBeVisible()
  await page.mouse.up()
  await expect
    .poll(async () => (await bottomPanel.boundingBox())?.height)
    .toBeGreaterThan(bottomHeight!)
  await expect(bottomReviewDiff).toBeVisible()
})

test('bottom panel scales with workspace height while preserving the upper region', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.goto('/?visualCase=rich#/threads/visual-rich')
  await closeTransientErrorToast(page)
  await expect(page.getByText('已完成工作台结构梳理。', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '打开集成终端 (Ctrl+`)' }).click()
  const bottomPanel = page.getByRole('complementary', { name: '底部面板' })
  const initialHeight = (await bottomPanel.boundingBox())?.height
  expect(initialHeight).toBeGreaterThanOrEqual(160)
  const bottomSeparator = page.getByRole('separator', {
    name: '调整底部面板高度',
  })
  await expect(bottomSeparator).toHaveAttribute('aria-valuemin', '160')
  expect(Number(await bottomSeparator.getAttribute('aria-valuemax'))).toBeGreaterThanOrEqual(
    initialHeight!,
  )
  await bottomSeparator.focus()
  await page.keyboard.press('Shift+ArrowUp')
  await expect
    .poll(async () => (await bottomPanel.boundingBox())?.height)
    .toBeGreaterThan(initialHeight!)
  await bottomSeparator.dblclick()

  await page.setViewportSize({ width: 960, height: 640 })
  await expect
    .poll(async () => (await bottomPanel.boundingBox())?.height)
    .toBeLessThan(initialHeight!)
  await expect
    .poll(async () => (await page.locator('.desktop-workspace__upper').boundingBox())?.height)
    .toBeGreaterThanOrEqual(240)

  await page.setViewportSize({ width: 1440, height: 920 })
  await expect
    .poll(async () => (await bottomPanel.boundingBox())?.height)
    .toBeCloseTo(initialHeight!, 0)
})

test('narrow file panel keeps the editor and file tree side by side', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 640 })
  await page.addInitScript(() => {
    const target = window as typeof window & {
      __fileTreeViewWrites?: number
    }
    target.__fileTreeViewWrites = 0
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function setItem(key, value) {
      if (key.startsWith('pidex.desktop.fileTreeView:')) {
        target.__fileTreeViewWrites = (target.__fileTreeViewWrites ?? 0) + 1
      }
      return original.call(this, key, value)
    }
  })
  await page.goto('/?visualCase=rich#/threads/visual-rich')
  await closeTransientErrorToast(page)
  await expect(page.getByText('已完成工作台结构梳理。', { exact: true })).toBeVisible()

  const sidebarSeparator = page.getByRole('separator', {
    name: '调整任务侧栏宽度',
  })
  await sidebarSeparator.focus()
  await page.keyboard.press('End')
  await page.getByRole('button', { name: '显示右侧面板' }).click()
  const rightPanel = page.getByRole('complementary', { name: '右侧面板' })
  await rightPanel.getByRole('button', { name: '文件 Ctrl+P' }).click()

  const editor = rightPanel.locator('.right-dock-open-file-empty')
  const tree = rightPanel.getByRole('complementary', {
    name: '工作区文件树',
  })
  await expect(editor).toBeVisible()
  await expect(tree).toBeVisible()
  const [editorBox, treeBox] = await Promise.all([editor.boundingBox(), tree.boundingBox()])
  expect(editorBox!.width).toBeGreaterThan(0)
  expect(treeBox!.width).toBeGreaterThan(0)
  expect(editorBox!.y).toBeCloseTo(treeBox!.y, 0)
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)

  await page.setViewportSize({ width: 1440, height: 920 })
  const rightPanelSeparator = page.getByRole('separator', {
    name: '调整右侧面板宽度',
  })
  await rightPanelSeparator.focus()
  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Shift+ArrowLeft')
  await expect.poll(async () => (await rightPanel.boundingBox())?.width ?? 0).toBeGreaterThan(520)
  await expect.poll(async () => (await tree.boundingBox())?.width ?? 0).toBeGreaterThan(239)
  const treeSeparator = rightPanel.getByRole('separator', {
    name: '调整文件树宽度',
  })
  const treeSeparatorBox = await treeSeparator.boundingBox()
  const treeWidthBeforeDrag = (await tree.boundingBox())!.width
  expect(treeSeparatorBox).not.toBeNull()
  await page.evaluate(() => {
    ;(
      window as typeof window & {
        __fileTreeViewWrites?: number
      }
    ).__fileTreeViewWrites = 0
  })
  await page.mouse.move(
    treeSeparatorBox!.x + treeSeparatorBox!.width / 2,
    treeSeparatorBox!.y + treeSeparatorBox!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(treeSeparatorBox!.x - 64, treeSeparatorBox!.y + 24, { steps: 8 })
  await expect
    .poll(async () => (await tree.boundingBox())?.width ?? 0)
    .toBeGreaterThan(treeWidthBeforeDrag + 32)
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __fileTreeViewWrites?: number
          }
        ).__fileTreeViewWrites ?? 0,
    ),
  ).toBe(0)
  await page.mouse.up()
  await expect
    .poll(async () => (await tree.boundingBox())?.width ?? 0)
    .toBeGreaterThan(treeWidthBeforeDrag + 32)
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __fileTreeViewWrites?: number
          }
        ).__fileTreeViewWrites ?? 0,
    ),
  ).toBe(1)
})

test('wide workspace keeps the summary beside a 600px review panel', async ({ page }) => {
  const viewport = { width: 1919, height: 1033 }
  await page.setViewportSize(viewport)
  await page.emulateMedia({
    colorScheme: 'dark',
    forcedColors: 'none',
    reducedMotion: 'reduce',
  })
  await page.addInitScript(
    ({ ratio }) => {
      localStorage.setItem('pidex.desktop.rightDockWidthRatio.v2', String(ratio))
    },
    {
      ratio: 600 / (viewport.width - 275 - 1),
    },
  )
  await gotoWorkbenchFixture(page, '/?visualCase=review#/threads/visual-review')
  await closeTransientErrorToast(page)

  await page.getByRole('button', { name: '显示右侧面板' }).click()
  const rightPanel = page.getByRole('complementary', { name: '右侧面板' })
  await rightPanel.getByRole('button', { name: /^审阅/ }).click()

  const summary = page.locator('.thread-summary-inline')
  const turn = page.locator('.canonical-turn').first()
  const composer = page.locator('.workflow-page__composer-inner')
  const workflowMain = page.locator('.workflow-page__main')
  await expect(summary).toBeVisible()
  await expect(page.getByRole('button', { name: '取消置顶摘要' })).toBeVisible()
  const visibleSummaryRows = summary.locator('.interactive-row--adaptive:visible')
  await expect(visibleSummaryRows.first()).toBeVisible()
  const summaryRowGeometry = await visibleSummaryRows.evaluateAll((rows) =>
    rows.map((row) => ({
      height: row.getBoundingClientRect().height,
      paddingInline: getComputedStyle(row).paddingInline,
      radius: getComputedStyle(row).borderRadius,
      verticallyClipped: row instanceof HTMLElement && row.scrollHeight > row.clientHeight + 1,
    })),
  )
  expect(summaryRowGeometry.every((row) => row.height >= 30)).toBe(true)
  expect(summaryRowGeometry.every((row) => row.radius === '8px')).toBe(true)
  expect(summaryRowGeometry.every((row) => row.paddingInline === '8px')).toBe(true)
  expect(summaryRowGeometry.some((row) => row.verticallyClipped)).toBe(false)
  await expectHoverBackground(summary.locator('button.interactive-row--adaptive').first())

  const [summaryBox, turnBox, composerBox, rightPanelBox, workflowMainBox] = await Promise.all([
    summary.boundingBox(),
    turn.boundingBox(),
    composer.boundingBox(),
    rightPanel.boundingBox(),
    workflowMain.boundingBox(),
  ])
  expect(summaryBox).not.toBeNull()
  expect(turnBox).not.toBeNull()
  expect(composerBox).not.toBeNull()
  expect(rightPanelBox).not.toBeNull()
  expect(workflowMainBox).not.toBeNull()
  if (!summaryBox || !turnBox || !composerBox || !rightPanelBox || !workflowMainBox) return

  expect(summaryBox.width).toBeCloseTo(272, 0)
  expect(turnBox.width).toBeGreaterThan(640)
  expect(turnBox.width).toBeCloseTo(composerBox.width, 0)
  expect(turnBox.x).toBeCloseTo(composerBox.x, 0)
  expect(turnBox.x - workflowMainBox.x).toBeCloseTo(48, 0)
  const reservedInlineEnd = await workflowMain.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).paddingRight),
  )
  expect(reservedInlineEnd).toBeCloseTo(summaryBox.width + 32, 0)
  expect(rightPanelBox.width).toBeCloseTo(600, 0)
  expect(summaryBox.x - (turnBox.x + turnBox.width)).toBeGreaterThanOrEqual(16)
  expect(rightPanelBox.x - (summaryBox.x + summaryBox.width)).toBeGreaterThanOrEqual(16)

  await page.getByRole('button', { name: '取消置顶摘要' }).click()
  await expect(summary).toHaveCount(0)
  const [unpinnedTurnBox, unpinnedComposerBox] = await Promise.all([
    turn.boundingBox(),
    composer.boundingBox(),
  ])
  expect(unpinnedTurnBox?.x).toBeCloseTo(turnBox.x, 0)
  expect(unpinnedComposerBox?.x).toBeCloseTo(composerBox.x, 0)

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
})

for (const mode of MODES) {
  test(`summary and command output use Codex surfaces in ${mode} mode`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 920 })
    await page.emulateMedia({
      colorScheme: mode,
      forcedColors: 'none',
      reducedMotion: 'reduce',
    })
    await page.goto('/?visualCase=rich#/threads/visual-rich')
    await closeTransientErrorToast(page)
    await expect(page.getByText('已完成工作台结构梳理。', { exact: true })).toBeVisible()

    const summary = page.locator('.thread-summary-panel')
    const summaryHeader = summary.locator('.thread-summary-section > header').first()
    await expect(summary).toBeVisible()
    await expect(summaryHeader).toBeVisible()

    const turnActivity = page.locator('.canonical-turn-activity').first()
    const turnActivitySummary = turnActivity.locator(':scope > .canonical-turn-activity__summary')
    const turnActivityChevron = turnActivitySummary.locator('.canonical-turn-activity__chevron')
    const turnActivityDivider = turnActivity.locator(':scope > .canonical-turn-activity__divider')
    const result = page.locator('.canonical-turn__result').first()
    await expect(turnActivity).toHaveAttribute('data-expandable', 'true')
    await expect(turnActivity).toHaveAttribute('data-expanded', 'false')
    await expect(turnActivitySummary).toHaveAttribute('aria-expanded', 'false')
    await expect(turnActivityChevron).toBeVisible()
    await expect(turnActivityChevron).toHaveCSS('opacity', '1')
    await expect(turnActivityDivider).toBeVisible()
    await expect(turnActivity.locator('.canonical-turn-activity__content')).toHaveCount(0)
    await expect(turnActivity.locator('.canonical-turn__process')).toHaveCount(0)
    await expect(result).toBeVisible()

    const collapsedChevronTransform = await turnActivityChevron.evaluate(
      (element) => getComputedStyle(element).transform,
    )
    const initialOrder = await page.evaluate(() => {
      const activity = document.querySelector<HTMLElement>('.canonical-turn-activity')
      const activitySummary = activity?.querySelector<HTMLElement>(
        ':scope > .canonical-turn-activity__summary',
      )
      const divider = activity?.querySelector<HTMLElement>(
        ':scope > .canonical-turn-activity__divider',
      )
      const result = document.querySelector<HTMLElement>('.canonical-turn__result')
      if (!activity || !activitySummary || !divider || !result) return null
      return {
        activityBeforeResult: Boolean(
          activity.compareDocumentPosition(result) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        summaryBeforeDivider: Boolean(
          activitySummary.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      }
    })
    expect(initialOrder).toEqual({
      activityBeforeResult: true,
      summaryBeforeDivider: true,
    })

    await turnActivitySummary.click()
    await expect(turnActivity).toHaveAttribute('data-expanded', 'true')
    await expect(turnActivitySummary).toHaveAttribute('aria-expanded', 'true')
    const turnActivityContent = turnActivity.locator(':scope > .canonical-turn-activity__content')
    await expect(turnActivityContent).toBeVisible()
    await expect(turnActivityContent).toHaveCSS('opacity', '1')
    const reducedMotionTransform = await turnActivityContent.evaluate(
      (element) => getComputedStyle(element).transform,
    )
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(reducedMotionTransform)
    const expandedChevronTransform = await turnActivityChevron.evaluate(
      (element) => getComputedStyle(element).transform,
    )
    expect(expandedChevronTransform).not.toBe(collapsedChevronTransform)

    const process = page.locator('.canonical-turn__process').first()
    const activityGroup = process.locator('.cpx-agent-activity[data-expandable="true"]').first()
    const activitySummary = activityGroup.locator(':scope > .cpx-agent-activity__header')
    const activityChevron = activitySummary.locator('.cpx-agent-activity__chevron')
    await expect(activityGroup).toBeVisible()
    await expect(activityGroup.locator('.cpx-agent-activity__content')).toHaveCount(0)
    await expect(activityChevron).toHaveCSS('opacity', '0')
    await activitySummary.hover()
    await expect(activityChevron).toHaveCSS('opacity', '1')
    await activitySummary.focus()
    await expect(activityChevron).toHaveCSS('opacity', '1')
    await activitySummary.click()
    await expect(activityGroup).toHaveAttribute('data-expanded', 'true')
    await expect(activityGroup.locator('.cpx-agent-activity__content')).toBeVisible()
    await expect(activityChevron).toHaveCSS('opacity', '1')

    const command = activityGroup.locator('.cpx-agent-activity__item').first()
    const itemHeader = command.locator(':scope > .cpx-agent-activity__item-header')
    const itemChevron = itemHeader.locator('.cpx-agent-activity__chevron')
    const fileLink = itemHeader.locator('.cpx-agent-activity__file-link')
    await expect(command).toHaveAttribute('data-presentation', 'grouped')
    await expect(fileLink).toBeVisible()
    await expect(fileLink).toHaveCSS('text-decoration-style', 'dotted')
    await fileLink.focus()
    await expect(fileLink).toBeFocused()
    await expect(itemChevron).toHaveCSS('opacity', '1')
    await itemChevron.click()
    await expect(itemChevron).toHaveCSS('opacity', '1')
    const commandShell = command.locator('.canonical-command-shell--embedded')
    await expect(commandShell).toBeVisible()

    const surfaces = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('.thread-summary-panel')
      const header = panel?.querySelector<HTMLElement>('.thread-summary-section > header')
      const process = document.querySelector<HTMLElement>('.canonical-turn__process')
      const turnActivity = document.querySelector<HTMLElement>('.canonical-turn-activity')
      const turnActivitySummary = turnActivity?.querySelector<HTMLElement>(
        ':scope > .canonical-turn-activity__summary',
      )
      const turnActivityDivider = turnActivity?.querySelector<HTMLElement>(
        ':scope > .canonical-turn-activity__divider',
      )
      const turnActivityContent = turnActivity?.querySelector<HTMLElement>(
        ':scope > .canonical-turn-activity__content',
      )
      const result = document.querySelector<HTMLElement>('.canonical-turn__result')
      const group = process?.querySelector<HTMLElement>(
        '.cpx-agent-activity[data-expandable="true"]',
      )
      const summary = group?.querySelector<HTMLElement>(':scope > .cpx-agent-activity__header')
      const items = group?.querySelector<HTMLElement>('.cpx-agent-activity__list')
      const shell = group?.querySelector<HTMLElement>('.canonical-command-shell--embedded')
      const output = shell?.querySelector<HTMLElement>('.canonical-command-shell__result pre')
      if (
        !panel ||
        !header ||
        !process ||
        !turnActivity ||
        !turnActivitySummary ||
        !turnActivityDivider ||
        !turnActivityContent ||
        !result ||
        !group ||
        !summary ||
        !items ||
        !shell ||
        !output
      ) {
        return null
      }

      const resolveBackground = (parent: HTMLElement, token: string): string => {
        const probe = document.createElement('span')
        probe.style.backgroundColor = `var(${token})`
        parent.append(probe)
        const background = getComputedStyle(probe).backgroundColor
        probe.remove()
        return background
      }

      return {
        group: {
          background: getComputedStyle(group).backgroundColor,
          borderRadius: getComputedStyle(group).borderRadius,
          borderWidth: getComputedStyle(group).borderTopWidth,
          padding: getComputedStyle(group).padding,
        },
        header: getComputedStyle(header).backgroundColor,
        items: {
          background: getComputedStyle(items).backgroundColor,
          borderRadius: getComputedStyle(items).borderRadius,
          borderWidth: getComputedStyle(items).borderTopWidth,
          gap: getComputedStyle(items).gap,
          maskImage: getComputedStyle(items).maskImage,
          maxHeight: getComputedStyle(items).maxHeight,
          padding: getComputedStyle(items).padding,
        },
        panelSurface: resolveBackground(shell, '--layer-panel-fill'),
        panel: getComputedStyle(panel).backgroundColor,
        processGap: getComputedStyle(process).gap,
        raisedSurface: resolveBackground(panel, '--layer-raised-fill'),
        shell: {
          background: getComputedStyle(shell).backgroundColor,
          borderRadius: getComputedStyle(shell).borderRadius,
          borderWidth: getComputedStyle(shell).borderTopWidth,
        },
        shellOutputMaxHeight: getComputedStyle(output).maxHeight,
        summary: {
          background: getComputedStyle(summary).backgroundColor,
          borderRadius: getComputedStyle(summary).borderRadius,
          padding: getComputedStyle(summary).padding,
        },
        turnActivity: {
          activityBeforeResult: Boolean(
            turnActivity.compareDocumentPosition(result) & Node.DOCUMENT_POSITION_FOLLOWING,
          ),
          background: getComputedStyle(turnActivity).backgroundColor,
          borderRadius: getComputedStyle(turnActivity).borderRadius,
          borderWidth: getComputedStyle(turnActivity).borderTopWidth,
          contentPaddingTop: getComputedStyle(turnActivityContent).paddingTop,
          dividerBorderWidth: getComputedStyle(turnActivityDivider).borderTopWidth,
          processGapAfterDivider:
            process.getBoundingClientRect().top -
            turnActivityDivider.getBoundingClientRect().bottom,
          summaryBackground: getComputedStyle(turnActivitySummary).backgroundColor,
          summaryBorderRadius: getComputedStyle(turnActivitySummary).borderRadius,
          summaryPadding: getComputedStyle(turnActivitySummary).padding,
        },
      }
    })

    expect(surfaces).not.toBeNull()
    expect(surfaces?.header).toBe('rgba(0, 0, 0, 0)')
    expect(surfaces?.panel).toBe(surfaces?.raisedSurface)
    expect(surfaces?.processGap).toBe('16px')
    expect(surfaces?.group).toEqual({
      background: 'rgba(0, 0, 0, 0)',
      borderRadius: '0px',
      borderWidth: '0px',
      padding: '0px',
    })
    expect(surfaces?.summary).toEqual({
      background: 'rgba(0, 0, 0, 0)',
      borderRadius: '0px',
      padding: '0px',
    })
    expect(surfaces?.items).toMatchObject({
      background: 'rgba(0, 0, 0, 0)',
      borderRadius: '0px',
      borderWidth: '0px',
      gap: '4px',
      maxHeight: '224px',
      padding: '0px',
    })
    // 处理过程列表限高内部滚动，但滚动条被隐藏，也不做遮罩渐隐。
    expect(surfaces?.items.maskImage).toBe('none')
    expect(surfaces?.shell).toEqual({
      background: 'rgba(0, 0, 0, 0)',
      borderRadius: '0px',
      borderWidth: '0px',
    })
    expect(surfaces?.shellOutputMaxHeight).toBe('144px')
    expect(surfaces?.turnActivity).toMatchObject({
      activityBeforeResult: true,
      background: 'rgba(0, 0, 0, 0)',
      borderRadius: '0px',
      borderWidth: '0px',
      contentPaddingTop: '16px',
      dividerBorderWidth: '1px',
      summaryBackground: 'rgba(0, 0, 0, 0)',
      summaryBorderRadius: '0px',
      summaryPadding: '0px',
    })
    expect(surfaces?.turnActivity.processGapAfterDivider).toBeCloseTo(16, 0)

    await turnActivitySummary.click()
    await expect(turnActivity).toHaveAttribute('data-expanded', 'false')
    await expect(turnActivity.locator('.canonical-turn-activity__content')).toHaveCount(0)
    await expect(turnActivity.locator('.canonical-turn__process')).toHaveCount(0)
    await expect(result).toBeVisible()
  })
}

for (const mode of MODES) {
  test(`accessibility ${mode}`, async ({ page }) => {
    await page.emulateMedia({
      colorScheme: mode,
      forcedColors: 'none',
      reducedMotion: 'reduce',
    })
    await page.goto('/?visualCase=empty#/new')
    await closeTransientErrorToast(page)
    await expect(
      page.getByRole('heading', {
        name: /我们该构建什么？/,
      }),
    ).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', 'on')

    const contrastRatio = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement)
      return ratio(
        styles.getPropertyValue('--color-token-foreground').trim(),
        styles.getPropertyValue('--color-token-main-surface-primary').trim(),
      )

      function ratio(foreground: string, background: string): number {
        const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
          (left, right) => right - left,
        )
        return (lighter! + 0.05) / (darker! + 0.05)
      }

      function luminance(hex: string): number {
        const normalized = hex.replace('#', '')
        const channels = [0, 2, 4].map(
          (offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255,
        )
        const linear = channels.map((channel) =>
          channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
        )
        return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
      }
    })
    expect(contrastRatio).toBeGreaterThanOrEqual(4.5)

    const sidebarSeparator = page.getByRole('separator', {
      name: '调整任务侧栏宽度',
    })
    await sidebarSeparator.focus()
    const before = Number(await sidebarSeparator.getAttribute('aria-valuenow'))
    await page.keyboard.press('ArrowRight')
    const after = Number(await sidebarSeparator.getAttribute('aria-valuenow'))
    expect(after).toBeGreaterThan(before)

    await page.emulateMedia({ forcedColors: 'active' })
    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true)
  })
}

for (const mode of MODES) {
  test(`sidebar rows own Codex geometry, hover, selection, and focus (${mode})`, async ({
    page,
  }) => {
    await prepareVisualTheme(page, mode, { reduceMotion: 'off' })
    await page.setViewportSize({ width: 1440, height: 800 })
    await gotoWorkbenchFixture(page, '/?visualCase=rich#/threads/visual-rich')
    await closeTransientErrorToast(page)

    const projectsToggle = page.locator('[data-sidebar-section-id="projects"]')
    if (await projectsToggle.count()) {
      if ((await projectsToggle.getAttribute('aria-expanded')) === 'false') {
        await projectsToggle.click()
      }
    }

    const projectButton = page.locator('.sidebar-project-button[data-current]').first()
    await expect(projectButton).toBeVisible()
    if ((await projectButton.getAttribute('aria-expanded')) === 'false') {
      await projectButton.click()
    }

    const projectRow = page
      .locator('.sidebar-project-header:has(.sidebar-project-button[data-current])')
      .first()
    const navRow = page.locator('.sidebar-nav-link').first()
    await expect(projectRow).toBeVisible()
    await expect(navRow).toBeVisible()

    await page.evaluate(() => {
      const row = document.createElement('li')
      row.className =
        'sidebar-row sidebar-row--grid sidebar-row--session sidebar-row--no-leading sidebar-session-row active selected'
      row.dataset.visualSidebarSessionFixture = 'true'
      const button = document.createElement('button')
      button.className = 'sidebar-session-button'
      button.type = 'button'
      button.textContent = '视觉契约会话'
      row.append(button)
      document.body.append(row)
    })
    const activeSessionRow = page.locator('[data-visual-sidebar-session-fixture="true"]')
    await expect(activeSessionRow).toBeVisible()

    const sidebarRowRadius = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.borderRadius = 'var(--cpx-sys-radius-lg)'
      document.body.append(probe)
      const radius = getComputedStyle(probe).borderRadius
      probe.remove()
      return radius
    })
    for (const row of [navRow, projectRow, activeSessionRow]) {
      await expect(row).toHaveCSS('min-height', '32px')
      await expect(row).toHaveCSS('border-radius', sidebarRowRadius)
    }
    const sidebar = page.locator('aside.desktop-sidebar')
    const productModeLabel = sidebar.locator('.sidebar-product-mode-label')
    const sectionHeader = page.locator(
      '.sidebar-section:has([data-sidebar-section-id="projects"]) .sidebar-section-header',
    )
    const footerRow = page.locator('.sidebar-footer .sidebar-settings-link')
    const readRowForegrounds = (row: Locator) =>
      row.evaluate((element) => {
        const main = element.querySelector<HTMLElement>('.sidebar-row-main')
        const leading = element.querySelector<HTMLElement>('.sidebar-item-icon')
        return {
          leading: leading ? getComputedStyle(leading).color : null,
          main: main ? getComputedStyle(main).color : null,
          row: getComputedStyle(element).color,
        }
      })
    const primaryForeground = await projectRow.evaluate(
      (element) => getComputedStyle(element).color,
    )
    for (const row of [navRow, projectRow, footerRow]) {
      expect(await readRowForegrounds(row)).toEqual({
        leading: primaryForeground,
        main: primaryForeground,
        row: primaryForeground,
      })
    }
    const [
      sidebarBox,
      navBox,
      navLeadingBox,
      navMainBox,
      sectionHeaderBox,
      projectRowBox,
      projectTrailingBox,
      footerBox,
      footerLeadingBox,
      footerMainBox,
    ] = await Promise.all([
      sidebar.boundingBox(),
      navRow.boundingBox(),
      navRow.locator('.sidebar-row-leading').boundingBox(),
      navRow.locator('.sidebar-row-main').boundingBox(),
      sectionHeader.boundingBox(),
      projectRow.boundingBox(),
      projectRow.locator('.sidebar-row-trailing').boundingBox(),
      footerRow.boundingBox(),
      footerRow.locator('.sidebar-row-leading').boundingBox(),
      footerRow.locator('.sidebar-row-main').boundingBox(),
    ])
    expect(sidebarBox).not.toBeNull()
    expect(navBox).not.toBeNull()
    expect(navLeadingBox).not.toBeNull()
    expect(navMainBox).not.toBeNull()
    expect(sectionHeaderBox).not.toBeNull()
    expect(projectRowBox).not.toBeNull()
    expect(projectTrailingBox).not.toBeNull()
    expect(footerBox).not.toBeNull()
    expect(footerLeadingBox).not.toBeNull()
    expect(footerMainBox).not.toBeNull()
    if (
      !sidebarBox ||
      !navBox ||
      !navLeadingBox ||
      !navMainBox ||
      !sectionHeaderBox ||
      !projectRowBox ||
      !projectTrailingBox ||
      !footerBox ||
      !footerLeadingBox ||
      !footerMainBox
    )
      return
    expect(navBox.x - sidebarBox.x).toBeCloseTo(8, 0)
    expect(navBox.width).toBeCloseTo(sidebarBox.width - 16, 0)
    expect(navLeadingBox.x - sidebarBox.x).toBeCloseTo(16, 0)
    expect(navLeadingBox.width).toBeCloseTo(16, 0)
    expect(navMainBox.x - sidebarBox.x).toBeCloseTo(40, 0)
    expect(sectionHeaderBox.x - sidebarBox.x).toBeCloseTo(8, 0)
    expect(projectTrailingBox.x + projectTrailingBox.width - sidebarBox.x).toBeCloseTo(
      sidebarBox.width - 16,
      0,
    )
    expect(footerBox.x - sidebarBox.x).toBeCloseTo(8, 0)
    expect(footerLeadingBox.x - sidebarBox.x).toBeCloseTo(16, 0)
    expect(footerMainBox.x - sidebarBox.x).toBeCloseTo(40, 0)
    expect(projectRowBox.y - (sectionHeaderBox.y + sectionHeaderBox.height)).toBeLessThanOrEqual(
      0.5,
    )
    await expect(navRow).toHaveCSS('font-size', '14px')
    await expect(productModeLabel).toHaveCSS('white-space', 'nowrap')
    await expect(productModeLabel).toHaveCSS('text-overflow', 'clip')
    expect(
      await productModeLabel.evaluate((element) => {
        const style = getComputedStyle(element)
        return style.maskImage || style.webkitMaskImage
      }),
    ).toBe('none')
    const sectionTitle = sectionHeader.locator('.sidebar-section-title')
    const sectionLabel = sectionTitle.locator('.sidebar-section-label')
    await expect(sectionTitle).toHaveCSS('font-size', '14px')
    await expect(sectionLabel).toHaveCSS('white-space', 'nowrap')
    await expect(sectionLabel).toHaveCSS('text-overflow', 'clip')
    expect(
      await sectionLabel.evaluate((element) => {
        const style = getComputedStyle(element)
        return style.maskImage || style.webkitMaskImage
      }),
    ).toBe('none')
    expect(
      await sidebar.locator('svg').evaluateAll((elements) =>
        [
          ...new Set(
            elements.map((element) => {
              const style = getComputedStyle(element)
              return `${style.width}x${style.height}`
            }),
          ),
        ].sort(),
      ),
    ).toEqual(['14pxx14px'])
    expect(
      await sidebar.locator('.ui-button.icon-button').evaluateAll((elements) =>
        [
          ...new Set(
            elements.map((element) => {
              const bounds = element.getBoundingClientRect()
              return `${bounds.width}x${bounds.height}`
            }),
          ),
        ].sort(),
      ),
    ).toEqual(['24x24'])
    await expect(projectButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    const projectTitle = projectRow.locator('.sidebar-project-title-text')
    await expect(projectTitle).toHaveCSS('white-space', 'nowrap')
    await expect(projectTitle).toHaveCSS('text-overflow', 'clip')
    expect(
      await projectTitle.evaluate((element) => {
        const style = getComputedStyle(element)
        return style.maskImage || style.webkitMaskImage
      }),
    ).toContain('linear-gradient')
    await expect(activeSessionRow.locator('.sidebar-session-button')).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    )

    const sidebarHoverBackground = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.background = 'var(--cpx-sys-color-hover)'
      document.body.append(probe)
      const background = getComputedStyle(probe).backgroundColor
      probe.remove()
      return background
    })
    for (const row of [navRow, footerRow]) {
      const foregroundsBeforeHover = await readRowForegrounds(row)
      await row.hover()
      await expect(row).toHaveCSS('background-color', sidebarHoverBackground)
      expect(await readRowForegrounds(row)).toEqual(foregroundsBeforeHover)
    }
    const projectForegroundsBeforeHover = await readRowForegrounds(projectRow)
    await projectRow.hover()
    await expect(projectRow).toHaveCSS('background-color', sidebarHoverBackground)
    expect(await readRowForegrounds(projectRow)).toEqual(projectForegroundsBeforeHover)
    const projectActions = projectRow.locator('.sidebar-project-action-button')
    for (const action of await projectActions.all()) {
      await action.hover()
      await expect(action).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(action).toHaveCSS('color', primaryForeground)
      await expect(projectRow).toHaveCSS('background-color', sidebarHoverBackground)
    }
    const createAction = projectRow.getByRole('button', { name: '新建对话' })
    await page.mouse.move(1000, 400)
    const defaultForeground = await createAction.evaluate(
      (element) => getComputedStyle(element).color,
    )
    await createAction.evaluate((element: HTMLButtonElement) => {
      element.disabled = true
    })
    await createAction.hover()
    await expect(createAction).toHaveCSS('color', defaultForeground)
    await expect(createAction).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await createAction.evaluate((element: HTMLButtonElement) => {
      element.disabled = false
    })

    await sectionHeader.hover()
    for (const action of await sectionHeader.locator('.icon-button').all()) {
      await action.hover()
      await expect(action).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(action).toHaveCSS('color', primaryForeground)
    }
    await projectsToggle.focus()
    await page.mouse.move(1000, 400)
    await page.keyboard.press('Tab')
    const organizeAction = sectionHeader.getByRole('button', { name: '整理侧栏' })
    await expect(organizeAction).toBeFocused()
    await expect(sectionHeader.locator('.sidebar-section-actions')).toHaveCSS('opacity', '1')
    await expect(organizeAction).toHaveCSS('outline-style', 'solid')
    await expect(organizeAction).toHaveCSS('outline-width', '2px')

    const sidebarSelectedBackground = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.background = 'var(--cpx-sys-color-selected)'
      document.body.append(probe)
      const background = getComputedStyle(probe).backgroundColor
      probe.remove()
      return background
    })
    await expect(activeSessionRow).toHaveCSS('background-color', sidebarSelectedBackground)
    await activeSessionRow.hover()
    await expect(activeSessionRow).toHaveCSS('background-color', sidebarHoverBackground)
    await expect(activeSessionRow).toHaveCSS('color', primaryForeground)
    await expect(activeSessionRow.locator('.sidebar-session-button')).toHaveCSS(
      'color',
      primaryForeground,
    )

    await projectButton.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(projectRow).toHaveCSS('outline-style', 'solid')
    await expect(projectRow).toHaveCSS('outline-width', '2px')
    await expect(projectButton).toHaveCSS('outline-style', 'none')

    const sessionButton = activeSessionRow.locator('.sidebar-session-button')
    await sessionButton.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(activeSessionRow).toHaveCSS('outline-style', 'solid')
    await expect(sessionButton).toHaveCSS('outline-style', 'none')

    const expandedBeforeTailAction = await projectButton.getAttribute('aria-expanded')
    await projectRow.hover()
    await projectRow.getByRole('button', { name: '更多' }).click()
    await expect(projectButton).toHaveAttribute('aria-expanded', expandedBeforeTailAction ?? 'true')
    const moreAction = projectRow.getByRole('button', { name: '更多' })
    await expect(moreAction).toHaveAttribute('data-state', 'open')
    await expect(moreAction).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(moreAction).toHaveCSS('color', primaryForeground)
    await page.keyboard.press('Escape')

    const activityToggle = page.getByRole('button', { name: /查看活动|关闭活动视图/ })
    if ((await activityToggle.getAttribute('aria-pressed')) !== 'true') {
      await activityToggle.click()
    }
    const activityTimeline = page.locator('.sidebar-timeline')
    const activityHeader = activityTimeline.locator('.sidebar-section-header').first()
    const activityTitle = activityHeader.locator('.sidebar-section-label')
    const activityRow = activityTimeline.locator('[data-sidebar-session-id="visual-rich"]')
    const activitySection = activityRow.locator(
      'xpath=ancestor::section[contains(@class, "sidebar-section")]',
    )
    const activitySectionHeader = activitySection.locator('.sidebar-section-header')
    const activityContent = activitySection.locator('.sidebar-section-content')
    const activityWorkspaceName = activityRow.locator('.sidebar-session-workspace-meta__name')
    await expect(activityTimeline).toBeVisible()
    await expect(activityHeader).toBeVisible()
    await expect(activityRow).toBeVisible()
    await expect(activityWorkspaceName).toHaveText('Pidex-Ts')
    await expect(activityRow.locator('.sidebar-session-snippet')).toHaveCount(0)
    await activityHeader.hover()
    const timelineAction = activityHeader.locator('.sidebar-timeline-menu-button')
    await timelineAction.hover()
    await expect(timelineAction).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(timelineAction).toHaveCSS('color', primaryForeground)
    await timelineAction.click()
    const timelineMenu = page.locator('.sidebar-timeline-menu')
    const timelineMenuItems = timelineMenu.locator('.popover-item')
    const priorityMenuItem = timelineMenu.getByRole('menuitemcheckbox', {
      name: '优先事项部分',
    })
    const priorityMenuCheck = priorityMenuItem.locator('.popover-item-check')
    await expect(timelineMenu).toBeVisible()
    await expect(timelineMenu.locator('.popover-section-title')).toHaveText('显示')
    await expect(timelineMenu.getByRole('menuitemcheckbox')).toHaveText([
      '优先事项部分',
      '置顶',
      '已安排',
    ])
    await expect(timelineMenu.getByRole('menuitem')).toHaveText(['全部标为已读', '归档聊天'])
    await expect(timelineMenu).toHaveCSS('width', '192px')
    await expect(timelineMenu.locator('.popover-scroll-content')).toHaveCSS('padding', '4px')
    for (const item of await timelineMenuItems.all()) {
      await expect(item).toHaveCSS('min-height', '32px')
      await expect(item.locator('.popover-item-leading')).toHaveCSS('display', 'none')
    }
    const [timelineMenuBox, priorityMenuCheckBox] = await Promise.all([
      timelineMenu.boundingBox(),
      priorityMenuCheck.boundingBox(),
    ])
    expect(timelineMenuBox).not.toBeNull()
    expect(priorityMenuCheckBox).not.toBeNull()
    expect(
      timelineMenuBox!.x +
        timelineMenuBox!.width -
        (priorityMenuCheckBox!.x + priorityMenuCheckBox!.width),
    ).toBeCloseTo(12, 0)
    const priorityMenuForeground = await priorityMenuItem.evaluate(
      (element) => getComputedStyle(element).color,
    )
    const priorityMenuBackground = await priorityMenuItem.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    )
    await priorityMenuItem.hover()
    await expect(priorityMenuItem).toHaveCSS('color', priorityMenuForeground)
    await expect
      .poll(async () =>
        priorityMenuItem.evaluate((element) => getComputedStyle(element).backgroundColor),
      )
      .not.toBe(priorityMenuBackground)
    await expect(timelineMenu.getByRole('menuitemcheckbox', { name: '已安排' })).toHaveAttribute(
      'data-disabled',
    )
    await page.keyboard.press('Escape')
    const activityWorkspaceForeground = await activityWorkspaceName.evaluate(
      (element) => getComputedStyle(element).color,
    )
    await activityRow.hover()
    await expect(activityWorkspaceName).toHaveCSS('color', activityWorkspaceForeground)
    for (const action of await activityRow.locator('.sidebar-session-action-button').all()) {
      await action.hover()
      await expect(action).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(action).toHaveCSS('color', primaryForeground)
    }
    const activitySessionTitle = activityRow.locator('.sidebar-session-title')
    const activityTitleTrack = activitySessionTitle.locator('.sidebar-session-title-track')
    await page.addStyleTag({
      content: `
      .sidebar-timeline [data-sidebar-session-id="visual-rich"] .sidebar-session-title {
        width: 72px;
      }
    `,
    })
    await page.mouse.move(1000, 400)
    await expect(activitySessionTitle).toHaveAttribute('data-overflowing', 'true')
    expect(await maskTransparentStopCount(activitySessionTitle)).toBe(1)
    const activityTitleBeforeHover = await activitySessionTitle.boundingBox()
    await activityRow.hover()
    await expect(activityRow.locator('.sidebar-session-actions')).toBeVisible()
    await expect(activitySessionTitle).toHaveAttribute('data-scrolling', 'true')
    expect(await maskTransparentStopCount(activitySessionTitle)).toBe(2)
    const [activityRowBox, activityTitleAfterHover, activityActionsBox] = await Promise.all([
      activityRow.boundingBox(),
      activitySessionTitle.boundingBox(),
      activityRow.locator('.sidebar-session-actions').boundingBox(),
    ])
    expect(activityRowBox).not.toBeNull()
    expect(activityTitleBeforeHover).not.toBeNull()
    expect(activityTitleAfterHover).not.toBeNull()
    expect(activityActionsBox).not.toBeNull()
    expect(activityRowBox!.height).toBeCloseTo(48, 0)
    expect(activityTitleAfterHover!.x).toBeCloseTo(activityTitleBeforeHover!.x, 0)
    expect(activityActionsBox!.y + activityActionsBox!.height / 2).toBeCloseTo(
      activityTitleAfterHover!.y + activityTitleAfterHover!.height / 2,
      0,
    )
    expect(
      activityActionsBox!.x - (activityTitleAfterHover!.x + activityTitleAfterHover!.width),
    ).toBeGreaterThanOrEqual(8)
    await expect
      .poll(async () =>
        activityTitleTrack.evaluate((element) => getComputedStyle(element).transform),
      )
      .not.toBe('none')
    expect(
      await activitySessionTitle.evaluate((element) => {
        const style = getComputedStyle(element)
        return style.maskImage || style.webkitMaskImage
      }),
    ).toContain('linear-gradient')
    await page.mouse.move(1000, 400)
    await expect(activitySessionTitle).not.toHaveAttribute('data-scrolling')
    await expect(activityTitleTrack).toHaveCSS('transform', 'none')
    expect(await maskTransparentStopCount(activitySessionTitle)).toBe(1)
    const navLabel = navRow.locator('.sidebar-item-label')
    await expect(navLabel).toHaveCSS('white-space', 'nowrap')
    await expect(navLabel).toHaveCSS('text-overflow', 'clip')
    expect(
      await navLabel.evaluate((element) => {
        const style = getComputedStyle(element)
        return style.maskImage || style.webkitMaskImage
      }),
    ).toContain('linear-gradient')
    for (const label of [activityTitle, activityWorkspaceName]) {
      await expect(label).toHaveCSS('white-space', 'nowrap')
      await expect(label).toHaveCSS('text-overflow', 'clip')
      expect(
        await label.evaluate((element) => {
          const style = getComputedStyle(element)
          return style.maskImage || style.webkitMaskImage
        }),
      ).toBe('none')
    }
    expect(
      await activityHeader.evaluate((element) => {
        const style = getComputedStyle(element, '::before')
        return style.maskImage || style.webkitMaskImage
      }),
    ).toBe('none')
    expect(
      await activityContent.evaluate((element) => {
        const style = getComputedStyle(element)
        return style.maskImage || style.webkitMaskImage
      }),
    ).toBe('none')
    for (const header of [activityHeader, activitySectionHeader]) {
      await expect(header).toHaveCSS('animation-name', 'none')
      await expect(header).toHaveCSS('opacity', '1')
    }
    await sidebar.locator('.sidebar-scroll-area').evaluate((element) => {
      element.scrollTop = Math.min(120, element.scrollHeight - element.clientHeight)
    })
    await expect(activitySectionHeader).toHaveCSS('opacity', '1')
    await sidebar.locator('.sidebar-scroll-area').evaluate((element) => {
      element.scrollTop = 0
    })
    const [activityHeaderBox, activityTitleBox] = await Promise.all([
      activityHeader.boundingBox(),
      activityTitle.boundingBox(),
    ])
    expect(activityHeaderBox).not.toBeNull()
    expect(activityTitleBox).not.toBeNull()
    if (!activityHeaderBox || !activityTitleBox) return
    expect(activityHeaderBox.x - sidebarBox.x).toBeCloseTo(8, 0)
    expect(activityTitleBox.x - sidebarBox.x).toBeCloseTo(16, 0)
  })
}

test('pinned session icon and overflowing title motion keep the sidebar fade contract', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await gotoWorkbenchFixture(page, '/?visualCase=scroll-edge#/threads/visual-scroll-edge')
  await closeTransientErrorToast(page)

  const sourceRow = page.locator('[data-sidebar-session-id="visual-scroll-edge"]').first()
  await expect(sourceRow).toBeVisible()
  await sourceRow.hover()
  await sourceRow.getByRole('button', { name: '置顶' }).click()

  const pinnedItem = page.locator('[data-sidebar-pinned-item-key="session:visual-scroll-edge"]')
  const pinnedRow = pinnedItem.locator('.sidebar-session-row')
  const ordinaryRow = page.locator('[data-sidebar-session-id="visual-scroll-edge-02"]').first()
  await expect(pinnedItem).toBeVisible()
  await expect(pinnedItem.locator('.sidebar-row-leading .lucide-message-circle')).toBeVisible()
  await expect(pinnedRow).not.toHaveClass(/sidebar-row--session/)
  await expect(pinnedRow).toHaveCSS('padding-left', '8px')
  await expect(ordinaryRow).toHaveClass(/sidebar-row--session/)
  await expect(ordinaryRow).toHaveCSS('padding-left', '8px')
  await expect(ordinaryRow.locator('.sidebar-row-leading-spacer')).toHaveCount(1)
  const projectRow = page.locator('.sidebar-project-header').first()
  const showMore = projectRow.locator('xpath=..').locator('.sidebar-show-more-actions')
  const [projectMainBox, ordinaryMainBox, showMoreMainBox, ordinaryTitleBox, showMoreTextBox] =
    await Promise.all([
      projectRow.locator('.sidebar-row-main').boundingBox(),
      ordinaryRow.locator('.sidebar-row-main').boundingBox(),
      showMore.locator('.sidebar-row-main').boundingBox(),
      ordinaryRow.locator('.sidebar-session-title').boundingBox(),
      showMore.locator('.sidebar-show-more-button span').first().boundingBox(),
    ])
  expect(projectMainBox).not.toBeNull()
  expect(ordinaryMainBox).not.toBeNull()
  expect(showMoreMainBox).not.toBeNull()
  expect(ordinaryTitleBox).not.toBeNull()
  expect(showMoreTextBox).not.toBeNull()
  expect(ordinaryMainBox!.x - projectMainBox!.x).toBeCloseTo(0, 0)
  expect(showMoreMainBox!.x - ordinaryMainBox!.x).toBeCloseTo(0, 0)
  expect(showMoreTextBox!.x - ordinaryTitleBox!.x).toBeCloseTo(0, 0)

  const showMoreButtons = showMore.locator('.sidebar-show-more-button')
  const showMoreLabels = showMoreButtons.locator('span')
  await expect(showMoreButtons).toHaveCount(1)
  const primaryTextColor = await page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--cpx-sys-color-fg-primary)'
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  })
  await showMoreButtons.first().click()
  await expect(showMoreButtons).toHaveCount(2)
  for (let index = 0; index < 2; index += 1) {
    const button = showMoreButtons.nth(index)
    const label = showMoreLabels.nth(index)
    await expect(label).toHaveCSS('white-space', 'nowrap')
    await expect(label).toHaveCSS('text-overflow', 'clip')
    expect(
      await label.evaluate((element) => {
        const style = getComputedStyle(element)
        return style.maskImage || style.webkitMaskImage
      }),
    ).toBe('none')
    await expect(button).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await button.hover()
    await expect(button).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(button).toHaveCSS('color', primaryTextColor)
  }

  await page.addStyleTag({
    content: `
      [data-sidebar-pinned-item-key="session:visual-scroll-edge"] .sidebar-session-title {
        width: 72px;
        flex: 0 0 72px;
      }
      [data-sidebar-session-id="visual-scroll-edge-02"] .sidebar-session-title {
        width: 72px;
        flex: 0 0 72px;
      }
    `,
  })
  await page.mouse.move(1000, 400)
  const title = pinnedItem.locator('.sidebar-session-title')
  const track = title.locator('.sidebar-session-title-track')
  await expect(title).toHaveAttribute('data-overflowing', 'true')
  await expect(title).not.toHaveAttribute('data-scrolling', 'true')

  const resting = await title.evaluate((element) => {
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    return {
      clientWidth: element.clientWidth,
      left: box.left,
      maskImage: style.maskImage || style.webkitMaskImage,
      scrollWidth: element.scrollWidth,
      transform: getComputedStyle(element.querySelector('.sidebar-session-title-track')!).transform,
    }
  })
  expect(resting.scrollWidth).toBeGreaterThan(resting.clientWidth)
  expect(resting.maskImage).toContain('linear-gradient')
  expect(await maskTransparentStopCount(title)).toBe(1)
  expect(resting.transform).toBe('none')

  await pinnedItem.hover()
  await expect(pinnedItem.locator('.sidebar-session-actions')).toBeVisible()
  await expect(title).toHaveAttribute('data-scrolling', 'true')
  await expect
    .poll(async () => track.evaluate((element) => getComputedStyle(element).transform))
    .not.toBe('none')
  const hovered = await title.evaluate((element) => {
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    return {
      left: box.left,
      maskImage: style.maskImage || style.webkitMaskImage,
      distance: Number.parseFloat(style.getPropertyValue('--sidebar-title-scroll-distance')),
      duration: Number.parseFloat(style.getPropertyValue('--sidebar-title-scroll-duration')),
      transform: getComputedStyle(element.querySelector('.sidebar-session-title-track')!).transform,
    }
  })
  expect(hovered.left).toBeCloseTo(resting.left, 0)
  expect(hovered.maskImage).toContain('linear-gradient')
  expect(await maskTransparentStopCount(title)).toBe(2)
  expect(hovered.distance).toBe(resting.scrollWidth - resting.clientWidth)
  expect(hovered.duration).toBeCloseTo(Math.max(4, hovered.distance / 20), 2)
  expect(hovered.transform).not.toBe('none')

  await page.mouse.move(1000, 400)
  await expect(title).not.toHaveAttribute('data-scrolling')
  await expect(track).toHaveCSS('transform', 'none')
  expect(await maskTransparentStopCount(title)).toBe(1)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await pinnedItem.hover()
  await expect(title).not.toHaveAttribute('data-scrolling')
  await expect(track).toHaveCSS('transform', 'none')
  expect(
    await title.evaluate((element) => {
      const style = getComputedStyle(element)
      return style.maskImage || style.webkitMaskImage
    }),
  ).toContain('linear-gradient')
  expect(await maskTransparentStopCount(title)).toBe(1)

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const ordinaryTitle = ordinaryRow.locator('.sidebar-session-title')
  const ordinaryTrack = ordinaryTitle.locator('.sidebar-session-title-track')
  const sessionCard = page.locator('.sidebar-session-hover-card:visible').last()
  await page.mouse.move(1000, 400)
  await expect(ordinaryTitle).toHaveAttribute('data-overflowing', 'true')
  await ordinaryRow.hover()
  await page.waitForTimeout(150)
  await pinnedItem.hover()
  await page.waitForTimeout(150)
  await expect(page.locator('.sidebar-session-hover-card:visible')).toHaveCount(0)
  await page.waitForTimeout(170)
  await expect(sessionCard).toBeVisible()
  await expect(sessionCard).toHaveCSS('opacity', '1')
  await expect(sessionCard).toHaveCSS('transform', 'none')
  expect(
    await sessionCard.evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBe(0)
  await page.evaluate(() => {
    document.body.dataset.sidebarHoverCardHandoff = 'one'
    const observer = new MutationObserver(() => {
      const count = document.querySelectorAll(
        '.sidebar-session-hover-card, .sidebar-project-hover-card',
      ).length
      if (count === 0) document.body.dataset.sidebarHoverCardHandoff = 'none'
      if (count > 1) document.body.dataset.sidebarHoverCardHandoff = 'multiple'
    })
    observer.observe(document.body, { childList: true, subtree: true })
    ;(
      window as typeof window & {
        sidebarHoverCardHandoffObserver?: MutationObserver
      }
    ).sidebarHoverCardHandoffObserver = observer
  })
  const ordinaryCardTitle = (await ordinaryTrack.textContent())?.trim()
  await ordinaryRow.hover()
  await expect(sessionCard).toBeVisible({ timeout: 100 })
  await expect(sessionCard.locator('.sidebar-session-hover-card-title')).toHaveText(
    ordinaryCardTitle ?? '',
  )
  expect(
    await page.evaluate(() => {
      const testWindow = window as typeof window & {
        sidebarHoverCardHandoffObserver?: MutationObserver
      }
      testWindow.sidebarHoverCardHandoffObserver?.disconnect()
      delete testWindow.sidebarHoverCardHandoffObserver
      return document.body.dataset.sidebarHoverCardHandoff
    }),
  ).toBe('one')
  const intentCardBox = await sessionCard.boundingBox()
  expect(intentCardBox).not.toBeNull()
  await page.mouse.move(intentCardBox!.x + 4, intentCardBox!.y + 4)
  await page.waitForTimeout(150)
  await expect(sessionCard).toBeVisible()
  await page.mouse.move(1000, 400)
  await page.waitForTimeout(60)
  await expect(sessionCard).toBeVisible()
  await page.waitForTimeout(80)
  await expect(sessionCard).toBeHidden()

  const ordinaryButton = ordinaryRow.locator('.sidebar-session-button')
  await ordinaryButton.focus()
  await expect(sessionCard).toBeVisible({ timeout: 100 })
  await page.keyboard.press('F2')
  await expect(sessionCard.getByRole('textbox', { name: '任务名称' })).toBeVisible({
    timeout: 100,
  })
  await pinnedItem.hover()
  await page.waitForTimeout(150)
  await expect(sessionCard.getByRole('textbox', { name: '任务名称' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sessionCard).toBeHidden()

  const ordinaryTitleBeforeHover = await ordinaryTitle.boundingBox()
  await ordinaryRow.hover()
  await expect(ordinaryRow.locator('.sidebar-session-actions')).toBeVisible()
  await expect(ordinaryTitle).toHaveAttribute('data-scrolling', 'true')
  const ordinaryTitleAfterHover = await ordinaryTitle.boundingBox()
  expect(ordinaryTitleBeforeHover).not.toBeNull()
  expect(ordinaryTitleAfterHover).not.toBeNull()
  expect(ordinaryTitleAfterHover!.x).toBeCloseTo(ordinaryTitleBeforeHover!.x, 0)
  expect(
    await ordinaryTitle.evaluate((element) => {
      const style = getComputedStyle(element)
      return style.maskImage || style.webkitMaskImage
    }),
  ).toContain('linear-gradient')
  expect(await maskTransparentStopCount(ordinaryTitle)).toBe(2)
  await expect
    .poll(async () => ordinaryTrack.evaluate((element) => getComputedStyle(element).transform))
    .not.toBe('none')
  await expect(sessionCard).toBeVisible()
  const sessionContentId = await sessionCard.getAttribute('id')
  expect(sessionContentId).not.toBeNull()
  const sessionAnchor = page.locator(`[aria-controls="${sessionContentId}"]`)
  const sidebar = page.locator('aside.desktop-sidebar')
  const [sidebarBox, sessionAnchorBox, sessionCardBox] = await Promise.all([
    sidebar.boundingBox(),
    sessionAnchor.boundingBox(),
    sessionCard.boundingBox(),
  ])
  expect(sidebarBox).not.toBeNull()
  expect(sessionAnchorBox).not.toBeNull()
  expect(sessionCardBox).not.toBeNull()
  expect(sessionCardBox!.y - sessionAnchorBox!.y).toBeCloseTo(0, 0)
  expect(sessionCardBox!.x - (sidebarBox!.x + sidebarBox!.width)).toBeCloseTo(4, 0)
  const sessionTitle = sessionCard.locator('.sidebar-session-hover-card-title')
  const sessionMeta = sessionCard.locator('.sidebar-session-hover-card-row-content')
  const sessionContent = sessionCard.locator('.sidebar-session-hover-card-content')
  const [sessionTitleBox, sessionMetaBox, sessionContentBox] = await Promise.all([
    sessionTitle.boundingBox(),
    sessionMeta.boundingBox(),
    sessionContent.boundingBox(),
  ])
  expect(sessionTitleBox).not.toBeNull()
  expect(sessionMetaBox).not.toBeNull()
  expect(sessionContentBox).not.toBeNull()
  expect(sessionTitleBox!.x - sessionContentBox!.x).toBeCloseTo(0, 0)
  expect(sessionMetaBox!.x - sessionTitleBox!.x).toBeCloseTo(22, 0)
  await expect(sessionTitle).toHaveCSS('text-align', 'left')
  await expect(sessionCard.locator('.sidebar-session-hover-card-title-group')).toHaveCSS(
    'align-items',
    'flex-start',
  )
  const sessionTrailing = sessionCard.locator('.sidebar-session-hover-card-trailing')
  const sessionDevice = sessionTrailing.locator('.sidebar-session-hover-card-device-icon')
  const sessionTime = sessionTrailing.locator('.sidebar-session-hover-card-time')
  await expect(sessionTrailing).toHaveCSS('gap', '4px')
  const [sessionDeviceBox, sessionTimeBox] = await Promise.all([
    sessionDevice.boundingBox(),
    sessionTime.boundingBox(),
  ])
  expect(sessionDeviceBox).not.toBeNull()
  expect(sessionTimeBox).not.toBeNull()
  expect(sessionTimeBox!.x - (sessionDeviceBox!.x + sessionDeviceBox!.width)).toBeCloseTo(4, 0)
  expect(
    sessionTimeBox!.y +
      sessionTimeBox!.height / 2 -
      (sessionDeviceBox!.y + sessionDeviceBox!.height / 2),
  ).toBeCloseTo(0, 0)
  expect(await sessionCard.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  )

  const projectButton = page.locator('.sidebar-project-button[data-current]').first()
  const projectCard = page.locator('.sidebar-project-hover-card:visible').last()
  await projectButton.hover()
  await expect(projectCard).toBeVisible({ timeout: 100 })
  await expect(
    page.locator('.sidebar-session-hover-card:visible, .sidebar-project-hover-card:visible'),
  ).toHaveCount(1)

  await page.mouse.move(900, 700)
  await page.waitForTimeout(300)
  await projectButton.focus()
  await expect(projectCard).toBeVisible({ timeout: 100 })
  await page.keyboard.press('Alt+ArrowRight')
  await expect(projectCard).toBeVisible({ timeout: 100 })
  await page.keyboard.press('Escape')
  await expect(projectCard).toBeHidden()
  await projectButton.hover()
  await page.waitForTimeout(150)
  await expect(projectCard).toBeHidden()
  await expect(projectCard).toBeVisible()
  await expect(projectCard).toHaveCSS('opacity', '1')
  await expect(projectCard).toHaveCSS('transform', 'none')
  expect(
    await projectCard.evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBe(0)
  const projectContentId = await projectCard.getAttribute('id')
  expect(projectContentId).not.toBeNull()
  const projectAnchor = page.locator(`[aria-controls="${projectContentId}"]`)
  const [projectAnchorBox, projectCardBox] = await Promise.all([
    projectAnchor.boundingBox(),
    projectCard.boundingBox(),
  ])
  expect(projectAnchorBox).not.toBeNull()
  expect(projectCardBox).not.toBeNull()
  expect(projectCardBox!.y - projectAnchorBox!.y).toBeCloseTo(0, 0)
  expect(projectCardBox!.x - (sidebarBox!.x + sidebarBox!.width)).toBeCloseTo(4, 0)
  const projectTitle = projectCard.locator('.sidebar-project-hover-card-header strong')
  const projectStats = projectCard.locator('.sidebar-project-hover-card-stats-content')
  const projectPath = projectCard.locator('.sidebar-project-hover-card-folder-path').first()
  const projectEdit = projectCard.locator('.sidebar-project-hover-card-edit span')
  const [projectTitleBox, projectStatsBox, projectPathBox, projectEditBox] = await Promise.all([
    projectTitle.boundingBox(),
    projectStats.boundingBox(),
    projectPath.boundingBox(),
    projectEdit.boundingBox(),
  ])
  for (const box of [projectTitleBox, projectStatsBox, projectPathBox, projectEditBox]) {
    expect(box).not.toBeNull()
    expect(box!.x - projectTitleBox!.x).toBeCloseTo(0, 0)
  }
  expect(
    await projectCard.locator('svg').evaluateAll((elements) =>
      [
        ...new Set(
          elements.map((element) => {
            const style = getComputedStyle(element)
            return `${style.width}x${style.height}`
          }),
        ),
      ].sort(),
    ),
  ).toEqual(['14pxx14px'])
  await expect(projectCard.locator('.sidebar-project-hover-card-pin')).toHaveCSS('width', '24px')
  await expect(projectCard.locator('.sidebar-project-hover-card-pin')).toHaveCSS('height', '24px')
  expect(await projectCard.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  )

  await page.setViewportSize({ width: 1440, height: 480 })
  await projectButton.hover()
  const collisionAdjustedProjectCard = page.locator('.sidebar-project-hover-card:visible').last()
  await expect(collisionAdjustedProjectCard).toBeVisible()
  const collisionAdjustedProjectCardBox = await collisionAdjustedProjectCard.boundingBox()
  expect(collisionAdjustedProjectCardBox).not.toBeNull()
  expect(collisionAdjustedProjectCardBox!.y).toBeGreaterThanOrEqual(6)
  expect(
    collisionAdjustedProjectCardBox!.y + collisionAdjustedProjectCardBox!.height,
  ).toBeLessThanOrEqual(474)

  const recentSection = page.locator('.sidebar-section:has([data-sidebar-section-id="recent"])')
  await recentSection.getByRole('button', { name: '整理侧栏' }).click({ force: true })
  await page.getByRole('menuitemradio', { name: '在一个列表中' }).click()
  const recentRow = recentSection
    .locator('[data-sidebar-session-id="visual-scroll-edge-02"]')
    .first()
  await expect(recentRow).toHaveClass(/sidebar-row--session/)
  await expect(recentRow).toHaveCSS('padding-left', '8px')
  await expect(recentRow.locator('.sidebar-row-leading-spacer')).toHaveCount(1)
})

test('sidebar session reorder displaces live and persists after remount', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await prepareVisualTheme(page, 'light', { reduceMotion: 'off' })
  await gotoWorkbenchFixture(page, '/?visualCase=scroll-edge#/threads/visual-scroll-edge')
  await closeTransientErrorToast(page)

  const projectSection = page.locator('.sidebar-section:has([data-sidebar-section-id="projects"])')
  const project = projectSection.locator('.sidebar-project-sortable').filter({
    has: page.getByRole('button', { name: /Pidex-Ts/ }),
  })
  const projectToggle = project.getByRole('button', { name: /Pidex-Ts/ })
  const rows = projectSection.locator('.sidebar-session-row')
  if ((await rows.count()) === 0) {
    await projectToggle.click()
  }
  await expect(rows).toHaveCount(5)
  const before = await rows.evaluateAll((items) =>
    items.map((item) => (item as HTMLElement).dataset.sidebarSessionId),
  )
  const sourceId = before[1]
  const targetId = before[2]
  expect(sourceId).toBeTruthy()
  expect(targetId).toBeTruthy()

  const source = projectSection.locator(`[data-sidebar-session-id="${sourceId}"]`)
  const target = projectSection.locator(`[data-sidebar-session-id="${targetId}"]`)
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  expect(sourceBox).not.toBeNull()
  expect(targetBox).not.toBeNull()

  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height, {
    steps: 8,
  })
  await expect(source).toHaveAttribute('data-dragging', 'true')
  await expect(source).not.toHaveCSS('box-shadow', 'none')
  await expect
    .poll(async () =>
      rows.evaluateAll((items) =>
        items.map((item) => (item as HTMLElement).dataset.sidebarSessionId),
      ),
    )
    .not.toEqual(before)
  const reordered = await rows.evaluateAll((items) =>
    items.map((item) => (item as HTMLElement).dataset.sidebarSessionId),
  )
  await page.mouse.up()
  await expect(source).toHaveCSS('box-shadow', 'none')

  await expect
    .poll(async () =>
      rows.evaluateAll((items) =>
        items.map((item) => (item as HTMLElement).dataset.sidebarSessionId),
      ),
    )
    .toEqual(reordered)
  await expect(page).toHaveURL(/#\/threads\/visual-scroll-edge$/)

  await projectToggle.click()
  await expect(rows).toHaveCount(0)
  await projectToggle.click()
  await expect(rows).toHaveCount(5)
  await expect
    .poll(async () =>
      rows.evaluateAll((items) =>
        items.map((item) => (item as HTMLElement).dataset.sidebarSessionId),
      ),
    )
    .toEqual(reordered)

  await source.hover()
  await source.getByRole('button', { name: '归档' }).click()
  await expect(source).not.toHaveAttribute('data-dragging')
  await expect(source.getByRole('button', { name: '确认' })).toBeVisible()
})

test('sidebar footer reserves space outside the task scroll viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto('/?visualCase=rich#/new')
  await closeTransientErrorToast(page)

  const sidebar = page.locator('aside.desktop-sidebar')
  const scrollArea = sidebar.locator('.sidebar-scroll-area')
  const footer = sidebar.locator('.sidebar-footer')
  const footerStatusSlot = footer.locator('.sidebar-footer-status-slot')
  const footerTrigger = footer.locator('.sidebar-footer-trigger')

  const expectFooterOutsideScrollViewport = async () => {
    await expect
      .poll(async () => {
        const [scrollAreaBox, footerBox] = await Promise.all([
          scrollArea.boundingBox(),
          footer.boundingBox(),
        ])
        if (!scrollAreaBox || !footerBox) return false
        return scrollAreaBox.y + scrollAreaBox.height <= footerBox.y + 0.5
      })
      .toBe(true)
  }

  await expectFooterOutsideScrollViewport()
  await expect(footer).toHaveCSS('height', '37px')
  await expect(footerStatusSlot).toHaveCSS('min-width', '24px')
  await expect(footerTrigger).toHaveCSS('white-space', 'nowrap')
  await expect(footerTrigger).toHaveCSS('text-overflow', 'clip')
  expect(
    await footerTrigger.evaluate((element) => {
      const style = getComputedStyle(element)
      return style.maskImage || style.webkitMaskImage
    }),
  ).toBe('none')
  await scrollArea.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })

  const lastScrollItem = scrollArea
    .locator('[data-sidebar-session-id], .sidebar-empty, .sidebar-section-header')
    .last()
  await expect(lastScrollItem).toBeVisible()
  const [lastScrollItemBox, footerBox] = await Promise.all([
    lastScrollItem.boundingBox(),
    footer.boundingBox(),
  ])
  expect(lastScrollItemBox).not.toBeNull()
  expect(footerBox).not.toBeNull()
  expect(lastScrollItemBox!.y + lastScrollItemBox!.height).toBeLessThanOrEqual(footerBox!.y + 0.5)

  await footer.getByRole('button', { name: '设置', exact: true }).click()
  const footerMenu = page.locator('.popover-sidebar-footer')
  await expect(footerMenu).toBeVisible()
  await expect(footerMenu).toHaveAttribute('data-side', 'top')
  const settingsItem = footerMenu.locator('.popover-item').filter({ hasText: '设置' }).first()
  const petItem = footerMenu
    .locator('.popover-item')
    .filter({ hasText: /显示宠物|隐藏宠物/ })
    .first()
  await expect(settingsItem).toHaveCSS('min-height', '32px')
  await expect(petItem).toHaveCSS('min-height', '32px')
  const [settingsItemBox, petItemBox] = await Promise.all([
    settingsItem.boundingBox(),
    petItem.boundingBox(),
  ])
  expect(settingsItemBox).not.toBeNull()
  expect(petItemBox).not.toBeNull()
  expect(settingsItemBox!.height).toBeCloseTo(petItemBox!.height, 0)
  const footerMenuLabel = settingsItem.locator('.popover-item-label')
  await expect(footerMenuLabel).toHaveCSS('white-space', 'nowrap')
  await expect(footerMenuLabel).toHaveCSS('text-overflow', 'clip')
  expect(
    await footerMenuLabel.evaluate((element) => {
      const style = getComputedStyle(element)
      return style.maskImage || style.webkitMaskImage
    }),
  ).toBe('none')
  const footerMenuBox = await footerMenu.boundingBox()
  expect(footerMenuBox).not.toBeNull()
  expect(footerMenuBox!.y + footerMenuBox!.height).toBeLessThanOrEqual(footerBox!.y)
  await page.keyboard.press('Escape')

  await page.getByTitle('收起侧边栏').click()
  await expect(sidebar).toHaveClass(/is-collapsed/)
  await page.mouse.move(600, 400)
  await page.mouse.move(6, 400)
  await expect(sidebar).toHaveClass(/is-preview/)
  await expectFooterOutsideScrollViewport()
})

test('sidebar keeps one mounted tree across docked and hover preview modes', async ({ page }) => {
  await page.goto('/?visualCase=rich#/new')
  await closeTransientErrorToast(page)
  const sidebar = page.locator('aside.desktop-sidebar')
  const sidebarTrigger = page.locator('[data-app-shell-sidebar-trigger]')
  await page.getByTitle('收起侧边栏').click()
  await expect(sidebar).toHaveClass(/is-collapsed/)
  await expect(page.locator('.sidebar-hover-zone')).toHaveCount(0)

  await page.mouse.move(600, 400)
  await page.mouse.move(6, 400)
  await expect(sidebar).toHaveClass(/is-preview/)
  await expect(page.locator('.desktop-sidebar')).toHaveCount(1)

  await page.mouse.move(600, 400)
  await expect(sidebar).toHaveClass(/is-collapsed/)
  await sidebarTrigger.hover()
  await expect(sidebar).toHaveClass(/is-preview/, { timeout: 1_000 })
  await page.keyboard.press('Control+b')
  await expect(sidebar).toHaveClass(/is-docked/)

  const spacer = page.locator('.desktop-sidebar-spacer')
  const sidebarWidthBeforeDrag = (await sidebar.boundingBox())!.width
  const sidebarSeparator = page.getByRole('separator', {
    name: '调整任务侧栏宽度',
  })
  const sidebarSeparatorBox = await sidebarSeparator.boundingBox()
  expect(sidebarSeparatorBox).not.toBeNull()
  await page.mouse.move(
    sidebarSeparatorBox!.x + sidebarSeparatorBox!.width / 2,
    sidebarSeparatorBox!.y + sidebarSeparatorBox!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(sidebarSeparatorBox!.x + 64, sidebarSeparatorBox!.y + 24, { steps: 8 })
  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
    .toBeGreaterThan(sidebarWidthBeforeDrag + 32)
  await expect
    .poll(async () => (await spacer.boundingBox())?.width ?? 0)
    .toBeGreaterThan(sidebarWidthBeforeDrag + 32)
  await expect(page.locator('.sidebar-resize-guide')).toHaveCount(0)
  await page.mouse.up()
})

test('sidebar exit and re-entry keep the workspace aligned', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/?visualCase=rich#/new')
  await closeTransientErrorToast(page)

  const sidebar = page.locator('aside.desktop-sidebar')
  const spacer = page.locator('.desktop-sidebar-spacer')
  const main = page.locator('.desktop-main')
  const initialSidebarBox = await sidebar.boundingBox()
  const initialSpacerBox = await spacer.boundingBox()
  expect(initialSidebarBox).not.toBeNull()
  expect(initialSpacerBox).not.toBeNull()
  expect(initialSpacerBox!.width).toBeCloseTo(initialSidebarBox!.width, 0)

  const exitingState = await page.evaluate(async () => {
    document.querySelector<HTMLElement>('[title="收起侧边栏"]')?.click()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const element = document.querySelector<HTMLElement>('aside.desktop-sidebar')
    if (!element) return null
    const style = getComputedStyle(element)
    return {
      ariaHidden: element.getAttribute('aria-hidden'),
      inert: element.hasAttribute('inert'),
      opacity: Number(style.opacity),
      visibility: style.visibility,
    }
  })
  expect(exitingState).not.toBeNull()
  expect(exitingState).toMatchObject({
    ariaHidden: 'true',
    inert: true,
    visibility: 'visible',
  })

  await expect(sidebar).toHaveCSS('visibility', 'hidden')
  await expect.poll(async () => (await spacer.boundingBox())?.width).toBeCloseTo(0, 0)

  await page.locator('[data-app-shell-sidebar-trigger]').click()
  await expect(sidebar).toHaveClass(/is-docked/)
  await expect(sidebar).toHaveCSS('visibility', 'visible')
  await expect
    .poll(async () => (await spacer.boundingBox())?.width)
    .toBeCloseTo(initialSidebarBox!.width, 0)

  const [reopenedSidebarBox, reopenedMainBox] = await Promise.all([
    sidebar.boundingBox(),
    main.boundingBox(),
  ])
  expect(reopenedSidebarBox).not.toBeNull()
  expect(reopenedMainBox).not.toBeNull()
  expect(reopenedMainBox!.x).toBeCloseTo(reopenedSidebarBox!.x + reopenedSidebarBox!.width, 0)
  await expect(page.locator('aside.desktop-sidebar')).toHaveCount(1)
})

test('workbench panels and spacers reflow together while exiting', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.goto('/?visualCase=rich#/threads/visual-rich')
  await closeTransientErrorToast(page)
  await expect(page.getByText('已完成工作台结构梳理。', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '显示右侧面板' }).click()
  const rightShell = page.locator('.desktop-workspace-panel--right')
  const rightSurface = rightShell.locator('.desktop-workspace-panel__surface')
  const rightSpacer = page.locator('.desktop-workspace-panel-spacer--right')
  const main = page.locator('.desktop-main-route')
  await expect(rightShell).toHaveAttribute('data-workbench-panel-presence', 'open')
  await page.waitForTimeout(180)
  const [rightBefore, surfaceBefore, mainBefore] = await Promise.all([
    rightShell.boundingBox(),
    rightSurface.boundingBox(),
    main.boundingBox(),
  ])
  expect(rightBefore).not.toBeNull()
  expect(surfaceBefore).not.toBeNull()
  expect(mainBefore).not.toBeNull()

  const rightExit = await page.evaluate(async () => {
    document.querySelector<HTMLElement>('[aria-label="关闭右侧面板"]')?.click()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const shell = document.querySelector<HTMLElement>('.desktop-workspace-panel--right')
    const immediate = shell
      ? {
          ariaHidden: shell.getAttribute('aria-hidden'),
          inert: shell.hasAttribute('inert'),
          state: shell.dataset.workbenchPanelPresence,
        }
      : null
    await new Promise((resolve) => setTimeout(resolve, 40))
    const surface = shell?.querySelector<HTMLElement>('.desktop-workspace-panel__surface')
    const mainRoute = document.querySelector<HTMLElement>('.desktop-main-route')
    const spacer = document.querySelector<HTMLElement>('.desktop-workspace-panel-spacer--right')
    return {
      immediate,
      mainWidth: mainRoute?.getBoundingClientRect().width ?? 0,
      shellWidth: shell?.getBoundingClientRect().width ?? 0,
      spacerWidth: spacer?.getBoundingClientRect().width ?? 0,
      surfaceWidth: surface?.getBoundingClientRect().width ?? 0,
    }
  })
  expect(rightExit.immediate).toEqual({
    ariaHidden: 'true',
    inert: true,
    state: 'exiting',
  })
  expect(rightExit.shellWidth).toBeLessThan(rightBefore!.width)
  expect(rightExit.shellWidth).toBeGreaterThan(0)
  expect(rightExit.spacerWidth).toBeCloseTo(rightExit.shellWidth, 0)
  expect(rightExit.surfaceWidth).toBeCloseTo(rightExit.shellWidth, 0)
  expect(rightExit.surfaceWidth).toBeLessThan(surfaceBefore!.width)
  expect(rightExit.mainWidth).toBeGreaterThan(mainBefore!.width)
  await expect(rightShell).toHaveCount(0)
  await expect(rightSpacer).toHaveCount(0)

  await page.getByRole('button', { name: '显示右侧面板' }).click()
  await page.waitForTimeout(180)
  await page.evaluate(async () => {
    document.querySelector<HTMLElement>('[aria-label="关闭右侧面板"]')?.click()
    await new Promise((resolve) => setTimeout(resolve, 24))
    document.querySelector<HTMLElement>('[aria-label="显示右侧面板"]')?.click()
  })
  await expect(rightShell).toHaveCount(1)
  await expect(rightSpacer).toHaveCount(1)
  await expect(rightShell).toHaveAttribute('data-workbench-panel-presence', 'open')
  await expect(page.getByRole('complementary', { name: '右侧面板' })).toHaveCount(1)

  await page.getByRole('button', { name: '打开集成终端 (Ctrl+`)' }).click()
  const bottomShell = page.locator('.desktop-workspace-panel--bottom')
  const bottomSurface = bottomShell.locator('.desktop-workspace-panel__surface')
  const bottomSpacer = page.locator('.desktop-workspace-panel-spacer--bottom')
  const bottomUpper = page.locator('.desktop-workspace__upper')
  await page.waitForTimeout(180)
  const [bottomBefore, bottomSurfaceBefore, bottomUpperBefore] = await Promise.all([
    bottomShell.boundingBox(),
    bottomSurface.boundingBox(),
    bottomUpper.boundingBox(),
  ])
  const bottomExit = await page.evaluate(async () => {
    document.querySelector<HTMLElement>('[aria-label="隐藏集成终端"]')?.click()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const shell = document.querySelector<HTMLElement>('.desktop-workspace-panel--bottom')
    const immediateState = shell?.dataset.workbenchPanelPresence ?? null
    await new Promise((resolve) => setTimeout(resolve, 40))
    const surface = shell?.querySelector<HTMLElement>('.desktop-workspace-panel__surface')
    const spacer = document.querySelector<HTMLElement>('.desktop-workspace-panel-spacer--bottom')
    const upper = document.querySelector<HTMLElement>('.desktop-workspace__upper')
    return {
      immediateState,
      shellHeight: shell?.getBoundingClientRect().height ?? 0,
      spacerHeight: spacer?.getBoundingClientRect().height ?? 0,
      surfaceHeight: surface?.getBoundingClientRect().height ?? 0,
      upperHeight: upper?.getBoundingClientRect().height ?? 0,
    }
  })
  expect(bottomExit.immediateState).toBe('exiting')
  expect(bottomExit.shellHeight).toBeLessThan(bottomBefore!.height)
  expect(bottomExit.shellHeight).toBeGreaterThan(0)
  expect(bottomExit.spacerHeight).toBeCloseTo(bottomExit.shellHeight, 0)
  expect(Math.abs(bottomExit.surfaceHeight - bottomExit.shellHeight)).toBeLessThanOrEqual(1)
  expect(bottomExit.surfaceHeight).toBeLessThan(bottomSurfaceBefore!.height)
  expect(bottomExit.upperHeight).toBeGreaterThan(bottomUpperBefore!.height)
  await expect(bottomShell).toHaveCount(0)
  await expect(bottomSpacer).toHaveCount(0)
})

test('turn navigation preview matches Codex geometry and output limits', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.emulateMedia({
    colorScheme: 'dark',
    forcedColors: 'none',
    reducedMotion: 'no-preference',
  })
  await page.goto('/?visualCase=turn-nav#/threads/visual-turn-nav')
  await closeTransientErrorToast(page)
  await expect(page.getByText('第 4 轮已完成。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '取消置顶摘要' }).click()

  const rail = page.getByRole('navigation', { name: '用户消息导航' })
  await expect(rail).toBeVisible()
  const items = rail.getByRole('button')
  await expect(items).toHaveCount(4)

  const frame = page.locator('.workflow-main-scroll-frame')
  const turn = page.locator('.canonical-turn').first()
  const assistant = turn.locator('.canonical-turn__result').first()
  const userBubble = turn.locator('.canonical-user-message__bubble').first()
  const composer = page.locator('.workflow-page__composer-inner')
  const [frameBox, turnBox, assistantBox, userBubbleBox, composerBox, railBox] = await Promise.all([
    frame.boundingBox(),
    turn.boundingBox(),
    assistant.boundingBox(),
    userBubble.boundingBox(),
    composer.boundingBox(),
    rail.boundingBox(),
  ])
  expect(frameBox).not.toBeNull()
  expect(turnBox).not.toBeNull()
  expect(assistantBox).not.toBeNull()
  expect(userBubbleBox).not.toBeNull()
  expect(composerBox).not.toBeNull()
  expect(railBox).not.toBeNull()
  if (!frameBox || !turnBox || !assistantBox || !userBubbleBox || !composerBox || !railBox) return

  const conversationColumns = await frame.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      railStart: Number.parseFloat(style.getPropertyValue('--conversation-rail-inline-start')),
      railWidth: Number.parseFloat(style.getPropertyValue('--conversation-rail-width')),
      railGap: Number.parseFloat(style.getPropertyValue('--conversation-rail-gap')),
    }
  })
  expect(
    conversationColumns.railStart + conversationColumns.railWidth + conversationColumns.railGap,
  ).toBeCloseTo(48, 0)
  expect(turnBox.x - frameBox.x).toBeGreaterThanOrEqual(48)
  expect(frameBox.x + frameBox.width - (turnBox.x + turnBox.width)).toBeGreaterThanOrEqual(16)
  expect(turnBox.x).toBeCloseTo(composerBox.x, 0)
  expect(turnBox.width).toBeCloseTo(composerBox.width, 0)
  expect(assistantBox.x).toBeCloseTo(turnBox.x, 0)
  expect(userBubbleBox.x + userBubbleBox.width).toBeCloseTo(turnBox.x + turnBox.width, 0)
  expect(railBox.x - frameBox.x).toBeCloseTo(8, 0)
  expect(turnBox.x - (railBox.x + railBox.width)).toBeGreaterThanOrEqual(8)

  const lastItem = items.last()
  await expect(lastItem).toHaveAttribute('aria-current', 'true')
  await expect(lastItem).toHaveCSS('width', '32px')
  await expect(lastItem).toHaveCSS('height', '10px')

  const marker = lastItem.locator('.conversation-turn-nav-marker')
  const idleMarkerBox = await marker.boundingBox()
  expect(idleMarkerBox?.width).toBeCloseTo(6, 0)

  await lastItem.focus()
  const tooltip = page.locator('.conversation-turn-preview-tooltip').last()
  const preview = tooltip.locator('[data-thread-user-message-navigation-tooltip-preview]').last()
  await expect(preview).toBeVisible()
  await expect(tooltip).toHaveCSS('animation-name', 'none')
  await expect(tooltip).toHaveCSS('opacity', '1')
  await expect(tooltip).toHaveCSS('transform', 'none')
  expect(await tooltip.evaluate((element) => element.getAnimations().length)).toBe(0)
  await expect(preview).toHaveCSS('width', '320px')
  await expect(preview).toHaveCSS('padding', '8px')
  await expect(preview).toHaveCSS('font-size', '12px')
  await expect(preview).toHaveCSS('line-height', '16px')
  await expect(preview).toHaveCSS('border-radius', '16px')
  await expect(preview.locator('.preview-card-assistant-text')).toHaveCSS('-webkit-line-clamp', '3')
  const previewListItems = preview.locator('.preview-card-assistant-text .md-body li')
  await expect(previewListItems).toHaveCount(3)
  await expect(previewListItems.nth(1)).toHaveCSS('margin-top', '0px')

  await expect(preview.locator('.preview-card-output')).toHaveCount(2)
  await expect(preview.locator('.preview-card-output-more')).toHaveText('+1')
  await expect(tooltip.locator('.tooltip-arrow')).toHaveCount(0)
  await expect(tooltip).toHaveCSS('padding', '0px')
  const tooltipBox = await tooltip.boundingBox()
  expect(tooltipBox).not.toBeNull()
  expect(tooltipBox!.x - (railBox.x + railBox.width)).toBeCloseTo(8, 0)
  expect(tooltipBox!.x).toBeCloseTo(timelineBox.x, 0)

  await lastItem.hover()
  await expect.poll(async () => (await marker.boundingBox())?.width).toBeCloseTo(26, 0)

  await items.nth((await items.count()) - 2).hover()
  await expect(tooltip).toBeVisible({ timeout: 100 })
  await expect(tooltip).toHaveCSS('animation-name', 'none')

  await page.setViewportSize({ width: 760, height: 920 })
  await expect(rail).toHaveCount(0)
})

test('turn navigation supports click, keyboard, and pointer scrubbing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.emulateMedia({
    colorScheme: 'dark',
    forcedColors: 'none',
    reducedMotion: 'no-preference',
  })
  await page.goto('/?visualCase=turn-nav#/threads/visual-turn-nav')
  await closeTransientErrorToast(page)
  await expect(page.getByText('第 4 轮已完成。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '取消置顶摘要' }).click()

  const rail = page.getByRole('navigation', { name: '用户消息导航' })
  const items = rail.getByRole('button')
  const userMessage = (text: string) =>
    page.locator('[data-turn-navigation-id] [data-user-message-bubble]').filter({
      hasText: text,
    })
  await expect(items).toHaveCount(4)

  await items.first().click()
  await expect(userMessage('第一轮：梳理 Codex 导航轨。')).toBeInViewport()

  await page.keyboard.press('Alt+ArrowDown')
  await expect(userMessage('第 2 轮：继续校准交互和视觉。')).toBeInViewport()

  const firstBox = await items.first().boundingBox()
  const lastBox = await items.last().boundingBox()
  expect(firstBox).not.toBeNull()
  expect(lastBox).not.toBeNull()
  if (!firstBox || !lastBox) return

  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2)
  await page.mouse.down()
  const previewTooltip = page.locator('.conversation-turn-preview-tooltip').last()
  await expect(previewTooltip).toBeVisible({ timeout: 100 })
  await expect(previewTooltip).toHaveCSS('animation-name', 'none')
  await page.mouse.move(lastBox.x + lastBox.width / 2, lastBox.y + lastBox.height / 2, { steps: 4 })
  await expect(items.last()).toHaveAttribute('data-scrub-target', '')
  await expect(previewTooltip).toBeVisible({ timeout: 100 })
  await expect(previewTooltip).toHaveCSS('animation-name', 'none')
  await page.mouse.up()
  await expect(rail.locator('[data-scrub-target]')).toHaveCount(0)
  await expect(userMessage('第 4 轮：继续校准交互和视觉。')).toBeInViewport()
})

test('narrow sidebar uses floating preview without drawer or backdrop', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 800 })
  await page.goto('/?visualCase=empty#/new')
  await closeTransientErrorToast(page)
  const sidebar = page.locator('aside.desktop-sidebar')
  await expect(sidebar).toHaveClass(/is-collapsed/)
  await page.mouse.move(6, 400)
  await expect(sidebar).toHaveClass(/is-preview/)
  await expect(page.locator('.sidebar-drawer-backdrop')).toHaveCount(0)
  await expect(sidebar).not.toHaveClass(/is-drawer/)
  const primaryNavigationRow = page
    .getByRole('navigation', { name: '新建对话' })
    .getByRole('link', { name: '新建对话' })
  await expect(primaryNavigationRow).toBeVisible()
  await expectCompactInteractiveRow(primaryNavigationRow, {
    borderRadius: '8px',
    fontSize: '14px',
    height: 30,
    lineHeight: '20px',
    paddingInline: '8px',
  })
  await expectHoverBackground(
    page.getByRole('navigation', { name: '主要导航' }).getByRole('link', { name: '拉取请求' }),
  )

  const composerUtilityRows = page.locator(
    '.composer .meta-chip:visible, .composer .composer-model-chip:visible, .composer .permission-select-trigger:visible',
  )
  await expect(composerUtilityRows.first()).toBeVisible()
  const composerRowStyles = await composerUtilityRows.evaluateAll((rows) =>
    rows.map((row) => {
      const style = getComputedStyle(row)
      return {
        borderRadius: style.borderRadius,
        fontSize: style.fontSize,
        height: row.getBoundingClientRect().height,
        lineHeight: style.lineHeight,
        paddingInline: style.paddingInline,
      }
    }),
  )
  expect(composerRowStyles.length).toBeGreaterThanOrEqual(2)
  expect(
    composerRowStyles.every(
      (row) =>
        row.borderRadius === '9999px' &&
        row.fontSize === '13px' &&
        row.height === 28 &&
        row.lineHeight === '18px' &&
        row.paddingInline === '6px',
    ),
  ).toBe(true)

  await page.getByTitle('展开侧边栏').click()
  await expect(sidebar).toHaveClass(/is-docked/)
  await page.setViewportSize({ width: 900, height: 800 })
  await expect(sidebar).toHaveClass(/is-docked/)
})

test('composer utility controls preserve hover and selected state hierarchy', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.emulateMedia({
    colorScheme: 'dark',
    forcedColors: 'none',
    reducedMotion: 'reduce',
  })
  await page.goto('/?visualCase=permission#/threads/visual-permission')
  await closeTransientErrorToast(page)
  await expect(page.getByText('已完成工作台结构梳理。', { exact: true })).toBeVisible()

  for (const row of [
    page.locator('.permission-select-trigger:visible'),
    page.locator('.composer-model-chip:visible'),
  ]) {
    await expect(row).toBeVisible()
    await expectHoverBackground(row)
  }

  const selectedPlanMode = page.locator('.composer-plan-mode-chip.active:visible')
  await expect(selectedPlanMode).toBeVisible()
  await expectSelectedBackgroundOnHover(selectedPlanMode)
})

test('composer add-context menu keeps the hovered item across rerenders', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?visualCase=permission#/threads/visual-permission')
  await closeTransientErrorToast(page)
  await expect(page.getByText('已完成工作台结构梳理。', { exact: true })).toBeVisible()

  await expect(page.locator('body')).toHaveCSS('font-size', '14px')
  await expect(page.locator('body')).toHaveCSS('font-weight', '400')
  await expect(page.locator('body')).toHaveCSS('line-height', '20px')

  const sidebarTypography = await page.evaluate(() => {
    const row = document.createElement('div')
    row.className = 'sidebar-session-row'
    const sessionTitle = document.createElement('span')
    sessionTitle.className = 'sidebar-session-title'
    const projectTitle = document.createElement('span')
    projectTitle.className = 'sidebar-project-title-text'
    row.append(sessionTitle, projectTitle)
    document.body.append(row)
    const readSession = () => {
      const style = getComputedStyle(sessionTitle)
      return {
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
      }
    }
    const ordinary = readSession()
    row.classList.add('active', 'selected')
    const selected = readSession()
    const projectFontWeight = getComputedStyle(projectTitle).fontWeight
    row.remove()
    return { ordinary, projectFontWeight, selected }
  })
  expect(sidebarTypography).toEqual({
    ordinary: {
      fontSize: '13px',
      fontWeight: '500',
      lineHeight: '18px',
    },
    projectFontWeight: '500',
    selected: {
      fontSize: '13px',
      fontWeight: '500',
      lineHeight: '18px',
    },
  })

  const composer = page.locator('.workflow-page__composer-inner')
  const editor = composer.locator('.composer-editor-content[contenteditable="true"]')
  const originalText = await editor.textContent()
  await composer.getByTitle('添加文件等内容').click()
  await expect(editor).toHaveText(originalText ?? '')

  const dropdown = composer.locator('.chat-input__dropdown:visible')
  const firstEnabledItem = dropdown.locator('.chat-input__dropdown-item:not(.is-disabled)').first()
  const modelItem = dropdown
    .locator('.chat-input__dropdown-item')
    .filter({ hasText: /文件|任务|浏览器/ })
    .first()
  await expect(firstEnabledItem).toHaveClass(/is-keyboard-active/)

  const menuTypography = await modelItem.evaluate((item) => {
    const itemStyle = getComputedStyle(item)
    const label = item.querySelector<HTMLElement>('.chat-input__dropdown-label')
    const hint = item.querySelector<HTMLElement>('.chat-input__dropdown-hint')
    if (!label || !hint) throw new Error('Missing Composer menu typography fixture')
    const labelStyle = getComputedStyle(label)
    const hintStyle = getComputedStyle(hint)
    return {
      hintFontSize: hintStyle.fontSize,
      hintFontWeight: hintStyle.fontWeight,
      hintLineHeight: hintStyle.lineHeight,
      itemFontSize: itemStyle.fontSize,
      itemFontWeight: labelStyle.fontWeight,
      itemHeight: item.getBoundingClientRect().height,
      itemLineHeight: itemStyle.lineHeight,
    }
  })
  expect(menuTypography).toEqual({
    hintFontSize: '12px',
    hintFontWeight: '400',
    hintLineHeight: '16px',
    itemFontSize: '13px',
    itemFontWeight: '500',
    itemHeight: 32,
    itemLineHeight: '18px',
  })

  const fontIndependentTypography = await modelItem.evaluate((item) => {
    const root = document.documentElement
    const read = () => {
      const itemStyle = getComputedStyle(item)
      const hint = item.querySelector<HTMLElement>('.chat-input__dropdown-hint')!
      const hintStyle = getComputedStyle(hint)
      return {
        hintFontSize: hintStyle.fontSize,
        hintFontWeight: hintStyle.fontWeight,
        hintLineHeight: hintStyle.lineHeight,
        itemFontSize: itemStyle.fontSize,
        itemFontWeight: itemStyle.fontWeight,
        itemLineHeight: itemStyle.lineHeight,
      }
    }
    root.style.setProperty('--font-family-sans', 'Arial, sans-serif')
    const proportional = read()
    root.style.setProperty('--font-family-sans', '"JetBrains Mono", monospace')
    const monospace = read()
    root.style.removeProperty('--font-family-sans')
    return { monospace, proportional }
  })
  expect(fontIndependentTypography.monospace).toEqual(fontIndependentTypography.proportional)

  await modelItem.hover()
  await expect(modelItem).toHaveClass(/is-keyboard-active/)
  await expect(firstEnabledItem).not.toHaveClass(/is-keyboard-active/)
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
  await expect(modelItem).toHaveClass(/is-keyboard-active/)

  const modelItemId = await modelItem.getAttribute('id')
  expect(modelItemId).not.toBeNull()
  await expect(editor).toHaveAttribute('aria-activedescendant', modelItemId!)

  await composer.getByTitle('添加文件等内容').click()
  await expect(dropdown).toHaveCount(0)
})

test('settings toolbar trigger restores the Codex hover overlay', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.goto('/?visualCase=empty#/settings/general')
  await closeTransientErrorToast(page)

  const trigger = page.getByRole('combobox', { name: '默认打开目标' })
  await expectCompactInteractiveRow(trigger, {
    borderRadius: '8px',
    fontSize: '14px',
    height: 28,
    lineHeight: '18px',
    paddingInline: '8px',
  })
  await expectHoverBackground(trigger)
})

test('settings uses the shared full-label sidebar in desktop and narrow previews', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 800 })
  await page.goto('/?visualCase=rich#/settings/appearance')
  await closeTransientErrorToast(page)
  const sidebar = page.locator('aside.desktop-sidebar')
  await expect(sidebar).toHaveAttribute('data-sidebar-content', 'settings')
  await expect(sidebar).toHaveAttribute('aria-label', '设置侧栏')
  const settingsSearch = page.getByRole('combobox', { name: '搜索设置' })
  await expect(settingsSearch).toBeVisible()
  const settingsNavigationRow = page.locator('.settings-nav-item:visible').first()
  const settingsGroupTitle = page.locator('.settings-nav-group-title:visible').first()
  await expect(settingsNavigationRow).toBeVisible()
  await expect(settingsGroupTitle).toHaveCSS('font-size', '14px')
  const sharedSidebarRowRadius = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.borderRadius = 'var(--cpx-sys-radius-lg)'
    document.body.append(probe)
    const radius = getComputedStyle(probe).borderRadius
    probe.remove()
    return radius
  })
  await expectCompactInteractiveRow(settingsNavigationRow, {
    borderRadius: sharedSidebarRowRadius,
    fontSize: '14px',
    height: 32,
    lineHeight: '20px',
    paddingInline: '8px',
  })
  expect(
    await sidebar.locator('svg').evaluateAll((elements) =>
      [
        ...new Set(
          elements.map((element) => {
            const style = getComputedStyle(element)
            return `${style.width}x${style.height}`
          }),
        ),
      ].sort(),
    ),
  ).toEqual(['14pxx14px'])
  await page.keyboard.press('Control+b')
  await expect(sidebar).toHaveClass(/is-collapsed/)
  await page.mouse.move(6, 400)
  await expect(sidebar).toHaveClass(/is-preview/)
  await expect(page.getByRole('combobox', { name: '搜索设置' })).toBeVisible()

  await page.mouse.move(600, 400)
  await expect(sidebar).toHaveClass(/is-collapsed/)
  await page.setViewportSize({ width: 720, height: 800 })
  await expect(sidebar).toHaveClass(/is-collapsed/)
  await page.mouse.move(6, 400)
  await expect(sidebar).toHaveClass(/is-preview/)
  await expect(page.locator('.sidebar-drawer-backdrop')).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: '搜索设置' })).toBeVisible()
})

test('task and settings sidebars share row grid columns', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto('/?visualCase=rich#/new')
  await closeTransientErrorToast(page)

  const sidebar = page.locator('aside.desktop-sidebar')
  const navRow = sidebar.locator('.sidebar-nav-link').first()
  const projectRow = sidebar.locator('.sidebar-project-header').first()
  const footerRow = sidebar.locator('.sidebar-settings-link')
  const taskRows = [navRow, projectRow, footerRow]
  const taskForeground = await navRow.evaluate((element) => getComputedStyle(element).color)
  const taskMainBoxes = await Promise.all(
    taskRows.map((row) => row.locator('.sidebar-row-main').boundingBox()),
  )
  const taskLeadingBoxes = await Promise.all(
    taskRows.map((row) => row.locator('.sidebar-row-leading').boundingBox()),
  )
  const taskRowBoxes = await Promise.all(taskRows.map((row) => row.boundingBox()))

  for (const box of [...taskMainBoxes, ...taskLeadingBoxes, ...taskRowBoxes]) {
    expect(box).not.toBeNull()
  }
  for (const box of taskMainBoxes.slice(1)) {
    expect(box!.x).toBeCloseTo(taskMainBoxes[0]!.x, 0)
  }
  for (const box of taskLeadingBoxes.slice(1)) {
    expect(box!.x + box!.width / 2).toBeCloseTo(
      taskLeadingBoxes[0]!.x + taskLeadingBoxes[0]!.width / 2,
      0,
    )
  }
  for (const box of taskRowBoxes.slice(1)) {
    expect(box!.x).toBeCloseTo(taskRowBoxes[0]!.x, 0)
  }

  const projectMainBeforeAction = await projectRow.locator('.sidebar-row-main').boundingBox()
  await projectRow.locator('.sidebar-project-button').focus()
  await expect(projectRow.locator('.sidebar-project-actions')).toBeVisible()
  const projectMainAfterAction = await projectRow.locator('.sidebar-row-main').boundingBox()
  expect(projectMainBeforeAction).not.toBeNull()
  expect(projectMainAfterAction).not.toBeNull()
  expect(projectMainAfterAction!.x).toBeCloseTo(projectMainBeforeAction!.x, 0)

  await page.goto('/?visualCase=rich#/settings/appearance')
  await closeTransientErrorToast(page)
  const settingsBackRow = page.locator('aside.desktop-sidebar .settings-back-btn')
  const settingsRow = page.locator('aside.desktop-sidebar .settings-nav-item:visible').first()
  const activeSettingsRow = page.locator('aside.desktop-sidebar .settings-nav-item.active:visible')
  const [settingsRowBox, settingsLeadingBox, settingsMainBox] = await Promise.all([
    settingsRow.boundingBox(),
    settingsRow.locator('.sidebar-row-leading').boundingBox(),
    settingsRow.locator('.sidebar-row-main').boundingBox(),
  ])
  expect(settingsRowBox).not.toBeNull()
  expect(settingsLeadingBox).not.toBeNull()
  expect(settingsMainBox).not.toBeNull()
  expect(settingsRowBox!.x).toBeCloseTo(taskRowBoxes[0]!.x, 0)
  expect(settingsLeadingBox!.x + settingsLeadingBox!.width / 2).toBeCloseTo(
    taskLeadingBoxes[0]!.x + taskLeadingBoxes[0]!.width / 2,
    0,
  )
  expect(settingsMainBox!.x).toBeCloseTo(taskMainBoxes[0]!.x, 0)

  for (const row of [settingsBackRow, settingsRow, activeSettingsRow]) {
    const foregrounds = await row.evaluate((element) => {
      const leading = element.querySelector<HTMLElement>('.sidebar-item-icon')
      const main = element.querySelector<HTMLElement>('.sidebar-row-main')
      return {
        leading: leading ? getComputedStyle(leading).color : null,
        main: main ? getComputedStyle(main).color : null,
        row: getComputedStyle(element).color,
      }
    })
    expect(foregrounds).toEqual({
      leading: taskForeground,
      main: taskForeground,
      row: taskForeground,
    })
  }

  const settingsForegroundBeforeHover = await settingsRow.evaluate(
    (element) => getComputedStyle(element).color,
  )
  const settingsHoverBackground = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.background = 'var(--cpx-sys-color-hover)'
    document.body.append(probe)
    const background = getComputedStyle(probe).backgroundColor
    probe.remove()
    return background
  })
  await settingsRow.hover()
  await expect(settingsRow).toHaveCSS('color', settingsForegroundBeforeHover)
  await expect(settingsRow).toHaveCSS('background-color', settingsHoverBackground)
})

for (const mode of MODES) {
  test(`settings dropdown follows the compact row contract in ${mode} mode`, async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 })
    await page.emulateMedia({
      colorScheme: mode,
      forcedColors: 'none',
      reducedMotion: 'reduce',
    })
    await page.goto('/?visualCase=empty#/settings/general')
    await closeTransientErrorToast(page)

    await expectCompactInteractiveRow(page.getByRole('combobox', { name: '默认打开目标' }), {
      borderRadius: '8px',
      fontSize: '14px',
      height: 28,
      lineHeight: '18px',
      paddingInline: '8px',
    })

    await page.getByRole('button', { name: '语言' }).click()
    const surface = page.locator('.settings-dropdown-content--searchable')
    await expect(surface).toBeVisible()
    const surfaceContract = await surface.evaluate((element) => {
      const style = getComputedStyle(element)
      const item = element.querySelector<HTMLElement>('.settings-dropdown-item')
      const itemStyle = item ? getComputedStyle(item) : null
      return {
        backdropFilter: style.backdropFilter,
        borderRadius: style.borderRadius,
        borderTopWidth: style.borderTopWidth,
        boxShadow: style.boxShadow,
        itemBorderRadius: itemStyle?.borderRadius,
        itemFontSize: itemStyle?.fontSize,
        itemHeight: item?.getBoundingClientRect().height,
        itemLineHeight: itemStyle?.lineHeight,
        itemPaddingBlock: itemStyle?.paddingBlock,
        itemPaddingInline: itemStyle?.paddingInline,
        padding: style.padding,
      }
    })
    expect(surfaceContract.itemHeight).toBeCloseTo(32, 0)
    expect({
      backdropFilter: surfaceContract.backdropFilter,
      borderRadius: surfaceContract.borderRadius,
      borderTopWidth: surfaceContract.borderTopWidth,
      itemBorderRadius: surfaceContract.itemBorderRadius,
      itemFontSize: surfaceContract.itemFontSize,
      itemLineHeight: surfaceContract.itemLineHeight,
      itemPaddingBlock: surfaceContract.itemPaddingBlock,
      itemPaddingInline: surfaceContract.itemPaddingInline,
      padding: surfaceContract.padding,
    }).toEqual({
      backdropFilter: 'none',
      borderRadius: '16px',
      borderTopWidth: '1px',
      itemBorderRadius: '8px',
      itemFontSize: '14px',
      itemLineHeight: '20px',
      itemPaddingBlock: '5px',
      itemPaddingInline: '8px',
      padding: '4px',
    })
    expect(surfaceContract.boxShadow).not.toBe('none')
  })
}

test('sidebar trigger does not reopen the preview until the pointer leaves', async ({ page }) => {
  await page.goto('/?visualCase=rich#/new')
  await closeTransientErrorToast(page)
  const sidebar = page.locator('aside.desktop-sidebar')
  const sidebarTrigger = page.locator('[data-app-shell-sidebar-trigger]')

  await sidebarTrigger.hover()
  await sidebarTrigger.click()
  await expect(sidebar).toHaveClass(/is-collapsed/)
  await page.waitForTimeout(150)
  await expect(sidebar).toHaveClass(/is-collapsed/)

  await page.mouse.move(6, 400)
  await expect(sidebar).toHaveClass(/is-preview/, { timeout: 1_000 })
  await expect(sidebar).toHaveCSS('border-right-width', '1px')
  await expect(sidebar).not.toHaveCSS('box-shadow', 'none')
  await expect
    .poll(() =>
      page.evaluate(() => document.elementFromPoint(80, 60)?.closest('.desktop-sidebar') !== null),
    )
    .toBe(true)
})

test('Escape closes the theme picker and restores focus', async ({ page }) => {
  await page.goto('/?visualCase=empty#/settings/appearance')
  await closeTransientErrorToast(page)
  const picker = page.getByRole('combobox', { name: '浅色代码主题' })
  await picker.click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await expect(page.getByRole('combobox', { name: '搜索代码主题…' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(picker).toBeFocused()
})

test('appearance modes support radio keys, variant editors, and reload persistence', async ({
  page,
}) => {
  await page.goto('/?visualCase=empty#/settings/appearance')
  await closeTransientErrorToast(page)

  const modeGroup = page.getByRole('radiogroup', { name: '外观模式' })
  const lightMode = modeGroup.getByRole('radio', { name: '浅色' })
  const darkMode = modeGroup.getByRole('radio', { name: '深色' })
  const systemMode = modeGroup.getByRole('radio', { name: '系统' })

  await expect(systemMode).toBeChecked()
  await expect(page.getByRole('heading', { name: '浅色主题' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '深色主题' })).toBeVisible()

  await lightMode.click()
  await expect(lightMode).toBeChecked()
  await expect(page.getByRole('heading', { name: '浅色主题' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '深色主题' })).toBeHidden()

  await lightMode.press('ArrowRight')
  await expect(darkMode).toBeFocused()
  await expect(darkMode).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await page.reload()
  await expect(
    page.getByRole('radiogroup', { name: '外观模式' }).getByRole('radio', {
      name: '深色',
    }),
  ).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('Dracula code theme applies the recovered Codex runtime hierarchy', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.goto('/?visualCase=empty#/settings/appearance')
  await closeTransientErrorToast(page)
  await page
    .getByRole('radiogroup', { name: '外观模式' })
    .getByRole('radio', { name: '深色' })
    .click()

  await page.getByRole('combobox', { name: '深色代码主题' }).click()
  await page.getByRole('option', { name: /^Dracula/ }).click()

  await expect(page.locator('html')).toHaveAttribute('data-code-theme-id', 'dracula')
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = getComputedStyle(document.documentElement)
        return {
          canvas: root.getPropertyValue('--color-token-main-surface-primary').trim(),
          chrome: root.getPropertyValue('--color-token-side-bar-background').trim(),
          panel: root.getPropertyValue('--color-token-panel-background').trim(),
          composer: root.getPropertyValue('--color-token-elevated-background').trim(),
        }
      }),
    )
    .toEqual({
      canvas: '#282a36',
      chrome: '#22232d',
      panel: '#32343f',
      composer: '#373843',
    })
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pidex.desktop.appearance.v8')))
    .toContain('"dracula"')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-code-theme-id', 'dracula')
  await page.goto('/?visualCase=rich#/threads/visual-rich')
  await expect(page.getByText('已完成工作台结构梳理。', { exact: true })).toBeVisible()
  await closeTransientErrorToast(page, 1_500)
  await expect(page.locator('body')).toHaveScreenshot('desktop-dark-dracula-runtime.png', {
    animations: 'disabled',
    caret: 'hide',
    mask: [page.locator('.thread-summary-panel')],
    scale: 'css',
  })

  await gotoWorkbenchFixture(page, '/?visualCase=review#/threads/visual-review')
  await expect(page.locator('html')).toHaveAttribute('data-code-theme-id', 'dracula')
  await page.getByRole('button', { name: '显示右侧面板' }).click()
  const rightPanel = page.getByRole('complementary', { name: '右侧面板' })
  await rightPanel.getByRole('button', { name: /^审阅/ }).click()
  const sourceMenu = await openAndAssertReviewSourceMenu(page, rightPanel)
  await expect(sourceMenu).toHaveScreenshot('desktop-dark-review-source-menu.png', {
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  })
  await page.keyboard.press('Escape')
  await expect(
    rightPanel
      .getByLabel('apps/desktop/renderer/test/CodexStyleContracts.test.ts diff')
      .locator('[data-review-syntax-state="ready"]'),
  ).toBeVisible({ timeout: 10_000 })
  await expect.poll(async () => rightPanel.locator('.review-diff-word').count()).toBeGreaterThan(0)
  const syntaxColors = await rightPanel
    .locator('.review-codex-diff__line-text span[style*="color"]')
    .evaluateAll((nodes) => Array.from(new Set(nodes.map((node) => getComputedStyle(node).color))))
  expect(syntaxColors.length).toBeGreaterThanOrEqual(3)
  const draculaDiffColors = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement)
    return {
      added: styles.getPropertyValue('--color-decoration-added').trim(),
      addedLine: styles.getPropertyValue('--color-diff-added-line-background').trim(),
      removed: styles.getPropertyValue('--color-decoration-deleted').trim(),
      removedLine: styles.getPropertyValue('--color-diff-removed-line-background').trim(),
    }
  })
  expect(draculaDiffColors).toEqual({
    added: '#50fa7b',
    addedLine: '#3c5b4d',
    removed: '#ff5555',
    removedLine: '#5b3d46',
  })
  await waitForMaterialIcons(rightPanel)
  await expect(rightPanel).toHaveScreenshot('desktop-dark-dracula-review.png', {
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  })
})

test('settings shell search and appearance source contracts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.goto('/?visualCase=empty#/settings/general')
  await closeTransientErrorToast(page)

  const defaultOpenTarget = page.getByRole('combobox', {
    name: '默认打开目标',
  })
  await expect(
    defaultOpenTarget.evaluate((trigger) => {
      const style = getComputedStyle(trigger)
      const bounds = trigger.getBoundingClientRect()
      const probe = document.createElement('span')
      probe.style.color = 'var(--color-text-strong)'
      document.body.append(probe)
      const expectedForeground = getComputedStyle(probe).color
      probe.remove()
      return {
        backgroundIsTransparent: style.backgroundColor === 'rgba(0, 0, 0, 0)',
        borderRadius: style.borderRadius,
        colorMatchesForeground: style.color === expectedForeground,
        fontSize: style.fontSize,
        height: bounds.height,
        lineHeight: style.lineHeight,
        paddingInline: style.paddingInline,
      }
    }),
  ).resolves.toEqual({
    backgroundIsTransparent: true,
    borderRadius: '8px',
    colorMatchesForeground: true,
    fontSize: '14px',
    height: 28,
    lineHeight: '18px',
    paddingInline: '8px',
  })

  const languageDropdown = page.getByRole('button', { name: '语言' })
  await languageDropdown.click()
  const languageMenu = page.getByRole('listbox')
  const languageSurface = page.locator('.settings-dropdown-content--searchable')
  await expect(languageMenu).toBeVisible()
  await expect(languageSurface).toBeVisible()
  const languageSurfaceStyles = await languageSurface.evaluate((surface) => {
    const style = getComputedStyle(surface)
    const firstItem = surface.querySelector<HTMLElement>('.settings-dropdown-item')
    const firstItemStyle = firstItem ? getComputedStyle(firstItem) : null
    return {
      backdropFilter: style.backdropFilter,
      borderRadius: style.borderRadius,
      itemFontSize: firstItemStyle?.fontSize,
      itemHeight: firstItem?.getBoundingClientRect().height,
      itemLineHeight: firstItemStyle?.lineHeight,
      padding: style.padding,
    }
  })
  expect(languageSurfaceStyles.itemHeight).toBeCloseTo(32, 0)
  expect({
    backdropFilter: languageSurfaceStyles.backdropFilter,
    borderRadius: languageSurfaceStyles.borderRadius,
    itemFontSize: languageSurfaceStyles.itemFontSize,
    itemLineHeight: languageSurfaceStyles.itemLineHeight,
    padding: languageSurfaceStyles.padding,
  }).toEqual({
    backdropFilter: 'none',
    borderRadius: '16px',
    itemFontSize: '14px',
    itemLineHeight: '20px',
    padding: '4px',
  })
  await expect(page.getByRole('combobox', { name: '搜索语言' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.goto('/?visualCase=empty#/settings/config')
  const configSourceToolbar = page.locator('.config-settings-source-toolbar')
  const profileDropdown = page.getByRole('combobox', { name: '活动 Profile' })
  const configLayerDropdown = page.getByRole('combobox', { name: '配置层' })
  const openConfigButton = page.getByRole('button', { name: '打开配置文件' })
  await expect(configSourceToolbar).toBeVisible()
  await expect(profileDropdown).toBeVisible()
  await expect(configLayerDropdown).toBeVisible()
  await expect(openConfigButton).toBeVisible()
  const [configLayerBounds, openConfigBounds] = await Promise.all([
    configLayerDropdown.boundingBox(),
    openConfigButton.boundingBox(),
  ])
  expect(configLayerBounds).not.toBeNull()
  expect(openConfigBounds).not.toBeNull()
  expect(openConfigBounds!.x).toBeGreaterThan(configLayerBounds!.x + configLayerBounds!.width)
  expect(
    Math.abs(
      configLayerBounds!.y +
        configLayerBounds!.height / 2 -
        (openConfigBounds!.y + openConfigBounds!.height / 2),
    ),
  ).toBeLessThan(1)

  const agentDefaultsHeading = page.getByRole('heading', {
    exact: true,
    name: '智能体默认设置',
  })
  await expect(agentDefaultsHeading).toHaveCount(1)
  const agentDefaultsSection = agentDefaultsHeading.locator('xpath=ancestor::section[1]')
  await expect(
    page.getByRole('heading', {
      exact: true,
      name: '自定义 config.json 设置',
    }),
  ).toHaveCount(0)
  await expect(agentDefaultsSection.locator('.config-settings-source-toolbar')).toHaveCount(1)
  await expect(
    agentDefaultsSection
      .locator('.settings-row-title')
      .evaluateAll((titles) => titles.slice(0, 5).map((title) => title.textContent?.trim())),
  ).resolves.toEqual(['权限预设', '工具权限范围', 'Shell 安全级别', '审批时机', '审批执行者'])
  await expect(page.getByRole('heading', { exact: true, name: '批准策略' })).toHaveCount(0)

  const diagnosticsSection = page
    .getByRole('heading', { exact: true, name: '诊断' })
    .locator('xpath=ancestor::section[1]')
  await expect(
    diagnosticsSection.getByRole('heading', {
      exact: true,
      name: '完整提示词诊断',
    }),
  ).toBeVisible()
  await expect(diagnosticsSection.getByRole('button', { name: '预览当前任务提示词' })).toBeVisible()

  const permissionScopeDropdown = page.getByRole('combobox', { name: '工具权限范围' })
  await permissionScopeDropdown.click()
  const permissionScopeMenu = page.getByRole('listbox')
  await expect(permissionScopeMenu).toBeVisible()
  await expect(
    permissionScopeMenu.evaluate((menu) => {
      const item = menu.querySelector<HTMLElement>('.settings-dropdown-item')
      const label = item?.querySelector<HTMLElement>('.settings-dropdown-item-label')
      const detail = item?.querySelector<HTMLElement>('.settings-dropdown-item-detail')
      const foregroundProbe = document.createElement('span')
      foregroundProbe.style.color = 'var(--color-token-foreground)'
      const secondaryProbe = document.createElement('span')
      secondaryProbe.style.color = 'var(--color-token-description-foreground)'
      menu.append(foregroundProbe, secondaryProbe)
      const expectedForeground = getComputedStyle(foregroundProbe).color
      const expectedSecondary = getComputedStyle(secondaryProbe).color
      foregroundProbe.remove()
      secondaryProbe.remove()
      return {
        detailMatchesSecondary:
          detail !== null && getComputedStyle(detail).color === expectedSecondary,
        labelMatchesForeground:
          label !== null && getComputedStyle(label).color === expectedForeground,
      }
    }),
  ).resolves.toEqual({
    detailMatchesSecondary: true,
    labelMatchesForeground: true,
  })
  await page.keyboard.press('Escape')

  await page.setViewportSize({ width: 560, height: 900 })
  const [narrowConfigLayerBounds, narrowOpenConfigBounds] = await Promise.all([
    configLayerDropdown.boundingBox(),
    openConfigButton.boundingBox(),
  ])
  expect(narrowConfigLayerBounds).not.toBeNull()
  expect(narrowOpenConfigBounds).not.toBeNull()
  expect(narrowOpenConfigBounds!.y).toBeGreaterThanOrEqual(
    narrowConfigLayerBounds!.y + narrowConfigLayerBounds!.height,
  )

  await page.setViewportSize({ width: 1440, height: 920 })
  await page.goto('/?visualCase=empty#/settings/general')
  await closeTransientErrorToast(page)

  await expect(
    page.getByRole('button', { name: '导入' }).evaluate((button) => {
      const style = getComputedStyle(button)
      const bounds = button.getBoundingClientRect()
      const backgroundProbe = document.createElement('span')
      backgroundProbe.style.background = 'var(--color-token-button-background)'
      const borderProbe = document.createElement('span')
      borderProbe.style.borderColor = 'var(--color-token-button-border)'
      document.body.append(backgroundProbe, borderProbe)
      const expectedBackgroundColor = getComputedStyle(backgroundProbe).backgroundColor
      const expectedBorderColor = getComputedStyle(borderProbe).borderColor
      backgroundProbe.remove()
      borderProbe.remove()
      return {
        backgroundMatchesButtonToken: style.backgroundColor === expectedBackgroundColor,
        borderMatchesButtonToken: style.borderColor === expectedBorderColor,
        borderRadius: style.borderRadius,
        borderWidth: style.borderWidth,
        boxShadow: style.boxShadow,
        fontSize: style.fontSize,
        height: bounds.height,
        lineHeight: style.lineHeight,
        paddingInline: style.paddingInline,
      }
    }),
  ).resolves.toEqual({
    backgroundMatchesButtonToken: true,
    borderMatchesButtonToken: true,
    borderRadius: '8px',
    borderWidth: '1px',
    boxShadow: 'none',
    fontSize: '14px',
    height: 28,
    lineHeight: '19.6px',
    paddingInline: '9.8px',
  })

  await page.keyboard.press('Control+F')
  await page.keyboard.up('Control')
  const search = page.getByRole('combobox', { name: '搜索设置' })
  await expect(search).toBeFocused()
  await search.evaluate((element, value) => {
    const input = element as HTMLInputElement
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: value,
        inputType: 'insertText',
      }),
    )
  }, '对比度')
  await expect(search).toHaveValue('对比度')
  await expect(search).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('option', { name: /对比度.*外观/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/settings\/appearance$/)
  await expect(page.getByRole('heading', { name: '外观' })).toBeVisible()

  const modeGroup = page.getByRole('radiogroup', { name: '外观模式' })
  await expect(modeGroup.getByRole('radio')).toHaveCount(3)
  await expect(
    modeGroup
      .getByRole('radio')
      .evaluateAll((radios) => radios.map((radio) => radio.parentElement?.textContent?.trim())),
  ).resolves.toEqual(['系统', '浅色', '深色'])
  await expect(modeGroup.locator('svg[viewBox="0 0 170 120"]')).toHaveCount(3)
  await expect(modeGroup.locator('#appearance-system-preview-sheet')).toHaveCount(1)

  const preview = page.locator('.appearance-diff-preview')
  const advancedTrigger = page.getByRole('button', { name: '高级', exact: true })
  await expect(advancedTrigger).toHaveAttribute('aria-expanded', 'false')
  await expect(
    page.locator('.appearance-settings > .settings-section > .ui-disclosure-content'),
  ).toHaveAttribute('aria-hidden', 'true')
  await advancedTrigger.click()
  const previewDiff = preview.locator('.review-codex-diff[data-diff-type="split"]')
  await expect(previewDiff).toHaveCount(1)
  await expect(previewDiff).toHaveAttribute('data-overflow', 'scroll')
  await expect(previewDiff).toHaveAttribute('data-indicators', 'bars')
  await expect(previewDiff).toHaveAttribute('aria-label', '浅色主题差异代码')
  await expect(previewDiff).toHaveAttribute('data-review-syntax-state', 'ready', {
    timeout: 10_000,
  })
  await expect(previewDiff.locator('[data-deletions]')).toHaveCount(1)
  await expect(previewDiff.locator('[data-additions]')).toHaveCount(1)
  await expect(previewDiff.locator('.review-line-comment-button')).toHaveCount(0)
  await expect(previewDiff.locator('.review-line-comments')).toHaveCount(0)
  await expect(previewDiff.locator('.review-hunk-actions')).toHaveCount(0)
  await expect(
    previewDiff.locator('.review-codex-diff__hunk[data-separator="line-info"]'),
  ).not.toHaveCount(0)
  await expect(previewDiff.locator('[data-line-type="buffer"]')).not.toHaveCount(0)
  await expect(previewDiff.locator('.review-diff-word')).not.toHaveCount(0)
  await expect
    .poll(() =>
      previewDiff
        .locator(
          '.review-codex-diff__line[data-line-type^="change-"] ' +
            '.review-codex-diff__line-text span[style*="color"]',
        )
        .count(),
    )
    .toBeGreaterThan(0)

  const structure = await page.evaluate(() => {
    const gallery = document.querySelector('.appearance-mode-gallery')!
    const diff = document.querySelector('.appearance-diff-preview')!
    const editors = document.querySelector('.appearance-theme-editors')!
    const fontsCard = document.querySelector('.appearance-font-preview')!.parentElement!
    const inner = document.querySelector('.appearance-settings')!
    const card = document.querySelector('.appearance-mode-visual')!
    const galleryStyle = getComputedStyle(gallery)
    const innerStyle = getComputedStyle(inner)
    const cardStyle = getComputedStyle(card)
    const cardBounds = card.getBoundingClientRect()
    return {
      diffAfterGallery: Boolean(
        gallery.compareDocumentPosition(diff) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      diffAfterEditors: Boolean(
        editors.compareDocumentPosition(diff) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      diffInsideModeCard: diff.parentElement === fontsCard,
      galleryMaxWidth: galleryStyle.maxWidth,
      innerMaxWidth: innerStyle.maxWidth,
      innerPadding: innerStyle.paddingTop,
      cardRadius: cardStyle.borderRadius,
      cardRatio: cardBounds.width / cardBounds.height,
    }
  })
  expect(structure).toMatchObject({
    diffAfterGallery: true,
    diffAfterEditors: true,
    diffInsideModeCard: true,
    galleryMaxWidth: '100%',
    innerMaxWidth: '1049px',
    innerPadding: '20px',
    cardRadius: '12px',
  })
  expect(structure.cardRatio).toBeCloseTo(4 / 3, 2)

  await modeGroup.getByRole('radio', { name: '浅色' }).click()
  await expect(page.locator('.appearance-theme-editor[data-section="visual"]')).toHaveCount(1)
  await expect(
    page
      .locator('.appearance-theme-editor[data-section="visual"]')
      .first()
      .locator('.settings-row-title')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim())),
  ).resolves.toEqual(['浅色主题', '强调色', '背景', '前景'])
  await expect(
    page
      .locator('.appearance-theme-editor[data-section="advanced"] .settings-row-title')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim())),
  ).resolves.toEqual(['浅色主题', '对比度'])
  const lightPicker = page.getByRole('combobox', { name: '浅色代码主题' })
  await expect(page.getByRole('button', { name: '导入' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '复制主题' })).toHaveCount(0)
  await expect(page.getByRole('switch', { name: /半透明/ })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: /半透明/ })).toHaveCount(0)
  await lightPicker.click()
  await expect(page.getByRole('option')).toHaveCount(16)
  await expect(page.getByRole('combobox', { name: '搜索代码主题…' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  const accentInput = page.getByRole('textbox', { name: '浅色强调色' })
  await accentInput.fill('#12abef')
  await expect(accentInput).toHaveValue('#12ABEF')
  await page.getByRole('button', { name: '浅色强调色颜色选择器' }).click()
  await expect(page.locator('.appearance-color-palette')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByPlaceholder('ui-sans-serif, system-ui, sans-serif')).toBeVisible()
  await expect(
    page.getByPlaceholder('ui-monospace, SFMono-Regular, Consolas, monospace'),
  ).toBeVisible()

  await modeGroup.getByRole('radio', { name: '系统' }).click()
  await expect(page.locator('.appearance-theme-editor[data-section="visual"]')).toHaveCount(2)
  await expect(page.locator('.appearance-theme-editor[data-section="advanced"]')).toHaveCount(2)
  await expect(
    page
      .locator('.appearance-advanced-content > .settings-card')
      .last()
      .locator('.settings-row-title')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim())),
  ).resolves.toEqual(['减少动态效果', '使用指针光标', '差异标记'])

  const diffMarkerGroup = page.getByRole('radiogroup', { name: '差异标记选项' })
  const reduceMotionGroup = page.getByRole('radiogroup', {
    name: '减少动态效果选项',
  })
  await expect(diffMarkerGroup.getByRole('button')).toHaveCount(2)
  await expect(reduceMotionGroup.getByRole('button')).toHaveCount(3)
  await expect(page.getByRole('tablist')).toHaveCount(0)
  await expect(page.getByRole('tab')).toHaveCount(0)

  const groupChrome = await diffMarkerGroup.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      backgroundColor: style.backgroundColor,
      borderTopWidth: style.borderTopWidth,
      paddingTop: style.paddingTop,
    }
  })
  expect(groupChrome).toMatchObject({
    borderTopWidth: '0px',
    paddingTop: '0px',
  })
  expect(groupChrome.backgroundColor).toBe('rgba(0, 0, 0, 0)')

  const symbolButton = diffMarkerGroup.getByRole('button', { name: '+/-' })
  const colorButton = diffMarkerGroup.getByRole('button', { name: '颜色' })
  const motionOffButton = reduceMotionGroup.getByRole('button', {
    name: '关闭',
  })
  await symbolButton.click()
  await motionOffButton.click()
  await expect(symbolButton).toHaveAttribute('data-state', 'on')
  await expect(previewDiff).toHaveAttribute('data-indicators', 'classic')
  await expect(motionOffButton).toHaveAttribute('data-state', 'on')
  await expect(
    motionOffButton.evaluate((button) => {
      const style = getComputedStyle(button)
      return {
        borderRadius: style.borderRadius,
        fontSize: style.fontSize,
        height: button.getBoundingClientRect().height,
        lineHeight: style.lineHeight,
        paddingBlock: style.paddingBlock,
        paddingInline: style.paddingInline,
      }
    }),
  ).resolves.toEqual({
    borderRadius: '8px',
    fontSize: '13px',
    height: 24,
    lineHeight: '18px',
    paddingBlock: '2px',
    paddingInline: '8px',
  })
  const pointerSwitch = page.getByRole('switch', { name: '使用指针光标' })
  await pointerSwitch.click()
  await expect(pointerSwitch).toBeChecked()
  await expect(
    pointerSwitch.evaluate((switchElement) => {
      const thumb = switchElement.querySelector<HTMLElement>('.toggle-knob')!
      const switchBounds = switchElement.getBoundingClientRect()
      const thumbBounds = thumb.getBoundingClientRect()
      const thumbColorProbe = document.createElement('span')
      thumbColorProbe.style.color = 'white'
      document.body.append(thumbColorProbe)
      const thumbColor = getComputedStyle(thumbColorProbe).color
      thumbColorProbe.remove()
      return {
        switchSize: [switchBounds.width, switchBounds.height],
        thumbSize: [thumbBounds.width, thumbBounds.height],
        thumbUsesWhite: getComputedStyle(thumb).backgroundColor === thumbColor,
      }
    }),
  ).resolves.toMatchObject({
    switchSize: [32, 20],
    thumbSize: [16, 16],
    thumbUsesWhite: true,
  })
  await colorButton.click()
  await expect(colorButton).toHaveAttribute('data-state', 'on')
  await expect(previewDiff).toHaveAttribute('data-indicators', 'bars')

  const uiFontSizeInput = page.getByRole('spinbutton', { name: '界面字号' })
  await expect(
    uiFontSizeInput.evaluate((input) => {
      const style = getComputedStyle(input)
      const bounds = input.getBoundingClientRect()
      const unit = input.parentElement?.querySelector('span')
      const unitStyle = unit ? getComputedStyle(unit) : null
      const probe = document.createElement('span')
      probe.style.background = 'var(--color-token-input-background)'
      probe.style.color = 'var(--color-token-text-secondary)'
      document.body.append(probe)
      const probeStyle = getComputedStyle(probe)
      const matches = {
        background: style.backgroundColor === probeStyle.backgroundColor,
        unitColor: unitStyle?.color === probeStyle.color,
      }
      probe.remove()
      return {
        ...matches,
        borderRadius: style.borderRadius,
        fontSize: style.fontSize,
        gap: getComputedStyle(input.parentElement!).gap,
        height: bounds.height,
        lineHeight: style.lineHeight,
        textAlign: style.textAlign,
        width: bounds.width,
      }
    }),
  ).resolves.toEqual({
    background: true,
    borderRadius: '8px',
    fontSize: '12px',
    gap: '8px',
    height: 28,
    lineHeight: '18px',
    textAlign: 'right',
    unitColor: true,
    width: 64,
  })

  await page.reload()
  await closeTransientErrorToast(page)
  await page.getByRole('button', { name: '高级', exact: true }).click()
  await expect(
    page
      .getByRole('radiogroup', { name: '减少动态效果选项' })
      .getByRole('button', { name: '关闭' }),
  ).toHaveAttribute('data-state', 'on')
})

test('appearance color controls match the integrated Codex geometry', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.goto('/?visualCase=rich#/settings/appearance')
  await closeTransientErrorToast(page)

  const modeGroup = page.getByRole('radiogroup', { name: '外观模式' })
  for (const variantLabel of ['浅色', '深色'] as const) {
    await modeGroup.getByRole('radio', { name: variantLabel }).click()
    const colorInputs = page.locator('.appearance-color-input')
    await expect(colorInputs).toHaveCount(3)
    const colorControlContracts = await colorInputs.evaluateAll((inputs) =>
      inputs.map((input) => {
        const control = input.closest<HTMLElement>('.appearance-color-control')!
        const swatch = control.querySelector<HTMLElement>('.appearance-color-swatch')!
        const controlBounds = control.getBoundingClientRect()
        const inputStyle = getComputedStyle(input)
        const controlStyle = getComputedStyle(control)
        const swatchBounds = swatch.getBoundingClientRect()
        return {
          controlHeight: controlBounds.height,
          controlMaxWidth: controlStyle.maxWidth,
          controlWidth: controlBounds.width,
          inputBackground: inputStyle.backgroundColor,
          inputColorMatchesControl: inputStyle.color === controlStyle.color,
          inputOpacity: inputStyle.opacity,
          swatchHeight: swatchBounds.height,
          swatchWidth: swatchBounds.width,
        }
      }),
    )
    expect(colorControlContracts).toEqual(
      Array.from({ length: 3 }, () => ({
        controlHeight: 28,
        controlMaxWidth: '136px',
        controlWidth: 136,
        inputBackground: 'rgba(0, 0, 0, 0)',
        inputColorMatchesControl: true,
        inputOpacity: '1',
        swatchHeight: 14,
        swatchWidth: 14,
      })),
    )

    const accentInput = page.getByRole('textbox', {
      name: `${variantLabel}强调色`,
    })
    await accentInput.fill('#12abef')
    await expect(accentInput).toHaveValue('#12ABEF')
    await page
      .getByRole('button', {
        name: `${variantLabel}强调色颜色选择器`,
      })
      .click()
    await expect(page.locator('.appearance-color-palette')).toBeVisible()
    await page.keyboard.press('Escape')
  }
})

for (const mode of MODES) {
  test(`appearance ${mode} diff preview matches the canonical review surface`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 920 })
    await page.emulateMedia({
      colorScheme: mode,
      forcedColors: 'none',
      reducedMotion: 'reduce',
    })
    await page.goto('/?visualCase=empty#/settings/appearance')
    await closeTransientErrorToast(page)

    const variantLabel = mode === 'light' ? '浅色' : '深色'
    await page
      .getByRole('radiogroup', { name: '外观模式' })
      .getByRole('radio', { name: variantLabel })
      .click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = localStorage.getItem('pidex.desktop.appearance.v8')
          return raw ? JSON.parse(raw).mode : null
        }),
      )
      .toBe(mode)

    await page.getByRole('button', { name: '高级', exact: true }).click()
    const previewDiff = page
      .getByLabel(`${variantLabel}主题差异预览`)
      .locator('.review-codex-diff[data-diff-type="split"]')
    await expect(previewDiff).toHaveAttribute('data-review-syntax-state', 'ready', {
      timeout: 10_000,
    })
    await expect(previewDiff.locator('.review-diff-word')).not.toHaveCount(0)
    const previewStyles = await readReviewDiffComputedStyles(previewDiff)

    await gotoWorkbenchFixture(page, '/?visualCase=review#/threads/visual-review')
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
    await page.getByRole('button', { name: '显示右侧面板' }).click()
    const rightPanel = page.getByRole('complementary', { name: '右侧面板' })
    await rightPanel.getByRole('button', { name: /^审阅/ }).click()
    const reviewDiff = rightPanel
      .getByLabel('apps/desktop/renderer/test/CodexStyleContracts.test.ts diff')
      .locator('.review-codex-diff:not(.review-codex-diff--virtual)')
    await expect(reviewDiff).toHaveAttribute('data-review-syntax-state', 'ready', {
      timeout: 10_000,
    })
    await expect(reviewDiff.locator('.review-diff-word')).not.toHaveCount(0)

    await expect(readReviewDiffComputedStyles(reviewDiff)).resolves.toEqual(previewStyles)
  })
}

async function closeTransientErrorToast(page: Page, waitForMilliseconds = 0): Promise<void> {
  const closeButton = page.getByRole('button', { name: '关闭错误提示' })
  const deadline = Date.now() + waitForMilliseconds
  do {
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click().catch(() => undefined)
    }
    if (Date.now() >= deadline) return
    await page.waitForTimeout(100)
  } while (true)
}

async function gotoWorkbenchFixture(page: Page, route: string): Promise<void> {
  const ready = page.getByText('已完成工作台结构梳理。', { exact: true })
  const maximumAttempts = 5
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    await page.goto(route)
    try {
      await ready.waitFor({ state: 'visible', timeout: 7_500 })
      return
    } catch {
      if (attempt === maximumAttempts - 1) {
        await expect(ready).toBeVisible()
        return
      }
      await page.waitForTimeout(750)
    }
  }
}

async function waitForMaterialIcons(root: Page | Locator) {
  await expect.poll(() => root.locator('[data-material-icon-ready="false"]').count()).toBe(0)
}

async function openAndAssertReviewSourceMenu(page: Page, rightPanel: Locator): Promise<Locator> {
  const trigger = rightPanel.getByRole('button', { name: '切换变更范围' })
  await expectCompactInteractiveRow(trigger, {
    borderRadius: '8px',
    fontSize: '14px',
    height: 28,
    lineHeight: '18px',
    paddingInline: '8px',
  })
  await trigger.click()
  const menu = page.locator('.popover-review-scope')
  await expect(menu).toBeVisible()
  await expect
    .poll(() =>
      trigger.evaluate((element) => {
        const probe = document.createElement('span')
        probe.style.background = 'var(--color-token-list-hover-background)'
        element.append(probe)
        const expected = getComputedStyle(probe).backgroundColor
        probe.remove()
        return getComputedStyle(element).backgroundColor === expected
      }),
    )
    .toBe(true)
  await expect(menu.getByText('未提交', { exact: true })).toBeVisible()
  await expect(menu.locator('.review-source-menu-separator')).toHaveCount(2)
  expect(await menu.locator('[role="menuitem"], [role="menuitemradio"]').allTextContents()).toEqual(
    ['上一轮', '未暂存', '已暂存', '提交', '分支'],
  )
  const menuRows = menu.locator('.popover-item:visible, .popover-sub-trigger:visible')
  const menuRowStyles = await menuRows.evaluateAll((rows) =>
    rows.map((row) => {
      const style = getComputedStyle(row)
      return {
        borderRadius: style.borderRadius,
        fontSize: style.fontSize,
        height: row.getBoundingClientRect().height,
        lineHeight: style.lineHeight,
        paddingBlock: style.paddingBlock,
        paddingInline: style.paddingInline,
      }
    }),
  )
  expect(menuRowStyles.length).toBeGreaterThanOrEqual(4)
  expect(
    menuRowStyles.every(
      (row) =>
        row.borderRadius === '8px' &&
        row.fontSize === '14px' &&
        row.lineHeight === '20px' &&
        row.paddingBlock === '5px' &&
        row.paddingInline === '8px',
    ),
  ).toBe(true)
  expect(menuRowStyles.every((row) => Math.abs(row.height - 32) < 0.5)).toBe(true)
  return menu
}

async function expectCompactInteractiveRow(
  row: Locator,
  expected: {
    borderRadius: string
    fontSize: string
    height: number
    lineHeight: string
    paddingInline: string
  },
): Promise<void> {
  const actual = await row.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      borderRadius: style.borderRadius,
      fontSize: style.fontSize,
      height: element.getBoundingClientRect().height,
      lineHeight: style.lineHeight,
      paddingInline: style.paddingInline,
    }
  })
  expect(actual.height).toBeCloseTo(expected.height, 0)
  expect({
    borderRadius: actual.borderRadius,
    fontSize: actual.fontSize,
    lineHeight: actual.lineHeight,
    paddingInline: actual.paddingInline,
  }).toEqual({
    borderRadius: expected.borderRadius,
    fontSize: expected.fontSize,
    lineHeight: expected.lineHeight,
    paddingInline: expected.paddingInline,
  })
}

async function expectHoverBackground(row: Locator): Promise<void> {
  const expected = await row.evaluate((element) => {
    const probe = document.createElement('span')
    probe.style.background = 'var(--color-token-list-hover-background)'
    element.append(probe)
    const background = getComputedStyle(probe).backgroundColor
    probe.remove()
    return background
  })
  const before = await row.evaluate((element) => getComputedStyle(element).backgroundColor)
  await row.hover()
  await expect
    .poll(() => row.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe(expected)
  expect(expected).not.toBe(before)
}

async function expectSelectedBackgroundOnHover(row: Locator): Promise<void> {
  const expected = await row.evaluate((element) => {
    const probe = document.createElement('span')
    probe.style.background = 'var(--state-selected-fill)'
    element.append(probe)
    const background = getComputedStyle(probe).backgroundColor
    probe.remove()
    return background
  })
  await expect(row).toHaveCSS('background-color', expected)
  await row.hover()
  await expect(row).toHaveCSS('background-color', expected)
}

async function readReviewDiffComputedStyles(diff: Locator) {
  return diff.evaluate((root) => {
    const requireElement = (selector: string): Element => {
      const element = root.querySelector(selector)
      if (!element) {
        throw new Error(`Missing canonical review diff element: ${selector}`)
      }
      return element
    }
    const readBackground = (selector: string): string =>
      getComputedStyle(requireElement(selector)).backgroundColor
    const readColor = (selector: string): string => getComputedStyle(requireElement(selector)).color
    const rootStyle = getComputedStyle(root)

    return {
      addedLineBackground: readBackground(
        '.review-codex-diff__line[data-line-type="change-addition"]',
      ),
      addedNumberColor: readColor('.review-codex-diff__number[data-line-type="change-addition"]'),
      addedWordBackground: readBackground('.review-diff-word[data-tone="added"]'),
      editorBackground: rootStyle.backgroundColor,
      editorForeground: rootStyle.color,
      fontFamily: rootStyle.fontFamily,
      fontSize: rootStyle.fontSize,
      lineHeight: rootStyle.lineHeight,
      removedLineBackground: readBackground(
        '.review-codex-diff__line[data-line-type="change-deletion"]',
      ),
      removedNumberColor: readColor('.review-codex-diff__number[data-line-type="change-deletion"]'),
      removedWordBackground: readBackground('.review-diff-word[data-tone="removed"]'),
    }
  })
}

test('execution plan popover is content-adaptive and never overflows', async ({ page }) => {
  const route = '/?visualCase=execution-plan#/threads/visual-execution-plan'
  await prepareVisualTheme(page, 'dark', { reduceMotion: 'off' })

  async function loadDesktop(): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 920 })
    await gotoWorkbenchFixture(page, route)
    await expect(page.locator('.composer-change-summary__plan')).toBeVisible()
  }

  await loadDesktop()

  const capsule = page.locator('.composer-change-summary__bar')
  const planTrigger = page.locator('.composer-change-summary__plan')
  const capsuleBefore = await capsule.boundingBox()
  expect(capsuleBefore).not.toBeNull()

  await planTrigger.hover()
  await expect(planTrigger).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(planTrigger).toHaveAttribute('aria-expanded', 'true')
  await planTrigger.focus()
  await expect(planTrigger).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  const planCard = page.locator('.composer-change-summary__plan-preview .execution-plan-card')
  await expect(planCard).toBeVisible()
  await expect(planCard).toHaveCSS('position', 'absolute')

  const cardBox = await planCard.boundingBox()
  expect(cardBox).not.toBeNull()
  expect(cardBox!.width).toBeGreaterThanOrEqual(480)
  expect(cardBox!.width).toBeLessThanOrEqual(760)
  expect(cardBox!.width).toBeGreaterThan(capsuleBefore!.width)

  // Capule metrics must not change while the popover is open.
  const capsuleAfter = await capsule.boundingBox()
  expect(capsuleAfter!.width).toBeCloseTo(capsuleBefore!.width, 0)
  expect(capsuleAfter!.x).toBeCloseTo(capsuleBefore!.x, 0)
  expect(capsuleAfter!.y).toBeCloseTo(capsuleBefore!.y, 0)

  // Long step text wraps instead of overflowing its row.
  const stepText = page
    .locator('.execution-plan-card__step-text')
    .filter({ hasText: '解耦' })
    .first()
  const wraps = await stepText.evaluate((element: HTMLElement) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    lineHeight: parseFloat(getComputedStyle(element).lineHeight),
  }))
  expect(wraps.scrollHeight).toBeLessThanOrEqual(wraps.clientHeight + 1)
  expect(wraps.clientHeight).toBeGreaterThan(wraps.lineHeight)

  // Steps list remains vertically scrollable.
  await expect(page.locator('.execution-plan-card__steps')).toHaveCSS('overflow-y', 'auto')

  // No horizontal page overflow with the popover open.
  const overflowing = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(overflowing.scrollWidth).toBeLessThanOrEqual(overflowing.clientWidth)

  // Narrow viewport: the popover shrinks to the available body width and stays
  // inside the session column.
  await page.setViewportSize({ width: 560, height: 760 })
  await expect.poll(() => capsule.boundingBox()).not.toBeNull()
  await expect(planCard).toBeVisible()
  const narrowCard = await planCard.boundingBox()
  expect(narrowCard).not.toBeNull()
  const narrowContent = await page
    .locator('.conversation-page, .quick-chat-content')
    .first()
    .boundingBox()
  expect(narrowContent).not.toBeNull()
  expect(narrowCard!.width).toBeGreaterThan(0)
  expect(narrowCard!.width).toBeLessThanOrEqual(narrowContent!.width)
  expect(narrowCard!.x).toBeGreaterThanOrEqual(narrowContent!.x - 1)
  expect(narrowCard!.x + narrowCard!.width).toBeLessThanOrEqual(
    narrowContent!.x + narrowContent!.width + 1,
  )

  const narrowOverflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(narrowOverflow.scrollWidth).toBeLessThanOrEqual(narrowOverflow.clientWidth)
})

/* ── Line-height governance scenarios ──────────────────────── */

test('conversation narrative content shares one reading rhythm at every UI font size', async ({
  page,
}) => {
  for (const uiFontSize of [11, 14, 16] as const) {
    await page.setViewportSize({ width: 1440, height: 920 })
    await prepareVisualTheme(page, 'dark', { uiFontSize })
    await gotoWorkbenchFixture(page, '/?visualCase=rich#/threads/visual-rich')
    await closeTransientErrorToast(page)

    const narrativeTypography = await page.evaluate(() => {
      const turn = document.querySelector<HTMLElement>('.canonical-turn')
      if (!turn) throw new Error('Missing canonical turn typography host')
      const host = document.createElement('div')
      const process = document.createElement('article')
      const processBody = document.createElement('div')
      const processParagraph = document.createElement('p')
      const result = document.createElement('article')
      const activity = document.createElement('div')
      const subagent = document.createElement('button')
      host.style.width = '360px'
      process.className = 'canonical-text-item canonical-text-item--process'
      processBody.className = 'md-body'
      processParagraph.textContent =
        'English process prose wraps with the same comfortable rhythm as 中文连续阅读文本。'
      processBody.append(processParagraph)
      process.append(processBody)
      result.className = 'canonical-text-item canonical-text-item--result'
      result.textContent = '最终回答'
      activity.className = 'cpx-agent-activity'
      activity.textContent = '读取文件、运行命令'
      subagent.className = 'canonical-subagent-card'
      subagent.textContent = '子代理任务'
      host.append(process, result, activity, subagent)
      turn.append(host)
      const probe = (element: HTMLElement) => {
        const style = getComputedStyle(element)
        return {
          fontSize: Number.parseFloat(style.fontSize),
          lineHeight: Number.parseFloat(style.lineHeight),
          overflows: element.scrollWidth > element.clientWidth + 1,
        }
      }
      const metrics = {
        process: probe(processParagraph),
        result: probe(result),
        activity: probe(activity),
        subagent: probe(subagent),
      }
      host.remove()
      return metrics
    })
    const readingDelta = uiFontSize - 14
    for (const narrative of Object.values(narrativeTypography)) {
      expect(narrative).toMatchObject({
        fontSize: 14 + readingDelta,
        lineHeight: 24 + readingDelta,
        overflows: false,
      })
    }
  }
})

test('scalable typography never clips and keeps chrome fixed at every UI font size', async ({
  page,
}) => {
  const buttonHeightsByFontSize = new Map<number, number[]>()

  for (const uiFontSize of [11, 14, 16] as const) {
    await page.setViewportSize({ width: 1440, height: 920 })
    await prepareVisualTheme(page, 'dark', { uiFontSize })
    await gotoWorkbenchFixture(page, '/?visualCase=rich#/threads/visual-rich')
    await closeTransientErrorToast(page)

    // Rename dialog: title and meta description scale with the UI font and
    // never clip inside their line boxes.
    await page.getByRole('button', { name: '更多会话操作' }).click()
    await page.getByRole('menuitem', { name: /重命名对话/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const dialogMetrics = await dialog.evaluate((element) => {
      const probe = (selector: string) => {
        const node = element.querySelector<HTMLElement>(selector)
        if (!node) return null
        const style = getComputedStyle(node)
        return {
          fontSize: Number.parseFloat(style.fontSize),
          lineHeight: Number.parseFloat(style.lineHeight),
          clipped: node.scrollHeight > node.clientHeight + 1,
        }
      }
      return {
        title: probe('h2'),
        description: probe('.confirmation-dialog-description'),
      }
    })
    expect(dialogMetrics.title).not.toBeNull()
    expect(dialogMetrics.description).not.toBeNull()
    for (const part of [dialogMetrics.title, dialogMetrics.description]) {
      expect(part!.lineHeight).toBeGreaterThanOrEqual(part!.fontSize)
      expect(part!.clipped).toBe(false)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    // Shared sidebar row chrome: the nav profile adapts to the UI font and
    // keeps text inside the line box. Probed synthetically because the
    // fixture sidebar is driven by the mock session catalog.
    const rowProfile = await page.evaluate((uiFontSize) => {
      const probe = document.createElement('div')
      probe.className = 'interactive-row interactive-row--nav sidebar-row'
      probe.textContent = '行高契约'
      document.body.append(probe)
      const style = getComputedStyle(probe)
      const metrics = {
        height: probe.getBoundingClientRect().height,
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight: Number.parseFloat(style.lineHeight),
      }
      probe.remove()
      return { ...metrics, uiFontSize }
    }, uiFontSize)
    expect(rowProfile.height).toBeCloseTo(uiFontSize + 16, 1)
    expect(rowProfile.lineHeight).toBeGreaterThanOrEqual(rowProfile.fontSize)

    const buttonHeights = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.ui-button')]
        .slice(0, 10)
        .map((button) => button.getBoundingClientRect().height),
    )
    buttonHeightsByFontSize.set(uiFontSize, buttonHeights)

    // Settings rows keep their text readable and unclipped. Probed
    // synthetically because the fixture gate currently redirects the
    // settings route to the model setup wizard.
    const settingsRows = await page.evaluate(() => {
      const probe = (className: string) => {
        const node = document.createElement('div')
        node.className = className
        node.textContent = '设置行'
        document.body.append(node)
        const style = getComputedStyle(node)
        const metrics = {
          fontSize: Number.parseFloat(style.fontSize),
          lineHeight: Number.parseFloat(style.lineHeight),
          fontWeight: style.fontWeight,
          clipped: node.scrollHeight > node.clientHeight + 1,
        }
        node.remove()
        return metrics
      }
      return {
        page: probe('settings-page-title'),
        section: probe('settings-section-title'),
        title: probe('settings-management-row-title'),
        description: probe('settings-management-row-description'),
        meta: probe('settings-management-row-meta'),
        navigation: probe('settings-nav-item'),
        selectedNavigation: probe('settings-nav-item active'),
      }
    })
    for (const part of Object.values(settingsRows)) {
      expect(part.lineHeight).toBeGreaterThanOrEqual(part.fontSize)
      expect(part.clipped).toBe(false)
    }
    const delta = uiFontSize - 14
    expect(settingsRows.page).toMatchObject({ fontSize: 24 + delta, fontWeight: '600' })
    expect(settingsRows.section).toMatchObject({ fontSize: 16 + delta, fontWeight: '600' })
    expect(settingsRows.title).toMatchObject({ fontSize: 14 + delta, fontWeight: '500' })
    expect(settingsRows.description).toMatchObject({ fontSize: 13 + delta, fontWeight: '400' })
    expect(settingsRows.meta).toMatchObject({ fontSize: 12 + delta, fontWeight: '400' })
    expect(settingsRows.selectedNavigation.fontWeight).toBe(settingsRows.navigation.fontWeight)

    // Turn navigation preview keeps a three-line clamp whose line boxes
    // scale with the UI font.
    await page.goto('/?visualCase=turn-nav#/threads/visual-turn-nav')
    await closeTransientErrorToast(page)
    await expect(page.getByText('第 4 轮已完成。', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '取消置顶摘要' }).click()
    const rail = page.getByRole('navigation', { name: '用户消息导航' })
    await rail.getByRole('button').last().focus()
    const preview = page
      .locator(
        '.conversation-turn-preview-tooltip [data-thread-user-message-navigation-tooltip-preview]',
      )
      .last()
    await expect(preview).toBeVisible()
    const clampMetrics = await preview
      .locator('.preview-card-assistant-text')
      .evaluate((element) => {
        const style = getComputedStyle(element)
        const fontSize = Number.parseFloat(style.fontSize)
        const lineHeight = Number.parseFloat(style.lineHeight)
        return {
          fontSize,
          lineHeight,
          boxHeight: element.getBoundingClientRect().height,
        }
      })
    expect(clampMetrics.lineHeight).toBeGreaterThanOrEqual(clampMetrics.fontSize)
    // The clamp keeps exactly three line boxes; list margins inside the
    // preview may add a couple of pixels on top.
    expect(clampMetrics.boxHeight).toBeGreaterThanOrEqual(clampMetrics.lineHeight * 3)
    expect(clampMetrics.boxHeight).toBeLessThanOrEqual(clampMetrics.lineHeight * 3 + 6)
  }

  // Fixed chrome keeps identical button boxes at every UI font size.
  const at11 = buttonHeightsByFontSize.get(11) ?? []
  const at14 = buttonHeightsByFontSize.get(14) ?? []
  const at16 = buttonHeightsByFontSize.get(16) ?? []
  expect(at11.length).toBeGreaterThan(0)
  expect(at11).toEqual(at14)
  expect(at14).toEqual(at16)
})

test('code line boxes never overlap at the supported code font sizes', async ({ page }) => {
  for (const codeFontSize of [8, 13, 24] as const) {
    await page.setViewportSize({ width: 1440, height: 920 })
    await prepareVisualTheme(page, 'dark', { codeFontSize })
    await gotoWorkbenchFixture(page, '/?visualCase=rich#/threads/visual-rich')
    await closeTransientErrorToast(page)

    // Rendered Markdown code block: probed synthetically because the fixture
    // conversation currently omits the code section.
    const codePreMetrics = await page.evaluate(() => {
      const probe = document.createElement('pre')
      probe.className = 'md-code-pre'
      probe.textContent = 'const theme = mode === "dark"'
      document.body.append(probe)
      const style = getComputedStyle(probe)
      const metrics = {
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight: Number.parseFloat(style.lineHeight),
      }
      probe.remove()
      return metrics
    })
    expect(codePreMetrics.lineHeight).toBeGreaterThanOrEqual(codePreMetrics.fontSize)

    // Fallback / error code keeps at least its minimum line box.
    const fallbackMetrics = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.className = 'md-mermaid-fallback'
      probe.textContent = '代码回退'
      document.body.append(probe)
      const style = getComputedStyle(probe)
      const metrics = {
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight: Number.parseFloat(style.lineHeight),
      }
      probe.remove()
      return metrics
    })
    expect(fallbackMetrics.lineHeight).toBeGreaterThanOrEqual(fallbackMetrics.fontSize)
  }
})

test('user message collapse threshold recomputes when the UI font changes at runtime', async ({
  page,
}) => {
  const readClamp = (bubble: Locator) =>
    bubble.evaluate((element) => {
      const viewport = element.querySelector<HTMLElement>('.user-message-markdown__viewport')
      if (!viewport) return null
      return {
        collapsed: viewport.classList.contains('is-collapsed'),
        clientHeight: viewport.clientHeight,
        scrollHeight: viewport.scrollHeight,
      }
    })

  await page.setViewportSize({ width: 1440, height: 920 })
  await prepareVisualTheme(page, 'dark', { uiFontSize: 11 })
  await gotoWorkbenchFixture(page, '/?visualCase=rich#/threads/visual-rich')
  await closeTransientErrorToast(page)
  const bubble = page.locator('[data-user-message-bubble]').first()
  const toggle = bubble.getByRole('button', { name: '显示更多' })
  await expect(toggle).toBeVisible()
  const heightAt11 = (await readClamp(bubble))!.clientHeight

  // Grow 11 → 16 at runtime: the collapsed clamp follows the new line boxes.
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--cpx-sys-font-size-ui', '16px')
    for (const [name, size] of Object.entries({
      xs: 14,
      sm: 15,
      md: 16,
      lg: 18,
      xl: 20,
      '2xl': 22,
      '3xl': 26,
      '4xl': 30,
    })) {
      document.documentElement.style.setProperty(`--cpx-sys-font-size-${name}`, `${size}px`)
    }
  })
  await expect.poll(async () => (await readClamp(bubble))?.clientHeight).toBeGreaterThan(heightAt11)
  let clamp = await readClamp(bubble)
  if (clamp!.collapsed) {
    expect(clamp!.scrollHeight).toBeGreaterThan(clamp!.clientHeight)
  } else {
    expect(clamp!.scrollHeight).toBeLessThanOrEqual(clamp!.clientHeight + 1)
  }

  // Shrink back to 11: the threshold is recomputed from the current line
  // boxes, so the collapse decision stays consistent with the measured
  // heights instead of relying on the mount-time value.
  const heightAt16 = clamp!.clientHeight
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--cpx-sys-font-size-ui', '11px')
    for (const [name, size] of Object.entries({
      xs: 9,
      sm: 10,
      md: 11,
      lg: 13,
      xl: 15,
      '2xl': 17,
      '3xl': 21,
      '4xl': 25,
    })) {
      document.documentElement.style.setProperty(`--cpx-sys-font-size-${name}`, `${size}px`)
    }
  })
  await expect.poll(async () => (await readClamp(bubble))?.clientHeight).toBeLessThan(heightAt16)
  clamp = await readClamp(bubble)
  if (clamp!.collapsed) {
    expect(clamp!.scrollHeight).toBeGreaterThan(clamp!.clientHeight)
  } else {
    expect(clamp!.scrollHeight).toBeLessThanOrEqual(clamp!.clientHeight + 1)
  }
  await expect(toggle).toBeVisible()
})

test('workspace header keeps equal edge insets across sidebar and dock states', async ({
  page,
}) => {
  await prepareVisualTheme(page, 'dark', { reduceMotion: 'off' })
  await page.setViewportSize({ width: 1440, height: 920 })
  await gotoWorkbenchFixture(page, '/?visualCase=rich#/threads/visual-rich')
  await closeTransientErrorToast(page)
  const header = page.getByRole('toolbar', { name: '工作区工具栏' })
  const title = header.locator('.chat-session-title')
  const routeAction = header.locator('.chat-session-actions > .icon-button').last()
  const shellAction = header.locator('.workspace-shell-control-button').last()
  const dock = page.getByRole('complementary', { name: '右侧面板' })
  const sidebarToggle = page.locator('[data-app-shell-sidebar-trigger]')

  async function expectInsets(open: boolean): Promise<void> {
    await expect
      .poll(async () => {
        const [headerBox, titleBox, routeBox, shellBox, dockBox] = await Promise.all([
          header.boundingBox(),
          title.boundingBox(),
          routeAction.boundingBox(),
          shellAction.boundingBox(),
          open ? dock.boundingBox() : Promise.resolve(null),
        ])
        if (!headerBox || !titleBox || !routeBox || !shellBox || (open && !dockBox)) return Infinity
        const left = titleBox.x - headerBox.x
        const outerRight = headerBox.x + headerBox.width - shellBox.x - shellBox.width
        const routeRight = open ? dockBox!.x - routeBox.x - routeBox.width : outerRight
        const overlap = titleBox.x + titleBox.width > routeBox.x
        return overlap
          ? Infinity
          : Math.max(Math.abs(left - 8), Math.abs(outerRight - 8), Math.abs(routeRight - 8))
      })
      .toBeLessThanOrEqual(1)
  }

  for (const collapsed of [false, true, false]) {
    const isCollapsed = (await sidebarToggle.getAttribute('title')) === '展开侧边栏'
    if (isCollapsed !== collapsed) await sidebarToggle.click()
    for (const open of [false, true]) {
      if (((await shellAction.getAttribute('aria-pressed')) === 'true') !== open)
        await shellAction.click()
      await expect(shellAction).toHaveAttribute('aria-pressed', String(open))
      await expectInsets(open)
    }
  }
  const handle = page.getByRole('separator', { name: '调整右侧面板宽度' })
  const before = await dock.boundingBox()
  const grip = await handle.boundingBox()
  expect(before).not.toBeNull()
  expect(grip).not.toBeNull()
  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip!.x - 80, grip!.y + grip!.height / 2, { steps: 6 })
  await page.mouse.up()
  await expect
    .poll(async () => (await dock.boundingBox())!.width)
    .toBeGreaterThan(before!.width + 40)
  await expectInsets(true)
  await shellAction.click()
  await expectInsets(false)
})

for (const mode of MODES) {
  test(`workspace toolbar backgrounds and compact file opener ${mode}`, async ({ page }) => {
    test.setTimeout(90_000)
    await prepareVisualTheme(page, mode, { reduceMotion: 'off' })
    await page.setViewportSize({ width: 1440, height: 920 })
    await gotoWorkbenchFixture(page, '/?visualCase=rich#/threads/visual-rich')
    await closeTransientErrorToast(page)
    const colors = await page.evaluate(() => {
      const probe = document.createElement('div')
      document.body.append(probe)
      probe.style.background = 'var(--cpx-sys-color-hover)'
      probe.style.color = 'var(--cpx-sys-color-fg-primary)'
      const hover = getComputedStyle(probe).backgroundColor
      const primary = getComputedStyle(probe).color
      probe.style.background = 'var(--cpx-sys-color-selected)'
      const selected = getComputedStyle(probe).backgroundColor
      probe.remove()
      return { hover, primary, selected }
    })
    const checkHover = async (button: Locator) => {
      await button.hover()
      await expect(button).toHaveCSS(
        'background-color',
        (await button.getAttribute('aria-pressed')) === 'true' ? colors.selected : colors.hover,
      )
      await expect(button).toHaveCSS('color', colors.primary)
    }
    const header = page.getByRole('toolbar', { name: '工作区工具栏' })
    await expect(header.locator('.open-target-split-button')).toHaveCount(0)
    await expect(header.getByTitle('切换默认打开目标')).toHaveCount(0)
    for (const button of await header
      .locator('.icon-button:enabled:not([aria-disabled="true"])')
      .all()) {
      await checkHover(button)
    }
    const shell = header.locator('.workspace-shell-control-button').last()
    if ((await shell.getAttribute('aria-pressed')) !== 'true') await shell.click()
    const dock = page.getByRole('complementary', { name: '右侧面板' })
    await dock.getByRole('button', { name: '文件 Ctrl+P' }).click()
    for (const button of await dock
      .locator('.file-breadcrumb-toolbar .icon-button:enabled')
      .all()) {
      await checkHover(button)
    }
    await dock.getByText('README.md', { exact: true }).click()
    await expect(dock.getByRole('tab', { name: 'README.md' })).toBeVisible()
    const group = dock.locator('.file-breadcrumb-toolbar__open-group')
    const main = group.locator('.file-breadcrumb-toolbar__open')
    const menu = group.locator('.file-breadcrumb-toolbar__open-menu')
    await expect(group.locator('.icon-button')).toHaveCount(2)
    await expect(main).toBeEnabled()
    await expect(main).toHaveText('')
    await expect(main).toHaveAttribute('title', /^使用 .+ 打开$/)
    const [mainBox, menuBox] = await Promise.all([main.boundingBox(), menu.boundingBox()])
    expect(mainBox).not.toBeNull()
    expect(menuBox).not.toBeNull()
    expect(Math.abs(mainBox!.height - menuBox!.height)).toBeLessThanOrEqual(1)
    expect(Math.abs(mainBox!.x + mainBox!.width - menuBox!.x - 1)).toBeLessThanOrEqual(1)
    for (const button of await dock
      .locator(
        '.right-dock-header .icon-button:enabled, .file-breadcrumb-toolbar .icon-button:enabled',
      )
      .all()) {
      await checkHover(button)
    }
    const opens: Array<{ path: string; target: string }> = []
    await page.exposeFunction('recordToolbarOpen', (path: string, target: string) => {
      opens.push({ path, target })
    })
    await page.evaluate(async () => {
      const modulePath = '/src/services/desktop-client/index.ts'
      const { desktopClient } = await import(modulePath)
      desktopClient.openPathWithTarget = async (path: string, target: string) => {
        await (
          window as unknown as { recordToolbarOpen(path: string, target: string): Promise<void> }
        ).recordToolbarOpen(path, target)
      }
    })
    await main.click()
    await expect.poll(() => opens.length).toBe(1)
    expect(opens[0]!.path.endsWith('README.md')).toBe(true)
    await menu.click()
    await expect(menu).toHaveAttribute('data-state', 'open')
    await expect(menu).toHaveCSS('background-color', colors.hover)
    await expect(page.getByRole('menuitem', { name: '在文件资源管理器中显示' })).toBeVisible()
    await page.getByRole('menuitemradio').first().click()
    await expect.poll(() => opens.length).toBe(2)
    expect(opens[1]).toEqual(opens[0])
    await main.focus()
    await page.keyboard.press('Tab')
    await expect(menu).toBeFocused()
    await expect(menu).toHaveCSS('outline-style', 'solid')
    await main.evaluate((button: HTMLButtonElement) => {
      button.disabled = true
    })
    await main.hover()
    await expect(main).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await main.evaluate((button: HTMLButtonElement) => {
      button.disabled = false
      button.setAttribute('aria-disabled', 'true')
    })
    await main.hover()
    await expect(main).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await main.evaluate((button) => button.removeAttribute('aria-disabled'))
    await main.evaluate((button) => button.setAttribute('data-active', 'true'))
    await page.mouse.move(0, 0)
    await expect(main).toHaveCSS('background-color', colors.hover)
    await main.evaluate((button) => button.removeAttribute('data-active'))
  })
}

for (const mode of MODES) {
  test(`conversation project details share sidebar data and actions ${mode}`, async ({ page }) => {
    test.setTimeout(90_000)
    await prepareVisualTheme(page, mode, { reduceMotion: 'off' })
    await page.setViewportSize({ width: 1440, height: 920 })
    await gotoWorkbenchFixture(page, '/?visualCase=rich#/threads/visual-rich')
    await closeTransientErrorToast(page)
    const openedFolders: string[] = []
    await page.exposeFunction('recordProjectFolder', (path: string) => {
      openedFolders.push(path)
    })
    const projectPath = await page.evaluate(async () => {
      const clientPath = '/src/services/desktop-client/index.ts'
      const eventsPath = '/src/features/projects/ProjectCatalogEvents.ts'
      const { desktopClient } = await import(clientPath)
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
      desktopClient.openPathWithDefaultTarget = async (path: string) => {
        await (
          window as unknown as { recordProjectFolder(path: string): Promise<void> }
        ).recordProjectFolder(path)
      }
      await desktopClient.setActiveSession('visual-rich')
      const { notifyProjectCatalogChanged } = await import(eventsPath)
      notifyProjectCatalogChanged()
      return project.path
    })
    const trigger = page.locator('.chat-session-project-details')
    await expect(trigger).toHaveAttribute('title', '项目详情：Header Project')
    await trigger.hover()
    await expect(page.getByRole('dialog', { name: '项目详情', exact: true })).toHaveCount(0)
    await trigger.focus()
    await expect(page.getByRole('dialog', { name: '项目详情', exact: true })).toHaveCount(0)
    await page.keyboard.press('Enter')
    const card = page.getByRole('dialog', { name: '项目详情', exact: true })
    await expect(card).toBeVisible()
    await expect(trigger).toHaveAttribute('data-state', 'open')
    await expect(trigger).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    const stats = await card.locator('.sidebar-project-hover-card-stats-content').textContent()
    await expect(card).toHaveCSS('width', '280px')
    await page.mouse.move(1400, 880)
    await expect(card).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    const projectsToggle = page.locator('[data-sidebar-section-id="projects"]')
    if ((await projectsToggle.getAttribute('aria-expanded')) === 'false')
      await projectsToggle.click()
    const sidebarProject = page
      .locator('.sidebar-project-button[data-sidebar-project-key="id:header-project"]')
      .first()
    await sidebarProject.hover()
    const sidebarCard = page.locator('.sidebar-project-hover-card:visible').last()
    await expect(sidebarCard.locator('.sidebar-project-hover-card-stats-content')).toHaveText(stats)
    await page.mouse.move(1400, 880)
    await expect(sidebarCard).toBeHidden()
    await trigger.click()
    await card.getByRole('button', { name: '置顶项目', exact: true }).click()
    await expect(card).toBeHidden()
    await expect(trigger).toBeFocused()
    const pinnedToggle = page.locator('[data-sidebar-section-id="pinned"]')
    if ((await pinnedToggle.getAttribute('aria-expanded')) === 'false') await pinnedToggle.click()
    await sidebarProject.hover()
    await expect(
      sidebarCard.getByRole('button', { name: '取消置顶项目', exact: true }),
    ).toBeVisible()
    await page.mouse.move(1400, 880)
    await expect(sidebarCard).toBeHidden()
    await trigger.click()
    await card.getByRole('button', { name: '取消置顶项目', exact: true }).click()
    await trigger.click()
    await card.locator('.sidebar-project-hover-card-folder').first().click()
    await expect.poll(() => openedFolders).toEqual([projectPath])
    await expect(trigger).toBeFocused()
    await trigger.click()
    await card.getByRole('button', { name: '编辑项目', exact: true }).click()
    const editor = page.getByRole('dialog', { name: '编辑项目', exact: true })
    await expect(editor).toBeVisible()
    await expect
      .poll(() => editor.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true)
    await editor.getByRole('button', { name: '选择项目图标和颜色', exact: true }).click()
    await page.getByRole('radio', { name: '蓝色', exact: true }).click()
    await page.getByRole('radio', { name: '书本', exact: true }).click()
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await editor
      .getByRole('textbox', { name: '项目名称', exact: true })
      .fill('Renamed Header Project')
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await expect(editor).toBeHidden()
    await expect(trigger).toHaveAttribute('title', '项目详情：Renamed Header Project')
    await expect(sidebarProject).toContainText('Renamed Header Project')
    await expect(trigger.locator('[data-project-color]')).toHaveAttribute(
      'data-project-color',
      'blue',
    )
    await expect(trigger.locator('svg')).toHaveClass(/lucide-book-open/)
    const sidebarToggle = page.locator('[data-app-shell-sidebar-trigger]')
    if ((await sidebarToggle.getAttribute('title')) !== '展开侧边栏') await sidebarToggle.click()
    await trigger.focus()
    await page.keyboard.press('Space')
    await expect(card).toBeVisible()
    await page.evaluate(async () => {
      const clientPath = '/src/services/desktop-client/index.ts'
      const { desktopClient } = await import(clientPath)
      const snapshot = await desktopClient.getSession('visual-rich')
      snapshot.item = { ...snapshot.item, standalone: true }
      await desktopClient.setActiveSession('visual-rich')
    })
    await expect(trigger).toHaveCount(0)
    await expect(card).toBeHidden()
    const header = page.getByRole('toolbar', { name: '工作区工具栏' })
    await expect(header.locator('.chat-session-title__icon')).toHaveCount(0)
    const [headerBox, textBox] = await Promise.all([
      header.boundingBox(),
      header.locator('.chat-session-title__text').boundingBox(),
    ])
    expect(Math.abs(textBox!.x - headerBox!.x - 8)).toBeLessThanOrEqual(1)
  })
}

test('month calendar keeps five tasks and overflow entry inside padded cells', async ({ page }) => {
  test.setTimeout(90_000)
  page.setDefaultTimeout(10_000)
  await page.goto('/?visualCase=empty#/new', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.desktop-workspace')).toBeVisible()
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  await page.evaluate(async () => {
    const reactPath = '/node_modules/.vite/deps/react.js'
    const clientPath = '/node_modules/.vite/deps/react-dom_client.js'
    const calendarPath = '/src/features/automation/AutomationCalendar.tsx'
    const [
      {
        default: { createElement },
      },
      {
        default: { createRoot },
      },
      { AutomationCalendar },
    ] = await Promise.all([import(reactPath), import(clientPath), import(calendarPath)])
    const host = document.createElement('div')
    host.id = 'calendar-padding-fixture'
    host.style.cssText =
      'position:fixed;inset:0;display:flex;flex-direction:column;background:white;z-index:9999'
    document.body.append(host)
    createRoot(host).render(
      createElement(AutomationCalendar, {
        defaultSelectedDate: '2026-09-06',
        occurrences: Array.from({ length: 7 }, (_, index) => ({
          id: `padding-${index}`,
          source: { kind: 'scheduled-task', id: `padding-${index}` },
          definitionKind: 'one-off',
          title: `测试任务 ${index + 1}`,
          scheduledFor: new Date(2026, 8, 5, 9 + index).getTime(),
          status: 'completed',
          runId: null,
          threadId: null,
          proposalId: null,
        })),
        onOccurrenceSelect: () => {},
        onQuickCreate: () => {},
      }),
    )
  })
  const day = page.locator('#calendar-padding-fixture [data-calendar-date="2026-09-05"]')
  for (const viewport of [
    { width: 1440, height: 920 },
    { width: 960, height: 640 },
  ]) {
    await page.setViewportSize(viewport)
    const cells = page.locator('#calendar-padding-fixture [role="gridcell"]')
    await expect(cells).toHaveCount(42)
    const heights = await cells.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height),
    )
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(188)
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1)
    expect(
      await page
        .locator('#calendar-padding-fixture .automation-calendar__grid-scroll')
        .evaluate((element) => element.scrollHeight),
    ).toBeGreaterThan(viewport.height)
    await page.mouse.move(0, 0)
    const normalBackground = await day.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    )
    await day.hover({ position: { x: 50, y: 180 } })
    expect(await day.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
      normalBackground,
    )
    for (const selector of [
      '.automation-calendar__day-item',
      '.automation-calendar__day-more',
      '.automation-calendar__day-add',
    ]) {
      await day.locator(selector).first().hover()
      expect(await day.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
        normalBackground,
      )
    }
    expect(
      (await day.locator('.automation-calendar__day-item').first().boundingBox())!.height,
    ).toBeCloseTo(20, 0)
    await expect(day.locator('.automation-calendar__day-item')).toHaveCount(5)
    await expect(day.locator('.automation-calendar__day-more')).toHaveText('+2 项')
    await expect
      .poll(() =>
        day.evaluate((element) => {
          const box = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return Array.from(
            element.querySelectorAll(
              '.automation-calendar__day-item, .automation-calendar__day-more',
            ),
          ).every((item) => {
            const rect = item.getBoundingClientRect()
            return (
              rect.bottom <= box.bottom - parseFloat(style.paddingBottom) + 1 &&
              rect.left >= box.left + parseFloat(style.paddingLeft) - 1 &&
              rect.right <= box.right - parseFloat(style.paddingRight) + 1
            )
          })
        }),
      )
      .toBe(true)
    await cells.last().scrollIntoViewIfNeeded()
    const lastBox = await cells.last().boundingBox()
    expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(viewport.height)
    await day.scrollIntoViewIfNeeded()
  }
})
