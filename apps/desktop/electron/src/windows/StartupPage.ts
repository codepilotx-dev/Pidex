import {
  deriveDesktopSurfaceUnder,
  type DesktopChromeTheme,
  type DesktopThemeSettingsV7,
} from '@pidex/shared/desktop-theme'
import type { DesktopStartupThemeSeed } from '@pidex/shared/desktop-appearance-ipc'

export type StartupStatusKind = 'progress' | 'terminal-error'

export interface StartupPageOptions {
  logoDataUrl: string
  variant: 'light' | 'dark'
  theme: Pick<DesktopChromeTheme, 'surface' | 'ink' | 'accent'> & {
    surfaceUnder: string
  }
}

export function deriveSurfaceUnder(
  surface: string,
  ink: string,
  dark: boolean,
  contrast = dark ? 60 : 40,
): string {
  return deriveDesktopSurfaceUnder(surface, ink, dark ? 'dark' : 'light', contrast)
}

export const RENDERER_STARTUP_THEME_QUERY_PARAM = 'cpx-startup-theme'

export function createRendererApplicationUrl(
  applicationOrigin: string,
  startupTheme: Omit<StartupPageOptions, 'logoDataUrl'>,
): string {
  const target = new URL(applicationOrigin)
  const seed: DesktopStartupThemeSeed = {
    version: 1,
    variant: startupTheme.variant,
    surface: startupTheme.theme.surface,
    ink: startupTheme.theme.ink,
  }
  target.searchParams.set(RENDERER_STARTUP_THEME_QUERY_PARAM, JSON.stringify(seed))
  return target.href
}

export function resolveStartupPageTheme(
  settings: DesktopThemeSettingsV7,
  systemVariant: 'light' | 'dark',
): Omit<StartupPageOptions, 'logoDataUrl'> {
  const variant = settings.mode === 'system' ? systemVariant : settings.mode
  const { surface, ink, accent, contrast } = settings.chromeThemes[variant]
  const dark = variant === 'dark'
  const surfaceUnder = deriveSurfaceUnder(surface, ink, dark, contrast)
  return {
    variant,
    theme: { surface, ink, accent, surfaceUnder },
  }
}

export function renderStartupPage({ logoDataUrl, variant, theme }: StartupPageOptions): string {
  const background = theme.surface
  const foreground = theme.ink
  const muted = `color-mix(in srgb, ${foreground} 62%, transparent)`
  const border = `color-mix(in srgb, ${foreground} 14%, transparent)`
  const hover = `color-mix(in srgb, ${foreground} 6%, transparent)`
  const baseFilter =
    variant === 'dark' ? 'grayscale(1) brightness(0) invert(1)' : 'grayscale(1) brightness(0)'
  const baseOpacity = '0.24'
  const shimmerPeak = `color-mix(in srgb, ${foreground} 92%, transparent)`
  const safeLogoDataUrl = escapeHtmlAttribute(logoDataUrl)
  const safeLogoCssUrl = escapeCssUrl(logoDataUrl)

  return `<!doctype html>
<html lang="zh-CN" data-theme="${variant}">
  <head>
    <meta charset="utf-8">
    <meta name="color-scheme" content="${variant}">
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
    >
    <title>Pidex Desktop</title>
    <style>
      :root {
        --startup-background: ${background};
        --startup-foreground: ${foreground};
        --startup-muted: ${muted};
        --startup-border: ${border};
        --startup-hover: ${hover};
        --startup-accent: ${theme.accent};
        --startup-logo-mask: url("${safeLogoCssUrl}");
        --startup-logo-base-opacity: ${baseOpacity};
        --startup-logo-base-filter: ${baseFilter};
        --shimmer-soft: rgb(255 255 255 / 0.04);
        --shimmer-peak: ${shimmerPeak};
        --shimmer-tail: rgb(255 255 255 / 0.08);
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: var(--startup-background);
        color: var(--startup-foreground);
        font: 14px/1.5 "Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", "Microsoft YaHei", sans-serif;
      }

      button {
        font: inherit;
      }

      .startup-loader {
        position: relative;
        display: flex;
        width: 100%;
        height: 100%;
        align-items: center;
        justify-content: center;
        padding: 48px;
        background: var(--startup-background);
        -webkit-app-region: drag;
      }

      .startup-content {
        display: grid;
        justify-items: center;
        gap: 24px;
        width: min(420px, 100%);
      }

      .startup-logo {
        position: relative;
        width: 56px;
        height: 56px;
        opacity: 0;
        animation: startup-logo-fade-in 180ms ease-out 60ms forwards;
      }

      .startup-logo__base,
      .startup-logo__overlay {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
      }

      .startup-logo__base {
        display: block;
        object-fit: contain;
        opacity: var(--startup-logo-base-opacity);
        filter: var(--startup-logo-base-filter);
      }

      .startup-logo__overlay {
        background-image: linear-gradient(
          112deg,
          transparent 22%,
          var(--shimmer-soft) 38%,
          var(--shimmer-peak) 49%,
          var(--shimmer-tail) 56%,
          transparent 74%
        );
        background-position: 140% 0;
        background-repeat: no-repeat;
        background-size: 220% 100%;
        animation: startup-logo-shimmer 2200ms
          cubic-bezier(0.4, 0, 0.2, 1) infinite;
        -webkit-mask-image: var(--startup-logo-mask);
        mask-image: var(--startup-logo-mask);
        -webkit-mask-position: center;
        mask-position: center;
        -webkit-mask-repeat: no-repeat;
        mask-repeat: no-repeat;
        -webkit-mask-size: contain;
        mask-size: contain;
      }

      .startup-diagnostics {
        display: grid;
        justify-items: center;
        gap: 6px;
        width: 100%;
        opacity: 0;
        visibility: hidden;
        transform: translateY(4px);
        transition:
          opacity 160ms ease-out,
          transform 160ms ease-out,
          visibility 0s linear 160ms;
        -webkit-app-region: no-drag;
      }

      body[data-diagnostics-visible="true"] .startup-diagnostics {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
        transition-delay: 0s;
      }

      .startup-status-window {
        width: min(420px, 100%);
        height: 21px;
        overflow: hidden;
        text-align: center;
      }

      .startup-status {
        display: block;
        max-width: 100%;
        margin: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        color: var(--startup-muted);
        font-size: 13px;
      }

      .startup-detail {
        max-width: 100%;
        margin: 0;
        overflow-wrap: anywhere;
        text-align: center;
        min-height: 21px;
        color: var(--startup-muted);
        font-size: 13px;
      }

      .startup-actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
      }

      .startup-actions button {
        min-height: 32px;
        padding: 5px 11px;
        border: 1px solid var(--startup-border);
        border-radius: 8px;
        outline: none;
        background: transparent;
        color: var(--startup-foreground);
        cursor: pointer;
      }

      .startup-actions button:hover {
        background: var(--startup-hover);
      }

      .startup-actions button:focus-visible {
        outline: 2px solid var(--startup-accent);
        outline-offset: 2px;
      }

      .startup-actions .primary {
        border-color: var(--startup-foreground);
        background: var(--startup-foreground);
        color: var(--startup-background);
      }

      @media (prefers-reduced-motion: reduce) {
        .startup-logo {
          animation: none;
          opacity: 1;
        }

        .startup-logo__overlay {
          animation: none;
        }

        .startup-diagnostics {
          transform: none;
          transition: none;
        }
      }

      @keyframes startup-logo-fade-in {
        from {
          opacity: 0;
        }

        to {
          opacity: 1;
        }
      }

      @keyframes startup-logo-shimmer {
        from {
          background-position: 140% 0;
        }

        to {
          background-position: -105% 0;
        }
      }
    </style>
  </head>
  <body>
    <main class="startup-loader" aria-label="Pidex 正在启动" aria-busy="true">
      <div class="startup-content">
        <div class="startup-logo" aria-hidden="true">
          <img class="startup-logo__base" src="${safeLogoDataUrl}" alt="">
          <div class="startup-logo__overlay"></div>
        </div>
        <div class="startup-status-window" aria-live="polite">
          <p id="status" class="startup-status">正在启动…</p>
        </div>
        <section class="startup-diagnostics" aria-live="polite">
          <p id="detail" class="startup-detail"></p>
          <div class="startup-actions">
            <button id="logs" type="button">打开日志目录</button>
            <button id="retry-data-location" type="button" hidden>重试迁移</button>
            <button id="restore-data-location" type="button" hidden>恢复原位置</button>
            <button id="quit" class="primary" type="button">退出</button>
          </div>
        </section>
      </div>
    </main>
    <script>
      (() => {
        const statusElement = document.getElementById("status");
        const detailElement = document.getElementById("detail");
        const loaderElement = document.querySelector(".startup-loader");
        const retryDataLocation = document.getElementById("retry-data-location");
        const restoreDataLocation = document.getElementById("restore-data-location");
        const revealDiagnostics = () => {
          document.body.dataset.diagnosticsVisible = "true";
        };
        const diagnosticTimer = window.setTimeout(revealDiagnostics, 8000);

        // 单行状态窗纵向换字：旧文案上滑 180ms、新文案从下方 280ms 滑入；
        // 快速连续更新只落定最新状态，reduced-motion 下直接替换。
        let swapPending = null;
        let swapExit = null;
        const swapStartupStatus = (element, text) => {
          if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            if (swapExit) {
              swapExit.cancel();
              swapExit = null;
            }
            swapPending = null;
            element.textContent = text;
            return;
          }
          if (swapExit) {
            swapPending = text;
            return;
          }
          if (element.textContent === text) return;
          swapPending = text;
          const animation = element.animate(
            [
              { opacity: 1, transform: "translateY(0)" },
              { opacity: 0, transform: "translateY(-4px)" },
            ],
            {
              duration: 180,
              easing: "cubic-bezier(0.23, 1, 0.32, 1)",
              fill: "forwards",
            },
          );
          swapExit = animation;
          animation.onfinish = () => {
            swapExit = null;
            const settled = swapPending;
            if (settled === null) return;
            swapPending = null;
            element.textContent = settled;
            element.animate(
              [
                { opacity: 0, transform: "translateY(4px)" },
                { opacity: 1, transform: "translateY(0)" },
              ],
              {
                duration: 280,
                easing: "cubic-bezier(0.23, 1, 0.32, 1)",
              },
            );
          };
        };

        window.updateStartupStatus = (
          status,
          detail,
          kind = "progress",
        ) => {
          swapStartupStatus(statusElement, status || "正在启动…");
          detailElement.textContent = detail || "";
          const relocationFailed = status === "用户数据迁移失败";
          retryDataLocation.hidden = !relocationFailed;
          restoreDataLocation.hidden = !relocationFailed;
          if (kind === "terminal-error") {
            window.clearTimeout(diagnosticTimer);
            loaderElement?.setAttribute("aria-busy", "false");
            revealDiagnostics();
          }
        };

        document.getElementById("logs").addEventListener("click", () => {
          window.DesktopBridge?.openLogDirectory().catch((error) => {
            window.updateStartupStatus(
              "无法打开日志目录",
              String(error),
              "terminal-error",
            );
          });
        });
        document.getElementById("quit").addEventListener("click", () => {
          window.DesktopBridge?.quitDuringStartup();
        });
        retryDataLocation.addEventListener("click", () => {
          window.DesktopBridge?.retryDataLocation();
        });
        restoreDataLocation.addEventListener("click", () => {
          window.DesktopBridge?.restoreDataLocation();
        });
      })();
    </script>
  </body>
</html>`
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function escapeCssUrl(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '')
    .replaceAll('\r', '')
}
