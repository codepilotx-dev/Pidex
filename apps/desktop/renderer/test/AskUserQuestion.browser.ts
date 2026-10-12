// Run: bun apps/desktop/renderer/test/AskUserQuestion.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { chromium, expect } from '@playwright/test'
import { compileEntryStyles } from './helpers/RendererStyles.ts'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = (path: string) =>
  JSON.stringify(resolve(rendererRoot, 'src', path).replaceAll('\\', '/'))
const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AskUserQuestionApproval } from ${source('features/session/approvals/AskUserQuestionApproval.tsx')};
import { PlanApprovalCard } from ${source('features/session/approvals/PlanApprovalCard.tsx')};
import { InlineApprovalCard } from ${source('features/session/approvals/InlineApprovalCard.tsx')};
import { reconcileQuestionDrafts } from ${source('features/session/approvals/AskUserQuestionModel.ts')};
import { deriveThemeVariables } from ${source('features/theme/ThemeVariables.ts')};
import { DEFAULT_LIGHT_THEME, DEFAULT_DARK_THEME } from ${source('../shared/Theme.ts')};
Object.entries(deriveThemeVariables(DEFAULT_LIGHT_THEME)).forEach(([key,value])=>document.documentElement.style.setProperty(key,value));

const questions = [
  { id: 'scope', header: '范围', question: '计划应覆盖哪些客户端？', options: [
      { id: 'desktop', label: '仅桌面端', description: '本次集中完成桌面交互。', recommended: true },
      { id: 'both', label: '桌面端与 CLI', description: '同时设计共享能力和两端入口。' },
    ], multiSelect: false },
  { id: 'phase', header: '阶段', question: '先完成哪一部分？', options: [
      { id: 'ask', label: '提问交互', description: '先把逐题确认做扎实。' }, { id: 'dock', label: '计划侧栏' },
    ], multiSelect: false },
  { id: 'extra', header: '补充', question: '还有其他约束吗？', options: [
      { id: 'none', label: '暂时没有' }, { id: 'later', label: '稍后补充' },
    ], multiSelect: false },
];
const textQuestion = { id: 'free', header: '补充', question: '还有其他约束吗？', options: [], multiSelect: false };
const planApproval = { id: 'approval-1', threadId: 'thread-1', turnId: 'turn-1', planItemId: 'turn-1:plan', version: 1, status: 'pending', title: 'Plan 流程与交互重设计', markdown: '# 计划', nextTurnId: null, createdAt: 1, resolvedAt: null };

function resetState(){
  window.submissions=[]; window.rejects=0; window.interrupts=0; window.responses=[];
  window.openedPlans=[]; window.ownerActions=[]; window.decisions=[];
  window.asyncSubmission=false; window.asyncResponse=false;
}
window.ownerActions=[];

function Harness(){
  const [mode,setMode]=useState('question');
  const [generation,setGeneration]=useState(0);
  const [interrupted,setInterrupted]=useState(false);
  const [multi,setMulti]=useState(false);
  const [supportsSkip,setSupportsSkip]=useState(true);
  const [planThread,setPlanThread]=useState('thread-plan');
  const go=(next)=>{ resetState(); setInterrupted(false); setMulti(false); setSupportsSkip(true); setPlanThread('thread-plan'); setMode(next); setGeneration(x=>x+1); };
  const submit=(input)=>{ window.submissions.push(input); if(window.asyncSubmission) return new Promise((resolve,reject)=>{ window.resolveSubmission=resolve; window.rejectSubmission=reject; }); };
  const reject=()=>{ window.rejects+=1; };
  const interrupt=()=>{ window.interrupts+=1; return new Promise((resolve,reject)=>{ window.resolveInterrupt=()=>{ setInterrupted(true); resolve(); }; window.rejectInterrupt=reject; }); };
  const questionInput=(threadId, list)=>({ threadId, version: 1, questions: list });
  return <main style={{width:900,margin:'80px auto'}}>
    <div>
      <button onClick={()=>go('question')}>聊天提问</button>
      <button onClick={()=>go('plan')}>计划提问</button>
      <button onClick={()=>{ const target = planThread==='thread-plan' ? 'thread-plan-b' : 'thread-plan'; reconcileQuestionDrafts(target, new Set([target+':plan-'+generation+':1'])); setPlanThread(target); }}>切换聊天</button>
      <button onClick={()=>go('planText')}>纯文本计划题</button>
      <button onClick={()=>go('approval')}>计划审批</button>
      <button onClick={()=>go('approvalFresh')}>计划审批-新聊天能力</button>
      <button onClick={()=>go('twins')}>并排问题</button>
      <button onClick={()=>go('permission')}>权限</button>
      <button onClick={()=>go('grant')}>授权范围</button>
      <button onClick={()=>{setMulti(m=>!m); setGeneration(x=>x+1)}}>多选</button>
      <button onClick={()=>setSupportsSkip(x=>!x)}>切换跳过能力</button>
      <button onClick={()=>Object.entries(deriveThemeVariables(DEFAULT_DARK_THEME)).forEach(([k,v])=>document.documentElement.style.setProperty(k,v))}>深色</button>
      <button onClick={()=>Object.entries(deriveThemeVariables(DEFAULT_LIGHT_THEME)).forEach(([k,v])=>document.documentElement.style.setProperty(k,v))}>浅色</button>
    </div>
    {interrupted ? <p>对话已中断</p>
    : mode==='question' ? <AskUserQuestionApproval key={generation} supportsQuestionSkip={supportsSkip}
        request={{requestId:'ask-'+generation,toolName:'AskUserQuestion',description:'请选择',input:questionInput('thread-ask', questions.map((q,i)=>({...q,multiSelect:multi&&i===0})))}}
        onSubmit={submit} onReject={reject} onInterrupt={interrupt} />
    : mode==='plan' ? <AskUserQuestionApproval key={'plan-'+generation+':'+planThread} taskMode="plan"
        request={{requestId:'plan-'+generation,toolName:'AskUserQuestion',description:'请选择',input:questionInput(planThread, questions)}}
        onSubmit={submit} onReject={reject} onInterrupt={interrupt} />
    : mode==='planText' ? <AskUserQuestionApproval key={generation} taskMode="plan"
        request={{requestId:'plantext-'+generation,toolName:'AskUserQuestion',description:'请选择',input:questionInput('thread-plantext', [textQuestion])}}
        onSubmit={submit} onReject={reject} onInterrupt={interrupt} />
    : mode==='approval'||mode==='approvalFresh' ? <PlanApprovalCard key={generation} approval={planApproval} freshAvailable={mode==='approvalFresh'}
        onRespond={async (response)=>{ window.responses.push(response); if(window.asyncResponse) return new Promise((resolve,reject)=>{ window.resolveResponse=resolve; window.rejectResponse=reject; }); }}
        onOpenPlan={(plan)=>window.openedPlans.push(plan)} />
    : mode==='twins' ? [0,1].map(owner=><div data-owner={owner} key={owner}>
        <AskUserQuestionApproval supportsQuestionSkip request={{requestId:'owner-'+owner,toolName:'AskUserQuestion',description:'请选择',input:questionInput('thread-owner-'+owner, questions)}} onSubmit={()=>{}} onReject={()=>{window.ownerActions.push(owner)}} />
      </div>)
    : mode==='permission'||mode==='grant' ? <InlineApprovalCard request={{requestId:mode,toolName:'Bash',description:'为验证本次修改运行测试',input:{command:'bun test'},...(mode==='grant'?{requestKind:'permission-grant',permissionGrant:{allowedScopes:['tool-call','turn'],requestedScope:'tool-call',requestedPermissions:{readPaths:['F:/workspace/src'],networkDomains:['example.com']}}}:{})}} onDecide={(_request,behavior,_always,_input,extras)=>{window.decisions.push({requestId:_request.requestId,behavior,extras});return new Promise((resolve,reject)=>{window.resolveDecision=resolve;window.rejectDecision=reject})}} />
    : null}
  </main>;
}
resetState();
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
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
  const plan = page.locator('.request-card[data-variant="plan"]')
  const count = () => page.evaluate('window.submissions.length')
  const mode = (name: string) => page.getByRole('button', { name, exact: true }).click()
  const choice = (label: string) => card.getByRole('radio').filter({ hasText: label })
  const next = card.getByRole('button', { name: '下一题', exact: true })
  const previous = card.getByRole('button', { name: '上一题', exact: true })
  const submitAnswer = card.getByRole('button', { name: '提交回答', exact: true })
  const customInput = card.getByRole('textbox', { name: '自定义回答' })
  const stopTurn = card.getByRole('button', { name: '停止本轮', exact: true })

  // ---------------------------------------------------------------- chat 提问
  await mode('聊天提问')
  await expect(card).toContainText('1 of 3')
  const pagination = card.getByRole('group', { name: '问题分页', exact: true })
  await expect(pagination.getByRole('button')).toHaveCount(2)
  await expect(pagination).toContainText('1 of 3')
  await expect(previous).toBeDisabled()
  await expect(card.locator('h3')).toHaveCount(1)
  // Chat 保留首项预选与「（推荐）」文本提示。
  await expect(choice('仅桌面端')).toHaveAttribute('aria-checked', 'true')
  await expect(choice('仅桌面端')).toContainText('（推荐）')
  await expect(card.locator('.ask-user-question-actions').getByRole('button')).toHaveCount(1)

  // 点击选项只更新草稿，不再自动跳题。
  await choice('桌面端与 CLI').click()
  await expect(card).toContainText('1 of 3')
  assert.equal(await count(), 0)
  await expect(choice('桌面端与 CLI')).toHaveAttribute('aria-checked', 'true')
  await next.click()
  await expect(card).toContainText('2 of 3')
  // 返回修改：已答草稿保留。
  await previous.click()
  await expect(choice('桌面端与 CLI')).toHaveAttribute('aria-checked', 'true')
  await next.click()

  // 自定义回答、换行、中文输入法 composing 与 Enter 确认。
  await expect(next).toBeEnabled()
  await customInput.focus()
  await expect(choice('提问交互')).toHaveAttribute('aria-checked', 'false')
  await customInput.fill('中文自定义回答')
  await customInput.press('ArrowLeft')
  await customInput.press('Shift+Enter')
  await expect(customInput).toHaveValue('中文自定义回\n答')
  await expect(card).toContainText('2 of 3')
  await customInput.evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    ),
  )
  await expect(card).toContainText('2 of 3')
  await customInput.press('Enter')
  await expect(card).toContainText('3 of 3')
  await expect(next).toBeDisabled()

  // 最后一题：跳过能力开关与提交。
  const skip = card.getByRole('button', { name: '跳过当前问题' })
  await expect(skip).toBeVisible()
  await page.getByRole('button', { name: '切换跳过能力', exact: true }).click()
  await expect(skip).toBeDisabled()
  await expect(card).toContainText('请升级并重启 Agent')
  await page.getByRole('button', { name: '切换跳过能力', exact: true }).click()
  await expect(skip).toBeEnabled()
  await choice('暂时没有').click()
  await card.getByRole('button', { name: '提交', exact: true }).click()
  await expect.poll(count).toBe(1)
  assert.deepEqual(await page.evaluate('window.submissions[0].answers'), {
    scope: '桌面端与 CLI',
    phase: '中文自定义回\n答',
    extra: '暂时没有',
  })

  // Chat 的 Escape 仍然忽略整组问题。
  await mode('聊天提问')
  await card.press('Escape')
  assert.equal(await page.evaluate('window.rejects'), 1)
  assert.equal(await count(), 0)

  // 中断失败保留草稿并可重试。
  await mode('聊天提问')
  await customInput.fill('保留中断失败时的草稿')
  const chatInterrupt = card.getByRole('button', { name: '中断当前对话' })
  await chatInterrupt.click()
  await expect(chatInterrupt).toBeDisabled()
  await expect(customInput).toBeDisabled()
  await page.evaluate('window.rejectInterrupt(new Error("中断失败"))')
  await expect(card.locator('.ask-user-question-error')).toContainText('中断')
  await expect(customInput).toHaveValue('保留中断失败时的草稿')
  await expect(chatInterrupt).toBeEnabled()

  // 多选：点击不自动翻题，最后统一提交一次。
  await mode('聊天提问')
  await page.getByRole('button', { name: '多选', exact: true }).click()
  await card.getByRole('checkbox').filter({ hasText: '桌面端与 CLI' }).click()
  await expect(card).toContainText('1 of 3')
  await next.click()
  await choice('提问交互').click()
  await next.click()
  await choice('暂时没有').click()
  await card.getByRole('button', { name: '提交', exact: true }).click()
  await expect.poll(count).toBe(1)
  assert.deepEqual(await page.evaluate('window.submissions[0].answers'), {
    scope: '桌面端与 CLI',
    phase: '提问交互',
    extra: '暂时没有',
  })

  // 提交失败：就地提示、保留草稿、重试复用同一次提交路径。
  await mode('聊天提问')
  await page.evaluate('window.asyncSubmission=true')
  await choice('桌面端与 CLI').click()
  await next.click()
  await customInput.fill('失败重试草稿')
  await next.click()
  await choice('暂时没有').click()
  const chatSubmit = card.getByRole('button', { name: '提交', exact: true })
  await chatSubmit.click()
  await expect.poll(count).toBe(1)
  await expect(chatSubmit).toBeDisabled()
  await expect(choice('暂时没有')).toBeDisabled()
  await page.evaluate('window.rejectSubmission(new Error("请求失败"))')
  await expect(card).toContainText('提交回答失败，请重试。')
  await expect(choice('暂时没有')).toHaveAttribute('aria-checked', 'true')
  await chatSubmit.click()
  await expect.poll(count).toBe(2)
  await page.evaluate('window.resolveSubmission()')

  // ------------------------------------------------------- plan 提问（逐题确认）
  await mode('计划提问')
  await expect(card).toContainText('需要你确认')
  await expect(card).toContainText('1 / 3')
  // 初始没有选中答案，推荐只是徽标。
  assert.equal(await card.locator('[aria-checked="true"]').count(), 0)
  await expect(choice('仅桌面端')).toHaveAttribute('aria-checked', 'false')
  await expect(card.locator('.ask-user-question-recommendation')).toHaveText('推荐')
  // Plan 没有跳过，结束等待只能点「停止本轮」。
  assert.equal(await card.getByRole('button', { name: '跳过当前问题' }).count(), 0)
  assert.equal(await card.getByRole('button', { name: '跳过', exact: true }).count(), 0)
  await expect(stopTurn).toBeVisible()
  // 未选答案不能翻题。
  await expect(next).toBeDisabled()

  // 点击选项只更新草稿，不自动翻题，且单选选中后单选态明确。
  await choice('仅桌面端').click()
  await expect(card).toContainText('1 / 3')
  assert.equal(await count(), 0)
  await expect(choice('仅桌面端')).toHaveAttribute('aria-checked', 'true')
  await expect(next).toBeEnabled()
  await expect(card.getByRole('button', { name: '第 1 题（已答）' })).toBeVisible()
  await expect(card.getByRole('button', { name: '第 2 题（待答）' })).toBeVisible()

  // 方向键只移动焦点，不改变答案。
  await choice('仅桌面端').focus()
  await choice('仅桌面端').press('ArrowDown')
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('aria-checked')),
    'false',
  )
  assert.equal(
    await page.evaluate(() => (document.activeElement?.textContent ?? '').includes('桌面端与 CLI')),
    true,
  )
  await expect(choice('仅桌面端')).toHaveAttribute('aria-checked', 'true')

  // 单选与自定义回答互斥。
  await customInput.focus()
  await expect(choice('仅桌面端')).toHaveAttribute('aria-checked', 'true')
  await customInput.fill('自定义覆盖')
  await expect(choice('仅桌面端')).toHaveAttribute('aria-checked', 'false')
  await choice('仅桌面端').click()
  await expect(customInput).toHaveValue('')

  // 文本框：Enter 换行、Ctrl+Enter 确认、中文输入法 composing 不确认。
  await customInput.click()
  await customInput.fill('第一行')
  await customInput.press('Enter')
  await page.keyboard.insertText('第二行')
  await expect(customInput).toHaveValue('第一行\n第二行')
  await expect(card).toContainText('1 / 3')
  await customInput.evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    ),
  )
  await expect(card).toContainText('1 / 3')
  await customInput.press('Control+Enter')
  await expect(card).toContainText('2 / 3')

  // Escape 只退出当前编辑焦点，不忽略整组问题、不中断。
  await mode('计划提问')
  await choice('仅桌面端').click()
  await card.press('Escape')
  await expect(card).toContainText('1 / 3')
  assert.equal(await page.evaluate('window.rejects'), 0)
  assert.equal(await page.evaluate('window.interrupts'), 0)
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true)

  // 缺答时定位首个缺答问题，不会提交；补答后统一提交使用最新答案。
  await mode('计划提问')
  await choice('仅桌面端').click()
  await card.getByRole('button', { name: '第 3 题（待答）' }).click()
  await expect(card).toContainText('3 / 3')
  await choice('暂时没有').click()
  await submitAnswer.click()
  await expect(card).toContainText('请回答必答问题后再提交。')
  // 首个缺答的是第 2 题，而不是停留在最后一题。
  await expect(card).toContainText('2 / 3')
  assert.equal(await count(), 0)
  await choice('提问交互').click()
  // 返回上一题修改，最终提交使用最新答案。
  await previous.click()
  await expect(card).toContainText('1 / 3')
  await choice('桌面端与 CLI').click()
  await card.getByRole('button', { name: '第 3 题（已答）' }).click()
  await expect(card).toContainText('3 / 3')
  await submitAnswer.click()
  await expect.poll(count).toBe(1)
  assert.deepEqual(await page.evaluate('window.submissions[0].answers'), {
    scope: '桌面端与 CLI',
    phase: '提问交互',
    extra: '暂时没有',
  })

  // 「停止本轮」走现有中断链路；中断失败保留草稿。
  await mode('计划提问')
  await customInput.fill('停止前的草稿')
  await stopTurn.click()
  assert.equal(await page.evaluate('window.interrupts'), 1)
  assert.equal(await page.evaluate('window.rejects'), 0)
  await expect(stopTurn).toBeDisabled()
  await expect(customInput).toBeDisabled()
  await page.evaluate('window.rejectInterrupt(new Error("中断失败"))')
  await expect(card.locator('.ask-user-question-error')).toContainText('中断')
  await expect(customInput).toHaveValue('停止前的草稿')
  await expect(stopTurn).toBeEnabled()
  await stopTurn.click()
  assert.equal(await page.evaluate('window.interrupts'), 2)
  await page.evaluate('window.resolveInterrupt()')
  await expect(card).toHaveCount(0)
  await expect(page.getByText('对话已中断', { exact: true })).toBeVisible()

  // 提交失败：锁定动作、就地提示、保留草稿并可重试。
  await mode('计划提问')
  await page.evaluate('window.asyncSubmission=true')
  await choice('仅桌面端').click()
  await next.click()
  await choice('提问交互').click()
  await next.click()
  await choice('暂时没有').click()
  await submitAnswer.click()
  await expect.poll(count).toBe(1)
  await expect(submitAnswer).toBeDisabled()
  await expect(stopTurn).toBeDisabled()
  await page.evaluate('window.rejectSubmission(new Error("提交失败"))')
  await expect(card).toContainText('提交回答失败，请重试。')
  await expect(choice('暂时没有')).toHaveAttribute('aria-checked', 'true')
  await submitAnswer.click()
  await expect.poll(count).toBe(2)
  await page.evaluate('window.resolveSubmission()')

  // 纯文本题只展示输入区，不保留空选项列表。
  await mode('纯文本计划题')
  assert.equal(await card.locator('[role="radiogroup"]').count(), 0)
  assert.equal(await card.getByRole('radio').count(), 0)
  await expect(card.locator('.inline-approval-option.custom')).toHaveCount(1)
  await expect(card).not.toContainText('自己回答')
  await expect(submitAnswer).toBeEnabled()
  await submitAnswer.click()
  await expect(card).toContainText('请回答必答问题后再提交。')
  await customInput.fill('只有文本回答')
  await submitAnswer.click()
  await expect.poll(count).toBe(1)
  assert.deepEqual(await page.evaluate('window.submissions[0].answers'), { free: '只有文本回答' })

  // 会话切换：Plan 草稿按聊天隔离，切走再回来仍保留，且不写入浏览器存储。
  await mode('计划提问')
  await choice('仅桌面端').click()
  await next.click()
  await customInput.fill('聊天 A 的草稿')
  await expect(card).toContainText('2 / 3')
  await page.getByRole('button', { name: '切换聊天', exact: true }).click()
  // 新聊天不继承上一聊天的答案与草稿。
  await expect(card).toContainText('1 / 3')
  assert.equal(await card.locator('[aria-checked="true"]').count(), 0)
  await expect(customInput).toHaveValue('')
  await customInput.fill('聊天 B 的草稿')
  await expect(card).toContainText('1 / 3')
  // 切回原聊天：题号与草稿都保留，未被另一个聊天覆盖。
  await page.getByRole('button', { name: '切换聊天', exact: true }).click()
  await expect(card).toContainText('2 / 3')
  await expect(customInput).toHaveValue('聊天 A 的草稿')
  await previous.click()
  await expect(card).toContainText('1 / 3')
  await expect(choice('仅桌面端')).toHaveAttribute('aria-checked', 'true')
  await expect(customInput).toHaveValue('')
  assert.equal(await page.evaluate('window.rejects'), 0)
  // 再切到另一个聊天：它的草稿同样独立保留。
  await page.getByRole('button', { name: '切换聊天', exact: true }).click()
  await expect(card).toContainText('1 / 3')
  await expect(customInput).toHaveValue('聊天 B 的草稿')
  // 草稿只活在 Renderer 生命周期内，不写浏览器持久存储。
  assert.equal(
    await page.evaluate(() => window.localStorage.length + window.sessionStorage.length),
    0,
  )

  // ------------------------------------------------------------ plan 审阅动作
  await mode('计划审批')
  await expect(plan).toContainText('计划已准备好')
  await expect(plan).toContainText('Plan 流程与交互重设计')
  assert.equal(await plan.getByRole('radio').count(), 0)
  await expect(plan).not.toContainText('继续规划')
  await expect(plan.getByRole('button', { name: '修改计划', exact: true })).toBeVisible()
  await expect(plan.getByRole('button', { name: '开始实施', exact: true })).toBeVisible()
  await expect(plan.getByRole('button', { name: '退出 Plan', exact: true })).toBeVisible()
  // 未协商新聊天能力时不显示更多实施方式。
  assert.equal(await plan.getByRole('button', { name: '更多实施方式' }).count(), 0)
  // 查看全文携带计划身份。
  await plan.getByRole('button', { name: '查看全文', exact: true }).click()
  assert.deepEqual(await page.evaluate('window.openedPlans[0]'), {
    planItemId: 'turn-1:plan',
    threadId: 'thread-1',
    title: 'Plan 流程与交互重设计',
    content: '# 计划',
    openable: true,
  })
  // 开始实施是唯一主要动作，默认在当前聊天实施。
  await plan.getByRole('button', { name: '开始实施', exact: true }).click()
  assert.deepEqual(await page.evaluate('window.responses[0]'), { action: 'implement' })

  await mode('计划审批')
  await plan.getByRole('button', { name: '退出 Plan', exact: true }).click()
  assert.deepEqual(await page.evaluate('window.responses[0]'), { action: 'close' })

  await mode('计划审批-新聊天能力')
  await plan.getByRole('button', { name: '更多实施方式', exact: true }).click()
  await page.getByRole('menuitem', { name: '在新聊天中实施', exact: true }).click()
  assert.deepEqual(await page.evaluate('window.responses[0]'), { action: 'implementFresh' })

  // 修改计划：展开反馈输入区，编辑时不显示可点击的实施动作。
  await mode('计划审批')
  await plan.getByRole('button', { name: '修改计划', exact: true }).click()
  assert.equal(await plan.getByRole('button', { name: '开始实施', exact: true }).count(), 0)
  const feedback = plan.getByRole('textbox')
  await feedback.fill('先完成提问交互')
  // Escape 退出反馈编辑：不发送、不关闭、草稿保留。
  await feedback.press('Escape')
  await expect(plan.getByRole('button', { name: '开始实施', exact: true })).toBeVisible()
  assert.deepEqual(await page.evaluate('window.responses'), [])
  await plan.getByRole('button', { name: '修改计划', exact: true }).click()
  await expect(feedback).toHaveValue('先完成提问交互')
  await plan.getByRole('button', { name: '取消修改', exact: true }).click()
  await expect(plan.getByRole('button', { name: '开始实施', exact: true })).toBeVisible()
  await plan.getByRole('button', { name: '修改计划', exact: true }).click()
  await expect(feedback).toHaveValue('先完成提问交互')
  await feedback.fill('先完成提问交互，计划侧栏放到下一阶段')
  await plan.getByRole('button', { name: '发送修改意见', exact: true }).click()
  assert.deepEqual(await page.evaluate('window.responses[0]'), {
    action: 'feedback',
    feedback: '先完成提问交互，计划侧栏放到下一阶段',
  })

  // 提交中锁定动作并显示实际动作文案；失败就地提示后恢复。
  await mode('计划审批')
  await page.evaluate('window.asyncResponse=true')
  await plan.getByRole('button', { name: '开始实施', exact: true }).click()
  await expect(plan.getByRole('button', { name: '正在开始实施…', exact: true })).toBeVisible()
  await expect(plan.getByRole('button', { name: '修改计划', exact: true })).toBeDisabled()
  await expect(plan.getByRole('button', { name: '退出 Plan', exact: true })).toBeDisabled()
  await page.evaluate('window.rejectResponse(new Error("失败"))')
  await expect(plan.getByRole('alert')).toContainText('操作失败')
  await expect(plan.getByRole('button', { name: '开始实施', exact: true })).toBeEnabled()

  await mode('计划审批')
  await page.screenshot({ path: resolve(tmpdir(), 'pidex-plan-approval-light.png') })
  await page.getByRole('button', { name: '深色', exact: true }).click()
  await page.screenshot({ path: resolve(tmpdir(), 'pidex-plan-approval-dark.png') })
  await mode('计划提问')
  await page.screenshot({ path: resolve(tmpdir(), 'pidex-plan-question-dark.png') })
  await page.getByRole('button', { name: '浅色', exact: true }).click()
  await page.screenshot({ path: resolve(tmpdir(), 'pidex-plan-question-light.png') })

  // ------------------------------------------------------------- 并排隔离
  await mode('并排问题')
  const owner0 = page.locator('[data-owner="0"]')
  const owner1 = page.locator('[data-owner="1"]')
  await owner0.locator('.ask-user-question-approval').press('ArrowRight')
  await expect(owner0).toContainText('2 of 3')
  await expect(owner1).toContainText('1 of 3')
  await owner0.getByRole('textbox', { name: '自定义回答' }).press('Escape')
  assert.deepEqual(await page.evaluate('window.ownerActions'), [0])

  // ------------------------------------------------------------- 权限与授权
  await mode('权限')
  const permission = page.locator('.request-card[data-variant="permission"]')
  await expect(permission).toContainText('为验证本次修改运行测试')
  await expect(permission.getByRole('radio')).toHaveCount(0)
  await expect(permission.getByRole('textbox')).toHaveCount(0)
  const allow = permission.getByRole('button', { name: '允许一次', exact: true })
  await allow.click()
  await expect(allow).toBeDisabled()
  await expect(permission.getByRole('button', { name: '拒绝', exact: true })).toBeDisabled()
  await page.evaluate('window.rejectDecision(new Error("失败"))')
  await expect(permission.getByRole('alert')).toContainText('操作失败')
  await permission.getByRole('button', { name: '拒绝', exact: true }).click()
  assert.deepEqual(await page.evaluate('window.decisions.map((x)=>x.behavior)'), ['allow', 'deny'])
  await page.evaluate('window.resolveDecision()')

  await mode('授权范围')
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

  assert.deepEqual(errors, [])
  console.log(
    'Chat 提问、Plan 逐题确认、Plan 审阅动作与权限卡的交互检查全部通过。截图目录：' +
      tmpdir(),
  )
} finally {
  await browser.close()
}
