import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppLayout } from './AppLayout'

describe('AppLayout', () => {
  it('renders navigation links for Dashboard and Cases', () => {
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('link', { name: 'Dashboard' }),
    ).toHaveAttribute('href', '/')
    expect(
      screen.getByRole('link', { name: 'Cases' }),
    ).toHaveAttribute('href', '/cases')
  })

  it('renders the workspace heading', () => {
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('heading', { name: 'Intake workspace' }),
    ).toBeInTheDocument()
  })
})
