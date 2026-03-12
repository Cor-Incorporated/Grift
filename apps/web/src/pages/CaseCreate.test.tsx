import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CaseCreate } from './CaseCreate'

const { mockNavigate, mockPost } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockPost: vi.fn(),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  )

  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('@/lib/api-client', () => ({
  DEFAULT_TENANT_ID: '11111111-1111-1111-1111-111111111111',
  apiClient: {
    POST: mockPost,
  },
  caseTypeLabels: {
    new_project: 'New project',
    bug_report: 'Bug report',
    fix_request: 'Fix request',
    feature_addition: 'Feature addition',
    undetermined: 'Undetermined',
  },
  caseTypeOptions: [
    'new_project',
    'bug_report',
    'fix_request',
    'feature_addition',
    'undetermined',
  ],
  getApiErrorMessage: () => 'Unable to create case.',
}))

describe('CaseCreate', () => {
  afterEach(() => {
    mockNavigate.mockReset()
    mockPost.mockReset()
  })

  it('shows validation errors when required fields are missing', async () => {
    render(
      <MemoryRouter>
        <CaseCreate />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /create case/i }))

    await waitFor(() => {
      expect(screen.getByText(/title is required/i)).toBeInTheDocument()
    })
  })

  it('submits the form and navigates on success', async () => {
    mockPost.mockResolvedValue({
      data: {
        data: { id: 'new-case-id', title: 'My case' },
      },
    })

    render(
      <MemoryRouter>
        <CaseCreate />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: 'My case' },
    })
    fireEvent.change(screen.getByLabelText(/type/i), {
      target: { value: 'new_project' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create case/i }))

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/cases/new-case-id')
    })
  })
})
