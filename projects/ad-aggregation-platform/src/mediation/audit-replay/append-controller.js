import {
  G_APPEND_ACK_STATUSES,
  G_APPEND_REASON_CODES,
  createAuditStore
} from './audit-store.js'

function mapRejectedStatusCode(reasonCode) {
  switch (reasonCode) {
    case G_APPEND_REASON_CODES.PAYLOAD_TOO_LARGE:
      return 413
    case G_APPEND_REASON_CODES.PAYLOAD_CONFLICT:
      return 409
    case G_APPEND_REASON_CODES.RATE_LIMITED:
      return 429
    case G_APPEND_REASON_CODES.INTERNAL_UNAVAILABLE:
      return 503
    case G_APPEND_REASON_CODES.AUTH_FAILED:
      return 401
    case G_APPEND_REASON_CODES.INVALID_SCHEMA_VERSION:
    case G_APPEND_REASON_CODES.MISSING_REQUIRED:
    default:
      return 400
  }
}

function mapStatusCode(ack) {
  if (ack.ackStatus === G_APPEND_ACK_STATUSES.ACCEPTED) return 200
  if (ack.ackStatus === G_APPEND_ACK_STATUSES.QUEUED) return 202
  return mapRejectedStatusCode(ack.ackReasonCode)
}

export function createAppendController(options = {}) {
  const auditStore = options.auditStore || createAuditStore(options.auditStoreOptions)

  async function handleAppend(requestBody) {
    const ack = auditStore.append(requestBody)
    return {
      statusCode: mapStatusCode(ack),
      headers: {
        'Content-Type': 'application/json'
      },
      body: ack
    }
  }

  return {
    handleAppend
  }
}
