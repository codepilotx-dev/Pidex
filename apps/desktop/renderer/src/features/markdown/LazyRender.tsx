import React, { useEffect, useRef, useState } from 'react'

export function LazyRender({
  children,
  className,
  fallback,
}: {
  children: React.ReactNode
  className?: string
  fallback: React.ReactNode
}): React.ReactNode {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host || visible) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setVisible(true)
        observer.disconnect()
      },
      { rootMargin: '600px 0px' },
    )
    observer.observe(host)
    return () => observer.disconnect()
  }, [visible])

  return (
    <div className={className} ref={hostRef}>
      {visible ? children : fallback}
    </div>
  )
}
