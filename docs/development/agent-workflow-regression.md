# Agent 开发工作流回归记录

本记录针对 2026-09-05 的 Pidex 开发工作流整理，不是产品内自动生成 Skill 或自动化任务的功能规范。

## 范围与基线

- 实施基线 HEAD：`368226e7370fa703fb241015322b3cf0845165e2`。开始时 `git status --short` 有 65 项已有修改或未跟踪路径；目录项展开后逐文件记录 SHA-256。既有日历任务改动不归属本次任务。
- 规则来源：[根指令](../../AGENTS.md)。Skill 保存执行方法，长期记忆保存历史事实和检索入口；历史任务状态 `completed` / `notLoaded` 不证明用户目标已完成或任务被中断。
- 本机 `.agents/skills/` 保持 `.git/info/exclude` 排除。更新 `cpx-pre-push-checks`、记忆目录中的 `external-agent-acceptance` 及两个记忆索引，不将私人记忆纳入版本控制。
- 不修改全局个人指令、原始会话、其他项目历史或产品内的 Skill；不提交、推送、发布或设置定时任务。
- 中途基线核验除本次 CHANGELOG 插入外全部匹配；最终发现 `AutomationCalendar.tsx`、`CalendarDates.ts`、`AutomationCalendar.test.ts` 三个日历文件在本任务写入范围外发生变化，已记录前后 hash，不回退或归属到本任务。类型检查结论对应实际执行时的快照；暂存区仍与基线一致。

## 重复流程、证据与处置

| 流程或失败                 | 直接证据                                                                                                                                                                | 处置                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 当前对话修改的中文分类提交 | 长期记忆中的多次当前任务提交请求；2026-08-21 任务 `01a02375-e5af-7061-8ef5-a4cb0495fb1a` 因混合修改缺乏归属证据未提交                                                   | 复用 `commit-excluding-threads` 及其校验脚本，不新增提交工具。                                                    |
| 按改动范围验收             | 同一任务中构建通过，但按需加载入口、生命周期注册和必要行为测试缺失                                                                                                      | 修正既有检查 Skill 的根链接、workspace 名称与检查范围；保留行为验收，MCP/recovery 专用检查限定到相关任务。        |
| 外部任务交接               | 《优化 Plan 与编码流程》，turn `01a02d79-7849-7182-924e-8a196e04ca3b`：用户在 DeepSeek 配额耗尽后要求接管；此前出现错误 fixture 和伪造批准逻辑                          | 既有外部验收 Skill 增加 HEAD、范围、原 session、真实测试入口、证据和下一条命令；原始基线不能事后编造。            |
| 人工清理自动化 Chrome      | 《排查 Chrome CPU 占用过高》，turn `01a06564-09ce-7eb3-99e1-44d9848d6912`：用户明确要求结束测试 Chrome 和对应进程                                                       | 测试入口负责可捕获中断的进程树收尾；不建立自动杀 Chrome 的 cron。此症状只有单次直接案例，不描述为跨会话反复故障。 |
| 安装产物修好后再次失败     | 《优化 Plan 与编码流程》turn `01a0329d-505e-7b60-b099-0d89819696c9` 与《打包合并并发布源码包》turn `01a069dc-f4f3-7aa1-9e4f-ced674b01a31` 出现 extract-zip 重复补丁问题 | 验证已有 vendor 方案的干净安装，不再次修改 node_modules。                                                         |
| 记忆覆盖当前规则           | 记忆仍建议 MiniMax 编码、固定 Bun 路径和优先 PowerShell                                                                                                                 | 保留历史事实，当前 Pidex 建议改为读取项目模型规则、Git Bash 优先和运行时发现 Bun。                                |

提交、验收已有稳定 Skill 可复用；Chrome 清理、代理故障和配额耗尽的单个案例不构成新增通用 Skill 或周期任务的依据。

## 实现行为

[Playwright 入口](../../apps/desktop/renderer/scripts/RunPlaywright.ts) 保留配置白名单和动态端口，使用 Node `ChildProcess` 与已有 `killProcessTree`。配置名之后的参数按数组转发；禁止通过尾部 `--config/-c` 覆盖白名单。

正常及测试失败结束依赖 Playwright 自身 teardown，已退出父进程的孤儿后代不由共享清理函数兜底。正常结束返回 Playwright 的退出码，启动失败返回非零；可捕获 `SIGINT` / `SIGTERM` 分别返回 130 / 143，并结束自己持有的活动子进程树。重复信号不重复清理，完成后移除监听器。操作系统强杀父进程不保证 JavaScript 收尾；不根据进程名结束用户浏览器。

根指令仅将交付搜索明确限定到本次涉及的协议、路径和调用方。下级指令中的标题栏跨端验证和协议限制具有本目录适用意义，未为减少字数删除这些约束。

## 回归结果与复跑入口

| 检查                     | 命令或方法                                                                                                                                                                                                                                   | 结果                                                                                                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 新入口行为               | `bun test apps/desktop/renderer/test/RunPlaywright.test.ts`                                                                                                                                                                                  | 5 项通过、0 失败、17 个断言，退出码 0。覆盖成功/失败退出码、启动错误、参数转发、配置覆盖拒绝、两种可捕获信号、重复信号、子孙进程退出和监听器移除。Windows 信号通过 `process.emit` 验证真实子进程收尾，不冒充操作系统强杀测试。 |
| Renderer 类型检查        | `bun run --cwd apps/desktop/renderer typecheck`                                                                                                                                                                                              | 退出码 0。                                                                                                                                                                                                                     |
| 脚本和测试补充编译       | `node node_modules/typescript/bin/tsc --noEmit --skipLibCheck --module preserve --moduleResolution bundler --target ES2022 --types bun,node apps/desktop/renderer/scripts/RunPlaywright.ts apps/desktop/renderer/test/RunPlaywright.test.ts` | 与 Renderer 非 strict 设置一致的检查通过。额外启用 strict 时，未修改的 `scripts/IntegrationTestRunner.ts:109`、110 报 TS2339；未为此修改共享工具或降低项目配置。                                                               |
| 文档、样式、RPC 检查选择 | 独立 Agent 用三个真实目录场景阅读修订 Skill，仅模拟下一步                                                                                                                                                                                    | 文档不跑 typecheck/build/全量测试；样式选择 Renderer typecheck/css 检查；RPC 选择协议测试、应用测试及根 typecheck。属于行为演练，不宣称实际运行了这些场景的所有命令。                                                          |
| 模型限制与配额交接       | 独立 Agent 模拟 MiniMax 实现请求与配额耗尽交接                                                                                                                                                                                               | 不派发 MiniMax 写任务；识别缺失原始 hash、真实 session 和验收证据，未调用合成 session 或编造失败。                                                                                                                             |
| 干净安装                 | 临时目录解开 `git archive HEAD`，叠加当前已有改动，再运行 `bun install --frozen-lockfile`                                                                                                                                                    | 退出码 0，安装 1911 个包；安装前后归档锁文件 SHA-256 均为 `227aeac8afc27bb7b4a0e1bf9bd0e0a1e55c1be28c5a1e7fcba4812740ca0d40`。                                                                                                 |
| 实际 extract-zip 消费者  | Node `createRequire` 分别从 Agent manifest、Electron 的 `install.js` 解析并加载                                                                                                                                                              | 两处均加载 vendor 维护版本，导出为函数。Electron workspace 本身没有直接声明该包，不能用 workspace 根的解析失败判依赖损坏。                                                                                                     |
| Skill 格式与引用         | `skill-creator/scripts/quick_validate.py`、YAML 解析及链接核验                                                                                                                                                                               | `cpx-pre-push-checks` 通过；external Skill 原有 `argument-hint`、`disable-model-invocation`、`user-invocable` 不被 Codex 通用 validator 支持。保留原调用元数据，单独确认 YAML、引用及元数据未改。                              |

### 浏览器失败与收尾证据

运行现有用例，没有新增 UI 测试、更新截图或修改样式基线：

```bash
bun run --cwd apps/desktop/renderer test:visual --grep 'command menu restores focus and disables file search without a workspace' --workers=1 --output=<独立输出目录>
bun run --cwd apps/desktop/renderer test:visual --grep 'reduced motion renders a flat skeleton without shimmer' --workers=1 --output=<另一独立输出目录>
```

- 命令菜单用例退出码 1：`command-menu.behavior.visual.ts:56` 等待“搜索任务”按钮超时。快照中存在“先配置一个模型”和活动视图提示层。绕过包装脚本、从 Renderer 目录直接调用 `bun x playwright test`，相同用例在相同行失败；问题不依赖本次包装入口。
- 动效用例退出码 1：VisualTestHelpers.ts:90`等待`html[data-theme]` 超时。未扩展诊断到无关页面或改弱断言；尚不能断言它与命令菜单用例同因。
- 第二个用例返回较慢，准备精确清理时其入口已退出，未执行强制结束。最终按 PID、父子关系和创建时间核验：观察到的两组测试 Chrome、相关 Vite 和 worker 均已退出；用户原有 Chrome 主进程仍存活。普通 Chrome renderer 自身存在进程轮换，未将它误判为测试泄漏。
- UI 业务回归未通过；失败退出码传播与上述运行的进程退出得到实测支持。正常成功和信号路径另由真实子进程测试覆盖，不宣称 UI 全绿。

临时安装目录与归档的删除被自动审批检查拒绝（`blocked by policy`，未给出具体原因），因此保留 `clean-install` 与 `source.tar`，不改用其他删除途径。

本次详细原始证据保存在执行机临时目录 `cpx-workflow-u7cfdcyx`：baseline/hash、Skill/记忆原文、浏览器 trace、快照和进程身份清单。临时目录不是稳定项目接口；不要把私人原文纳入仓库。

## 规则结论与后续条件

- **保留：**独立行为验收、受保护文件基线、模型资格、消费者验证、数据安全与提交授权；不因样本未触发而删除。
- **合并：**检查选择进入已有检查 Skill；外部验收与交接进入已有验收 Skill，记忆只保存案例与入口。
- **限定范围：**MCP/recovery 检查只作用于相关任务；纯文档检查引用；脚本只管理自己的子进程。
- **移除过期建议：**旧模型编码默认值、固定 Bun 位置和普遍 PowerShell 优先。历史事实不删除。
- **个人全局指令建议，未修改：**把 `feat(desktop)` 明确为示例、类型和 scope 随改动确定；把“多问问”明确为询问高影响歧义；把清理对象明确为本次测试创建的进程。
- **待后续任务处理：**UI fixture 的首次提示层/主题就绪缺口、共享测试工具的 strict 类型错误、external Skill 在不同宿主的元数据兼容。未将这些问题扩大成本次产品修复。
