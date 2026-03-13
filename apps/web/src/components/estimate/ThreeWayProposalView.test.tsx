import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThreeWayProposalView } from '@/components/estimate/ThreeWayProposalView'

describe('ThreeWayProposalView', () => {
  it('renders comparison data and contradiction warnings', () => {
    render(
      <ThreeWayProposalView
        proposal={{
          our_track_record: {
            median_hours: 42,
            velocity_score: 0.9,
            similar_projects: [
              {
                name: 'Admin refresh',
                actual_hours: 40,
                similarity_score: 0.88,
              },
            ],
          },
          market_benchmark: {
            confidence: 'high',
            provider_count: 4,
            consensus_hours: { min: 45, max: 60 },
            consensus_rate: { min: 10000, max: 14000 },
            citations: [
              {
                url: 'https://example.com/benchmark',
                title: 'Market benchmark',
                source_authority: 'industry',
              },
            ],
            contradictions: [
              {
                description: 'Providers disagree on enterprise testing effort.',
              },
            ],
          },
          our_proposal: {
            proposed_hours: 48,
            proposed_rate: 12000,
            proposed_total: 576000,
            savings_vs_market_percent: 12,
            competitive_advantages: ['Existing platform knowledge'],
            calibration_note: 'Adjusted down from recent delivery velocity.',
          },
        }}
      />,
    )

    expect(
      screen.getByText('Contradictions detected in market data'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Providers disagree on enterprise testing effort.'),
    ).toBeInTheDocument()
    expect(screen.getByText('High confidence')).toBeInTheDocument()
    expect(screen.getByText('Market benchmark')).toBeInTheDocument()
    expect(screen.getByText('Existing platform knowledge')).toBeInTheDocument()
    expect(
      screen.getByText('Adjusted down from recent delivery velocity.'),
    ).toBeInTheDocument()
  })
})
