# Pidex Renderer Zustand 迁移 — Composer 启动崩溃修复复验报告

- 日期：2026-10-27
- 工作树：`F:/CodeProject/CodePilotX-worktrees/provider-store-zustand`，分支 `codex/provider-store-zustand`（未提交）
- 对照报告：`docs/verification/renderer-zustand-acceptance-2026-10-27.md`（上次失败，保留未动）
- 启动方式：`bun run dev:agent` + `bun run dev:desktop`，`PIDEX_DATA_DIR` 指向 `.verify-data`；本次运行前轮转旧 `desktop.jsonl` 为 `.prev-crash`。worktree 实例 PID 99972（window 21826728），Vite 端口 4669。主仓用户实例（PID 110392 等）未触碰。
- 修复方式核对（只读）：`UseDesktopComposerController` 将 `goalModeEnabled/contextTokens/selectedSkillTokens` 改为基于 Store 订阅的派生 `useMemo`，写回 effect 以 `composerDocumentsEqual` + `activeDraft.clientId === draftClientIdRef.current` 做幂等守卫，并恢复 `ComposerDraftStore.update()` 的静默语义。

## 结论：启动门槛通过；发现一处新的非致命回归（React duplicate key ×6）

上次 100% 复现的 `Maximum update depth exceeded → 页面暂时无法显示 → 重载复现` 已消除。本次约 15 分钟的连续操作（输入、发送、切页、Side Chat 开合、两次整窗重载、命令菜单）全程未再崩溃。日志中三个目标关键词均为 0 次（上次 25/9 次）。

**新发现**：6 条 `Encountered two children with the same key`（error 级，用户主仓基线日志 0 次）。两次触发簇（21:01:42、21:06:13）各对应一次进入会话页/发送消息，即回归在 Composer/会话消息渲染路径上，与本次迁移改动面重合。当前未观察到可见 UI 重复（正文每个文本只渲染一次），但它属于本次改动引入的新错误，不满足"日志扫描全零"的完成标准，**验收判定为不通过，需实施侧修复后再次复验**。

## 启动门槛（按 prompt 逐项）

| 项 | 结果 | 实际与证据 |
|----|------|-----------|
| 1a 全新启动进入首页，等待 30 秒 | 通过 | 首屏即渲染完整（129 元素：Composer、模型选择、侧栏），静置 30s 无错误页；`desktop.jsonl` 该时段 0 error |
| 1b 重载 | 通过 | Ctrl+R 后 6–8s 完整树恢复首页（129 元素），无错误页、无无限更新 |
| 2 输入文本 | 通过 | 输入"复验草稿文本A"：AX 树 `消息输入框` value 确认落盘，发送按钮由 disabled→enabled，Enter/点发送成功创建会话并进入会话页（标题切为"会话 · Pidex Desktop"）；输入"第二次发送验证"重复成功 |
| 2 添加/移除测试附件 | 未验证（环境限制） | 附件菜单 AXExpand 正常弹出（文件/引用会话/任务规划/计划模式/目标条目齐全）；点击"文件和文件夹"后原生系统"打开"对话框出现，但本环境对原生对话框的文本输入（setValue/键入）全部无效（值恒为空），无法选中文件；对话框已取消关闭 |
| 2 选择/取消 Skill | 未验证 | "引用会话"条目出现在"＋"菜单中（数据来自迁移后的共享状态），但隔离环境无项目/无已安装 Skill 可用，未执行选择动作 |
| 3 A/B 切换、草稿与引用不串 | 通过 | A"复验草稿文本A"发送后首页输入框为空（仅占位"随心输入"），B 首页另输文本；侧栏两行同存；A 会话正文仅含自己的消息（会话页 userMsg=1，标题/侧栏重复出现为正常 DOM 结构）；Side Chat 从"更多会话操作→打开侧边聊天"正常开合，面板独立、关闭无异常 |
| 4 切走再返回 | 通过 | 会话页→新聊天→回会话页往返多次无崩溃、无持续 loading；整窗重载后首页正常、侧栏两会话保留 |

## 原报告场景 1–9

| # | 场景 | 结果 | 说明 |
|---|------|------|------|
| 1 | Provider：首次进入、重载、连接面板、凭据切换与用量刷新 | 部分通过 / 未验证 | 进入供应商页渲染完整（市场、已配置 DeepSeek/Verify Test Provider、模型计数）；页内 Ctrl+R 重载正常。**duplicate key ×6 即出现在进入会话/供应商导航附近**；用量刷新需真实凭据，按要求标未验证（假凭据不证数值） |
| 2 | 设置：修改/保存/取消/切页/重启恢复；主题语言同步；换行跨视图 | 未验证 | 侧栏无可见"设置"入口按钮（供应商页侧栏折叠为图标轨道后，本环境无法枚举到齿轮目标；命令菜单 Ctrl+K 为任务搜索不含设置动作）。设置页未到达，换行同步同理未验证 |
| 3 | 工作台：切换项目、开关面板、调尺寸、标签页、布局恢复、辅助窗口归并 | 部分通过 / 未验证 | 会话页存在"显示标签页/打开底部面板"控件，面板切换触发后无崩溃、无 loading 卡死（元素树验证）；项目切换与辅助窗口弹出-关闭未执行（需真实项目目录，prompt 禁止操作真实项目文件），未验证 |
| 4 | 会话 A/B、模型选择、Side Chat 隔离 | 通过 | 见门槛 3 |
| 5 | 流式会话：完成/停止/切走返回 | 部分通过 | 提交→会话创建→路由切换正文不丢失；停止/切走返回按钮路径未触发（隔离环境无可用凭据的模型不会产出流式响应，正文仅见用户消息）。流式场景本体未验证 |
| 6 | 审批/提问/队列归属 | 未验证 | 无凭据无法产生真实审批/提问 |
| 7 | 文件多视图同步/冲突/外部打开同步 | 未验证 | 需打开真实项目文件，受 prompt 限制未执行 |
| 8 | Review、Git Board、Automation、Pet 双控制器去重 | 未验证 | 侧栏"Git 看板/已安排/插件"按钮在供应商页不可见（折叠轨道），本环境导航受限未到达；Pet 双页面共存未验证 |
| 9 | 空状态、删除后重进、重复导航、重载 | 部分通过 | 重载×3、会话/供应商/首页重复导航均无错误边界或持续 loading；删除会话后重进未执行 |

## 日志扫描

- `Maximum update depth exceeded`：0（上次 25）✅
- `getSnapshot should be cached`：0 ✅
- `React Router caught`：0（上次 9）✅
- 未处理 Promise 拒绝：0 ✅
- **新增错误**：`Encountered two children with the same key, 3bd3bba1-…`（clientId 形态）×6，21:01:42 / 21:06:13 各 3 条；主仓基线日志同项为 0。方向建议：会话消息 key 由 draft `clientId` 派生，写回幂等或 handoff 后可能同时存在新旧 clientId 的两份同一消息投影，请排查 canonical 投影与 `ComposerDraftStore` 写回路径。

## 收尾

- 已关闭本次 dev:agent / dev:desktop（exec_b4f6c78e、exec_cfeb1d07）及 worktree Electron 进程树；主仓用户实例与 `C:\Users\XiaoHi\.pidex` 未触碰。
- `.verify-data` 与旧 `desktop.jsonl.prev-crash`、上份失败报告均保留。
