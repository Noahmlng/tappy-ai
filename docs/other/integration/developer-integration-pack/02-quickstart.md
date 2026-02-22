# 02 - Quickstart (First Ad in 15 Minutes)

- Owner:
- Last Updated:
- Scope: local dev / staging

## 1. Prerequisites

- Node version:
- Access requirements:
- Required env vars:

## 2. Start Services

```bash
# Example (replace with your exact startup commands)
npm ci
npm run infra:up
npm run dev:gateway
```

## 3. Send First Evaluate Request

```bash
# Example request payload
curl -X POST "$MEDIATION_BASE_URL/api/v1/sdk/evaluate" \
  -H 'Content-Type: application/json' \
  -d '{"appId":"","sessionId":"","turnId":"","query":"","answerText":"","intentScore":0.9,"locale":"en-US"}'
```

Expected:

- `requestId` returned
- `decision.result` is present

## 4. Send Event Callback

```bash
curl -X POST "$MEDIATION_BASE_URL/api/v1/sdk/events" \
  -H 'Content-Type: application/json' \
  -d '{"requestId":"..."}'
```

Expected:

- `{ "ok": true }`

## 5. Verify in Dashboard/Logs

- Request log location:
- Event log location:
- What success looks like:

## 6. Common Setup Failures

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
|  |  |  |
