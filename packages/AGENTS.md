# AGENTS.md

## 适用范围

本文件适用于 `packages/` 下所有 workspace，补充根目录 [`AGENTS.md`](../AGENTS.md) 的 package 实现与验证细则，不得弱化根规则。

## 包职责、目录与依赖方向

- `model-schema`：定义 Provider、model、integration、connection 和 credential 的基础 schema；保持轻量目录，禁止为生成型 `material-icon-theme` 或小型 `model-schema` 强制增加无意义子目录。
- `shared`：定义跨进程复用的应用领域模型；`shared/src/thread/` 按 permission、settings、items、queue、subagent 和 transport/domain boundary 维护，不拥有 RPC 编排类型。
- `agent-protocol`：Desktop 与未来 CLI/TUI 的唯一 v4 method、event、wire error、capability 和 runtime dispatcher 协议来源；`src/` 按 `methods/`、`wire/`、`runtime/` 维护。表面差异通过 capability、可选字段和客户端 adapter 表达，禁止复制协议类型或建立 Desktop/CLI 两套事件。
- `session-view`：所有交互客户端的唯一 canonical projection 与 thread projection 纯转换层（`src/` 保持 canonical 与 thread 分离）。客户端只能在投影结果上附加自身操作和展示，禁止重新解释 durable snapshot 或 transport event，禁止新增旧 timeline 兼容层。
- 依赖方向：依赖必须沿公开契约单向流动，禁止复制底层 schema 或制造循环依赖；`shared`、`agent-protocol` 和 `session-view` 不得依赖 Electron、DOM、React、终端渲染库或具体 CLI 参数解析器。

## Provider 与上游代码 (`pi-ai`)

- 单一基础引擎：Provider、模型目录、请求与 OAuth 统一由 `pi-ai` 提供。Pidex 只维护 Pi 配置门面、加密活动凭据绑定和产品编排（Pi Provider 配置解析、自定义 Provider factory、模型缓存与凭据适配保持为独立模块）；禁止恢复独立/平行 Provider plugin 或 runtime，禁止恢复运行时 npm 安装、任意文件插件、不受限 dynamic import 或外部插件执行。
- 回退与凭据红线：禁止恢复 API Key 自动轮换或自动切换，禁止用笼统的 `failover` 表述引入新的凭据或 Provider 自动切换策略；除非任务明确改变，必须保留当前可从代码定位的非凭据回退行为、Provider 注册顺序、安全过滤、静态 allowlist 和错误规范化。
- 上游代码治理：修改包含上游来源的 package 时必须遵守对应 `UPSTREAM.md`，保留上游署名和许可证并优先复制或改造已有上游实现；package 上游同步时必须更新来源、导入日期及 checksum/revision。

## 公开接口与兼容策略

- 导出边界：公共 API 仅通过包级 `src/index.ts` 或明确的 `package.json` export 暴露，消费者禁止 deep import 内部文件；只允许包级公开入口和稳定门面使用 `index.ts`，禁止构造全仓 barrel。
- 契约变更：开发阶段的 TypeScript、RPC method/event 和包级公开契约可以一次性变更，但必须在同一变更中迁移仓库内所有当前消费者；该一次性迁移规则不适用于已落盘用户数据（持久化 schema 始终遵守根文件的数据兼容和未知数据保护要求）。
- 兼容导出限制：普通 package API 只有在用户明确要求时才能添加 compatibility export，且不得用于恢复根规则禁止的旧协议、旧客户端 migration adapter、双协议分支或平行存储。

## 验证

- 运行受影响 package 的 typecheck；只有行为变化或存在相关回归风险时才运行 package 测试。
- 公共契约变化时，必须同时验证所有受影响的 Agent、Electron 和 Renderer（及未来 CLI）消费者，并运行根目录 `bun run typecheck`。
- 仅当修改协议、兼容层、导出或相关路径时，搜索对应 v3、legacy、migration export 和旧路径残留。
