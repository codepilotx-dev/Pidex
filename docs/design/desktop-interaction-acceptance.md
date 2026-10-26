# 桌面同行图标与点击热区验收

本次覆盖 Pidex 桌面自身 UI，官网和 Browser／Computer Use 中的外部内容不在范围内。目标为 WCAG 2.2 **SC 2.5.8 单项准则**和同行图标随字体缩放，不代表整个产品通过 WCAG AA 认证。

## 影响面

| 区域 | 已调整 | 人工点验 |
| --- | --- | --- |
| 设置及侧栏 | 导航、返回、状态图标按中文界面 `1em`／English 界面 `1cap`；保留图标列占位 | 11／14／16px 下图标随文字变化，长标题不遮挡；选中、悬停、焦点无错位 |
| 菜单与选择器 | 前置图标、箭头、选中状态与加载图标；菜单项最小热区 | 打开主菜单、上下文菜单、模型与推理菜单、日期选择器，检查子菜单定位及边缘点击 |
| 会话与 Composer | 图文操作、模式、命令、状态、工具活动、计划、总结、附件图标 | 检查加载替换、长模型名、附件关闭与打开互不误触；纯图标发送／停止保持原图标档位 |
| 回合导航与 Review | 导航项和行内操作至少 24px；同步虚拟列表尺寸 | 多回合上下移动、书签、长 diff 滚动、行内评论定位和相邻行无重叠 |
| 文件与工作台 | 文件树、标签页、面包屑的同行图标；关闭与文件名留出独立区域 | 窄面板、长文件名、多标签、拖拽后关闭，确认没有覆盖另一个目标 |
| 控件与布局 | 帮助／Popover、Checkbox、Radio、Switch 的热区；拖柄和自定义滚动条扩大 | 空白边缘可点，切换、拖动及滚动正常；24px 拖动带已预留空间，不抢邻近按钮 |
| 功能页面 | Projects、Git／Review、Scheduled tasks、Plugins／MCP、模型／Provider、Pets 等复用共享规则，并调整局部同行图标 | 在实际有数据、错误、加载、禁用状态下检查，空页面检查不能替代这些状态 |

布局会有意发生两类变化：回合导航／Review 操作行更高，侧栏与面板边缘为拖柄预留 24px。滚动条也比原来的 10px 更宽。

## 无需调整与边界

| 对象 | 判定 |
| --- | --- |
| 原有 24px 以上的普通按钮、导航行、菜单行 | 热区无需继续放大；同行图标仍按新规则处理 |
| 纯图标按钮、独立空状态图标 | 保留固定图标档位，热区与视觉尺寸分别判断 |
| 品牌、头像、Logo、宠物、图片、图表 | 不属于同行功能图标；其外层若可操作，仍检查热区 |
| Markdown 正文中的内联链接 | 适用 Inline 例外，不把每个文字链接强制变成 24px 高按钮 |
| CodeMirror／终端的可编辑内容、颜色渐变选择区域 | 按空间位置选择值的整体交互区视为一个目标，不按字符、颜色点或光标判断；编辑器搜索和工具栏按钮仍受尺寸规则约束 |
| Windows 原生窗口按钮 | 系统拥有的原生控件；不修改，标题栏仍为 36px |

本次不以“支持键盘”作为小目标豁免，也不把所有第三方组件自动归入 Essential 例外。外部网页、用户生成的 Artifact 和远程桌面内容需要由各自作者负责；Pidex 拥有的外围控制仍在本次范围内。

## 对照与自动检查

在仓库根目录运行：

```powershell
bun run --cwd apps/desktop/renderer typecheck
bun run --cwd apps/desktop/renderer css:check
bun run build:renderer
```

在 `apps/desktop/renderer` 运行：

```powershell
bun build ./test/IconSize.browser.ts ./test/InteractionGeometry.browser.ts --target=node --external=@playwright/test --external=@axe-core/playwright --external=vite --external=@tailwindcss/vite --outdir=./node_modules/.cache --entry-naming=[name].mjs
node node_modules/.cache/IconSize.browser.mjs
node node_modules/.cache/InteractionGeometry.browser.mjs
bun run scripts/RunPlaywright.ts playwright.a11y.config.ts TargetSize.a11y.ts
```

几何检查使用真实共享组件，验证 11／14／16px、MiSans（加载本地字体）／Arial、浅／深色，以及独立图标、加载态、嵌套操作分离和 axe `target-size` 实际执行。页面检查覆盖主要路由与打开的菜单状态；不取代实际数据、hover 后出现的操作及第三方生成 DOM 的人工判断。

`InteractionGeometry.browser.ts` 生成 `apps/desktop/renderer/test-results/interaction-comparison.html`。用浏览器打开后，可切换字号、字体和主题：A 模拟原固定图标及小关闭热区，B 为当前真实组件的渲染输出。此文件只比较样式，无业务操作；Playwright 会清理输出目录，需要时在页面测试后重新生成。

## 用户点验

1. 在开发版切换 UI 字号 11、14、16px：先看设置导航，再看图文按钮、菜单、模型选择和文件行；中文界面同行图标统一为 `1em`，English 界面统一为 `1cap`，均跟随文字；独立图标按钮保持原档位。
2. 切浅／深色，在常规和紧凑窗口下检查长文件名、附件、多标签、行内操作；点击图标周围的热区，确认不会触发邻近目标。
3. 检查 Tab 焦点、弹层定位、拖柄、滚动条、长 diff 与多回合导航；不使用还原／删除等破坏性操作测试热区。
4. 检查有数据、加载、错误、禁用及 hover 状态。发现小目标时记录其所在页面、实际点击范围和邻近目标，避免仅凭截图中的图标大小判断合规。

自动化浏览器由各检查的 `finally` 或 Playwright 生命周期关闭；额外启动的开发服务器须单独关闭。

本轮验证：Renderer typecheck／build、CSS 检查、55 项语言及样式测试、图标浏览器检查、11／14／16px × MiSans／Arial × 浅深色 × 中文／English 的 24 组几何矩阵，以及 5 项按钮视觉回归通过。对照可切换界面语言，包含 guardian-lab／工作组／master；同一语言下单位统一，并验证标签／占位文本变化不改变尺寸。此前 17 个目标尺寸路由／弹层场景已通过，本轮未重复全套路由检查；保留共享控件热区、纯图标尺寸和 target-size 几何检查。
