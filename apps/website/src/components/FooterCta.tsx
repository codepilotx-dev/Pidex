import React from 'react'
import { GITHUB_REPO_URL } from '../constants/Content'
import { Github, ArrowUpRight, Sparkles } from 'lucide-react'

export const FooterCta: React.FC = () => {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-[1600px] px-6 sm:px-10 lg:px-16">
        <div className="relative overflow-hidden rounded-[36px] sm:rounded-[48px] border border-[#DCD6CB] bg-[#17211D] p-10 sm:p-20 text-center text-[#FCFAF5] shadow-xl">
          {/* Subtle warm decorative glow */}
          <div className="pointer-events-none absolute -top-48 left-1/2 -translate-x-1/2 h-96 w-96 rounded-full bg-[#C9936E]/20 blur-3xl" />

          <div className="relative z-10 max-w-2xl mx-auto">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 backdrop-blur-xs mb-6">
              <Sparkles className="h-3.5 w-3.5 text-[#C9936E]" />
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#FCFAF5]">
                Get Started Today
              </span>
            </div>

            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-[#FCFAF5] leading-tight">
              Your next task already has a home.
            </h2>

            <p className="mt-6 text-base sm:text-lg text-white/80 leading-relaxed">
              Clone the repository, configure your preferred provider, and start pairing with an
              agent that respects your code, your files, and your review standards.
            </p>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2.5 rounded-full bg-[#FCFAF5] px-8 py-4 text-base font-bold text-[#17211D] shadow-lg transition-all duration-200 hover:bg-[#F4F0E7] hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9936E]"
              >
                <Github className="h-5 w-5" />
                <span>View on GitHub</span>
                <ArrowUpRight className="h-4 w-4 opacity-70" />
              </a>
            </div>

            <div className="mt-6 font-mono text-xs text-white/60">
              MIT Licensed • Beta • Windows x64 Native
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
