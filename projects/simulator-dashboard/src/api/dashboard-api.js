import { controlPlaneClient } from './control-plane-client'

// Backward-compatible wrappers.
// Prefer importing `controlPlaneClient` directly for new code.
export async function fetchDashboardState() {
  return controlPlaneClient.dashboard.getState()
}

export async function updateDashboardPlacement(placementId, patch) {
  return controlPlaneClient.dashboard.updatePlacement(placementId, patch)
}

export async function pingGatewayHealth() {
  return controlPlaneClient.health.ping()
}

export async function fetchPublicApiKeys() {
  return controlPlaneClient.credentials.listKeys()
}

export async function createPublicApiKey(payload) {
  return controlPlaneClient.credentials.createKey(payload)
}

export async function rotatePublicApiKey(keyId) {
  return controlPlaneClient.credentials.rotateKey(keyId)
}

export async function revokePublicApiKey(keyId) {
  return controlPlaneClient.credentials.revokeKey(keyId)
}

export async function fetchPublicPlacements() {
  return controlPlaneClient.placements.list()
}

export async function createPublicPlacement(payload) {
  return controlPlaneClient.placements.create(payload)
}

export async function updatePublicPlacement(placementId, payload) {
  return controlPlaneClient.placements.update(placementId, payload)
}
