# Renderer Static Fonts (MiSans & JetBrains Mono)

本目录为 Pidex 桌面 Renderer 的本地自有静态字体资源，不依赖外部 CDN 或用户系统环境。

## 1. MiSans (Display & UI Text)

- **来源**: npm 包 `misans` (版本 `^4.1.0`)
- **包含字重**: Regular (400 / weight 330), Medium (500), Demibold (600), Bold (700)
- **字体许可**: `FONT-LICENSE` (小米 MiSans 知识产权及字体使用许可协议，免费商用)
- **npm 包包装许可**: MIT License (查看 `package.json`)
- **说明**: 保持原始 CSS 与 unicode-range 切片 `.woff2` 资源不变，保留浏览器字形匹配规则。

## 2. JetBrains Mono (Code)

- **来源**: npm 包 `@fontsource/jetbrains-mono` (版本 `^5.3.0`)
- **包含字重**: 400 (Normal), 500 (Medium), 600 (SemiBold)
- **字体许可**: `FONT-LICENSE` (SIL Open Font License 1.1)
- **npm 包包装许可**: MIT License (查看 `package.json`)
- **说明**: 保持原始 CSS 与 `.woff2`/`.woff` 资源不变。
