import { handleGatewayRequest } from './mediation-gateway.js'

export async function handleControlPlaneRequest(req, res) {
  await handleGatewayRequest(req, res, {
    apiServiceRole: 'control_plane',
  })
}

