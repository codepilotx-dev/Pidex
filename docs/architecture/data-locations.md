# Pidex 数据目录边界

Pidex 将持久化内容分为用户数据、工作区配置、Electron 状态和安装资源。不同类别不能互相回退或混写。

## 用户数据根

默认位置是 `%USERPROFILE%\.pidex`。用户可在“设置 → 配置 → 数据位置”选择新的父目录，桌面端会使用该父目录下的 `.pidex`。选择后应用立即重启，在 SQLite 打开前把当前用户数据复制到同盘 staging，再原子发布目标目录；旧目录不会删除。

默认历史数据库的完整位置是 `%USERPROFILE%\.pidex\history.sqlite`，其 WAL/SHM 位于同一目录；自定义数据根下位于所选父目录的 `.pidex\history.sqlite`。

品牌清零（见 [Pidex identity and data locations](./pidex-identity.md)）后，`.codepilotx` 系列旧目录、旧 Electron userData 目录与旧工作区配置目录都不再被读取、复制或删除，需要保留旧数据时请先备份，再自行决定是否清理。

用户数据根包括：

- `history.sqlite`、`profile.sqlite` 及其 WAL/SHM；
- 可移植的 `config.json` 和 `profiles\<id>.json`；
- 选择明文 Provider 凭据仓库时使用的 `auth.json`；
- `pi-models.cache.json`（Pi 模型目录缓存；旧 `models.cache.json` 仅原样保留，不再读取）；
- 全局 `hooks.json` 和 `skills`；
- `attachments`、`pets`、`tooling`、`workspaces`；
- Agent `logs`；
- 不含绝对路径的数据迁移标记。

换机时可以备份 `config.json` 和 `profiles`。若选择 `auth.json` 凭据仓库，还可以一并迁移 `auth.json`，但它包含明文 Provider API Key/OAuth，必须按敏感文件保护；使用 Windows 加密仓库时凭据不可通过复制文件迁移。数据库、附件和已安装宠物是否备份取决于是否需要保留历史任务与本机状态。模型目录缓存、Agent 日志、可重新安装的托管工具以及已结束的隔离工作树可重建。

Provider API Key 与 OAuth 值可以保存在 `auth.json`，或以密文保存在 `profile.sqlite` 且主密钥由 Windows 系统凭据库保管。GitHub、MCP OAuth、用量和订阅凭据始终留在加密仓库。迁移数据库不会导出主密钥或明文凭据。

项目可信状态、最近项目、活动工作区和侧栏布局属于机器本地状态，保存在 `profile.sqlite`，不得写回或同步到 `config.json`。完整的配置分层与 Profile 契约见 [多端配置架构](./configuration.md)。

## 工作区配置

`<workspace>\.pidex` 只保存用户明确创建、适合随项目共享的内容：

```text
.pidex\
  config.json
  hooks.json
  skills\
    <name>\
      SKILL.md
      scripts\
      assets\
```

项目 `config.json` 和 Hook 只有在项目来源受信任后才会参与合并或执行；信任记录保存在本机数据库，不随仓库同步。Pidex 兼容读取工作区的 `.agents\skills`、`.codex\skills` 和 `.claude\skills`，但不管理这些目录。

数据库、日志、附件、宠物、工具链、记忆、UI 状态和子 Agent worktree 不得写入工作区 `.pidex`。项目记忆保存在用户数据库中，并以规范化工作区路径的哈希隔离。

## Electron AppData

Electron `userData` 保存窗口位置、外观、宠物浮窗位置、Chromium Cache、Local Storage、Session Storage 和 Network 状态。桌面主进程日志使用 Electron logs 目录。

自定义数据位置通过 Electron AppData 中的 `data-location.json` 定位，因为它必须在自定义用户数据根尚未挂载或迁移失败时仍可定位当前目录。该文件只保存当前目录、待迁移目录和操作 ID，不保存会话、凭据或工作区内容。

## 安装资源与系统目录

安装目录只包含随版本发布的只读资源：Agent 可执行文件、Renderer、模型快照、图标、许可证和 notices。运行时不得创建 `<安装目录>\.pidex`，Pidex 不提供默认或隐式便携模式。

无项目任务的用户文档位于 `%USERPROFILE%\Documents\Pidex`。凭据主密钥和操作系统临时文件分别由 Windows 凭据库和系统临时目录管理，不迁入任何 `.pidex`。

## 显式覆盖

直接启动 Agent 或测试时可使用 Pidex 专用环境变量覆盖数据根或子目录。桌面端检测到 `PIDEX_DATA_DIR` 时只读展示实际位置，并禁用目录选择，避免桌面引导文件与外部启动参数产生两套来源。

## 外部 Agent 只读访问会话语义历史

外部 Agent 可在应用未写入时以只读方式打开 `history.sqlite`（默认位于 `%USERPROFILE%\.pidex\history.sqlite`，自定义数据根经 AppData 中 `data-location.json` 定位），按会话 ID 查询语义历史，例如：

```sql
SELECT role, kind, content, metadata_json, created_at
FROM thread_semantic_history_v1
WHERE thread_id = ?
ORDER BY created_at, sort_order, entry_id;
```

该视图只暴露会话语义历史，Pidex 不对外部 Agent 提供 CLI、API 或外部工具访问能力。外部 Agent 禁止写入数据库、执行迁移，或删除、移动、重命名 `history.sqlite` 及其 WAL/SHM 文件；应用运行时应保持 SQLite 只读语义，避免破坏事务、outbox 与中断恢复。
