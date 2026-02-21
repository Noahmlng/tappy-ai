import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

function joinPath(base, next) {
  if (base === '$') {
    return typeof next === 'number' ? `$[${next}]` : `$.${next}`
  }

  return typeof next === 'number' ? `${base}[${next}]` : `${base}.${next}`
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isValidUri(value) {
  try {
    const parsed = new URL(value)
    return Boolean(parsed.protocol && parsed.hostname)
  } catch {
    return false
  }
}

function pushSchemaError(errors, code, pointer, message, details = {}) {
  errors.push({
    code,
    pointer,
    message,
    details
  })
}

function validateByType(schema, value, pointer, errors) {
  const expectedType = schema.type

  if (expectedType === undefined) {
    validateObjectShape(schema, value, pointer, errors)
    validateArrayShape(schema, value, pointer, errors)
    return
  }

  if (Array.isArray(expectedType)) {
    const matched = expectedType.some((typeName) => typeMatches(typeName, value))
    if (!matched) {
      pushSchemaError(
        errors,
        'schema_invalid_type',
        pointer,
        `expected one of [${expectedType.join(', ')}], got ${typeof value}`,
        { expectedType, actualType: typeof value }
      )
      return
    }
  } else if (!typeMatches(expectedType, value)) {
    pushSchemaError(
      errors,
      'schema_invalid_type',
      pointer,
      `expected ${expectedType}, got ${typeof value}`,
      { expectedType, actualType: typeof value }
    )
    return
  }

  if (expectedType === 'object' || (Array.isArray(expectedType) && expectedType.includes('object'))) {
    validateObjectShape(schema, value, pointer, errors)
  }

  if (expectedType === 'array' || (Array.isArray(expectedType) && expectedType.includes('array'))) {
    validateArrayShape(schema, value, pointer, errors)
  }

  if (expectedType === 'string' || (Array.isArray(expectedType) && expectedType.includes('string'))) {
    validateStringShape(schema, value, pointer, errors)
  }

  if (expectedType === 'number' || expectedType === 'integer') {
    validateNumberShape(schema, value, pointer, errors)
  }
}

function typeMatches(typeName, value) {
  switch (typeName) {
    case 'object':
      return isPlainObject(value)
    case 'array':
      return Array.isArray(value)
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    default:
      return true
  }
}

function validateObjectShape(schema, value, pointer, errors) {
  if (!isPlainObject(value)) {
    return
  }

  const requiredFields = Array.isArray(schema.required) ? schema.required : []
  for (const field of requiredFields) {
    if (!(field in value)) {
      pushSchemaError(
        errors,
        'schema_required_missing',
        joinPath(pointer, field),
        `missing required field: ${field}`,
        { field }
      )
    }
  }

  const properties = isPlainObject(schema.properties) ? schema.properties : {}
  for (const [field, fieldSchema] of Object.entries(properties)) {
    if (field in value) {
      validateNode(fieldSchema, value[field], joinPath(pointer, field), errors)
    }
  }

  if (schema.additionalProperties === false) {
    const allowed = new Set(Object.keys(properties))
    for (const field of Object.keys(value)) {
      if (!allowed.has(field)) {
        pushSchemaError(
          errors,
          'schema_additional_property_not_allowed',
          joinPath(pointer, field),
          `additional property is not allowed: ${field}`,
          { field }
        )
      }
    }
  }
}

function validateArrayShape(schema, value, pointer, errors) {
  if (!Array.isArray(value)) {
    return
  }

  if (isPlainObject(schema.items)) {
    value.forEach((item, index) => {
      validateNode(schema.items, item, joinPath(pointer, index), errors)
    })
  }
}

function validateStringShape(schema, value, pointer, errors) {
  if (typeof value !== 'string') {
    return
  }

  if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
    pushSchemaError(
      errors,
      'schema_string_too_short',
      pointer,
      `string is shorter than minLength=${schema.minLength}`,
      { minLength: schema.minLength, actualLength: value.length }
    )
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    pushSchemaError(
      errors,
      'schema_enum_mismatch',
      pointer,
      `value is not in enum: ${value}`,
      { allowedValues: schema.enum, actualValue: value }
    )
  }

  if (schema.format === 'uri' && !isValidUri(value)) {
    pushSchemaError(
      errors,
      'schema_invalid_uri',
      pointer,
      `value is not a valid uri: ${value}`,
      { actualValue: value }
    )
  }
}

function validateNumberShape(schema, value, pointer, errors) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return
  }

  if (typeof schema.minimum === 'number' && value < schema.minimum) {
    pushSchemaError(
      errors,
      'schema_number_too_small',
      pointer,
      `number is smaller than minimum=${schema.minimum}`,
      { minimum: schema.minimum, actualValue: value }
    )
  }

  if (typeof schema.maximum === 'number' && value > schema.maximum) {
    pushSchemaError(
      errors,
      'schema_number_too_large',
      pointer,
      `number is larger than maximum=${schema.maximum}`,
      { maximum: schema.maximum, actualValue: value }
    )
  }
}

function validateNode(schema, value, pointer, errors) {
  if (!isPlainObject(schema)) {
    return
  }

  validateByType(schema, value, pointer, errors)
}

function getByPath(payload, fieldPath) {
  const parts = String(fieldPath)
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)

  let cursor = payload
  for (const part of parts) {
    if (cursor === null || cursor === undefined || !(part in cursor)) {
      return undefined
    }

    cursor = cursor[part]
  }

  return cursor
}

function stableClone(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableClone(item))
  }

  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort((a, b) => a.localeCompare(b))
      .reduce((acc, key) => {
        acc[key] = stableClone(value[key])
        return acc
      }, {})
  }

  return value
}

export async function readJson(filePath) {
  const resolved = path.resolve(filePath)
  const raw = await fs.readFile(resolved, 'utf8')
  return JSON.parse(raw)
}

export function validateJsonSchema(schema, payload) {
  const errors = []
  validateNode(schema, payload, '$', errors)

  return {
    ok: errors.length === 0,
    reasonCode: errors.length === 0 ? 'schema_valid' : errors[0].code,
    errors
  }
}

export function assertSchemaValid(schema, payload, options = {}) {
  const result = validateJsonSchema(schema, payload)
  assert.equal(
    result.ok,
    true,
    options.message || `schema validation failed: ${JSON.stringify(result.errors, null, 2)}`
  )
  return result
}

export function evaluateRequiredFields(payload, requiredFields = [], options = {}) {
  const normalizedFields = Array.from(new Set(requiredFields.map((field) => String(field).trim()).filter(Boolean)))

  const missing = normalizedFields.filter((fieldPath) => {
    const value = getByPath(payload, fieldPath)
    return value === undefined || value === null
  })

  return {
    ok: missing.length === 0,
    reasonCode: missing.length === 0 ? (options.successReasonCode || 'required_fields_present') : (options.failureReasonCode || 'required_field_missing'),
    missing
  }
}

export function assertRequiredFields(payload, requiredFields = [], options = {}) {
  const result = evaluateRequiredFields(payload, requiredFields, options)
  assert.equal(
    result.ok,
    true,
    options.message || `${result.reasonCode}: ${result.missing.join(', ')}`
  )
  return result
}

export function assertErrorCode(actual, expectedCode, options = {}) {
  const codePath = options.codePath || 'reasonCode'

  let actualCode
  if (typeof actual === 'string') {
    actualCode = actual
  } else if (isPlainObject(actual)) {
    actualCode = getByPath(actual, codePath)
    if (actualCode === undefined && 'code' in actual) {
      actualCode = actual.code
    }
  }

  assert.equal(actualCode, expectedCode, options.message || `expected error code ${expectedCode}, got ${String(actualCode)}`)
}

export function snapshotStringify(value) {
  return JSON.stringify(stableClone(value), null, 2)
}

export function assertSnapshot(actualValue, expectedSnapshotValue, options = {}) {
  const actual = snapshotStringify(actualValue)
  const expected = typeof expectedSnapshotValue === 'string' ? expectedSnapshotValue.trim() : snapshotStringify(expectedSnapshotValue)

  assert.equal(actual, expected, options.message || 'snapshot mismatch')
}

export async function assertSnapshotFile(snapshotPath, actualValue, options = {}) {
  const shouldUpdate = options.updateSnapshot ?? process.env.UPDATE_SNAPSHOTS === '1'
  const actualSnapshot = `${snapshotStringify(actualValue)}\n`

  try {
    const expectedSnapshot = await fs.readFile(snapshotPath, 'utf8')
    assert.equal(actualSnapshot, expectedSnapshot, options.message || `snapshot mismatch: ${snapshotPath}`)
  } catch (error) {
    if (error.code === 'ENOENT' || shouldUpdate) {
      await fs.mkdir(path.dirname(snapshotPath), { recursive: true })
      await fs.writeFile(snapshotPath, actualSnapshot, 'utf8')
      return
    }

    throw error
  }
}
