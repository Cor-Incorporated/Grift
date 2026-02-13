import { timingSafeEqual } from 'node:crypto'

function safeCompare(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)

  if (expectedBuffer.length !== actualBuffer.length) {
    return false
  }

  return timingSafeEqual(expectedBuffer, actualBuffer)
}

export function readCronTokenFromHeaders(headers: Headers): string | null {
  const authorization = headers.get('authorization')
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    const token = authorization.slice('bearer '.length).trim()
    if (token.length > 0) {
      return token
    }
  }

  const directToken = headers.get('x-cron-secret')?.trim()
  if (directToken && directToken.length > 0) {
    return directToken
  }

  return null
}

export function isValidCronToken(input: {
  expectedSecret: string | undefined
  providedToken: string | null
}): boolean {
  if (!input.expectedSecret || input.expectedSecret.trim().length === 0) {
    return false
  }

  if (!input.providedToken) {
    return false
  }

  return safeCompare(input.expectedSecret.trim(), input.providedToken)
}
