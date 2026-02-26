export async function handleControlPlaneRoutes(context, deps) {
  const { req, res, pathname, requestUrl } = context
  const {
    state,
    settlementStore,
    STRICT_MANUAL_INTEGRATION,
    MAX_DASHBOARD_USERS,
    MAX_INTEGRATION_TOKENS,
    MAX_AGENT_ACCESS_TOKENS,
    MIN_AGENT_ACCESS_TTL_SECONDS,
    MAX_AGENT_ACCESS_TTL_SECONDS,
    CONTROL_PLANE_ENVIRONMENTS,
    CONTROL_PLANE_KEY_STATUS,
    DEFAULT_CONTROL_PLANE_APP_ID,
    PLACEMENT_ID_FROM_ANSWER,
    sendJson,
    readJsonBody,
    isSupabaseSettlementStore,
    loadControlPlaneStateFromSupabase,
    nowIso,
    buildQuickStartVerifyRequest,
    findActiveApiKey,
    resolveMediationConfigSnapshot,
    evaluateV2BidRequest,
    recordAttachSdkEvent,
    persistState,
    clampNumber,
    queryControlPlaneAudits,
    normalizeDashboardRegisterPayload,
    findDashboardUserByEmail,
    validateDashboardRegisterOwnership,
    findLatestAppForAccount,
    ensureControlPlaneAppAndEnvironment,
    appBelongsToAccountReadThrough,
    ensureBootstrapApiKeyForScope,
    resolveAuditActor,
    createDashboardUserRecord,
    upsertDashboardUserToSupabase,
    upsertControlPlaneStateRecord,
    issueDashboardSession,
    toPublicDashboardUserRecord,
    toPublicDashboardSessionRecord,
    normalizeDashboardLoginPayload,
    verifyPasswordRecord,
    authorizeDashboardScope,
    resolveDashboardSession,
    revokeDashboardSessionByToken,
    resolveAuthorizedDashboardAccount,
    validateDashboardAccountOwnership,
    validateDashboardAppOwnership,
    toPositiveInteger,
    normalizePlacementIdWithMigration,
    cleanupExpiredIntegrationTokens,
    createIntegrationTokenRecord,
    upsertIntegrationTokenToSupabase,
    recordControlPlaneAudit,
    toPublicIntegrationTokenRecord,
    cleanupExpiredAgentAccessTokens,
    getExchangeForbiddenFields,
    findIntegrationTokenByPlaintext,
    recordSecurityDenyAudit,
    tokenFingerprint,
    requiredNonEmptyString,
    hasRequiredAgentScope,
    createMinimalAgentScope,
    createAgentAccessTokenRecord,
    resolveAccountIdForApp,
    upsertAgentAccessTokenToSupabase,
    toPublicAgentAccessTokenRecord,
    normalizeControlPlaneAccountId,
    toPublicApiKeyRecord,
    createControlPlaneKeyRecord,
    upsertControlPlaneKeyToSupabase,
    getDashboardStatePayload,
    scopeHasFilters,
    getScopedApps,
    resolvePlacementScopeAppId,
    getPlacementConfigForApp,
    normalizePlacement,
    assertPlacementIdNotRenamed,
    resolvePlacementKeyById,
    buildPlacementFromPatch,
    syncLegacyPlacementSnapshot,
    recordPlacementAudit,
    applyPlacementPatch,
    listDecisionLogs,
    listEventLogs,
    recordMatchesScope,
    filterRowsByScope,
    getAllNetworkHealth,
    summarizeNetworkHealthMap,
    computeScopedNetworkFlowStats,
    isPostgresSettlementStore,
    getInventoryStatus,
    syncInventoryNetworks,
    buildInventoryEmbeddings,
    materializeServingSnapshot,
    listAllowedCorsOriginsFromSupabase,
    replaceAllowedCorsOriginsInSupabase,
    refreshAllowedCorsOriginsFromSupabase,
    normalizeAllowedCorsOriginsPayload,
    getAllowedCorsOrigins,
  } = deps

  const isControlPlaneRouteRequest = (
    (pathname === '/api/v1/public/quick-start/verify' && req.method === 'POST')
    || (pathname === '/api/v1/public/audit/logs' && req.method === 'GET')
    || (pathname === '/api/v1/public/dashboard/register' && req.method === 'POST')
    || (pathname === '/api/v1/public/dashboard/login' && req.method === 'POST')
    || (pathname === '/api/v1/public/dashboard/me' && req.method === 'GET')
    || (pathname === '/api/v1/public/dashboard/logout' && req.method === 'POST')
    || (pathname === '/api/v1/public/agent/integration-token' && req.method === 'POST')
    || (pathname === '/api/v1/public/agent/token-exchange' && req.method === 'POST')
    || (pathname === '/api/v1/public/credentials/keys' && req.method === 'GET')
    || (pathname === '/api/v1/public/credentials/keys' && req.method === 'POST')
    || (pathname.match(/^\/api\/v1\/public\/credentials\/keys\/([^/]+)\/rotate$/) && req.method === 'POST')
    || (pathname.match(/^\/api\/v1\/public\/credentials\/keys\/([^/]+)\/revoke$/) && req.method === 'POST')
    || (pathname === '/api/v1/dashboard/state' && req.method === 'GET')
    || (pathname === '/api/v1/dashboard/security/origins' && req.method === 'GET')
    || (pathname === '/api/v1/dashboard/security/origins' && req.method === 'PUT')
    || (pathname === '/api/v1/dashboard/placements' && req.method === 'GET')
    || (pathname === '/api/v1/dashboard/placements' && req.method === 'POST')
    || (pathname.startsWith('/api/v1/dashboard/placements/') && req.method === 'PUT')
    || (pathname === '/api/v1/dashboard/metrics/summary' && req.method === 'GET')
    || (pathname === '/api/v1/dashboard/metrics/by-day' && req.method === 'GET')
    || (pathname === '/api/v1/dashboard/metrics/by-placement' && req.method === 'GET')
    || (pathname === '/api/v1/dashboard/usage-revenue' && req.method === 'GET')
    || (pathname === '/api/v1/dashboard/decisions' && req.method === 'GET')
    || (pathname === '/api/v1/dashboard/events' && req.method === 'GET')
    || (pathname === '/api/v1/dashboard/audit/logs' && req.method === 'GET')
    || (pathname === '/api/v1/dashboard/placement-audits' && req.method === 'GET')
    || (pathname === '/api/v1/dashboard/network-health' && req.method === 'GET')
    || (pathname === '/api/v1/internal/inventory/status' && req.method === 'GET')
    || (pathname === '/api/v1/internal/inventory/sync' && req.method === 'POST')
  )

  if (!isControlPlaneRouteRequest) {
    return false
  }

  await (async () => {
    if (pathname === '/api/v1/public/quick-start/verify' && req.method === 'POST') {
      try {
        const payload = await readJsonBody(req)
        const request = buildQuickStartVerifyRequest(payload)
        const activeKey = await findActiveApiKey({
          appId: request.appId,
          accountId: request.accountId,
          environment: request.environment,
        })
  
        if (!activeKey) {
          sendJson(res, 409, {
            error: {
              code: 'PRECONDITION_FAILED',
              message: `No active API key for appId=${request.appId} environment=${request.environment}.`,
            },
          })
          return
        }
  
        const configStartedAt = Date.now()
        const configResult = resolveMediationConfigSnapshot({
          appId: request.appId,
          placementId: request.placementId,
          environment: request.environment,
          schemaVersion: 'schema_v1',
          sdkVersion: '1.0.0',
          requestAt: nowIso(),
        })
        const configLatencyMs = Math.max(0, Date.now() - configStartedAt)
  
        const bidStartedAt = Date.now()
        const bidResult = await evaluateV2BidRequest({
          appId: request.appId,
          accountId: request.accountId,
          userId: request.sessionId,
          chatId: request.sessionId,
          placementId: request.placementId,
          messages: [
            { role: 'user', content: request.query },
            { role: 'assistant', content: request.answerText },
          ],
        })
        const bidLatencyMs = Math.max(0, Date.now() - bidStartedAt)
        const winnerBid = bidResult?.data?.bid && typeof bidResult.data.bid === 'object'
          ? bidResult.data.bid
          : null
        const requestId = String(bidResult?.requestId || '').trim()
        const status = winnerBid ? 'served' : 'no_fill'
        const statusReason = winnerBid ? 'runtime_eligible' : 'runtime_no_bid'
  
        const eventStartedAt = Date.now()
        await recordAttachSdkEvent({
          requestId,
          appId: request.appId,
          accountId: request.accountId,
          sessionId: request.sessionId,
          turnId: request.turnId,
          query: request.query,
          answerText: request.answerText,
          intentScore: request.intentScore,
          locale: request.locale,
        })
        persistState(state)
        const eventLatencyMs = Math.max(0, Date.now() - eventStartedAt)
  
        sendJson(res, 200, {
          ok: true,
          requestId,
          status,
          evidence: {
            config: {
              status: configResult.statusCode,
              placementId: request.placementId,
              configVersion: configResult.payload?.configVersion || 0,
              latencyMs: configLatencyMs,
            },
            bid: {
              status: 200,
              requestId,
              message: String(bidResult?.message || ''),
              hasBid: Boolean(winnerBid),
              bidId: winnerBid ? String(winnerBid.bidId || '') : '',
              dsp: winnerBid ? String(winnerBid.dsp || '') : '',
              price: winnerBid ? clampNumber(winnerBid.price, 0, Number.MAX_SAFE_INTEGER, 0) : 0,
              latencyMs: bidLatencyMs,
            },
            evaluate: {
              status: 200,
              requestId,
              result: status,
              reasonDetail: statusReason,
              latencyMs: bidLatencyMs,
            },
            events: {
              status: 200,
              ok: true,
              latencyMs: eventLatencyMs,
            },
          },
        })
        return
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid request'
        sendJson(res, 400, {
          error: {
            code: 'QUICKSTART_INVALID_PAYLOAD',
            message,
            route: '/api/v1/public/quick-start/verify',
          },
        })
        return
      }
    }
  
    if (pathname === '/api/v1/public/audit/logs' && req.method === 'GET') {
      sendJson(res, 200, {
        items: queryControlPlaneAudits(requestUrl.searchParams),
      })
      return
    }
  
    if (pathname === '/api/v1/public/dashboard/register' && req.method === 'POST') {
      try {
        const payload = await readJsonBody(req)
        const request = normalizeDashboardRegisterPayload(payload, 'public/dashboard/register')
        const existing = findDashboardUserByEmail(request.email)
        if (existing) {
          sendJson(res, 409, {
            error: {
              code: 'DASHBOARD_USER_EXISTS',
              message: `dashboard user already exists for email ${request.email}.`,
            },
          })
          return
        }
        const ownership = await validateDashboardRegisterOwnership(req, request.accountId)
        if (!ownership.ok) {
          sendJson(res, ownership.status, { error: ownership.error })
          return
        }
  
        let appId = String(request.appId || '').trim()
        if (!appId) {
          const accountApp = findLatestAppForAccount(request.accountId)
          appId = String(accountApp?.appId || '').trim()
        }
        if (!appId) {
          const generated = request.accountId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 42) || 'customer'
          appId = `${generated}_app`
        }
        const ensured = await ensureControlPlaneAppAndEnvironment(appId, 'prod', request.accountId)
        if (!(await appBelongsToAccountReadThrough(ensured.appId, request.accountId))) {
          sendJson(res, 403, {
            error: {
              code: 'DASHBOARD_SCOPE_VIOLATION',
              message: `appId ${ensured.appId} does not belong to accountId ${request.accountId}.`,
            },
          })
          return
        }
        if (!STRICT_MANUAL_INTEGRATION) {
          await ensureBootstrapApiKeyForScope({
            appId: ensured.appId,
            accountId: ensured.accountId,
            environment: 'prod',
            actor: resolveAuditActor(req, 'bootstrap'),
          })
        }
  
        const userRecord = createDashboardUserRecord({
          email: request.email,
          password: request.password,
          displayName: request.displayName,
          accountId: request.accountId,
          appId: ensured.appId,
        })
  
        if (isSupabaseSettlementStore()) {
          await upsertDashboardUserToSupabase(userRecord)
        }
        upsertControlPlaneStateRecord('dashboardUsers', 'userId', userRecord, MAX_DASHBOARD_USERS)
  
        const { sessionRecord, accessToken } = await issueDashboardSession(userRecord, {
          metadata: { source: 'register' },
        })
        const loggedInUserRecord = {
          ...userRecord,
          lastLoginAt: sessionRecord.issuedAt,
          updatedAt: sessionRecord.issuedAt,
        }
        if (isSupabaseSettlementStore()) {
          await upsertDashboardUserToSupabase(loggedInUserRecord)
        }
        Object.assign(userRecord, loggedInUserRecord)
        upsertControlPlaneStateRecord('dashboardUsers', 'userId', userRecord, MAX_DASHBOARD_USERS)
        persistState(state)
  
        sendJson(res, 201, {
          user: toPublicDashboardUserRecord(userRecord),
          session: toPublicDashboardSessionRecord(sessionRecord, accessToken),
        })
        return
      } catch (error) {
        if (error && typeof error === 'object' && error.code === '23505') {
          sendJson(res, 409, {
            error: {
              code: 'DASHBOARD_USER_EXISTS',
              message: 'dashboard user already exists for this account.',
            },
          })
          return
        }
        sendJson(res, 400, {
          error: {
            code: 'INVALID_REQUEST',
            message: error instanceof Error ? error.message : 'Invalid request',
          },
        })
        return
      }
    }
  
    if (pathname === '/api/v1/public/dashboard/login' && req.method === 'POST') {
      try {
        const payload = await readJsonBody(req)
        const request = normalizeDashboardLoginPayload(payload, 'public/dashboard/login')
        const user = findDashboardUserByEmail(request.email)
        if (!user) {
          sendJson(res, 401, {
            error: {
              code: 'DASHBOARD_LOGIN_FAILED',
              message: 'email or password is incorrect.',
            },
          })
          return
        }
        if (String(user.status || '').toLowerCase() !== 'active') {
          sendJson(res, 403, {
            error: {
              code: 'DASHBOARD_USER_DISABLED',
              message: 'dashboard user is disabled.',
            },
          })
          return
        }
        if (!verifyPasswordRecord(request.password, user)) {
          sendJson(res, 401, {
            error: {
              code: 'DASHBOARD_LOGIN_FAILED',
              message: 'email or password is incorrect.',
            },
          })
          return
        }
  
        const { sessionRecord, accessToken } = await issueDashboardSession(user, {
          metadata: { source: 'login' },
        })
        const loggedInUser = {
          ...user,
          lastLoginAt: sessionRecord.issuedAt,
          updatedAt: sessionRecord.issuedAt,
        }
        if (isSupabaseSettlementStore()) {
          await upsertDashboardUserToSupabase(loggedInUser)
        }
        Object.assign(user, loggedInUser)
        upsertControlPlaneStateRecord('dashboardUsers', 'userId', user, MAX_DASHBOARD_USERS)
        persistState(state)
  
        sendJson(res, 200, {
          user: toPublicDashboardUserRecord(user),
          session: toPublicDashboardSessionRecord(sessionRecord, accessToken),
        })
        return
      } catch (error) {
        sendJson(res, 400, {
          error: {
            code: 'INVALID_REQUEST',
            message: error instanceof Error ? error.message : 'Invalid request',
          },
        })
        return
      }
    }
  
    if (pathname === '/api/v1/public/dashboard/me' && req.method === 'GET') {
      const auth = await authorizeDashboardScope(req, requestUrl.searchParams, { requireAuth: true })
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error })
        return
      }
      sendJson(res, 200, {
        user: toPublicDashboardUserRecord(auth.user),
        session: toPublicDashboardSessionRecord(auth.session),
        scope: auth.scope,
      })
      return
    }
  
    if (pathname === '/api/v1/public/dashboard/logout' && req.method === 'POST') {
      const resolved = await resolveDashboardSession(req)
      if (resolved.kind === 'none') {
        sendJson(res, 401, {
          error: {
            code: 'DASHBOARD_AUTH_REQUIRED',
            message: 'Dashboard authentication is required.',
          },
        })
        return
      }
      if (resolved.kind === 'invalid') {
        sendJson(res, resolved.status, {
          error: {
            code: resolved.code,
            message: resolved.message,
          },
        })
        return
      }
  
      await revokeDashboardSessionByToken(resolved.accessToken)
      persistState(state)
      sendJson(res, 200, { ok: true })
      return
    }
  
    if (pathname === '/api/v1/public/agent/integration-token' && req.method === 'POST') {
      try {
        const auth = await authorizeDashboardScope(req, requestUrl.searchParams, { requireAuth: true })
        if (!auth.ok) {
          sendJson(res, auth.status, { error: auth.error })
          return
        }
        const scopedAccountId = resolveAuthorizedDashboardAccount(auth)
        if (!scopedAccountId) {
          sendJson(res, 403, {
            error: {
              code: 'DASHBOARD_SCOPE_VIOLATION',
              message: 'Dashboard account scope is missing.',
            },
          })
          return
        }
  
        const payload = await readJsonBody(req)
        let appId = String(payload?.appId || payload?.app_id || '').trim()
        const accountOwnership = validateDashboardAccountOwnership(
          payload?.accountId || payload?.account_id || '',
          scopedAccountId,
        )
        if (!accountOwnership.ok) {
          sendJson(res, accountOwnership.status, { error: accountOwnership.error })
          return
        }
        const appOwnership = await validateDashboardAppOwnership(appId, scopedAccountId)
        if (!appOwnership.ok) {
          sendJson(res, appOwnership.status, { error: appOwnership.error })
          return
        }
        if (!appId) {
          appId = String(auth.user?.appId || '').trim()
            || String(findLatestAppForAccount(scopedAccountId)?.appId || '').trim()
        }
        if (!appId) {
          const generated = scopedAccountId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 42) || 'customer'
          appId = `${generated}_app`
        }
  
        const requestedEnvironment = String(payload?.environment || payload?.env || '').trim().toLowerCase()
        const environment = requestedEnvironment || 'prod'
        if (!CONTROL_PLANE_ENVIRONMENTS.has(environment)) {
          throw new Error(`environment must be one of: ${Array.from(CONTROL_PLANE_ENVIRONMENTS).join(', ')}`)
        }
  
        const ttlMinutes = toPositiveInteger(payload?.ttlMinutes ?? payload?.ttl_minutes, 10)
        if (ttlMinutes < 10 || ttlMinutes > 15) {
          throw new Error('ttlMinutes must be between 10 and 15.')
        }
  
        const placementId = normalizePlacementIdWithMigration(
          String(payload?.placementId || payload?.placement_id || '').trim(),
          PLACEMENT_ID_FROM_ANSWER,
        )
        const ensured = await ensureControlPlaneAppAndEnvironment(appId, environment, scopedAccountId)
        let activeKey = await findActiveApiKey({
          appId: ensured.appId,
          accountId: ensured.accountId,
          environment: ensured.environment,
        })
        if (!activeKey) {
          sendJson(res, 409, {
            error: {
              code: 'PRECONDITION_FAILED',
              message: `No active API key for appId=${ensured.appId} environment=${ensured.environment}.`,
            },
          })
          return
        }
  
        cleanupExpiredIntegrationTokens()
  
        const { tokenRecord, token } = createIntegrationTokenRecord({
          appId: ensured.appId,
          accountId: ensured.accountId,
          environment: ensured.environment,
          placementId,
          ttlMinutes,
          metadata: {
            issuedFor: 'agent_onboarding',
          },
        })
  
        if (isSupabaseSettlementStore()) {
          await upsertIntegrationTokenToSupabase(tokenRecord)
        }
        upsertControlPlaneStateRecord('integrationTokens', 'tokenId', tokenRecord, MAX_INTEGRATION_TOKENS)
  
        recordControlPlaneAudit({
          action: 'integration_token_issue',
          actor: resolveAuditActor(req, 'dashboard'),
          accountId: tokenRecord.accountId,
          appId: tokenRecord.appId,
          environment: tokenRecord.environment,
          resourceType: 'integration_token',
          resourceId: tokenRecord.tokenId,
          metadata: {
            placementId: tokenRecord.placementId,
            ttlSeconds: ttlMinutes * 60,
          },
        })
        persistState(state)
  
        sendJson(res, 201, toPublicIntegrationTokenRecord(tokenRecord, token))
        return
      } catch (error) {
        sendJson(res, 400, {
          error: {
            code: 'INVALID_REQUEST',
            message: error instanceof Error ? error.message : 'Invalid request',
          },
        })
        return
      }
    }
  
    if (pathname === '/api/v1/public/agent/token-exchange' && req.method === 'POST') {
      try {
        const payload = await readJsonBody(req)
        cleanupExpiredIntegrationTokens()
        cleanupExpiredAgentAccessTokens()
        const forbiddenFields = getExchangeForbiddenFields(payload)
        if (forbiddenFields.length > 0) {
          const providedToken = String(payload?.integrationToken || payload?.integration_token || '').trim()
          const sourceToken = providedToken ? await findIntegrationTokenByPlaintext(providedToken) : null
          recordSecurityDenyAudit({
            req,
            action: 'integration_token_exchange_deny',
            reason: 'privilege_escalation_attempt',
            code: 'TOKEN_EXCHANGE_SCOPE_VIOLATION',
            httpStatus: 403,
            appId: sourceToken?.appId || '',
            environment: sourceToken?.environment || '',
            resourceType: 'integration_token',
            resourceId: sourceToken?.tokenId || '',
            metadata: {
              forbiddenFields,
              tokenFingerprint: providedToken ? tokenFingerprint(providedToken) : '',
            },
          })
          persistState(state)
          sendJson(res, 403, {
            error: {
              code: 'TOKEN_EXCHANGE_SCOPE_VIOLATION',
              message: 'token exchange payload contains forbidden privilege fields.',
            },
          })
          return
        }
  
        const integrationToken = requiredNonEmptyString(
          payload?.integrationToken || payload?.integration_token,
          'integrationToken',
        )
  
        const sourceToken = await findIntegrationTokenByPlaintext(integrationToken)
        if (!sourceToken) {
          recordSecurityDenyAudit({
            req,
            action: 'integration_token_exchange_deny',
            reason: 'invalid_integration_token',
            code: 'INVALID_INTEGRATION_TOKEN',
            httpStatus: 401,
            resourceType: 'integration_token',
            metadata: {
              tokenFingerprint: tokenFingerprint(integrationToken),
            },
          })
          persistState(state)
          sendJson(res, 401, {
            error: {
              code: 'INVALID_INTEGRATION_TOKEN',
              message: 'integration token is invalid.',
            },
          })
          return
        }
  
        const sourceStatus = String(sourceToken.status || '').toLowerCase()
        if (sourceStatus === 'used') {
          recordSecurityDenyAudit({
            req,
            action: 'integration_token_exchange_deny',
            reason: 'integration_token_replay',
            code: 'INTEGRATION_TOKEN_ALREADY_USED',
            httpStatus: 409,
            appId: sourceToken.appId,
            environment: sourceToken.environment,
            resourceType: 'integration_token',
            resourceId: sourceToken.tokenId,
          })
          persistState(state)
          sendJson(res, 409, {
            error: {
              code: 'INTEGRATION_TOKEN_ALREADY_USED',
              message: 'integration token has already been exchanged.',
            },
          })
          return
        }
        if (sourceStatus !== 'active') {
          recordSecurityDenyAudit({
            req,
            action: 'integration_token_exchange_deny',
            reason: 'integration_token_inactive',
            code: 'INTEGRATION_TOKEN_INACTIVE',
            httpStatus: 401,
            appId: sourceToken.appId,
            environment: sourceToken.environment,
            resourceType: 'integration_token',
            resourceId: sourceToken.tokenId,
            metadata: {
              sourceStatus,
            },
          })
          persistState(state)
          sendJson(res, 401, {
            error: {
              code: 'INTEGRATION_TOKEN_INACTIVE',
              message: `integration token is not active (${sourceStatus || 'unknown'}).`,
            },
          })
          return
        }
  
        const now = nowIso()
        const expiresAtMs = Date.parse(String(sourceToken.expiresAt || ''))
        if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
          const expiredSourceToken = {
            ...sourceToken,
            status: 'expired',
            updatedAt: now,
          }
          if (isSupabaseSettlementStore()) {
            await upsertIntegrationTokenToSupabase(expiredSourceToken)
          }
          Object.assign(sourceToken, expiredSourceToken)
          upsertControlPlaneStateRecord('integrationTokens', 'tokenId', sourceToken, MAX_INTEGRATION_TOKENS)
          recordSecurityDenyAudit({
            req,
            action: 'integration_token_exchange_deny',
            reason: 'integration_token_expired',
            code: 'INTEGRATION_TOKEN_EXPIRED',
            httpStatus: 401,
            appId: sourceToken.appId,
            environment: sourceToken.environment,
            resourceType: 'integration_token',
            resourceId: sourceToken.tokenId,
          })
          persistState(state)
          sendJson(res, 401, {
            error: {
              code: 'INTEGRATION_TOKEN_EXPIRED',
              message: 'integration token has expired.',
            },
          })
          return
        }
  
        if (
          sourceToken.tokenType !== 'integration_token'
          || sourceToken.oneTime !== true
          || !hasRequiredAgentScope(sourceToken.scope, 'mediationConfigRead')
          || !hasRequiredAgentScope(sourceToken.scope, 'sdkEvaluate')
          || !hasRequiredAgentScope(sourceToken.scope, 'sdkEvents')
        ) {
          const revokedSourceToken = {
            ...sourceToken,
            status: 'revoked',
            updatedAt: now,
            revokedAt: sourceToken.revokedAt || now,
          }
          if (isSupabaseSettlementStore()) {
            await upsertIntegrationTokenToSupabase(revokedSourceToken)
          }
          Object.assign(sourceToken, revokedSourceToken)
          upsertControlPlaneStateRecord('integrationTokens', 'tokenId', sourceToken, MAX_INTEGRATION_TOKENS)
          recordSecurityDenyAudit({
            req,
            action: 'integration_token_exchange_deny',
            reason: 'source_token_scope_invalid',
            code: 'INTEGRATION_TOKEN_SCOPE_INVALID',
            httpStatus: 403,
            appId: sourceToken.appId,
            environment: sourceToken.environment,
            resourceType: 'integration_token',
            resourceId: sourceToken.tokenId,
          })
          persistState(state)
          sendJson(res, 403, {
            error: {
              code: 'INTEGRATION_TOKEN_SCOPE_INVALID',
              message: 'integration token scope is invalid.',
            },
          })
          return
        }
  
        const replayBySource = state.controlPlane.agentAccessTokens.find((item) => (
          String(item?.sourceTokenId || '') === sourceToken.tokenId
        ))
        if (replayBySource) {
          const usedSourceToken = {
            ...sourceToken,
            status: 'used',
            usedAt: now,
            updatedAt: now,
          }
          if (isSupabaseSettlementStore()) {
            await upsertIntegrationTokenToSupabase(usedSourceToken)
          }
          Object.assign(sourceToken, usedSourceToken)
          upsertControlPlaneStateRecord('integrationTokens', 'tokenId', sourceToken, MAX_INTEGRATION_TOKENS)
          recordSecurityDenyAudit({
            req,
            action: 'integration_token_exchange_deny',
            reason: 'integration_token_replay_by_source',
            code: 'INTEGRATION_TOKEN_ALREADY_USED',
            httpStatus: 409,
            appId: sourceToken.appId,
            environment: sourceToken.environment,
            resourceType: 'integration_token',
            resourceId: sourceToken.tokenId,
            metadata: {
              existingAccessTokenId: String(replayBySource.tokenId || ''),
            },
          })
          persistState(state)
          sendJson(res, 409, {
            error: {
              code: 'INTEGRATION_TOKEN_ALREADY_USED',
              message: 'integration token has already been exchanged.',
            },
          })
          return
        }
  
        const requestedTtl = toPositiveInteger(payload?.ttlSeconds ?? payload?.ttl_seconds, 300)
        if (
          requestedTtl < MIN_AGENT_ACCESS_TTL_SECONDS
          || requestedTtl > MAX_AGENT_ACCESS_TTL_SECONDS
        ) {
          recordSecurityDenyAudit({
            req,
            action: 'integration_token_exchange_deny',
            reason: 'ttl_out_of_range',
            code: 'INVALID_TTL_SECONDS',
            httpStatus: 400,
            appId: sourceToken.appId,
            environment: sourceToken.environment,
            resourceType: 'integration_token',
            resourceId: sourceToken.tokenId,
            metadata: {
              requestedTtlSeconds: requestedTtl,
              minTtlSeconds: MIN_AGENT_ACCESS_TTL_SECONDS,
              maxTtlSeconds: MAX_AGENT_ACCESS_TTL_SECONDS,
            },
          })
          persistState(state)
          sendJson(res, 400, {
            error: {
              code: 'INVALID_TTL_SECONDS',
              message: `ttlSeconds must be between ${MIN_AGENT_ACCESS_TTL_SECONDS} and ${MAX_AGENT_ACCESS_TTL_SECONDS}.`,
            },
          })
          return
        }
  
        const remainingTtlSeconds = Math.floor((expiresAtMs - Date.now()) / 1000)
        if (remainingTtlSeconds < MIN_AGENT_ACCESS_TTL_SECONDS) {
          const expiredSourceToken = {
            ...sourceToken,
            status: 'expired',
            updatedAt: now,
          }
          if (isSupabaseSettlementStore()) {
            await upsertIntegrationTokenToSupabase(expiredSourceToken)
          }
          Object.assign(sourceToken, expiredSourceToken)
          upsertControlPlaneStateRecord('integrationTokens', 'tokenId', sourceToken, MAX_INTEGRATION_TOKENS)
          recordSecurityDenyAudit({
            req,
            action: 'integration_token_exchange_deny',
            reason: 'integration_token_remaining_ttl_too_short',
            code: 'INTEGRATION_TOKEN_EXPIRED',
            httpStatus: 401,
            appId: sourceToken.appId,
            environment: sourceToken.environment,
            resourceType: 'integration_token',
            resourceId: sourceToken.tokenId,
            metadata: {
              remainingTtlSeconds,
            },
          })
          persistState(state)
          sendJson(res, 401, {
            error: {
              code: 'INTEGRATION_TOKEN_EXPIRED',
              message: 'integration token has expired.',
            },
          })
          return
        }
  
        const ttlSeconds = Math.min(requestedTtl, remainingTtlSeconds)
        const minimalScope = createMinimalAgentScope()
  
        const { tokenRecord, accessToken } = createAgentAccessTokenRecord({
          appId: sourceToken.appId,
          accountId: sourceToken.accountId || resolveAccountIdForApp(sourceToken.appId),
          environment: sourceToken.environment,
          placementId: sourceToken.placementId,
          sourceTokenId: sourceToken.tokenId,
          ttlSeconds,
          issuedAt: now,
          scope: minimalScope,
          metadata: {
            exchangedFromTokenType: sourceToken.tokenType,
          },
        })
  
        const usedSourceToken = {
          ...sourceToken,
          status: 'used',
          usedAt: now,
          updatedAt: now,
        }
  
        if (isSupabaseSettlementStore()) {
          await upsertIntegrationTokenToSupabase(usedSourceToken)
          await upsertAgentAccessTokenToSupabase(tokenRecord)
        }
        Object.assign(sourceToken, usedSourceToken)
        upsertControlPlaneStateRecord('integrationTokens', 'tokenId', sourceToken, MAX_INTEGRATION_TOKENS)
        upsertControlPlaneStateRecord('agentAccessTokens', 'tokenId', tokenRecord, MAX_AGENT_ACCESS_TOKENS)
  
        recordControlPlaneAudit({
          action: 'integration_token_exchange',
          actor: resolveAuditActor(req, 'agent_exchange'),
          accountId: tokenRecord.accountId,
          appId: tokenRecord.appId,
          environment: tokenRecord.environment,
          resourceType: 'agent_access_token',
          resourceId: tokenRecord.tokenId,
          metadata: {
            sourceTokenId: sourceToken.tokenId,
            requestedTtlSeconds: requestedTtl,
            ttlSeconds,
            placementId: tokenRecord.placementId,
          },
        })
        persistState(state)
  
        sendJson(res, 201, toPublicAgentAccessTokenRecord(tokenRecord, accessToken))
        return
      } catch (error) {
        sendJson(res, 400, {
          error: {
            code: 'INVALID_REQUEST',
            message: error instanceof Error ? error.message : 'Invalid request',
          },
        })
        return
      }
    }
  
    if (pathname === '/api/v1/public/credentials/keys' && req.method === 'GET') {
      const auth = await authorizeDashboardScope(req, requestUrl.searchParams, { requireAuth: true })
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error })
        return
      }
      const scopedAccountId = resolveAuthorizedDashboardAccount(auth)
      if (!scopedAccountId) {
        sendJson(res, 403, {
          error: {
            code: 'DASHBOARD_SCOPE_VIOLATION',
            message: 'Dashboard account scope is missing.',
          },
        })
        return
      }
  
      const appId = String(requestUrl.searchParams.get('appId') || '').trim()
      const accountId = normalizeControlPlaneAccountId(
        requestUrl.searchParams.get('accountId') || requestUrl.searchParams.get('account_id') || '',
        '',
      )
      const accountOwnership = validateDashboardAccountOwnership(accountId, scopedAccountId)
      if (!accountOwnership.ok) {
        sendJson(res, accountOwnership.status, { error: accountOwnership.error })
        return
      }
      const appOwnership = await validateDashboardAppOwnership(appId, scopedAccountId)
      if (!appOwnership.ok) {
        sendJson(res, appOwnership.status, { error: appOwnership.error })
        return
      }
      const statusQuery = String(requestUrl.searchParams.get('status') || '').trim().toLowerCase()
      const environmentQuery = String(
        requestUrl.searchParams.get('environment') || requestUrl.searchParams.get('env') || '',
      ).trim().toLowerCase()
  
      if (statusQuery && !CONTROL_PLANE_KEY_STATUS.has(statusQuery)) {
        sendJson(res, 400, {
          error: {
            code: 'INVALID_STATUS',
            message: `status must be one of: ${Array.from(CONTROL_PLANE_KEY_STATUS).join(', ')}`,
          },
        })
        return
      }
  
      if (environmentQuery && !CONTROL_PLANE_ENVIRONMENTS.has(environmentQuery)) {
        sendJson(res, 400, {
          error: {
            code: 'INVALID_ENVIRONMENT',
            message: `environment must be one of: ${Array.from(CONTROL_PLANE_ENVIRONMENTS).join(', ')}`,
          },
        })
        return
      }
  
      let keys = [...state.controlPlane.apiKeys]
      keys = keys.filter((row) => (
        normalizeControlPlaneAccountId(row.accountId || resolveAccountIdForApp(row.appId), '') === scopedAccountId
      ))
      if (appId) {
        keys = keys.filter((row) => row.appId === appId)
      }
      if (statusQuery) {
        keys = keys.filter((row) => row.status === statusQuery)
      }
      if (environmentQuery) {
        keys = keys.filter((row) => row.environment === environmentQuery)
      }
  
      keys.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  
      sendJson(res, 200, {
        keys: keys.map((row) => toPublicApiKeyRecord(row)).filter(Boolean),
      })
      return
    }
  
    if (pathname === '/api/v1/public/credentials/keys' && req.method === 'POST') {
      try {
        const auth = await authorizeDashboardScope(req, requestUrl.searchParams, { requireAuth: true })
        if (!auth.ok) {
          sendJson(res, auth.status, { error: auth.error })
          return
        }
        const scopedAccountId = resolveAuthorizedDashboardAccount(auth)
        if (!scopedAccountId) {
          sendJson(res, 403, {
            error: {
              code: 'DASHBOARD_SCOPE_VIOLATION',
              message: 'Dashboard account scope is missing.',
            },
          })
          return
        }
  
        const payload = await readJsonBody(req)
        let appId = String(payload?.appId || payload?.app_id || '').trim()
        const accountOwnership = validateDashboardAccountOwnership(
          payload?.accountId || payload?.account_id || '',
          scopedAccountId,
        )
        if (!accountOwnership.ok) {
          sendJson(res, accountOwnership.status, { error: accountOwnership.error })
          return
        }
        const appOwnership = await validateDashboardAppOwnership(appId, scopedAccountId)
        if (!appOwnership.ok) {
          sendJson(res, appOwnership.status, { error: appOwnership.error })
          return
        }
        if (!appId) {
          appId = String(auth.user?.appId || '').trim()
            || String(findLatestAppForAccount(scopedAccountId)?.appId || '').trim()
        }
        if (!appId) {
          const generated = scopedAccountId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 42) || 'customer'
          appId = `${generated}_app`
        }
        const requestedEnvironment = String(payload?.environment || payload?.env || '').trim().toLowerCase()
        const environment = requestedEnvironment || 'prod'
        if (!CONTROL_PLANE_ENVIRONMENTS.has(environment)) {
          throw new Error(`environment must be one of: ${Array.from(CONTROL_PLANE_ENVIRONMENTS).join(', ')}`)
        }
        const keyName = String(payload?.name || payload?.keyName || payload?.key_name || '').trim()
          || `primary-${environment}`
  
        const ensured = await ensureControlPlaneAppAndEnvironment(appId, environment, scopedAccountId)
        const { keyRecord, secret } = createControlPlaneKeyRecord({
          appId: ensured.appId,
          accountId: ensured.accountId,
          environment: ensured.environment,
          keyName,
        })
  
        if (isSupabaseSettlementStore()) {
          await upsertControlPlaneKeyToSupabase(keyRecord)
        }
        upsertControlPlaneStateRecord('apiKeys', 'keyId', keyRecord)
        recordControlPlaneAudit({
          action: 'key_create',
          actor: resolveAuditActor(req, 'public_api'),
          accountId: keyRecord.accountId,
          appId: keyRecord.appId,
          environment: keyRecord.environment,
          resourceType: 'api_key',
          resourceId: keyRecord.keyId,
          metadata: {
            keyName: keyRecord.keyName,
            status: keyRecord.status,
          },
        })
        persistState(state)
  
        sendJson(res, 201, {
          key: toPublicApiKeyRecord(keyRecord),
          secret,
        })
        return
      } catch (error) {
        sendJson(res, 400, {
          error: {
            code: 'INVALID_REQUEST',
            message: error instanceof Error ? error.message : 'Invalid request',
          },
        })
        return
      }
    }
  
    const rotateKeyMatch = pathname.match(/^\/api\/v1\/public\/credentials\/keys\/([^/]+)\/rotate$/)
    if (rotateKeyMatch && req.method === 'POST') {
      const auth = await authorizeDashboardScope(req, requestUrl.searchParams, { requireAuth: true })
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error })
        return
      }
      const scopedAccountId = resolveAuthorizedDashboardAccount(auth)
      if (!scopedAccountId) {
        sendJson(res, 403, {
          error: {
            code: 'DASHBOARD_SCOPE_VIOLATION',
            message: 'Dashboard account scope is missing.',
          },
        })
        return
      }
  
      const keyId = decodeURIComponent(rotateKeyMatch[1] || '').trim()
      const target = state.controlPlane.apiKeys.find((item) => item.keyId === keyId)
      if (!target) {
        sendJson(res, 404, {
          error: {
            code: 'KEY_NOT_FOUND',
            message: `API key not found: ${keyId}`,
          },
        })
        return
      }
      const targetAccountId = normalizeControlPlaneAccountId(target.accountId || resolveAccountIdForApp(target.appId), '')
      if (targetAccountId !== scopedAccountId) {
        sendJson(res, 403, {
          error: {
            code: 'DASHBOARD_SCOPE_VIOLATION',
            message: `keyId ${keyId} does not belong to your account.`,
          },
        })
        return
      }
  
      const { keyRecord, secret } = createControlPlaneKeyRecord({
        keyId: target.keyId,
        appId: target.appId,
        accountId: target.accountId || resolveAccountIdForApp(target.appId),
        environment: target.environment,
        keyName: target.keyName,
        createdAt: target.createdAt,
        lastUsedAt: target.lastUsedAt,
        metadata: target.metadata,
        status: 'active',
      })
  
      const rotatedTarget = {
        ...target,
        keyPrefix: keyRecord.keyPrefix,
        secretHash: keyRecord.secretHash,
        status: 'active',
        revokedAt: '',
        maskedKey: keyRecord.maskedKey,
        accountId: keyRecord.accountId,
        updatedAt: keyRecord.updatedAt,
      }
  
      if (isSupabaseSettlementStore()) {
        await upsertControlPlaneKeyToSupabase(rotatedTarget)
      }
      Object.assign(target, rotatedTarget)
      upsertControlPlaneStateRecord('apiKeys', 'keyId', target)
  
      recordControlPlaneAudit({
        action: 'key_rotate',
        actor: resolveAuditActor(req, 'public_api'),
        accountId: target.accountId,
        appId: target.appId,
        environment: target.environment,
        resourceType: 'api_key',
        resourceId: target.keyId,
        metadata: {
          keyName: target.keyName,
          status: target.status,
        },
      })
      persistState(state)
      sendJson(res, 200, {
        key: toPublicApiKeyRecord(target),
        secret,
      })
      return
    }
  
    const revokeKeyMatch = pathname.match(/^\/api\/v1\/public\/credentials\/keys\/([^/]+)\/revoke$/)
    if (revokeKeyMatch && req.method === 'POST') {
      const auth = await authorizeDashboardScope(req, requestUrl.searchParams, { requireAuth: true })
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error })
        return
      }
      const scopedAccountId = resolveAuthorizedDashboardAccount(auth)
      if (!scopedAccountId) {
        sendJson(res, 403, {
          error: {
            code: 'DASHBOARD_SCOPE_VIOLATION',
            message: 'Dashboard account scope is missing.',
          },
        })
        return
      }
  
      const keyId = decodeURIComponent(revokeKeyMatch[1] || '').trim()
      const target = state.controlPlane.apiKeys.find((item) => item.keyId === keyId)
      if (!target) {
        sendJson(res, 404, {
          error: {
            code: 'KEY_NOT_FOUND',
            message: `API key not found: ${keyId}`,
          },
        })
        return
      }
      const targetAccountId = normalizeControlPlaneAccountId(target.accountId || resolveAccountIdForApp(target.appId), '')
      if (targetAccountId !== scopedAccountId) {
        sendJson(res, 403, {
          error: {
            code: 'DASHBOARD_SCOPE_VIOLATION',
            message: `keyId ${keyId} does not belong to your account.`,
          },
        })
        return
      }
  
      if (target.status !== 'revoked') {
        const revokedAt = nowIso()
        const revokedTarget = {
          ...target,
          status: 'revoked',
          revokedAt,
          updatedAt: revokedAt,
        }
        if (isSupabaseSettlementStore()) {
          await upsertControlPlaneKeyToSupabase(revokedTarget)
        }
        Object.assign(target, revokedTarget)
        upsertControlPlaneStateRecord('apiKeys', 'keyId', target)
        recordControlPlaneAudit({
          action: 'key_revoke',
          actor: resolveAuditActor(req, 'public_api'),
          accountId: target.accountId || resolveAccountIdForApp(target.appId),
          appId: target.appId,
          environment: target.environment,
          resourceType: 'api_key',
          resourceId: target.keyId,
          metadata: {
            keyName: target.keyName,
            status: target.status,
            revokedAt,
          },
        })
        persistState(state)
      }
  
      sendJson(res, 200, {
        key: toPublicApiKeyRecord(target),
      })
      return
    }
  
    if (pathname === '/api/v1/dashboard/state' && req.method === 'GET') {
      const auth = await authorizeDashboardScope(req, requestUrl.searchParams)
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error })
        return
      }
      const scope = auth.scope
      sendJson(res, 200, await getDashboardStatePayload(scope))
      return
    }

    if (pathname === '/api/v1/dashboard/security/origins' && req.method === 'GET') {
      const auth = await authorizeDashboardScope(req, requestUrl.searchParams)
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error })
        return
      }

      let items = []
      if (isSupabaseSettlementStore()) {
        items = await listAllowedCorsOriginsFromSupabase(settlementStore.pool)
      }
      if (!Array.isArray(items) || items.length === 0) {
        const fallbackNow = nowIso()
        items = getAllowedCorsOrigins().map((origin) => ({
          origin,
          createdAt: fallbackNow,
          updatedAt: fallbackNow,
        }))
      }

      sendJson(res, 200, { items })
      return
    }

    if (pathname === '/api/v1/dashboard/security/origins' && req.method === 'PUT') {
      try {
        const auth = await authorizeDashboardScope(req, requestUrl.searchParams, { requireAuth: true })
        if (!auth.ok) {
          sendJson(res, auth.status, { error: auth.error })
          return
        }

        const payload = await readJsonBody(req)
        const origins = normalizeAllowedCorsOriginsPayload(payload, 'origins')
        const items = await replaceAllowedCorsOriginsInSupabase(origins, settlementStore.pool)
        if (isSupabaseSettlementStore()) {
          await refreshAllowedCorsOriginsFromSupabase(settlementStore.pool)
        }

        const scopedAccountId = resolveAuthorizedDashboardAccount(auth)
        const scopedAppId = String(auth?.scope?.appId || auth?.user?.appId || auth?.session?.appId || '').trim()
        recordControlPlaneAudit({
          action: 'cors_origins_update',
          actor: resolveAuditActor(req, 'dashboard'),
          accountId: scopedAccountId,
          appId: scopedAppId,
          environment: 'prod',
          resourceType: 'gateway_security',
          resourceId: 'allowed_cors_origins',
          metadata: {
            count: Array.isArray(items) ? items.length : 0,
            origins: Array.isArray(items) ? items.map((item) => String(item?.origin || '').trim()).filter(Boolean) : [],
          },
        })
        persistState(state)

        sendJson(res, 200, {
          updated: true,
          items,
        })
        return
      } catch (error) {
        sendJson(res, 400, {
          error: {
            code: 'INVALID_REQUEST',
            message: error instanceof Error ? error.message : 'Invalid request',
          },
        })
        return
      }
    }
  
    if (pathname === '/api/v1/dashboard/placements' && req.method === 'GET') {
      const auth = await authorizeDashboardScope(req, requestUrl.searchParams)
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error })
        return
      }
      const scope = auth.scope
      const hasScope = scopeHasFilters(scope)
      if (hasScope && getScopedApps(scope).length === 0) {
        sendJson(res, 200, { appId: '', placementConfigVersion: 1, placements: [] })
        return
      }
  
      const scopedAppId = resolvePlacementScopeAppId(scope, auth.user?.appId || auth.session?.appId || '')
      if (!scopedAppId) {
        sendJson(res, 200, { appId: '', placementConfigVersion: 1, placements: [] })
        return
      }
      const config = getPlacementConfigForApp(scopedAppId, scope.accountId, { createIfMissing: true })
      const placements = config?.placements && Array.isArray(config.placements)
        ? config.placements.map((item) => normalizePlacement(item))
        : []
      sendJson(res, 200, {
        appId: scopedAppId,
        placementConfigVersion: toPositiveInteger(config?.placementConfigVersion, 1),
        placements,
      })
      return
    }
  
    if (pathname === '/api/v1/dashboard/placements' && req.method === 'POST') {
      try {
        const auth = await authorizeDashboardScope(req, requestUrl.searchParams, { requireAuth: true })
        if (!auth.ok) {
          sendJson(res, auth.status, { error: auth.error })
          return
        }
  
        const scope = auth.scope
        const scopedAppId = resolvePlacementScopeAppId(scope, auth.user?.appId || auth.session?.appId || '')
        if (!scopedAppId) {
          sendJson(res, 403, {
            error: {
              code: 'DASHBOARD_SCOPE_VIOLATION',
              message: 'appId is required for placement mutation under current dashboard scope.',
            },
          })
          return
        }
        const placementConfig = getPlacementConfigForApp(scopedAppId, scope.accountId, { createIfMissing: true })
        if (!placementConfig) {
          sendJson(res, 404, {
            error: {
              code: 'PLACEMENT_CONFIG_NOT_FOUND',
              message: `placement config not found for appId ${scopedAppId}.`,
            },
          })
          return
        }
  
        const payload = await readJsonBody(req)
        const placementId = assertPlacementIdNotRenamed(
          String(payload?.placementId || payload?.placement_id || '').trim(),
          'placementId',
        )
        if (!placementId) {
          sendJson(res, 400, {
            error: {
              code: 'INVALID_REQUEST',
              message: 'placementId is required.',
            },
          })
          return
        }
  
        const exists = Array.isArray(placementConfig.placements)
          ? placementConfig.placements.find((item) => item.placementId === placementId)
          : null
        if (exists) {
          sendJson(res, 409, {
            error: {
              code: 'PLACEMENT_EXISTS',
              message: `Placement already exists: ${placementId}`,
            },
          })
          return
        }
  
        const nextConfigVersion = toPositiveInteger(placementConfig.placementConfigVersion, 1) + 1
        const basePlacement = normalizePlacement({
          placementId,
          placementKey: resolvePlacementKeyById(placementId, scopedAppId),
          configVersion: nextConfigVersion,
        })
        const created = buildPlacementFromPatch(basePlacement, payload, nextConfigVersion)
        created.placementId = placementId
        created.placementKey = String(created.placementKey || '').trim() || resolvePlacementKeyById(placementId, scopedAppId)
  
        placementConfig.placements = Array.isArray(placementConfig.placements)
          ? [...placementConfig.placements, created]
          : [created]
        placementConfig.placementConfigVersion = nextConfigVersion
        placementConfig.updatedAt = nowIso()
        state.placementConfigVersion = Math.max(
          toPositiveInteger(state.placementConfigVersion, 1),
          nextConfigVersion,
        )
        if (scopedAppId === DEFAULT_CONTROL_PLANE_APP_ID) {
          syncLegacyPlacementSnapshot()
        }
  
        const actor = resolveAuditActor(req, 'dashboard')
        const scopedAccountId = normalizeControlPlaneAccountId(
          placementConfig.accountId || resolveAccountIdForApp(scopedAppId),
          '',
        )
        const patch = payload && typeof payload === 'object' ? payload : {}
        recordPlacementAudit({
          appId: scopedAppId,
          accountId: scopedAccountId,
          placementId,
          configVersion: nextConfigVersion,
          actor,
          patch,
          before: null,
          after: JSON.parse(JSON.stringify(created)),
        })
        recordControlPlaneAudit({
          action: 'config_publish',
          actor,
          accountId: scopedAccountId,
          appId: scopedAppId,
          environment: 'prod',
          resourceType: 'placement',
          resourceId: placementId,
          metadata: {
            operation: 'create',
            configVersion: nextConfigVersion,
            patch,
          },
        })
  
        persistState(state)
  
        sendJson(res, 201, {
          appId: scopedAppId,
          placementConfigVersion: toPositiveInteger(placementConfig.placementConfigVersion, 1),
          placement: created,
          changed: true,
        })
        return
      } catch (error) {
        sendJson(res, 400, {
          error: {
            code: 'INVALID_REQUEST',
            message: error instanceof Error ? error.message : 'Invalid request',
          },
        })
        return
      }
    }
  
    if (pathname.startsWith('/api/v1/dashboard/placements/') && req.method === 'PUT') {
      try {
        const auth = await authorizeDashboardScope(req, requestUrl.searchParams)
        if (!auth.ok) {
          sendJson(res, auth.status, { error: auth.error })
          return
        }
        const scope = auth.scope
        const scopedAppId = resolvePlacementScopeAppId(scope, auth.user?.appId || auth.session?.appId || '')
        if (!scopedAppId) {
          sendJson(res, 403, {
            error: {
              code: 'DASHBOARD_SCOPE_VIOLATION',
              message: 'appId is required for placement mutation under current dashboard scope.',
            },
          })
          return
        }
        const placementConfig = getPlacementConfigForApp(scopedAppId, scope.accountId, { createIfMissing: true })
        const placementId = decodeURIComponent(pathname.replace('/api/v1/dashboard/placements/', ''))
        assertPlacementIdNotRenamed(placementId, 'placementId')
        const target = placementConfig?.placements?.find((item) => item.placementId === placementId)
  
        if (!target) {
          sendJson(res, 404, {
            error: {
              code: 'PLACEMENT_NOT_FOUND',
              message: `Placement not found: ${placementId}`,
            },
          })
          return
        }
  
        const payload = await readJsonBody(req)
        const before = JSON.parse(JSON.stringify(target))
        const preview = buildPlacementFromPatch(target, payload, target.configVersion || 1)
        const changed = JSON.stringify(before) !== JSON.stringify(preview)
  
        if (changed) {
          const nextConfigVersion = toPositiveInteger(placementConfig?.placementConfigVersion, 1) + 1
          applyPlacementPatch(target, payload, nextConfigVersion)
          placementConfig.placementConfigVersion = nextConfigVersion
          placementConfig.updatedAt = nowIso()
          state.placementConfigVersion = Math.max(
            toPositiveInteger(state.placementConfigVersion, 1),
            nextConfigVersion,
          )
          if (scopedAppId === DEFAULT_CONTROL_PLANE_APP_ID) {
            syncLegacyPlacementSnapshot()
          }
          const actor = resolveAuditActor(req, 'dashboard')
          const scopedAccountId = normalizeControlPlaneAccountId(
            placementConfig?.accountId || resolveAccountIdForApp(scopedAppId),
            '',
          )
          recordPlacementAudit({
            appId: scopedAppId,
            accountId: scopedAccountId,
            placementId: placementId,
            configVersion: nextConfigVersion,
            actor,
            patch: payload && typeof payload === 'object' ? payload : {},
            before,
            after: JSON.parse(JSON.stringify(target)),
          })
          recordControlPlaneAudit({
            action: 'config_publish',
            actor,
            accountId: scopedAccountId,
            appId: scopedAppId,
            environment: 'prod',
            resourceType: 'placement',
            resourceId: placementId,
            metadata: {
              configVersion: nextConfigVersion,
              patch: payload && typeof payload === 'object' ? payload : {},
            },
          })
        }
  
        persistState(state)
  
        sendJson(res, 200, {
          appId: scopedAppId,
          placementConfigVersion: toPositiveInteger(placementConfig?.placementConfigVersion, 1),
          placement: target,
          changed,
        })
        return
      } catch (error) {
        sendJson(res, 400, {
          error: {
            code: 'INVALID_REQUEST',
            message: error instanceof Error ? error.message : 'Invalid request',
          },
        })
        return
      }
    }
  
    if (pathname === '/api/v1/dashboard/metrics/summary' && req.method === 'GET') {
      const auth = await authorizeDashboardScope(req, requestUrl.searchParams)
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error })
        return
      }
      const scope = auth.scope
      const snapshot = await getDashboardStatePayload(scope)
      sendJson(res, 200, snapshot.metricsSummary)
      return
    }
  
    if (pathname === '/api/v1/dashboard/metrics/by-day' && req.method === 'GET') {
      const auth = await authorizeDashboardScope(req, requestUrl.searchParams)
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error })
        return
      }
      const scope = auth.scope
      const snapshot = await getDashboardStatePayload(scope)
      sendJson(res, 200, { items: snapshot.metricsByDay })
      return
    }
  
    if (pathname === '/api/v1/dashboard/metrics/by-placement' && req.method === 'GET') {
      const auth = await authorizeDashboardScope(req, requestUrl.searchParams)
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error })
        return
      }
      const scope = auth.scope
      const snapshot = await getDashboardStatePayload(scope)
      sendJson(res, 200, { items: snapshot.metricsByPlacement })
      return
    }
  
    if (pathname === '/api/v1/dashboard/usage-revenue' && req.method === 'GET') {
      const auth = await authorizeDashboardScope(req, requestUrl.searchParams)
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error })
        return
      }
      const snapshot = await getDashboardStatePayload(auth.scope)
      sendJson(res, 200, snapshot.settlementAggregates)
      return
    }
  
    if (pathname === '/api/v1/dashboard/decisions' && req.method === 'GET') {
      const result = requestUrl.searchParams.get('result')
      const placementId = requestUrl.searchParams.get('placementId')
      const requestId = requestUrl.searchParams.get('requestId')
      const auth = await authorizeDashboardScope(req, requestUrl.searchParams)
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error })
        return
      }
      const scope = auth.scope
  
      let rows = await listDecisionLogs(scope)
  
      if (result) {
        rows = rows.filter((row) => row.result === result)
      }
  
      if (placementId) {
        rows = rows.filter((row) => row.placementId === placementId)
      }
      if (requestId) {
        rows = rows.filter((row) => row.requestId === requestId)
      }
  
      sendJson(res, 200, { items: rows })
      return
    }
  
    if (pathname === '/api/v1/dashboard/events' && req.method === 'GET') {
      const result = requestUrl.searchParams.get('result')
      const placementId = requestUrl.searchParams.get('placementId')
      const requestId = requestUrl.searchParams.get('requestId')
      const eventType = requestUrl.searchParams.get('eventType')
      const auth = await authorizeDashboardScope(req, requestUrl.searchParams)
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error })
        return
      }
      const scope = auth.scope
  
      let rows = await listEventLogs(scope)
  
      if (result) {
        rows = rows.filter((row) => String(row?.result || '') === result)
      }
      if (placementId) {
        rows = rows.filter((row) => String(row?.placementId || '') === placementId)
      }
      if (requestId) {
        rows = rows.filter((row) => String(row?.requestId || '') === requestId)
      }
      if (eventType) {
        rows = rows.filter((row) => String(row?.eventType || '') === eventType)
      }
  
      sendJson(res, 200, { items: rows })
      return
    }
  
    if (pathname === '/api/v1/dashboard/audit/logs' && req.method === 'GET') {
      const auth = await authorizeDashboardScope(req, requestUrl.searchParams)
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error })
        return
      }
      let rows = queryControlPlaneAudits(requestUrl.searchParams)
      if (scopeHasFilters(auth.scope)) {
        rows = rows.filter((row) => recordMatchesScope(row, auth.scope))
      }
      sendJson(res, 200, {
        items: rows,
      })
      return
    }
  
    if (pathname === '/api/v1/dashboard/placement-audits' && req.method === 'GET') {
      const auth = await authorizeDashboardScope(req, requestUrl.searchParams, { requireAuth: true })
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error })
        return
      }
      const scope = auth.scope
      const placementId = requestUrl.searchParams.get('placementId')
      let rows = filterRowsByScope(state.placementAuditLogs, scope)
      if (placementId) {
        rows = rows.filter((row) => row.placementId === placementId)
      }
      sendJson(res, 200, { items: rows })
      return
    }
  
    if (pathname === '/api/v1/dashboard/network-health' && req.method === 'GET') {
      const auth = await authorizeDashboardScope(req, requestUrl.searchParams)
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error })
        return
      }
      const scope = auth.scope
      const networkHealth = getAllNetworkHealth()
      const scopedFlowLogs = filterRowsByScope(state.networkFlowLogs, scope)
      sendJson(res, 200, {
        networkHealth,
        networkHealthSummary: summarizeNetworkHealthMap(networkHealth),
        networkFlowStats: scopeHasFilters(scope)
          ? computeScopedNetworkFlowStats(scopedFlowLogs)
          : state.networkFlowStats,
        items: scopedFlowLogs,
      })
      return
    }

    if (pathname === '/api/v1/internal/inventory/status' && req.method === 'GET') {
      try {
        const status = await getInventoryStatus(isPostgresSettlementStore() ? settlementStore.pool : null)
        sendJson(res, 200, status)
        return
      } catch (error) {
        sendJson(res, 500, {
          error: {
            code: 'INVENTORY_STATUS_FAILED',
            message: error instanceof Error ? error.message : 'Failed to fetch inventory status',
          },
        })
        return
      }
    }
  
    if (pathname === '/api/v1/internal/inventory/sync' && req.method === 'POST') {
      try {
        const payload = await readJsonBody(req).catch(() => ({}))
        if (!isPostgresSettlementStore()) {
          sendJson(res, 503, {
            error: {
              code: 'INVENTORY_SYNC_UNAVAILABLE',
              message: 'Inventory sync requires postgres settlement store.',
            },
          })
          return
        }
  
        const body = payload && typeof payload === 'object' ? payload : {}
        const networks = Array.isArray(body.networks)
          ? body.networks.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
          : ['partnerstack', 'cj', 'house']
  
        const syncResult = await syncInventoryNetworks(settlementStore.pool, {
          networks,
          search: String(body.search || '').trim(),
          limit: toPositiveInteger(body.limit, 240),
          trigger: 'internal_api',
        })
        const embeddingResult = body.buildEmbeddings === false
          ? null
          : await buildInventoryEmbeddings(settlementStore.pool, {
            limit: toPositiveInteger(body.embeddingLimit, 6000),
          })
        const snapshotResult = body.materializeSnapshot === false
          ? null
          : await materializeServingSnapshot(settlementStore.pool)
        const status = await getInventoryStatus(settlementStore.pool)
  
        sendJson(res, 200, {
          ok: Boolean(syncResult?.ok),
          sync: syncResult,
          embeddings: embeddingResult,
          snapshot: snapshotResult,
          status,
        })
        return
      } catch (error) {
        sendJson(res, 500, {
          error: {
            code: 'INVENTORY_SYNC_FAILED',
            message: error instanceof Error ? error.message : 'Inventory sync failed',
          },
        })
        return
      }
    }
  })()

  return true
}
