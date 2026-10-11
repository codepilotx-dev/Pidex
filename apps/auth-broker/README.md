# Pidex Auth Broker

Cloudflare Worker，用于 Pidex 桌面端的 GitHub OAuth Authorization Code + PKCE 登录。Broker 是唯一持有 OAuth App `client_secret` 的组件；桌面端只保存短期 PKCE verifier，并在登录成功后使用自己的加密凭据仓库存储 access token。

## 安全边界

- 只接受 `http://127.0.0.1:<动态端口>/auth/github/callback`，不接受 `localhost`、HTTPS、固定无端口 URL、查询或 fragment。
- OAuth attempt 保存于 SQLite Durable Object，十分钟过期，授权码交换前原子消费，禁止并发交换与重放。
- 请求体上限为 8 KiB，不开放 CORS；所有公开响应均为 `no-store`，且不返回 GitHub 原始错误。
- GitHub OAuth/API 上游地址均为代码内常量，客户端不能提供上游 URL。
- `GITHUB_OAUTH_CLIENT_SECRET` 只能使用 Cloudflare secret，禁止写入 `wrangler.jsonc`、日志、错误或测试。
- Rate Limiting binding 用于滥用缓解；一次性消费由 Durable Object 保证，不依赖最终一致的限流计数。

## 本地验证

```powershell
bun run --cwd apps/auth-broker typecheck
bun run --cwd apps/auth-broker test
```

启动本地 Worker 前，为本地开发创建不提交的 `.dev.vars`：

```dotenv
GITHUB_OAUTH_CLIENT_ID=your-staging-client-id
GITHUB_OAUTH_CLIENT_SECRET=your-staging-client-secret
```

然后执行：

```powershell
bun run --cwd apps/auth-broker dev
```

## Staging 部署

1. 在 GitHub Organization 下创建公开 OAuth App，回调地址设置为 `http://127.0.0.1/auth/github/callback`，并启用 Device Flow。
2. 将 `wrangler.jsonc` 中空的 `GITHUB_OAUTH_CLIENT_ID` 替换为 staging Client ID。Client ID 不是 secret，但必须在部署前配置。
3. 使用 Wrangler 写入 secret：

   ```powershell
   bunx wrangler@4.36.0 secret put GITHUB_OAUTH_CLIENT_SECRET --config apps/auth-broker/wrangler.jsonc
   ```

4. 确认 Cloudflare zone 已包含 `codepilotx.top`，且 Custom Domain `auth-staging.codepilotx.top` 可创建。
5. 先执行 `typecheck` 和 `test`，再显式部署：

   ```powershell
   bun run --cwd apps/auth-broker deploy
   ```

6. 验证 `GET https://auth-staging.codepilotx.top/health` 返回 `{"status":"ok"}`，之后再进行桌面端真实 OAuth 验收。

仓库不会自动部署，也不会创建 GitHub Organization、OAuth App、Cloudflare zone、DNS 或 secret。生产环境应使用独立 OAuth App、独立 Worker 配置和独立 secret。
