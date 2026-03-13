import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApprovalActions } from '@/components/estimate/ApprovalActions'
import {
  approveProposal,
  createProposal,
  listProposals,
  rejectProposal,
} from '@/lib/api-client'

vi.mock('@/lib/api-client', () => ({
  approveProposal: vi.fn(),
  createProposal: vi.fn(),
  getApiErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
  listProposals: vi.fn(),
  rejectProposal: vi.fn(),
}))

const mockedApproveProposal = vi.mocked(approveProposal)
const mockedCreateProposal = vi.mocked(createProposal)
const mockedListProposals = vi.mocked(listProposals)
const mockedRejectProposal = vi.mocked(rejectProposal)

describe('ApprovalActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prepares an approval session when none exists', async () => {
    mockedListProposals.mockResolvedValue([])
    mockedCreateProposal.mockResolvedValue({
      id: 'proposal-1',
      case_id: 'case-1',
      estimate_id: 'estimate-1',
      status: 'draft',
    })

    render(<ApprovalActions caseId="case-1" estimateId="estimate-1" />)

    expect(
      await screen.findByText('No approval session exists yet for this estimate.'),
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Prepare approval session' }),
    )

    await waitFor(() => {
      expect(mockedCreateProposal).toHaveBeenCalledWith('case-1', 'estimate-1')
    })

    expect(screen.getByText('Approval session prepared.')).toBeInTheDocument()
  })

  it('approves with the current proposal session', async () => {
    mockedListProposals.mockResolvedValue([
      {
        id: 'proposal-1',
        case_id: 'case-1',
        estimate_id: 'estimate-1',
        status: 'draft',
      },
    ])
    mockedApproveProposal.mockResolvedValue({
      decision: 'approved',
    })
    mockedRejectProposal.mockResolvedValue({
      decision: 'rejected',
    })

    render(<ApprovalActions caseId="case-1" estimateId="estimate-1" />)

    await screen.findByText('Draft')

    fireEvent.change(screen.getByLabelText('Decision note'), {
      target: { value: 'Ready to proceed.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Approve proposal' }))

    await waitFor(() => {
      expect(mockedApproveProposal).toHaveBeenCalledWith(
        'case-1',
        'proposal-1',
        'Ready to proceed.',
      )
    })
  })

  it('rejects with the current proposal session', async () => {
    mockedListProposals.mockResolvedValue([
      {
        id: 'proposal-1',
        case_id: 'case-1',
        estimate_id: 'estimate-1',
        status: 'draft',
      },
    ])
    mockedRejectProposal.mockResolvedValue({
      decision: 'rejected',
    })

    render(<ApprovalActions caseId="case-1" estimateId="estimate-1" />)

    await screen.findByText('Draft')

    fireEvent.change(screen.getByLabelText('Decision note'), {
      target: { value: 'Need more benchmark evidence.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reject proposal' }))

    await waitFor(() => {
      expect(mockedRejectProposal).toHaveBeenCalledWith(
        'case-1',
        'proposal-1',
        'Need more benchmark evidence.',
      )
    })
  })
})
