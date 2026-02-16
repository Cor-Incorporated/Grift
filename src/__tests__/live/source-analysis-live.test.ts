// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { analyzeWebsiteUrlWithGrok } from '@/lib/source-analysis/website'
import { analyzeRepositoryUrlWithClaude } from '@/lib/source-analysis/repository'

describe.runIf(!!process.env.XAI_API_KEY)(
  'Website Analysis (Grok) - Live API',
  () => {
    it('should analyze a Japanese SaaS company site (kintone)', async () => {
      const result = await analyzeWebsiteUrlWithGrok('https://kintone.cybozu.co.jp')

      expect(result.type).toBe('website_url')
      expect(result.url).toBe('https://kintone.cybozu.co.jp')

      // Summary should be non-empty Japanese text
      expect(result.summary.length).toBeGreaterThan(0)

      // Company overview should describe Cybozu/kintone
      expect(result.companyOverview.length).toBeGreaterThan(0)

      // Should detect services
      expect(result.services.length).toBeGreaterThanOrEqual(1)

      // Key features should be identified
      expect(result.keyFeatures.length).toBeGreaterThanOrEqual(1)

      // UI analysis fields
      expect(result.pageStructure.length).toBeGreaterThanOrEqual(1)
      expect(result.uiComponents.length).toBeGreaterThanOrEqual(1)

      // Estimation context for development estimation
      expect(result.estimationContext.length).toBeGreaterThan(0)

      // Complexity estimation
      expect(result.estimatedComplexity.length).toBeGreaterThan(0)

      // Citations from web search
      expect(result.citations.length).toBeGreaterThanOrEqual(1)
      for (const citation of result.citations) {
        expect(citation.url).toBeTruthy()
        expect(() => new URL(citation.url)).not.toThrow()
      }
    }, 120_000)

    it('should analyze a global SaaS site (linear.app)', async () => {
      const result = await analyzeWebsiteUrlWithGrok('https://linear.app')

      expect(result.type).toBe('website_url')
      expect(result.url).toBe('https://linear.app')

      // Basic structure checks
      expect(result.summary.length).toBeGreaterThan(0)
      expect(result.companyOverview.length).toBeGreaterThan(0)
      expect(result.services.length).toBeGreaterThanOrEqual(1)
      expect(result.keyFeatures.length).toBeGreaterThanOrEqual(1)

      // Linear is known for its interactive UI
      // At least one of designPatterns or navigationPattern should be detected
      const hasDesignInfo = result.designPatterns.length >= 1 || result.navigationPattern.length > 0
      expect(hasDesignInfo).toBe(true)

      // Linear has interactive features (keyboard shortcuts, drag-and-drop, real-time sync)
      expect(result.interactiveFeatures.length).toBeGreaterThanOrEqual(1)

      // Page structure and UI components
      expect(result.pageStructure.length).toBeGreaterThanOrEqual(1)
      expect(result.uiComponents.length).toBeGreaterThanOrEqual(1)
    }, 120_000)

    it('should produce estimation-relevant context from website analysis', async () => {
      const result = await analyzeWebsiteUrlWithGrok('https://linear.app')

      // Estimation context should contain useful info for development estimation
      expect(result.estimationContext.length).toBeGreaterThan(0)

      // UI components + design patterns should be present for estimation
      const hasUiInfo = result.uiComponents.length > 0 || result.designPatterns.length > 0
      expect(hasUiInfo).toBe(true)

      // The combined analysis should provide enough context for a spec
      const analysisText = [
        result.summary,
        result.estimationContext,
        result.uiComponents.join(', '),
        result.designPatterns.join(', '),
        result.keyFeatures.join(', '),
      ].join(' ')
      // Combined text should have substantial content
      expect(analysisText.length).toBeGreaterThan(50)
    }, 120_000)
  }
)

describe.runIf(!!process.env.ANTHROPIC_API_KEY)(
  'GitHub Repository Analysis (Claude) - Live API',
  () => {
    it('should analyze a small public repository (lukeed/clsx)', async () => {
      const result = await analyzeRepositoryUrlWithClaude('https://github.com/lukeed/clsx')

      // Repository metadata
      expect(result.repository.owner).toBe('lukeed')
      expect(result.repository.repo).toBe('clsx')
      expect(result.repository.branch.length).toBeGreaterThan(0)
      expect(result.repository.url).toBe('https://github.com/lukeed/clsx')

      // Analysis should detect JavaScript/TypeScript
      expect(result.analysis.techStack.length).toBeGreaterThanOrEqual(1)
      const techStackLower = result.analysis.techStack.map((t: string) => t.toLowerCase())
      const hasJsOrTs = techStackLower.some(
        (t: string) => t.includes('javascript') || t.includes('typescript') || t.includes('js') || t.includes('ts')
      )
      expect(hasJsOrTs).toBe(true)

      // Summary and system type should be non-empty
      expect(result.analysis.summary.length).toBeGreaterThan(0)
      expect(result.analysis.systemType.length).toBeGreaterThan(0)

      // Archive should have been downloaded
      expect(result.archiveBytes).toBeGreaterThan(0)
    }, 120_000)
  }
)
