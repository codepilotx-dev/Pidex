import React from 'react'
import { Navbar } from './components/Navbar'
import { Hero } from './components/Hero'
import { ProductOverview } from './components/ProductOverview'
import { FeatureTabs } from './components/FeatureTabs'
import { AlternatingFeatures } from './components/AlternatingFeatures'
import { WorkflowSection } from './components/WorkflowSection'
import { CapabilitiesGrid } from './components/CapabilitiesGrid'
import { FaqSection } from './components/FaqSection'
import { FooterCta } from './components/FooterCta'
import { Footer } from './components/Footer'

export const App: React.FC = () => {
  return (
    <div className="site-shell min-h-screen text-[#17211D]">
      {/* Accessible Skip to Content Link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-[#17211D] focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-[#FCFAF5] focus:shadow-lg focus:outline-none"
      >
        Skip to main content
      </a>

      {/* Main Page Content */}
      <main id="main-content">
        <div className="hero-canvas">
          <Navbar />
          <Hero />
        </div>
        <ProductOverview />
        <FeatureTabs />
        <AlternatingFeatures />
        <WorkflowSection />
        <CapabilitiesGrid />
        <FaqSection />
        <FooterCta />
      </main>

      {/* Footer */}
      <Footer />
    </div>
  )
}
