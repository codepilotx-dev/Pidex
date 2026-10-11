;(() => {
  try {
    const raw = new URL(window.location.href).searchParams.get('cpx-startup-theme')
    if (!raw) return
    const seed = JSON.parse(raw)
    const validColor = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    if (
      seed?.version !== 1 ||
      (seed.variant !== 'light' && seed.variant !== 'dark') ||
      !validColor(seed.surface) ||
      !validColor(seed.ink)
    )
      return

    const root = document.documentElement
    root.dataset.theme = seed.variant
    root.style.colorScheme = seed.variant
    root.style.setProperty('--startup-splash-background', seed.surface)
    root.style.setProperty('--startup-splash-foreground', seed.ink)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', seed.surface)
  } catch {
    // Invalid or unsupported startup seeds retain the system-theme fallback.
  }
})()
