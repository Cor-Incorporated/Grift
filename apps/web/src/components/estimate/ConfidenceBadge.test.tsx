import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConfidenceBadge } from '@/components/estimate/ConfidenceBadge'

describe('ConfidenceBadge', () => {
  it('renders the confidence label for a known level', () => {
    render(<ConfidenceBadge level="high" />)

    expect(screen.getByText('High confidence')).toBeInTheDocument()
  })

  it('renders a fallback label when confidence is unavailable', () => {
    render(<ConfidenceBadge level={null} />)

    expect(screen.getByText('Confidence unavailable')).toBeInTheDocument()
  })
})
