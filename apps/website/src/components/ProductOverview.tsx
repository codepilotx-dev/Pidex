import React from 'react'
import { PRODUCT_OVERVIEW } from '../constants/Content'
import { HardDrive, Cpu, GitPullRequest } from 'lucide-react'

const PILLAR_ICONS = [HardDrive, Cpu, GitPullRequest]

export const ProductOverview: React.FC = () => {
  return (
    <section id="product" className="py-24 sm:py-32 border-t border-[#DCD6CB]/60">
      <div className="mx-auto max-w-[1600px] px-6 sm:px-10 lg:px-16">
        {/* Editorial Section Header */}
        <div className="max-w-3xl">
          <span className="font-mono text-xs font-bold uppercase tracking-widest text-[#63715A]">
            Product Architecture
          </span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-[#17211D] sm:text-5xl leading-tight">
            {PRODUCT_OVERVIEW.sectionTitle}
          </h2>
          <p className="mt-6 text-xl sm:text-2xl font-medium text-[#17211D] leading-snug">
            {PRODUCT_OVERVIEW.narrativeLead}
          </p>
          <p className="mt-4 text-base sm:text-lg text-[#55625D] leading-relaxed">
            {PRODUCT_OVERVIEW.sectionSubtitle}
          </p>
        </div>

        {/* 3 Narrative Pillar Cards */}
        <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-3">
          {PRODUCT_OVERVIEW.pillars.map((pillar, idx) => {
            const Icon = PILLAR_ICONS[idx % PILLAR_ICONS.length]
            return (
              <div
                key={pillar.title}
                className="group relative flex flex-col justify-between rounded-[28px] border border-[#DCD6CB] bg-[#FCFAF5] p-8 shadow-xs transition-all duration-300 hover:shadow-md hover:-translate-y-1"
              >
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F4F0E7] text-[#63715A] border border-[#DCD6CB] transition-transform duration-300 group-hover:scale-105">
                      <Icon className="h-6 w-6" />
                    </div>
                    <span className="rounded-full bg-[#F4F0E7] px-3 py-1 font-mono text-[11px] font-semibold text-[#55625D]">
                      {pillar.tag}
                    </span>
                  </div>

                  <h3 className="text-xl font-bold text-[#17211D]">{pillar.title}</h3>

                  <p className="mt-4 text-sm text-[#55625D] leading-relaxed">
                    {pillar.description}
                  </p>
                </div>

                <div className="mt-8 pt-6 border-t border-[#DCD6CB]/60 font-mono text-xs text-[#63715A] font-medium flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#63715A]" />
                  <span>Native Windows Execution</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
