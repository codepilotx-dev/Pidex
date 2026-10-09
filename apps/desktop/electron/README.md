# Pidex Electron 壳

主进程只负责窗口安全配置与 Bun Agent sidecar 生命周期，不承载 Agent 业务逻辑。

开发态先在独立终端运行 `bun run dev:agent`，再在一个或多个 Git worktree 中运行 `bun run dev:desktop`。每个 worktree 自动分配独立 Vite 端口、Electron `userData` 与桌面日志目录，并通过开发代理连接同一个 Agent；关闭任一 Desktop 不会停止独立 Agent。同一 worktree 仍由 Electron single-instance 语义收敛为一个主进程。

普通重启开发 Agent 时会复用上一次的回环端口和本地认证令牌，并为新进程生成新的实例标识。保持 `dev:desktop` 运行即可由现有重连页自动恢复；显式修改 `PIDEX_DEV_AGENT_PORT` 会建立新的连接身份，需要重启 Desktop。

## 环境变量

- `PIDEX_AGENT_URL`：复用已由开发编排器启动的 Agent，例如 `http://127.0.0.1:43120`。设置后 Electron 不会重复启动或停止 sidecar。
- `PIDEX_AGENT_MANAGED=1`：开发编排器的语义标记；实际是否复用由 `PIDEX_AGENT_URL` 决定。
- `PIDEX_RENDERER_DEV_URL`：仅供 managed 开发态 Electron 加载当前 worktree 的回环 Vite 页面；Agent 连接与认证仍使用 `PIDEX_AGENT_URL`。
- `PIDEX_USER_DATA_DIR`：开发编排器按 worktree 注入的 Electron 状态目录，用于隔离 single-instance lock、Cookie 和窗口状态。
- `PIDEX_AUTH_TOKEN`：可由开发编排器预先提供；未设置时主进程生成 256 位随机令牌。
- `PIDEX_BUN_PATH`：开发时 Bun 可执行文件路径，默认 `bun`。
- `PIDEX_AGENT_ENTRY`：开发时 Agent 入口，默认 `apps/agent/src/index.ts`。
- `PIDEX_STATIC_DIR`：生产时由 Electron 自动指向 `extraResources/renderer`。
- `PIDEX_DEVTOOLS=1`：打包后显式启用 DevTools。

自行管理 sidecar 时，Agent 必须在 stdout 输出单行 UTF-8 JSON：

```json
{ "type": "ready", "host": "127.0.0.1", "port": 43120 }
```

主进程随后轮询 Agent 的 `/api/ready` 并配置认证 Cookie。开发态加载当前 worktree 的 Vite origin，打包态继续加载 Agent 提供的静态页面。
