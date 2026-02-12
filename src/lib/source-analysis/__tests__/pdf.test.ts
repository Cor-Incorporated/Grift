import { describe, expect, it } from 'vitest'
import { extractTextFromPdfBuffer } from '@/lib/source-analysis/pdf'

describe('extractTextFromPdfBuffer', () => {
  it('extracts text from a simple uncompressed PDF stream', () => {
    const mockPdf = `%PDF-1.4
1 0 obj
<< /Length 32 >>
stream
BT
(Hello PDF) Tj
ET
endstream
endobj
%%EOF`

    const extracted = extractTextFromPdfBuffer(Buffer.from(mockPdf, 'latin1'))
    expect(extracted).toContain('Hello PDF')
  })

  it('extracts text from TJ arrays', () => {
    const mockPdf = `%PDF-1.4
1 0 obj
<< /Length 64 >>
stream
BT
[(Alpha) 120 (Beta)] TJ
ET
endstream
endobj
%%EOF`

    const extracted = extractTextFromPdfBuffer(Buffer.from(mockPdf, 'latin1'))
    expect(extracted).toContain('Alpha')
    expect(extracted).toContain('Beta')
  })
})
