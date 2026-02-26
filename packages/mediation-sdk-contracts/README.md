# @noahmlng/mediation-sdk-contracts

Shared contracts package for:

- Mediation Runtime API
- Mediation Control Plane API

## Install

```bash
npm install @noahmlng/mediation-sdk-contracts
```

## Exports

- `@noahmlng/mediation-sdk-contracts`
  - `listSchemaKeys()`
  - `resolveSchemaUrl(schemaKey)`
  - `createRuntimeClient(config)`
  - `createControlPlaneClient(config)`
- `@noahmlng/mediation-sdk-contracts/client`
  - `createRuntimeClient(config)`
  - `createControlPlaneClient(config)`

`createControlPlaneClient(config)` returns grouped clients:

- `health`
- `dashboard`
- `credentials`
- `quickStart`
- `auth`
- `agent`
- `placements`

## Publish (GitHub Packages)

Registry: `https://npm.pkg.github.com`
