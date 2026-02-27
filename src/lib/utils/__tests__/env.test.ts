import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { validateServerEnv, validateClientEnv, getServerEnv, getClientEnv } from '../env'

// Minimal set of required env vars that pass server-side validation
const VALID_SERVER_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-value',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-value',
  ANTHROPIC_API_KEY: 'anthropic-api-key',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_testkey',
  CLERK_SECRET_KEY: 'sk_live_testsecret',
}

// Minimal set of required env vars for client-side validation
const VALID_CLIENT_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-value',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_testkey',
}

describe('validateServerEnv', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not throw when all required vars are present', () => {
    Object.entries(VALID_SERVER_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    expect(() => validateServerEnv()).not.toThrow()
  })

  it('throws when NEXT_PUBLIC_SUPABASE_URL is missing', () => {
    Object.entries(VALID_SERVER_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    expect(() => validateServerEnv()).toThrow()
  })

  it('throws when NEXT_PUBLIC_SUPABASE_URL is not a valid URL', () => {
    Object.entries(VALID_SERVER_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'not-a-url')
    expect(() => validateServerEnv()).toThrow()
  })

  it('throws when ANTHROPIC_API_KEY is missing', () => {
    Object.entries(VALID_SERVER_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    expect(() => validateServerEnv()).toThrow()
  })

  it('throws when NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY does not start with pk_', () => {
    Object.entries(VALID_SERVER_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'invalid_key')
    expect(() => validateServerEnv()).toThrow()
  })

  it('throws when CLERK_SECRET_KEY does not start with sk_', () => {
    Object.entries(VALID_SERVER_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    vi.stubEnv('CLERK_SECRET_KEY', 'invalid_secret')
    expect(() => validateServerEnv()).toThrow()
  })

  it('throws when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
    Object.entries(VALID_SERVER_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    expect(() => validateServerEnv()).toThrow()
  })

  it('includes helpful error message listing missing fields', () => {
    Object.entries(VALID_SERVER_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    expect(() => validateServerEnv()).toThrow('環境変数の検証に失敗しました')
  })

  it('includes the offending field name in the error message', () => {
    Object.entries(VALID_SERVER_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    let errorMessage = ''
    try {
      validateServerEnv()
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : ''
    }
    expect(errorMessage).toContain('ANTHROPIC_API_KEY')
  })

  it('accepts optional vars when provided', () => {
    Object.entries(VALID_SERVER_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    vi.stubEnv('XAI_API_KEY', 'xai-key')
    vi.stubEnv('LINEAR_API_KEY', 'linear-key')
    expect(() => validateServerEnv()).not.toThrow()
  })

  it('accepts test as a valid NODE_ENV', () => {
    Object.entries(VALID_SERVER_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    vi.stubEnv('NODE_ENV', 'test')
    expect(() => validateServerEnv()).not.toThrow()
  })

  it('accepts production as a valid NODE_ENV', () => {
    Object.entries(VALID_SERVER_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => validateServerEnv()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// validateClientEnv
// ---------------------------------------------------------------------------
describe('validateClientEnv', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not throw when all required client vars are present', () => {
    Object.entries(VALID_CLIENT_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    expect(() => validateClientEnv()).not.toThrow()
  })

  it('throws when NEXT_PUBLIC_SUPABASE_URL is missing', () => {
    Object.entries(VALID_CLIENT_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'not-a-url')
    expect(() => validateClientEnv()).toThrow()
  })

  it('throws when NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY does not start with pk_', () => {
    Object.entries(VALID_CLIENT_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'bad_key')
    expect(() => validateClientEnv()).toThrow()
  })

  it('throws when NEXT_PUBLIC_SUPABASE_ANON_KEY is empty', () => {
    Object.entries(VALID_CLIENT_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    expect(() => validateClientEnv()).toThrow()
  })

  it('includes helpful error message', () => {
    Object.entries(VALID_CLIENT_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    expect(() => validateClientEnv()).toThrow('クライアント環境変数の検証に失敗しました')
  })

  it('accepts optional NEXT_PUBLIC_APP_URL when provided as valid URL', () => {
    Object.entries(VALID_CLIENT_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://myapp.example.com')
    expect(() => validateClientEnv()).not.toThrow()
  })

  it('throws when NEXT_PUBLIC_APP_URL is invalid URL', () => {
    Object.entries(VALID_CLIENT_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'not-a-url')
    expect(() => validateClientEnv()).toThrow()
  })
})

// ---------------------------------------------------------------------------
// getServerEnv
// ---------------------------------------------------------------------------
describe('getServerEnv', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns parsed env data when all required vars are set', () => {
    Object.entries(VALID_SERVER_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    const env = getServerEnv()
    expect(env.ANTHROPIC_API_KEY).toBe('anthropic-api-key')
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://example.supabase.co')
  })

  it('returns correct Clerk keys', () => {
    Object.entries(VALID_SERVER_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    const env = getServerEnv()
    expect(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY).toBe('pk_live_testkey')
    expect(env.CLERK_SECRET_KEY).toBe('sk_live_testsecret')
  })

  it('returns NODE_ENV as test when set to test', () => {
    Object.entries(VALID_SERVER_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    vi.stubEnv('NODE_ENV', 'test')
    const env = getServerEnv()
    expect(env.NODE_ENV).toBe('test')
  })

  it('throws when required vars are missing', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', '')
    vi.stubEnv('CLERK_SECRET_KEY', '')
    expect(() => getServerEnv()).toThrow('環境変数の検証に失敗しました')
  })

  it('includes optional keys in returned data when provided', () => {
    Object.entries(VALID_SERVER_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    vi.stubEnv('XAI_API_KEY', 'xai-test-key')
    const env = getServerEnv()
    expect(env.XAI_API_KEY).toBe('xai-test-key')
  })

  it('returns undefined for optional keys not set', () => {
    Object.entries(VALID_SERVER_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    const env = getServerEnv()
    expect(env.XAI_API_KEY).toBeUndefined()
    expect(env.LINEAR_API_KEY).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// getClientEnv
// ---------------------------------------------------------------------------
describe('getClientEnv', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns parsed client env data when all required vars are set', () => {
    Object.entries(VALID_CLIENT_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    const env = getClientEnv()
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://example.supabase.co')
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('anon-key-value')
    expect(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY).toBe('pk_live_testkey')
  })

  it('throws when required client vars are missing', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', '')
    expect(() => getClientEnv()).toThrow('クライアント環境変数の検証に失敗しました')
  })

  it('returns optional keys when provided', () => {
    Object.entries(VALID_CLIENT_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://myapp.example.com')
    const env = getClientEnv()
    expect(env.NEXT_PUBLIC_APP_URL).toBe('https://myapp.example.com')
  })

  it('returns undefined for optional sign-in URL not set', () => {
    Object.entries(VALID_CLIENT_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value)
    })
    const env = getClientEnv()
    expect(env.NEXT_PUBLIC_CLERK_SIGN_IN_URL).toBeUndefined()
  })
})
