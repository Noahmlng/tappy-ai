# Dashboard v1 Security Review (DASH-B-007)

- Date: 2026-02-22
- Scope: `integration token -> token exchange -> agent access token -> runtime APIs`
- Reviewer: Codex

## Security Controls Added

1. TTL hard validation
   - `integration token issue`: `ttlMinutes` remains `10-15`.
   - `token exchange`: `ttlSeconds` now hard-rejected outside `60-900` (no silent clamp).
   - Access token TTL cannot exceed source token remaining lifetime.

2. Replay protection
   - One-time integration token replay is rejected (`INTEGRATION_TOKEN_ALREADY_USED`).
   - Duplicate exchange attempts detected both by token status and `sourceTokenId` linkage.

3. Privilege escalation protection
   - `token exchange` rejects forbidden fields (`appId/environment/placementId/scope/...`) with `TOKEN_EXCHANGE_SCOPE_VIOLATION`.
   - Source token type/scope is validated before exchange (`INTEGRATION_TOKEN_SCOPE_INVALID`).
   - Agent access token is scope-bound (`mediationConfigRead/sdkEvaluate/sdkEvents`) and placement-bound during runtime API calls.

4. Deny-path auditing
   - Added `integration_token_exchange_deny` audits with reason codes:
     - `invalid_integration_token`
     - `integration_token_replay`
     - `integration_token_inactive`
     - `integration_token_expired`
     - `ttl_out_of_range`
     - `privilege_escalation_attempt`
     - `source_token_scope_invalid`
   - Added `agent_access_deny` audits for runtime scope/binding violations.

## Verification

Integration tests:

1. `token-security.integration.test.js`
   - ttl range deny + audit
   - scope escalation deny + replay deny + audit
   - access token placement overreach deny + audit

2. `token-exchange.integration.test.js`
   - happy path exchange and replay rejection remain valid

