# Prompt engine source provenance

Pidex 的 prompt engine v2 参考了以下本地源码快照。实现以 Pidex 的 TypeScript 架构、安全不变量和产品决策重新组织；没有引入参考仓库的 TUI、私有服务协议或品牌专属逻辑。

## OpenAI Codex

- 来源：`D:/GitHubProject/Agent/codex-main`
- 许可：Apache License 2.0（见来源根目录 `LICENSE`）
- `codex-rs/core/src/config/resolved_permission_profile.rs` — SHA-256 `94234BA35D5EC3958EF6EEF44ECF259FD610459AB47DF62E1DE17BBE136886B4`
- `codex-rs/core/src/guardian/review_session.rs` — SHA-256 `2B92E6E89B633B5A39A84E09A9C0A03CB710DD2D1BFDF0CF83BC4D0C31476221`
- `codex-rs/core/gpt_5_codex_prompt.md` — SHA-256 `42842BE69650AE563D212695E8D3F3591534908FD8CA33B63F742DAF41F88B65`

借鉴范围：permission profile、approval policy、Guardian 增量会话、工具注册、Plan/协作模式和执行/验证提示词骨架。

## Claude Code reference snapshot

- 来源：`D:/GitHubProject/Agent/claude-code-master`
- 授权依据：本次实施由用户明确确认可复制/改编该本地快照；该记录不改变上游文件自身的权利归属。
- `src/constants/prompts.ts` — SHA-256 `7DAC778E089A7F002403DF2A2EFB6F0B9E4A450AF21766680AB8948596C10F25`
- `src/utils/hooks.ts` — SHA-256 `D95C84279ED5E57DBCDE85F116E6E590A1A06355F786E50A8FE2DDE1E555CD26`
- `src/services/SessionMemory/prompts.ts` — SHA-256 `37C52FA005CFDA8EBE3978D7E93A6101C1D956010F2A4733B9A38481D0B85975`

借鉴范围：动态 prompt sections、项目指令、Skills catalog/按需读取、Hooks 生命周期、记忆与压缩恢复。

这些 SHA-256 标识本次设计时使用的具体文件快照；来源目录不是 Git worktree，因此没有可记录的 commit SHA。
