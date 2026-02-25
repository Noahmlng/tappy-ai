import { createConfigPublishService, H_PUBLISH_REASON_CODES } from '../config-governance/config-publish.js'

function isAuthErrorCode(code) {
  return (
    code === H_PUBLISH_REASON_CODES.AUTH_CONTEXT_INVALID ||
    code === H_PUBLISH_REASON_CODES.AUTH_OPERATOR_MISMATCH ||
    code === H_PUBLISH_REASON_CODES.AUTHZ_DENIED ||
    code === H_PUBLISH_REASON_CODES.AUTHZ_DENIED_SCOPE
  )
}

function isConflictCode(code) {
  return (
    code === H_PUBLISH_REASON_CODES.BASE_VERSION_CONFLICT ||
    code === H_PUBLISH_REASON_CODES.IDEMPOTENCY_PAYLOAD_CONFLICT
  )
}

function mapHttpStatus(response) {
  if (response.publishState !== 'failed') return 200
  if (isAuthErrorCode(response.ackReasonCode)) return 403
  if (isConflictCode(response.ackReasonCode)) return 409
  if (response.ackReasonCode === H_PUBLISH_REASON_CODES.ROLLBACK_TARGET_NOT_FOUND) return 404
  return 400
}

export function createConfigPublishController(options = {}) {
  const publishService = options.publishService || createConfigPublishService(options.publishServiceOptions)

  async function handlePostConfigPublish(requestBody) {
    const result = await publishService.publishConfig(requestBody)
    const statusCode = mapHttpStatus(result)

    return {
      statusCode,
      headers: {
        'Content-Type': 'application/json'
      },
      body: result
    }
  }

  return {
    handlePostConfigPublish
  }
}
