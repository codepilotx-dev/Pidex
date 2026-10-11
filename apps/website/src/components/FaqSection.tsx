import React, { useState } from 'react'
import { FAQS } from '../constants/Content'
import { ChevronDown } from 'lucide-react'

export const FaqSection: React.FC = () => {
  const [openIndexes, setOpenIndexes] = useState<number[]>([0])

  const toggleIndex = (index: number) => {
    setOpenIndexes((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    )
  }

  return (
    <section id="faq" className="py-24 sm:py-32 border-t border-[#DCD6CB]/60">
      <div className="mx-auto max-w-[1600px] px-6 sm:px-10 lg:px-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Left Column: Title & Note */}
          <div className="lg:col-span-4">
            <span className="font-mono text-xs font-bold uppercase tracking-widest text-[#63715A]">
              Frequently Asked Questions
            </span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-[#17211D] sm:text-4xl leading-tight">
              Clear answers, zero marketing fluff.
            </h2>
            <p className="mt-4 text-base text-[#55625D] leading-relaxed">
              Pidex is open source and currently in Beta. Here are the core technical realities of
              how it operates today.
            </p>

            <div className="mt-8 rounded-2xl border border-[#DCD6CB] bg-[#FCFAF5] p-5">
              <span className="font-mono text-xs font-bold text-[#C9936E] uppercase">
                Beta Notice
              </span>
              <p className="mt-2 text-xs text-[#55625D] leading-relaxed">
                We currently publish pure source releases on GitHub for Windows x64. Binary
                installers are generated on your local machine using Bun.
              </p>
            </div>
          </div>

          {/* Right Column: Accordion */}
          <div className="lg:col-span-8 space-y-4">
            {FAQS.map((faq, idx) => {
              const isOpen = openIndexes.includes(idx)
              return (
                <div
                  key={faq.question}
                  className="rounded-[24px] border border-[#DCD6CB] bg-[#FCFAF5] overflow-hidden transition-all duration-200 shadow-2xs"
                >
                  <button
                    type="button"
                    onClick={() => toggleIndex(idx)}
                    aria-expanded={isOpen}
                    aria-controls={`faq-answer-${idx}`}
                    className="flex w-full items-center justify-between p-6 text-left font-bold text-lg text-[#17211D] hover:text-[#63715A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9936E]"
                  >
                    <span>{faq.question}</span>
                    <ChevronDown
                      className={`h-5 w-5 text-[#55625D] transition-transform duration-200 shrink-0 ml-4 ${
                        isOpen ? 'rotate-180 text-[#C9936E]' : ''
                      }`}
                    />
                  </button>

                  {isOpen && (
                    <div
                      id={`faq-answer-${idx}`}
                      className="px-6 pb-6 pt-1 text-sm sm:text-base text-[#55625D] leading-relaxed border-t border-[#DCD6CB]/40 animate-fade-up-1"
                    >
                      {faq.answer}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
