// Run: bun apps/desktop/renderer/test/AskUserQuestion.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { chromium, expect } from '@playwright/test'
import { compileEntryStyles } from './helpers/RendererStyles.js'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = (path: string) =>
  JSON.stringify(resolve(rendererRoot, 'src', path).replaceAll('\\', '/'))
const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AskUserQuestionApproval } from ${source('features/session/approvals/AskUserQuestionApproval.tsx')};
import { PlanApprovalCard } from ${source('features/session/approvals/PlanApprovalCard.tsx')};
import { InlineApprovalCard } from ${source('features/session/approvals/InlineApprovalCard.tsx')};
import { deriveThemeVariables } from ${source('features/theme/ThemeVariables.ts')};
import { DEFAULT_LIGHT_THEME, DEFAULT_DARK_THEME } from ${source('../shared/Theme.ts')};
Object.entries(deriveThemeVariables(DEFAULT_LIGHT_THEME)).forEach(([key,value])=>document.documentElement.style.setProperty(key,value));
const questions = ['scope', 'format', 'selection'].map((id,index)=>({id, header:id,
 question:index===2?'导出应作用于当前页面所有数据，还是按用户已做的筛选和选择？':'你希望导出什么内容？如果是可运行程序、图片等其他形式，可以直接补充。',
 options:[{label:'完整配置 JSON',description:'导出配置，用于备份或迁移。说明较长时应当自然换行，保持在选项标题下方，不挤压题目导航与关闭按钮。'},{label:'终端会话记录',description:'保存演示记录'},{label:'其他范围'}], multiSelect:false}));
function Harness(){ const [generation,setGeneration]=useState(0); const [multi,setMulti]=useState(false); const [interrupted,setInterrupted]=useState(false); const [mode,setMode]=useState('question'); const [single,setSingle]=useState(false); const [supportsSkip,setSupportsSkip]=useState(true);
 return <main style={{width:900,margin:'80px auto'}}>
 <button onClick={()=>{setGeneration(x=>x+1);window.submissions=[];window.skipped=0;window.interruptions=0;window.asyncSubmission=false;setMulti(false);setInterrupted(false)}}>重置</button>
 <button onClick={()=>setSupportsSkip(x=>!x)}>切换跳过能力</button>
 <button onClick={()=>{setMulti(true);setGeneration(x=>x+1);window.submissions=[]}}>多选</button>
 <button onClick={()=>{setSingle(true);setMulti(false);setInterrupted(false);setMode('question');setGeneration(x=>x+1);window.submissions=[];window.asyncSubmission=false}}>单题</button>
 <button onClick={()=>{setMode('twins');window.ownerActions=[]}}>并排问题</button>
 <button onClick={()=>{setMode('twinplans');window.ownerActions=[]}}>并排计划</button>
 <button onClick={()=>{setMode('permission');window.decisions=[]}}>权限</button><button onClick={()=>{setMode('grant');window.decisions=[]}}>授权范围</button><button onClick={()=>{setMode('plan');setGeneration(x=>x+1);window.planAnswers=[]}}>计划</button>
 <button onClick={()=>Object.entries(deriveThemeVariables(DEFAULT_DARK_THEME)).forEach(([key,value])=>document.documentElement.style.setProperty(key,value))}>深色</button>
 {mode==="twins" ? [0,1].map(owner=><div data-owner={owner} key={owner}><AskUserQuestionApproval supportsQuestionSkip request={{requestId:"owner-"+owner,toolName:"AskUserQuestion",description:"请选择",input:{questions}}} onSubmit={()=>{}} onReject={()=>{window.ownerActions.push(owner)}} /></div>) : mode==="twinplans" ? [0,1].map(owner=><div data-owner={owner} key={owner}><PlanApprovalCard approval={{id:"owner-plan-"+owner,version:1}} onRespond={async response=>{window.ownerActions.push({owner,...response})}} /></div>) : mode==='permission'||mode==='grant' ? <InlineApprovalCard request={{requestId:mode,toolName:'Bash',description:'为验证本次修改运行测试',input:{command:'bun test'},...(mode==='grant'?{requestKind:'permission-grant',permissionGrant:{allowedScopes:['tool-call','turn'],requestedScope:'tool-call',requestedPermissions:{readPaths:['F:/workspace/src'],networkDomains:['example.com']}}}:{})}} onDecide={(_request,behavior,_always,_input,extras)=>{window.decisions.push({requestId:_request.requestId,behavior,extras});return new Promise((resolve,reject)=>{window.resolveDecision=resolve;window.rejectDecision=reject})}} /> : mode==='plan' ? <PlanApprovalCard key={generation} approval={{id:"plan-"+generation,version:1}} onRespond={async response=>{window.planAnswers.push(response);if(response.action==="close")window.planClosed=true}} /> : interrupted ? <p>对话已中断</p> : <AskUserQuestionApproval supportsQuestionSkip={supportsSkip} request={{requestId:'ask-'+generation,toolName:'AskUserQuestion',description:'请选择',input:{questions:questions.slice(0,single?1:3).map((q,i)=>({...q,multiSelect:multi&&i===0}))}}}
 onSubmit={input=>{window.submissions.push(input);if(window.asyncSubmission)return new Promise((resolve,reject)=>{window.resolveSubmission=resolve;window.rejectSubmission=reject})}} onReject={()=>window.skipped++}
 onInterrupt={()=>{window.interruptions++;return new Promise((resolve,reject)=>{window.resolveInterrupt=()=>{setInterrupted(true);resolve()};window.rejectInterrupt=reject})}}/>}
 </main>
}
window.submissions=[];window.skipped=0;window.interruptions=0;
createRoot(document.getElementById('root')).render(<Harness/>);
`
if (process.versions.bun) {
  const result = await Bun.build({
    entrypoints: ['question-harness'],
    target: 'browser',
    format: 'esm',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [
      {
        name: 'question-harness',
        setup(builder) {
          builder.onResolve({ filter: /^react(?:\/.*)?$|^react-dom\/client$/ }, (args) => ({
            path: Bun.resolveSync(args.path, rendererRoot),
            namespace: 'file',
          }))
          builder.onResolve({ filter: /^question-harness$/ }, () => ({
            path: 'harness',
            namespace: 'question',
          }))
          builder.onLoad({ filter: /^harness$/, namespace: 'question' }, () => ({
            contents: harness,
            loader: 'jsx',
            resolveDir: rendererRoot,
          }))
        },
      },
    ],
  })
  assert.ok(result.success, result.logs.map(String).join('\n'))
  const child = Bun.spawn(['node', '--experimental-strip-types', fileURLToPath(import.meta.url)], {
    stdin: new Blob([await result.outputs[0]!.text()]),
    stdout: 'inherit',
    stderr: 'inherit',
  })
  process.exit(await child.exited)
}
let script = ''
for await (const chunk of process.stdin) script += chunk.toString('utf8')
const css = await compileEntryStyles()
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('http://localhost/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><head><style>${css}</style></head><body><div id="root"></div></body></html>`,
    }),
  )
  await page.goto('http://localhost/')
  await page.addScriptTag({ content: script, type: 'module' })
  await page.waitForLoadState('networkidle')
  const card = page.locator('.ask-user-question-approval')
  const next = card.getByRole('button', { name: '下一题', exact: true })
  const previous = card.getByRole('button', { name: '上一题', exact: true })
  const submit = card.getByRole('button', { name: '提交', exact: true })
  const interrupt = card.getByRole('button', { name: '中断当前对话', exact: true })
  const choice = () => card.getByRole('radio').filter({ hasText: '终端会话记录' })
  const count = () => page.evaluate('window.submissions.length')
  await expect(card).toContainText('1 of 3')
  const pagination = card.getByRole('group', { name: '问题分页', exact: true })
  await expect(pagination.getByRole('button')).toHaveCount(2)
  await expect(pagination).toContainText('1 of 3')
  await expect(pagination.getByRole('button', { name: '中断当前对话' })).toHaveCount(0)
  assert.equal(await pagination.evaluate((element) => getComputedStyle(element).columnGap), '4px')
  await expect(previous).toBeDisabled()
  await expect(card.locator('h3')).toHaveCount(1)
  await expect(card.locator('input[type=radio]')).toHaveCount(0)
  await expect(next).toHaveCount(1)
  await expect(card.locator('.ask-user-question-actions').getByRole('button')).toHaveCount(1)
  await expect(card.locator('.inline-approval-option-info')).toHaveCount(0)
  await expect(choice()).not.toHaveAttribute('title')
  await expect(
    card
      .getByRole('radio')
      .filter({ hasText: '其他范围' })
      .locator('.ask-user-question-option-description'),
  ).toHaveCount(0)
  const title = await choice().locator('.inline-approval-option-label').boundingBox()
  const description = await choice().getByText('保存演示记录', { exact: true }).boundingBox()
  assert.ok(
    title && description && description.y >= title.y + title.height - 0.1,
    JSON.stringify({ title, description }),
  )
  const row = await choice().boundingBox()
  const marker = await choice().locator('.request-card-marker').boundingBox()
  assert.ok(row && marker && Math.abs(marker.y + marker.height / 2 - row.y - row.height / 2) < 1)
  const icon = await card
    .locator('.inline-approval-option.custom .request-card-marker')
    .boundingBox()
  const input = card.getByRole('textbox', { name: '自定义回答' })
  const box = await input.boundingBox()
  assert.ok(icon && box && box.x > icon.x && box.x - (icon.x + icon.width) < 25 && box.width > 350)
  const screenshot = resolve(tmpdir(), 'pidex-question-pagination.png')
  await page.screenshot({ path: screenshot })
  await page.getByRole('button', { name: '切换跳过能力' }).click()
  await expect(card.getByRole('button', { name: '跳过当前问题' })).toBeDisabled()
  await expect(card).toContainText('请升级并重启 Agent')
  assert.equal(await count(), 0)
  await page.getByRole('button', { name: '切换跳过能力' }).click()
  await expect(card.getByRole('button', { name: '跳过当前问题' })).toBeEnabled()
  await choice().click()
  await expect(card).toContainText('2 of 3')
  assert.equal(await count(), 0)
  await input.focus()
  await expect(next).toBeDisabled()
  await input.fill('中文自定义回答')
  await input.press('ArrowLeft')
  await input.press('Shift+Enter')
  await expect(card).toContainText('2 of 3')
  await expect(input).toHaveValue('中文自定义回\n答')
  await previous.click()
  await expect(card.getByRole('radio').filter({ hasText: '终端会话记录' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await card.getByRole('radio').filter({ hasText: '完整配置 JSON' }).click()
  await expect(card).toContainText('2 of 3')
  await expect(input).toHaveValue('中文自定义回\n答')
  await next.click()
  await expect(card).toContainText('3 of 3')
  await expect(next).toBeDisabled()
  assert.equal(await count(), 0)
  await expect(card.getByRole('button', { name: '跳过当前问题' })).toBeVisible()
  await choice().click()
  await choice().evaluate((element) =>
    element.dispatchEvent(new MouseEvent('click', { bubbles: true })),
  )
  assert.equal(await count(), 1)
  assert.deepEqual(await page.evaluate('window.submissions[0].answers'), {
    scope: '完整配置 JSON',
    format: '中文自定义回\n答',
    selection: '终端会话记录',
  })
  await page.getByRole('button', { name: '重置', exact: true }).click()
  assert.equal(await count(), 0)
  await next.click()
  await card.press('ArrowRight')
  await expect(card).toContainText('3 of 3')
  await choice().click()
  assert.deepEqual(await page.evaluate('window.submissions[0].answers'), {
    scope: '完整配置 JSON',
    format: '完整配置 JSON',
    selection: '终端会话记录',
  })
  await page.getByRole('button', { name: '重置', exact: true }).click()
  await expect(card).toContainText('1 of 3')
  await card.evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    ),
  )
  await card.press('Enter')
  await expect(card).toContainText('1 of 3')
  await card.press('Escape')
  assert.equal(await page.evaluate('window.skipped'), 1)
  await page.getByRole('button', { name: '重置', exact: true }).click()
  const skip = card.getByRole('button', { name: '跳过当前问题' })
  await expect(
    card.locator('.inline-approval-option.custom .ask-user-question-actions'),
  ).toHaveCount(1)
  await skip.click()
  await expect(card).toContainText('2 of 3')
  await expect(card.getByRole('radio').first()).toBeFocused()
  assert.equal(await count(), 0)
  assert.equal(await page.evaluate('window.skipped'), 0)
  await choice().click()
  await choice().click()
  assert.equal(await count(), 1)
  assert.deepEqual(await page.evaluate('window.submissions[0].skippedQuestionIds'), ['scope'])
  assert.deepEqual(await page.evaluate('window.submissions[0].answers'), {
    scope: '',
    format: '终端会话记录',
    selection: '终端会话记录',
  })
  await page.getByRole('button', { name: '重置', exact: true }).click()
  await skip.click()
  await skip.click()
  await page.evaluate('window.asyncSubmission=true')
  await skip.click()
  await skip.evaluate((element) =>
    element.dispatchEvent(new MouseEvent('click', { bubbles: true })),
  )
  assert.equal(await count(), 1)
  assert.deepEqual(await page.evaluate('window.submissions[0].skippedQuestionIds'), [
    'scope',
    'format',
    'selection',
  ])
  await page.evaluate('window.rejectSubmission(new Error("跳过提交失败"))')
  await expect(card).toContainText('提交回答失败')
  await skip.click()
  assert.equal(await count(), 2)
  await page.evaluate('window.resolveSubmission()')
  await page.getByRole('button', { name: '重置', exact: true }).click()
  await skip.click()
  await previous.click()
  await expect(card.getByRole('radio').filter({ hasText: '完整配置 JSON' })).toHaveAttribute(
    'aria-checked',
    'false',
  )
  await next.click()
  await choice().click()
  await skip.click()
  assert.deepEqual(await page.evaluate('window.submissions[0].answers'), {
    scope: '完整配置 JSON',
    format: '终端会话记录',
    selection: '',
  })
  assert.deepEqual(await page.evaluate('window.submissions[0].skippedQuestionIds'), ['selection'])
  await page.getByRole('button', { name: '重置', exact: true }).click()
  await input.fill('  ')
  await input.press('Enter')
  await expect(card).toContainText('1 of 3')
  await input.fill('自己的想法')
  await input.evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    ),
  )
  await expect(card).toContainText('1 of 3')
  await input.press('Enter')
  await expect(card).toContainText('2 of 3')
  await input.fill('第二题想法')
  await card.getByRole('button', { name: '下一步', exact: true }).click()
  await input.fill('第三题想法')
  await input.press('Enter')
  assert.deepEqual(await page.evaluate('window.submissions[0].answers'), {
    scope: '自己的想法',
    format: '第二题想法',
    selection: '第三题想法',
  })
  await page.getByRole('button', { name: '重置', exact: true }).click()
  await page.getByRole('button', { name: '多选', exact: true }).click()
  await card.getByRole('checkbox').filter({ hasText: '终端会话记录' }).click()
  await expect(card).toContainText('1 of 3')
  await next.click()
  await previous.click()
  await expect(card.getByRole('checkbox').filter({ hasText: '终端会话记录' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await next.click()
  await next.click()
  await expect(card.getByRole('button', { name: '跳过当前问题' })).toBeEnabled()
  assert.equal(await count(), 0)
  await page.getByRole('button', { name: '重置', exact: true }).click()
  await page.evaluate('window.asyncSubmission=true')
  await choice().click()
  await expect(card).toContainText('2 of 3')
  await choice().click()
  await expect(card).toContainText('3 of 3')
  await choice().click()
  await expect(card.getByRole('button', { name: '跳过当前问题' })).toBeDisabled()
  await expect(interrupt).toBeDisabled()
  assert.equal(await count(), 1)
  await page.evaluate('window.rejectSubmission(new Error("请求失败"))')
  await expect(card).toContainText('提交回答失败，请重试。')
  await choice().click()
  assert.equal(await count(), 2)
  await page.evaluate('window.resolveSubmission()')
  await page.getByRole('button', { name: '重置', exact: true }).click()
  await input.fill('保留中断失败时的草稿')
  await interrupt.click()
  await expect(interrupt).toBeDisabled()
  await expect(next).toBeDisabled()
  await expect(card.getByRole('button', { name: '下一步', exact: true })).toBeDisabled()
  await interrupt.evaluate((element) => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  assert.equal(await page.evaluate('window.interruptions'), 1)
  assert.equal(await count(), 0)
  assert.equal(await page.evaluate('window.skipped'), 0)
  await page.evaluate('window.rejectInterrupt(new Error("中断失败"))')
  await expect(card.locator('.ask-user-question-error')).toContainText('中断')
  await expect(input).toHaveValue('保留中断失败时的草稿')
  await expect(interrupt).toBeEnabled()
  await interrupt.click()
  assert.equal(await page.evaluate('window.interruptions'), 2)
  await page.evaluate('window.resolveInterrupt()')
  await expect(card).toHaveCount(0)
  await expect(page.getByText('对话已中断', { exact: true })).toBeVisible()
  assert.equal(await count(), 0)
  assert.equal(await page.evaluate('window.skipped'), 0)
  await page.getByRole('button', { name: '权限', exact: true }).click()
  const permission = page.locator('.request-card[data-variant="permission"]')
  await expect(permission).toContainText('为验证本次修改运行测试')
  await expect(permission.getByRole('radio')).toHaveCount(0)
  await expect(permission.getByRole('textbox')).toHaveCount(0)
  const allow = permission.getByRole('button', { name: '允许一次', exact: true })
  await allow.click()
  await expect(allow).toBeDisabled()
  await expect(permission.getByRole('button', { name: '拒绝', exact: true })).toBeDisabled()
  await allow.evaluate((element) =>
    element.dispatchEvent(new MouseEvent('click', { bubbles: true })),
  )
  assert.equal(await page.evaluate('window.decisions.length'), 1)
  await page.evaluate('window.rejectDecision(new Error("失败"))')
  await expect(permission.getByRole('alert')).toContainText('操作失败')
  await permission.getByRole('button', { name: '拒绝', exact: true }).click()
  assert.deepEqual(await page.evaluate('window.decisions.map(x=>x.behavior)'), ['allow', 'deny'])
  await page.evaluate('window.resolveDecision()')
  await page.getByRole('button', { name: '授权范围', exact: true }).click()
  const grant = page.locator('.request-card[data-variant="permission-grant"]')
  await expect(grant).toContainText('F:/workspace/src')
  await expect(grant).toContainText('example.com')
  await grant.getByRole('button', { name: '授权范围', exact: true }).click()
  await expect(page.getByRole('menuitemradio')).toHaveCount(2)
  await page.getByRole('menuitemradio', { name: '当前轮次', exact: true }).click()
  await grant.getByRole('button', { name: '允许', exact: true }).click()
  assert.deepEqual(await page.evaluate('window.decisions[0]'), {
    requestId: 'grant',
    behavior: 'allow',
    extras: { grantScope: 'turn' },
  })
  await page.evaluate('window.resolveDecision()')
  await page.getByRole('button', { name: '计划', exact: true }).click()
  const plan = page.locator('.request-card[data-variant="plan"]')
  await expect(plan).not.toContainText('1 of 1')
  await expect(plan.getByRole('button', { name: '提交', exact: true })).toHaveCount(0)
  await expect(plan.getByRole('button', { name: '关闭', exact: true })).toBeVisible()
  assert.deepEqual(await page.evaluate('window.planAnswers'), [])
  await plan.getByRole('radio').click()
  assert.deepEqual(await page.evaluate('window.planAnswers[0]'), { action: 'implement' })
  await page.getByRole('button', { name: '计划', exact: true }).click()
  await plan.getByRole('textbox', { name: '自定义回答' }).fill('是，实施此计划')
  await expect(plan.getByRole('button', { name: '关闭', exact: true })).toHaveCount(0)
  await plan.getByRole('button', { name: '提交', exact: true }).click()
  assert.deepEqual(await page.evaluate('window.planAnswers[0]'), {
    action: 'feedback',
    feedback: '是，实施此计划',
  })
  await expect(plan.getByRole('alert')).toHaveCount(0)
  await page.screenshot({ path: resolve(tmpdir(), 'pidex-request-plan-light.png') })
  await page.getByRole('button', { name: '深色', exact: true }).click()
  await page.screenshot({ path: resolve(tmpdir(), 'pidex-request-plan-dark.png') })
  await plan.getByRole('button', { name: '关闭计划', exact: true }).click()
  assert.deepEqual(await page.evaluate('window.planAnswers[1]'), { action: 'close' })
  await page.getByRole('button', { name: '单题', exact: true }).click()
  await expect(card).toContainText('1 of 1')
  await expect(submit).toHaveCount(0)
  assert.equal(await count(), 0)
  await page.evaluate('window.asyncSubmission=true')
  await choice().click()
  await choice().evaluate((element) =>
    element.dispatchEvent(new MouseEvent('click', { bubbles: true })),
  )
  assert.equal(await count(), 1)
  assert.deepEqual(await page.evaluate('window.submissions[0].answers'), { scope: '终端会话记录' })
  await page.evaluate('window.rejectSubmission(new Error("失败"))')
  await expect(card).toContainText('提交回答失败')
  await expect(choice()).toHaveAttribute('aria-checked', 'true')
  await choice().click()
  assert.equal(await count(), 2)
  await page.evaluate('window.resolveSubmission()')
  await page.getByRole('button', { name: '单题', exact: true }).click()
  await input.fill('中文多行')
  await input.press('End')
  await input.press('Shift+Enter')
  await page.keyboard.insertText('好')
  await input.evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    ),
  )
  await expect(input).toHaveValue('中文多行\n好')
  await expect(submit).toBeVisible()
  await expect(card.getByRole('button', { name: '跳过当前问题' })).toHaveCount(0)
  assert.equal(await count(), 0)
  await input.fill('')
  await expect(submit).toHaveCount(0)
  await expect(card.getByRole('button', { name: '跳过当前问题' })).toBeVisible()
  await input.fill('中文多行\n好')
  const customRow = await card.locator('.inline-approval-option.custom').boundingBox()
  const pencil = await card
    .locator('.inline-approval-option.custom .request-card-marker')
    .boundingBox()
  assert.ok(
    customRow &&
      pencil &&
      Math.abs(pencil.y + pencil.height / 2 - customRow.y - customRow.height / 2) < 1,
  )
  const actionBox = await submit.boundingBox()
  const textBox = await input.boundingBox()
  assert.ok(
    actionBox &&
      textBox &&
      customRow &&
      actionBox.x >= textBox.x + textBox.width &&
      actionBox.x + actionBox.width <= customRow.x + customRow.width,
  )
  await page.screenshot({ path: resolve(tmpdir(), 'pidex-question-single-dark.png') })
  await input.fill('中文长回答，用于检查按钮不覆盖文字。'.repeat(80))
  assert.equal(await count(), 0)
  const overflow = await input.evaluate((element) => ({
    height: element.clientHeight,
    scroll: element.scrollHeight,
  }))
  assert.ok(overflow.height <= 120 && overflow.scroll > overflow.height)
  await page.screenshot({ path: resolve(tmpdir(), 'pidex-question-long-dark.png') })
  await input.fill('中文多行\n好')
  await submit.click()
  assert.deepEqual(await page.evaluate('window.submissions[0].answers'), { scope: '中文多行\n好' })
  await page.getByRole('button', { name: '单题', exact: true }).click()
  await page.getByRole('button', { name: '多选', exact: true }).click()
  await expect(submit).toHaveCount(0)
  await card.getByRole('checkbox').filter({ hasText: '终端会话记录' }).click()
  assert.equal(await count(), 0)
  await expect(submit).toBeVisible()
  await expect(card.getByRole('button', { name: '跳过当前问题' })).toHaveCount(0)
  await submit.click()
  assert.deepEqual(await page.evaluate('window.submissions[0].answers'), {
    scope: '完整配置 JSON, 终端会话记录',
  })
  await page.getByRole('button', { name: '并排问题', exact: true }).click()
  const owner0 = page.locator('[data-owner="0"]')
  const owner1 = page.locator('[data-owner="1"]')
  await owner0.locator('.ask-user-question-approval').press('ArrowRight')
  await expect(owner0).toContainText('2 of 3')
  await expect(owner1).toContainText('1 of 3')
  await owner0.getByRole('textbox', { name: '自定义回答' }).press('Escape')
  assert.deepEqual(await page.evaluate('window.ownerActions'), [0])
  await owner1.locator('.ask-user-question-approval').press('ArrowRight')
  await expect(owner0).toContainText('2 of 3')
  await expect(owner1).toContainText('2 of 3')
  await page.getByRole('button', { name: '并排计划', exact: true }).click()
  await owner0.getByRole('textbox', { name: '自定义回答' }).press('Escape')
  assert.deepEqual(await page.evaluate('window.ownerActions'), [{ owner: 0, action: 'close' }])
  assert.deepEqual(errors, [])
  console.log(
    'Question click advance/submit, arrow defaults, centered markers, drafts, IME, retry and interrupt lock passed. Screenshot: ' +
      screenshot,
  )
} finally {
  await browser.close()
}
