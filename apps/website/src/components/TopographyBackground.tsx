import React from 'react'

export const TopographyBackground: React.FC = () => {
  return (
    <div
      className="hero-landscape pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[58%] overflow-hidden"
      aria-hidden="true"
    >
      <div className="landscape-layer landscape-far" data-asset-slot="background-far" />
      <div className="landscape-layer landscape-mid" data-asset-slot="background-mid" />
      <div className="landscape-layer landscape-front" data-asset-slot="background-front" />
      <div className="landscape-vignette" />
    </div>
  )
}
