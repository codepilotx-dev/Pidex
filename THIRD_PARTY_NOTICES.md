# Third-Party Notices

Pidex includes task workflow, optimistic concurrency, column ordering,
conversation prioritization, and agent lifecycle semantics adapted from
dashi-taskboard at commit `9b2aeb53bfe8d40eb5d65feecdfc2cc235928066`.
The adapted implementation is integrated with Pidex's native RPC,
history storage, worktree, thread, permission, and renderer layers; it does
not include dashi-taskboard's server, Tauri launcher, CDP integration, hosted
services, or brand assets. These portions are licensed under the Apache
License 2.0. See `third_party/dashi-taskboard/LICENSE` and
`third_party/dashi-taskboard/UPSTREAM.md`.

Pidex includes source adapted from the OpenCode project. The copied model
schema and project directory storage semantics originated from version
1.17.13; the JSONC parsing and key-path patching approach was adapted from
version 1.18.9. These portions are licensed under the MIT License. See
`third_party/opencode/LICENSE`.

Additional JavaScript dependencies retain the license terms distributed in
their respective packages.

Pidex can download pinned SenseVoice GGUF and FSMN-VAD model weights plus
the self-contained FunASR llama.cpp Windows runtime to provide local speech
dictation. These optional artifacts are checksum-verified and stored in the
user-selected Pidex data directory rather than embedded in the installer.
The model repositories identify their weights as Apache-2.0; the SenseVoice
runtime and llama.cpp/ggml components are MIT-licensed, and miniaudio is used
under its MIT No Attribution option. See `third_party/funasr/` for source,
version and license details.

Pidex includes the CPX-CUA Windows computer-control runtime vendored from
cua-driver (trycua/cua) at commit `32b34fbc75abeb96af77df49ae0da72328e67707`.
The imported Rust workspace provides the Windows UI Automation, window
enumeration, screenshot and background-input layers; Pidex maintains its
own `cpx-cua.exe` entry point, tool allowlist and host-resolved application
identity on top of it. These portions are licensed under the MIT License. See
`third_party/cpx-cua/LICENSE`, `third_party/cpx-cua/UPSTREAM.md` and
`third_party/cpx-cua/NATIVE_NOTICES.md`.

CPX-CUA's Windows signature verification adapts the CodeSigning sample from
Microsoft Windows-classic-samples, copyright Microsoft Corporation, under MIT.
See `third_party/cpx-cua/MICROSOFT_LICENSE` and the source link in `UPSTREAM.md`.

Pidex uses Microsoft node-pty to provide native pseudoterminal support,
including Windows ConPTY integration. node-pty is licensed under the MIT
License; its license notice is distributed with the packaged dependency.

Pidex includes source derived from pi-agent-core 0.82.1 as an internal
part of the App Agent Harness under the MIT License. Pidex maintains this
Harness independently; the retained attribution and license are provided for
distribution compliance. See `apps/agent/third_party/pi-agent-core/LICENSE`.

Pidex uses Marked, Shiki, KaTeX, and Mermaid to render Markdown, syntax
highlighting, mathematical notation, and diagrams. These packages retain the
license notices distributed with their respective npm packages. Marked, Shiki,
and KaTeX are licensed under the MIT License; Mermaid is licensed under the
MIT License with its bundled third-party notices.

Pidex includes monochrome React components and file/folder associations
derived from Material Icon Theme 5.37.0 under the MIT License. See
`packages/material-icon-theme/LICENSE` and
`packages/material-icon-theme/UPSTREAM.md`.

Pidex's external open menu ships fixed brand icons for the
third-party applications it detects and can launch. The icons are used
solely to identify an installed application; their presence never
implies endorsement of, affiliation with, or sponsorship by the
trademark owners, and Pidex is not affiliated with those vendors.

- The VS Code, VS Code Insiders, Cursor, Windsurf, File Explorer,
  Windows Terminal, and IntelliJ IDEA icons were copied from the Codex
  desktop application's webview assets
  (`src/webview/apps/*.png` of `openai-codex-electron` version
  26.730.61309, unpacked locally from `F:\CodeProject\Codex-unpacked`).
  Pidex file names: `vscode.png`, `vscode-insiders.png`,
  `cursor.png`, `windsurf.png`, `file-explorer.png`,
  `microsoft-terminal.png`, `intellij.png`.
- The Visual Studio icon (`visual-studio.png`) was extracted from the
  icon resource of the official Microsoft Visual Studio 2022 Community
  `devenv.exe` binary installed on the packaging machine and was not
  redrawn, recolored, or composited. Visual Studio imagery is subject
  to Microsoft's Visual Studio Image Library terms and the Visual
  Studio product license; see
  https://www.microsoft.com/en-us/download/details.aspx?id=35825.
- The GitHub Desktop icon (`github-desktop.png`) was extracted from the
  production `app/static/logos/prod/icon-logo.ico` of the
  `desktop/desktop` repository at commit
  `e056ef235d0d222c33ffb2f5bac3543c3833d51b` and scaled to 48x48
  without changing its proportions. GitHub logos are used under the
  GitHub Logo Policy:
  https://docs.github.com/en/site-policy/other-site-policies/github-logo-policy.

## ZCode browser helpers

Playwright injected runtime loading and keyboard input helpers adapted from ZCode (revision 872ad96), Apache-2.0. Source: https://github.com/zai-org/ZCode . License: third_party/zcode-browser/LICENSE.

## Playwright injected runtime

The browser DOM runtime is extracted at build time from playwright-core 1.59.1, maintained by Microsoft Corporation and licensed under Apache-2.0. Source: https://github.com/microsoft/playwright . License: third_party/playwright-core/LICENSE.
