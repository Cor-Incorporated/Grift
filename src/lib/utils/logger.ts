type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  level: LogLevel
  message: string
  timestamp: string
  context?: Record<string, unknown>
  error?: { message: string; stack?: string }
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

function getMinLevel(): LogLevel {
  const env =
    typeof process !== 'undefined' && process.env?.LOG_LEVEL
      ? process.env.LOG_LEVEL
      : 'info'
  if (env in LOG_LEVEL_PRIORITY) {
    return env as LogLevel
  }
  return 'info'
}

function isDevelopment(): boolean {
  return (
    typeof process !== 'undefined' && process.env?.NODE_ENV === 'development'
  )
}

function formatError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return {
      message: err.message,
      ...(err.stack ? { stack: err.stack } : {}),
    }
  }
  return { message: String(err) }
}

function emit(entry: LogEntry): void {
  const useStderr = entry.level === 'error' || entry.level === 'warn'
  const writer = useStderr ? console.error : console.info

  if (isDevelopment()) {
    const tag = entry.level.toUpperCase().padEnd(5)
    const parts = [`[${tag}] ${entry.message}`]
    if (entry.context && Object.keys(entry.context).length > 0) {
      parts.push(JSON.stringify(entry.context, null, 2))
    }
    if (entry.error) {
      parts.push(`Error: ${entry.error.message}`)
      if (entry.error.stack) {
        parts.push(entry.error.stack)
      }
    }
    writer(parts.join('\n'))
    return
  }

  writer(JSON.stringify(entry))
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[getMinLevel()]
}

function log(
  level: LogLevel,
  message: string,
  contextOrError?: Record<string, unknown> | Error
): void {
  if (!shouldLog(level)) {
    return
  }

  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
  }

  if (contextOrError instanceof Error) {
    entry.error = formatError(contextOrError)
  } else if (contextOrError && Object.keys(contextOrError).length > 0) {
    entry.context = contextOrError
  }

  emit(entry)
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>): void {
    log('debug', message, context)
  },
  info(message: string, context?: Record<string, unknown>): void {
    log('info', message, context)
  },
  warn(message: string, context?: Record<string, unknown>): void {
    log('warn', message, context)
  },
  error(message: string, contextOrError?: Record<string, unknown> | Error): void {
    log('error', message, contextOrError)
  },
}
