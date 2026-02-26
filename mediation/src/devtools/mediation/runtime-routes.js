const RUNTIME_ROUTE_ERROR_STATUS_BY_CODE = Object.freeze({
  PLACEMENT_NOT_FOUND: 404,
  PLACEMENT_ID_RENAMED: 400,
})

function toRuntimeRouteError(error, options = {}) {
  const fallbackCode = String(options.defaultCode || 'INVALID_REQUEST').trim() || 'INVALID_REQUEST'
  const fallbackStatus = Number.isInteger(options.defaultStatus) ? options.defaultStatus : 400
  const fallbackMessage = String(options.defaultMessage || 'Invalid request').trim() || 'Invalid request'
  const code = String(error?.code || '').trim() || fallbackCode
  const requestedStatus = Number(error?.statusCode ?? error?.status)
  const status = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus < 600
    ? requestedStatus
    : (RUNTIME_ROUTE_ERROR_STATUS_BY_CODE[code] || fallbackStatus)

  const payload = {
    code,
    message: error instanceof Error ? error.message : fallbackMessage,
  }

  const replacementPlacementId = String(
    error?.replacementPlacementId
    || error?.details?.replacementPlacementId
    || '',
  ).trim()
  if (replacementPlacementId) {
    payload.replacementPlacementId = replacementPlacementId
  }

  const placementId = String(error?.placementId || error?.details?.placementId || '').trim()
  if (placementId && code === 'PLACEMENT_ID_RENAMED') {
    payload.placementId = placementId
  }

  const field = String(error?.fieldName || error?.details?.fieldName || '').trim()
  if (field && code === 'PLACEMENT_ID_RENAMED') {
    payload.field = field
  }

  return {
    status,
    error: payload,
  }
}

export async function handleRuntimeRoutes(context, deps) {
  const { req, res, pathname, requestUrl } = context
  const {
    state,
    sendJson,
    withCors,
    assertPlacementIdNotRenamed,
    authorizeRuntimeCredential,
    applyRuntimeCredentialScope,
    resolveMediationConfigSnapshot,
    requiredNonEmptyString,
    getPlacementsForApp,
    resolveAccountIdForApp,
    readJsonBody,
    normalizeIntentCardRetrievePayload,
    createIntentCardVectorIndex,
    retrieveIntentCardTopK,
    createId,
    normalizeV2BidPayload,
    DEFAULT_CONTROL_PLANE_APP_ID,
    normalizeControlPlaneAccountId,
    evaluateV2BidRequest,
    nowIso,
    createOpportunityChainWriter,
    isPostbackConversionPayload,
    normalizePostbackConversionPayload,
    normalizePlacementIdWithMigration,
    findPlacementIdByRequestId,
    PLACEMENT_ID_FROM_ANSWER,
    recordConversionFact,
    findPricingSnapshotByRequestId,
    recordEvent,
    isNextStepIntentCardPayload,
    normalizeNextStepIntentCardPayload,
    clampNumber,
    normalizeNextStepPreferenceFacets,
    PLACEMENT_ID_INTENT_RECOMMENDATION,
    recordClickCounters,
    normalizeAttachMvpPayload,
    ATTACH_MVP_EVENT,
    ATTACH_MVP_PLACEMENT_KEY,
    persistState,
    round,
  } = deps

  const isRuntimeRouteRequest = (
    (pathname === '/api/v1/mediation/config' && req.method === 'GET')
    || (pathname === '/api/v1/sdk/config' && req.method === 'GET')
    || (pathname === '/api/v1/intent-card/retrieve' && req.method === 'POST')
    || (pathname === '/api/v2/bid' && req.method === 'POST')
    || (pathname === '/api/v1/sdk/events' && req.method === 'POST')
  )

  if (!isRuntimeRouteRequest) {
    return false
  }

  await (async () => {
    if (pathname === '/api/v1/mediation/config' && req.method === 'GET') {
      try {
        const requestedPlacementId = assertPlacementIdNotRenamed(
          String(requestUrl.searchParams.get('placementId') || '').trim(),
          'placementId',
        )
        const auth = await authorizeRuntimeCredential(req, {
          operation: 'mediation_config_read',
          requiredScope: 'mediationConfigRead',
          placementId: requestedPlacementId,
        })
        if (!auth.ok) {
          sendJson(res, auth.status, {
            error: auth.error,
          })
          return
        }
  
        const runtimeScope = applyRuntimeCredentialScope({
          appId: String(requestUrl.searchParams.get('appId') || '').trim(),
          environment: String(requestUrl.searchParams.get('environment') || '').trim(),
        }, auth, { applyEnvironment: true })
  
        const resolved = resolveMediationConfigSnapshot({
          appId: runtimeScope.appId,
          placementId: requestedPlacementId,
          environment: runtimeScope.environment || requestUrl.searchParams.get('environment'),
          schemaVersion: requestUrl.searchParams.get('schemaVersion'),
          sdkVersion: requestUrl.searchParams.get('sdkVersion'),
          requestAt: requestUrl.searchParams.get('requestAt'),
          ifNoneMatch: requestUrl.searchParams.get('ifNoneMatch'),
        })
  
        if (resolved.statusCode === 304) {
          withCors(res)
          res.statusCode = 304
          res.setHeader('ETag', resolved.etag)
          res.end()
          return
        }
  
        res.setHeader('ETag', resolved.etag)
        sendJson(res, 200, resolved.payload)
        return
      } catch (error) {
        const mapped = toRuntimeRouteError(error)
        sendJson(res, mapped.status, { error: mapped.error })
        return
      }
    }

    if (pathname === '/api/v1/sdk/config' && req.method === 'GET') {
      try {
        const appId = requiredNonEmptyString(requestUrl.searchParams.get('appId'), 'appId')
        const placements = getPlacementsForApp(appId, resolveAccountIdForApp(appId), {
          createIfMissing: false,
          clone: true,
        })
        if (!Array.isArray(placements) || placements.length === 0) {
          sendJson(res, 404, {
            error: {
              code: 'PLACEMENT_CONFIG_NOT_FOUND',
              message: `placement config not found for appId ${appId}.`,
            },
          })
          return
        }
        sendJson(res, 200, {
          appId,
          accountId: resolveAccountIdForApp(appId),
          placements,
        })
        return
      } catch (error) {
        const mapped = toRuntimeRouteError(error)
        sendJson(res, mapped.status, { error: mapped.error })
        return
      }
    }
  
    if (pathname === '/api/v1/intent-card/retrieve' && req.method === 'POST') {
      try {
        const payload = await readJsonBody(req)
        const request = normalizeIntentCardRetrievePayload(payload, 'intent-card/retrieve')
        const startedAt = Date.now()
        const vectorIndex = createIntentCardVectorIndex(request.catalog)
        const retrieval = retrieveIntentCardTopK(vectorIndex, {
          query: request.query,
          facets: request.facets.map((facet) => ({
            facet_key: facet.facetKey,
            facet_value: facet.facetValue,
            confidence: Number.isFinite(facet.confidence) ? facet.confidence : undefined,
          })),
          topK: request.topK,
          minScore: request.minScore,
        })
  
        sendJson(res, 200, {
          requestId: createId('intent_retr'),
          items: retrieval.items,
          meta: {
            retrieval_ms: Date.now() - startedAt,
            index_item_count: vectorIndex.items.length,
            index_vocabulary_size: vectorIndex.vocabularySize,
            candidate_count: retrieval.meta.candidateCount,
            top_k: retrieval.meta.topK,
            min_score: retrieval.meta.minScore,
            index_version: retrieval.meta.indexVersion,
          },
        })
        return
      } catch (error) {
        const mapped = toRuntimeRouteError(error)
        sendJson(res, mapped.status, { error: mapped.error })
        return
      }
    }

    if (pathname === '/api/v2/bid' && req.method === 'POST') {
      try {
        const payload = await readJsonBody(req)
        const request = normalizeV2BidPayload(payload, 'v2/bid')
        const auth = await authorizeRuntimeCredential(req, {
          operation: 'v2_bid',
          requiredScope: 'sdkEvaluate',
          placementId: request.placementId,
        })
        if (!auth.ok) {
          sendJson(res, auth.status, {
            error: auth.error,
          })
          return
        }
  
        const scopedRequest = auth.mode === 'anonymous'
          ? {
              appId: DEFAULT_CONTROL_PLANE_APP_ID,
              accountId: normalizeControlPlaneAccountId(resolveAccountIdForApp(DEFAULT_CONTROL_PLANE_APP_ID), ''),
              placementId: request.placementId,
            }
          : applyRuntimeCredentialScope({
              appId: DEFAULT_CONTROL_PLANE_APP_ID,
              accountId: '',
              placementId: request.placementId,
            }, auth)
  
        const result = await evaluateV2BidRequest({
          ...request,
          appId: scopedRequest.appId,
          accountId: scopedRequest.accountId,
          placementId: scopedRequest.placementId || request.placementId,
        })
  
        sendJson(res, 200, {
          requestId: String(result.requestId || ''),
          timestamp: String(result.timestamp || nowIso()),
          status: 'success',
          message: String(result.message || 'No bid'),
          opportunityId: String(result.opportunityId || ''),
          intent: result?.intent && typeof result.intent === 'object'
            ? result.intent
            : undefined,
          decisionTrace: result?.decisionTrace && typeof result.decisionTrace === 'object'
            ? result.decisionTrace
            : undefined,
          diagnostics: result?.diagnostics && typeof result.diagnostics === 'object'
            ? result.diagnostics
            : undefined,
          data: {
            bid: result?.data?.bid || null,
          },
        })
        return
      } catch (error) {
        const mapped = toRuntimeRouteError(error)
        sendJson(res, mapped.status, { error: mapped.error })
        return
      }
    }
  
    if (pathname === '/api/v1/sdk/events' && req.method === 'POST') {
      try {
        const payload = await readJsonBody(req)
        const opportunityWriter = createOpportunityChainWriter()
        let responsePayload = { ok: true }
        if (isPostbackConversionPayload(payload)) {
          const request = normalizePostbackConversionPayload(payload, 'sdk/events')
          const auth = await authorizeRuntimeCredential(req, {
            operation: 'sdk_events',
            requiredScope: 'sdkEvents',
            placementId: normalizePlacementIdWithMigration(
              request.placementId || (await findPlacementIdByRequestId(request.requestId)),
              PLACEMENT_ID_FROM_ANSWER,
            ),
          })
          if (!auth.ok) {
            sendJson(res, auth.status, {
              error: auth.error,
            })
            return
          }
          applyRuntimeCredentialScope(request, auth)
  
          const { duplicate, fact } = await recordConversionFact(request)
          const pricingSnapshot = findPricingSnapshotByRequestId(request.requestId)
          await recordEvent({
            eventType: request.eventType,
            event: 'postback',
            kind: request.postbackType,
            requestId: request.requestId,
            appId: request.appId,
            accountId: request.accountId,
            sessionId: request.sessionId,
            turnId: request.turnId,
            userId: request.userId,
            adId: request.adId,
            placementId: fact.placementId,
            placementKey: fact.placementKey,
            postbackType: request.postbackType,
            postbackStatus: request.postbackStatus,
            conversionId: request.conversionId,
            eventSeq: request.eventSeq,
            cpaUsd: request.cpaUsd,
            currency: request.currency,
            occurredAt: request.occurredAt,
            factId: fact.factId,
            idempotencyKey: fact.idempotencyKey,
            revenueUsd: fact.revenueUsd,
            duplicate,
            pricingSnapshot,
          })
          await opportunityWriter.writeEventRecord({
            requestId: request.requestId,
            appId: request.appId,
            placementId: fact.placementId,
            eventType: 'postback',
            eventLayer: 'attribution',
            eventStatus: request.postbackStatus,
            kind: request.postbackType,
            occurredAt: request.occurredAt,
            eventSeq: request.eventSeq,
            conversionId: request.conversionId,
            postbackStatus: request.postbackStatus,
            payload: {
              factId: fact.factId,
              revenueUsd: fact.revenueUsd,
              duplicate,
              cpaUsd: request.cpaUsd,
              currency: request.currency,
              pricingSnapshot,
            },
          })
  
          responsePayload = {
            ok: true,
            duplicate,
            factId: fact.factId,
            revenueUsd: round(fact.revenueUsd, 2),
          }
        } else if (isNextStepIntentCardPayload(payload)) {
          const request = normalizeNextStepIntentCardPayload(payload, 'sdk/events')
          const auth = await authorizeRuntimeCredential(req, {
            operation: 'sdk_events',
            requiredScope: 'sdkEvents',
            placementId: request.placementId,
          })
          if (!auth.ok) {
            sendJson(res, auth.status, {
              error: auth.error,
            })
            return
          }
          applyRuntimeCredentialScope(request, auth)
          const pricingSnapshot = findPricingSnapshotByRequestId(request.requestId)
  
          const inferredIntentClass = String(request.context.intentHints?.intent_class || '').trim().toLowerCase()
          const inferredIntentScore = clampNumber(request.context.intentHints?.intent_score, 0, 1, NaN)
          const inferredPreferenceFacets = normalizeNextStepPreferenceFacets(
            request.context.intentHints?.preference_facets,
          )
          const normalizedPlacementId = normalizePlacementIdWithMigration(
            request.placementId,
            PLACEMENT_ID_INTENT_RECOMMENDATION,
          )
          if (request.kind === 'click') {
            recordClickCounters(normalizedPlacementId)
          }
  
          await recordEvent({
            eventType: 'sdk_event',
            requestId: request.requestId || '',
            appId: request.appId,
            accountId: request.accountId,
            sessionId: request.sessionId,
            turnId: request.turnId,
            userId: request.userId,
            query: request.context.query,
            answerText: request.context.answerText,
            intentClass: inferredIntentClass || '',
            intentScore: Number.isFinite(inferredIntentScore) ? inferredIntentScore : 0,
            preferenceFacets: inferredPreferenceFacets,
            locale: request.context.locale,
            event: request.kind === 'impression' ? request.event : request.kind,
            kind: request.kind,
            adId: request.adId || '',
            placementId: normalizedPlacementId,
            placementKey: request.placementKey,
            pricingSnapshot,
          })
          await opportunityWriter.writeEventRecord({
            requestId: request.requestId || '',
            appId: request.appId,
            placementId: normalizedPlacementId,
            eventType: 'sdk_event',
            eventLayer: 'sdk',
            eventStatus: 'recorded',
            kind: request.kind,
            event: request.event,
            occurredAt: nowIso(),
            payload: {
              placementKey: request.placementKey,
              intentClass: inferredIntentClass || '',
              intentScore: Number.isFinite(inferredIntentScore) ? inferredIntentScore : 0,
              pricingSnapshot,
            },
          })
        } else {
          const request = normalizeAttachMvpPayload(payload, 'sdk/events')
          const auth = await authorizeRuntimeCredential(req, {
            operation: 'sdk_events',
            requiredScope: 'sdkEvents',
            placementId: normalizePlacementIdWithMigration(request.placementId, PLACEMENT_ID_FROM_ANSWER),
          })
          if (!auth.ok) {
            sendJson(res, auth.status, {
              error: auth.error,
            })
            return
          }
          applyRuntimeCredentialScope(request, auth)
          const pricingSnapshot = findPricingSnapshotByRequestId(request.requestId)
  
          if (request.kind === 'click') {
            recordClickCounters(request.placementId || PLACEMENT_ID_FROM_ANSWER)
          }
  
          await recordEvent({
            eventType: 'sdk_event',
            requestId: request.requestId || '',
            appId: request.appId,
            accountId: request.accountId,
            sessionId: request.sessionId,
            turnId: request.turnId,
            query: request.query,
            answerText: request.answerText,
            intentScore: request.intentScore,
            locale: request.locale,
            event: request.kind === 'click' ? 'click' : ATTACH_MVP_EVENT,
            kind: request.kind,
            adId: request.adId || '',
            placementId: normalizePlacementIdWithMigration(request.placementId, PLACEMENT_ID_FROM_ANSWER),
            placementKey: ATTACH_MVP_PLACEMENT_KEY,
            pricingSnapshot,
          })
          await opportunityWriter.writeEventRecord({
            requestId: request.requestId || '',
            appId: request.appId,
            placementId: normalizePlacementIdWithMigration(request.placementId, PLACEMENT_ID_FROM_ANSWER),
            eventType: 'sdk_event',
            eventLayer: 'sdk',
            eventStatus: 'recorded',
            kind: request.kind,
            event: request.kind === 'click' ? 'click' : ATTACH_MVP_EVENT,
            occurredAt: nowIso(),
            payload: {
              intentScore: request.intentScore,
              locale: request.locale,
              adId: request.adId || '',
              pricingSnapshot,
            },
          })
        }
  
        persistState(state)
  
        sendJson(res, 200, responsePayload)
        return
      } catch (error) {
        const mapped = toRuntimeRouteError(error)
        sendJson(res, mapped.status, { error: mapped.error })
        return
      }
    }
  })()

  return true
}
