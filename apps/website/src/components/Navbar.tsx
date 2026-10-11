import React, { useState, useEffect } from 'react'
import { NAV_LINKS, GITHUB_REPO_URL } from '../constants/Content'
import { Github, Menu, X, ArrowUpRight } from 'lucide-react'

export const Navbar: React.FC = () => {
  const [scrolled, setScrolled] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <header
      className={`hero-navbar fixed top-0 z-50 transition-all duration-300 ${
        scrolled ? 'hero-navbar--scrolled' : ''
      }`}
    >
      <div className="relative z-10 grid h-16 w-full grid-cols-[1fr_auto_1fr] items-center px-5 sm:px-10">
        {/* Brand Logo & Name */}
        <a
          href="#"
          className="group flex items-center gap-2 text-decoration-none focus-visible:rounded-lg focus-visible:outline-offset-2"
          aria-label="Pidex Home"
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-white p-1 transition-transform duration-300 group-hover:scale-105">
            <img
              src="/pidex-mark-green.svg"
              alt=""
              className="h-full w-full object-contain text-[#17211D]"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold tracking-[-0.03em] text-white">Pidex</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[9px] font-medium tracking-wide text-white/60">
              BETA
            </span>
          </div>
        </a>

        {/* Desktop Navigation Links */}
        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-xs font-medium text-white/65 transition-colors hover:text-white"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Right CTA */}
        <div className="hidden items-center gap-4 justify-self-end md:flex">
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-white/65 transition-colors hover:text-white"
          >
            GitHub
          </a>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-full bg-white/12 px-5 py-2 text-xs font-medium text-white transition-colors hover:bg-white/20"
          >
            <span>Get started</span>
          </a>
        </div>

        {/* Mobile menu toggle */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="col-start-3 flex h-9 w-9 items-center justify-center justify-self-end rounded-lg border border-white/15 bg-white/10 text-white md:hidden"
          aria-expanded={mobileMenuOpen}
          aria-label="Toggle navigation menu"
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div className="animate-fade-up-1 border-b border-white/10 bg-[#111516]/95 px-6 py-6 backdrop-blur-md md:hidden">
          <nav className="flex flex-col gap-3">
            {NAV_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-xl px-4 py-2.5 text-base font-semibold text-white/85 hover:bg-white/8 hover:text-white"
              >
                {link.label}
              </a>
            ))}
            <div className="mt-2 border-t border-white/10 pt-4">
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-xl bg-white py-3 text-center text-sm font-semibold text-[#17211D]"
              >
                <Github className="h-4 w-4" />
                <span>View on GitHub</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
