# 外部 Coding Agent 规则

仅在用户明确要求通过 OpenCode 等外部 Coding Agent 执行工作时适用。本文件补充根 `AGENTS.md`，不改变其工作区保护、凭据安全、数据兼容、协议唯一性和提交授权规则。

## 模型资格

- MiniMax 全系列模型（含 `minimax-cn-coding-plan/*`、`opencode/minimax-*` 和 `opencode-go/minimax-*`）仅可做只读文档查阅、代码库探索、检索、解释和方案调研；不得修改工作区或运行会改写仓库的命令。
- 即使用户指定 MiniMax 编码，主 Agent 也不得派发实现工作；应亲自实现，或在用户接受后改用允许编码的模型。MiniMax 结论只可作为线索，不能替代主 Agent 的审查或验收。
- 用户未指定外部模型时，范围明确、行为冻结且涉及 1～3 个生产文件的阶段默认考虑 `deepseek/deepseek-v4-flash`。使用前运行 `opencode models` 确认可用；不可用时只可选同 provider 的可用 DeepSeek 同系模型并记录实际 ID，或由主 Agent 实现。
- 需要较长上下文或多文件改造时，由主 Agent 亲自完成，不得改派 MiniMax 编码。

## 阶段冻结与执行

- 每个阶段只处理一个明确行为，通常覆盖 1～3 个生产文件和 1～2 个必要测试；Harness、存储、恢复、协议和生产接入等多层改造拆成可构建、可验收的串行阶段。
- 每个阶段开始前记录 HEAD、dirty worktree、暂存区和受保护文件 hash；外部 Agent 仅可修改冻结 allowlist。真实依赖要求扩大范围时必须停止报告，不得留下不可构建的中间状态。
- 测试语义一经冻结，不得为变绿删除、跳过、弱化或改写测试；无法满足时保留失败证据并停止。
- 每阶段固定一个模型和独立 session；已确认缺陷回传同一 session。连续三轮未修复、持续越界或测试不诚实时停止该 session，由主 Agent 复核后亲自实现或重新冻结。
- 禁止两个模型同时修改共享 worktree，也禁止对大型核心重构使用长时间无人监管的 `--auto`。外部 Agent 不得执行未授权的 `git stash`、`git reset`、`git checkout`、`git restore`、`git clean`、commit、push、fetch、全仓格式化或依赖更新。
- 不得以无边界 `any`、`as any`、`@ts-ignore`、关闭检查或吞掉错误绕过类型和安全契约；安全拒绝须有明确、可测试且不泄露敏感信息的错误语义。

## 独立验收

- 外部 Agent 的完成声明、测试摘要和绿色构建不作为最终依据。主 Agent 独立检查 diff、allowlist、测试是否被改弱、相关调用方、聚焦测试、相关 typecheck/build 以及 `git diff --check`。
- 新模型或新版本首次接触 Harness、恢复、权限、协议或持久化核心前，先用只新增冻结行为测试的微任务验证范围服从、测试诚实性和类型质量；未通过时不得承接完整核心改造。
