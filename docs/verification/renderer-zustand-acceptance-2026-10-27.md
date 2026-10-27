# Pidex Renderer 共享状态 Zustand 全量迁移 — Computer Use 人工验收报告

- 日期：2026-10-27
- 工作树：`F:/CodeProject/CodePilotX-worktrees/provider-store-zustand`，分支 `codex/provider-store-zustand`（未提交）
- 验收方式：`bun run dev:agent` + `bun run dev:desktop`（PIDEX_DATA_DIR 指向 `.verify-data` 隔离目录，未复制真实凭据，未触碰用户自有实例 PID 110392）
- 实例：worktree Electron PID 106396，Renderer `http://127.0.0.1:10939/`（Vite 返回 200 正常）

## 结论：失败（启动即崩溃，场景 1–9 全部未验证）

窗口首次加载与"重新加载"后均落入 `页面暂时无法显示` 错误页；React 错误边界捕获后无法恢复。自动化对照（1724 测试通过、typecheck/build/lint/diff 全部通过）无法覆盖该缺陷：单元测试没有真实 React 挂载，`ComposerDraftStore` 的通知语义变化只在桌面运行路径上形成闭环。

## 根因（证据摘录）

`desktop.jsonl` 反复记录（20:19–20:21 多次重载，间隔约 10 秒共 25 条）：

```
Maximum update depth exceeded. This can happen when a component calls setState inside useEffect...
React Router caught the following error during render Error: Maximum update depth exceeded...
The above error occurred in the <DesktopComposer> component.
```

崩溃环位于本次迁移的两处交互：

1. `apps/desktop/renderer/src/features/session/composer/UseDesktopComposerController.ts`
   - 新增订阅：`useStore(composerDraftStore.store, (state) => state.drafts[draftKey])`；
   - 派生 effect（约 277–288 行）：draft 变化 → `setContextTokens`/`setSelectedSkillTokens`/`updateGoalModeEnabled`；
   - 写回 effect（约 295–301 行）：`composerDocument`（由上述派生 state 参与 useMemo）变化 → `composerDraftStore.update(...)`。
2. `apps/desktop/renderer/src/features/session/composer/ComposerDraftStore.ts`
   - `#write()` 走 `store.setState`，**每次写入都通知订阅者**；旧实现的 `update()` 不 `#emit()`，因此该环原本不存在。

环：写回 → Store 通知 → `draft` 引用变化 → 派生 setState → `composerDocument` 新引用 → 写回 → …… 每次渲染都产生新的 `composerDocument` 对象（`createComposerDocumentWithSkill` 返回新数组/对象），且 `attachments` 依赖同样每次变化，导致 effect 永不停止。

修复方向（供实施侧参考，本次未改）：写回前用 `composerDocumentsEqual` + 附件 id 比较做幂等跳过，或让 `update()` 保持旧的"静默写入"语义、仅在显式动作时通知。

## 场景结果

| # | 场景 | 结果 | 实际结果 / 复现 | 关键证据 |
|---|------|------|----------------|----------|
| 0 | 启动进入应用 | 失败 | Vite 200；Electron 渲染即错误边界，重载复现 | desktop.jsonl 25× Maximum update depth，指向 DesktopComposer |
| 1 | Provider | 未验证 | 应用不可用 | — |
| 2 | 设置（含换行跨视图同步） | 未验证 | 应用不可用 | — |
| 3 | 工作台/辅助窗口 | 未验证 | 应用不可用 | — |
| 4 | 会话 A/B、Side Chat 隔离 | 未验证 | 应用不可用 | — |
| 5 | 流式完成/停止/切走返回 | 未验证 | 应用不可用 | — |
| 6 | 审批/提问/队列归属 | 未验证 | 应用不可用 | — |
| 7 | 文件多视图/冲突/外部打开同步 | 未验证 | 应用不可用 | — |
| 8 | Review、Git Board、Automation、Pet 双控制器去重 | 未验证 | 应用不可用 | — |
| 9 | 空状态/删除重进/重复导航 | 未验证 | 应用不可用 | — |

## 日志扫描（本次实例窗口）

- `getSnapshot should be cached`：0
- `Maximum update depth exceeded`：25（全部 DesktopComposer）
- `React Router caught`：9
- 未处理 Promise 拒绝 / 重复订阅：0

## 自动化对照（不替代人工）

- 全量测试 1724 pass / 2 fail（InfoTooltip、Button spinner 为基线既有）
- typecheck / build:renderer / oxlint（净 -2） / git diff --check 通过

## 收尾

- 已关闭本次启动的 dev:agent、dev:desktop 及 worktree Electron 进程树；用户自有实例 PID 110392 未触碰。
- `.verify-data` 保留。
