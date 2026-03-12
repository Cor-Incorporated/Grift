import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CaseDetail } from './CaseDetail'

const { mockGet, mockUseParams } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockUseParams: vi.fn(),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  )

  return {
    ...actual,
    useParams: mockUseParams,
  }
})

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
  caseTypeLabels: {
    new_project: 'New project',
    bug_report: 'Bug report',
    fix_request: 'Fix request',
    feature_addition: 'Feature addition',
    undetermined: 'Undetermined',
  },
  formatDateTime: (value: string) => value ?? 'Not available',
  getApiErrorMessage: () => 'Unable to load case.',
}))

describe('CaseDetail', () => {
  afterEach(() => {
    mockGet.mockReset()
    mockUseParams.mockReset()
  })

  it('shows loading state initially', () => {
    mockUseParams.mockReturnValue({ caseId: 'test-id' })
    mockGet.mockReturnValue(new Promise(() => {}))

    render(
      <MemoryRouter>
        <CaseDetail />
      </MemoryRouter>,
    )

    expect(screen.getByText('Loading case...')).toBeInTheDocument()
  })

  it('shows error state when API returns an error', async () => {
    mockUseParams.mockReturnValue({ caseId: 'test-id' })
    mockGet.mockResolvedValue({
      data: undefined,
      error: { error: { message: 'Not found' } },
    })

    render(
      <MemoryRouter>
        <CaseDetail />
      </MemoryRouter>,
    )

    expect(
      await screen.findByText('Unable to load case.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Back to cases' }),
    ).toBeInTheDocument()
  })

  it('renders case detail with conversations', async () => {
    mockUseParams.mockReturnValue({ caseId: 'test-id' })
    mockGet.mockResolvedValue({
      data: {
        data: {
          id: 'test-id',
          tenant_id: 'tenant-1',
          title: 'Warehouse platform refresh',
          type: 'new_project',
          status: 'draft',
          created_at: '2026-03-12T09:00:00Z',
          updated_at: '2026-03-12T10:00:00Z',
          conversations: [
            {
              id: 'conv-1',
              role: 'user',
              content: 'I need a warehouse system.',
              created_at: '2026-03-12T09:01:00Z',
            },
            {
              id: 'conv-2',
              role: 'assistant',
              content: 'Could you describe the scale?',
              created_at: '2026-03-12T09:02:00Z',
            },
          ],
          estimates: [],
          source_documents: [],
        },
      },
    })

    render(
      <MemoryRouter>
        <CaseDetail />
      </MemoryRouter>,
    )

    expect(
      await screen.findByText('Warehouse platform refresh'),
    ).toBeInTheDocument()
    expect(screen.getByText('New project')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()

    expect(screen.getByText('I need a warehouse system.')).toBeInTheDocument()
    expect(
      screen.getByText('Could you describe the scale?'),
    ).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument()
    })
  })
})
