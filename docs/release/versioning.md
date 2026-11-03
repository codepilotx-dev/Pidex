# 版本管理

## 版本来源

- 根 `package.json` 的 `version` 字段是**唯一产品版本来源**。
- `apps/agent/package.json`、`apps/desktop/electron/package.json`、`apps/desktop/renderer/package.json` 的 `version` 必须与根保持一致。
- `packages/*` 保持独立内部版本，不随产品版本递增。

## 版本格式

遵循严格 SemVer（`MAJOR.MINOR.PATCH-PRERELEASE`），例如 `0.2.0-beta.1`。

| 组成部分     | 规则                                                               |
| ------------ | ------------------------------------------------------------------ |
| `MAJOR`      | `0.x` 阶段破坏性变化至少提升 minor；`1.0.0` 后破坏性变化提升 major |
| `MINOR`      | 稳定版中兼容功能提升 minor；`0.x` 的功能开发也提升 minor           |
| `PATCH`      | 修复或性能优化提升 patch                                           |
| `PRERELEASE` | `alpha.N`、`beta.N`、`rc.N`，序号从 1 开始连续递增                 |

## 生命周期

```
功能开发 → alpha.N → beta.N → rc.N → 稳定版（无后缀）
```

| 阶段      | 允许变更           | 升版规则                                  |
| --------- | ------------------ | ----------------------------------------- |
| `alpha.N` | 新功能、重构、修复 | `0.x.0-alpha.N` → `0.x.0-alpha.N+1`       |
| `beta.N`  | 修复、小幅完善     | `0.x.0-beta.N` → `0.x.0-beta.N+1`         |
| `rc.N`    | 仅修复             | `0.x.0-rc.N` → `0.x.0-rc.N+1`             |
| 稳定版    | —                  | 去掉预发布后缀，如 `0.2.0-rc.3` → `0.2.0` |

- 是否从 Beta 进入 RC、从 RC 进入稳定版、递增当前 beta 序号或开启新的版本线，均由**人工决定并运行 `version:prepare`**，不以日期、提交数或版本号自动触发。
- 只有人工明确宣布稳定后，才允许发布无预发布后缀的版本。
- 功能冻结前不可发布 `rc.N`。

## 标签格式

Git 标签格式：`v<根 package.json 的 version>`。

示例：

| 版本            | 标签             |
| --------------- | ---------------- |
| `0.2.0-beta.1`  | `v0.2.0-beta.1`  |
| `0.3.0-alpha.1` | `v0.3.0-alpha.1` |
| `0.3.0-rc.2`    | `v0.3.0-rc.2`    |
| `0.3.0`         | `v0.3.0`         |

标签、manifest 及 CHANGELOG 中的版本在发布时必须一致。

## 变更记录

- 发布日志写于根 `CHANGELOG.md`，是否记录由 Agent 按根 `AGENTS.md` 的实际影响标准判断，不要求每个任务或 PR 新增条目。
- 日常开发只维护 `Unreleased`，同一功能优先合并为最终行为说明；细小样式、内部重构、普通文档与测试更新通常省略，已发布历史不随日常修改重写。
- 准备发布时，`version:prepare` 将 `Unreleased` 归档到带日期的版本标题。
- 分类固定为：`Added`、`Changed`、`Fixed`、`Deprecated`、`Removed`、`Security`。
- 每条记录格式：`- [作用域] 中文说明`。

> 日志面向用户与集成方说明值得关注的结果；实现细节、生成文件清单和验收过程留在提交、PR 或对应文档中。

## 人工发布步骤

日常开发先运行 `bun run check:quality`；准备版本分支、推送 PR 前，在 Windows 上运行 `bun run check:release`。两者复用 CI 的命令，失败时停止并保留非零退出码。先把本地问题修好，再推送；发布阶段不临时放宽测试或预算。

### 检查归属

| 检查                   | 内容与目的                                                                                                    | 是否阻塞合并 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | ------------ |
| `quality`              | `check:quality`：版本与 lockfile、全仓类型、格式、lint、固定版本图标生成一致性、CSS 策略；另检查 PR diff 空白 | 是           |
| `unit-tests`           | 全仓单元测试，包含版本、发布工作流和性能统计逻辑测试                                                          | 是           |
| `dependency-audit`     | 高危/严重依赖漏洞；仅接受有负责人、理由和有效期限的现有豁免                                                   | 是           |
| `changelog-check`      | 版本一致性与 PR 变更说明；版本归档沿用 `version:prepare`                                                      | 是           |
| `unsigned-smoke`       | 完整 Windows 构建、打包结构验证、运行 smoke、静默安装后的布局验证                                             | 是           |
| `release-parity`       | 无障碍检查、临时证书签名后的 Agent 运行验证和证书清理                                                         | 是           |
| CodeQL                 | 仓库 ruleset 配置的高危安全告警及扫描错误                                                                     | 是           |
| `renderer-observation` | PR、夜间与手动执行性能场景并保存报告、原始采样和失败截图                                                      | 否           |
| `packaged-electron`    | 夜间或手动执行打包 Electron 性能预算验证，不在普通 PR 重复打包                                                | 否           |

`quality` 不再重复构建：`unsigned-smoke` 的 `package:win` 已调用完整 `build`，覆盖 Renderer、Agent、原生 CUA 和 Electron。性能统计的单元测试已由 `test:unit` 覆盖。

`check:release` 依次运行质量检查、单元测试、依赖审计、无障碍和 `package:win`。它会生成本地安装包并启动验证进程；不会创建提交、标签、上传或发布。CI 仍需完成 PR diff 检查、临时证书签名、静默安装验证和 CodeQL，本地通过不能替代这些结果。

性能观察独立失败时仍显示失败，不将其伪装为通过；该作业不加入 required checks。超预算和场景执行错误分别处理：前者分析采样，后者先修 fixture、选择器或运行环境。保留当前预算作为历史比较基线；共享 runner 和模拟场景的结果不能证明真实桌面稳定 60 fps，也不能直接制定硬件验收标准。

GitHub 的 `Protect main` 与 `Protect dev` 当前要求上述六个命名作业，并配置 CodeQL。保持这些作业名称和每个 PR 的触发条件稳定，不使用顶层路径过滤跳过必需工作流。若以后增删必需作业，必须同时调整 ruleset；本次配置无需修改远端规则。

### 发布操作

预发布与正式版本都使用同一套人工发布流程。版本文件由 `version:prepare` 生成，提交与 `v*` 标签必须签名，标签必须指向 `main` 历史。推送标签后由 GitHub-hosted runner 创建 GitHub Release；需要 Windows 安装包时，从对应标签运行 `bun run package:win`，验证通过后人工上传同版本 x64 EXE。

1. 确认 `Unreleased` 区段非空。
2. 运行 `bun run version:prepare -- <新版本> [--stable]`，生成四 manifest、lockfile 与 CHANGELOG 归档区段。
3. 人工检查产物（manifest、lockfile、CHANGELOG），确认 `CHANGELOG.md` 已生成 `## <版本> — YYYY-MM-DD` 归档区段且内容非空。
4. 在版本分支上创建签名提交并推送该分支：

   ```bash
   git commit -S -m "chore(release)：准备 <版本>"
   git push origin <当前版本分支>
   ```

   不要在 `dev` 上同时推送版本分支和标签，也不要先在 `dev` 上打标签。

5. 通过正常 PR/合并流程让该提交进入 `main`，并等待其合入 `origin/main`。
6. 本地拉取 `main`，确认目标提交属于 `origin/main` 历史：

   ```bash
   git checkout main && git pull --ff-only
   bun run version:check -- --tag v<版本>
   ```

   `v*` 标签必须指向 `main` 历史，由 `Protect release tags` ruleset 的创建限制与 required signature、以及工作流内的 `version:check --tag` 与 main ancestor 检查共同保证。

7. 在 `main` 上的目标提交创建签名 `v<版本>` 标签，并**单独**推送该标签：

   ```bash
   git tag -s v<版本> -m "Pidex v<版本>"
   git push origin v<版本>
   ```

8. 推送 `v*` 标签后，GitHub-hosted runner 校验标签目标属于 `main`、验证标签与根版本一致，并从对应的 CHANGELOG 归档区段生成 Release 正文。
9. CI 在 `codepilotx-dev/Pidex` 创建 GitHub Release，GitHub 自动提供源码归档；需要安装包时，在对应标签运行 `bun run package:win`，通过打包校验与 smoke 后使用 `gh release upload v<版本> release/Pidex-Desktop-<版本>-x64.exe` 上传，不覆盖已有附件。未使用正式 Authenticode 证书时，必须在 Release 正文注明安装包未签名。
10. Beta/Alpha/RC 的人工确认发生在创建和推送签名标签的时刻；稳定版还额外经过 `release` Environment 的审批。

预发布标签（`alpha.N`、`beta.N`、`rc.N`）会创建 prerelease；无后缀版本会创建正式 Release。已发布 Release 不可覆盖；相同标签已发布时工作流失败关闭。标签工作流只创建 Release，Windows 安装包由人工验证后追加上传。

> 桌面端运行时仅从 GitHub Releases 读取更新日志，不读取本地 `CHANGELOG.md`。CHANGELOG 只作为标签发布流水线生成 Release 正文的来源。

## 迁移到组织仓库

首次公开发布前，将当前仓库通过 GitHub Transfer 转移到 `codepilotx-dev/Pidex`，并逐项确认：

- 本地 `origin` 已更新为组织仓库地址，拉取和推送均正常。
- Actions 的 Workflow permissions 允许工作流使用 `contents: write` 创建 Release。
- tag 发布 job 使用 GitHub-hosted runner，且不依赖 Windows 签名证书、自托管 runner 或发布 secrets。
- 分支保护、环境保护规则和必需检查与转移前一致。
- `.github/workflows/windows-x64-package.yml` 在组织仓库中启用，标签触发权限未被组织策略禁用。
- 仓库可见性符合发布阶段：调试期可保持私有，正式发布前再公开。
- 使用测试仓库或契约测试验证标签发布工作流配置；以上项目全部确认前，不推送首个公开版本标签。

发布工作流带有仓库身份保护，仅允许在 `codepilotx-dev/Pidex` 创建 Release，避免转移前误发到个人仓库。

## 常用命令

| 命令                                                             | 说明                                                                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `bun run version:check`                                          | 验证四 manifest 一致、lockfile 一致、CHANGELOG 结构有效                                |
| `bun run version:check -- --base <git-sha>`                      | 按需检查 `Unreleased` 是否有新增说明，不作为每个 PR 的必需门禁                         |
| `bun run version:check -- --tag <v版本>`                         | 额外验证标签与 manifest 版本一致                                                       |
| `bun run version:prepare -- <新版本>`                            | 归档 `Unreleased`、同步 manifest、刷新 lockfile                                        |
| `bun run version:prepare -- <新版本> --stable`                   | 同上，但允许无预发布后缀的稳定版                                                       |
| `bun scripts/WriteReleaseNotes.ts --tag <v版本> --output <文件>` | 从对应的已归档 CHANGELOG 版本区段生成 Release 正文；标签、根版本或归档区段不一致时失败 |
| `bun run check:quality`                                          | 日常质量检查，与 CI `quality` 复用相同入口                                             |
| `bun run check:release`                                          | Windows 发布前本地预检，含无障碍与完整打包；不发布                                     |

## 示例

### Beta 递增

```bash
# 当前 0.2.0-beta.1，发布修复后
bun run version:prepare -- 0.2.0-beta.2
# → CHANGELOG 归档 0.2.0-beta.2 (2026-07-25)
# → 四 manifest 同步为 0.2.0-beta.2
```

### Beta 到 RC

```bash
bun run version:prepare -- 0.2.0-rc.1
```

### 显式稳定发布

```bash
bun run version:prepare -- 0.2.0 --stable
```

### 升版拒绝情形

```bash
bun run version:prepare -- 0.2.0-beta.1    # 拒绝：同版本重复
bun run version:prepare -- 0.2.0-beta.0    # 拒绝：序号倒退
bun run version:prepare -- 0.2.0           # 拒绝：缺少 --stable
bun run version:prepare -- v0.3.0-beta.1   # 拒绝：前缀 v 非法
```
