import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CaseList } from './CaseList'

const { mockGet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
}))

vi.mock('@/lib/api-client', () => ({
  DEFAULT_TENANT_ID: '11111111-1111-1111-1111-111111111111',
  apiClient: {
    GET: mockGet,
  },
  caseStatusLabels: {
    draft: 'Draft',
    interviewing: 'Interviewing',
    analyzing: 'Analyzing',
    estimating: 'Estimating',
    proposed: 'Proposed',
    approved: 'Approved',
    rejected: 'Rejected',
    on_hold: 'On hold',
  },
  caseStatusOptions: [
    'draft',
    'interviewing',
    'analyzing',
    'estimating',
    'proposed',
    'approved',
    'rejected',
    'on_hold',
  ],
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
  formatDateTime: (value: string) => value,
  getApiErrorMessage: () => 'Unable to load cases.',
}))

describe('CaseList', () => {
  afterEach(() => {
    mockGet.mockReset()
  })

  it('renders returned cases in the table', async () => {
    mockGet.mockResolvedValue({
      data: {
        data: [
          {
            id: 'case-1',
            tenant_id: 'tenant-1',
            title: 'Warehouse platform refresh',
            type: 'new_project',
            status: 'draft',
            created_at: '2026-03-12T09:00:00Z',
          },
        ],
        total: 1,
      },
    })

    render(
      <MemoryRouter initialEntries={['/cases']}>
        <CaseList />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('link', { name: 'Warehouse platform refresh' }),
    ).toBeInTheDocument()
    // Type and status labels appear in both filter dropdowns and table cells
    expect(screen.getAllByText('New project').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Draft').length).toBeGreaterThanOrEqual(1)
  })

  it('refetches when the status filter changes', async () => {
    mockGet.mockResolvedValue({
      data: {
        data: [],
        total: 0,
      },
    })

    render(
      <MemoryRouter initialEntries={['/cases']}>
        <CaseList />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(1)
    })

    fireEvent.change(screen.getByLabelText('Status filter'), {
      target: { value: 'draft' },
    })

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(2)
    })
  })
})
