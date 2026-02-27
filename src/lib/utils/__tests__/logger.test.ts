import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger } from '../logger'

describe('logger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  // ---------------------------------------------------------------------------
  // Production mode (JSON output)
  // ---------------------------------------------------------------------------
  describe('production mode (NODE_ENV !== development)', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('LOG_LEVEL', 'debug')
    })

    it('logger.info writes a JSON string to console.info', () => {
      logger.info('test info message')
      expect(console.info).toHaveBeenCalledOnce()
      const raw = (console.info as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      const parsed = JSON.parse(raw)
      expect(parsed.level).toBe('info')
      expect(parsed.message).toBe('test info message')
    })

    it('logger.debug writes a JSON string to console.info', () => {
      logger.debug('test debug message')
      expect(console.info).toHaveBeenCalledOnce()
      const raw = (console.info as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      const parsed = JSON.parse(raw)
      expect(parsed.level).toBe('debug')
      expect(parsed.message).toBe('test debug message')
    })

    it('logger.warn writes a JSON string to console.error', () => {
      logger.warn('test warn message')
      expect(console.error).toHaveBeenCalledOnce()
      const raw = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      const parsed = JSON.parse(raw)
      expect(parsed.level).toBe('warn')
      expect(parsed.message).toBe('test warn message')
    })

    it('logger.error writes a JSON string to console.error', () => {
      logger.error('test error message')
      expect(console.error).toHaveBeenCalledOnce()
      const raw = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      const parsed = JSON.parse(raw)
      expect(parsed.level).toBe('error')
      expect(parsed.message).toBe('test error message')
    })

    it('JSON output includes timestamp field', () => {
      logger.info('timestamped')
      const raw = (console.info as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      const parsed = JSON.parse(raw)
      expect(parsed.timestamp).toBeDefined()
      expect(new Date(parsed.timestamp).toISOString()).toBe(parsed.timestamp)
    })

    it('JSON output includes context when provided', () => {
      logger.info('with context', { userId: 'user123', action: 'login' })
      const raw = (console.info as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      const parsed = JSON.parse(raw)
      expect(parsed.context).toEqual({ userId: 'user123', action: 'login' })
    })

    it('JSON output omits context key when context is empty object', () => {
      logger.info('no context', {})
      const raw = (console.info as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      const parsed = JSON.parse(raw)
      expect(parsed.context).toBeUndefined()
    })

    it('JSON output includes serialized Error when passed as second arg', () => {
      const err = new Error('something broke')
      logger.error('with error', err)
      const raw = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      const parsed = JSON.parse(raw)
      expect(parsed.error).toBeDefined()
      expect(parsed.error.message).toBe('something broke')
    })

    it('JSON error output includes stack trace when available', () => {
      const err = new Error('with stack')
      logger.error('has stack', err)
      const raw = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      const parsed = JSON.parse(raw)
      expect(parsed.error.stack).toBeDefined()
    })

    it('handles non-Error objects passed to logger.error', () => {
      logger.error('string error', { detail: 'bad state' })
      expect(console.error).toHaveBeenCalledOnce()
      const raw = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      const parsed = JSON.parse(raw)
      expect(parsed.context).toEqual({ detail: 'bad state' })
    })
  })

  // ---------------------------------------------------------------------------
  // Development mode (human-readable output)
  // ---------------------------------------------------------------------------
  describe('development mode (NODE_ENV === development)', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'development')
      vi.stubEnv('LOG_LEVEL', 'debug')
    })

    it('logger.info writes human-readable text to console.info', () => {
      logger.info('dev info message')
      expect(console.info).toHaveBeenCalledOnce()
      const output = (console.info as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(output).toContain('[INFO ')
      expect(output).toContain('dev info message')
    })

    it('logger.debug writes human-readable text to console.info', () => {
      logger.debug('dev debug message')
      expect(console.info).toHaveBeenCalledOnce()
      const output = (console.info as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(output).toContain('[DEBUG]')
      expect(output).toContain('dev debug message')
    })

    it('logger.warn writes human-readable text to console.error', () => {
      logger.warn('dev warn message')
      expect(console.error).toHaveBeenCalledOnce()
      const output = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(output).toContain('[WARN ')
      expect(output).toContain('dev warn message')
    })

    it('logger.error writes human-readable text to console.error', () => {
      logger.error('dev error message')
      expect(console.error).toHaveBeenCalledOnce()
      const output = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(output).toContain('[ERROR]')
      expect(output).toContain('dev error message')
    })

    it('dev mode appends context as indented JSON when provided', () => {
      logger.info('with ctx', { key: 'value' })
      const output = (console.info as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(output).toContain('"key"')
      expect(output).toContain('"value"')
    })

    it('dev mode appends Error message when Error is passed', () => {
      const err = new Error('boom')
      logger.error('caught error', err)
      const output = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(output).toContain('Error: boom')
    })

    it('dev mode does not output context when empty object is passed', () => {
      logger.info('no ctx', {})
      const output = (console.info as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      // Output should just be the single-line tag + message, no JSON block
      expect(output).not.toContain('{')
    })
  })

  // ---------------------------------------------------------------------------
  // Log level filtering
  // ---------------------------------------------------------------------------
  describe('log level filtering', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production')
    })

    it('suppresses debug when LOG_LEVEL is info', () => {
      vi.stubEnv('LOG_LEVEL', 'info')
      logger.debug('should be suppressed')
      expect(console.info).not.toHaveBeenCalled()
    })

    it('suppresses debug and info when LOG_LEVEL is warn', () => {
      vi.stubEnv('LOG_LEVEL', 'warn')
      logger.debug('suppressed debug')
      logger.info('suppressed info')
      expect(console.info).not.toHaveBeenCalled()
    })

    it('suppresses debug, info, and warn when LOG_LEVEL is error', () => {
      vi.stubEnv('LOG_LEVEL', 'error')
      logger.debug('suppressed')
      logger.info('suppressed')
      logger.warn('suppressed')
      expect(console.info).not.toHaveBeenCalled()
      expect(console.error).not.toHaveBeenCalled()
    })

    it('outputs error when LOG_LEVEL is error', () => {
      vi.stubEnv('LOG_LEVEL', 'error')
      logger.error('should appear')
      expect(console.error).toHaveBeenCalledOnce()
    })

    it('outputs all levels when LOG_LEVEL is debug', () => {
      vi.stubEnv('LOG_LEVEL', 'debug')
      logger.debug('d')
      logger.info('i')
      logger.warn('w')
      logger.error('e')
      expect(console.info).toHaveBeenCalledTimes(2)
      expect(console.error).toHaveBeenCalledTimes(2)
    })

    it('falls back to info level when LOG_LEVEL is invalid', () => {
      vi.stubEnv('LOG_LEVEL', 'verbose')
      logger.debug('suppressed by fallback')
      logger.info('allowed by fallback')
      expect(console.info).toHaveBeenCalledTimes(1)
    })

    it('defaults to info level when LOG_LEVEL is not set', () => {
      vi.stubEnv('LOG_LEVEL', '')
      logger.debug('suppressed')
      logger.info('allowed')
      expect(console.info).toHaveBeenCalledTimes(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Error serialization edge cases
  // ---------------------------------------------------------------------------
  describe('error serialization', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('LOG_LEVEL', 'debug')
    })

    it('serializes Error instances with message and stack', () => {
      const err = new Error('test error')
      logger.error('caught', err)
      const raw = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      const parsed = JSON.parse(raw)
      expect(parsed.error.message).toBe('test error')
      expect(typeof parsed.error.stack).toBe('string')
    })

    it('does not include context key when Error is the second arg', () => {
      const err = new Error('err only')
      logger.error('msg', err)
      const raw = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      const parsed = JSON.parse(raw)
      expect(parsed.context).toBeUndefined()
      expect(parsed.error).toBeDefined()
    })
  })
})
