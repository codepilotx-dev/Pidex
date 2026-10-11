import React from 'react'
import { HERO_CONTENT, GITHUB_REPO_URL } from '../constants/Content'
import { ProductPlaceholder } from './ProductPlaceholder'
import { TopographyBackground } from './TopographyBackground'

export const Hero: React.FC = () => {
  return (
    <section className="hero-section relative overflow-hidden">
      <div className="hero-copy relative z-20 mx-auto px-6 text-center">
        <div className="animate-fade-up-1 hero-eyebrow inline-flex items-center rounded-full">
          <span className="text-xs font-medium text-white/80">{HERO_CONTENT.eyebrow}</span>
        </div>

        <h1 className="animate-fade-up-2 mx-auto mt-7 max-w-[920px] text-[40px] font-normal tracking-[-0.04em] text-[#f7f3ef] sm:text-[52px] lg:text-[58px] leading-[1.08]">
          Give every coding task
          <br />
          its own place to move forward.
        </h1>

        <p className="animate-fade-up-3 mx-auto mt-6 max-w-[640px] text-sm leading-relaxed text-white/70 sm:text-base">
          {HERO_CONTENT.subhead}
        </p>

        <div className="animate-fade-up-3 mt-9 flex items-center justify-center">
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hero-cta inline-flex min-w-[142px] items-center justify-center rounded-full px-7 py-3.5 text-sm font-medium transition-transform hover:-translate-y-0.5"
          >
            <span>{HERO_CONTENT.primaryCta}</span>
          </a>
        </div>
      </div>

      <TopographyBackground />
      <div className="animate-fade-up-4 hero-product absolute z-10">
        <ProductPlaceholder
          label="Pidex desktop workbench"
          aspectRatio="16:10"
          windowTitle="Pidex"
          className="hero-product-window"
        />
      </div>
    </section>
  )
}
