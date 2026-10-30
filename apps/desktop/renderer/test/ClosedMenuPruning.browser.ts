// Run: bun apps/desktop/renderer/test/ClosedMenuPruning.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from '@playwright/test'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = (path: string) =>
  JSON.stringify(resolve(rendererRoot, 'src', path).replaceAll('\\', '/'))

const harness = `
import React, { StrictMode, useState, useMemo, useCallback, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { SearchablePopoverContent } from ${source('components/ui/SearchablePopoverContent.tsx')};
import { ModelPickerPopover } from ${source('features/session/composer/ModelPickerPopover.tsx')};
import { useComposerSuggestionMenu } from ${source('features/session/composer/UseComposerSuggestionMenu.ts')};
import { ComposerCommandMenu } from ${source('features/session/composer/ComposerCommandMenu.tsx')};
import {
  parseSlashInvocation,
  type ComposerSlashCommand,
  type ComposerSkillCommand,
  mergeSlashCommands,
} from ${source('features/session/composer/ComposerSlashCommands.ts')};
import { resolveComposerSuggestionRequest } from ${source('features/session/composer/ComposerSuggestionState.ts')};

const fixture = (window.fixture = {
  renderOptionCalls: 0,
  popoverOpen: false,
  setPopoverOpen: null,
  popoverSearch: '',
  setPopoverSearch: null,
  selectedPopoverValue: 'branch-main',
  setSelectedPopoverValue: null,
  popoverRerenderTrigger: 0,
  triggerPopoverRerender: null,
  lastSelectedOption: null,

  modelPickerOpen: false,
  setModelPickerOpen: null,
  modelPickerSelectedProvider: 'openai',
  modelPickerSelectedModel: 'gpt-4o',
  setModelPickerSelectedModel: null,
  modelPickerRerenderTrigger: 0,
  triggerModelPickerRerender: null,

  suggestionMenuOpen: false,
  setSuggestionMenuOpen: null,
  suggestionMenuKeyword: '',
  setSuggestionMenuKeyword: null,
  suggestionMenuScope: 'default:slash:0',
  lastSuggestionItems: [],
  lastSuggestionActiveKey: null,
  suggestionMenuCommits: 0,
  setSuggestionMenuActiveKey: null,

  parseSlashInvocation,
  resolveComposerSuggestionRequest,
});

const POPOVER_OPTIONS = [
  { value: 'branch-main', textValue: 'main' },
  { value: 'branch-dev', textValue: 'dev' },
  { value: 'branch-feature-a', textValue: 'feature-a' },
  { value: 'branch-feature-b', textValue: 'feature-b' },
  { value: 'branch-fix-1', textValue: 'fix-1' },
];

function SearchablePopoverTestComponent() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedValue, setSelectedValue] = useState('branch-main');
  const [, setRerender] = useState(0);

  fixture.setPopoverOpen = (next) => flushSync(() => setOpen(next));
  fixture.setPopoverSearch = (next) => flushSync(() => setSearch(next));
  fixture.setSelectedPopoverValue = (next) => flushSync(() => setSelectedValue(next));
  fixture.triggerPopoverRerender = () => flushSync(() => setRerender((c) => c + 1));
  fixture.popoverOpen = open;

  return (
    <div id="popover-container">
      <SearchablePopoverContent
        open={open}
        onOpenChange={(next) => {
          fixture.popoverOpen = next;
          setOpen(next);
        }}
        search={search}
        onSearchChange={setSearch}
        selectedValue={selectedValue}
        onSelect={(opt) => {
          fixture.lastSelectedOption = opt;
          setSelectedValue(opt.value);
        }}
        options={POPOVER_OPTIONS}
        trigger={<button id="popover-trigger">Open Branches</button>}
        contentLabel="Branch Selector"
        emptyLabel="No branches"
        listLabel="Branches"
        searchLabel="Filter branches"
        searchPlaceholder="Search branch..."
        renderOption={(option, selected) => {
          fixture.renderOptionCalls++;
          return (
            <div data-testid={'option-' + option.value} className={selected ? 'selected' : ''}>
              {option.textValue}
            </div>
          );
        }}
      />
    </div>
  );
}

const PROVIDER_OPTIONS = [
  {
    providerID: 'openai',
    displayName: 'OpenAI',
    modelPresets: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { id: 'o1', label: 'o1' },
    ],
  },
  {
    providerID: 'anthropic',
    displayName: 'Anthropic',
    modelPresets: [
      { id: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-5-haiku', label: 'Claude 3.5 Haiku' },
    ],
  },
];

function ModelPickerTestComponent() {
  const [open, setOpen] = useState(false);
  const [selectedProviderID, setSelectedProviderID] = useState('openai');
  const [selectedModelPreset, setSelectedModelPreset] = useState('gpt-4o');
  const [, setRerender] = useState(0);

  fixture.setModelPickerOpen = (next) => flushSync(() => setOpen(next));
  fixture.setModelPickerSelectedModel = (next) => flushSync(() => setSelectedModelPreset(next));
  fixture.triggerModelPickerRerender = () => flushSync(() => setRerender((c) => c + 1));
  fixture.modelPickerOpen = open;

  return (
    <div id="model-picker-container">
      <ModelPickerPopover
        open={open}
        onOpenChange={(next) => {
          fixture.modelPickerOpen = next;
          setOpen(next);
        }}
        trigger={<button id="model-picker-trigger">Open Model Picker</button>}
        selectedProviderID={selectedProviderID}
        selectedModelPreset={selectedModelPreset}
        providerOptions={PROVIDER_OPTIONS}
        onProviderModelChange={(pID, mID) => {
          setSelectedProviderID(pID);
          setSelectedModelPreset(mID);
        }}
      />
    </div>
  );
}

const SAMPLE_MENU_ITEMS = [
  { key: 'plan', label: '计划', section: '内置命令', matchText: 'plan 计划' },
  { key: 'goal', label: '目标', section: '内置命令', matchText: 'goal 目标' },
  { key: 'model', label: '模型', section: '设置', matchText: 'model 模型' },
];

function SuggestionMenuTestComponent() {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [scope, setScope] = useState('default:slash:0');

  fixture.setSuggestionMenuOpen = (next) => flushSync(() => setOpen(next));
  fixture.setSuggestionMenuKeyword = (next) => flushSync(() => setKeyword(next));
  fixture.suggestionMenuOpen = open;

  const { items, activeKey, activeItem, setActiveKey } = useComposerSuggestionMenu(
    open ? SAMPLE_MENU_ITEMS : [],
    keyword,
    scope,
    open
  );

  fixture.lastSuggestionItems = items;
  fixture.lastSuggestionActiveKey = activeKey;
  fixture.setSuggestionMenuActiveKey = (key) => flushSync(() => setActiveKey(key));
  useLayoutEffect(() => { fixture.suggestionMenuCommits++; });

  return (
    <div id="suggestion-menu-container">
      <span id="suggestion-items-count">{items.length}</span>
      <span id="suggestion-active-key">{activeKey ?? 'none'}</span>
      {open ? <ComposerCommandMenu id="test-suggestions" items={items} keyword={keyword}
        activeKey={activeKey} onActiveKeyChange={setActiveKey} onItemSelect={() => {}} /> : null}
    </div>
  );
}

let root;
fixture.mount = () => {
  root = createRoot(document.getElementById('root'));
  flushSync(() => {
    root.render(
      <StrictMode>
        <SearchablePopoverTestComponent />
        <ModelPickerTestComponent />
        <SuggestionMenuTestComponent />
      </StrictMode>
    );
  });
};
fixture.unmount = () => flushSync(() => root.unmount());
`;

if (process.versions.bun) {
  const build = await Bun.build({
    entrypoints: ['closed-menu-pruning-harness'],
    target: 'browser',
    format: 'iife',
    define: {
      'process.env.NODE_ENV': '"development"',
      'import.meta.env': '{"DEV":true}',
      'import.meta.hot': 'undefined',
    },
    plugins: [
      {
        name: 'closed-menu-pruning-harness',
        setup(builder) {
          builder.onResolve(
            { filter: /^react(?:-dom)?(?:\/.*)?$|^react-router-dom$|^zustand(?:\/.*)?$/ },
            (args) => ({
              path: Bun.resolveSync(args.path, rendererRoot),
              namespace: 'file',
            }),
          )
          builder.onResolve({ filter: /^closed-menu-pruning-harness$/ }, () => ({
            path: 'harness',
            namespace: 'fixture',
          }))
          builder.onLoad({ filter: /^harness$/, namespace: 'fixture' }, () => ({
            contents: harness,
            loader: 'tsx',
            resolveDir: rendererRoot,
          }))
          builder.onResolve({ filter: /desktop-client\/index\.js$/ }, () => ({
            path: 'client',
            namespace: 'fixture',
          }))
          builder.onLoad({ filter: /^client$/, namespace: 'fixture' }, () => ({
            contents: `
              export const desktopClient = {
                isComposerFileAttachmentAvailable: async () => true,
                listRuntimeSkills: async () => ({ state: 'ready', data: [] }),
                onRuntimeSkillsUpdated: () => () => {},
                onPluginsUpdated: () => () => {},
                getTaskSuggestions: async () => ({ suggestions: [], recentTasks: [] }),
              };
            `,
            loader: 'js',
          }))
        },
      },
    ],
  })

  assert.ok(build.success, build.logs.map(String).join('\n'))
  const child = Bun.spawn(['node', '--experimental-strip-types', fileURLToPath(import.meta.url)], {
    stdin: new Blob([await build.outputs[0]!.text()]),
    stdout: 'inherit',
    stderr: 'inherit',
  })
  process.exit(await child.exited)
}

let script = ''
for await (const chunk of process.stdin) script += chunk.toString('utf8')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
async function settle(page: Page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
}

try {
  const page = await browser.newPage()
  await page.route('http://127.0.0.1/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<div id="root"></div>',
    }),
  )
  await page.goto('http://127.0.0.1/closed-menu-pruning-test')
  await page.addStyleTag({ content: '#test-suggestions { max-height: 70px; overflow: auto; } #test-suggestions button { display: block; height: 40px; }' })
  await page.addScriptTag({ content: script })
  await page.evaluate(() => (window as any).fixture.mount())
  await settle(page)

  // =========================================================================
  // 1. SearchablePopoverContent: 0 renderOption calls when closed & re-rendered
  // =========================================================================
  const initialCalls = await page.evaluate(() => (window as any).fixture.renderOptionCalls)
  assert.equal(initialCalls, 0, 'renderOption must NOT be called when popover is closed on initial render')

  // Force re-renders while closed
  await page.evaluate(() => (window as any).fixture.triggerPopoverRerender())
  await settle(page)
  await page.evaluate(() => (window as any).fixture.triggerPopoverRerender())
  await settle(page)

  const callsAfterRerenders = await page.evaluate(() => (window as any).fixture.renderOptionCalls)
  assert.equal(callsAfterRerenders, 0, 'renderOption must NOT be called during re-renders while closed')

  // Open popover via trigger click
  const trigger = page.locator('#popover-trigger')
  await trigger.click()
  await settle(page)

  const callsAfterOpen = await page.evaluate(() => (window as any).fixture.renderOptionCalls)
  assert.ok(callsAfterOpen > 0, 'renderOption must be called when popover opens')

  // Verify options are visible in DOM
  const mainOption = page.locator('[data-testid="option-branch-main"]')
  assert.ok(await mainOption.isVisible(), 'Branch main option must be visible')

  // Type in search to filter
  const searchInput = page.locator('.search-input-field')
  await searchInput.fill('feature')
  await settle(page)

  // Verify filtered results
  const featureAOption = page.locator('[data-testid="option-branch-feature-a"]')
  assert.ok(await featureAOption.isVisible(), 'Branch feature-a must match "feature"')

  // Select an option
  await featureAOption.click()
  await settle(page)

  const lastSelected = await page.evaluate(() => (window as any).fixture.lastSelectedOption)
  assert.equal(lastSelected?.value, 'branch-feature-a', 'Selected option must be branch-feature-a')

  // Re-open and verify Escape closes and restores focus to trigger
  await trigger.click()
  await settle(page)
  assert.equal(await page.evaluate(() => (window as any).fixture.popoverOpen), true)

  await page.keyboard.press('Escape')
  await settle(page)
  assert.equal(await page.evaluate(() => (window as any).fixture.popoverOpen), false, 'Escape must close popover')

  const focusedElementId = await page.evaluate(() => document.activeElement?.id)
  assert.equal(focusedElementId, 'popover-trigger', 'Focus must return to trigger button after Escape')

  // =========================================================================
  // 2. ModelPickerPopover: zero list construction when closed
  // =========================================================================
  const modelPanelWhenClosed = await page.evaluate(() =>
    document.querySelector('.composer-model-panel')
  )
  assert.equal(modelPanelWhenClosed, null, 'Model panel DOM must NOT exist when model picker is closed')

  // Re-render while closed
  await page.evaluate(() => (window as any).fixture.triggerModelPickerRerender())
  await settle(page)
  const modelPanelAfterRerender = await page.evaluate(() =>
    document.querySelector('.composer-model-panel')
  )
  assert.equal(modelPanelAfterRerender, null, 'Model panel DOM must NOT exist after closed re-render')

  // Open ModelPickerPopover via trigger click
  const modelTrigger = page.locator('#model-picker-trigger')
  await modelTrigger.click()
  await settle(page)

  const modelPanelWhenOpen = await page.evaluate(() =>
    Boolean(document.querySelector('.composer-model-panel'))
  )
  assert.equal(modelPanelWhenOpen, true, 'Model panel DOM must exist when model picker is open')

  // Verify models are displayed
  const gpt4oRow = page.locator('.composer-model-row').filter({ hasText: 'GPT-4o' }).first()
  assert.ok(await gpt4oRow.isVisible(), 'GPT-4o row must be visible')

  // Close model picker and verify DOM is removed
  await page.evaluate(() => (window as any).fixture.setModelPickerOpen(false))
  await settle(page)

  const modelPanelAfterClose = await page.evaluate(() =>
    document.querySelector('.composer-model-panel')
  )
  assert.equal(modelPanelAfterClose, null, 'Model panel DOM must be removed after closing')

  // Re-open and verify selected model is restored
  await page.evaluate(() => (window as any).fixture.setModelPickerOpen(true))
  await settle(page)
  const gpt4oRowSelected = page.locator('.composer-model-row.is-selected').filter({ hasText: 'GPT-4o' })
  assert.ok(await gpt4oRowSelected.isVisible(), 'Selected model must be restored upon re-open')

  await page.evaluate(() => (window as any).fixture.setModelPickerOpen(false))
  await settle(page)

  // =========================================================================
  // 3. Composer Suggestion Menu & Direct Submission
  // =========================================================================
  // When closed, useComposerSuggestionMenu items count is 0
  const closedItemsCount = await page.evaluate(() =>
    (window as any).fixture.lastSuggestionItems.length
  )
  assert.equal(closedItemsCount, 0, 'Items must be empty when suggestion menu is closed')
  const closedActiveKey = await page.evaluate(() =>
    (window as any).fixture.lastSuggestionActiveKey
  )
  assert.equal(closedActiveKey, null, 'Active key must be null when suggestion menu is closed')

  // Open suggestion menu
  await page.evaluate(() => (window as any).fixture.setSuggestionMenuOpen(true))
  await settle(page)

  const openItemsCount = await page.evaluate(() =>
    (window as any).fixture.lastSuggestionItems.length
  )
  assert.ok(openItemsCount > 0, 'Items must be populated when suggestion menu is open')

  await page.evaluate(() => {
    const fixture = (window as any).fixture
    fixture.setSuggestionMenuActiveKey(fixture.lastSuggestionActiveKey)
  })
  await settle(page)
  const commitsBeforeHover = await page.evaluate(() => (window as any).fixture.suggestionMenuCommits)
  await page.evaluate(() => {
    const fixture = (window as any).fixture
    for (let index = 0; index < 30; index++)
      fixture.setSuggestionMenuActiveKey(fixture.lastSuggestionActiveKey)
  })
  await settle(page)
  assert.equal(await page.evaluate(() => (window as any).fixture.suggestionMenuCommits),
    commitsBeforeHover, 'Repeated hover over the same option must not commit another render')

  const menu = page.locator('#test-suggestions')
  assert.equal(await menu.getAttribute('data-scroll-mask'), 'bottom')
  await menu.evaluate((element) => { element.scrollTop = 30 })
  await settle(page)
  assert.equal(await menu.getAttribute('data-scroll-mask'), 'both')
  await menu.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await settle(page)
  assert.equal(await menu.getAttribute('data-scroll-mask'), 'top')

  // Close suggestion menu
  await page.evaluate(() => (window as any).fixture.setSuggestionMenuOpen(false))
  await settle(page)

  const reclosedItemsCount = await page.evaluate(() =>
    (window as any).fixture.lastSuggestionItems.length
  )
  assert.equal(reclosedItemsCount, 0, 'Items must be pruned back to 0 when suggestion menu closes')

  // Direct slash invocation evaluation:
  const directSlashCheck = await page.evaluate(() => {
    // Normal text does not request suggestion
    const normalReq = (window as any).fixture.resolveComposerSuggestionRequest('normal text here', 16, false)
    const slashReq = (window as any).fixture.resolveComposerSuggestionRequest('/plan write tests', 5, false)

    const builtinCommands = [
      {
        id: 'plan',
        trigger: 'plan',
        title: '计划模式',
        description: '生成执行计划',
        source: 'builtin',
        availability: { visible: true, enabled: true },
        execute: async () => true,
      },
      {
        id: 'goal',
        trigger: 'goal',
        title: '目标模式',
        description: '持续执行直到达成',
        source: 'builtin',
        availability: { visible: true, enabled: true },
        execute: async () => true,
      },
    ]

    const parsedPlan = (window as any).fixture.parseSlashInvocation('/plan', builtinCommands)
    const parsedGoal = (window as any).fixture.parseSlashInvocation('/goal', builtinCommands)
    const parsedUnknown = (window as any).fixture.parseSlashInvocation('/unknown-cmd', builtinCommands)

    return {
      normalReq,
      slashReqKind: slashReq?.kind,
      parsedPlanKind: parsedPlan.kind,
      parsedPlanId: parsedPlan.command?.id,
      parsedGoalKind: parsedGoal.kind,
      parsedUnknownKind: parsedUnknown.kind,
    }
  })

  assert.equal(directSlashCheck.normalReq, null, 'Normal typing must not create suggestion request')
  assert.equal(directSlashCheck.parsedPlanKind, 'builtin', 'Direct /plan invocation must parse as builtin command')
  assert.equal(directSlashCheck.parsedPlanId, 'plan', 'Parsed command id must be plan')
  assert.equal(directSlashCheck.parsedGoalKind, 'builtin', 'Direct /goal invocation must parse as builtin command')
  assert.equal(directSlashCheck.parsedUnknownKind, 'unknown', 'Unknown command must parse as unknown')

  await page.evaluate(() => (window as any).fixture.unmount())
  console.log('ClosedMenuPruning regression passed')
} finally {
  await browser.close()
}
