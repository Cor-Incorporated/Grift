import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CitationList } from '@/components/estimate/CitationList'

describe('CitationList', () => {
  it('renders the empty state when no citations are present', () => {
    render(<CitationList citations={[]} />)

    expect(
      screen.getByText('No evidence citations were returned for this estimate.'),
    ).toBeInTheDocument()
  })

  it('renders citation details and link metadata', () => {
    render(
      <CitationList
        citations={[
          {
            url: 'https://example.com/source',
            title: 'Benchmark source',
            source_authority: 'industry',
            snippet: 'Benchmark snippet',
          },
        ]}
      />,
    )

    expect(screen.getByText('Benchmark source')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open source' })).toHaveAttribute(
      'href',
      'https://example.com/source',
    )
    expect(screen.getByText('Industry')).toBeInTheDocument()
    expect(screen.getByText('Benchmark snippet')).toBeInTheDocument()
  })
})
