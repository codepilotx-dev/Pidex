# 参与贡献

感谢你改进 Pidex。这个仓库是 Windows-first 的 TypeScript monorepo，统一使用 Bun 1.3.14。提交变更前，请先阅读根目录 `AGENTS.md`、本文件和所修改目录下更具体的 `AGENTS.md`。

参与本项目即表示你同意遵守 [行为准则](CODE_OF_CONDUCT.md)。安全漏洞请按 [安全策略](SECURITY.md) 私密报告，不要创建公开 Issue。

## 开始之前

1. 搜索已有 Issue 和 Pull Request，避免重复工作。
2. 对架构、协议、数据迁移、兼容性或大范围界面改动，先创建 Issue 说明问题、边界和方案。
3. 小型修复可直接提交 Pull Request，但仍需说明用户影响和验证结果。
4. 不要提交凭据、真实会话、用户数据、签名证书或含敏感绝对路径的日志。

## 开发环境

需要 Windows、Git 和 Bun 1.3.14。

```powershell
git clone https://github.com/codepilotx-dev/Pidex.git
Set-Location Pidex
bun install --frozen-lockfile
bun run dev
```

不要更换包管理器或提交其他锁文件。未经明确架构决策，不得新增、合并、删除或重新划分 workspace。

## 选择改动位置

- `apps/agent/`：会话、SQLite、Provider、工具、权限、编排和 HTTP/SSE。
- `apps/desktop/electron/`：Electron 主进程、preload、窗口、sidecar 与 Windows 打包。
- `apps/desktop/renderer/`：React + Vite 界面。
- `packages/`：共享领域契约、RPC 协议、投影、模型 schema 和运行时。

优先复用、移动或改造现有实现。不要为同一职责创建平行实现，也不要顺手整理与当前改动无关的文件。

## 分支与提交

从最新 `dev` 创建短生命周期分支，并将日常贡献 Pull Request 提交到 `dev`；`main` 仅通过发布合并更新。建议使用清晰的类别前缀，例如 `feat/`、`fix/`、`docs/` 或 `codex/`。

提交使用中文 Conventional Commit，冒号使用全角字符：

```text
feat(desktop)：新增会话筛选
fix(agent)：修复中断恢复事件顺序
docs(repo)：补充贡献指南
```

每个提交应只包含一个可解释、可验证的逻辑变更。不要改写其他贡献者的历史，也不要将无关生成物放入提交。

## 变更记录

除仅修改 `CHANGELOG.md` 外，每个代码、配置或文档变更都必须在 `CHANGELOG.md` 的 `Unreleased` 区段新增至少一条记录：

```text
- [作用域] 中文说明
```

按 `Added`、`Changed`、`Fixed`、`Deprecated`、`Removed` 或 `Security` 分类。说明“做了什么以及影响”，不要只写文件名。

## 验证

先运行受影响 workspace 的类型检查和相关测试，再根据改动范围扩大验证。常用命令：

```powershell
bun run typecheck
bun run build:agent
bun run build:renderer
bun run build:desktop
bun run --cwd apps/desktop/renderer css:check
git diff --check
```

- RPC、共享契约、数据 schema 或 preload 变更必须验证所有消费者。
- Renderer 目录或 lazy import 变更必须运行 `bun run build:renderer`。
- 只有修改打包、签名或发布行为时才运行 `bun run package:win`。
- 只添加能保护本次行为的必要测试，不要添加无关快照或大面积基线更新。

无法运行某项检查时，请在 Pull Request 中说明原因、风险和替代验证，不能用“应该可以”代替证据。

## 提交 Pull Request

使用仓库的 Pull Request 模板，并确保：

- 标题和摘要说明用户可见影响；
- 关联 Issue 或解释为何无需 Issue；
- 列出实际运行的验证命令和结果；
- 说明协议、数据、权限、隐私、发布或兼容性影响；
- 包含 `Unreleased` 记录；
- 不含凭据、用户数据、构建产物或无关改动。

维护者可能要求拆分过大的 Pull Request、补充验证或调整方案。评审意见针对改动本身；请保持讨论具体、尊重并可复现。

## 许可证

除非你明确另行说明，否则你有意提交并被项目接收的贡献将按照 [Apache License 2.0](LICENSE) 授权，符合该许可证第 5 节的约定。请只提交你有权授权的内容，并保留所有必要的第三方归属与许可证通知。
