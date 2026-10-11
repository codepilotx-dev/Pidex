/**
 * 辅助子窗口样式与主题深克隆引擎
 * 负责将主窗口的样式表 (<style>, <link rel="stylesheet">)、CSS 变量及主题 class 深克隆至子窗口文档，
 * 并通过 MutationObserver 实时保持主子窗口主题与动态样式同步。
 */

export function syncStylesheets(targetDoc: Document): () => void {
  if (
    typeof document === 'undefined' ||
    typeof window === 'undefined' ||
    !document.documentElement ||
    !targetDoc?.documentElement
  ) {
    return () => {}
  }
  const sourceDoc = document
  const head = targetDoc.head || targetDoc.getElementsByTagName('head')[0]
  if (!head) return () => {}
  const targetHtml = targetDoc.documentElement
  const sourceHtml = sourceDoc.documentElement

  // 1. 设置 Base URL 保证字体与相对资源路径解析正确
  if (!head.querySelector('base')) {
    const base = targetDoc.createElement('base')
    base.href = window.location.href
    head.prepend(base)
  }

  // 2. 同步 <html> 标签上的主题 class、行内 style 与 data-* 属性
  const syncHtmlAttributes = () => {
    targetHtml.className = sourceHtml.className
    const styleAttr = sourceHtml.getAttribute('style')
    if (styleAttr) {
      targetHtml.setAttribute('style', styleAttr)
    } else {
      targetHtml.removeAttribute('style')
    }
    for (const attr of Array.from(sourceHtml.attributes)) {
      if (attr.name.startsWith('data-')) {
        targetHtml.setAttribute(attr.name, attr.value)
      }
    }
  }
  syncHtmlAttributes()

  // 3. 克隆已有的样式标签
  const cloneStyleElement = (element: Element): Element => {
    return element.cloneNode(true) as Element
  }

  const existingStyles = Array.from(sourceDoc.querySelectorAll('link[rel="stylesheet"], style'))
  for (const style of existingStyles) {
    head.appendChild(cloneStyleElement(style))
  }

  // 4. 监听主窗口 head 变动（如 Vite 动态注入、HMR、动态模块样式）并实时复制到子窗口
  const headObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const added of Array.from(mutation.addedNodes)) {
        if (
          added instanceof HTMLElement &&
          (added.tagName === 'STYLE' ||
            (added.tagName === 'LINK' && (added as HTMLLinkElement).rel === 'stylesheet'))
        ) {
          head.appendChild(cloneStyleElement(added))
        }
      }
    }
  })
  if (sourceDoc.head) {
    headObserver.observe(sourceDoc.head, { childList: true, subtree: true })
  }

  // 5. 监听 <html> 属性变动（如深色/浅色模式切换、主题色变更）
  const htmlObserver = new MutationObserver(() => {
    syncHtmlAttributes()
  })
  htmlObserver.observe(sourceHtml, { attributes: true })

  // 6. 返回清理钩子
  return () => {
    headObserver.disconnect()
    htmlObserver.disconnect()
  }
}
