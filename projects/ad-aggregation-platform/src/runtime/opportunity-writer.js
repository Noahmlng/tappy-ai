import { createHash } from 'node:crypto'

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function nowIso() {
  return new Date().toISOString()
}

function sha256(text = '') {
  return createHash('sha256').update(String(text)).digest('hex')
}

function toJsonObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback
}

function ensureStateCollection(state, key) {
  if (!state || typeof state !== 'object') return []
  if (!Array.isArray(state[key])) {
    state[key] = []
  }
  return state[key]
}

function upsertByKey(rows = [], keyField, row) {
  const key = cleanText(row?.[keyField])
  if (!key) return rows
  return [
    row,
    ...rows.filter((item) => cleanText(item?.[keyField]) !== key),
  ]
}

function appendStateRow(rows = [], row, max = 2000) {
  const next = [row, ...rows]
  if (!Number.isFinite(max) || max <= 0) return next
  return next.slice(0, Math.floor(max))
}

function deriveOpportunityKeys(input = {}) {
  const requestId = cleanText(input.requestId)
  const appId = cleanText(input.appId)
  const placementId = cleanText(input.placementId)
  const seed = `${requestId}|${appId}|${placementId}|${nowIso()}`
  const digest = sha256(seed)

  return {
    opportunityKey: cleanText(input.opportunityKey) || `opp_${digest.slice(0, 20)}`,
    requestKey: requestId || `req_${digest.slice(20, 36)}`,
    traceKey: cleanText(input.traceKey) || `trace_${digest.slice(36, 52)}`,
    responseReference: cleanText(input.responseReference) || requestId || `resp_${digest.slice(52, 64)}`,
    renderAttemptId: cleanText(input.renderAttemptId) || 'render_primary',
  }
}

function defaultVersionAnchor(input = {}) {
  return {
    pipelineVersion: cleanText(input.pipelineVersion) || 'opportunity_first_v1',
    placementConfigVersion: Number.isFinite(Number(input.placementConfigVersion))
      ? Number(input.placementConfigVersion)
      : 1,
    decisionModelVersion: cleanText(input.decisionModelVersion) || 'rank_v1',
  }
}

export function createOpportunityWriter(options = {}) {
  const pool = options.pool || null
  const state = options.state && typeof options.state === 'object' ? options.state : null
  const requestContext = options.requestContext instanceof Map ? options.requestContext : new Map()
  const stateRowLimit = Number.isFinite(Number(options.stateRowLimit)) ? Number(options.stateRowLimit) : 3000

  async function createOpportunityRecord(input = {}) {
    const timestamp = nowIso()
    const keys = deriveOpportunityKeys(input)
    const versionAnchorSnapshot = toJsonObject(input.versionAnchorSnapshot, defaultVersionAnchor(input))
    const anchorHash = sha256(JSON.stringify(versionAnchorSnapshot))
    const payload = toJsonObject(input.payload, {})

    const row = {
      opportunityKey: keys.opportunityKey,
      requestKey: keys.requestKey,
      traceKey: keys.traceKey,
      appId: cleanText(input.appId),
      placementId: cleanText(input.placementId),
      state: cleanText(input.state) || 'received',
      versionAnchorSnapshot,
      anchorHash,
      payload,
      createdAt: timestamp,
      updatedAt: timestamp,
      responseReference: keys.responseReference,
      renderAttemptId: keys.renderAttemptId,
    }

    requestContext.set(keys.requestKey, {
      opportunityKey: row.opportunityKey,
      responseReference: row.responseReference,
      renderAttemptId: row.renderAttemptId,
      appId: row.appId,
      placementId: row.placementId,
    })

    if (pool) {
      await pool.query(
        `
          INSERT INTO opportunity_records (
            opportunity_key,
            request_key,
            trace_key,
            app_id,
            placement_id,
            state,
            version_anchor_snapshot,
            anchor_hash,
            payload,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10::timestamptz, $11::timestamptz)
          ON CONFLICT (opportunity_key) DO UPDATE
          SET state = EXCLUDED.state,
              payload = EXCLUDED.payload,
              version_anchor_snapshot = EXCLUDED.version_anchor_snapshot,
              anchor_hash = EXCLUDED.anchor_hash,
              updated_at = EXCLUDED.updated_at
        `,
        [
          row.opportunityKey,
          row.requestKey,
          row.traceKey,
          row.appId,
          row.placementId,
          row.state,
          JSON.stringify(row.versionAnchorSnapshot),
          row.anchorHash,
          JSON.stringify(row.payload),
          row.createdAt,
          row.updatedAt,
        ],
      )
    }

    if (state) {
      const rows = ensureStateCollection(state, 'opportunityRecords')
      state.opportunityRecords = upsertByKey(rows, 'opportunityKey', row).slice(0, stateRowLimit)
    }

    return row
  }

  async function writeDeliveryRecord(input = {}) {
    const timestamp = nowIso()
    const requestId = cleanText(input.requestId)
    const context = requestContext.get(requestId)
    const keys = deriveOpportunityKeys({
      ...context,
      ...input,
      requestId,
    })

    const row = {
      responseReference: keys.responseReference,
      renderAttemptId: keys.renderAttemptId,
      opportunityKey: cleanText(input.opportunityKey) || cleanText(context?.opportunityKey) || keys.opportunityKey,
      appId: cleanText(input.appId) || cleanText(context?.appId),
      placementId: cleanText(input.placementId) || cleanText(context?.placementId),
      deliveryStatus: cleanText(input.deliveryStatus) || 'no_fill',
      noFillReasonCode: cleanText(input.noFillReasonCode),
      errorCode: cleanText(input.errorCode),
      payload: toJsonObject(input.payload, {}),
      createdAt: timestamp,
      updatedAt: timestamp,
      requestId,
    }

    requestContext.set(requestId, {
      opportunityKey: row.opportunityKey,
      responseReference: row.responseReference,
      renderAttemptId: row.renderAttemptId,
      appId: row.appId,
      placementId: row.placementId,
    })

    if (pool) {
      await pool.query(
        `
          INSERT INTO delivery_records (
            response_reference,
            render_attempt_id,
            opportunity_key,
            app_id,
            placement_id,
            delivery_status,
            no_fill_reason_code,
            error_code,
            payload,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz, $11::timestamptz)
          ON CONFLICT (response_reference, render_attempt_id) DO UPDATE
          SET delivery_status = EXCLUDED.delivery_status,
              no_fill_reason_code = EXCLUDED.no_fill_reason_code,
              error_code = EXCLUDED.error_code,
              payload = EXCLUDED.payload,
              updated_at = EXCLUDED.updated_at
        `,
        [
          row.responseReference,
          row.renderAttemptId,
          row.opportunityKey,
          row.appId,
          row.placementId,
          row.deliveryStatus,
          row.noFillReasonCode || null,
          row.errorCode || null,
          JSON.stringify(row.payload),
          row.createdAt,
          row.updatedAt,
        ],
      )
    }

    if (state) {
      const rows = ensureStateCollection(state, 'deliveryRecords')
      const key = `${row.responseReference}::${row.renderAttemptId}`
      row.deliveryKey = key
      state.deliveryRecords = upsertByKey(rows, 'deliveryKey', row).slice(0, stateRowLimit)
    }

    return row
  }

  async function resolveRequestContext(requestId = '') {
    const key = cleanText(requestId)
    if (!key) return null

    const cached = requestContext.get(key)
    if (cached) return cached

    if (pool) {
      const result = await pool.query(
        `
          SELECT
            response_reference,
            render_attempt_id,
            opportunity_key,
            app_id,
            placement_id
          FROM delivery_records
          WHERE response_reference = $1
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [key],
      )
      const row = Array.isArray(result.rows) ? result.rows[0] : null
      if (row) {
        const resolved = {
          responseReference: cleanText(row.response_reference),
          renderAttemptId: cleanText(row.render_attempt_id),
          opportunityKey: cleanText(row.opportunity_key),
          appId: cleanText(row.app_id),
          placementId: cleanText(row.placement_id),
        }
        requestContext.set(key, resolved)
        return resolved
      }
    }

    if (state) {
      const rows = ensureStateCollection(state, 'deliveryRecords')
      const row = rows.find((item) => cleanText(item?.responseReference) === key)
      if (row) {
        const resolved = {
          responseReference: cleanText(row.responseReference),
          renderAttemptId: cleanText(row.renderAttemptId),
          opportunityKey: cleanText(row.opportunityKey),
          appId: cleanText(row.appId),
          placementId: cleanText(row.placementId),
        }
        requestContext.set(key, resolved)
        return resolved
      }
    }

    return null
  }

  async function updateOpportunityState(opportunityKey, stateValue, patchPayload = {}) {
    const key = cleanText(opportunityKey)
    if (!key) return false

    const updatedAt = nowIso()
    const patch = toJsonObject(patchPayload, {})

    if (pool) {
      await pool.query(
        `
          UPDATE opportunity_records
          SET
            state = $2,
            payload = coalesce(payload, '{}'::jsonb) || $3::jsonb,
            updated_at = $4::timestamptz
          WHERE opportunity_key = $1
        `,
        [key, cleanText(stateValue) || 'updated', JSON.stringify(patch), updatedAt],
      )
    }

    if (state) {
      const rows = ensureStateCollection(state, 'opportunityRecords')
      const index = rows.findIndex((item) => cleanText(item?.opportunityKey) === key)
      if (index >= 0) {
        rows[index] = {
          ...rows[index],
          state: cleanText(stateValue) || rows[index].state,
          payload: {
            ...(toJsonObject(rows[index].payload, {})),
            ...patch,
          },
          updatedAt,
        }
      }
    }

    return true
  }

  function mapOpportunityStateFromEvent(input = {}) {
    const eventType = cleanText(input.eventType).toLowerCase()
    const kind = cleanText(input.kind || input.event).toLowerCase()
    const postbackStatus = cleanText(input.postbackStatus).toLowerCase()

    if (eventType === 'postback' && postbackStatus === 'success') return 'converted'
    if (eventType === 'postback' && postbackStatus === 'failed') return 'postback_failed'
    if (kind === 'click') return 'clicked'
    if (kind === 'impression') return 'impressioned'
    return 'event_recorded'
  }

  async function writeEventRecord(input = {}) {
    const timestamp = nowIso()
    const requestId = cleanText(input.requestId)
    const context = await resolveRequestContext(requestId)
    const responseReference = cleanText(input.responseReference || context?.responseReference || requestId)
    const renderAttemptId = cleanText(input.renderAttemptId || context?.renderAttemptId || 'render_primary')
    const opportunityKey = cleanText(input.opportunityKey || context?.opportunityKey)

    const payload = {
      ...toJsonObject(input.payload, {}),
      requestId,
      appId: cleanText(input.appId || context?.appId),
      placementId: cleanText(input.placementId || context?.placementId),
      kind: cleanText(input.kind),
      event: cleanText(input.event),
      eventType: cleanText(input.eventType),
      postbackStatus: cleanText(input.postbackStatus),
    }

    const idempotencySeed = [
      cleanText(input.idempotencyKey),
      requestId,
      responseReference,
      renderAttemptId,
      cleanText(input.eventType),
      cleanText(input.kind || input.event),
      cleanText(input.eventSeq),
      cleanText(input.conversionId),
    ]
      .filter(Boolean)
      .join('|')
    const idempotencyKey = idempotencySeed
      ? `evt_idem_${sha256(idempotencySeed).slice(0, 24)}`
      : `evt_idem_${sha256(`${timestamp}|${Math.random()}`).slice(0, 24)}`

    const payloadDigest = sha256(JSON.stringify(payload))
    const eventKey = cleanText(input.eventKey)
      || `evt_${sha256(`${idempotencyKey}|${payloadDigest}`).slice(0, 24)}`

    const row = {
      eventKey,
      idempotencyKey,
      responseReference: responseReference || null,
      renderAttemptId: renderAttemptId || null,
      eventType: cleanText(input.eventType) || 'sdk_event',
      eventLayer: cleanText(input.eventLayer) || 'sdk',
      eventStatus: cleanText(input.eventStatus) || 'recorded',
      payloadDigest,
      payload,
      occurredAt: cleanText(input.occurredAt) || timestamp,
      createdAt: timestamp,
      opportunityKey,
    }

    if (pool) {
      await pool.query(
        `
          INSERT INTO event_records (
            event_key,
            idempotency_key,
            response_reference,
            render_attempt_id,
            event_type,
            event_layer,
            event_status,
            payload_digest,
            payload,
            occurred_at,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz, $11::timestamptz)
          ON CONFLICT (event_key) DO NOTHING
        `,
        [
          row.eventKey,
          row.idempotencyKey,
          row.responseReference,
          row.renderAttemptId,
          row.eventType,
          row.eventLayer,
          row.eventStatus,
          row.payloadDigest,
          JSON.stringify(row.payload),
          row.occurredAt,
          row.createdAt,
        ],
      )
    }

    if (state) {
      const rows = ensureStateCollection(state, 'opportunityEventRecords')
      state.opportunityEventRecords = appendStateRow(rows, row, stateRowLimit)
    }

    if (opportunityKey) {
      await updateOpportunityState(opportunityKey, mapOpportunityStateFromEvent(input), {
        lastEventType: row.eventType,
        lastEventStatus: row.eventStatus,
        lastEventAt: row.occurredAt,
      })
    }

    return row
  }

  return {
    createOpportunityRecord,
    writeDeliveryRecord,
    writeEventRecord,
    updateOpportunityState,
    resolveRequestContext,
  }
}

export { deriveOpportunityKeys }
