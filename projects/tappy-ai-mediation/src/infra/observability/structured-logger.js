const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /authorization/i,
  /api[-_]?key/i,
  /cookie/i
]

function shouldRedactField(fieldName = '') {
  const text = String(fieldName || '')
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(text))
}

function redactValue(value, depth = 0) {
  if (depth > 6) return '[REDACTED_DEPTH]'

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1))
  }

  if (value && typeof value === 'object') {
    const output = {}
    for (const [key, item] of Object.entries(value)) {
      output[key] = shouldRedactField(key) ? '[REDACTED]' : redactValue(item, depth + 1)
    }
    return output
  }

  return value
}

function createStructuredLogger(options = {}) {
  const service = String(options.service || 'mediation-service')
  const environment = String(options.environment || process.env.NODE_ENV || 'development')
  const sink = typeof options.sink === 'function' ? options.sink : (line) => console.log(line)

  function emit(level, message, fields = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      service,
      environment,
      level,
      message: String(message || ''),
      fields: redactValue(fields)
    }

    sink(JSON.stringify(entry))
    return entry
  }

  return {
    debug(message, fields = {}) {
      return emit('debug', message, fields)
    },
    info(message, fields = {}) {
      return emit('info', message, fields)
    },
    warn(message, fields = {}) {
      return emit('warn', message, fields)
    },
    error(message, fields = {}) {
      return emit('error', message, fields)
    }
  }
}

export {
  createStructuredLogger,
  redactValue,
  shouldRedactField
}
