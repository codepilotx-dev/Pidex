# Codex 宠物系统逆向分析

本文记录对 Codex Desktop 宠物系统的静态逆向结果，并以官方产品资料和宠物制作规范进行交叉验证。它描述的是可观察行为与高置信度协议，不声称恢复原始 TypeScript、React 组件名或原生扩展源码。

## 结论摘要

Codex 宠物不是单独的装饰动画，而是一套桌面任务伴侣：

- 宠物状态由任务运行、审批、提问、计划确认、完成和失败驱动。
- 宠物通过独立透明置顶窗口显示，可拖动、调整头像尺寸、点击穿透，并能把用户带回对应任务。
- 自定义宠物以 `pet.json` 和 PNG/WebP spritesheet 组成。
- 标准动画使用 8 列、9 个语义行；当前 v2 包再增加 2 行、共 16 个顺时针注视方向。
- Electron 主进程只管理窗口、IPC 和桌面集成；任务真值仍来自 renderer/Agent 的会话投影。

这与 OpenAI 对 Codex App 的公开定位一致：应用是多个智能体与长任务的“控制中心”，需要持续呈现问题、批准和任务输出，而不是只有单轮聊天。[Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)、[Work with Codex from anywhere](https://openai.com/index/work-with-codex-from-anywhere/)

## 证据层级

分析按以下优先级处理冲突：

1. OpenAI 产品文档：确认产品目标和任务交互语义。
2. OpenAI 宠物制作规范：确认图集几何、动画行和包结构。
3. 本地 Codex build 静态分析：确认运行时窗口、状态机、常量和 IPC。
4. OpenAI Codex 仓库 issue：只视为社区现场报告，不作为正式 API 承诺。

固定研究快照：

- `openai/skills@49f948faa9258a0c61caceaf225e179651397431`
- `openai/plugins@11c74d6ba24d3a6d48f54a194cd00ef3beea18f9`
- `openai/codex@5c94796dc9e88580fdf0b05ef9ce9d975a86e1a6`

旧版 OpenAI skills 仓库中的 `hatch-pet` 记录了 8×9 公共基线；本机当前 `hatch-pet` 技能已经演进为 v2 8×11 生成与 QA 流程。两者并不矛盾：v2 前 9 行保持相同语义，再增加两个方向行。

## 分析对象

主要静态分析对象：

- `F:\CodeProject\Codex-analysis\formatted\main.js`
- `F:\CodeProject\Codex-analysis\formatted\webview-all\assets\`
- `F:\CodeProject\Codex-analysis\formatted\webview-all\assets\codex-avatar-CBhzyYwb.css`
- `F:\CodeProject\Codex-analysis\formatted\webview-all\assets\avatar-overlay-pill-material-BheeR2ow.css`
- `F:\CodeProject\Codex-analysis\formatted\webview-all\assets\avatar-overlay-native-frame-CH1Rthht.css`

格式化后的 bundle 没有 source map，因此符号名、源码目录、注释、泛型和原始模块边界不能可靠恢复。本文只采用跨 chunk 可重复观察到的常量、字符串、协议和控制流。

## 宠物包

### 清单

运行时可确认的核心字段：

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "description": "Optional description",
  "spriteVersionNumber": 2,
  "spritesheetPath": "spritesheet.webp"
}
```

`spriteVersionNumber` 缺失时按 v1 解释。v2 图集必须显式写入 `2`，否则 2288 像素高的图集会按 9 行契约处理。

官方制作流程将自定义宠物安装到：

```text
${CODEX_HOME:-$HOME/.codex}/pets/<pet-id>/
  pet.json
  spritesheet.webp
```

### 下载状态机

逆向得到的安装 UI 状态：

```text
null
  -> loading
  -> ready
  -> installing
  -> installed

loading -> previewError
installing -> installError
```

相关 RPC/bridge 语义可归纳为预览与安装两个动作。下载限制：

- 生产地址必须使用 HTTPS；localhost 开发地址允许 HTTP。
- 拒绝 301、302、303、307 和 308。
- 仅接受 PNG/WebP。
- 图集上限 20 MiB。
- `spritesheetPath` 必须保持为包内相对路径。
- 安装前必须校验图集契约。

### WSL 路径风险

社区 issue 报告过自定义宠物在 WSL 与 Windows 路径之间归一化失败。这不是正式规范，但提示实现必须区分：

- Windows 原生路径，例如 `F:\pets\demo`
- WSL 挂载路径，例如 `/mnt/f/pets/demo`
- 自定义 `CODEX_HOME`

不能对 Windows 路径使用 `path.posix.join`，也不能把绝对路径写入 `spritesheetPath`。[WSL custom pet path report](https://github.com/openai/codex/issues/20730)

## 图集与动画

### 几何

每个 cell 是 `192×208`，每行 8 个 cell。

| 版本 | 网格 |  图集尺寸 | 用途                 |
| ---- | ---: | --------: | -------------------- |
| v1   |  8×9 | 1536×1872 | 标准动画             |
| v2   | 8×11 | 1536×2288 | 标准动画 + 16 个方向 |

### 标准动画行

|  行 | 状态          | 帧数 | 每帧时长（毫秒）             |
| --: | ------------- | ---: | ---------------------------- |
|   0 | idle          |    6 | 280, 110, 110, 140, 140, 320 |
|   1 | running-right |    8 | 120×7, 220                   |
|   2 | running-left  |    8 | 120×7, 220                   |
|   3 | waving        |    4 | 140×3, 280                   |
|   4 | jumping       |    5 | 140×4, 280                   |
|   5 | failed        |    8 | 140×7, 240                   |
|   6 | waiting       |    6 | 150×5, 260                   |
|   7 | running       |    6 | 120×5, 220                   |
|   8 | review        |    6 | 150×5, 280                   |

空闲动画在稳定状态下整体放慢 6 倍。非空闲动画通常播放 3 次后回到 idle。开启 reduced motion 时停在第 0 帧。

### v2 方向行

v2 使用第 9、10 行表示 16 个顺时针方向：

```text
row 9:  000, 022.5, 045, 067.5, 090, 112.5, 135, 157.5
row 10: 180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5
```

`000` 表示向上，不是正面 neutral。当前本机制作规范允许使用额外的 neutral/default slot，但指针死区仍应回退到 idle，不能把 `000` 当作 neutral。

方向动画的生成细节不属于桌面运行时协议。运行时只需要知道版本、行数和目标 frame；生成、去色、透明像素残留、方向盲测和连贯性 QA 应由 `hatch-pet` 工具链负责。

## 状态映射

高置信度映射：

| 会话/交互状态        | 宠物动画             | 提醒         |
| -------------------- | -------------------- | ------------ |
| 空闲                 | idle                 | 无           |
| 新 blocker           | waving，随后 waiting | 持久         |
| 审批/问题/计划待处理 | waiting              | 持久         |
| 任务运行中           | running              | 无或低优先级 |
| Review 工作流        | review               | 按需         |
| 完成                 | jumping              | 约 15 秒     |
| 失败                 | failed               | 约 30 秒     |
| 水平拖动             | running-left/right   | 无           |

提醒优先级可归纳为：

```text
question / approval / plan
  > failed
  > network / exec / tool
  > completed
```

blocker 的稳定标识来自 `threadId + requestId`。完成/失败属于状态边事件，应包含更新时间，避免同一任务后续运行被错误去重。

## Overlay 窗口

### Electron 行为

逆向得到的主要特征：

- 独立路由 `/avatar-overlay`；复刻时可使用等价的 `/pet-overlay`。
- 透明、无边框、置顶、跨工作区可见、跳过任务栏。
- 默认点击穿透；只有宠物、托盘和输入区域可交互。
- 需要键盘输入时临时变为 focusable。
- 拖拽阈值约 4 px，并记录指针速度用于投掷/停靠。
- 宠物内容尺寸允许 `80–224`。
- 可恢复窗口 bounds，并在显示器拔插后回到可见 work area。

默认 renderer 版面约为 `356×320`；宠物主体约 `112×121`；提醒托盘宽度约 345。

### 已复刻的方向与投掷参数

v2 `8×11` 图集的 row 9/10 分别承载前 8 个和后 8 个鼠标方向，0° 从正上方开始，顺时针每 22.5° 一格。浮窗实现使用全局鼠标坐标与宠物 DOM 的屏幕中心计算，1px 内回退普通动画。

投掷实现固定采用最近 160ms 样本、4px 拖动阈值、320px/s 启动阈值、1600px/s 原始速度上限和 3 倍投掷倍率。8ms tick 中将帧时间限制为 32ms，按 `0.88 ** (dt / 16)` 衰减；边缘以 0.7 系数反弹，并在 65px/s 或 900ms 时停止。

### 已复刻的提醒交互

提醒不再只有“打开任务”：问题沿用主会话的 AskUserQuestion 答案模型，审批只暴露一次性 allow/deny，计划暴露 execute/deny；自由回复按会话状态选择 follow-up 或普通用户消息。键盘焦点仍由专用 preload bridge 控制，没有向 renderer 开放任意 Electron IPC。

### 原生扩展

build 包含 `avatar_overlay.node` 和 composition surface 页面。加载分支显示该扩展仅在 `darwin` 使用；Windows 并不依赖同一原生实现。

原生通道包含 `prepare → mount → paint → attach` 一类生命周期，并通过 MessageChannel 连接。没有原生二进制的符号与源码时，无法可靠恢复其 Objective-C/C++ 实现；跨平台复刻应以 BrowserWindow 透明 overlay 为基线。

## 样式

宠物视觉由三组样式共同完成：

- avatar spritesheet 裁切与图像渲染
- pill/material 的半透明表面、描边、阴影与模糊
- native frame/composition surface 的透明容器

大量 utility class 位于 JS 字符串中，而不是独立 CSS 文件。例如 `p-[var(--padding-panel)]`、`rounded-2xl`、`bg-token-editor-background/50`。因此只分析 CSS 文件不能得到完整页面样式；必须同时扫描 JSX `className`、CSS module 映射、内联 style 与运行时变量。

## Source map 缺失意味着什么

没有 source map 不等于“完全不能还原”，但还原层级不同：

可高置信度恢复：

- UI 文案和状态
- RPC/IPC 名称
- 常量、尺寸、动画时序
- 网络与安全限制
- 主要数据流和窗口生命周期

不能精确恢复：

- 原始文件名和组件名
- TypeScript 类型、泛型和注释
- tree-shaking 前的模块边界
- 未进入 bundle 的分支
- 原生扩展内部实现

所以复刻目标应是行为兼容和协议兼容，而不是制造看似原始、实为猜测的“源码”。

## 置信度与待确认项

| 结论                                       | 置信度       |
| ------------------------------------------ | ------------ |
| 8 列、9 个标准动画行及帧时长               | 高           |
| v1/v2 尺寸与 `spriteVersionNumber`         | 高           |
| HTTPS、拒绝重定向、PNG/WebP、20 MiB        | 高           |
| Overlay 透明置顶、点击穿透、拖拽与尺寸范围 | 高           |
| blocker/完成/失败到动画的总体映射          | 高           |
| macOS 原生 composition surface 内部实现    | 低，无法恢复 |
| v2 方向行、角度映射和 1px 死区             | 高           |
| 投掷采样、阈值、衰减、反弹和停止参数       | 高           |

## 相关资料

- [OpenAI Codex app announcement](https://openai.com/index/introducing-the-codex-app/)
- [OpenAI Codex remote work announcement](https://openai.com/index/work-with-codex-from-anywhere/)
- [OpenAI hatch-pet skill snapshot](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/hatch-pet/SKILL.md)
- [OpenAI hatch-pet animation rows](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/hatch-pet/references/animation-rows.md)
- [OpenAI hatch-pet validator](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/hatch-pet/scripts/validate_atlas.py)
