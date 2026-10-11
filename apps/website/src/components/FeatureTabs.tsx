import React, { useState } from 'react'
import { FEATURE_TABS } from '../constants/Content'
import { ProductPlaceholder } from './ProductPlaceholder'
import { Check } from 'lucide-react'

export const FeatureTabs: React.FC = () => {
  const [activeTabId, setActiveTabId] = useState<string>(FEATURE_TABS[0].id)

  const activeTab = FEATURE_TABS.find((t) => t.id === activeTabId) ?? FEATURE_TABS[0]

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'ArrowRight') {
      const nextIndex = (index + 1) % FEATURE_TABS.length
      setActiveTabId(FEATURE_TABS[nextIndex].id)
    } else if (e.key === 'ArrowLeft') {
      const prevIndex = (index - 1 + FEATURE_TABS.length) % FEATURE_TABS.length
      setActiveTabId(FEATURE_TABS[prevIndex].id)
    }
  }

  return (
    <section id="features" className="py-24 sm:py-32 border-t border-[#DCD6CB]/60">
      <div className="mx-auto max-w-[1600px] px-6 sm:px-10 lg:px-16">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto">
          <span className="font-mono text-xs font-bold uppercase tracking-widest text-[#63715A]">
            Core Capabilities
          </span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-[#17211D] sm:text-5xl">
            Everything your task needs, organized.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-[#55625D]">
            Switch between core workflows to inspect how Pidex handles projects, agents, models,
            diff reviews, and background automations.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="mt-12 flex justify-center">
          <div
            role="tablist"
            aria-label="Product Features"
            className="inline-flex flex-wrap items-center justify-center gap-1.5 rounded-[24px] border border-[#DCD6CB] bg-[#FCFAF5] p-1.5 shadow-2xs"
          >
            {FEATURE_TABS.map((tab, idx) => {
              const isSelected = tab.id === activeTabId
              return (
                <button
                  key={tab.id}
                  role="tab"
                  id={`tab-${tab.id}`}
                  aria-selected={isSelected}
                  aria-controls={`panel-${tab.id}`}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => setActiveTabId(tab.id)}
                  onKeyDown={(e) => handleKeyDown(e, idx)}
                  className={`rounded-[18px] px-4 sm:px-6 py-2.5 text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9936E] ${
                    isSelected
                      ? 'bg-[#17211D] text-[#FCFAF5] shadow-xs'
                      : 'text-[#55625D] hover:text-[#17211D] hover:bg-[#F4F0E7]'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Active Tab Content Panel */}
        <div
          role="tabpanel"
          id={`panel-${activeTab.id}`}
          aria-labelledby={`tab-${activeTab.id}`}
          className="mt-12 sm:mt-16 rounded-[32px] sm:rounded-[40px] border border-[#DCD6CB] bg-[#FCFAF5] p-6 sm:p-12 shadow-xs"
        >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            {/* Left Column: Descriptive Content */}
            <div className="lg:col-span-5 flex flex-col justify-center">
              <div className="inline-flex items-center gap-2 rounded-lg bg-[#F4F0E7] px-3 py-1 font-mono text-xs font-semibold text-[#63715A] w-fit mb-4">
                <span>{activeTab.label.toUpperCase()} WORKBENCH</span>
              </div>

              <h3 className="text-2xl sm:text-3xl font-extrabold text-[#17211D] leading-tight">
                {activeTab.title}
              </h3>

              <p className="mt-4 text-base text-[#55625D] leading-relaxed">{activeTab.summary}</p>

              <ul className="mt-6 space-y-3">
                {activeTab.points.map((point) => (
                  <li key={point} className="flex items-start gap-3">
                    <div className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#63715A]/10 text-[#63715A]">
                      <Check className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-sm text-[#17211D] font-medium leading-normal">
                      {point}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Right Column: Aspect-Ratio Product Placeholder */}
            <div className="lg:col-span-7">
              <ProductPlaceholder
                label={activeTab.previewLabel}
                aspectRatio={activeTab.aspectRatio}
                badge={`${activeTab.label.toUpperCase()} PREVIEW`}
                caption="Interactive workbench screenshot placeholder. Preserves layout integrity during future image updates."
                windowTitle={`Pidex — ${activeTab.label}`}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
