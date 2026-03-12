import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { Dashboard } from './Dashboard'

describe('Dashboard', () => {
  it('renders the v2 dashboard heading', () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('heading', { name: 'BenevolentDirector v2 Dashboard' }),
    ).toBeInTheDocument()
  })
})
