# ADR: Pidex identity and data locations

Status: Accepted

Date: 2026-10-09

Decision owners: Pidex product and architecture (explicit owner instruction)

## Context

产品已由 CodePilotX 更名为 Pidex Desktop。上一轮更名只改包名、模块命名、产品与安装产物
名称，数据与身份类标识按根 `AGENTS.md` 的数据兼容规则全部保留为 `codepilotx`／`CodePilotX`。
所有者确认：产品尚未发布，本机现有数据全部是测试版数据，因此不再需要承担该兼容义务。

根 `AGENTS.md` 要求改变 application ID、持久化格式标识或数据位置必须取得明确架构决策
（`AGENTS.md:54`、`:56`），并禁止删除整个数据目录（`:60`）。本 ADR 记录该决策及其边界。

## Decision

1. **品牌标识全量清零。** 自有标识统一改为 `pidex`／`Pidex`，包括默认数据根与工作区配置
   目录、`PIDEX_*` 环境变量、Electron `appId`／AppUserModelID 与固定 userData 目录、
   Windows 凭据库服务名、浏览器持久分区、渲染器本地存储前缀、会话 cookie 与 RPC
   connection header、持久化格式标识、git ref 命名空间、应用清单身份与 profile 库
   ownership marker。
2. **不做数据迁移。** 不读取、不复制、不改写、不删除任何旧标识路径下的数据：
   `%USERPROFILE%\.codepilotx`、`%APPDATA%\@codepilotx\desktop-electron`、
   工作区 `.codepilotx\`、`.codepilotx-memory\`、`%USERPROFILE%\Documents\CodePilotX`
   以及 `%ProgramData%\CodePilotX\requirements.toml` 全部原样留在磁盘上。
3. **移除只服务旧品牌的双读分支。** 深链只识别 `pidex://`；不再解析、不再注册
   `codepilotx://`。旧环境变量前缀、旧安装产物清理逻辑一并删除。
4. **保留真实外部名称与历史记录。** GitHub 仓库与发布/更新源
   （`codepilotx-dev/Pidex`；该仓库在品牌清零后由 `codepilotx-dev/CodePilotX` 改名而来，
   属于外部改名而非本 ADR 的代码决策，旧名仍由 GitHub 重定向）、已部署的认证服务
   `auth-staging.codepilotx.top`、
   第三方名称与许可证（ZCode、Codex、`CODEX_HOME`、codexpet.top、`.codex`／`.agents`／
   `.claude` 兼容目录、`cpx`／`CPX-CUA` 缩写）、`.codex/environments/` 下由第三方 CLI
   按仓库目录名自动生成的环境配置、`docs/research/**` 与 `CHANGELOG.md` 历史区段一律不动。

### 变更标识清单

| 类别                        | 变更前                                                                  | 变更后                                                        |
| --------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| Agent 数据根                | `%USERPROFILE%\.codepilotx`                                             | `%USERPROFILE%\.pidex`                                        |
| 工作区配置目录              | `<workspace>\.codepilotx\`                                              | `<workspace>\.pidex\`                                         |
| 记忆数据目录                | `.codepilotx-memory\`                                                   | `.pidex-memory\`                                              |
| 无项目工作区                | `Documents\CodePilotX`、`.codepilotx-projectless.json`                  | `Documents\Pidex`、`.pidex-projectless.json`                  |
| 机器策略                    | `ProgramData\CodePilotX\requirements.toml`                              | `ProgramData\Pidex\requirements.toml`                         |
| Electron userData           | `%APPDATA%\@codepilotx\desktop-electron`                                | `%APPDATA%\Pidex Desktop`                                     |
| 环境变量前缀                | `CODEPILOTX_*`                                                          | `PIDEX_*`                                                     |
| 安装身份                    | `com.codepilotx.desktop`                                                | `com.pidex.desktop`                                           |
| 凭据库服务                  | `com.codepilotx.credentials`                                            | `com.pidex.credentials`                                       |
| 浏览器分区                  | `persist:codepilotx-browser`                                            | `persist:pidex-browser`                                       |
| 本地存储键前缀              | `codepilotx.*`                                                          | `pidex.*`                                                     |
| 凭据仓库格式                | `codepilotx-provider-auth`                                              | `pidex-provider-auth`                                         |
| Pi 模型缓存 owner           | `codepilotx`                                                            | `pidex`                                                       |
| 结果卡信封 kind             | `codepilotx.result-card`                                                | `pidex.result-card`                                           |
| 批注清单与格式              | `codepilotx-browser-annotations.json`、`codepilotx.browser-annotations` | `pidex-browser-annotations.json`、`pidex.browser-annotations` |
| 会话 cookie                 | `codepilotx_session`                                                    | `pidex_session`                                               |
| RPC connection header       | `X-CodePilotX-Connection-ID`                                            | `X-Pidex-Connection-ID`                                       |
| git ref 命名空间            | `refs/codepilotx/`                                                      | `refs/pidex/`                                                 |
| git 身份与分支前缀          | `codepilotx@local.invalid`、`codepilotx/pr-watch-`                      | `pidex@local.invalid`、`pidex/pr-watch-`                      |
| MCP 诊断键 / OAuth 客户端   | `com.codepilotx/diagnostic-context`、`codepilotx`                       | `com.pidex/diagnostic-context`、`pidex`                       |
| release 运行前缀与标记      | `codepilotx-release`、`.codepilotx-release-ownership.json`              | `pidex-release`、`.pidex-release-ownership.json`              |
| 桌面设置键（依赖安装偏好）  | `installCodePilotXDependencies`                                         | `installPidexDependencies`                                    |
| 渲染器事件名                | `codepilotx-*`、`codepilotx:*`                                          | `pidex-*`、`pidex:*`                                          |
| 原生运行时清单身份          | `CodePilotX.CPX-CUA`                                                    | `Pidex.CPX-CUA`                                               |
| profile 库 ownership marker | `0x43505850`（CPXP）                                                    | `0x50445850`（PDXP）                                          |

`HISTORY_APPLICATION_ID`（`3`）与 `LEGACY_HISTORY_APPLICATION_IDS`（`{2}`）不含品牌、
用于识别本产品更早的数据代际，保持不变。

## Consequences

- 旧版本数据不会被新版本识别。旧目录仍在磁盘上，可由旧构建读取，或由用户确认后自行删除；
  本应用不提供删除入口，也不会写入这些目录。
- 安装身份 `appId` 变化后，已安装的旧版本无法原地升级，需要先卸载再安装；否则
  “应用和功能” 中会同时出现两套条目。
- Windows 凭据库中的加密 API Key 使用旧服务名，无法解密。空库时应用会新建主密钥，
  用户需要重新录入 API Key 和 OAuth 授权。
- 浏览器登录状态、窗口与宠物位置、UI 偏好、已持久化的主题选择在首次启动时回到默认值。
- 用户 Git 仓库中既有的 `refs/codepilotx/*` 成为孤儿引用。它们不出现在 `git branch`
  中，也不影响后续操作，本应用既不创建同名新引用也不清理旧引用。
- `%ProgramData%\CodePilotX\requirements.toml` 不再被读取。已部署机器策略的管理员需把
  文件移动到 `%ProgramData%\Pidex\`，否则策略静默失效。
- 外部直接启动 Agent 或脚本时若继续设置 `CODEPILOTX_*` 环境变量，将被忽略并回落到默认值。

## Superseded policy

本 ADR 取代上一轮更名在 `CHANGELOG.md` Unreleased 中记录的“保留 `com.codepilotx.desktop`、
`.codepilotx` 与 `CODEPILOTX_*`”决定。该记录属于同一未发布代际，因此可直接修订而不是追加例外。

## Verification

- `bun run typecheck`、`build:agent`／`build:renderer`／`build:desktop`、`bun run --cwd apps/website build`、
  `desktop:css:check` 与全量单元测试必须通过，且不新增既有失败。
- `bun run package:win` 产出 `Pidex-Desktop-${version}-${arch}.exe`，完成后校验安装包与
  打包态 smoke。
- 实际启动一次，确认创建 `%USERPROFILE%\.pidex` 与 `%APPDATA%\Pidex Desktop`，且旧目录
  内容与修改时间未变化。
- 全仓搜索旧标识，残留项必须全部属于本 ADR 第 4 条列出的真实外部名称或历史记录。
