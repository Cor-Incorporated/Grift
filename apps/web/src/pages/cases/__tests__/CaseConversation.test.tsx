import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { CaseConversation } from '../CaseConversation'

function renderWithRouter(caseId: string) {
  const router = createMemoryRouter(
    [{ path: '/cases/:caseId/conversation', element: <CaseConversation /> }],
    { initialEntries: [`/cases/${caseId}/conversation`] },
  )
  return render(<RouterProvider router={router} />)
}

describe('CaseConversation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the header with case ID', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [], total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    renderWithRouter('test-case-123')

    expect(screen.getByText('Hearing')).toBeInTheDocument()
    expect(screen.getByText('test-case-123')).toBeInTheDocument()
  })

  it('shows loading state initially', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))

    renderWithRouter('test-case-123')

    expect(screen.getByText('Loading conversation...')).toBeInTheDocument()
  })

  it('shows empty state when no messages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [], total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    renderWithRouter('test-case-123')

    expect(
      await screen.findByText('Send a message to start the conversation.'),
    ).toBeInTheDocument()
  })

  it('renders existing conversation turns', async () => {
    const turns = [
      {
        id: '1',
        case_id: 'test-case-123',
        role: 'user',
        content: 'Hello there',
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: '2',
        case_id: 'test-case-123',
        role: 'assistant',
        content: 'Hi! How can I help?',
        created_at: '2026-01-01T00:00:01Z',
      },
    ]

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: turns, total: 2 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    renderWithRouter('test-case-123')

    expect(await screen.findByText('Hello there')).toBeInTheDocument()
    expect(screen.getByText('Hi! How can I help?')).toBeInTheDocument()
  })

  it('shows error when API fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Server Error', { status: 500 }),
    )

    renderWithRouter('test-case-123')

    expect(await screen.findByText(/API error 500/)).toBeInTheDocument()
  })

  it('renders the message input', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [], total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    renderWithRouter('test-case-123')

    expect(
      await screen.findByPlaceholderText('Type a message...'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })
})
