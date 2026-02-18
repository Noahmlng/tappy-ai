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

## Local API Settings

- Browser API base: `VITE_SIMULATOR_API_BASE_URL` (default `/api`)
- Dev proxy target: `SIMULATOR_API_PROXY_TARGET` (default `http://127.0.0.1:3100`)
