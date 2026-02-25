# Control Plane API App

Vercel root directory: `apps/control-plane-api`

This app exposes control-plane-only endpoints:

- `/api/v1/public/*`
- `/api/v1/dashboard/*`

Handler source:

- `mediation/src/devtools/mediation/mediation-gateway.js`
- export: `handleControlPlaneRequest`
