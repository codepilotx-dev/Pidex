import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { getEffectiveReducedMotion } from '../../hooks/UsePrefersReducedMotion.js'

type CodingHeadingTransitionProps = {
  children: React.ReactNode
  transitionKey: string
}

export function CodingHeadingTransition({
  children,
  transitionKey,
}: CodingHeadingTransitionProps): React.ReactNode {
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const latestRef = useRef({ key: transitionKey, content: children })
  const stableContentRef = useRef(children)
  const displayedKeyRef = useRef(transitionKey)
  const exitAnimationRef = useRef<Animation | null>(null)
  const [displayedKey, setDisplayedKey] = useState(transitionKey)

  latestRef.current = { key: transitionKey, content: children }
  if (displayedKey === transitionKey) stableContentRef.current = children

  useEffect(() => {
    if (transitionKey === displayedKeyRef.current) return

    const showLatestHeading = () => {
      const latest = latestRef.current
      displayedKeyRef.current = latest.key
      stableContentRef.current = latest.content
      setDisplayedKey(latest.key)
    }
    const element = headingRef.current
    if (!element || getEffectiveReducedMotion()) {
      showLatestHeading()
      return
    }

    const animation = element.animate(
      [
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(-4px)' },
      ],
      {
        duration: 80,
        easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
        fill: 'forwards',
      },
    )
    exitAnimationRef.current = animation
    animation.onfinish = () => {
      if (exitAnimationRef.current !== animation) return
      exitAnimationRef.current = null
      animation.cancel()
      showLatestHeading()
    }

    return () => {
      if (exitAnimationRef.current !== animation) return
      exitAnimationRef.current = null
      animation.cancel()
    }
  }, [transitionKey])

  useEffect(() => {
    const element = headingRef.current
    if (!element || getEffectiveReducedMotion()) return
    const animation = element.animate(
      [
        { opacity: 0, transform: 'translateY(4px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      {
        duration: 80,
        easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
      },
    )
    return () => animation.cancel()
  }, [displayedKey])

  return (
    <h1
      ref={headingRef}
      className="quick-chat-heading tw:m-0 tw:max-w-full tw:px-2 tw:py-1 tw:text-balance tw:text-app-text tw:[font:inherit] tw:tracking-normal tw:select-none"
    >
      {displayedKey === transitionKey ? children : stableContentRef.current}
    </h1>
  )
}
