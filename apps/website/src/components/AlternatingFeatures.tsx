import React from 'react'
import { ALTERNATING_FEATURES } from '../constants/Content'
import { ProductPlaceholder } from './ProductPlaceholder'
import { CheckCircle2 } from 'lucide-react'

export const AlternatingFeatures: React.FC = () => {
  return (
    <section className="py-24 sm:py-32 border-t border-[#DCD6CB]/60">
      <div className="mx-auto max-w-[1600px] px-6 sm:px-10 lg:px-16 space-y-24 sm:space-y-32">
        {ALTERNATING_FEATURES.map((feature, idx) => {
          return (
            <div
              key={feature.title}
              className={`grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-center ${
                feature.reverse ? 'lg:grid-flow-dense' : ''
              }`}
            >
              {/* Text Side */}
              <div
                className={`lg:col-span-5 flex flex-col justify-center ${
                  feature.reverse ? 'lg:col-start-8' : ''
                }`}
              >
                <div className="inline-flex items-center gap-2 rounded-full border border-[#DCD6CB] bg-[#FCFAF5] px-3.5 py-1 font-mono text-xs font-semibold text-[#63715A] w-fit mb-4">
                  <span>0{idx + 1}</span>
                  <span>•</span>
                  <span>{feature.badge}</span>
                </div>

                <h3 className="text-2xl sm:text-4xl font-extrabold text-[#17211D] tracking-tight leading-tight">
                  {feature.title}
                </h3>

                <p className="mt-5 text-base sm:text-lg text-[#55625D] leading-relaxed">
                  {feature.description}
                </p>

                <div className="mt-6 space-y-3 pt-4 border-t border-[#DCD6CB]/60">
                  {feature.highlights.map((item) => (
                    <div key={item} className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-[#63715A] shrink-0 mt-0.5" />
                      <span className="text-sm font-medium text-[#17211D]">{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Graphic / Placeholder Side */}
              <div
                className={`lg:col-span-7 ${
                  feature.reverse ? 'lg:col-start-1 lg:row-start-1' : ''
                }`}
              >
                <ProductPlaceholder
                  label={feature.previewLabel}
                  aspectRatio={feature.aspectRatio}
                  badge={`FEATURE 0${idx + 1}`}
                  caption={`Screenshot placeholder for ${feature.title}`}
                  windowTitle={`Pidex — ${feature.badge}`}
                />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
