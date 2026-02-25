import { handleGatewayRequest } from '../src/devtools/simulator/simulator-gateway.js'

export default async function mediationApiCatchAllHandler(req, res) {
  await handleGatewayRequest(req, res)
}
