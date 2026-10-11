# Pidex 多端配置架构

桌面端、Agent 和后续 CLI/TUI 共享同一套 JSON/JSONC 配置协议。各端不得维护平行配置文件、私有字段别名或独立合并逻辑；配置读取、校验、局部写入和项目可信判断统一由 Agent `ConfigService` 完成。

## 文件与优先级

默认用户数据根为 `%USERPROFILE%\.pidex`：

```text
.pidex\
  config.json
  profiles\
    deep-review.json
  auth.json                 # 仅在选择 auth-json 凭据仓库时存在
```

配置按以下顺序递归合并，后者覆盖前者：

1. 内置默认值；
2. 用户 `config.json`；
3. Agent 启动时冻结的活动 Profile；
4. 已信任项目的 `<workspace>\.pidex\config.json`。

所有配置文件都接受标准 JSON 和带注释、尾逗号的 JSONC。写入使用 key-path 局部编辑和同文件写队列，保留未修改的注释、字段顺序以及当前版本不认识的键。未知用户/项目根键会产生警告但不会被删除；不允许的 Profile 根键和含密钥材料的值会被拒绝。

旧 `config.toml` 只在对应 `config.json` 不存在时执行一次迁移，迁移成功后仍保留原文件。`schema_version` 当前固定为 `1`。

## Profile v1

用户配置通过根字段选择 Profile：

```jsonc
{
  "schema_version": 1,
  "profile": "deep-review",
}
```

Profile 文件名就是稳定 ID。ID 必须匹配 `[a-z0-9][a-z0-9_-]{0,63}`，显示名称和说明可以使用中文：

```jsonc
{
  "schema_version": 1,
  "display_name": "深度审查",
  "description": "复杂修改与代码审查",
  "model": "gpt-5.6",
  "model_reasoning_effort": "high",
  "approval_policy": "on-request",
  "specialized_models": {
    "generation": "openai/gpt-5.6-mini",
    "organization": "openai/gpt-5.6-mini",
    "coding": "openai/gpt-5.6",
    "security": "openai/gpt-5.6",
  },
}
```

`specialized_models` 按用途配置生成、整理、编码和安全任务使用的模型。值优先使用 `provider/model` 完整引用；兼容只写模型 ID，此时继承同一有效配置中的 `model_provider`。生成、整理和编码模型未配置或不可用时使用有效主模型；安全模型优先回退当前任务模型，仍不可用时保持 fail-closed 并转人工审批。旧 `task_models` 会按用途幂等复制到新字段并原样保留，已有专用模型不会被覆盖。

Profile 只允许任务执行偏好：模型与推理强度、人格和提示词、沙箱与审批策略、Shell 安全级别以及专用模型。Provider 定义、凭据仓库、MCP、Hook、数据目录、遥测、日志、桌面 UI 状态和项目可信记录都必须留在用户层或机器本地存储。

Profile 在 Agent 启动时冻结。外部编辑活动 Profile 或修改 `config.json.profile` 后，当前 Agent 继续使用原快照并报告 `restartRequired: true`；关闭共享该 Agent 的所有前端并重新启动后才应用新值。已选择的 Profile 缺失或无效时，Agent 拒绝启动，避免不同端悄悄使用不同回退值。

## 多端 RPC 契约

客户端使用 `thread-rpc-v4` 的正式方法，不直接读写文件：

- `config/read`：读取有效配置、来源、诊断、分层和 Profile 状态；
- `config/value/write`、`config/batchWrite`：通过结构化 `target` 写入 `user`、`profile` 或 `project`；
- `config/profile/list`：列出 Profile、文件路径、版本和校验结果；
- `config/profile/select`：更新下次启动使用的 Profile；
- `project/trust/read`、`project/trust/update`：由 CLI/TUI 在询问用户后维护本机项目可信状态。

桌面端导入或打开项目本身视为信任操作；CLI/TUI 对未知项目必须先读取可信状态并显式询问。任何客户端都应监听 `config/updated` 并重新调用 `config/read`，不能缓存并覆盖其他端写入的完整文档。

## 可迁移与机器本地边界

适合备份或同步的内容包括用户 `config.json`、`profiles`，以及用户明确选择明文凭据仓库时的 `auth.json`。项目配置随项目仓库同步。

以下内容不能进入可移植配置：

- 项目绝对路径与可信状态；
- 最近项目、活动工作区、窗口和侧栏状态；
- 日志、缓存、任务历史、附件和临时工作树；
- Windows 加密仓库的主密钥；
- GitHub、MCP OAuth、用量和订阅凭据。

升级时，旧 `projects.<root>.trust_level` 会幂等迁入机器本地 SQLite 并从 `config.json` 删除。旧 `desktop` 中的运行状态先合并到 `desktop.runtime-state.v1`，验证落盘后再通过 JSONC key-path 删除；崩溃后重复执行不会覆盖本机已有的新状态。
