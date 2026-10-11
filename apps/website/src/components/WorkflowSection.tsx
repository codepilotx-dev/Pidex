import React, { useState } from 'react'
import { WORKFLOW_STEPS } from '../constants/Content'
import { ProductPlaceholder } from './ProductPlaceholder'
import { ArrowRight } from 'lucide-react'

export const WorkflowSection: React.FC = () => {
  const [activeStepIndex, setActiveStepIndex] = useState(0)
  const currentStep = WORKFLOW_STEPS[activeStepIndex]

  return (
    <section id="workflow" className="py-24 sm:py-32 border-t border-[#DCD6CB]/60">
      <div className="mx-auto max-w-[1600px] px-6 sm:px-10 lg:px-16">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto">
          <span className="font-mono text-xs font-bold uppercase tracking-widest text-[#63715A]">
            Engineering Lifecycle
          </span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-[#17211D] sm:text-5xl">
            From rough hypothesis to verified pull request.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-[#55625D]">
            A predictable four-step cadence that treats agentic coding as a disciplined, reviewable
            engineering process.
          </p>
        </div>

        {/* 4 Steps Interactive Navigation */}
        <div className="mt-16 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {WORKFLOW_STEPS.map((step, idx) => {
            const isActive = idx === activeStepIndex
            return (
              <button
                key={step.step}
                type="button"
                onClick={() => setActiveStepIndex(idx)}
                className={`flex flex-col text-left p-6 rounded-[24px] border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9936E] ${
                  isActive
                    ? 'border-[#17211D] bg-[#FCFAF5] shadow-sm'
                    : 'border-[#DCD6CB] bg-[#F4F0E7]/60 hover:bg-[#FCFAF5] hover:border-[#C9936E]'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-3">
                  <span
                    className={`font-mono text-xs font-bold px-2.5 py-1 rounded-md ${
                      isActive ? 'bg-[#17211D] text-[#FCFAF5]' : 'bg-[#DCD6CB]/60 text-[#55625D]'
                    }`}
                  >
                    STEP {step.step}
                  </span>
                  {idx < WORKFLOW_STEPS.length - 1 && (
                    <ArrowRight className="hidden lg:block h-4 w-4 text-[#DCD6CB]" />
                  )}
                </div>

                <div className="text-lg font-bold text-[#17211D]">{step.name}</div>

                <p className="mt-2 text-xs text-[#55625D] line-clamp-2">{step.title}</p>
              </button>
            )
          })}
        </div>

        {/* Active Step Detailed Showcase */}
        <div className="mt-10 rounded-[32px] sm:rounded-[40px] border border-[#DCD6CB] bg-[#FCFAF5] p-6 sm:p-12 shadow-xs">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
            {/* Step info */}
            <div className="lg:col-span-5">
              <span className="font-mono text-xs font-bold uppercase text-[#63715A]">
                Stage {currentStep.step} / 04
              </span>
              <h3 className="mt-2 text-2xl sm:text-3xl font-extrabold text-[#17211D]">
                {currentStep.name}: {currentStep.title}
              </h3>
              <p className="mt-4 text-base text-[#55625D] leading-relaxed">
                {currentStep.description}
              </p>
              <div className="mt-6 flex items-center gap-2 text-xs font-mono text-[#63715A]">
                <span className="h-2 w-2 rounded-full bg-[#63715A]" />
                <span>Deterministic Checkpoint Verified</span>
              </div>
            </div>

            {/* Step Placeholder Card */}
            <div className="lg:col-span-7">
              <ProductPlaceholder
                label={currentStep.previewLabel}
                aspectRatio="16:9"
                badge={`STAGE ${currentStep.step} PREVIEW`}
                caption={`Workbench state during ${currentStep.name} phase`}
                windowTitle={`Pidex Workflow — Stage ${currentStep.step}`}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
