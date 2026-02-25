# Simulator: Developer Dashboard

A simulation console for SDK integrators to manage placements, trigger params, and revenue analytics.

## Core pages

- Overview: revenue and performance KPI snapshots
- Placements: placement enable/priority/frequency controls
- Triggers: intent/cooldown/revenue threshold controls
- Decision Logs: trigger results and non-trigger reasons

## Run

```bash
npm --prefix ./projects/simulator-dashboard run dev
```

By default, Dashboard reads and writes through `/api` (expected to proxy to local simulator gateway).
Default local gateway target: `http://127.0.0.1:3100`.

## Build

```bash
npm --prefix ./projects/simulator-dashboard run build
```

## Environment Variables

- Required for production:
  - `VITE_MEDIATION_CONTROL_PLANE_API_BASE_URL` (example: `https://control-plane.example.com/api`)
- Optional for split runtime domain:
  - `VITE_MEDIATION_RUNTIME_API_BASE_URL` (example: `https://runtime.example.com/api`)
- Local development:
  - `MEDIATION_CONTROL_PLANE_API_PROXY_TARGET` (default `http://127.0.0.1:3100`)
  - `VITE_MEDIATION_CONTROL_PLANE_API_BASE_URL` can stay `/api` when using local proxy.
- Optional internal flags (dev-only):
  - `VITE_DASHBOARD_V1_MINIMAL`
  - `VITE_ENABLE_INTERNAL_RESET`
- Legacy aliases (temporary compatibility):
  - `VITE_SIMULATOR_API_BASE_URL`
  - `SIMULATOR_API_PROXY_TARGET`

## Production Deploy (Vercel)

1. Create a Vercel project with root directory `projects/simulator-dashboard`.
2. Set `VITE_MEDIATION_CONTROL_PLANE_API_BASE_URL` to the deployed control-plane API URL plus `/api`.
3. If runtime is split, set `VITE_MEDIATION_RUNTIME_API_BASE_URL` to runtime API URL plus `/api`.
4. Deploy with `vercel deploy projects/simulator-dashboard -y`.
5. Promote with `vercel deploy projects/simulator-dashboard --prod -y` after smoke tests pass.

This dashboard only depends on Mediation API endpoints and does not require chatbot deployment.
