# CPX-CUA upstream (cua-driver)

- Project: [trycua/cua](https://github.com/trycua/cua), `libs/cua-driver`
- Imported commit: `32b34fbc75abeb96af77df49ae0da72328e67707`
- License: MIT (Copyright (c) 2025 Cua AI, Inc.)
- Imported on: 2026-10-03

## 引入范围

Windows x64 后台优先控制所需的完整依赖闭包：`cua-driver-core`、
`cua-driver-contract`、`platform-windows`（含 `uia`、`win32`、`input`、`tools`
与截图实现）、`cursor-overlay`、`pip-preview`。首个版本只构建
`crates/cpx-cua`，它把上游注册表裁剪为发现、读取和输入所需的工具集。

未引入上游的 Spaces、虚拟机镜像、Python／TypeScript SDK、视觉识别扩展、其他
平台后端（macOS／Linux）和独立产品功能。

依赖版本锁定在上游 `Cargo.lock`；CPX 不自动追随上游，更新由 CPX 手动评估后合入。

## 对上游源码的改造

- `cua-driver-core` 默认特性仅保留 `yaml`，关闭首版不使用的 `rego`，避免 Windows 构建额外要求 Spectre 运行库；保留对应源码与锁定依赖。
- `crates/cpx-cua` 为 CPX 新增的 stdio 入口，复用上游 MCP wire、注册表与
  Windows 工具实现，产物与宿主标识统一为 `cpx-cua.exe`／`CPX-CUA`。
- `cua-driver-core` 的风险分类与私有观察操作表新增 `cpx_apps`，使其与
  `list_windows` 同级别（R2、`private_observation`）；该工具由 CPX 入口提供，
  用于返回宿主解析出的可信应用身份和进程代际；AUMID／路径同时保留为旧授权标识。
- 每个需要目标身份的工具在调用前校验 `cpx_app_id`／`cpx_process_key`／
  `cpx_fingerprint`／`cpx_window_id` 与宿主解析结果一致，否则拒绝执行并要求重新观察。

## CPX 可信身份扩展

- `crates/cpx-cua/src/identity.rs` 新增注册包/AUMID、WinVerifyTrust 嵌入及目录签名、签名版本资源和未签名 SHA-256 核验，不替换上游 UIA、截图或输入实现。
- 签名验证流程参考 [Microsoft CodeSigning 示例](https://github.com/microsoft/Windows-classic-samples/blob/main/Samples/Security/CodeSigning/cpp/codesigning.cpp)，保留 Microsoft 版权及 `MICROSOFT_LICENSE`（MIT）。Windows crate 仍为锁定的 0.58；复用锁文件已有的 sha2。
- 工具调用在执行前校验新身份、文件指纹、进程代际及窗口所属 PID；旧运行时缺少身份能力时宿主拒绝就绪，不回退执行。
- 新永久授权使用版本化配置键；旧路径允许需要重新确认，旧拒绝继续限制。策略和授权由 Agent 管理，不向上游或原生输入层引入用户权限决策。

## CPX 聊天授权简化

- Agent 根据聊天的有效权限决定直接访问或人工应用授权；完全访问不写入隐式授权，审批结果用独立应用授权字段保存并恢复。保存永久允许不会停止本次获批读取，撤销及限制收紧仍停止控制。
- 原生模块继续只负责可信身份和 OS 操作，不承载聊天权限决策，不触发 UAC 提权。

## 上游自身包含的第三方来源

`NATIVE_NOTICES.md` 记录上游从 trope-cua、Interface-Agent 和 yabai 引入的
部分及其许可证。
