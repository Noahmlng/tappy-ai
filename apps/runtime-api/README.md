# Runtime API App

Vercel root directory: `apps/runtime-api`

This app exposes runtime-only endpoints:

- `GET /api/v1/mediation/config`
- `POST /api/v2/bid`
- `POST /api/v1/sdk/events`

Handler source:

- `mediation/src/devtools/mediation/mediation-gateway.js`
- export: `handleRuntimeRequest`
