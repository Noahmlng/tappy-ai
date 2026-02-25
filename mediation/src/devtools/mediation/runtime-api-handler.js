import { handleGatewayRequest } from './mediation-gateway.js'

export async function handleRuntimeRequest(req, res) {
  await handleGatewayRequest(req, res, {
    apiServiceRole: 'runtime',
  })
}

