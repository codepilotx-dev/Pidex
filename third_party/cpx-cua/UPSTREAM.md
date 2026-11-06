# CPX-CUA upstream (cua-driver)

- Project: [trycua/cua](https://github.com/trycua/cua), `libs/cua-driver`
- Imported commit: `32b34fbc75abeb96af77df49ae0da72328e67707`
- License: MIT (Copyright (c) 2025 Cua AI, Inc.)
- Imported on: 2026-10-03

## 独立维护与按需分发

源码已迁至 [Pidex-Dev/cua 发布分支](https://github.com/Pidex-Dev/cua/tree/codex/pidex-cua)，基于上面记录的原始导入提交，不随本次剥离升级上游。当前主仓库仅保留许可证和此来源记录。

Desktop 启用 Computer Use 插件时下载固定 Release 的 `cpx-cua.exe`，按应用内固定 SHA-256 校验，缓存后可离线启动；安装包不携带 Rust 源码或 EXE。Release 同时提供 `SHA256SUMS`、来源提交和许可证包。

独立仓库保留 Pidex 的 `cpx-cua` 宿主、工具白名单、`cpx_apps` 风险分类，以及注册包/AUMID、WinVerifyTrust 嵌入及目录签名、版本资源和未签名 SHA-256 核验。原生执行目标绑定已验证 PID/HWND，元素令牌仍由上游 snapshot store 检查；聊天权限、应用策略和控制权继续由 Pidex Agent 管理。

Windows 签名验证参考 Microsoft Windows-classic-samples 的 [CodeSigning 示例](https://github.com/microsoft/Windows-classic-samples/blob/main/Samples/Security/CodeSigning/cpp/codesigning.cpp)，版权及 MIT 许可保留在 `MICROSOFT_LICENSE`。
