import { handleGatewayRequest } from '../src/devtools/simulator/simulator-gateway.js'

export default async function vercelGatewayHandler(req, res) {
  await handleGatewayRequest(req, res)
}
