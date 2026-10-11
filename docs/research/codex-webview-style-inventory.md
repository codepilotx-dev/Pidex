# Codex Webview 全量样式清单

> 本文由 `InventoryCodexStyles.ts` 从构建产物确定性生成。扫描源保持只读，报告不记录本机绝对路径。构建产物没有 source map；定位统一使用文件名、selector/binding 与 byte offset。

## 快照、范围与完整性

- 快照指纹：`a13155edcbf8f9e821ebc1fb0c4cebd589d7d0d2cddf0079d1ab9b0c2b42a1e1`
- 资源：4790 个 assets，外加 2 个相邻 HTML。
- 声明源：CSS 23、HTML style block 2、HTML style attribute 1、脚本 4582（JS 4581、MJS 1）。
- 外部 CSS：781917 bytes、6218 条规则、11115 条普通规则声明；另有 398 条 at-rule 直属声明，总计 11513。
- HTML 内联：18 条规则、58 条声明。
- JS 静态 CSS：10 个 payload、479208 字符；动态生成器和变量写入单独登记。
- CSS 能力：1342 个基线自定义属性、68 个外部 CSS keyframes、133 个媒体查询、43 个容器查询、36 个字体面。
- 解析：外部 CSS PostCSS 23/23、LightningCSS 23/23。
- 高亮主题：151 个物理模块、91 个逻辑主题；使用 Shiki 与 CodeMirror，未发现 Monaco。
- 完整 selector、specificity、声明、变量 fallback、at-rule、URL、HTML/JS owner 和 offset 位于配套 JSON。

“全部样式”包括可静态恢复的 CSS/HTML/JS 定义和无法静态求值的运行时样式边界。Lucide 几何、TextMate grammar、locale 与单纯 class 消费点不重复计为样式定义。

## CSS 文件与职责

| 文件 | bytes | rules | rule declarations | at-rule declarations | keyframes | media | container | 职责 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `app-CnsXMFE2.css` | 615585 | 5162 | 8391 | 308 | 21 | 89 | 30 | 全局设计系统、Tailwind、主题、Shell、KaTeX |
| `app-initial~app-main~hotkey-window-thread-page~quick-chat-window-page~appearance-settings~i~f8u0tzsn-H4NGgmRi.css` | 470 | 7 | 10 | 0 | 1 | 1 | 0 | 页面或组件拆分样式 |
| `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` | 63372 | 471 | 1216 | 0 | 17 | 6 | 9 | Markdown、Composer、编辑器、菜单与共享组件 |
| `app-initial~app-main~onboarding-page-B4J4ni_U.css` | 3598 | 34 | 74 | 0 | 2 | 2 | 0 | Onboarding、UAC、结果 shimmer |
| `app-initial~app-main~page-Ui27V2TN.css` | 8826 | 64 | 151 | 0 | 7 | 1 | 0 | 页面切换、Toast、滚动遮罩、Highlight.js |
| `app-initial~app-main~page~quick-chat-window-page~chatgpt-conversation-page-Bps-0OA4.css` | 4401 | 53 | 97 | 0 | 0 | 1 | 0 | Recharts 图表、图例与提示框 |
| `app-initial~app-main~projects-index-page~hotkey-window-thread-page~thread-app-shell-chrome~~bg7586oi-Bj9zvK4d.css` | 302 | 4 | 11 | 0 | 1 | 0 | 0 | 页面或组件拆分样式 |
| `app-initial~app-main~quick-chat-window-page~chatgpt-conversation-page-BmiNbp0u.css` | 48547 | 220 | 496 | 0 | 6 | 22 | 0 | Mapbox、Recharts、ChatGPT 加载与图表 |
| `avatar-overlay-native-frame-CH1Rthht.css` | 466 | 3 | 6 | 0 | 0 | 0 | 0 | Avatar 容器、玻璃胶囊与缩放命中区 |
| `avatar-overlay-pill-material-BNTptT42.css` | 1751 | 14 | 31 | 0 | 0 | 1 | 0 | Avatar 容器、玻璃胶囊与缩放命中区 |
| `codex-avatar-CBhzyYwb.css` | 635 | 3 | 8 | 0 | 0 | 0 | 0 | Avatar 容器、玻璃胶囊与缩放命中区 |
| `codex-micro-bridge-CRTmZgHP.css` | 3935 | 8 | 48 | 3 | 1 | 1 | 0 | 页面或组件拆分样式 |
| `global-dictation-orb-BOlLShjq.css` | 474 | 3 | 10 | 0 | 0 | 2 | 0 | 全局听写表面与录音 Orb |
| `global-dictation-page-DGhXs35T.css` | 1109 | 5 | 25 | 0 | 0 | 2 | 0 | 全局听写表面与录音 Orb |
| `hotkey-window-home-page-C6z-fZIi.css` | 1184 | 7 | 22 | 0 | 0 | 0 | 0 | 页面或组件拆分样式 |
| `model-picker-power-slider-impl-DB_ZXGOd.css` | 12232 | 91 | 296 | 3 | 10 | 0 | 0 | 模型 Power Slider、Fast/Max 与粒子动效 |
| `onboarding-page-3LCOx5Jc.css` | 272 | 3 | 4 | 0 | 1 | 1 | 0 | Onboarding、UAC、结果 shimmer |
| `pdf-preview-panel-BHPFKiOr.css` | 1640 | 14 | 51 | 0 | 0 | 0 | 0 | PDF.js 文本层与批注层 |
| `plugins-page-DoKhPslE.css` | 197 | 3 | 3 | 0 | 0 | 0 | 1 | 插件页容器查询网格 |
| `PopcornElectronPresentationPanel-pMDpowHW.css` | 5037 | 30 | 130 | 0 | 0 | 1 | 3 | 演示文稿编辑器与响应式布局 |
| `profile-DOxOBCjz.css` | 1209 | 6 | 16 | 0 | 1 | 1 | 0 | 资料页骨架与头像编辑 |
| `remote-text-edit-session-CW-aJKLZ.css` | 4401 | 0 | 0 | 84 | 0 | 0 | 0 | Carlito 多语种字体切片 |
| `thread-user-message-navigation-rail-CX3TkeeC.css` | 2274 | 13 | 19 | 0 | 0 | 2 | 0 | 用户消息导航轨和 scrub 状态 |

主 CSS 的层顺序为 properties/theme/base/components/utilities。第三方边界包括 KaTeX、ProseMirror、xterm、Recharts、Mapbox GL、PDF.js、Highlight.js 和 Carlito。

## HTML 内联样式

| 来源 | 类型 | chars | rules | declarations | keyframes | 职责 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `avatar-overlay-composition-surface.html#style[0]` | style block | 172 | 1 | 5 | 0 | 透明满屏 Avatar composition surface |
| `index.html#style[0]` | style block | 8003 | 17 | 52 | 2 | 启动 Loader、层顺序、主题 shimmer、reduced-motion |
| `index.html#style-attribute[0]` | style attribute | 13 | 0 | 1 | 0 | body outline |

相邻 HTML 的链接、脚本和内联 CSS 均进入快照指纹与审计；入口依赖图和样式定义统计保持分口径。
入口可达 assets 4340 个；未能从静态 HTML/JS 引用图恢复的 450 个资源仍逐文件完成分类审计。完整入口 roots 位于 JSON 的 `snapshot.loadGraph`。

## 设计系统总览

### 令牌分层

| 令牌组 | 唯一名称数 |
| --- | ---: |
| color | 628 |
| layout-component-other | 763 |
| motion | 25 |
| radius | 56 |
| shadow | 46 |
| spacing | 15 |
| tailwind-internal | 77 |
| typography | 138 |
| vscode-compat | 736 |

- 应用颜色原语：40。
- Tailwind 调色板 token：25。
- 产品 `--color-token-*`：117。
- 广义语义颜色：391。
- VS Code 兼容 token：736。
- 组件与状态颜色：260。
- Tailwind `--tw-*` 是内部运行变量，只登记，不建议迁移。
- 间距以 `--spacing: .25rem`（4px）为基准；完整 light/dark、window type 和 selector 级覆盖位于 JSON 的 `designSystem.tokens.definitions`。

### 颜色格式与主题

| 格式 | 出现次数 |
| --- | ---: |
| color-mix | 649 |
| conic-gradient | 5 |
| hex | 1166 |
| hsl | 1 |
| linear-gradient | 119 |
| oklch | 66 |
| radial-gradient | 10 |
| rgb | 40 |

Electron light/dark、浏览器窗口、扩展窗口和 VS Code 兼容层通过 selector/context 保留全部覆盖值，不做错误的 latest-wins 合并。

### 字体与排版

| family | style | weight | faces | 来源 |
| --- | --- | --- | ---: | --- |
| `Carlito` | normal | 400 | 7 | `remote-text-edit-session-CW-aJKLZ.css` |
| `Carlito` | normal | 700 | 7 | `remote-text-edit-session-CW-aJKLZ.css` |
| `KaTeX_AMS` | normal | 400 | 2 | `app-CnsXMFE2.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `KaTeX_Caligraphic` | normal | 400 | 2 | `app-CnsXMFE2.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `KaTeX_Caligraphic` | normal | 700 | 2 | `app-CnsXMFE2.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `KaTeX_Fraktur` | normal | 400 | 2 | `app-CnsXMFE2.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `KaTeX_Fraktur` | normal | 700 | 2 | `app-CnsXMFE2.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `KaTeX_Main` | italic | 400 | 2 | `app-CnsXMFE2.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `KaTeX_Main` | normal | 400 | 2 | `app-CnsXMFE2.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `KaTeX_Main` | italic | 700 | 2 | `app-CnsXMFE2.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `KaTeX_Main` | normal | 700 | 2 | `app-CnsXMFE2.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `KaTeX_Math` | italic | 400 | 2 | `app-CnsXMFE2.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `KaTeX_Math` | italic | 700 | 2 | `app-CnsXMFE2.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `KaTeX_SansSerif` | italic | 400 | 2 | `app-CnsXMFE2.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `KaTeX_SansSerif` | normal | 400 | 2 | `app-CnsXMFE2.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `KaTeX_SansSerif` | normal | 700 | 2 | `app-CnsXMFE2.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `KaTeX_Script` | normal | 400 | 2 | `app-CnsXMFE2.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `KaTeX_Size1` | normal | 400 | 2 | `app-CnsXMFE2.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `KaTeX_Size2` | normal | 400 | 2 | `app-CnsXMFE2.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `KaTeX_Size3` | normal | 400 | 2 | `app-CnsXMFE2.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `KaTeX_Size4` | normal | 400 | 2 | `app-CnsXMFE2.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `KaTeX_Typewriter` | normal | 400 | 2 | `app-CnsXMFE2.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `OpenAI Sans` | italic | 400 | 1 | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `OpenAI Sans` | normal | 400 | 2 | `app-CnsXMFE2.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `OpenAI Sans` | italic | 500 | 1 | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `OpenAI Sans` | normal | 500 | 2 | `app-CnsXMFE2.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `OpenAI Sans` | italic | 600 | 1 | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `OpenAI Sans` | normal | 600 | 1 | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `OpenAI Sans` | italic | 700 | 1 | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `OpenAI Sans` | normal | 700 | 1 | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |

系统 sans、编辑器 mono、OpenAI Sans、KaTeX 和 Carlito 均保留；完整 font-face src、unicode-range、字号、行高和字重位于 JSON。

高频排版值：

| 属性 | 值 | 次数 |
| --- | --- | ---: |
| `font-weight` | `var(--font-weight-medium)` | 31 |
| `font-size` | `1em` | 29 |
| `font-weight` | `var(--font-weight-semibold)` | 29 |
| `font-style` | `italic` | 19 |
| `line-height` | `1` | 18 |
| `font-weight` | `700` | 16 |
| `font-size` | `var(--font-text-xs-size)` | 15 |
| `font-weight` | `var(--font-weight-normal)` | 15 |
| `font-size` | `var(--font-text-sm-size)` | 13 |
| `line-height` | `inherit` | 13 |
| `font-weight` | `var(--font-weight-bold)` | 12 |
| `font-size` | `14px` | 11 |
| `font-weight` | `600` | 11 |
| `font-size` | `inherit` | 10 |
| `line-height` | `var(--font-text-sm-line-height)` | 10 |
| `line-height` | `var(--font-text-xs-line-height)` | 10 |
| `font` | `inherit` | 9 |
| `font-size` | `1.2em` | 9 |
| `font-size` | `12px` | 9 |
| `font-size` | `16px` | 9 |

### 间距、圆角与阴影

高频间距值：

| 属性 | 值 | 次数 |
| --- | --- | ---: |
| `padding` | `0` | 41 |
| `margin` | `0` | 34 |
| `padding-block` | `0` | 20 |
| `gap` | `calc(var(--spacing) * 1)` | 19 |
| `gap` | `calc(var(--spacing) * 1.5)` | 12 |
| `margin-block-start` | `calc(var(--spacing) * 4)` | 12 |
| `gap` | `calc(var(--spacing) * 2)` | 10 |
| `margin-bottom` | `0` | 10 |
| `margin-top` | `0` | 10 |
| `margin-block-start` | `calc(var(--spacing) * 2)` | 8 |
| `padding-block` | `calc(var(--spacing) * 2)` | 8 |
| `padding-inline-start` | `0` | 8 |
| `margin-inline-start` | `calc(var(--spacing) * 3)` | 7 |
| `padding-inline` | `calc(var(--spacing) * 2)` | 7 |
| `padding-left` | `calc(var(--spacing) * 2)` | 7 |
| `margin-top` | `calc(var(--spacing) * 0)` | 6 |
| `margin-top` | `calc(var(--spacing) * 1)` | 6 |
| `margin-top` | `calc(var(--spacing) * 2)` | 6 |
| `padding-inline` | `calc(var(--spacing) * 0)` | 6 |
| `padding-left` | `calc(var(--spacing) * 6)` | 6 |

高频圆角值：

| 属性 | 值 | 次数 |
| --- | --- | ---: |
| `border-radius` | `var(--radius-full)` | 25 |
| `border-radius` | `inherit` | 21 |
| `border-radius` | `var(--radius-md)` | 21 |
| `border-radius` | `0` | 18 |
| `border-radius` | `999px` | 18 |
| `border-radius` | `50%` | 12 |
| `border-radius` | `100%` | 11 |
| `border-radius` | `var(--radius-sm)` | 11 |
| `border-radius` | `12px` | 9 |
| `border-radius` | `var(--radius-lg)` | 9 |
| `border-radius` | `var(--radius-3xl)` | 8 |
| `border-bottom-left-radius` | `0` | 6 |
| `border-bottom-right-radius` | `0` | 6 |
| `border-radius` | `4px` | 6 |
| `border-radius` | `6px` | 6 |
| `border-radius` | `9999px` | 6 |
| `border-radius` | `var(--radius-2xs)` | 6 |
| `border-radius` | `var(--radius-xl)` | 6 |
| `border-top-left-radius` | `0` | 6 |
| `border-top-right-radius` | `0` | 6 |

高频阴影值：

| 属性 | 值 | 次数 |
| --- | --- | ---: |
| `box-shadow` | `var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow)` | 104 |
| `box-shadow` | `none` | 23 |
| `box-shadow` | `0 0 0 1px var(--input-border-color-invalid) inset` | 6 |
| `box-shadow` | `var(--shadow-200)` | 5 |
| `box-shadow` | `var(--shadow),var(--shadow-hairline)` | 5 |
| `box-shadow` | `0 0 0 1px var(--select-border-focus-color) inset` | 4 |
| `box-shadow` | `0 0 2px 2px #0096ff` | 4 |
| `box-shadow` | `var(--elevation-prominent)` | 4 |
| `box-shadow` | `inset 0 0 0 1px var(--alpha-06)` | 3 |
| `box-shadow` | `var(--oai-wb-shadow-lg)` | 3 |
| `box-shadow` | `var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)` | 3 |
| `box-shadow` | `0 0 0 1px var(--button-border-color-hover) inset,var(--button-shadow-custom, 0 0 #00000000)` | 2 |
| `box-shadow` | `0 0 0 1px var(--input-outline-border-color-focus) inset` | 2 |
| `box-shadow` | `0 0 0 1px var(--input-outline-border-color-hover) inset` | 2 |
| `box-shadow` | `0 0 0 1px var(--input-outline-border-color) inset` | 2 |
| `box-shadow` | `0 0 0 1px var(--input-soft-border-color-focus) inset` | 2 |
| `box-shadow` | `0 0 0 2px #0000001a` | 2 |
| `box-shadow` | `0 0 3px #00000059` | 2 |
| `box-shadow` | `0 1px 2px #0000001a` | 2 |
| `box-shadow` | `inset 0 0 0 1px var(--alpha-10)` | 2 |

### 动效

| keyframes | 来源 | steps |
| --- | --- | --- |
| `_agentIdenticonEmptyScan_1qzyf_1` | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` | 0%,20%, 20.001%,to |
| `_agentIdenticonFilledScan_1qzyf_1` | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` | 0%,20%, 20.001%,to |
| `_cadencedLoadingShimmerHighlight_1q6es_1` | `app-initial~app-main~quick-chat-window-page~chatgpt-conversation-page-BmiNbp0u.css` | 0%, to |
| `_cadencedLoadingShimmerSweep_1q6es_1` | `app-initial~app-main~quick-chat-window-page~chatgpt-conversation-page-BmiNbp0u.css` | 0%, to |
| `_chatgpt-loading-dot-pulse-size_4qtgs_1` | `app-initial~app-main~quick-chat-window-page~chatgpt-conversation-page-BmiNbp0u.css` | 0%,to, 50% |
| `_chip-enter_jj3nd_1` | `app-initial~app-main~onboarding-page-B4J4ni_U.css` | 0%, 70%, to |
| `_codex-to-chatgpt-content-in_15ovm_1` | `app-initial~app-main~page-Ui27V2TN.css` | 0%, to |
| `_codex-to-chatgpt-content-out_15ovm_1` | `app-initial~app-main~page-Ui27V2TN.css` | 0%, to |
| `_curtainLower_6t09y_1` | `app-initial~app-main~page-Ui27V2TN.css` | 0%, to |
| `_curtainRaise_6t09y_1` | `app-initial~app-main~page-Ui27V2TN.css` | 0%, to |
| `_dot-field-opacity_g8wjd_1` | `app-initial~app-main~quick-chat-window-page~chatgpt-conversation-page-BmiNbp0u.css` | 50% |
| `_dropdown-content-exit-delay_s9h9g_1` | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` | 0%, to |
| `_EnableModelPickerPowerSliderThumbInputMotion_3jngk_1` | `model-picker-power-slider-impl-DB_ZXGOd.css` | to |
| `_enter_16ogz_13` | `app-initial~app-main~page-Ui27V2TN.css` | 0%, to |
| `_fade-in_12ojb_1` | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` | to |
| `_fade-in-marker_12ojb_1` | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` | 0% |
| `_FastModeTickFade_3jngk_1` | `model-picker-power-slider-impl-DB_ZXGOd.css` | 0%, to |
| `_FastModeTickReturnFade_3jngk_1` | `model-picker-power-slider-impl-DB_ZXGOd.css` | 0%, to |
| `_FastModeTickReturnScale_3jngk_1` | `model-picker-power-slider-impl-DB_ZXGOd.css` | 0%, to |
| `_FastModeTickReturnTranslate_3jngk_1` | `model-picker-power-slider-impl-DB_ZXGOd.css` | 0%, to |
| `_FastModeTickScale_3jngk_1` | `model-picker-power-slider-impl-DB_ZXGOd.css` | 0%, to |
| `_FastModeTickTranslate_3jngk_1` | `model-picker-power-slider-impl-DB_ZXGOd.css` | 0%, to |
| `_FastTrackParticleTravel_1pz9e_1` | `model-picker-power-slider-impl-DB_ZXGOd.css` | 0%, 8%, 92%, to |
| `_image-enter_12ojb_1` | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` | 0%, to |
| `_loadingResultsShimmer_1cbkl_1` | `app-initial~app-main~onboarding-page-B4J4ni_U.css` | 0%, to |
| `_ParticleBurst_1pz9e_1` | `model-picker-power-slider-impl-DB_ZXGOd.css` | 0%, 22%, to |
| `_profile-loading-page-sweep_1lb04_1` | `profile-DOxOBCjz.css` | to |
| `_progression-donut-fill_q754t_1` | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` | 0% |
| `_referralModalMarkSend_apgx5_1` | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` | 0%, 15%, 78%, 90%, to |
| `_referralModalReducedMarkSend_apgx5_1` | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` | to |
| `_referralModalReducedRenderSend_apgx5_1` | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` | to |
| `_referralModalRenderSend_apgx5_1` | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` | 0%, 15%, 34%, 52%, 70%, 84%, to |
| `_referralModalSubmittingHover_apgx5_1` | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` | 0%,to, 50% |
| `_referralModalSubmittingTilt_apgx5_1` | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` | 0%,to, 50% |
| `_Reveal_notip_1` | `model-picker-power-slider-impl-DB_ZXGOd.css` | 0%, to |
| `_statusPillProgress_1a6wl_1` | `app-initial~app-main~projects-index-page~hotkey-window-thread-page~thread-app-shell-chrome~~bg7586oi-Bj9zvK4d.css` | 0%, .001%, to |
| `_toast-close_gnhgp_1` | `app-initial~app-main~page-Ui27V2TN.css` | 0%, to |
| `_toast-open_gnhgp_1` | `app-initial~app-main~page-Ui27V2TN.css` | 0%, to |
| `_uac-arrow-bounce_cwr2x_1` | `onboarding-page-3LCOx5Jc.css` | to |
| `_UltraUsageWarningShimmer_1k6l7_1` | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` | 0%, to |
| `_work-dropdown-content-enter_imygr_1` | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` | 0%, to |
| `_work-dropdown-content-exit_imygr_1` | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` | 0%, to |
| `_working-dot-wave_1y69c_1` | `app-initial~app-main~hotkey-window-thread-page~quick-chat-window-page~appearance-settings~i~f8u0tzsn-H4NGgmRi.css` | 0%,10%,to, 25%, 55%, 70% |
| `_writingBlockLoadingShimmer_v8rv1_1` | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` | 0%, to |
| `blinking` | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-k1satKyX.js#static-css@6607433` | 0%, 50%, to |
| `browser-comment-popup-shake` | `app-CnsXMFE2.css` | 0%,to, 12%, 26%, 40%, 54%, 68%, 82% |
| `browser-comment-popup-shake` | `popcorn-electron-surface-style-DmQneSR_.js#static-css@21275` | 0%,
  100%, 12%, 26%, 40%, 54%, 68%, 82% |
| `browser-sidebar-design-editor-entry-enter` | `app-CnsXMFE2.css` | 0%, 32%, to |
| `browser-sidebar-device-rotate-click` | `app-CnsXMFE2.css` | 0%, 22%, 42%, 64%, 84%, to |
| `browser-sidebar-screenshot-click` | `app-CnsXMFE2.css` | 0%, 10%, 22%, 38%, 58%, 76%, 90%, to |
| `browser-sidebar-screenshot-color-linger` | `app-CnsXMFE2.css` | 0%, 12%, 84%, to |
| `browser-sidebar-zoom-icon-click` | `app-CnsXMFE2.css` | 0%, 44%, to |
| `composer-navigation-snake` | `codex-micro-bridge-CRTmZgHP.css` | to |
| `edge-fade` | `app-CnsXMFE2.css` | 0%, 1%, 99%, to |
| `edge-fade-bottom` | `app-CnsXMFE2.css` | 0%, 1%, 99%, to |
| `edge-fade-horizontal` | `app-CnsXMFE2.css` | 0%, .1%, 99.9%, to |
| `edge-fade-top` | `app-CnsXMFE2.css` | 0%, 1%, 99%, to |
| `fade-in--L1V-O` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, to |
| `generated-image-placeholder-pulse` | `app-CnsXMFE2.css` | 0%,to, 50% |
| `loading-block-pulse--KrC1q` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, to |
| `loading-indeterminate--k8-uH` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, to |
| `loading-pulse--t2LhB` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, to |
| `loading-sheen--U-Fon` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, to |
| `loading-shimmer` | `app-CnsXMFE2.css` | 0%, to |
| `mapboxgl-spin` | `app-initial~app-main~quick-chat-window-page~chatgpt-conversation-page-BmiNbp0u.css` | 0%, to |
| `mapboxgl-spin` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, to |
| `mapboxgl-user-location-dot-pulse` | `app-initial~app-main~quick-chat-window-page~chatgpt-conversation-page-BmiNbp0u.css` | 0%, 70%, to |
| `mapboxgl-user-location-dot-pulse` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, 70%, to |
| `mcp-app-loading-pulse` | `app-CnsXMFE2.css` | 0%,to, 50% |
| `native-autofill-in--4Gt1t` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, to |
| `native-autofill-in--AZdW3` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, to |
| `native-autofill-in--eeVKB` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, to |
| `native-autofill-in--JZ1nI` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, to |
| `native-autofill-in--S0WdR` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, to |
| `native-autofill-in--uf-CU` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, to |
| `openai-blossom-shimmer` | `app-CnsXMFE2.css` | 0%, to |
| `paged-annotation-editor-enter` | `app-CnsXMFE2.css` | 0%, to |
| `ping` | `app-CnsXMFE2.css` | 75%,to |
| `ping` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 75%,to |
| `pulse` | `app-CnsXMFE2.css` | 50% |
| `pulse--57HwA` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, 20%, to |
| `pulse--DurVc` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, 90%,to |
| `pulse-size--S8aIh` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%,to, 50% |
| `right-panel-composer-overlay-enter` | `app-CnsXMFE2.css` | 0%, to |
| `rotate--SeMs3` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, to |
| `rotate--tIRVA` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, to |
| `rotate--Vv4-y` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, to |
| `scale-in--ntcmn` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, to |
| `scale-in--R7TaO` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, to |
| `scale-out--dGKVg` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, to |
| `shake--y2ssb` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, 20%,60%, 40%,80%, to |
| `shimmer--LFC34` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, 70%, to |
| `shimmer--XR9Hk` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, 70%, to |
| `smoothing-move--YvJDj` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, to |
| `spin` | `app-CnsXMFE2.css` | to |
| `startup-openai-blossom-fade-in` | `../index.html#style[0]` | 0%, 100% |
| `startup-openai-blossom-shimmer` | `../index.html#style[0]` | 0%, 100% |
| `sync-dot-pass-down` | `app-CnsXMFE2.css` | 0%,50%,to, 12%, 25%, 38% |
| `sync-dot-pass-up` | `app-CnsXMFE2.css` | 0%,50%,to, 62%, 75%, 88% |
| `w-entrance-reveal--Ji8Bg` | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` | 0%, to |

高频 animation/transition 值：

| 属性 | 值 | 次数 |
| --- | --- | ---: |
| `transition-duration` | `var(--tw-duration,var(--default-transition-duration))` | 41 |
| `transition-timing-function` | `var(--tw-ease,var(--default-transition-timing-function))` | 41 |
| `animation` | `none` | 40 |
| `transition-duration` | `var(--transition-duration-basic)` | 21 |
| `transition-timing-function` | `var(--transition-ease-basic)` | 19 |
| `transition` | `background-color 0s 50000s,box-shadow 0s 50000s,filter 0s 50000s` | 12 |
| `transition-property` | `opacity,transform` | 9 |
| `transition` | `none` | 8 |
| `animation-iteration-count` | `infinite` | 7 |
| `animation-timing-function` | `linear` | 7 |
| `transition-delay` | `0s` | 7 |
| `transition-duration` | `.15s` | 7 |
| `transition-timing-function` | `var(--cubic-enter)` | 7 |
| `transition` | `font-size 0s 50000s` | 6 |
| `transition-property` | `color,box-shadow,background-color` | 6 |
| `transition-timing-function` | `ease` | 6 |
| `animation-delay` | `0s` | 5 |
| `animation-fill-mode` | `both` | 5 |
| `transition-property` | `none` | 5 |
| `transition-duration` | `.45s` | 4 |

## 响应式、平台与无障碍样式证据

| 类型 | 值 | 次数 | 来源 |
| --- | --- | ---: | --- |
| window-type | `electron` | 80 | `app-CnsXMFE2.css`, `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css`, `docx-preview-panel-Dk7clHXt.js#static-css@41124` |
| window-type | `browser` | 60 | `app-CnsXMFE2.css`, `docx-preview-panel-Dk7clHXt.js#static-css@41124` |
| window-type | `chrome-extension` | 59 | `app-CnsXMFE2.css`, `docx-preview-panel-Dk7clHXt.js#static-css@41124` |
| window-type | `extension` | 43 | `app-CnsXMFE2.css` |
| os | `win32` | 1 | `app-CnsXMFE2.css` |
| theme | `dark` | 186 | `app-CnsXMFE2.css`, `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css`, `app-initial~app-main~page-Ui27V2TN.css`, `app-initial~app-main~quick-chat-window-page~chatgpt-conversation-page-BmiNbp0u.css`, `profile-DOxOBCjz.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| theme | `electron-dark` | 97 | `../index.html#style[0]`, `app-CnsXMFE2.css`, `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css`, `app-initial~app-main~page-Ui27V2TN.css`, `app-initial~app-main~quick-chat-window-page~chatgpt-conversation-page-BmiNbp0u.css`, `avatar-overlay-pill-material-BNTptT42.css`, `profile-DOxOBCjz.css` |
| theme | `light` | 67 | `app-initial~app-main~page-Ui27V2TN.css` |
| theme | `electron-light` | 58 | `../index.html#style[0]`, `app-CnsXMFE2.css`, `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` |
| window-chrome | `application-menu` | 5 | `app-CnsXMFE2.css` |

- focus-visible 规则：174
- ARIA selector 规则：41
- sr-only 规则：2
- `data-reduced-motion=true` 规则：5
- `forced-color-adjust` 声明：1
- reduced-motion 查询：42
- reduced-transparency 查询：3
- forced-colors 查询：10
- high-contrast 查询：30

<details>
<summary>全部媒体查询</summary>

| 参数 | 次数 | 来源 |
| --- | ---: | --- |
| `(prefers-reduced-motion:reduce)` | 36 | `app-CnsXMFE2.css`, `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css`, `app-initial~app-main~onboarding-page-B4J4ni_U.css`, `app-initial~app-main~page-Ui27V2TN.css`, `app-initial~app-main~quick-chat-window-page~chatgpt-conversation-page-BmiNbp0u.css`, `codex-micro-bridge-CRTmZgHP.css`, `onboarding-page-3LCOx5Jc.css`, `profile-DOxOBCjz.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130`, `thread-user-message-navigation-rail-CX3TkeeC.css` |
| `(hover:hover)and (pointer:fine)` | 32 | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `(hover:hover)` | 20 | `app-CnsXMFE2.css` |
| `(-ms-high-contrast:active)` | 15 | `app-initial~app-main~quick-chat-window-page~chatgpt-conversation-page-BmiNbp0u.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `(-ms-high-contrast:black-on-white)` | 11 | `app-initial~app-main~quick-chat-window-page~chatgpt-conversation-page-BmiNbp0u.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `(forced-colors:active)` | 10 | `app-CnsXMFE2.css`, `global-dictation-orb-BOlLShjq.css`, `global-dictation-page-DGhXs35T.css` |
| `(pointer:fine)` | 10 | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-k1satKyX.js#static-css@3488690` |
| `(min-width:768px)` | 7 | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `(hover:hover) and (pointer:fine)` | 5 | `app-CnsXMFE2.css`, `app-initial~app-main~page~quick-chat-window-page~chatgpt-conversation-page-Bps-0OA4.css`, `app-initial~app-main~quick-chat-window-page~chatgpt-conversation-page-BmiNbp0u.css`, `avatar-overlay-pill-material-BNTptT42.css`, `thread-user-message-navigation-rail-CX3TkeeC.css` |
| `(min-width:576px)` | 5 | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `(prefers-reduced-motion:no-preference)` | 4 | `app-CnsXMFE2.css`, `app-initial~app-main~hotkey-window-thread-page~quick-chat-window-page~appearance-settings~i~f8u0tzsn-H4NGgmRi.css`, `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `(width>=48rem)` | 4 | `app-CnsXMFE2.css` |
| `(min-resolution:150dpi),(min-resolution:1.5x)` | 3 | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `(min-width:1024px)` | 3 | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `(prefers-color-scheme:dark)` | 3 | `app-CnsXMFE2.css` |
| `(prefers-reduced-transparency:reduce)` | 3 | `app-CnsXMFE2.css`, `global-dictation-orb-BOlLShjq.css`, `global-dictation-page-DGhXs35T.css` |
| `print` | 3 | `app-CnsXMFE2.css`, `app-initial~app-main~quick-chat-window-page~chatgpt-conversation-page-BmiNbp0u.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `(prefers-reduced-motion: reduce)` | 2 | `../index.html#style[0]`, `popcorn-electron-surface-style-DmQneSR_.js#static-css@21275` |
| `(width>=20rem)` | 2 | `app-CnsXMFE2.css` |
| `(width>=40rem)` | 2 | `app-CnsXMFE2.css` |
| `(width>=64rem)` | 2 | `app-CnsXMFE2.css` |
| `(width>=80rem)` | 2 | `app-CnsXMFE2.css` |
| `(width>=96rem)` | 2 | `app-CnsXMFE2.css` |
| `screen` | 2 | `app-initial~app-main~quick-chat-window-page~chatgpt-conversation-page-BmiNbp0u.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `screen and (-ms-high-contrast:active)` | 2 | `app-initial~app-main~quick-chat-window-page~chatgpt-conversation-page-BmiNbp0u.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `screen and (-ms-high-contrast:black-on-white)` | 2 | `app-initial~app-main~quick-chat-window-page~chatgpt-conversation-page-BmiNbp0u.css`, `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `(height<=500px)` | 1 | `app-CnsXMFE2.css` |
| `(height>=72rem)` | 1 | `app-CnsXMFE2.css` |
| `(min-width:1280px)` | 1 | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `(min-width:1536px)` | 1 | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `(min-width:380px)` | 1 | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |
| `(pointer:coarse)` | 1 | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-k1satKyX.js#static-css@3488690` |
| `(prefers-color-scheme: dark)` | 1 | `../index.html#style[0]` |
| `(width>=15rem)` | 1 | `app-CnsXMFE2.css` |
| `(width>=280px)` | 1 | `app-CnsXMFE2.css` |
| `(width>=480px)` | 1 | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-k1satKyX.js#static-css@6607433` |
| `(width>=540px)` | 1 | `app-CnsXMFE2.css` |
| `(width>=641px)` | 1 | `app-CnsXMFE2.css` |
| `(width>=760px)` | 1 | `app-CnsXMFE2.css` |
| `(width>=900px)` | 1 | `PopcornElectronPresentationPanel-pMDpowHW.css` |
| `not all and (width>=1024px)` | 1 | `app-CnsXMFE2.css` |
| `not all and (width>=220px)` | 1 | `app-CnsXMFE2.css` |
| `not all and (width>=260px)` | 1 | `app-CnsXMFE2.css` |
| `not all and (width>=280px)` | 1 | `app-CnsXMFE2.css` |
| `not all and (width>=30rem)` | 1 | `app-CnsXMFE2.css` |
| `not all and (width>=350px)` | 1 | `app-CnsXMFE2.css` |
| `not all and (width>=400px)` | 1 | `app-CnsXMFE2.css` |
| `not all and (width>=40rem)` | 1 | `app-CnsXMFE2.css` |
| `not all and (width>=420px)` | 1 | `app-CnsXMFE2.css` |
| `not all and (width>=440px)` | 1 | `app-CnsXMFE2.css` |
| `not all and (width>=48rem)` | 1 | `app-CnsXMFE2.css` |
| `not all and (width>=540px)` | 1 | `app-CnsXMFE2.css` |
| `not all and (width>=640px)` | 1 | `app-CnsXMFE2.css` |
| `not all and (width>=680px)` | 1 | `app-CnsXMFE2.css` |
| `not all and (width>=720px)` | 1 | `app-CnsXMFE2.css` |
| `not all and (width>=920px)` | 1 | `app-CnsXMFE2.css` |

</details>

<details>
<summary>全部容器查询</summary>

| 参数 | 次数 | 来源 |
| --- | ---: | --- |
| `(width>=44rem)` | 2 | `app-CnsXMFE2.css` |
| `composer-footer (width<=440px)` | 2 | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` |
| `composer-footer (width<=475px)` | 2 | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` |
| `(width<=20.749rem)` | 1 | `app-CnsXMFE2.css` |
| `(width<=240px)` | 1 | `app-CnsXMFE2.css` |
| `(width<=260px)` | 1 | `app-CnsXMFE2.css` |
| `(width<=300px)` | 1 | `app-CnsXMFE2.css` |
| `(width<=31.499rem)` | 1 | `app-CnsXMFE2.css` |
| `(width<=360px)` | 1 | `app-CnsXMFE2.css` |
| `(width<=399px)` | 1 | `app-CnsXMFE2.css` |
| `(width<=42.249rem)` | 1 | `app-CnsXMFE2.css` |
| `(width<=420px)` | 1 | `app-CnsXMFE2.css` |
| `(width<=440px)` | 1 | `app-CnsXMFE2.css` |
| `(width<=520px)` | 1 | `app-CnsXMFE2.css` |
| `(width<=620px)` | 1 | `app-CnsXMFE2.css` |
| `(width<=680px)` | 1 | `app-CnsXMFE2.css` |
| `(width>=180px)` | 1 | `app-CnsXMFE2.css` |
| `(width>=24rem)` | 1 | `app-CnsXMFE2.css` |
| `(width>=400px)` | 1 | `app-CnsXMFE2.css` |
| `(width>=500px)` | 1 | `app-CnsXMFE2.css` |
| `(width>=581px)` | 1 | `plugins-page-DoKhPslE.css` |
| `(width>=64rem)` | 1 | `app-CnsXMFE2.css` |
| `(width>=76rem)` | 1 | `app-CnsXMFE2.css` |
| `(width>=84rem)` | 1 | `app-CnsXMFE2.css` |
| `app-shell-detail-panel (width<=899px)` | 1 | `app-CnsXMFE2.css` |
| `app-shell-detail-panel (width>=900px)` | 1 | `app-CnsXMFE2.css` |
| `app-shell-main-content (width>=96rem)` | 1 | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` |
| `composer-footer (width<=300px)` | 1 | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` |
| `composer-footer (width<=420px)` | 1 | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` |
| `composer-footer (width<=480px)` | 1 | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` |
| `diff-header (width>=20rem)` | 1 | `app-CnsXMFE2.css` |
| `measure (height > 1lh)` | 1 | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-k1satKyX.js#static-css@3030234` |
| `presentation-editor (width<=688px)` | 1 | `PopcornElectronPresentationPanel-pMDpowHW.css` |
| `presentation-editor (width<=748px)` | 1 | `PopcornElectronPresentationPanel-pMDpowHW.css` |
| `presentation-editor (width>=749px)` | 1 | `PopcornElectronPresentationPanel-pMDpowHW.css` |
| `referral-tracking (width<=400px)` | 1 | `app-CnsXMFE2.css` |
| `referral-tracking (width>=401px)` | 1 | `app-CnsXMFE2.css` |
| `request-card not (width>=28rem)` | 1 | `app-CnsXMFE2.css` |
| `review-header (width<=624px)` | 1 | `app-CnsXMFE2.css` |
| `review-header (width>=625px)` | 1 | `app-CnsXMFE2.css` |
| `thread-content (width>=50rem)` | 1 | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` |

</details>

<details>
<summary>全部 supports 查询</summary>

| 参数 | 次数 | 来源 |
| --- | ---: | --- |
| `(color:color-mix(in lab, red, red))` | 427 | `app-CnsXMFE2.css` |
| `(background-image:linear-gradient(in lab, red, red))` | 5 | `app-CnsXMFE2.css` |
| `(-moz-appearance: none)` | 2 | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-k1satKyX.js#static-css@3030234` |
| `(corner-shape:superellipse(1.5))` | 2 | `app-CnsXMFE2.css`, `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-VuheBpk5.css` |
| `(not ((-webkit-appearance:-apple-pay-button))) or (contain-intrinsic-size:1px)` | 2 | `app-CnsXMFE2.css` |
| `(width:1cqi)` | 2 | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-k1satKyX.js#static-css@3488690` |
| `(-webkit-touch-callout:none)` | 1 | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-k1satKyX.js#static-css@3488690` |
| `((-moz-appearance:none))` | 1 | `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-k1satKyX.js#static-css@3488690` |
| `(((-webkit-hyphens:none)) and (not (margin-trim:inline))) or ((-moz-orient:inline) and (not (color:rgb(from red r g b))))` | 1 | `app-CnsXMFE2.css` |
| `(animation-timeline:--scroll-fade)` | 1 | `app-CnsXMFE2.css` |
| `(mask-composite:exclude)` | 1 | `codex-micro-bridge-CRTmZgHP.css` |
| `(not (-webkit-appearance:-apple-pay-button)) or (contain-intrinsic-size:1px)` | 1 | `register-CZ-paYlL-CTxUtz7U.js#static-css@4628130` |

</details>

## JS/MJS 运行时样式

### 可静态恢复的 CSS payload

| 脚本 | binding | chars | 恢复度 | sink |
| --- | --- | ---: | --- | --- |
| `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-k1satKyX.js` | `qln` | 49647 | exact | replaceSync, textContent / wrapper: Yln |
| `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-k1satKyX.js` | `VOn` | 40137 | exact | replaceSync |
| `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-k1satKyX.js` | `e1n` | 404 | exact | textContent |
| `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-k1satKyX.js` | `qOi` | 6023 | exact | textContent-property |
| `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-k1satKyX.js` | `direct-literal` | 116 | exact | textContent-property |
| `app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-k1satKyX.js` | `direct-literal` | 56 | partial-template | replaceSync |
| `app-initial~app-main~projects-index-page~remote-conversation-page-y7pwA1Hj.js` | `direct-literal` | 1741 | exact | innerHTML |
| `docx-preview-panel-Dk7clHXt.js` | `qt` | 1408 | partial-template | textContent |
| `popcorn-electron-surface-style-DmQneSR_.js` | `mn` | 665 | exact | textContent |
| `register-CZ-paYlL-CTxUtz7U.js` | `Z9` | 379011 | exact | replaceSync, textContent |

其中 `exact` 可直接双解析；`partial-template` 会保留 unresolved interpolation 占位符，不能声称等同最终运行时 CSS。Shadow DOM、`insertRule`、Mermaid/Cytoscape、PDF 动态字体和 Motion 注入证据位于 JSON 的 `runtimeStyles`。

className 消费点 14581 次，inline style 消费点 2785 次；它们只用于定位组件消费关系，不重复成为 CSS 声明。

### 脚本分类

| 分类 | 文件数 |
| --- | ---: |
| code-highlight-theme | 151 |
| grammar-noise | 226 |
| icon-noise | 1529 |
| locale | 85 |
| runtime-theme | 6 |
| shadow-dom-style | 2 |
| style-usage | 276 |
| third-party-style | 7 |
| unrelated | 2300 |

## Shiki / VS Code 高亮主题

| 主题 slug | 类型 | 物理副本 | colors | tokenColors/settings | 恢复方式 |
| --- | --- | ---: | ---: | ---: | --- |
| `absolutely-dark` | unknown | 1 | 11 | 6 | signature |
| `absolutely-light` | unknown | 1 | 11 | 6 | signature |
| `andromeeda` | dark | 2 | 144 | 13 | structured |
| `aurora-x` | dark | 2 | 105 | 60 | structured |
| `ayu-dark` | dark | 2 | 228 | 63 | structured |
| `ayu-light` | light | 1 | 335 | 66 | structured |
| `ayu-mirage` | dark | 1 | 335 | 66 | structured |
| `catppuccin-frappe` | dark | 2 | 564 | 179 | structured |
| `catppuccin-latte` | light | 2 | 564 | 179 | structured |
| `catppuccin-macchiato` | dark | 2 | 564 | 179 | structured |
| `catppuccin-mocha` | dark | 2 | 564 | 179 | structured |
| `codex-dark` | dark | 1 | 24 | 245 | structured |
| `codex-light` | light | 1 | 24 | 245 | structured |
| `dark-plus` | dark | 2 | 28 | 65 | structured |
| `dracula` | dark | 2 | 195 | 85 | structured |
| `dracula-soft` | dark | 2 | 195 | 85 | structured |
| `everforest-dark` | dark | 2 | 449 | 276 | structured |
| `everforest-light` | light | 2 | 449 | 276 | structured |
| `github-dark` | dark | 2 | 183 | 45 | structured |
| `github-dark-default` | dark | 2 | 241 | 49 | structured |
| `github-dark-dimmed` | dark | 2 | 241 | 49 | structured |
| `github-dark-high-contrast` | dark | 2 | 245 | 49 | structured |
| `github-light` | light | 2 | 179 | 45 | structured |
| `github-light-default` | light | 2 | 237 | 49 | structured |
| `github-light-high-contrast` | light | 2 | 240 | 49 | structured |
| `gruvbox-dark-hard` | dark | 2 | 258 | 127 | structured |
| `gruvbox-dark-medium` | dark | 2 | 258 | 127 | structured |
| `gruvbox-dark-soft` | dark | 2 | 258 | 127 | structured |
| `gruvbox-light-hard` | light | 2 | 258 | 127 | structured |
| `gruvbox-light-medium` | light | 2 | 258 | 127 | structured |
| `gruvbox-light-soft` | light | 2 | 258 | 127 | structured |
| `horizon` | dark | 1 | 134 | 39 | structured |
| `horizon-bright` | dark | 1 | 136 | 39 | structured |
| `houston` | dark | 2 | 253 | 244 | structured |
| `kanagawa-dragon` | dark | 2 | 154 | 76 | structured |
| `kanagawa-lotus` | light | 2 | 154 | 76 | structured |
| `kanagawa-wave` | dark | 2 | 154 | 76 | structured |
| `laserwave` | dark | 2 | 72 | 21 | structured |
| `light-plus` | light | 2 | 33 | 64 | structured |
| `linear-dark` | unknown | 1 | 11 | 8 | signature |
| `linear-light` | unknown | 1 | 11 | 8 | signature |
| `lobster-dark` | unknown | 1 | 11 | 11 | signature |
| `material-theme` | dark | 2 | 214 | 82 | structured |
| `material-theme-darker` | dark | 2 | 214 | 82 | structured |
| `material-theme-lighter` | light | 2 | 214 | 82 | structured |
| `material-theme-ocean` | dark | 2 | 214 | 82 | structured |
| `material-theme-palenight` | dark | 2 | 214 | 82 | structured |
| `matrix-dark` | unknown | 1 | 11 | 8 | signature |
| `min-dark` | dark | 2 | 84 | 23 | structured |
| `min-light` | light | 2 | 107 | 22 | structured |
| `monokai` | dark | 2 | 93 | 52 | structured |
| `night-owl` | dark | 2 | 206 | 196 | structured |
| `night-owl-light` | light | 1 | 159 | 186 | structured |
| `nord` | dark | 2 | 303 | 140 | structured |
| `notion-dark` | unknown | 1 | 11 | 8 | signature |
| `notion-light` | unknown | 1 | 11 | 8 | signature |
| `one-dark-pro` | dark | 2 | 143 | 275 | structured |
| `one-light` | light | 2 | 74 | 211 | structured |
| `oscurange` | dark | 1 | 3 | 21 | structured |
| `pierre-dark` | dark | 1 | 117 | 248 | structured |
| `pierre-dark-soft` | dark | 1 | 117 | 248 | structured |
| `pierre-dark-vibrant` | dark | 1 | 117 | 248 | structured |
| `pierre-light` | light | 1 | 117 | 248 | structured |
| `pierre-light-soft` | light | 1 | 117 | 248 | structured |
| `pierre-light-vibrant` | light | 1 | 117 | 248 | structured |
| `plastic` | dark | 2 | 192 | 12 | structured |
| `poimandres` | dark | 2 | 442 | 101 | structured |
| `proof-light` | unknown | 1 | 11 | 8 | signature |
| `raycast-dark` | dark | 1 | 124 | 21 | structured |
| `raycast-light` | light | 1 | 124 | 22 | structured |
| `red` | dark | 2 | 55 | 41 | structured |
| `rose-pine` | dark | 2 | 464 | 33 | structured |
| `rose-pine-dawn` | light | 2 | 464 | 33 | structured |
| `rose-pine-moon` | dark | 2 | 464 | 33 | structured |
| `sentry-dark` | unknown | 1 | 11 | 8 | signature |
| `slack-dark` | dark | 2 | 49 | 66 | structured |
| `slack-ochin` | light | 2 | 139 | 44 | structured |
| `snazzy-light` | light | 2 | 107 | 165 | structured |
| `solarized-dark` | dark | 2 | 92 | 41 | structured |
| `solarized-light` | light | 2 | 84 | 41 | structured |
| `synthwave-84` | dark | 2 | 138 | 88 | structured |
| `temple-dark` | unknown | 1 | 11 | 7 | signature |
| `tokyo-night` | dark | 2 | 353 | 114 | structured |
| `vercel-dark` | unknown | 1 | 11 | 8 | signature |
| `vercel-light` | unknown | 1 | 11 | 8 | signature |
| `vesper` | dark | 2 | 70 | 59 | structured |
| `vitesse-black` | dark | 2 | 186 | 56 | structured |
| `vitesse-dark` | dark | 2 | 186 | 56 | structured |
| `vitesse-light` | light | 2 | 184 | 56 | structured |
| `xcode-dark` | dark | 1 | 18 | 8 | structured |
| `xcode-light` | light | 1 | 18 | 8 | structured |

逻辑主题按稳定 slug 合并，结构化可恢复内容另以规范化哈希校验；每个物理模块仍保留来源文件。

## CodePilotX 逐域映射

| Codex 样式域 | 状态 | CodePilotX 落点 | 策略 |
| --- | --- | --- | --- |
| properties/theme 与设计令牌 | map | `src/styles/design-system/tokens.scss` | 映射到 CodePilotX 的 theme/tokens 层；保留颜色、surface、字体、间距、圆角、阴影、层级与动效语义，--tw-* 仅登记。 |
| base/reset | adapt | `src/styles/base.scss` | 把 Codex base 层的元素默认值适配到现有 reset/base，不复制构建后的全局选择器。 |
| runtime theme | map | `src/features/theme/ThemeVariables.ts` | 对照 Electron 明暗类和根节点 setProperty 证据，动态值不固化为 SCSS 默认值。 |
| UI primitives | adapt | `src/styles/components` | 复用既有 button、input、chip、switch、menu、scroll-area；不迁移 CSS Modules 哈希类名。 |
| shell/layout | adapt | `src/styles/shell.scss and src/styles/features/layout-*` | 窗口、侧栏、工作台、面板映射现有 shell/layout 层，并保留 Windows/Electron 边界。 |
| session/composer/settings/search/review | adapt | `src/styles/features` | 按现有 feature partial 分域适配，不把 CSS Modules 哈希类作为公共接口。 |
| vendor styles | vendor | `src/styles/vendor.scss` | KaTeX、ProseMirror、xterm、Recharts、Mapbox、PDF.js 等外部 DOM 规则留在 vendor 边界。 |
| platform/vendor overrides | adapt | `src/styles/index.scss overrides layer` | 只有平台差异和无法在 vendor 源层处理的第三方修正进入 overrides，保持现有九层级联顺序。 |

CodePilotX 继续使用 `theme → vendor → reset → tokens → primitives → shell → features → utilities → overrides` 九层结构。CSS Modules 哈希类只作为构建证据，不直接复制为公共接口。

## 限制与解析告警

- 构建产物没有 source map，不能还原原始组件文件和源码行号。
- 压缩变量可能复用；JS 静态 CSS 只接受与明确 style sink 联通的最近字面量。
- 动态表达式、运行时主题输入和第三方生成器只记录可证明的边界，不伪造最终 CSS。

- 无解析告警；外部 CSS、HTML 内联和 exact JS CSS 均通过对应解析。
