# 浏览器选择与批注

网页内选择元素、DOM 文本或矩形区域，填写非空反馈，默认捕获可见网页截图，保存到指定聊天草稿。保存后继续标注，由用户在聊天中统一发送。Shift 切换元素多选；Esc 先取消编辑再退出选择。编辑器使用网页内 Shadow DOM 与 top-layer popover，不创建窗口。

Renderer 的 ComposerDraftStore 是批注及未完成反馈的唯一真源。交互开始时固定 draftKey，页面回调不通过焦点推断聊天。Electron 仅管理窗口、标签、generation、documentId、隔离执行 context 和随机交互 ID，校验后负责注入与截图。普通网页不暴露 IPC。接管、导航、崩溃和关闭使交互失效，迟到结果不写入草稿。

锚点包含页面/frame、selector、名称、文本、矩形和滚动信息；运行时引用优先，后备 selector 必须唯一且名称/文本匹配，否则失效。仅穿透开放 Shadow DOM 和同源 iframe。HTML 默认不采集；明确开启后截断并移除脚本、事件属性及根节点和后代表单值。

截图先隐藏编辑器与悬停提示，保留目标高亮，等待渲染再捕获，始终恢复状态。截图失败保留编辑内容，可重试或明确仅保存文字。批注截图不操作剪贴板、历史和日志。独立截图菜单仍复制到剪贴板并加入聊天。

批注清单通过现有 application/json 文本附件提交，格式 pidex.browser-annotations、schemaVersion 1，图片为独立 PNG，以文件名关联。最多 8 个附件，托管附件总计 25 MiB，清单最多 1 MiB，截图最多 8 MiB。保存先验证整组容量再原子更新，不部分保存。未知清单按普通附件显示。

草稿切换保留、重启不恢复；已发送内容沿既有附件服务保存。成功/排队确认按 clientId 清理已提交内容，失败保持内容。已保存页面快照可发送；跨文档不自动恢复旧标记。无新 Agent RPC、数据库表、浮动窗口、直接发送、设计修改或站点主动批注 API。

验收：三种选择、Shift 多选、Esc、同源 iframe/Shadow DOM、表单脱敏、滚动/缩放/设备模式、编辑和删除联动、截图失败与容量限制、聊天切换和 handoff、迟到回调、提交失败与并发新增草稿、清单附件往返。UI 人工验收，不逐帧自动点击。

卡片中尚未保存的反馈编辑也保存在聊天草稿，发送前要求保存或取消该编辑。新聊天 handoff 或发送确认使 clientId 变化时，停止旧选择交互；未完成页面反馈仍留在对应草稿，重新开启后选择目标继续编辑。

## 实施验证（2026-10-04）

- 相关 Electron、Renderer、共享契约、协议和 Agent 附件测试通过；另用独立 Chrome 网页夹具验证 DOM 命中、跨域外层 iframe、Shadow DOM、Range、区域、多选、HTML 脱敏与真实 CDP binding/context 隔离，结束关闭测试浏览器。
- 根目录 `bun run typecheck`、Agent/Renderer/Desktop 三层构建、Renderer `css:check` 和 `git diff --check` 通过。Renderer 构建有现有 CSS 预算和大 chunk 警告，未修改预算基线。
- 扩大检查运行 1516 项测试：1504 通过，12 项非批注失败，位于 Renderer 的 `AutomationCalendar.test.ts`、`CanonicalPatchCard.test.tsx`、`CanonicalThreadSwitch.test.tsx`、`ConversationFork.test.tsx`、`DesktopClientSkills.test.ts`、`ExecutionPlanCard.test.tsx`、`SidebarNavigation.test.ts` 以及 `SummarizeProcessItems.test.ts`（5 项）。本次不扩展修复这些断言。
- 全仓 `format:check` 报告 36 个并行电脑控制文件未格式化；批注涉及文件已格式化，保留其他工作区改动。本次不提交。
