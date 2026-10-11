import React, { useLayoutEffect, useRef, useState } from 'react'
import { cx } from '../../utils/Cx.js'
import { SkeletonBlock } from './Skeleton.js'

type RemoteImageState = 'loading' | 'ready' | 'error'

export type RemoteImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string
  className?: string
  imageClassName?: string
  fallback: React.ReactNode
}

export function RemoteImage({
  src,
  className,
  imageClassName,
  fallback,
  alt,
  onLoad,
  onError,
  ...imageProps
}: RemoteImageProps): React.ReactNode {
  const imageRef = useRef<HTMLImageElement | null>(null)
  const [state, setState] = useState<RemoteImageState>('loading')

  useLayoutEffect(() => {
    setState('loading')
    const image = imageRef.current
    if (!image?.complete) return
    setState(image.naturalWidth > 0 ? 'ready' : 'error')
  }, [src])

  return (
    <span
      className={cx(
        'ui-remote-image tw:relative tw:inline-block tw:size-full tw:min-w-0 tw:min-h-0 tw:overflow-hidden tw:align-middle',
        className,
      )}
      data-state={state}
    >
      {state === 'loading' ? (
        <SkeletonBlock className="ui-remote-image-skeleton tw:absolute tw:inset-0 tw:size-full" />
      ) : null}
      {state === 'error' ? (
        <span
          aria-hidden={alt === '' ? 'true' : undefined}
          className="ui-remote-image-fallback tw:absolute tw:inset-0 tw:inline-flex tw:size-full tw:items-center tw:justify-center"
        >
          {fallback}
        </span>
      ) : (
        <img
          {...imageProps}
          alt={alt}
          className={cx(
            'ui-remote-image-content tw:absolute tw:inset-0 tw:size-full tw:opacity-0 tw:transition-opacity tw:duration-enter tw:ease-standard',
            state === 'ready' && 'tw:opacity-100',
            imageClassName,
          )}
          onError={(event) => {
            setState('error')
            onError?.(event)
          }}
          onLoad={(event) => {
            setState('ready')
            onLoad?.(event)
          }}
          ref={imageRef}
          src={src}
        />
      )}
    </span>
  )
}
