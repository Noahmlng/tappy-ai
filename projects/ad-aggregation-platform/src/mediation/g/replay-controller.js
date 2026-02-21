import { createReplayEngine, G_REPLAY_REASON_CODES } from './replay-engine.js'

function mapErrorStatus(reasonCode) {
  switch (reasonCode) {
    case G_REPLAY_REASON_CODES.OPPORTUNITY_ALIAS_CONFLICT:
    case G_REPLAY_REASON_CODES.VERSION_ANCHOR_CONFLICT:
      return 409
    case G_REPLAY_REASON_CODES.MISSING_VERSION_ANCHOR:
    case G_REPLAY_REASON_CODES.INVALID_CURSOR:
    case G_REPLAY_REASON_CODES.INVALID_TIME_RANGE:
    case G_REPLAY_REASON_CODES.INVALID_AS_OF_TIME:
    case G_REPLAY_REASON_CODES.INVALID_SORT:
    case G_REPLAY_REASON_CODES.INVALID_PAGINATION:
    case G_REPLAY_REASON_CODES.INVALID_QUERY_MODE:
    case G_REPLAY_REASON_CODES.INVALID_OUTPUT_MODE:
    case G_REPLAY_REASON_CODES.INVALID_CONTRACT_VERSION:
    case G_REPLAY_REASON_CODES.MISSING_REQUIRED:
    default:
      return 400
  }
}

export function createReplayController(options = {}) {
  const replayEngine = options.replayEngine || createReplayEngine(options.replayEngineOptions)

  async function handleReplay(query) {
    const result = replayEngine.replay(query)

    if (!result.ok) {
      return {
        statusCode: mapErrorStatus(result.reasonCode),
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          ok: false,
          reasonCode: result.reasonCode,
          message: result.message,
          retryable: result.retryable === true
        }
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: result
    }
  }

  return {
    handleReplay
  }
}
