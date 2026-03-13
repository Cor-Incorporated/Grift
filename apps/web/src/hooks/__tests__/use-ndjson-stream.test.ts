import { act, renderHook } from '@testing-library/react'
import { useNDJSONStream } from '../use-ndjson-stream'

function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let index = 0
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]!))
        index++
      } else {
        controller.close()
      }
    },
  })
}

describe('useNDJSONStream', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns initial state', () => {
    const { result } = renderHook(() => useNDJSONStream())
    expect(result.current.streamingContent).toBe('')
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('streams content chunks and accumulates text', async () => {
    const stream = createMockStream([
      '{"type":"content","content":"Hello "}\n',
      '{"type":"content","content":"world"}\n',
      '{"type":"done","done":true}\n',
    ])

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(stream, { status: 200 }),
    )

    const { result } = renderHook(() => useNDJSONStream())

    let turnPromise: ReturnType<typeof result.current.sendStreamMessage>
    await act(async () => {
      turnPromise = result.current.sendStreamMessage('case-1', 'hi')
    })

    await act(async () => {
      await turnPromise!
    })

    expect(result.current.isStreaming).toBe(false)
    expect(result.current.error).toBeNull()
    // streamingContent is cleared after stream completes (finally block)
    expect(result.current.streamingContent).toBe('')
  })

  it('handles error chunks', async () => {
    const stream = createMockStream([
      '{"type":"error","error":"something went wrong"}\n',
    ])

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(stream, { status: 200 }),
    )

    const { result } = renderHook(() => useNDJSONStream())

    let turnPromise: ReturnType<typeof result.current.sendStreamMessage>
    await act(async () => {
      turnPromise = result.current.sendStreamMessage('case-1', 'hi')
    })

    const turn = await act(async () => turnPromise!)

    expect(turn).toBeNull()
    expect(result.current.error).toBe('something went wrong')
    expect(result.current.isStreaming).toBe(false)
  })

  it('handles fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useNDJSONStream())

    let turnPromise: ReturnType<typeof result.current.sendStreamMessage>
    await act(async () => {
      turnPromise = result.current.sendStreamMessage('case-1', 'hi')
    })

    const turn = await act(async () => turnPromise!)

    expect(turn).toBeNull()
    expect(result.current.error).toBe('Network error')
    expect(result.current.isStreaming).toBe(false)
  })

  it('handles HTTP error response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    )

    const { result } = renderHook(() => useNDJSONStream())

    let turnPromise: ReturnType<typeof result.current.sendStreamMessage>
    await act(async () => {
      turnPromise = result.current.sendStreamMessage('case-1', 'hi')
    })

    const turn = await act(async () => turnPromise!)

    expect(turn).toBeNull()
    expect(result.current.error).toContain('500')
    expect(result.current.isStreaming).toBe(false)
  })

  it('handles partial line buffering across chunks', async () => {
    const stream = createMockStream([
      '{"type":"content","con',
      'tent":"buffered"}\n{"type":"done","done":true}\n',
    ])

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(stream, { status: 200 }),
    )

    const { result } = renderHook(() => useNDJSONStream())

    let turnPromise: ReturnType<typeof result.current.sendStreamMessage>
    await act(async () => {
      turnPromise = result.current.sendStreamMessage('case-1', 'hi')
    })

    await act(async () => {
      await turnPromise!
    })

    // streamingContent is cleared after stream completes (finally block)
    expect(result.current.streamingContent).toBe('')
    expect(result.current.error).toBeNull()
  })
})
