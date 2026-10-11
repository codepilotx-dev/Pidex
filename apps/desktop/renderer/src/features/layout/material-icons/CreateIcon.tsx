import type { SVGProps } from 'react'

export interface MaterialSvgIconProps extends SVGProps<SVGSVGElement> {
  size?: number | string
  title?: string
}

export function createMaterialIcon(displayName: string, viewBox: string, markup: string) {
  function MaterialThemeSvgIcon({
    size,
    title,
    width = size ?? '1em',
    height = size ?? '1em',
    role = title ? 'img' : undefined,
    'aria-hidden': ariaHidden = title ? undefined : true,
    ...props
  }: MaterialSvgIconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={viewBox}
        width={width}
        height={height}
        fill="currentColor"
        focusable="false"
        role={role}
        aria-hidden={ariaHidden}
        {...props}
      >
        {title ? <title>{title}</title> : null}
        <g dangerouslySetInnerHTML={{ __html: markup }} />
      </svg>
    )
  }

  MaterialThemeSvgIcon.displayName = displayName
  return MaterialThemeSvgIcon
}
